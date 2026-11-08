/**
 * LandscapeView — reusable three.js viewport for any src/core landscape.
 *
 * One instance owns: a heightmap mesh (Viridis vertex colors, soft directional
 * shading, emissive valley glow), lifted d3-contour lines, an orthographic
 * camera rig with orbit/zoom + Isometric / Map view presets, overlay capacity
 * for optimizer trails / arrows / the learner ball, and a small set of DOM
 * preset buttons rendered into the container.
 *
 * World mapping (fixed for the whole project):
 *   parameter (px, py)  ->  world (px − cx, f̂·H, −(py − cy))
 * where f̂ is the height normalized to [0, 1] over the landscape's sampled
 * range and H is a per-landscape vertical scale (a fraction of the horizontal
 * diagonal). The −py flip makes the Map view (exact top-down) read like a
 * normal 2D plot: +x right, +y up.
 *
 * Rendering is on-demand: mutations mark the view dirty and a rAF loop draws
 * once. Call requestRender() after mutating overlays in an animation loop.
 */

import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { contours as contourGrid } from "d3-contour";
import { scaleSequential } from "d3-scale";
import { interpolateViridis } from "d3-scale-chromatic";
import type { Landscape, Vec2 } from "../core/functions";
import { MANIM } from "./palette";
import { TRAIL_MATERIALS } from "./animatedTrail";

/* ------------------------------------------------------------------ */
/* Public types                                                        */
/* ------------------------------------------------------------------ */

export type CameraPreset = "iso" | "map";

export interface LandscapeViewOptions {
  /** Grid cells per side for the heightmap (grid is (n+1)×(n+1) samples). */
  gridN: number;
  /** Scene clear color. */
  background: number;
  /** Called when a preset button (or setPreset) changes the attitude. */
  onCameraPreset?: (preset: CameraPreset) => void;
  /** Called after the user drags the camera off any preset attitude. */
  onUserOrbit?: () => void;
  /** Called every animation frame with seconds since the previous frame (clamped to 0.1). */
  onFrame?: (dtSec: number) => void;
  /** Called after the renderer resizes. */
  onResize?: (widthPx: number, heightPx: number) => void;
  /**
   * Called on left-pointerdown BEFORE an orbit drag starts. Return true to
   * capture the whole drag (e.g. dragging the learner point): the view then
   * routes pointermove/pointerup to onDragMove/onDragEnd and does not orbit.
   */
  onDragStart?: (e: PointerEvent) => boolean;
  /** Called for pointermove while a captured (puppet) drag is active. */
  onDragMove?: (e: PointerEvent) => void;
  /** Called on pointerup after a captured (puppet) drag. */
  onDragEnd?: (e: PointerEvent) => void;
  /**
   * Called the moment a user ORBIT drag begins (button 0, not a captured
   * object drag). The director uses this to drop in-flight camera
   * choreography — without it, a step-change camera tween re-applies
   * setAttitude every frame and the drag visibly does nothing.
   */
  onUserOrbitStart?: () => void;
}

export interface CameraAttitude {
  azimuthDeg: number;
  elevationDeg: number;
  zoomRadius: number;
}

/* ------------------------------------------------------------------ */
/* Constants (visual bar + rig tuning)                                 */
/* ------------------------------------------------------------------ */

const DEG = Math.PI / 180;

/** Default attitude: matplotlib-flavored isometric. */
const ISO_AZIMUTH = -60 * DEG;
const ISO_ELEVATION = 35 * DEG;
/** Map view: exact top-down, in-plane rotation chosen so +x→right, +y→up. */
const MAP_AZIMUTH = 0;
const MAP_ELEVATION = 90 * DEG;

// Drag clamp and attitude floor: §2's "low over the bowl floor" choreography
// needs ~16°, so the drag clamp now reaches down there too (dragging after a
// low scene must not pop the camera back up).
const ELEVATION_MIN = 15 * DEG;
const ELEVATION_MAX = 90 * DEG;

/** Terrain world height as a fraction of the mean extent side. */
const HEIGHT_FRACTION = 0.3;
/** Contour levels drawn over the sampled height range. */
const CONTOUR_LEVELS = 14;
/** Contour line opacity (visual bar: thin white lines ~12%). */
const CONTOUR_OPACITY = 0.12;
/** Fog mask resolution (parameter-space uv texture, §6 fog game). */
const FOG_MASK_SIZE = 512;

const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));

/* ------------------------------------------------------------------ */
/* LandscapeView                                                       */
/* ------------------------------------------------------------------ */

export class LandscapeView {
  private readonly container: HTMLElement;
  private readonly opts: LandscapeViewOptions;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  private readonly terrainGroup = new THREE.Group();
  private readonly overlayGroup = new THREE.Group();

  /**
   * Two-light rig (terrain shader + scene lights share these):
   * a warm KEY from the upper left sculpts the ridges; a cool FILL from the
   * opposite low side keeps away-faces readable without flattening them.
   */
  private readonly keyDir = new THREE.Vector3(-0.45, 0.75, 0.4).normalize();
  private readonly fillDir = new THREE.Vector3(0.6, 0.35, -0.6).normalize();
  /** Direction TO the camera (view space is orthographic — near-constant). */
  private viewDir = new THREE.Vector3(0, 1, 0);

  private landscape: Landscape | null = null;
  /** Grid resolution of the CURRENT terrain build (setLandscape may override). */
  private activeGridN: number = 160;

  // Landscape-derived scales (set by setLandscape).
  private hMin = 0;
  private hRange = 1;
  private heightWorld = 1;
  private diag = 1;
  private camDistance = 3;

  // Camera state.
  private azimuth = ISO_AZIMUTH;
  private elevation = ISO_ELEVATION;
  private zoomRadius = 1;
  /**
   * Wheel zooms EASE toward this target instead of snapping (the loop
   * integrates the approach); direct-manipulation gestures (pinch, dolly)
   * and programmatic sets keep zoomTarget === zoomRadius so nothing fights.
   */
  private zoomTarget = 1;
  /** The landscape's reframe fit — the radius that frames its whole extent.
   *  Scene zoom specs are multipliers on THIS (QA F-2/cam-1: zooming off the
   *  inherited radius compounded on every same-landscape re-entry). */
  private fitZoomRadius = 1;
  private zoomMin = 0.1;
  private zoomMax = 10;
  private readonly target = new THREE.Vector3();

  /**
   * Inertial orbit: the drag's EMA velocity (rad/s) keeps carrying after
   * release and decays exponentially in the loop. Sensitivity scales with
   * zoomRadius/fitZoomRadius, so gestures get finer as you zoom in.
   */
  private azimVel = 0;
  private elevVel = 0;
  private lastMoveTime = 0;
  /** The last preset chosen — double-click resets the attitude back to it. */
  private preset: CameraPreset | null = null;

  // Overlays we must dispose or update on resize/landscape change.
  private trails: Line2[] = [];
  private ball: THREE.Mesh | null = null;
  /** LineMaterials from addOverlayObject() that need resolution on resize. */
  private readonly extraResolutionMats = new Set<LineMaterial>();

  // Terrain presentation state (§1 materialization moment).
  /** 0 = flat parameter plane, 1 = full relief. Scales terrainGroup.y. */
  private terrainRise = 1;
  /** Terrain + contour opacity multiplier, 0..1. */
  private terrainOpacity = 1;
  /** Contour-line reveal multiplier (§6: 0 while fogged, 1 after reveal). */
  private contourRevealK = 1;

  // Hover-to-look focus state (spotlight a target, dim everything else).
  /** Terrain color dim (1 = none). Feeds the shader's uDim uniform. */
  private focusTerrainDim = 1;
  /** Contour opacity dim (rides applyContourOpacity). */
  private focusContourDim = 1;
  /** Overlay material opacity dim (1 = none); trail materials self-manage. */
  private focusOverlayDim = 1;
  /** Subtrees exempt from the overlay dim (the spotlighted 3D objects). */
  private readonly focusKeep = new Set<THREE.Object3D>();
  /** First-seen opacity per material, so dimming is reversible. */
  private readonly baseOpacities = new Map<THREE.Material, number>();
  /** The pulsing spotlight ring (null until the first spotlight). */
  private spotRing: THREE.Mesh | null = null;
  private spotMat: THREE.MeshBasicMaterial | null = null;
  private spotPos: Vec2 | null = null;
  private spotClock = 0;
  private spotRadius = 1;

  // Fog (§6): a mask in parameter (uv) space — opaque where the terrain is
  // still hidden, erased (destination-out) wherever a measurement walked.
  private fogEnabled = false;
  private fogLift = 0; // 0 = fogged, 1 = fully revealed
  private fogCanvas: HTMLCanvasElement | null = null;
  private fogCtx: CanvasRenderingContext2D | null = null;
  private fogTexture: THREE.CanvasTexture | null = null;
  private fogStampCount = 0;
  /** 1×1 transparent stand-in so the sampler is always valid pre-fog. */
  private readonly fogEmptyTexture = makeEmptyFogTexture();

  /** Continuous auto-orbit speed (deg/s; hero drift). 0 = off. */
  private autoOrbitDegPerSec = 0;
  /**
   * Wheel-zoom mute (intro choreography): while the page is full-bleed the
   * wheel belongs to the reader (it scrolls past the intro), so the view must
   * not zoom. Docked layouts restore it.
   */
  private wheelZoomEnabled = true;

  /**
   * Optional play-time pitch clamp (§7 tilt game): while the ball is live,
   * elevation is clamped tighter than the global [15°, 90°] so the
   * marble-valley framing holds; null restores the free range.
   */
  private elevationClamp: { min: number; max: number } | null = null;

  /**
   * Vertical framing offset in CSS px (+ = framed content sits LOWER on
   * screen). Applied by reframeCamera; the hero uses it to drop the looping
   * race clear of the centered caption. Orthographic projection makes the
   * shift an exact constant pixel offset at every azimuth, so it survives
   * the hero's auto-orbit drift.
   */
  private frameOffsetPx = 0;

  /**
   * Horizontal framing offset in CSS px (+ = framed content sits further
   * RIGHT on screen). The app layout keeps a reader panel docked on the
   * right, so the page applies +panelWidth/2 to re-center the scene in the
   * visible region left of the panel.
   */
  private frameOffsetXPx = 0;

  // Pointer-drag orbit state.
  private dragging = false;
  private dragMoved = false;
  /** True while a captured object-drag (onDragStart returned true) is active. */
  private puppetDrag = false;
  private lastX = 0;
  private lastY = 0;
  /** Every active pointer (QA cam-4): two = pinch, button 2 = dolly drag. */
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;
  private rightDragging = false;
  private rightDragY = 0;

  // Render-on-demand loop.
  private raf = 0;
  private dirty = true;
  private lastFrameTime = 0;
  /** Last size resize() applied (identical ResizeObserver ticks are no-ops). */
  private lastResizeW = -1;
  private lastResizeH = -1;

  /** The current heightmap mesh (for raycast picking). */
  private terrainMesh: THREE.Mesh | null = null;
  /** Grid resolution the CURRENT terrain buffers were allocated for. */
  private terrainGridN = -1;
  /**
   * The terrain shader material — created once and reused across landscape
   * rebuilds (uniform objects and the compiled program survive; a fresh
   * material per slider tick was pure churn). Cloud state (fog binding,
   * focus dim, opacity) is re-applied whenever a new one is built.
   */
  private terrainMaterial: THREE.ShaderMaterial | null = null;
  /** Contour line material (opacity follows terrainOpacity). */
  private contourMat: THREE.ShaderMaterial | null = null;
  private readonly raycaster = new THREE.Raycaster();

  /** Soft radial ground-spot decals under balls / floating arrow tips. */
  private readonly shadowGroup = new THREE.Group();
  private readonly shadowPool: THREE.Mesh[] = [];
  private shadowTex: THREE.CanvasTexture | null = null;

  private readonly resizeObserver: ResizeObserver;

  constructor(container: HTMLElement, opts: Partial<LandscapeViewOptions> = {}) {
    this.container = container;
    this.opts = { gridN: 160, background: MANIM.background, ...opts };
    container.classList.add("lv-root");
    injectViewCss();

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.domElement.classList.add("lv-canvas");
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(this.opts.background);
    this.scene.add(this.terrainGroup, this.overlayGroup);
    // Ground-spot decals live outside terrain/overlay groups: they survive
    // landscape rebuilds and are re-placed by setContactShadows().
    this.shadowGroup.renderOrder = 1;
    this.scene.add(this.shadowGroup);

    // Real lights for standard materials (ball, arrow cones) — the terrain
    // shader bakes the same two-light rig so shading is consistent.
    const key = new THREE.DirectionalLight(0xffd9a8, 1.35); // warm key
    key.position.copy(this.keyDir);
    const fill = new THREE.DirectionalLight(0x7fb0e0, 0.7); // cool fill
    fill.position.copy(this.fillDir);
    const ambient = new THREE.AmbientLight(0xffffff, 0.38);
    this.scene.add(key, fill, ambient);

    this.bindPointer();
    this.injectPresetButtons();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    this.raf = requestAnimationFrame(this.loop);
  }

  /* ---------------- landscape ---------------- */

  /**
   * Rebuilds the terrain (and clears overlays) for a new landscape.
   * `opts.gridN` overrides the mesh resolution for THIS build — the live
   * slider-driven rebuilds (§4/§5) use a lighter grid to stay interactive.
   *
   * When the grid size is unchanged the terrain's GPU buffers and shader
   * material are REUSED: only attribute contents are recomputed and
   * re-uploaded. The §5 slider sweep rebuilds every animation frame —
   * recreating geometry + material per frame showed up as GC churn and
   * driver buffer churn in the framerate sweep (tools/cdp-responsive.mjs).
   */
  setLandscape(fn: Landscape, opts: { gridN?: number } = {}): void {
    if (opts.gridN !== undefined) this.activeGridN = opts.gridN;
    else this.activeGridN = this.opts.gridN;
    this.landscape = fn;
    this.clearOverlays();
    const heights = this.rebuildTerrain();
    this.buildContourLines(heights);
    this.reframeCamera();
    this.requestRender();
  }

  /* ---------------- terrain presentation (§1 materialization) ---------------- */

  /**
   * Terrain relief factor: 1 = full height, 0 = flat parameter plane (the
   * landscape "rises into view" by easing this 0 → 1). Contour lines live in
   * terrainGroup, so they flatten and rise with it.
   */
  setTerrainRise(v: number): void {
    this.terrainRise = clamp(v, 0, 1);
    // scale.y = 0 exactly would produce a zero normal matrix (NaN shading).
    this.terrainGroup.scale.y = Math.max(this.terrainRise, 1e-4);
    this.requestRender();
  }

  /** Terrain + contour opacity multiplier (0 = invisible ghost plane). */
  setTerrainOpacity(v: number): void {
    const k = clamp(v, 0, 1);
    this.terrainOpacity = k;
    const mesh = this.terrainMesh;
    if (mesh) {
      const mat = mesh.material as THREE.ShaderMaterial;
      mat.uniforms.uOpacity.value = k;
    }
    this.applyContourOpacity();
    this.requestRender();
  }

  /**
   * Contour-line reveal multiplier (§6): 0 while the fog game hides the map,
   * eased to 1 by the reveal beat. Combined multiplicatively with the
   * terrain opacity so crossfades keep working.
   */
  setContourReveal(k: number): void {
    this.contourRevealK = clamp(k, 0, 1);
    this.applyContourOpacity();
    this.requestRender();
  }

  private applyContourOpacity(): void {
    if (this.contourMat) {
      this.contourMat.uniforms.uOpacity.value =
        CONTOUR_OPACITY * this.terrainOpacity * this.contourRevealK * this.focusContourDim;
    }
  }

  /* ---------------- hover-to-look: focus dim + spotlight ring ---------------- */

  /**
   * Dims the scene so a spotlighted target reads: terrain and contours recede
   * (color-space dim, not opacity — fog/crossfade still own opacity), and every
   * overlay material fades to `overlay` opacity EXCEPT the kept subtrees (the
   * spotlighted 3D objects) and trail materials (AnimatedTrail self-manages
   * its own focus dim). Pass null to restore the undimmed scene.
   */
  setFocusDim(
    focus: {
      terrain: number;
      overlay: number;
      keep?: readonly THREE.Object3D[] | null;
    } | null,
  ): void {
    this.focusTerrainDim = focus ? Math.min(1, Math.max(0, focus.terrain)) : 1;
    this.focusContourDim = this.focusTerrainDim;
    this.focusOverlayDim = focus ? Math.min(1, Math.max(0, focus.overlay)) : 1;
    this.focusKeep.clear();
    for (const o of focus?.keep ?? []) this.focusKeep.add(o);
    this.applyFocus();
    this.requestRender();
  }

  /** Diagnostics: whether a focus dim is active (dim < 1). */
  get focusActive(): boolean {
    return this.focusOverlayDim < 1 || this.focusTerrainDim < 1;
  }

  /** The learner-ball overlay object (for spotlight "keep" sets); null hidden. */
  get ballObject(): THREE.Object3D | null {
    return this.ball && this.ball.visible ? this.ball : null;
  }

  /** Diagnostics: the learner ball's current material opacity (null hidden). */
  get ballOpacity(): number | null {
    return this.ball && this.ball.visible
      ? (this.ball.material as THREE.MeshLambertMaterial).opacity
      : null;
  }

  /** Diagnostics: whether the spotlight ring is visible. */
  get spotlightActive(): boolean {
    return this.spotRing !== null && this.spotRing.visible;
  }

  private isFocusKept(obj: THREE.Object3D): boolean {
    for (let o: THREE.Object3D | null = obj; o !== null; o = o.parent) {
      if (this.focusKeep.has(o)) return true;
    }
    return false;
  }

  /** Walks overlay + shadow materials and applies the current dim. */
  private applyFocus(): void {
    const mesh = this.terrainMesh;
    if (mesh) {
      (mesh.material as THREE.ShaderMaterial).uniforms.uDim.value = this.focusTerrainDim;
    }
    this.applyContourOpacity();
    const walk = (root: THREE.Object3D): void => {
      root.traverse((node) => {
        const mesh = node as THREE.Mesh;
        const mat = mesh.material as THREE.Material | undefined;
        if (!mat) return;
        const mats = Array.isArray(mat) ? mat : [mat];
        const kept = this.isFocusKept(node);
        for (const m of mats) {
          if (TRAIL_MATERIALS.has(m)) continue; // AnimatedTrail self-manages
          if (!this.baseOpacities.has(m)) this.baseOpacities.set(m, m.opacity);
          const base = this.baseOpacities.get(m) ?? 1;
          m.opacity = kept ? base : base * this.focusOverlayDim;
          m.transparent = true;
        }
      });
    };
    walk(this.overlayGroup);
    walk(this.shadowGroup);
  }

  /**
   * The hover-to-look spotlight ring: a soft additive annulus lying ON the
   * surface at parameter `p`. It swells once on activation (the brief pulse),
   * then breathes gently while visible. Re-place it each frame for moving
   * targets via moveSpotlight().
   */
  spotlightAt(p: Vec2, colorHex: number, radiusFrac: number): void {
    if (!this.spotRing) {
      const geo = new THREE.RingGeometry(0.72, 1, 48);
      this.spotMat = new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      this.spotRing = new THREE.Mesh(geo, this.spotMat);
      this.spotRing.renderOrder = 4;
      this.spotRing.frustumCulled = false;
      this.scene.add(this.spotRing); // outside overlay/terrain: survives rebuilds
    }
    this.spotMat?.color.set(colorHex);
    this.spotRadius = Math.max(radiusFrac, 0.004) * this.diag;
    this.spotPos = { x: p.x, y: p.y };
    this.spotClock = 0;
    this.placeSpot();
    this.spotRing.visible = true;
    this.requestRender();
  }

  /** Moves the ring to a new parameter point (per-frame target tracking). */
  moveSpotlight(p: Vec2): void {
    if (!this.spotPos || !this.spotRing?.visible) return;
    this.spotPos = { x: p.x, y: p.y };
    this.placeSpot();
    this.requestRender();
  }

  clearSpotlight(): void {
    if (this.spotRing && this.spotRing.visible) {
      this.spotRing.visible = false;
      this.spotPos = null;
      this.requestRender();
    }
    this.spotPos = null;
  }

  private placeSpot(): void {
    if (!this.spotRing || !this.spotPos) return;
    this.placeOnSurface(this.spotPos, this.spotRing, this.diag * 0.012);
    this.spotRing.scale.setScalar(this.spotRadius * this.spotPulseScale());
  }

  /** Activation swell (~0.9 s) settling into a gentle steady breathing. */
  private spotPulseScale(): number {
    const t = this.spotClock;
    const swell = 1 + 0.3 * Math.sin(Math.min(1, t / 0.9) * Math.PI);
    const breathe = 1 + 0.045 * Math.sin(t * 3.1);
    return swell * breathe;
  }

  /* ---------------- fog (§6 fog game) ---------------- */

  /** Enables fog sampling (and lifts any previous reveal) or restores the
   *  always-explored default. Resets the contour reveal to 1 when disabled. */
  setFogEnabled(on: boolean): void {
    this.fogEnabled = on;
    const mesh = this.terrainMesh;
    if (mesh) {
      const mat = mesh.material as THREE.ShaderMaterial;
      mat.uniforms.uFog.value = on && this.fogTexture ? this.fogTexture : this.fogEmptyTexture;
      mat.uniforms.uFogLift.value = on ? this.fogLift : 1.0;
    }
    if (!on) {
      this.contourRevealK = 1;
      this.applyContourOpacity();
    }
    this.requestRender();
  }

  /** (Re)creates the mask: fully opaque = everything fogged. Rebinds it. */
  fogReset(): void {
    if (!this.fogCanvas) {
      this.fogCanvas = document.createElement("canvas");
      this.fogCanvas.width = FOG_MASK_SIZE;
      this.fogCanvas.height = FOG_MASK_SIZE;
      this.fogCtx = this.fogCanvas.getContext("2d");
      this.fogTexture = new THREE.CanvasTexture(this.fogCanvas);
      this.fogTexture.wrapS = THREE.ClampToEdgeWrapping;
      this.fogTexture.wrapT = THREE.ClampToEdgeWrapping;
      // CanvasTexture defaults to sRGB color space; only alpha is sampled,
      // but keep the default colorSpace untouched so upload stays a plain copy.
    }
    const ctx = this.fogCtx;
    if (ctx) {
      ctx.globalCompositeOperation = "source-over";
      ctx.clearRect(0, 0, FOG_MASK_SIZE, FOG_MASK_SIZE);
      ctx.fillStyle = "rgba(255,255,255,1)";
      ctx.fillRect(0, 0, FOG_MASK_SIZE, FOG_MASK_SIZE);
    }
    this.fogStampCount = 0;
    if (this.fogTexture) this.fogTexture.needsUpdate = true;
    if (this.fogEnabled) this.setFogEnabled(true); // rebind + requestRender
    this.requestRender();
  }

  /** Parameter point -> mask canvas pixel (uv origin = extent corner; the
   *  CanvasTexture's flipY puts uv v=0 at the canvas BOTTOM). */
  private fogMaskCoords(p: Vec2): { x: number; y: number } | null {
    const fn = this.landscape;
    if (!fn) return null;
    const { xMin, xMax, yMin, yMax } = fn.extent;
    const u = (p.x - xMin) / Math.max(xMax - xMin, 1e-9);
    const v = (p.y - yMin) / Math.max(yMax - yMin, 1e-9);
    return {
      x: clamp(u, 0, 1) * FOG_MASK_SIZE,
      y: (1 - clamp(v, 0, 1)) * FOG_MASK_SIZE,
    };
  }

  /** Erases (destination-out) a soft disc of fog at parameter `p`. */
  fogStampAt(p: Vec2, radiusFrac: number): void {
    const fn = this.landscape;
    const ctx = this.fogCtx;
    if (!fn || !ctx) return;
    const c = this.fogMaskCoords(p);
    if (!c) return;
    const e = fn.extent;
    const diag = Math.hypot(e.xMax - e.xMin, e.yMax - e.yMin);
    const rx = (radiusFrac * diag) / Math.max(e.xMax - e.xMin, 1e-9) * FOG_MASK_SIZE;
    const ry = (radiusFrac * diag) / Math.max(e.yMax - e.yMin, 1e-9) * FOG_MASK_SIZE;
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.translate(c.x, c.y);
    ctx.scale(rx, ry);
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    grad.addColorStop(0, "rgba(0,0,0,1)");
    grad.addColorStop(0.62, "rgba(0,0,0,0.92)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    this.fogStampCount += 1;
    if (this.fogTexture) this.fogTexture.needsUpdate = true;
    this.requestRender();
  }

  /** Stamps along the parameter segment a→b, spaced ~half a stamp radius so
   *  the walk leaves one continuous cleared corridor. */
  fogStampSegment(a: Vec2, b: Vec2, radiusFrac: number): void {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const fn = this.landscape;
    if (!fn) return;
    const e = fn.extent;
    const diag = Math.hypot(e.xMax - e.xMin, e.yMax - e.yMin);
    const radiusParam = radiusFrac * diag;
    const n = Math.max(1, Math.ceil(len / (radiusParam * 0.45)));
    for (let i = 1; i <= n; i++) {
      const k = i / n;
      this.fogStampAt({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }, radiusFrac);
    }
  }

  /** Reveal beat: 0 = fogged, 1 = fully lifted (the mask erases globally). */
  setFogReveal(k: number): void {
    this.fogLift = clamp(k, 0, 1);
    const mesh = this.terrainMesh;
    if (mesh) {
      const mat = mesh.material as THREE.ShaderMaterial;
      mat.uniforms.uFogLift.value = this.fogEnabled ? this.fogLift : 1.0;
    }
    this.requestRender();
  }

  /** Diagnostics: how many fog stamps have been erased since fogReset. */
  get fogStamps(): number {
    return this.fogStampCount;
  }

  /** Continuous camera drift (deg/s around the vertical axis). 0 = off. */
  setAutoOrbit(degPerSec: number): void {
    this.autoOrbitDegPerSec = degPerSec;
  }

  /**
   * Play-time pitch clamp (§7): tighter elevation range while the tilt ball
   * is live; null restores the free [15°, 90°] range. Re-clamps the current
   * attitude immediately so entering play never leaves an illegal pitch.
   */
  setElevationClamp(clampDeg: { min: number; max: number } | null): void {
    this.elevationClamp = clampDeg;
    const lo = (clampDeg?.min ?? 15) * DEG;
    const hi = (clampDeg?.max ?? 90) * DEG;
    const clamped = clamp(this.elevation, lo, hi);
    if (clamped !== this.elevation) {
      this.elevation = clamped;
      this.applyCamera();
      this.requestRender();
    }
  }

  /** Effective elevation limits (the clamp tightens the global range). */
  private elevationLimits(): { lo: number; hi: number } {
    return this.elevationClamp
      ? { lo: this.elevationClamp.min * DEG, hi: this.elevationClamp.max * DEG }
      : { lo: ELEVATION_MIN, hi: ELEVATION_MAX };
  }

  /**
   * Vertical framing offset in CSS px (+ = content sits lower on screen).
   * Set BEFORE setLandscape so reframeCamera applies it (it triggers a
   * reframe itself when a landscape is already built). A target shift along
   * the camera's up axis moves the framed content on screen by exactly that
   * many pixels regardless of azimuth, so the offset holds while orbiting.
   */
  setFrameOffsetY(px: number): void {
    if (px === this.frameOffsetPx) return;
    this.frameOffsetPx = px;
    if (this.landscape) {
      this.reframeCamera();
      this.requestRender();
    }
  }

  /**
   * Horizontal framing offset in CSS px (+ = content sits further RIGHT).
   * Same mechanism as the vertical offset, along the camera's right axis —
   * the app layout docks the reader panel on the right and shifts the scene
   * +panelWidth/2 so it centers in the region left of the panel.
   */
  setFrameOffsetX(px: number): void {
    if (px === this.frameOffsetXPx) return;
    this.frameOffsetXPx = px;
    if (this.landscape) {
      this.reframeCamera();
      this.requestRender();
    }
  }

  /** Diagnostics: the applied horizontal framing offset (CSS px). */
  get frameOffsetX(): number {
    return this.frameOffsetXPx;
  }

  /**
   * Wheel-zoom mute (intro choreography): while the page is full-bleed the
   * wheel scrolls past the intro (the page owns it), so the view must not
   * zoom. Docked layouts restore zoom.
   */
  setWheelZoomEnabled(on: boolean): void {
    this.wheelZoomEnabled = on;
  }

  /**
   * Adds a foreign object (animated trail, race head) to the overlay group.
   * Any LineMaterial found on it is registered so resize keeps its pixel
   * width correct; it is disposed by clearOverlays() on setLandscape, or
   * explicitly via removeOverlayObject().
   */
  addOverlayObject(obj: THREE.Object3D): void {
    obj.traverse((node) => {
      const mat = (node as THREE.Mesh).material as THREE.Material | undefined;
      if (mat instanceof LineMaterial) this.extraResolutionMats.add(mat);
    });
    this.overlayGroup.add(obj);
  }

  /** Removes and disposes an object previously added via addOverlayObject. */
  removeOverlayObject(obj: THREE.Object3D): void {
    obj.traverse((node) => {
      const mat = (node as THREE.Mesh).material as THREE.Material | undefined;
      if (mat instanceof LineMaterial) this.extraResolutionMats.delete(mat);
    });
    this.overlayGroup.remove(obj);
    disposeDeep(obj);
  }

  /* ---------------- picking (parameter-space drag on the surface) ---------------- */

  /** Sets up the internal raycaster for a client-space pointer position. */
  rayFromClient(clientX: number, clientY: number): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(((clientY - rect.top) / rect.height) * 2 - 1),
    );
    this.raycaster.setFromCamera(ndc, this.camera);
  }

  /**
   * Maps a pointer position to the parameter plane: raycast onto the terrain
   * mesh when relief is up, otherwise onto the flat plane at world y = 0.
   * Result is clamped into the landscape extent; null when there is no
   * landscape or the ray misses entirely.
   */
  pickParameter(clientX: number, clientY: number): Vec2 | null {
    const fn = this.landscape;
    if (!fn) return null;
    this.rayFromClient(clientX, clientY);

    let hit: Vec2 | null = null;
    if (this.terrainRise > 0.05 && this.terrainMesh) {
      const hits = this.raycaster.intersectObject(this.terrainMesh, false);
      if (hits.length > 0) {
        const p = hits[0].point;
        hit = this.worldToParameter(p);
      }
    }
    if (!hit) {
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const out = new THREE.Vector3();
      if (this.raycaster.ray.intersectPlane(plane, out)) {
        hit = this.worldToParameter(out);
      }
    }
    if (!hit) return null;

    const { xMin, xMax, yMin, yMax } = fn.extent;
    return {
      x: clamp(hit.x, xMin, xMax),
      y: clamp(hit.y, yMin, yMax),
    };
  }

  /** Screen distance (px) from a pointer to the learner-ball center at `p`. */
  screenDistanceToParam(p: Vec2, clientX: number, clientY: number): number | null {
    const s = this.projectParamToScreen(p);
    if (!s) return null;
    return Math.hypot(clientX - s.x, clientY - s.y);
  }

  /** Client-space screen position of the learner-ball center at `p`. */
  projectParamToScreen(p: Vec2): { x: number; y: number } | null {
    const fn = this.landscape;
    if (!fn) return null;
    const world = this.ballCenter(fn, p, new THREE.Vector3());
    const v = world.project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + ((v.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - v.y) / 2) * rect.height,
    };
  }

  /** Parameter point -> world point on the (rise-scaled) surface. */
  parameterToWorld(p: Vec2, lift = 0, out = new THREE.Vector3()): THREE.Vector3 {
    const fn = this.landscape;
    if (!fn) return out;
    return this.surfacePoint(fn, p, out, lift);
  }

  /** Standard hover height above the surface for trails (avoids z-fighting). */
  get trailLift(): number {
    return this.diag * 0.008;
  }

  /** Horizontal diagonal of the current landscape's extent (world units). */
  get diagonal(): number {
    return this.diag;
  }

  /** Current renderer canvas size in CSS pixels. */
  get canvasSize(): THREE.Vector2 {
    const size = new THREE.Vector2();
    this.renderer.getSize(size);
    return size;
  }

  /**
   * Samples the landscape on a (n+1)² grid and fills the mesh. Returns the
   * height sample so the contour pass can reuse it (it used to re-sample
   * every vertex — half the rebuild's f() evaluations were redundant).
   * When the grid size matches the existing terrain, the GPU buffers and the
   * shader material are reused: only contents are rewritten + re-uploaded.
   */
  private rebuildTerrain(): Float64Array {
    const fn = this.landscape;
    if (!fn) return new Float64Array(0);
    const n = this.activeGridN;
    const size = n + 1;
    const { xMin, xMax, yMin, yMax } = fn.extent;
    const dx = (xMax - xMin) / n;
    const dy = (yMax - yMin) / n;
    const cx = (xMin + xMax) / 2;
    const cy = (yMin + yMax) / 2;

    // Sample heights, track range (deterministic — no randomness anywhere).
    const heights = new Float64Array(size * size);
    let hMin = Infinity;
    let hMax = -Infinity;
    for (let j = 0; j < size; j++) {
      const py = yMin + j * dy;
      for (let i = 0; i < size; i++) {
        const h = fn.f({ x: xMin + i * dx, y: py });
        heights[j * size + i] = h;
        if (h < hMin) hMin = h;
        if (h > hMax) hMax = h;
      }
    }
    this.hMin = hMin;
    this.hRange = Math.max(hMax - hMin, 1e-9);
    this.diag = Math.hypot(xMax - xMin, yMax - yMin);
    this.heightWorld = HEIGHT_FRACTION * ((xMax - xMin) + (yMax - yMin)) / 2;
    const hScale = this.heightWorld / this.hRange; // world-y per unit loss

    // d3-scale Viridis sampled by normalized height (sqrt spread so valleys
    // keep a readable band of the ramp on high-dynamic-range landscapes).
    const viridis = scaleSequential(interpolateViridis);
    const colorScratch = new THREE.Color();

    const count = size * size;
    // Reuse the GPU buffers when the grid resolution is unchanged (the §5
    // slider rebuilds every frame at a fixed light grid — reallocating
    // ~135 kB of typed arrays + a BufferGeometry + a ShaderMaterial per
    // frame was the sweep's biggest churn source).
    const reuse = this.terrainMesh !== null && this.terrainGridN === n;
    let positions: Float32Array;
    let normals: Float32Array;
    let colors: Float32Array;
    let glows: Float32Array;
    let heightAttr: Float32Array;
    let uvs: Float32Array;
    let geo: THREE.BufferGeometry;
    if (reuse) {
      geo = this.terrainMesh!.geometry as THREE.BufferGeometry;
      positions = geo.getAttribute("position").array as Float32Array;
      normals = geo.getAttribute("normal").array as Float32Array;
      colors = geo.getAttribute("aColor").array as Float32Array;
      glows = geo.getAttribute("aGlow").array as Float32Array;
      heightAttr = geo.getAttribute("aHeight").array as Float32Array;
      uvs = geo.getAttribute("aUv").array as Float32Array;
    } else {
      this.clearTerrain();
      positions = new Float32Array(count * 3);
      normals = new Float32Array(count * 3);
      colors = new Float32Array(count * 3);
      glows = new Float32Array(count);
      heightAttr = new Float32Array(count); // normalized 0..1 for the shader
      uvs = new Float32Array(count * 2);
      geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
      geo.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
      geo.setAttribute("aGlow", new THREE.BufferAttribute(glows, 1));
      geo.setAttribute("aHeight", new THREE.BufferAttribute(heightAttr, 1));
      geo.setAttribute("aUv", new THREE.BufferAttribute(uvs, 2));
    }

    const spanX = Math.max(xMax - xMin, 1e-9);
    const spanY = Math.max(yMax - yMin, 1e-9);

    for (let j = 0; j < size; j++) {
      const py = yMin + j * dy;
      for (let i = 0; i < size; i++) {
        const px = xMin + i * dx;
        const idx = j * size + i;
        const t = clamp((heights[idx] - hMin) / this.hRange, 0, 1);
        const tc = Math.sqrt(t);

        // World position under the fixed project mapping.
        positions[idx * 3 + 0] = px - cx;
        positions[idx * 3 + 1] = t * this.heightWorld;
        positions[idx * 3 + 2] = -(py - cy);

        // Parameter-space uv (the §6 fog mask samples this).
        uvs[idx * 2 + 0] = (px - xMin) / spanX;
        uvs[idx * 2 + 1] = (py - yMin) / spanY;

        // Analytic surface normal: surface is (px, f, −py), so with the
        // vertical scale folded in, n ∝ (−fx·s, 1, +fy·s).
        const g = fn.grad({ x: px, y: py });
        const nx = -g.x * hScale;
        const nz = g.y * hScale;
        const len = Math.hypot(nx, 1, nz);
        normals[idx * 3 + 0] = nx / len;
        normals[idx * 3 + 1] = 1 / len;
        normals[idx * 3 + 2] = nz / len;

        colorScratch.setStyle(viridis(tc)); // sRGB parsed -> linear working
        colors[idx * 3 + 0] = colorScratch.r;
        colors[idx * 3 + 1] = colorScratch.g;
        colors[idx * 3 + 2] = colorScratch.b;

        // Valley floors glow deep blue; the glow dies out by mid-heights.
        glows[idx] = Math.pow(1 - tc, 2.2);
        heightAttr[idx] = t;
      }
    }

    if (!reuse) {
      const indices = new Uint32Array(n * n * 6);
      let k = 0;
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const a = j * size + i;
          const b = a + 1;
          const c = a + size;
          const d = c + 1;
          // CCW seen from above (+y): a→b is +x, a→c is −z (py grows downward
          // in world z), so (a,b,c) / (b,d,c) wind front faces up.
          indices[k++] = a; indices[k++] = b; indices[k++] = c;
          indices[k++] = b; indices[k++] = d; indices[k++] = c;
        }
      }
      geo.setIndex(new THREE.BufferAttribute(indices, 1));

      if (!this.terrainMaterial) this.terrainMaterial = this.makeTerrainMaterial();
      this.applyFogUniforms();
      const mesh = new THREE.Mesh(geo, this.terrainMaterial);
      mesh.frustumCulled = false;
      this.terrainMesh = mesh;
      this.terrainGridN = n;
      this.terrainGroup.add(mesh);
    }

    // Contents changed: re-upload. The bounding sphere is irrelevant (the
    // mesh is frustumCulled) and the index topology is grid-invariant.
    for (const name of ["position", "normal", "aColor", "aGlow", "aHeight", "aUv"]) {
      geo.getAttribute(name).needsUpdate = true;
    }
    return heights;
  }

  /** Re-applies the current fog binding to the (possibly fresh) material. */
  private applyFogUniforms(): void {
    const mesh = this.terrainMesh;
    if (!mesh) return;
    const mat = mesh.material as THREE.ShaderMaterial;
    mat.uniforms.uFog.value =
      this.fogEnabled && this.fogTexture ? this.fogTexture : this.fogEmptyTexture;
    mat.uniforms.uFogLift.value = this.fogEnabled ? this.fogLift : 1.0;
    mat.uniforms.uDim.value = this.focusTerrainDim;
    mat.uniforms.uOpacity.value = this.terrainOpacity;
  }

  /** Manim-grade terrain shader: warm key + cool fill, height-gated sheen
   *  (valleys matte, ridges catch a soft highlight), soft valley-floor
   *  darkening, per-vertex valley glow. §6 fog: the uv-space mask's alpha
   *  fogs fragments to nothing — unexplored terrain renders as dark void;
   *  uFogLift (the reveal beat) erases the mask globally with an eased 0→1. */
  private makeTerrainMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
        uniforms: {
          uKeyDir: { value: this.keyDir.clone() },
          uKeyColor: { value: new THREE.Color(0xffd9a8) }, // warm key
          uFillDir: { value: this.fillDir.clone() },
          uFillColor: { value: new THREE.Color(0x7fb0e0) }, // cool fill
          uAmbient: { value: 0.34 },
          uViewDir: { value: this.viewDir },
          uSheenColor: { value: new THREE.Color(0xffe6bf) },
          uSheenK: { value: 0.22 },
          uSheenPow: { value: 7.0 },
          uGlowColor: { value: new THREE.Color(0x2b4fd0) }, // deep indigo-blue
          uGlowStrength: { value: 0.6 },
          uOpacity: { value: this.terrainOpacity },
          uDim: { value: this.focusTerrainDim }, // hover-to-look scene dim
          uFog: { value: this.fogEmptyTexture },
          uFogLift: { value: 1.0 }, // 1 = fog fully lifted (default, no fog)
        },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aGlow;
        attribute float aHeight;
        attribute vec2 aUv;
        varying vec3 vAlbedo;
        varying float vGlow;
        varying float vHeight;
        varying vec3 vNormalW;
        varying vec2 vUv;
        void main() {
          vAlbedo = aColor;
          vGlow = aGlow;
          vHeight = aHeight;
          vUv = aUv;
          vNormalW = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uKeyDir;
        uniform vec3 uKeyColor;
        uniform vec3 uFillDir;
        uniform vec3 uFillColor;
        uniform float uAmbient;
        uniform vec3 uViewDir;
        uniform vec3 uSheenColor;
        uniform float uSheenK;
        uniform float uSheenPow;
          uniform vec3 uGlowColor;
          uniform float uGlowStrength;
          uniform float uOpacity;
          uniform float uDim;
          uniform sampler2D uFog;
          uniform float uFogLift;
        varying vec3 vAlbedo;
        varying float vGlow;
        varying float vHeight;
        varying vec3 vNormalW;
        varying vec2 vUv;
        void main() {
          // Two-sided like a Manim surface: the bowl's near wall is seen from
          // outside, so flip the shading normal on back faces.
          vec3 N = normalize(vNormalW);
          if (!gl_FrontFacing) N = -N;
          // Warm key (strict Lambert — this is what sculpts the ridges) plus
          // a low cool fill from the far side so away faces stay readable.
          float key = max(dot(N, uKeyDir), 0.0);
          float fill = max(dot(N, uFillDir), 0.0);
          // Deep, soft valley-floor darkening (a fake ambient occlusion that
          // bottoms out well before the glow takes over).
          float ao = mix(0.55, 1.0, smoothstep(0.0, 0.5, vHeight));
          vec3 lit = uKeyColor * (key * 0.95)
            + uFillColor * (fill * 0.4)
            + vec3(uAmbient);
          vec3 col = vAlbedo * lit * ao;
          // Height-gated sheen: matte in the valleys, a soft warm highlight
          // where the slopes rise to catch the key light. Broad exponent —
          // a sheen, not a specular.
          vec3 H = normalize(uKeyDir + normalize(uViewDir));
          float sheen = pow(max(dot(N, H), 0.0), uSheenPow)
            * uSheenK * smoothstep(0.22, 0.85, vHeight);
          col += uSheenColor * sheen;
          col += uGlowColor * (vGlow * uGlowStrength);
          // Hover-to-look scene dim: everything un-spotlighted recedes.
          col *= uDim;
          // Fog mask: opaque alpha = unexplored void. The reveal beat eases
          // uFogLift 0→1, which lifts the whole mask at once.
          float explored = 1.0 - texture2D(uFog, vUv).a * (1.0 - uFogLift);
          gl_FragColor = vec4(col, uOpacity * explored);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      side: THREE.DoubleSide,
      transparent: true,
    });
  }

  /* ---------------- contours ---------------- */

  /**
   * d3-contour isolines computed in parameter space, lifted onto the surface.
   * Verified against the d3-contour docs/source: ring coordinate ⟨gx, gy⟩
   * corresponds to grid sample ⟨gx − 0.5, gy − 0.5⟩. Rings bound the region
   * {f ≥ level}, so where the region is clipped by the domain the ring runs
   * along (or rounds into) the border — segments touching the border are
   * dropped, leaving the pure isoline.
   *
   * `heights` is the grid rebuildTerrain() just sampled (same resolution and
   * loop order) — re-sampling every vertex here doubled the rebuild's f()
   * cost for no new information.
   */
  private buildContourLines(heights: Float64Array): void {
    const fn = this.landscape;
    const mesh = this.terrainGroup.children[0] as THREE.Mesh | undefined;
    if (!fn || !mesh) return;

    const n = this.activeGridN;
    const size = n + 1;
    const { xMin, xMax, yMin, yMax } = fn.extent;
    const dx = (xMax - xMin) / n;
    const dy = (yMax - yMin) / n;
    const cx = (xMin + xMax) / 2;
    const cy = (yMin + yMax) / 2;

    const levels: number[] = [];
    for (let i = 1; i <= CONTOUR_LEVELS; i++) {
      levels.push(this.hMin + (this.hRange * i) / (CONTOUR_LEVELS + 1));
    }
    // d3-contour accepts any array-like (it only indexes + reads .length);
    // the typed grid passes straight through without an Array copy.
    const polys = contourGrid().size([size, size]).thresholds(levels)(
      heights as unknown as number[],
    );

    const borderEps = 1e-6;
    const pts: number[] = [];
    const nrmAttr: number[] = [];
    const hAttr: number[] = [];
    const scratch = new THREE.Vector3();
    const nrm = new THREE.Vector3();
    const lift = this.diag * 0.004;

    // Position + surface normal + normalized height for one contour point.
    const worldAt = (
      gx: number,
      gy: number,
      out: THREE.Vector3,
    ): { n: THREE.Vector3; h: number } => {
      const px = xMin + (gx - 0.5) * dx;
      const py = yMin + (gy - 0.5) * dy;
      const t = clamp((fn.f({ x: px, y: py }) - this.hMin) / this.hRange, 0, 1);
      out.set(px - cx, t * this.heightWorld, -(py - cy));
      this.surfaceNormal(fn, { x: px, y: py }, nrm);
      return { n: nrm, h: t };
    };
    const onBorder = (v: number, span: number): boolean =>
      Math.abs(v - 0) < borderEps || Math.abs(v - span) < borderEps;

    // GeoJSON nesting: MultiPolygon.coordinates = polygons[] → rings[] →
    // positions[]. Holes are drawn too — around peaks they are real isolines.
    for (const poly of polys) {
      for (const polygon of poly.coordinates) {
        for (const ring of polygon) {
          for (let i = 0; i < ring.length - 1; i++) {
            const a = ring[i];
            const b = ring[i + 1];
            if (
              (onBorder(a[0], size) || onBorder(a[1], size)) &&
              (onBorder(b[0], size) || onBorder(b[1], size))
            ) {
              continue;
            }
            const pa = worldAt(a[0], a[1], scratch);
            pts.push(
              scratch.x + pa.n.x * lift,
              scratch.y + pa.n.y * lift,
              scratch.z + pa.n.z * lift,
            );
            nrmAttr.push(pa.n.x, pa.n.y, pa.n.z);
            hAttr.push(pa.h);
            const pb = worldAt(b[0], b[1], scratch);
            pts.push(
              scratch.x + pb.n.x * lift,
              scratch.y + pb.n.y * lift,
              scratch.z + pb.n.z * lift,
            );
            nrmAttr.push(pb.n.x, pb.n.y, pb.n.z);
            hAttr.push(pb.h);
          }
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    geo.setAttribute("aNrm", new THREE.Float32BufferAttribute(nrmAttr, 3));
    geo.setAttribute("aH", new THREE.Float32BufferAttribute(hAttr, 1));
    // Grazing-angle fade kills the moiré banding where isolines run along a
    // silhouette (e.g. the bowl rim); the height curve keeps them strongest
    // in the readable mid/low band and quiets them on bright peaks.
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uViewDir: { value: this.viewDir },
        uColor: { value: new THREE.Color(0xffffff) },
        uOpacity: {
          value:
            CONTOUR_OPACITY * this.terrainOpacity * this.contourRevealK *
            this.focusContourDim,
        },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aNrm;
        attribute float aH;
        varying vec3 vN;
        varying float vH;
        void main() {
          vN = aNrm;
          vH = aH;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uViewDir;
        uniform vec3 uColor;
        uniform float uOpacity;
        varying vec3 vN;
        varying float vH;
        void main() {
          // Fade toward silhouettes (|N·V| -> 0); abs() so lines on the far
          // side of the sheet keep their fade behaviour too.
          float graze = smoothstep(0.10, 0.32, abs(dot(normalize(vN), normalize(uViewDir))));
          // Refined opacity curve: strongest in the low/mid band, quieter on
          // the bright peaks where white-on-yellow just adds noise.
          float curve = mix(1.25, 0.7, smoothstep(0.2, 0.85, vH));
          float a = uOpacity * graze * curve;
          gl_FragColor = vec4(uColor * a, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.contourMat = mat;
    const lines = new THREE.LineSegments(geo, mat);
    lines.renderOrder = 1;
    this.terrainGroup.add(lines);
  }

  /* ---------------- overlays ---------------- */

  /**
   * Adds an optimizer trail: the path is lifted onto the surface and rendered
   * as a fat additive line whose color fades with distance back from the
   * newest point (soft glow, no bloom).
   */
  addTrail(
    points: readonly Vec2[],
    colorHex: number,
    opts: { widthPx?: number; fadePower?: number } = {},
  ): void {
    const fn = this.landscape;
    if (!fn || points.length < 2) return;
    const widthPx = opts.widthPx ?? 2.2;
    const fadePower = opts.fadePower ?? 1.6;
    const base = new THREE.Color(colorHex);

    const positions: number[] = [];
    const colors: number[] = [];
    const p = new THREE.Vector3();
    const lift = this.diag * 0.008;

    for (let i = 0; i < points.length; i++) {
      this.surfacePoint(fn, points[i], p, lift);
      positions.push(p.x, p.y, p.z);
      const t = i / (points.length - 1); // 0 = oldest, 1 = newest
      // Brightness cap at 0.85: additive strokes over the brighter graded
      // terrain must glow, not bloom to white where trails overlap.
      const k = (0.1 + 0.9 * Math.pow(t, fadePower)) * 0.85;
      colors.push(base.r * k, base.g * k, base.b * k);
    }

    const geo = new LineGeometry();
    geo.setPositions(positions);
    geo.setColors(colors);

    const size = new THREE.Vector2();
    this.renderer.getSize(size);
    const mat = new LineMaterial({
      vertexColors: true,
      worldUnits: false,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      resolution: new THREE.Vector2(size.x, size.y),
    });
    // `linewidth` exists on LineMaterial (three source sets/gets it) but is
    // missing from @types/three 0.186 — assign through a narrow cast.
    (mat as unknown as { linewidth: number }).linewidth = widthPx;

    const line = new Line2(geo, mat);
    line.computeLineDistances();
    line.renderOrder = 2;
    this.overlayGroup.add(line);
    this.trails.push(line);
  }

  /**
   * Adds a 3D step arrow at a parameter-space position. The shaft HUGS the
   * surface — the parameter-space segment is sampled and lifted onto the
   * terrain (like the trails) — and a flat triangular head sits in the
   * surface tangent plane at the tip. Hugging is the point: a straight
   * tangent arrow submerges under any curved sheet, which buried shafts
   * mid-span and left heads floating free of them (visual verdicts n2-1/n2-2).
   * `opts.length` = world length along the horizontal (param) direction
   * (default: a fixed extent fraction — §2/§4 pass actual step magnitudes so
   * arrows stay truthful). Returns the arrow group so callers can remove it
   * again via removeOverlayObject().
   */
  addArrow(
    pos: Vec2,
    dir: Vec2,
    colorHex: number,
    opts: { length?: number } = {},
  ): THREE.Object3D | null {
    const fn = this.landscape;
    if (!fn) return null;
    const dlen = Math.hypot(dir.x, dir.y);
    if (dlen < 1e-9) return null;
    const len = Math.max(opts.length ?? this.diag * 0.09, this.diag * 0.02);
    const ux = dir.x / dlen;
    const uy = dir.y / dlen;
    const lift = this.diag * 0.01;

    // Shaft: sample the param segment and lift each sample onto the surface.
    // The sample START is pushed past the learner ball's rim (radius
    // diag·0.02 + glow margin) so the shaft visibly emerges from the ball
    // instead of vanishing inside it.
    const STEPS = 24;
    const startT = Math.min(this.diag * 0.03, len * 0.45);
    const positions: number[] = [];
    const p = new THREE.Vector3();
    for (let i = 0; i <= STEPS; i++) {
      const t = startT + (i / STEPS) * (len - startT);
      this.surfacePoint(fn, { x: pos.x + ux * t, y: pos.y + uy * t }, p, lift);
      positions.push(p.x, p.y, p.z);
    }
    const shaftGeo = new LineGeometry();
    shaftGeo.setPositions(positions);
    const size = new THREE.Vector2();
    this.renderer.getSize(size);
    const shaftMat = new LineMaterial({
      color: colorHex,
      worldUnits: false,
      transparent: true,
      depthWrite: false,
      resolution: new THREE.Vector2(size.x, size.y),
    });
    // `linewidth` exists on LineMaterial (three source sets/gets it) but is
    // missing from @types/three 0.186 — assign through a narrow cast.
    (shaftMat as unknown as { linewidth: number }).linewidth = 2.2;
    const shaft = new Line2(shaftGeo, shaftMat);
    shaft.computeLineDistances();
    shaft.frustumCulled = false;
    shaft.renderOrder = 3;

    // Head: a flat triangle in the tangent plane at the tip, pointing along
    // the shaft's final in-surface direction (clean Manim-style triangle;
    // length/width fractions unchanged from the previous arrow).
    const tipParam: Vec2 = { x: pos.x + ux * len, y: pos.y + uy * len };
    const tip = this.surfacePoint(fn, tipParam, new THREE.Vector3(), lift);
    const nrm = this.surfaceNormal(fn, tipParam, new THREE.Vector3());
    const along = new THREE.Vector3(ux, 0, -uy);
    along.addScaledVector(nrm, -along.dot(nrm)).normalize();
    const side = new THREE.Vector3().crossVectors(nrm, along).normalize();
    const hLen = len * 0.32;
    const hWidth = len * 0.14;
    const base = tip.clone().addScaledVector(along, -hLen);
    const headGeo = new THREE.BufferGeometry();
    headGeo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        [tip.x, tip.y, tip.z, base.x + side.x * hWidth, base.y + side.y * hWidth, base.z + side.z * hWidth, base.x - side.x * hWidth, base.y - side.y * hWidth, base.z - side.z * hWidth],
        3,
      ),
    );
    const head = new THREE.Mesh(
      headGeo,
      new THREE.MeshBasicMaterial({ color: colorHex, side: THREE.DoubleSide }),
    );
    head.renderOrder = 3;

    const group = new THREE.Group();
    group.add(shaft, head);

    // In-place update closure: callers that re-draw the same arrow every
    // frame (the §2 step-arrow grow, minimap drag previews) mutate the
    // buffers instead of disposing + recreating the whole group.
    const updateArrow = (pos: Vec2, dir: Vec2, length?: number): void => {
      const fnL = this.landscape;
      if (!fnL) return;
      const dlenL = Math.hypot(dir.x, dir.y);
      if (dlenL < 1e-9) return;
      const lenL = Math.max(length ?? this.diag * 0.09, this.diag * 0.02);
      const uxL = dir.x / dlenL;
      const uyL = dir.y / dlenL;
      const posL: number[] = [];
      const pL = new THREE.Vector3();
      for (let i = 0; i <= STEPS; i++) {
        const tL = startT + (i / STEPS) * (lenL - startT);
        this.surfacePoint(fnL, { x: pos.x + uxL * tL, y: pos.y + uyL * tL }, pL, lift);
        posL.push(pL.x, pL.y, pL.z);
      }
      shaftGeo.setPositions(posL);
      shaft.computeLineDistances();
      const tipParamL: Vec2 = { x: pos.x + uxL * lenL, y: pos.y + uyL * lenL };
      const tipL = this.surfacePoint(fnL, tipParamL, new THREE.Vector3(), lift);
      const nrmL = this.surfaceNormal(fnL, tipParamL, new THREE.Vector3());
      const alongL = new THREE.Vector3(uxL, 0, -uyL);
      alongL.addScaledVector(nrmL, -alongL.dot(nrmL)).normalize();
      const sideL = new THREE.Vector3().crossVectors(nrmL, alongL).normalize();
      const hLenL = lenL * 0.32;
      const hWidthL = lenL * 0.14;
      const baseL = tipL.clone().addScaledVector(alongL, -hLenL);
      const headAttr = headGeo.getAttribute("position") as THREE.BufferAttribute;
      headAttr.setXYZ(0, tipL.x, tipL.y, tipL.z);
      headAttr.setXYZ(
        1,
        baseL.x + sideL.x * hWidthL,
        baseL.y + sideL.y * hWidthL,
        baseL.z + sideL.z * hWidthL,
      );
      headAttr.setXYZ(
        2,
        baseL.x - sideL.x * hWidthL,
        baseL.y - sideL.y * hWidthL,
        baseL.z - sideL.z * hWidthL,
      );
      headAttr.needsUpdate = true;
    };
    group.userData.update = updateArrow;

    this.overlayGroup.add(group);
    return group;
  }

  /** Places the learner ball on the surface (null hides it). */
  setBall(pos: Vec2 | null, colorHex: number = MANIM.white): void {
    const fn = this.landscape;
    if (!fn || !pos) {
      if (this.ball) this.ball.visible = false;
      return;
    }
    if (!this.ball) {
      const r = this.diag * 0.02;
      const geo = new THREE.SphereGeometry(1, 32, 24);
      const mat = new THREE.MeshLambertMaterial({
        color: colorHex,
        emissive: new THREE.Color(colorHex).multiplyScalar(0.28),
      });
      this.ball = new THREE.Mesh(geo, mat);
      this.ball.scale.setScalar(r);
      this.overlayGroup.add(this.ball);
    }
    const mat = this.ball.material as THREE.MeshLambertMaterial;
    mat.color.set(colorHex);
    mat.emissive.set(colorHex).multiplyScalar(0.28);
    this.ball.scale.setScalar(this.diag * 0.02);
    this.ball.position.copy(this.ballCenter(fn, pos, this.ball.position));
    this.ball.visible = true;
  }

  /**
   * Normalized surface height (0 = valley floor, 1 = highest sample) at a
   * parameter point — the contact-shadow fade/scale driver.
   */
  heightFrac(p: Vec2): number {
    const fn = this.landscape;
    if (!fn) return 0;
    return clamp((fn.f(p) - this.hMin) / this.hRange, 0, 1);
  }

  /**
   * Soft radial ground-spot decals ("the ball is HERE" depth anchors).
   * Each decal lies ON the surface under its parameter position, oriented
   * to the surface normal; radius is a fraction of the extent diagonal and
   * opacity 0..1. The list REPLACES all decals (empty = clear).
   */
  setContactShadows(
    list: Array<{ pos: Vec2; radiusFrac: number; opacity: number }>,
  ): void {
    while (this.shadowPool.length < list.length) {
      const mesh = new THREE.Mesh(
        new THREE.CircleGeometry(1, 28),
        new THREE.MeshBasicMaterial({
          map: this.shadowTexture(),
          transparent: true,
          depthWrite: false,
        }),
      );
      mesh.renderOrder = 1; // above the terrain, below trails
      this.shadowPool.push(mesh);
      this.shadowGroup.add(mesh);
    }
    this.shadowPool.forEach((mesh, i) => {
      const d = list[i];
      const fn = this.landscape;
      if (!d || !fn) {
        mesh.visible = false;
        return;
      }
      mesh.visible = true;
      mesh.scale.setScalar(this.diag * Math.max(d.radiusFrac, 0.004));
      const n = this.surfaceNormal(fn, d.pos, new THREE.Vector3());
      this.surfacePoint(fn, d.pos, mesh.position, this.diag * 0.005);
      mesh.position.addScaledVector(n, this.diag * 0.0015);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
      (mesh.material as THREE.MeshBasicMaterial).opacity = clamp(d.opacity, 0, 1);
    });
  }

  /**
   * Positions AND orients an object to lie ON the surface at parameter `p`
   * (surface-aligned disc placement — §7's measurement stamps). `lift`
   * raises it a hair to avoid z-fighting.
   */
  placeOnSurface(p: Vec2, obj: THREE.Object3D, lift = this.diag * 0.004): void {
    const fn = this.landscape;
    if (!fn) return;
    const n = this.surfaceNormal(fn, p, new THREE.Vector3());
    this.surfacePoint(fn, p, obj.position, lift);
    obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
  }

  /** The shared soft radial texture (dark center fading to transparent). */
  private shadowTexture(): THREE.CanvasTexture {    if (!this.shadowTex) {
      const c = document.createElement("canvas");
      c.width = 128;
      c.height = 128;
      const g = c.getContext("2d")!;
      const grad = g.createRadialGradient(64, 64, 5, 64, 64, 64);
      // Slightly deeper against the two-light grade: the shadow must still
      // anchor the ball on lit terrain, without going hard-edged.
      grad.addColorStop(0, "rgba(0,0,0,0.95)");
      grad.addColorStop(0.5, "rgba(0,0,0,0.45)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 128);
      this.shadowTex = new THREE.CanvasTexture(c);
    }
    return this.shadowTex;
  }

  /* ---------------- camera rig ---------------- */

  setPreset(preset: CameraPreset): void {
    if (preset === "iso") {
      this.azimuth = ISO_AZIMUTH;
      this.elevation = ISO_ELEVATION;
    } else {
      this.azimuth = MAP_AZIMUTH;
      this.elevation = MAP_ELEVATION;
    }
    // Presets respect the same elevation clamp as drag (QA cam-2): during a
    // live §7 tilt run Map view must not snap past the play-time pitch cap.
    const { lo, hi } = this.elevationLimits();
    this.elevation = clamp(this.elevation, lo, hi);
    this.preset = preset; // double-click reset target
    this.azimVel = 0; // a directed attitude ends any glide
    this.elevVel = 0;
    this.applyCamera();
    this.requestRender();
    this.markPresetButtons(preset);
    this.opts.onCameraPreset?.(preset);
  }

  /**
   * Choreographed camera attitude (§2 scene directing). Bypasses the preset
   * buttons; elevation clamps to [15°, 90°] so scenes may go lower than the
   * default isometric. Absolute zoomRadius optional.
   */
  setAttitude(azimuthDeg: number, elevationDeg: number, zoomRadius?: number): void {
    this.azimuth = azimuthDeg * DEG;
    const { lo, hi } = this.elevationLimits();
    this.elevation = clamp(elevationDeg * DEG, lo, hi);
    if (zoomRadius !== undefined) {
      this.zoomRadius = clamp(zoomRadius, this.zoomMin, this.zoomMax);
      this.zoomTarget = this.zoomRadius; // directed zoom must not ease away
    }
    this.azimVel = 0; // choreography, not a flick
    this.elevVel = 0;
    this.applyCamera();
    this.requestRender();
  }

  /** The current landscape's reframe fit zoom (set by reframeCamera). */
  get fitZoom(): number {
    return this.fitZoomRadius;
  }

  /** Live attitude readout (degrees) for inspector UIs. */
  get attitude(): CameraAttitude {
    return {
      azimuthDeg: this.azimuth / DEG,
      elevationDeg: this.elevation / DEG,
      zoomRadius: this.zoomRadius,
    };
  }

  /**
   * Refit target/zoom for the current landscape at the CURRENT attitude:
   * project the terrain bounding box through the ortho camera, center the
   * projected bounds on screen (by shifting the target along the camera's
   * screen axes), and size the frustum around them with margin.
   */
  private reframeCamera(): void {
    const fn = this.landscape;
    if (!fn) return;
    this.camDistance = this.diag * 3;
    this.camera.near = this.diag * 0.01;
    this.camera.far = this.diag * 10;
    this.target.set(0, this.heightWorld * 0.4, 0);
    this.applyCamera();
    this.camera.updateMatrixWorld(); // matrixWorld is otherwise set on render

    const hx = (fn.extent.xMax - fn.extent.xMin) / 2;
    const hz = (fn.extent.yMax - fn.extent.yMin) / 2;
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const cy of [0, this.heightWorld]) {
      for (const sx of [-hx, hx]) {
        for (const sz of [-hz, hz]) {
          const rel = new THREE.Vector3(sx, cy, sz).sub(this.target);
          const px = rel.dot(right);
          const py = rel.dot(up);
          minX = Math.min(minX, px); maxX = Math.max(maxX, px);
          minY = Math.min(minY, py); maxY = Math.max(maxY, py);
        }
      }
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    this.target.addScaledVector(right, cx).addScaledVector(up, cy);

    const fit = Math.max(maxX - minX, maxY - minY) / 2 * 1.14
      / Math.min(1, this.aspect());
    this.zoomRadius = fit;
    this.zoomTarget = fit; // reframe is absolute — the ease has nothing to do
    this.fitZoomRadius = fit;
    this.zoomMin = fit * 0.18;
    this.zoomMax = fit * 3.2;
    this.applyCamera();

    // Screen-space vertical framing offset: move the target along the
    // camera's up axis by offsetPx · world-per-px, so the framed content
    // lands offsetPx lower on screen. Frustum height is 2·zoomRadius mapped
    // over the container height. The up column read here comes from the
    // matrix built after the applyCamera() above; a target shift never
    // rotates this (ortho) camera, so its orientation part is current.
    if (this.frameOffsetPx !== 0 || this.frameOffsetXPx !== 0) {
      const h = this.container.clientHeight || 1;
      const worldPerPx = (2 * this.zoomRadius) / h;
      const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
      const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
      this.target.addScaledVector(up, this.frameOffsetPx * worldPerPx);
      this.target.addScaledVector(right, this.frameOffsetXPx * worldPerPx);
      this.applyCamera();
    }
  }

  private aspect(): number {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    return Math.max(1e-6, w / h);
  }

  /**
   * Orthographic camera from (azimuth, elevation): eye sits on the sphere at
   * distance camDistance; the up hint is ∂eye/∂elevation ("uphill"), which
   * stays unit and orthogonal at every elevation INCLUDING exact top-down,
   * so Map view needs no epsilon hack.
   */
  private applyCamera(): void {
    const aspect = this.aspect();
    this.camera.left = -this.zoomRadius * aspect;
    this.camera.right = this.zoomRadius * aspect;
    this.camera.top = this.zoomRadius;
    this.camera.bottom = -this.zoomRadius;

    const e = this.elevation;
    const a = this.azimuth;
    const ce = Math.cos(e);
    const se = Math.sin(e);
    const sa = Math.sin(a);
    const ca = Math.cos(a);
    this.camera.position.set(
      this.target.x + this.camDistance * ce * sa,
      this.target.y + this.camDistance * se,
      this.target.z + this.camDistance * ce * ca,
    );
    this.camera.up.set(-se * sa, ce, -se * ca);
    this.camera.lookAt(this.target);
    this.camera.updateProjectionMatrix();
    this.viewDir.set(-ce * sa, -se, -ce * ca); // target - eye, normalized
  }

  /* ---------------- pointer + wheel ---------------- */

  private bindPointer(): void {
    const el = this.renderer.domElement;
    el.style.touchAction = "none";
    el.addEventListener("pointerdown", this.onPointerDown);
    el.addEventListener("pointermove", this.onPointerMove);
    el.addEventListener("pointerup", this.onPointerUp);
    el.addEventListener("pointercancel", this.onPointerUp);
    el.addEventListener("lostpointercapture", this.onLostCapture);
    el.addEventListener("wheel", this.onWheel, { passive: false });
    el.addEventListener("dblclick", this.onDblClick);
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    // Safety nets for the pointerup that never arrives (lost capture when an
    // element is hidden/removed mid-drag, alt-tab, an interrupted probe): a
    // ghost pointer in the map makes every later press read as "two
    // pointers" and be swallowed by the pinch branch — orbit silently dead.
    // Window capture sees pointerups even when the canvas missed them, and
    // window blur ends every gesture outright.
    window.addEventListener("pointerup", this.onWindowPointerUp, { capture: true });
    window.addEventListener("pointercancel", this.onWindowPointerUp, { capture: true });
    window.addEventListener("blur", this.onWindowBlur);
  }

  /**
   * setPointerCapture throws NotFoundError for synthetic pointers (tests
   * dispatch PointerEvents with made-up ids); a failed capture must never
   * abort the drag setup, so it is best-effort everywhere.
   */
  private capturePointer(e: PointerEvent): void {
    try {
      this.renderer.domElement.setPointerCapture(e.pointerId);
    } catch {
      // no active pointer with that id — fine (synthetic/untrusted events)
    }
  }

  private onPointerDown = (e: PointerEvent): void => {
    // A mouse owns exactly ONE pointer: any mouse entry already in the map
    // is a ghost (its pointerup was missed — lost capture, alt-tab, an
    // interrupted probe). Sweep it and end a puppet drag it may still hold,
    // or every later press sees size 2 and is swallowed by the pinch branch
    // below — the reported "orbit intermittently does nothing" (probe:
    // tools/cdp-cam-reliability.mjs scenario 8/9).
    if (e.pointerType === "mouse" && this.pointers.size > 0) {
      this.pointers.clear();
      this.pinchDist = 0;
      this.rightDragging = false;
      this.endStuckPuppet();
    }
    // Every pointer is tracked: two down = pinch zoom (QA cam-4).
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2 && !this.puppetDrag) {
      // A second finger cancels any single-pointer gesture and starts the
      // pinch; the spread drives zoomRadius exactly like the wheel.
      this.dragging = false;
      const [a, b] = [...this.pointers.values()];
      this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      this.capturePointer(e);
      return;
    }
    if (e.button === 2) {
      // Right-drag: vertical delta dollies the camera (QA cam-4 — the
      // suppressed context menu made this a total no-op before).
      this.rightDragY = e.clientY;
      this.rightDragging = true;
      this.capturePointer(e);
      return;
    }
    if (e.button !== 0) return;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.lastMoveTime = e.timeStamp;
    // A new drag grip stops any glide from the previous flick.
    this.azimVel = 0;
    this.elevVel = 0;
    this.capturePointer(e);
    // Give listeners first claim on the drag (e.g. grabbing the learner
    // point); only an unclaimed drag becomes an orbit.
    if (this.opts.onDragStart?.(e)) {
      this.puppetDrag = true;
      return;
    }
    this.dragging = true;
    this.dragMoved = false;
    // The user grabbed the camera: in-flight choreography must yield, or its
    // per-frame setAttitude would overwrite every drag delta.
    this.opts.onUserOrbitStart?.();
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (this.pointers.has(e.pointerId)) {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    // Two-pointer pinch zoom (QA cam-4). Direct manipulation: radius and
    // target move together, nothing eases under the fingers.
    if (this.pointers.size === 2 && !this.puppetDrag) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinchDist > 0 && dist > 0) {
        this.zoomRadius = clamp(
          this.zoomRadius * (this.pinchDist / dist),
          this.zoomMin,
          this.zoomMax,
        );
        this.zoomTarget = this.zoomRadius;
        this.applyCamera();
        this.requestRender();
      }
      this.pinchDist = dist;
      return;
    }
    // Right-button dolly: drag down = zoom out (same sign sense as wheel).
    if (this.rightDragging && e.buttons & 2) {
      const dy = e.clientY - this.rightDragY;
      this.rightDragY = e.clientY;
      if (dy !== 0) {
        this.zoomRadius = clamp(
          this.zoomRadius * Math.exp(dy * 0.006),
          this.zoomMin,
          this.zoomMax,
        );
        this.zoomTarget = this.zoomRadius;
        this.applyCamera();
        this.requestRender();
      }
      return;
    }
    if (this.puppetDrag) {
      this.opts.onDragMove?.(e);
      return;
    }
    if (!this.dragging) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    if (dx === 0 && dy === 0) return;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.dragMoved = true;

    // Sensitivity scales with the current zoom: zoomed in, the same pixel
    // gesture rotates less, so fine framing stays precise.
    const kOrbit = 0.005 * clamp(this.zoomRadius / this.fitZoomRadius, 0.3, 1);
    // OrbitControls-convention signs: dragging right spins the scene right;
    // dragging down raises the camera.
    const dAz = -dx * kOrbit;
    const dEl = dy * kOrbit;
    this.azimuth += dAz;
    const { lo, hi } = this.elevationLimits();
    this.elevation = clamp(this.elevation + dEl, lo, hi);

    // Flick velocity: exponential moving average of the instantaneous drag
    // rate, carried after release by the loop's exponential damping.
    const nowT = e.timeStamp;
    const dtE = Math.max((nowT - this.lastMoveTime) / 1000, 1e-3);
    this.lastMoveTime = nowT;
    this.azimVel += (clamp(dAz / dtE, -6, 6) - this.azimVel) * 0.35;
    this.elevVel += (clamp(dEl / dtE, -6, 6) - this.elevVel) * 0.35;

    this.applyCamera();
    this.requestRender();
  };

  private onPointerUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinchDist = 0;
    if (!(e.buttons & 2)) this.rightDragging = false;
    if (this.puppetDrag) {
      this.puppetDrag = false;
      this.opts.onDragEnd?.(e);
      return;
    }
    if (!this.dragging) return;
    this.dragging = false;
    // Only part of the drag's final rate carries into the glide — the EMA
    // tracks the raw gesture rate, and carrying all of it made brisk flicks
    // coast 50°+. 0.55 keeps flicks lively but controlled.
    this.azimVel *= 0.55;
    this.elevVel *= 0.55;
    if (this.renderer.domElement.hasPointerCapture(e.pointerId)) {
      this.renderer.domElement.releasePointerCapture(e.pointerId);
    }
    if (this.dragMoved) this.opts.onUserOrbit?.();
  };

  /** Ends a puppet drag whose pointerup was lost (onDragEnd fires once). */
  private endStuckPuppet(): void {
    if (!this.puppetDrag) return;
    this.puppetDrag = false;
    this.opts.onDragEnd?.(new PointerEvent("pointerup"));
  }

  /**
   * Window-capture net: pointerup/pointercancel that the canvas never saw
   * (the event path broke, or capture was lost). Only acts on pointers the
   * view actually tracks, and onPointerUp is idempotent, so the normal
   * canvas-delivered path simply no-ops here.
   */
  private onWindowPointerUp = (e: PointerEvent): void => {
    if (this.pointers.has(e.pointerId)) this.onPointerUp(e);
  };

  /**
   * Capture lost mid-drag (element hidden/removed, or stolen by another
   * element): the matching pointerup will never be delivered to us — end the
   * gesture now. Fires after a normal release too; idempotent.
   */
  private onLostCapture = (e: PointerEvent): void => {
    if (this.pointers.has(e.pointerId)) this.onPointerUp(e);
  };

  /** Window blur ends every gesture — the release may never be delivered. */
  private onWindowBlur = (): void => {
    if (
      this.pointers.size === 0 &&
      !this.dragging &&
      !this.puppetDrag &&
      !this.rightDragging
    ) {
      return;
    }
    this.pointers.clear();
    this.pinchDist = 0;
    this.rightDragging = false;
    this.endStuckPuppet();
    if (this.dragging) {
      // An interrupted drag is not a deliberate orbit: kill the glide and
      // skip onUserOrbit.
      this.dragging = false;
      this.dragMoved = false;
      this.azimVel = 0;
      this.elevVel = 0;
    }
  };

  private onWheel = (e: WheelEvent): void => {
    // Intro full-bleed: the wheel scrolls past the intro (the page owns it).
    if (!this.wheelZoomEnabled) return;
    e.preventDefault();
    // Zoom eases toward the wheel-driven target; the per-notch step shrinks
    // as you zoom in so fine framing stays precise.
    const zoomSens = clamp(this.zoomRadius / this.fitZoomRadius, 0.2, 1);
    this.zoomTarget = clamp(
      this.zoomTarget * Math.exp(e.deltaY * 0.0012 * zoomSens),
      this.zoomMin,
      this.zoomMax,
    );
    // The loop integrates the approach; a render is only needed once it moves.
  };

  /**
   * Double-click resets the attitude to the step's default (the last preset:
   * Isometric unless Map view is the scene's default) and kills any glide.
   * Zoom is user-owned and left alone — reset is about WHERE you look.
   */
  private onDblClick = (): void => {
    if (this.dragging || this.puppetDrag) return;
    this.setPreset(this.preset ?? "iso");
  };

  /* ---------------- DOM preset buttons ---------------- */

  private presetButtons: HTMLButtonElement[] = [];

  private injectPresetButtons(): void {
    const bar = document.createElement("div");
    bar.className = "lv-controls";
    for (const preset of ["iso", "map"] as const) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "lv-btn";
      btn.dataset.preset = preset;
      btn.textContent = preset === "iso" ? "Isometric" : "Map view";
      btn.addEventListener("click", () => this.setPreset(preset));
      bar.appendChild(btn);
      this.presetButtons.push(btn);
    }
    this.container.appendChild(bar);
  }

  private markPresetButtons(preset: CameraPreset | null): void {
    for (const btn of this.presetButtons) {
      btn.dataset.active = String(btn.dataset.preset === preset);
    }
  }

  /* ---------------- helpers ---------------- */

  /** World point (x,z) -> parameter point (undoes the fixed mapping). */
  private worldToParameter(w: THREE.Vector3): Vec2 {
    const fn = this.landscape;
    if (!fn) return { x: 0, y: 0 };
    const { xMin, xMax, yMin, yMax } = fn.extent;
    return {
      x: w.x + (xMin + xMax) / 2,
      y: -w.z + (yMin + yMax) / 2,
    };
  }

  /** Ball center at parameter point: hugs the surface normal at full relief,
   *  floats straight up over the flat plane (rise = 0). */
  private ballCenter(fn: Landscape, p: Vec2, out: THREE.Vector3): THREE.Vector3 {
    const k = this.diag * 0.022;
    const nrm = this.surfaceNormal(fn, p, new THREE.Vector3());
    this.surfacePoint(fn, p, out, 0);
    out.addScaledVector(nrm, k * this.terrainRise);
    out.y += k * (1 - this.terrainRise);
    return out;
  }

  /** Parameter point -> world point on the (rise-scaled) surface. */
  private surfacePoint(
    fn: Landscape,
    p: Vec2,
    out: THREE.Vector3,
    lift: number,
  ): THREE.Vector3 {
    const { xMin, xMax, yMin, yMax } = fn.extent;
    const t = clamp((fn.f(p) - this.hMin) / this.hRange, 0, 1);
    return out.set(
      p.x - (xMin + xMax) / 2,
      t * this.heightWorld * this.terrainRise + lift,
      -(p.y - (yMin + yMax) / 2),
    );
  }

  /** Analytic world-space surface normal at a parameter point. */
  private surfaceNormal(fn: Landscape, p: Vec2, out: THREE.Vector3): THREE.Vector3 {
    const g = fn.grad(p);
    const s = this.heightWorld / this.hRange;
    return out.set(-g.x * s, 1, g.y * s).normalize();
  }

  /** Removes terrain mesh + contour lines, disposing their GPU resources.
   *  The terrain's ShaderMaterial is shared across rebuilds (created once,
   *  reused by every same-grid rebuild) and is deliberately kept alive. */
  private clearTerrain(): void {
    const terrain = this.terrainMesh;
    this.terrainMesh = null;
    this.contourMat = null;
    for (const child of [...this.terrainGroup.children]) {
      this.terrainGroup.remove(child);
      if (child === terrain) {
        (child as THREE.Mesh).geometry?.dispose();
        continue;
      }
      disposeDeep(child);
    }
  }

  /** Removes trails/arrows/ball, disposing their GPU resources. */
  private clearOverlays(): void {
    this.trails = [];
    this.ball = null;
    for (const child of [...this.overlayGroup.children]) {
      this.overlayGroup.remove(child);
      disposeDeep(child);
    }
  }

  /* ---------------- lifecycle ---------------- */

  /** Re-reads the container size; safe to call any time. */
  resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    // ResizeObserver fires for style-only changes; setSize on an unchanged
    // size still resets the drawing buffer, so skip identical sizes.
    if (w === this.lastResizeW && h === this.lastResizeH) return;
    this.lastResizeW = w;
    this.lastResizeH = h;
    this.renderer.setSize(w, h);
    for (const trail of this.trails) {
      trail.material.resolution.set(w, h);
    }
    for (const mat of this.extraResolutionMats) {
      mat.resolution.set(w, h);
    }
    this.applyCamera();
    this.opts.onResize?.(w, h);
    this.requestRender();
  }

  /** Marks the frame dirty; the rAF loop draws it on the next tick. */
  requestRender(): void {
    this.dirty = true;
  }

  private loop = (now: number): void => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = this.lastFrameTime
      ? Math.min(0.1, (now - this.lastFrameTime) / 1000)
      : 0;
    this.lastFrameTime = now;

    // Inertial orbit: a flick keeps carrying after release and decays
    // exponentially (tau ≈ 200 ms). Clamps still bite at both pitch ends.
    if (!this.dragging && !this.puppetDrag && (this.azimVel !== 0 || this.elevVel !== 0)) {
      this.azimuth += this.azimVel * dt;
      const { lo, hi } = this.elevationLimits();
      this.elevation = clamp(this.elevation + this.elevVel * dt, lo, hi);
      if ((this.elevation === lo || this.elevation === hi) && this.elevVel !== 0) {
        this.elevVel = 0; // gliding into the clamp stops the pitch, not the spin
      }
      const damp = Math.exp(-5 * dt);
      this.azimVel *= damp;
      this.elevVel *= damp;
      if (Math.abs(this.azimVel) < 0.02 && Math.abs(this.elevVel) < 0.02) {
        this.azimVel = 0;
        this.elevVel = 0;
      }
      this.applyCamera();
      this.dirty = true;
    }

    // Zoom easing: the wheel moves zoomTarget; the radius chases it.
    const dz = this.zoomTarget - this.zoomRadius;
    if (Math.abs(dz) > this.fitZoomRadius * 1e-4) {
      this.zoomRadius += dz * (1 - Math.exp(-14 * dt));
      this.applyCamera();
      this.dirty = true;
    }

    // Continuous hero drift; paused during any drag.
    if (this.autoOrbitDegPerSec !== 0 && !this.dragging && !this.puppetDrag) {
      this.azimuth += this.autoOrbitDegPerSec * DEG * dt;
      this.applyCamera();
      this.dirty = true;
    }

    // Spotlight ring: pulse/breathe while visible (hover-to-look).
    if (this.spotRing !== null && this.spotRing.visible) {
      this.spotClock += dt;
      this.spotRing.scale.setScalar(this.spotRadius * this.spotPulseScale());
      if (this.spotMat) {
        this.spotMat.opacity = 0.85 - 0.25 * Math.min(1, this.spotClock / 0.9);
      }
      this.dirty = true;
    }

    this.opts.onFrame?.(dt);

    if (!this.dirty) return;
    this.dirty = false;
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();

    const el = this.renderer.domElement;
    el.removeEventListener("pointerdown", this.onPointerDown);
    el.removeEventListener("pointermove", this.onPointerMove);
    el.removeEventListener("pointerup", this.onPointerUp);
    el.removeEventListener("pointercancel", this.onPointerUp);
    el.removeEventListener("lostpointercapture", this.onLostCapture);
    el.removeEventListener("wheel", this.onWheel);
    el.removeEventListener("dblclick", this.onDblClick);
    window.removeEventListener("pointerup", this.onWindowPointerUp, { capture: true });
    window.removeEventListener("pointercancel", this.onWindowPointerUp, { capture: true });
    window.removeEventListener("blur", this.onWindowBlur);

    this.clearTerrain();
    this.clearOverlays();
    this.terrainMaterial?.dispose();
    this.terrainMaterial = null;
    this.terrainGridN = -1;
    this.fogTexture?.dispose();
    this.fogEmptyTexture.dispose();
    this.renderer.dispose();
    el.remove();
    this.container.querySelector(".lv-controls")?.remove();
  }
}

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

/** 1×1 fully transparent texture — the fog sampler's "everything explored"
 *  stand-in for every non-fog scene (explored = 1 − 0·(1−lift) = 1). */
function makeEmptyFogTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 1;
  c.height = 1;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, 1, 1);
  return new THREE.CanvasTexture(c);
}

function disposeDeep(obj: THREE.Object3D): void {
  obj.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = (mesh as unknown as { material?: THREE.Material | THREE.Material[] }).material;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat?.dispose();
  });
}

/** One shared <style> for the view's DOM chrome (buttons, canvas). */
let viewCssInjected = false;
function injectViewCss(): void {
  if (viewCssInjected) return;
  viewCssInjected = true;
  const style = document.createElement("style");
  style.id = "lv-view-css";
  style.textContent = `
    .lv-root { position: relative; }
    .lv-root .lv-canvas {
      display: block;
      /* The whole canvas orbits: advertise it. The §1 point-drag handler
         overrides to the same grab near the ball; :active covers drags. */
      cursor: grab;
    }
    .lv-root .lv-canvas:active { cursor: grabbing; }
    .lv-root .lv-controls {
      position: absolute;
      top: 14px;
      right: 14px;
      display: flex;
      gap: 8px;
      z-index: 10;
    }
    .lv-root .lv-btn {
      font: 500 13px/1 system-ui, -apple-system, "Segoe UI", sans-serif;
      color: #9aa4b2;
      background: rgba(13, 16, 20, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 8px;
      padding: 8px 14px;
      cursor: pointer;
      transition: color 0.7s cubic-bezier(0.65, 0, 0.35, 1),
        border-color 0.7s cubic-bezier(0.65, 0, 0.35, 1);
    }
    .lv-root .lv-btn:hover { color: #dfe5ec; border-color: rgba(255, 255, 255, 0.18); }
    .lv-root .lv-btn[data-active="true"] {
      color: #58c4dd;
      border-color: rgba(88, 196, 221, 0.55);
    }
  `;
  document.head.appendChild(style);
}
