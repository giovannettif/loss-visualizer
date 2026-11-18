/**
 * LandscapeView — reusable three.js viewport for any src/core landscape.
 *
 * One instance owns: a heightmap mesh (Viridis vertex colors, soft directional
 * shading, emissive valley glow), lifted d3-contour lines, an orthographic
 * camera rig (left-drag pan, right-drag orbit, wheel/pinch zoom) + Isometric /
 * Map view presets, overlay capacity
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
import { TRAIL_MATERIALS, setTrailGlowSuppressed } from "./animatedTrail";

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
   * Called on left-pointerdown BEFORE a pan drag starts. Return true to
   * capture the whole drag (e.g. dragging the learner point): the view then
   * routes pointermove/pointerup to onDragMove/onDragEnd and does not pan.
   */
  onDragStart?: (e: PointerEvent) => boolean;
  /** Called for pointermove while a captured (puppet) drag is active. */
  onDragMove?: (e: PointerEvent) => void;
  /** Called on pointerup after a captured (puppet) drag. */
  onDragEnd?: (e: PointerEvent) => void;
  /**
   * Called the moment a user camera drag begins — a right-drag ORBIT or an
   * unclaimed left-drag PAN (not a captured object drag). The director uses this to drop in-flight camera
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
/** Axis hairline opacity (COPY-PLAN §4.1: subtle labeled edge frame — a
 *  notch above the contours', still far below the trails'). */
const AXIS_OPACITY = 0.4;
/** Axis tick-label sprite opacity. */
const AXIS_LABEL_OPACITY = 0.85;
/** Axis geometry sizes as fractions of the extent diagonal:
 *  tick notch length, label standoff outside the edge, label height. */
const AXIS_TICK_FRAC = 0.012;
const AXIS_LABEL_OUT_FRAC = 0.03;
const AXIS_LABEL_H_FRAC = 0.034;
/** Fog mask resolution (parameter-space uv texture, §6 fog game). */
const FOG_MASK_SIZE = 512;

const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));

type P2 = { x: number; y: number };

/** Convex hull (Andrew's monotone chain), counter-clockwise. */
export function convexHull(points: P2[]): P2[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length <= 2) return pts;
  const cross = (o: P2, a: P2, b: P2): number =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: P2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: P2[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** Sutherland–Hodgman clip of a convex polygon to an axis-aligned rect. */
export function clipPolygonToRect(poly: P2[], x0: number, x1: number, y0: number, y1: number): P2[] {
  const eps = 1e-9;
  const clipEdge = (pts: P2[], inside: (p: P2) => boolean, cut: (a: P2, b: P2) => P2): P2[] => {
    const out: P2[] = [];
    for (let i = 0; i < pts.length; i++) {
      const cur = pts[i];
      const prev = pts[(i + pts.length - 1) % pts.length];
      const ci = inside(cur), pi = inside(prev);
      if (ci) {
        if (!pi) out.push(cut(prev, cur));
        out.push(cur);
      } else if (pi) {
        out.push(cut(prev, cur));
      }
    }
    return out;
  };
  const atX = (X: number) => (a: P2, b: P2): P2 => {
    const t = (X - a.x) / (b.x - a.x || eps);
    return { x: X, y: a.y + (b.y - a.y) * t };
  };
  const atY = (Y: number) => (a: P2, b: P2): P2 => {
    const t = (Y - a.y) / (b.y - a.y || eps);
    return { x: a.x + (b.x - a.x) * t, y: Y };
  };
  let pts = poly;
  if (pts.length === 1) {
    const p = pts[0];
    return p.x >= x0 - eps && p.x <= x1 + eps && p.y >= y0 - eps && p.y <= y1 + eps ? [p] : [];
  }
  pts = clipEdge(pts, (p) => p.x >= x0 - eps, atX(x0));
  if (pts.length) pts = clipEdge(pts, (p) => p.x <= x1 + eps, atX(x1));
  if (pts.length) pts = clipEdge(pts, (p) => p.y >= y0 - eps, atY(y0));
  if (pts.length) pts = clipEdge(pts, (p) => p.y <= y1 + eps, atY(y1));
  return pts;
}

/** Shoelace area (absolute) of a simple polygon. */
export function polygonArea(poly: P2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

/** Nearest point of a CCW convex polygon to (x, y) — (x, y) itself if inside. */
export function clampToConvex(hull: P2[], x: number, y: number): P2 {
  if (hull.length === 0) return { x, y };
  if (hull.length === 1) return { ...hull[0] };
  let inside = hull.length >= 3;
  for (let i = 0; i < hull.length && inside; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    if ((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x) < 0) inside = false;
  }
  if (inside) return { x, y };
  let best = { x: hull[0].x, y: hull[0].y };
  let bestD = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const ex = b.x - a.x, ey = b.y - a.y;
    const len2 = ex * ex + ey * ey;
    const t = len2 > 0 ? clamp(((x - a.x) * ex + (y - a.y) * ey) / len2, 0, 1) : 0;
    const px = a.x + ex * t, py = a.y + ey * t;
    const d = (px - x) ** 2 + (py - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = { x: px, y: py };
    }
  }
  return best;
}

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
  /** Holds the OUTGOING scene's overlays through a crossfade's fade-out
   *  (QA F26-CROSSFADE-BALL-CUT); flushed (disposed) at the swap boundary. */
  private readonly retiredGroup = new THREE.Group();
  /** Shared overlay fade uniform (0..1): every patched overlay material
   *  multiplies its alpha by it, so incoming overlays rise with the terrain. */
  private readonly overlayFadeU = { value: 1 };
  /** Materials carrying the uOverlayFade patch (QA S2B26-ORPHAN-SHADOWS). */
  private readonly fadePatched = new WeakSet<THREE.Material>();
  /** Materials awaiting dispose until after the next render (see
   *  disposeDeep / flushDeferredMaterials). */
  private deferredMatDispose: THREE.Material[] = [];
  /** Spotlight ball-occluder uniforms (QA S2B26-GDA-RING-BURIED). */
  private readonly spotOccC = { value: new THREE.Vector3() };
  private readonly spotOccR = { value: 0 };
  private readonly spotViewDir = { value: new THREE.Vector3(0, 1, 0) };
  /** Ball x-ray ghost (QA S7-SW2-RASTR-BALL-OCCLUDED part B). */
  private ballXray = false;
  private ballXrayMesh: THREE.Mesh | null = null;

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
  /** 256-entry sRGB Viridis LUT (QA PERF25-S2-REBUILD-COST-JANK); built
   *  lazily on first terrain build, replaces per-vertex d3 parse+setStyle. */
  private viridisLut: Float32Array | null = null;

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
  /** The last preset chosen — double-click resets the pose back to it. */
  private preset: CameraPreset | null = null;
  /** The CURRENT step's directed default pose (registered by the director at
   *  setScene time). Double-click resets to the user's last preset in this
   *  step, else this, else Isometric (QA CAM-DBLCLICK-SCENE-DEFAULT). */
  private resetAttitude: { azimuthDeg: number; elevationDeg: number } | null = null;
  /** The directed pose's zoom MULTIPLIER over the live fit (registered with
   *  the attitude — the fit itself is stale at setScene time): double-click
   *  restores this × fitZoom, the scene's standard distance (QA B-3-0). */
  private resetZoomMul: number | null = null;

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
   * screen). Applied as a FRUSTUM shift in applyCamera, at the current zoom
   * on every call — an exact constant pixel offset at any attitude and zoom
   * (the hero uses it to drop the looping race clear of the caption, and it
   * survives the hero's auto-orbit drift).
   */
  private frameOffsetPx = 0;

  /**
   * Horizontal framing offset in CSS px (+ = framed content sits further
   * LEFT on screen). The app layout keeps a reader panel docked on the
   * right, so the page applies +panelWidth/2 to re-center the scene in the
   * visible pane left of the panel. Applied as a frustum shift (applyCamera)
   * — never baked into the orbit target, so zoom and orbit pivot on the pane
   * centre and Map view stays centred (QA CAM-ZOOM-PIVOT / CAM-MAPVIEW-FRAMING).
   */
  private frameOffsetXPx = 0;

  /** Pane aspect at the last zoom rescale (0 = none yet); see
   *  rescaleForPane(). */
  private lastPaneAspect = 0;

  /**
   * Width (CSS px) of the docked reader covering the canvas's right edge — a
   * LAYOUT fact the camera FIT must respect (QA S2A-NARROW-FRAMING-CLIPS-
   * ARROW): the fit sizes the terrain to the visible pane, not the whole
   * canvas. Kept separate from frameOffsetXPx, which also carries nudges and
   * eases during the intro glide.
   */
  private paneInsetRightPx = 0;

  /**
   * Hero pane-fit (QA S2-HERO-RACE-CLIPPED-NARROW): zoom out just enough for
   * the bowl's widest projection over ANY azimuth (the hero drifts) to fit
   * the docked pane. Never writes fitZoomRadius.
   */
  private paneFit = false;
  private static readonly PANE_FIT_MARGIN_PX = 16;

  /** Opaque HUD columns as pan-clamp insets (QA S2CAM-PAN-BEHIND-HUD):
   *  they only tighten the clamp, never move the frustum. */
  private hudInsetLeftPx = 0;
  private hudInsetRightPx = 0;

  /** Software-GL flag from the constructor probe (QA SCRUB-HITCH). */
  private readonly softwareGL: boolean = false;
  /** Motion tier state (only ever ON under software GL): pixel ratio drops
   *  to 0.35 and trail glow passes hide while a scrub drag is live. */
  private motionTier = false;
  private pendingMotionTier: boolean | null = null;
  /** Last renderFrame() cost in ms (QA PERF25-S2-LAB-REBUILD-LONGTASKS):
   *  the §5 live-rebuild throttle backs off on rebuild + render cost. */
  renderCostMs = 0;
  /** Pixel ratio the tier restores to when it turns off. */
  private steadyPixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  /** Static-layer cache (software GL + motion tier only, QA SCRUB-HITCH r3). */
  private staticRT: THREE.WebGLRenderTarget | null = null;
  private staticQuadScene = new THREE.Scene();
  private staticQuadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private staticQuad: THREE.Mesh | null = null;
  private staticQuadMat: THREE.ShaderMaterial | null = null;
  private staticCacheKey: string | null = null;

  /**
   * Extra screen-space nudge (CSS px; +x = content RIGHT, +y = content DOWN)
   * applied like the framing offsets but owned by the director: it steers the
   * §6 reveal marker + note clear of the HUD panels at narrow viewports
   * (QA L900-FOG-REVEAL-NOTE-OVER-HUD). Frustum-shifted at the current zoom,
   * exactly like setFrameOffsetX/Y.
   */
  private revealNudge = { x: 0, y: 0 };

  /** The attitude refit measurements use (see setFrameAttitude). */
  private frameAttitude: { az: number; el: number } | null = null;

  /** The nudge currently applied (diagnostics + nudge math needs the applied
   *  base to stay idempotent across recomputes). */
  get appliedRevealNudge(): { x: number; y: number } {
    return { ...this.revealNudge };
  }

  setRevealNudge(x: number, y: number): void {
    if (this.revealNudge.x === x && this.revealNudge.y === y) return;
    this.revealNudge.x = x;
    this.revealNudge.y = y;
    this.applyCamera();
    this.requestRender();
  }

  /**
   * The attitude reframeCamera must MEASURE at (the incoming scene's
   * destination pose) — so the fit and the pane-centred framing are
   * deterministic regardless of which attitude happens to be live during a
   * crossfade rebuild (QA LW24-ADAM-BALL-UNDER-PANEL-1280). Null = measure at
   * the live attitude (debug page, hero).
   */
  setFrameAttitude(azDeg: number | null, elDeg: number | null): void {
    this.frameAttitude =
      azDeg !== null && elDeg !== null ? { az: azDeg, el: elDeg } : null;
  }

  /** True while the user holds a camera gesture (orbit, pan, pinch) or a
   *  captured object drag — the director must not move the frame then. */
  get userGesturing(): boolean {
    return this.dragging || this.panning || this.puppetDrag || this.pointers.size > 1;
  }

  /** Public refit hook (same-landscape scene transitions). */
  reframe(): void {
    this.reframeCamera();
    this.requestRender();
  }

  // Pointer-drag orbit state.
  private dragging = false;
  private dragMoved = false;
  /** True while a captured object-drag (onDragStart returned true) is active. */
  private puppetDrag = false;
  private lastX = 0;
  private lastY = 0;
  /** Every active pointer (QA cam-4): two = pinch zoom. */
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;
  /**
   * Mouse binding (user scheme, 2026-11-09): LEFT-drag PANS, RIGHT-drag
   * ORBITS. `dragging` is the orbit gesture (button 2); `panning` the pan
   * gesture (button 0, unless a puppet drag claimed it first).
   */
  private panning = false;
  /** Right-drag orbits end with a contextmenu event that may land OFF the
   *  canvas (capture is released on pointerup): swallow it page-wide for a
   *  moment so an orbit never ends in a browser menu over the reader. */
  private suppressContextUntil = 0;
  /**
   * User pan: world-space offset of the orbit target from the terrain box
   * centre (`baseTarget`). Built from screen-plane drags (camera right/up),
   * clamped in applyCamera so the landscape can never leave the visible pane
   * (clampPan). Zero = the choreographed framing, untouched. Reset on every
   * refit (landscape/scene change), preset click and double-click.
   */
  private readonly pan = new THREE.Vector3();
  private readonly baseTarget = new THREE.Vector3();

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
  /** The live contour LineSegments (replaced — never stacked — on rebuild;
   *  the old set used to leak one draw + 3 buffers + 1 VAO per same-grid
   *  rebuild, QA PERF25-CONTOUR-LEAK). */
  private contourLines: THREE.LineSegments | null = null;
  /** Labeled axis frame (COPY-PLAN §4.1): one LineSegments "L" along the two
   *  bottom domain edges + tick notches, rebuilt per landscape. */
  private axisLines: THREE.LineSegments | null = null;
  /** The axis hairline shader material — created once, uOpacity rides the
   *  contour path (terrainOpacity × contourRevealK × focusContourDim). */
  private axisLineMat: THREE.ShaderMaterial | null = null;
  /** Axis tick-label sprites (their y scale is rise-compensated, see
   *  setTerrainRise) + the matching world height per sprite. */
  private axisSprites: THREE.Sprite[] = [];
  private axisSpriteScales: number[] = [];
  /** Label textures + materials cached by text — §4/§5 slider rebuilds
   *  re-enter setLandscape many times a second (COPY-PLAN §4.1). */
  private readonly axisLabelCache = new Map<
    string,
    { mat: THREE.SpriteMaterial; tex: THREE.CanvasTexture; aspect: number }
  >();
  private readonly raycaster = new THREE.Raycaster();

  /** Soft radial ground-spot decals under balls / floating arrow tips. */
  private readonly shadowGroup = new THREE.Group();
  private readonly shadowPool: THREE.Mesh[] = [];
  private shadowTex: THREE.CanvasTexture | null = null;
  /** One disc geometry shared by every pool entry (QA PERF25-S2-GL-LEAK
   *  residual — pool geometries are never disposed, so allocate once). */
  private shadowDiscGeo: THREE.CircleGeometry | null = null;

  private readonly resizeObserver: ResizeObserver;

  constructor(container: HTMLElement, opts: Partial<LandscapeViewOptions> = {}) {
    this.container = container;
    this.opts = { gridN: 160, background: MANIM.background, ...opts };
    container.classList.add("lv-root");
    injectViewCss();

    // Software-GL defense (QA SCRUB-HITCH): under SwiftShader the MSAA
    // render target dominates every full-scene render (~30% of a scrub
    // frame). Detect it once and drop antialias — trails keep their own
    // shader-side smoothing, so the cost is mainly terrain-silhouette AA.
    let antialias = true;
    let softwareGL = false;
    try {
      const probe = document.createElement("canvas");
      const gl = probe.getContext("webgl2") ?? probe.getContext("webgl");
      if (gl) {
        const dbg = gl.getExtension("WEBGL_debug_renderer_info");
        const rendererName = dbg
          ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL))
          : "";
        if (/swiftshader|llvmpipe|software/i.test(rendererName)) {
          softwareGL = true;
          antialias = false;
        }
      }
    } catch {
      // detection is best-effort; keep antialias on failure
    }
    this.softwareGL = softwareGL;
    this.renderer = new THREE.WebGLRenderer({ antialias });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.domElement.classList.add("lv-canvas");
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(this.opts.background);
    this.scene.add(this.terrainGroup, this.overlayGroup);
    // Retired overlays (QA F26-CROSSFADE-BALL-CUT): the outgoing scene's
    // ball/trails/shadows live here through the crossfade's fade-out stage,
    // fading with the shared uOverlayFade uniform, and are disposed at the
    // swap's out→in boundary when the fade is 0.
    this.retiredGroup.name = "retired";
    this.scene.add(this.retiredGroup);
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
  setLandscape(fn: Landscape, opts: { gridN?: number; keepCamera?: boolean } = {}): void {
    if (opts.gridN !== undefined) this.activeGridN = opts.gridN;
    else this.activeGridN = this.opts.gridN;
    // keepCamera (QA SEC5-S2-REBUILD-RESETS-CAMERA / S2CAM-SLIDER-REFRAME-
    // STOMPS-ZOOM-PAN): live slider rebuilds keep the user's zoom and pan
    // RELATIVE to the fit. Same extent ⇒ s = 1, an exact no-op; a changed
    // extent (§5 elongation) carries the framing onto the new fit, the way
    // setPreset carries zoom across attitudes. Scene arrivals keep the
    // absolute refit (default).
    const carry = opts.keepCamera === true && this.landscape !== null && this.fitZoomRadius > 0;
    const oldFit = this.fitZoomRadius;
    const zr = this.zoomRadius / (oldFit || 1);
    const zt = this.zoomTarget / (oldFit || 1);
    const savedPan = this.pan.clone();
    this.landscape = fn;
    this.clearOverlays();
    const heights = this.rebuildTerrain();
    this.buildContourLines(heights);
    this.buildAxisFrame();
    this.reframeCamera();
    if (carry) {
      const newFit = this.fitZoomRadius;
      const s = newFit / oldFit;
      this.zoomRadius = clamp(zr * newFit, this.zoomMin, this.zoomMax);
      this.zoomTarget = clamp(zt * newFit, this.zoomMin, this.zoomMax);
      this.pan.copy(savedPan).multiplyScalar(s);
      this.applyCamera();
    }
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
    // The axis tick sprites live in terrainGroup (they flatten onto the
    // parameter plane with the §1 materialization), and the sprite shader
    // reads its screen height from the parent's scaled Y column — undo that
    // per sprite so the text never squashes while the terrain rises.
    const invY = 1 / this.terrainGroup.scale.y;
    for (let i = 0; i < this.axisSprites.length; i++) {
      this.axisSprites[i].scale.y = this.axisSpriteScales[i] * invY;
    }
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

  /** Diagnostics: the live contour-reveal multiplier (fog-leak probes). */
  get contourReveal(): number {
    return this.contourRevealK;
  }

  private applyContourOpacity(): void {
    // One shared reveal product: terrain opacity × §6 contour reveal ×
    // hover-dim. The axis frame rides it too (COPY-PLAN §4.1) — gated by
    // contourRevealK so a fogged/blind landscape can never leak its edge
    // height profile, and by terrainOpacity so the §1 crossfade carries it.
    const k = this.terrainOpacity * this.contourRevealK * this.focusContourDim;
    if (this.contourMat) {
      this.contourMat.uniforms.uOpacity.value = CONTOUR_OPACITY * k;
    }
    if (this.axisLineMat) {
      this.axisLineMat.uniforms.uOpacity.value = AXIS_OPACITY * k;
    }
    for (const rec of this.axisLabelCache.values()) {
      rec.mat.opacity = AXIS_LABEL_OPACITY * k;
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

  /**
   * Drops a material's cached focus base opacity, so the next applyFocus()
   * re-reads its current opacity as the base. For overlay materials whose
   * owning code animates opacity between focus passes (§3's fading apex
   * markers) — a value cached mid-fade must not stick as the base.
   */
  refreshFocusBaseOpacity(mat: THREE.Material): void {
    this.baseOpacities.delete(mat);
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
      // depthTest off (QA S2B26-GDA-RING-BURIED): at grazing attitudes the
      // near valley wall hid the ring that lies ON the far wall. Terrain
      // depth no longer occludes the cue; the learner ball still does,
      // through an exact analytic sphere test in the ring's own shader (works
      // on the direct and static-cache render paths alike, no stencil).
      this.spotMat = new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      });
      this.spotMat.onBeforeCompile = (sh) => {
        sh.uniforms.uOccC = this.spotOccC;
        sh.uniforms.uOccR = this.spotOccR;
        sh.uniforms.uViewDir = this.spotViewDir;
        sh.vertexShader = sh.vertexShader
          .replace("void main() {", "varying vec3 vSpotW;\nvoid main() {")
          .replace(
            "#include <project_vertex>",
            "#include <project_vertex>\n  vSpotW = (modelMatrix * vec4(transformed, 1.0)).xyz;",
          );
        sh.fragmentShader = sh.fragmentShader.replace(
          "void main() {",
          [
            "varying vec3 vSpotW;",
            "uniform vec3 uOccC;",
            "uniform float uOccR;",
            "uniform vec3 uViewDir;",
            "void main() {",
            "  if (uOccR > 0.0) {",
            "    vec3 d = vSpotW - uOccC;",
            "    float a = dot(d, uViewDir);",
            "    float p2 = dot(d, d) - a * a;",
            "    float r2 = uOccR * uOccR;",
            "    if (p2 < r2 && a > -sqrt(r2 - p2)) discard;",
            "  }",
          ].join("\n"),
        );
      };
      this.spotMat.customProgramCacheKey = () => "spotOcc";
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
    this.updateSpotOccluder();
  }

  /** The learner ball as the ring's only occluder (orthographic camera, so a
   *  single view direction is exact). uViewDir points camera → target. */
  private updateSpotOccluder(): void {
    const b = this.ball;
    if (b && b.visible) {
      b.getWorldPosition(this.spotOccC.value);
      this.spotOccR.value = b.scale.x;
      this.spotViewDir.value.copy(this.viewDir).negate().normalize();
    } else {
      this.spotOccR.value = 0;
    }
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

  /** Diagnostics: whether fog sampling is bound to the terrain (§6 game,
   *  the blind swarm, or §7's fog-of-war tilt board). */
  get fogOn(): boolean {
    return this.fogEnabled;
  }

  /** Diagnostics: the fog reveal value (0 = fogged, 1 = fully lifted).
   *  Named fogReveal because the fogLift field owns the storage name. */
  get fogReveal(): number {
    return this.fogLift;
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
   * Applied as a frustum shift in applyCamera (never a re-frame): the offset
   * is exact CSS px at the CURRENT zoom and holds at any attitude, so order
   * relative to setLandscape does not matter.
   */
  setFrameOffsetY(px: number): void {
    if (px === this.frameOffsetPx) return;
    this.frameOffsetPx = px;
    this.applyCamera();
    this.requestRender();
  }

  /**
   * Horizontal framing offset in CSS px (+ = content sits further LEFT).
   * Same frustum-shift mechanism as the vertical offset — the app layout
   * docks the reader panel on the right and shifts the scene +panelWidth/2
   * so it centers in the pane left of the panel.
   */
  setFrameOffsetX(px: number): void {
    if (px === this.frameOffsetXPx) return;
    this.frameOffsetXPx = px;
    this.applyPaneFit();
    this.applyCamera();
    this.requestRender();
  }

  /** Diagnostics: the applied horizontal framing offset (CSS px). */
  get frameOffsetX(): number {
    return this.frameOffsetXPx;
  }

  /**
   * The docked reader's width (CSS px), for the pane-aware FIT. A change
   * rescales every zoom radius by the fit ratio (zoom stays user-owned, no
   * re-fit), exactly like a canvas resize.
   */
  setPaneInsetRight(px: number): void {
    const v = Math.max(0, px);
    if (v === this.paneInsetRightPx) return;
    this.paneInsetRightPx = v;
    this.rescaleForPane();
    this.applyPaneFit();
    this.applyCamera();
    this.requestRender();
  }

  /** Diagnostics: the pane inset used by the fit. */
  get paneInsetRight(): number {
    return this.paneInsetRightPx;
  }

  /** Opaque HUD panel columns (CSS px from the pane's left / right edges)
   *  the pan clamp keeps the terrain box clear of (QA S2CAM-PAN-BEHIND-HUD). */
  setPaneInsets(leftPx: number, rightPx = 0): void {
    const l = Math.max(0, leftPx);
    const r = Math.max(0, rightPx);
    if (l === this.hudInsetLeftPx && r === this.hudInsetRightPx) return;
    this.hudInsetLeftPx = l;
    this.hudInsetRightPx = r;
    this.applyCamera();
    this.requestRender();
  }

  /** Diagnostics: the HUD clamp insets. */
  get paneInsets(): { left: number; right: number } {
    return { left: this.hudInsetLeftPx, right: this.hudInsetRightPx };
  }

  /** HUD insets reduced so the remaining pane never collapses below
   *  min(base, max(320, base/2)) px (right reduced first). */
  private effectiveHudInsets(basePaneW: number): [number, number] {
    let iL = this.hudInsetLeftPx;
    let iR = this.hudInsetRightPx;
    const minPane = Math.min(basePaneW, Math.max(320, 0.5 * basePaneW));
    let over = iL + iR - (basePaneW - minPane);
    if (over > 0) {
      const dR = Math.min(iR, over);
      iR -= dR;
      over -= dR;
      iL = Math.max(0, iL - over);
    }
    return [iL, iR];
  }

  /** Hero pane-fit on/off (director: the race scene only). */
  setPaneFit(on: boolean): void {
    this.paneFit = on;
    if (on) {
      this.applyPaneFit();
      this.applyCamera();
      this.requestRender();
    }
  }

  private paneFitZoom(): number {
    const fn = this.landscape;
    if (!fn) return this.fitZoomRadius;
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    const paneW = w - 2 * Math.max(0, this.frameOffsetXPx);
    // The camera's right vector is horizontal, so the widest horizontal
    // half-extent over any azimuth is the half-diagonal of the extent.
    const rh = Math.hypot((fn.extent.xMax - fn.extent.xMin) / 2, (fn.extent.yMax - fn.extent.yMin) / 2);
    const m = LandscapeView.PANE_FIT_MARGIN_PX;
    return Math.max(this.fitZoomRadius, (rh * h) / Math.max(1, paneW - 2 * m));
  }

  private applyPaneFit(): void {
    if (!this.paneFit || !this.landscape) return;
    const z = clamp(this.paneFitZoom(), this.zoomMin, this.zoomMax);
    if (Math.abs(z - this.zoomRadius) > 1e-6) {
      this.zoomRadius = z;
      this.zoomTarget = z; // absolute, frame-locked with the frameX glide
    }
  }

  /** The visible pane's aspect (canvas minus the docked reader). */
  private paneAspect(): number {
    const w = Math.max(1, (this.container.clientWidth || 1) - this.paneInsetRightPx);
    return Math.max(1e-6, w / (this.container.clientHeight || 1));
  }

  /** Keeps every zoom radius relative to the pane-aware fit when the pane
   *  aspect changes (canvas resize or reader inset). Telescoping: each call
   *  scales by min(1, last)/min(1, now), so any order of resize and inset
   *  updates lands on the same radii. */
  private rescaleForPane(): void {
    const pa = this.paneAspect();
    if (this.landscape && this.lastPaneAspect > 0) {
      const oldFit = Math.min(1, this.lastPaneAspect);
      const newFit = Math.min(1, pa);
      if (Math.abs(newFit - oldFit) > 1e-9) {
        const k = oldFit / newFit;
        this.zoomRadius *= k;
        this.zoomTarget *= k;
        this.fitZoomRadius *= k;
        this.zoomMin *= k;
        this.zoomMax *= k;
      }
    }
    this.lastPaneAspect = pa;
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
      if (mat) this.patchOverlayMaterial(mat);
    });
    this.overlayGroup.add(obj);
  }

  /** Removes and disposes an object previously added via addOverlayObject. */
  removeOverlayObject(obj: THREE.Object3D): void {
    // A RETIRED object (crossfade fade-out) must stay rendered, fading with
    // uOverlayFade, until the flush: leave it in place — flushRetired()
    // disposes it (QA F26-CROSSFADE-BALL-CUT / S2B26-RETIRED-REMOVE-CUTS).
    // Detaching it here cut it in the first fade frame AND leaked its GL
    // resources, since the flush could no longer reach it (QA
    // PERF25-S2-GL-LEAK-CROSSFADE).
    for (let p: THREE.Object3D | null = obj; p; p = p.parent) {
      if (p === this.retiredGroup) return;
    }
    obj.traverse((node) => {
      const mat = (node as THREE.Mesh).material as THREE.Material | undefined;
      if (mat instanceof LineMaterial) this.extraResolutionMats.delete(mat);
    });
    this.overlayGroup.remove(obj);
    disposeDeep(obj, this.deferredMatDispose);
  }

  /**
   * Flags a material to multiply its final alpha by the shared uOverlayFade
   * uniform (QA F26-CROSSFADE-BALL-CUT): injected at the end of the fragment
   * main, after the includes that write gl_FragColor. All patched programs
   * share one cache key so three never mixes patched and unpatched programs.
   */
  private patchOverlayMaterial(m: THREE.Material): void {
    // Tracked in a WeakSet, not userData: Material.clone() copies userData but
    // not the instance onBeforeCompile, so a userData flag made clones look
    // patched while they ignored uOverlayFade (QA S2B26-ORPHAN-SHADOWS).
    if (this.fadePatched.has(m)) return;
    this.fadePatched.add(m);
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uOverlayFade = this.overlayFadeU;
      sh.fragmentShader =
        "uniform float uOverlayFade;\n" +
        sh.fragmentShader.replace(/}\s*$/, "  gl_FragColor.a *= uOverlayFade;\n}");
    };
    m.customProgramCacheKey = () => "overlayFade";
    m.needsUpdate = true;
  }

  /** Sets the shared overlay fade (1 = fully shown). */
  setOverlayFade(k: number): void {
    const v = clamp(k, 0, 1);
    this.overlayFadeU.value = v;
    // The learner ball is opaque Lambert in steady state; switch to
    // transparent only while fading so steady-state sorting is unchanged.
    if (this.ball) {
      (this.ball.material as THREE.MeshLambertMaterial).transparent = v < 0.999;
    }
    this.requestRender();
  }

  /** Current overlay fade (diagnostics). */
  get overlayFade(): number {
    return this.overlayFadeU.value;
  }

  /** Count of retired overlays still fading (diagnostics). */
  get retiredCount(): number {
    return this.retiredGroup.children.length;
  }

  /**
   * Moves every live overlay into the retired group at the START of a
   * crossfade fade-out: the outgoing ball/trails/shadows keep rendering while
   * uOverlayFade drops, instead of being cut in the first frame. New-scene
   * objects are created fresh afterwards (ball/trails refs are dropped here).
   */
  retireOverlays(): void {
    for (const c of [...this.overlayGroup.children]) {
      this.overlayGroup.remove(c);
      this.retiredGroup.add(c);
      // Opaque patched materials (the ball, lane balls, the swarm) render with
      // NoBlending: the fade lowered only the alpha they WROTE, so on the
      // premultiplied canvas they brightened instead of fading. Retired
      // objects never come back, so flip them once, here (QA
      // S2B26-RETIRED-BALL-NO-FADE). No needsUpdate: blend state and the
      // render-list bucket read `transparent` per draw.
      c.traverse((node) => {
        const mat = (node as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        for (const m of Array.isArray(mat) ? mat : mat ? [mat] : []) {
          if (this.fadePatched.has(m) && !m.transparent) m.transparent = true;
        }
      });
    }
    this.ball = null;
    this.trails = [];
    // The learner ball's contact shadows live outside the overlay group:
    // fade CLONES so the live pool stays untouched for the incoming scene.
    for (const m of this.shadowPool) {
      if (!m.visible) continue;
      const smat = m.material as THREE.Material;
      // Own geometry: flushRetired disposes the clone, and a shared geometry
      // would be the live pool's (QA S2B26-ORPHAN-SHADOWS hygiene).
      const clone = new THREE.Mesh(m.geometry.clone(), smat.clone());
      this.patchOverlayMaterial(clone.material as THREE.Material);
      clone.position.copy(m.position);
      clone.quaternion.copy(m.quaternion);
      clone.scale.copy(m.scale);
      clone.renderOrder = m.renderOrder;
      this.retiredGroup.add(clone);
    }
    this.requestRender();
  }

  /** Disposes everything in the retired group (call when the fade is 0). */
  flushRetired(): void {
    for (const c of [...this.retiredGroup.children]) {
      this.retiredGroup.remove(c);
      c.traverse((node) => {
        const mat = (node as THREE.Mesh).material as THREE.Material | undefined;
        if (mat instanceof LineMaterial) this.extraResolutionMats.delete(mat);
      });
      disposeDeep(c, this.deferredMatDispose);
    }
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
      // Risen surface, ray past its silhouette: no pick (QA S1-BALL-UNDER-HUD
      // Fix B). The flat-plane fallback snapped a captured drag to a far
      // extent edge; null holds the ball at its last on-surface hit.
      if (!hit) return null;
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
    // matrixWorld is otherwise updated only inside renderer.render — a pose
    // changed by applyCamera (setAttitude, orbit, zoom) since the last render
    // would project through a STALE view matrix (QA fog-reveal-1: the frozen
    // ?shot=fog-c reveal note pinned at a pre-attitude pose and never
    // re-pinned). Refresh it so world.project always sees the current pose.
    this.camera.updateMatrixWorld();
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
    // PERF25-S2-REBUILD-COST-JANK: the per-vertex interpolateViridis + Color
    // string parse was the #1 rebuild JS bucket (130+116ms per drag) — build
    // a 256-entry sRGB LUT once per view and index it per vertex instead.
    if (!this.viridisLut) {
      const lut = new Float32Array(256 * 3);
      const viridis = scaleSequential(interpolateViridis);
      const sample = new THREE.Color();
      for (let i = 0; i < 256; i++) {
        sample.setStyle(viridis(i / 255)); // sRGB parsed -> linear working
        lut[i * 3 + 0] = sample.r;
        lut[i * 3 + 1] = sample.g;
        lut[i * 3 + 2] = sample.b;
      }
      this.viridisLut = lut;
    }
    const viridisLut = this.viridisLut;

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

        // LUT index over the same ramp the scale sampled (256 sRGB entries).
        const li = (Math.round(Math.min(1, Math.max(0, tc)) * 255) | 0) * 3;
        colors[idx * 3 + 0] = viridisLut[li + 0];
        colors[idx * 3 + 1] = viridisLut[li + 1];
        colors[idx * 3 + 2] = viridisLut[li + 2];

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
    // Take the mesh by reference, not by children order, and drop the
    // PREVIOUS contour set first: on the same-grid reuse path rebuildTerrain
    // never calls clearTerrain, so without this every rebuild leaked a
    // LineSegments (1 draw, 3 buffers, 1 VAO) whose stale material also kept
    // its old opacity under additive blending (QA PERF25-CONTOUR-LEAK).
    if (this.contourLines) {
      this.terrainGroup.remove(this.contourLines);
      this.contourLines.geometry.dispose();
      this.contourLines = null;
    }
    const mesh = this.terrainMesh;
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

    // LINES-1: rings that hug the domain border (walls rising from an edge
    // pin the first level band against it) rendered as a second parallel
    // line just inside the axis frame — "two parallel lines of different
    // styles". The old exact-border drop (eps at 0 / size) only caught
    // clipped rings running ON the boundary; a ring one fraction of a cell
    // inside survived. Segments with BOTH endpoints within half a grid cell
    // of the border are dropped instead: edge-hugging rings vanish, and an
    // isoline merely crossing the band keeps its length (the both-endpoints
    // rule, unchanged from the eps drop).
    const borderMargin = 0.5;
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
    const nearBorder = (v: number, span: number): boolean =>
      v < borderMargin || v > span - borderMargin;

    // GeoJSON nesting: MultiPolygon.coordinates = polygons[] → rings[] →
    // positions[]. Holes are drawn too — around peaks they are real isolines.
    for (const poly of polys) {
      for (const polygon of poly.coordinates) {
        for (const ring of polygon) {
          for (let i = 0; i < ring.length - 1; i++) {
            const a = ring[i];
            const b = ring[i + 1];
            if (
              (nearBorder(a[0], size) || nearBorder(a[1], size)) &&
              (nearBorder(b[0], size) || nearBorder(b[1], size))
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
    // Reuse the shader material across rebuilds (its uniforms are refreshed
    // below and uViewDir already points at the shared viewDir object) — a
    // fresh material per rebuild piled up dead ShaderMaterials whose opacity
    // no longer reached the stale stacked contours (QA PERF25-CONTOUR-LEAK).
    let mat = this.contourMat;
    if (!mat) {
      mat = new THREE.ShaderMaterial({
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
    }
    // Always refresh the opacity: the uniform bakes the current terrain
    // opacity, contour reveal and focus dim at build time.
    mat.uniforms.uOpacity.value =
      CONTOUR_OPACITY * this.terrainOpacity * this.contourRevealK *
      this.focusContourDim;
    this.contourMat = mat;
    const lines = new THREE.LineSegments(geo, mat);
    lines.renderOrder = 1;
    this.contourLines = lines;
    this.terrainGroup.add(lines);
  }

  /* ---------------- labeled axis frame (COPY-PLAN §4.1) ---------------- */

  /**
   * Thin labeled axis lines along the two bottom domain edges — the "L" a
   * 2D plot draws — sampled through the height profile so the line hugs the
   * surface (Rosenbrock's edge is anything but flat), with small
   * perpendicular tick notches and one canvas-texture sprite per tick
   * ("w = −1"; names read from Landscape.axes, the same ones the compass
   * labels, so the 3D frame can never drift from the minimap).
   *
   * Lives in terrainGroup: it flattens with the §1 materialization rise
   * (sprite text scale is compensated in setTerrainRise), rebuilds with the
   * landscape, and its opacity rides applyContourOpacity() — terrainOpacity
   * × contourRevealK × focusContourDim — so §6 fog / the blind swarm keep it
   * hidden until the reveal and hover-dim just works. Map-view crispness is
   * free: the camera is orthographic and the Map preset is exact top-down.
   */
  private buildAxisFrame(): void {
    // Drop the previous frame first — same-grid rebuilds never clearTerrain
    // (the contour-leak precedent, QA PERF25-CONTOUR-LEAK).
    this.removeAxisFrame();
    const fn = this.landscape;
    const mesh = this.terrainMesh;
    if (!fn || !mesh) return;

    const { xMin, xMax, yMin, yMax } = fn.extent;
    const cx = (xMin + xMax) / 2;
    const cy = (yMin + yMax) / 2;
    const lift = this.diag * 0.004; // the contour pass's lift
    const tickLen = this.diag * AXIS_TICK_FRAC;
    const labelOut = this.diag * AXIS_LABEL_OUT_FRAC;
    const labelH = this.diag * AXIS_LABEL_H_FRAC;
    const axisNames = fn.axes ?? ["x", "y"];

    // Parameter point -> raw-height world point (terrainGroup scales the
    // rise in), lifted off the sheet exactly like the contour lines.
    const v = new THREE.Vector3();
    const worldOf = (px: number, py: number): void => {
      const fv = fn.f({ x: px, y: py });
      const t = Number.isFinite(fv) ? clamp((fv - this.hMin) / this.hRange, 0, 1) : 1;
      v.set(px - cx, t * this.heightWorld + lift, -(py - cy));
    };

    const pts: number[] = [];
    const push = (px: number, py: number): void => {
      worldOf(px, py);
      pts.push(v.x, v.y, v.z);
    };

    // The two bottom edges (py = yMin and px = xMin), sampled densely.
    const EDGE_SAMPLES = 160;
    // LINES-1: this object is LineSegments, which rasterizes the flat
    // vertex array as PAIRS — (p0→p1), (p2→p3), … A continuous polyline
    // pushed point-per-sample therefore drew every OTHER micro-segment:
    // the domain edges rendered as a regular dash/stipple (the map-view
    // 1px-on/1px-off line and the isometric dashed edge), while the tick
    // pairs below it always rendered solid. Push each edge micro-segment
    // as an explicit pair (the contour builder's existing pattern) so the
    // "L" is one solid hairline.
    let prev: [number, number] | null = null;
    const edgeTo = (px: number, py: number): void => {
      if (prev) {
        push(prev[0], prev[1]);
        push(px, py);
      }
      prev = [px, py];
    };
    for (let i = 0; i <= EDGE_SAMPLES; i++) {
      edgeTo(xMin + ((xMax - xMin) * i) / EDGE_SAMPLES, yMin);
    }
    prev = null; // the shared corner point belongs to both arms
    for (let i = 0; i <= EDGE_SAMPLES; i++) {
      edgeTo(xMin, yMin + ((yMax - yMin) * i) / EDGE_SAMPLES);
    }

    // Perpendicular tick notches at the compass's tick values.
    const xTicks = niceAxisTicks(xMin, xMax);
    const yTicks = niceAxisTicks(yMin, yMax);
    for (const t of xTicks) {
      push(t, yMin);
      push(t, yMin + tickLen);
    }
    for (const t of yTicks) {
      push(xMin, t);
      push(xMin + tickLen, t);
    }    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));

    // Flat white hairline via ShaderMaterial (not LineBasicMaterial): the
    // uOpacity uniform is what staticKey() keys the software-GL static cache
    // on, so mid-scrub reveal/dim changes invalidate the cached layer.
    if (!this.axisLineMat) {
      this.axisLineMat = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(0xffffff) },
          uOpacity: {
            value: AXIS_OPACITY * this.terrainOpacity * this.contourRevealK *
              this.focusContourDim,
          },
        },
        vertexShader: /* glsl */ `
          void main() {
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          uniform float uOpacity;
          void main() {
            gl_FragColor = vec4(uColor * uOpacity, uOpacity);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        // Tilt-stamp fallback (director.ts's measurement stamps): the lift
        // does the real work; the offset is belt-and-braces.
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -4,
      });
    }
    const lines = new THREE.LineSegments(geo, this.axisLineMat);
    lines.renderOrder = 1; // with contours/shadows, below trails
    lines.frustumCulled = false;
    this.axisLines = lines;
    this.terrainGroup.add(lines);

    // Tick labels: one sprite per tick, hugging the tick's height just
    // OUTSIDE the domain edge (matplotlib-style), where they can never
    // obstruct the surface. Textures + materials are cached by text.
    // Corner-collision guard (QA FA-3): the two labels AT the shared near
    // corner (xMin's tick on the bottom edge, yMin's on the left edge)
    // project onto each other — the corner is one point and the two
    // outside-edge offsets converge on screen (Rosenbrock's focal view read
    // "y =x÷−2"). Skip both: the notches mark the ticks, the remaining
    // labels carry the range, and the compass repeats it. Least-squares'
    // coarser b-ticks hid this only by luck.
    const xCornerTick = xTicks.find((t) => t <= xMin + (xTicks[1] - xTicks[0]) / 2);
    const yCornerTick = yTicks.find((t) => t <= yMin + (yTicks[1] - yTicks[0]) / 2);
    const invY = 1 / this.terrainGroup.scale.y; // rise compensation (see setTerrainRise)
    const addLabel = (text: string, px: number, py: number, ox: number, oz: number): void => {
      const rec = this.axisLabelMaterial(text);
      worldOf(px, py);
      const spr = new THREE.Sprite(rec.mat);
      spr.position.set(v.x + ox, v.y, v.z + oz);
      spr.scale.set(labelH * rec.aspect, labelH * invY, 1);
      spr.renderOrder = 2;
      spr.frustumCulled = false;
      this.axisSprites.push(spr);
      this.axisSpriteScales.push(labelH);
      this.terrainGroup.add(spr);
    };
    for (const t of xTicks) {
      if (t === xCornerTick) continue;
      addLabel(`${axisNames[0]} = ${fmtAxisTick(t)}`, t, yMin, 0, labelOut);
    }
    for (const t of yTicks) {
      if (t === yCornerTick) continue;
      addLabel(`${axisNames[1]} = ${fmtAxisTick(t)}`, xMin, t, -labelOut, 0);
    }
  }

  /** Removes the axis frame's scene objects. Cached textures/materials
   *  survive — only geometries go (sprites share three's internal sprite
   *  geometry, which must never be disposed). */
  private removeAxisFrame(): void {
    if (this.axisLines) {
      this.terrainGroup.remove(this.axisLines);
      this.axisLines.geometry.dispose();
      this.axisLines = null;
    }
    for (const spr of this.axisSprites) this.terrainGroup.remove(spr);
    this.axisSprites = [];
    this.axisSpriteScales = [];
  }

  /** Cached sprite material for one label text (canvas texture + material). */
  private axisLabelMaterial(text: string): {
    mat: THREE.SpriteMaterial;
    aspect: number;
  } {
    const cached = this.axisLabelCache.get(text);
    if (cached) return cached;
    const FONT_PX = 44;
    const font = `500 ${FONT_PX}px ui-monospace, "Cascadia Mono", Consolas, monospace`;
    const c = document.createElement("canvas");
    let g = c.getContext("2d")!;
    g.font = font;
    const pad = Math.round(FONT_PX * 0.45);
    c.width = Math.max(4, Math.ceil(g.measureText(text).width) + pad * 2);
    c.height = Math.round(FONT_PX * 1.5);
    // Resizing a canvas resets its context state — re-set everything.
    g = c.getContext("2d")!;
    g.font = font;
    g.fillStyle = "#dfe5ec";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, c.width / 2, c.height / 2);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter; // no mipmaps: NPOT-safe, text stays crisp
    tex.generateMipmaps = false;
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      opacity: AXIS_LABEL_OPACITY * this.terrainOpacity * this.contourRevealK *
        this.focusContourDim,
      depthWrite: false,
    });
    // staticKey() keys terrainGroup children by their materials' uniform
    // values — expose the live opacity through that shape so a mid-scrub
    // reveal/dim change invalidates the software-GL static cache too.
    (mat as unknown as { uniforms: object }).uniforms = {
      uOpacity: {
        get value(): number {
          return mat.opacity;
        },
      },
    };
    const rec = { mat, tex, aspect: c.width / c.height };
    this.axisLabelCache.set(text, rec);
    return rec;
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
   * terrain (like the trails) — and a small triangular head rides the
   * surface at the tip (its three vertices are surface-projected; see
   * shapeArrowHead). Hugging is the point: a straight tangent arrow
   * submerges under any curved sheet, which buried shafts mid-span and left
   * heads floating free of them (visual verdicts n2-1/n2-2).
   * `opts.length` = world length along the horizontal (param) direction
   * (default: a fixed extent fraction — §2/§4 pass actual step magnitudes so
   * arrows stay truthful). Returns the arrow group so callers can remove it
   * again via removeOverlayObject().
   */
  /**
   * Writes the 3 arrow-head vertices into `headGeo`'s position attribute.
   * The tip/base/wings are laid out in PARAMETER space (capped sizes, wings
   * clamped to the extent) and each is then projected onto the surface — so
   * on a convex bowl the whole head rides above the sheet, and top-down the
   * triangle is exactly symmetric (QA F27-ARROWHEAD-BURIED). Shared by
   * addArrow and its in-place update closure so the two cannot drift apart.
   */
  private shapeArrowHead(
    fn: Landscape,
    pos: Vec2,
    ux: number,
    uy: number,
    len: number,
    hLen: number,
    hWidth: number,
    lift: number,
    headGeo: THREE.BufferGeometry,
  ): void {
    const clampToExtent = (q: Vec2): Vec2 => ({
      x: Math.min(fn.extent.xMax, Math.max(fn.extent.xMin, q.x)),
      y: Math.min(fn.extent.yMax, Math.max(fn.extent.yMin, q.y)),
    });
    const tipP = clampToExtent({ x: pos.x + ux * len, y: pos.y + uy * len });
    const baseP = clampToExtent({ x: tipP.x - ux * hLen, y: tipP.y - uy * hLen });
    const px = -uy;
    const py = ux;
    const wingA = clampToExtent({ x: baseP.x + px * hWidth, y: baseP.y + py * hWidth });
    const wingB = clampToExtent({ x: baseP.x - px * hWidth, y: baseP.y - py * hWidth });
    const v = new THREE.Vector3();
    const attr = headGeo.getAttribute("position") as THREE.BufferAttribute;
    let k = 0;
    for (const q of [tipP, wingA, wingB]) {
      this.surfacePoint(fn, q, v, lift);
      attr.setXYZ(k++, v.x, v.y, v.z);
    }
  }

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

    // Head: a small triangle whose three vertices are laid out in PARAMETER
    // space and then projected onto the surface — so on a convex bowl the
    // whole triangle rides above the sheet. (The old tangent-plane head kept
    // the tip's plane across hLen; on curved ground a wing could sit below
    // the surface and get cut off, QA F27-ARROWHEAD-BURIED.) Size is capped
    // at ~diag·0.04 so long arrows keep proportional-but-bounded heads.
    const hLen = Math.min(len * 0.32, this.diag * 0.04);
    const hWidth = hLen * (0.14 / 0.32);
    const headGeo = new THREE.BufferGeometry();
    headGeo.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(9), 3));
    this.shapeArrowHead(fn, pos, ux, uy, len, hLen, hWidth, lift, headGeo);
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
      const hLenL = Math.min(lenL * 0.32, this.diag * 0.04);
      const hWidthL = hLenL * (0.14 / 0.32);
      this.shapeArrowHead(fnL, pos, uxL, uyL, lenL, hLenL, hWidthL, lift, headGeo);
      const headAttr = headGeo.getAttribute("position") as THREE.BufferAttribute;
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
      this.patchOverlayMaterial(mat);
      // A ball created mid-fade must blend from its first draw: an opaque
      // material renders NoBlending, and its alpha≈0 full-RGB pixels showed
      // as a full-bright one-frame flash (QA S2B26-INCOMING-BALL-ALPHA0-FLASH).
      mat.transparent = this.overlayFadeU.value < 0.999;
      this.ball = new THREE.Mesh(geo, mat);
      this.ball.scale.setScalar(r);
      this.overlayGroup.add(this.ball);
      this.ballXrayMesh = null;
      if (this.ballXray) this.attachBallXray();
    }
    const mat = this.ball.material as THREE.MeshLambertMaterial;
    mat.color.set(colorHex);
    mat.emissive.set(colorHex).multiplyScalar(0.28);
    if (this.ballXrayMesh) {
      (this.ballXrayMesh.material as THREE.MeshBasicMaterial).color.set(colorHex);
    }
    this.ball.scale.setScalar(this.diag * 0.02);
    this.ball.position.copy(this.ballCenter(fn, pos, this.ball.position));
    this.ball.visible = true;
  }

  /**
   * X-ray ghost for the learner ball (QA S7-SW2-RASTR-BALL-OCCLUDED part B):
   * a child sphere drawn only where the terrain HIDES the ball
   * (depthFunc Greater, no depth write), so the ball reads at any pitch on
   * Rastrigin's packed pits. The director turns it on for tilt-a only.
   */
  setBallXray(on: boolean): void {
    if (on === this.ballXray) return;
    this.ballXray = on;
    if (on) this.attachBallXray();
    else if (this.ballXrayMesh) this.ballXrayMesh.visible = false;
    this.requestRender();
  }

  private attachBallXray(): void {
    const ball = this.ball;
    if (!ball) return;
    if (this.ballXrayMesh && this.ballXrayMesh.parent === ball) {
      this.ballXrayMesh.visible = true;
      return;
    }
    const color = (ball.material as THREE.MeshLambertMaterial).color;
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      depthTest: true,
      depthFunc: THREE.GreaterDepth,
      side: THREE.FrontSide,
    });
    this.patchOverlayMaterial(mat);
    // Shares the ball's sphere geometry; a child moves and scales with it.
    // disposeDeep frees the shared geometry once with the ball (double
    // geometry.dispose() is a no-op in three).
    const ghost = new THREE.Mesh(ball.geometry, mat);
    ghost.renderOrder = 5;
    ball.add(ghost);
    this.ballXrayMesh = ghost;
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
      // PERF25-S2-GL-LEAK residual: no code path ever disposes pool
      // geometries, so each entry grew its own CircleGeometry — share ONE
      // instance instead (per-entry materials stay: each needs its own map
      // + deferred fade opacity; the fade clones in flushRetired still
      // clone the geometry before disposing).
      if (!this.shadowDiscGeo) this.shadowDiscGeo = new THREE.CircleGeometry(1, 28);
      const mesh = new THREE.Mesh(
        this.shadowDiscGeo,
        new THREE.MeshBasicMaterial({
          map: this.shadowTexture(),
          transparent: true,
          depthWrite: false,
        }),
      );
      this.patchOverlayMaterial(mesh.material as THREE.Material);
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

  /**
   * Preset attitude (Isometric / Map view) — the scene's STANDARD pose:
   * orientation, re-centring AND distance. The zoom resets to the fit
   * computed for the NEW attitude (QA STUDENT-CAM-PRESET-KEEPS-ZOOM /
   * B-3-0: the old carry-the-relative-zoom rule left a deep wheel zoom in
   * place after a preset or a double-click, filling the frame with a
   * featureless gradient with the subject off-frame, under overview copy
   * promising "the Isometric / Map view buttons restore the standard poses"
   * and "double-click to reset"). fitZoomRadius itself is still never
   * written here — the director reads view.fitZoom for its zoom targets,
   * and mutating it on a click would make framing depend on the arrival
   * path again (QA F-2).
   */
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
    this.pan.set(0, 0, 0); // a preset is a canonical framing: re-centre
    this.applyCamera(); // orientation for the new attitude first
    if (this.landscape && this.fitZoomRadius > 0) {
      // Distance: the scene's standard (fit × the registered cam zoom when
      // the step directed one, else the plain fit) — not the user's deep
      // wheel zoom, and not a bare fit that ignores the step's framing.
      const mul = this.resetZoomMul ?? 1;
      const radius = clamp(this.fitAtCurrentAttitude() * mul, this.zoomMin, this.zoomMax);
      this.zoomRadius = radius;
      this.zoomTarget = radius;
      this.applyCamera();
    }
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

  /**
   * Registers the CURRENT step's default pose for double-click reset (the
   * director calls this at setScene time, from the scene's cam spec). A null
   * clears it — a step without a directed camera falls back to Isometric —
   * and any preset remembered from an EARLIER step is forgotten with it.
   */
  setResetAttitude(
    a: { azimuthDeg: number; elevationDeg: number; zoomMul?: number } | null,
  ): void {
    this.resetAttitude = a;
    this.resetZoomMul = a?.zoomMul ?? null;
    this.preset = null;
    this.markPresetButtons(null);
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
   * Refit zoom for the current landscape: pivot the orbit target on the
   * terrain bounding box's TRUE centre (no screen offsets — those live in
   * the frustum, see applyCamera) and size the frustum around the projected
   * box with margin. For an ortho camera the projection of the box centre is
   * the centre of its projected bounds at EVERY attitude, so this pivot
   * never drifts under orbit or zoom (QA CAM-MAPVIEW-FRAMING / CAM-ZOOM-PIVOT
   * — the old baked-in world-space offset rotated with the camera and pushed
   * Map view off the top of the canvas).
   */
  private reframeCamera(): void {
    const fn = this.landscape;
    if (!fn) return;
    this.camDistance = this.diag * 3;
    this.camera.near = this.diag * 0.01;
    this.camera.far = this.diag * 10;
    this.baseTarget.set(0, this.heightWorld / 2, 0);
    this.pan.set(0, 0, 0); // a refit re-centres (new landscape / scene)
    this.applyCamera();

    // Measure at the registered DESTINATION attitude (deterministic fit);
    // the pivot itself is the attitude-independent box centre.
    const savedAz = this.azimuth;
    const savedEl = this.elevation;
    if (this.frameAttitude) {
      this.azimuth = this.frameAttitude.az * DEG;
      this.elevation = this.frameAttitude.el * DEG;
      this.applyCamera();
    }
    const fit = this.fitAtCurrentAttitude();
    this.azimuth = savedAz;
    this.elevation = savedEl;
    this.applyCamera();

    this.zoomRadius = fit;
    this.zoomTarget = fit; // reframe is absolute — the ease has nothing to do
    this.fitZoomRadius = fit;
    this.zoomMin = fit * 0.18;
    this.zoomMax = fit * 3.2;
    this.lastPaneAspect = this.paneAspect(); // the fit was measured at it
    this.applyPaneFit();
    this.applyCamera();
  }

  /**
   * Fit radius that frames the terrain box (margin 1.14, aspect-guarded)
   * with the CURRENT pivot and attitude. Refreshes matrixWorld itself: the
   * pose may have changed since the last render.
   */
  private fitAtCurrentAttitude(): number {
    const fn = this.landscape;
    if (!fn) return this.diag;
    const hx = (fn.extent.xMax - fn.extent.xMin) / 2;
    const hz = (fn.extent.yMax - fn.extent.yMin) / 2;
    this.camera.updateMatrixWorld(); // matrixWorld is otherwise set on render
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const cy of [0, this.heightWorld]) {
      for (const sx of [-hx, hx]) {
        for (const sz of [-hz, hz]) {
          const rel = new THREE.Vector3(sx, cy, sz).sub(this.baseTarget);
          const px = rel.dot(right);
          const py = rel.dot(up);
          minX = Math.min(minX, px); maxX = Math.max(maxX, px);
          minY = Math.min(minY, py); maxY = Math.max(maxY, py);
        }
      }
    }
    const fitOf = (l: number, r: number, b: number, t: number): number =>
      Math.max(r - l, t - b) / 2 * 1.14 / Math.min(1, this.paneAspect());

    // Map attitude only (QA FA-1 / FA-2): the tick labels stand OUTSIDE the
    // domain's left/bottom edges (matplotlib-style), and the exact top-down
    // framing previously fit the bare domain — the bottom-edge labels
    // clipped under the canvas edge (epi-a) and the left-edge labels slid
    // under the docked fit panel (task-a). Two corrections, applied only at
    // exact top-down so every isometric framing stays byte-identical:
    //   1. LABEL BAND — extend the fitted bounds by the outside-label
    //      standoff on the label sides. The frustum centres on the box
    //      pivot, so the extension is doubled: each side gains one full
    //      band of clearance. Orientation-agnostic: whichever world axis
    //      projects along screen-x/y at this attitude contributes.
    //   2. HUD RESERVE — when a HUD column is docked left, the domain (plus
    //      labels) fits and centres in the FREE sub-pane instead of the
    //      whole pane: the fit uses the reduced aspect and the frustum
    //      shifts right by half the column (applyMapHudShift). Capped at
    //      1.45× the plain fit so a huge panel on a narrow pane degrades to
    //      partial clearance instead of shrinking the scene into a stamp.
    if (this.elevation >= 89.9 * DEG) {
      const exR = Math.abs(new THREE.Vector3(1, 0, 0).dot(right));
      const ezR = Math.abs(new THREE.Vector3(0, 0, 1).dot(right));
      const exU = Math.abs(new THREE.Vector3(1, 0, 0).dot(up));
      const ezU = Math.abs(new THREE.Vector3(0, 0, 1).dot(up));
      const bandW = this.diag * (AXIS_LABEL_OUT_FRAC + AXIS_LABEL_H_FRAC);
      const bandX = bandW * (exR + ezR);
      const bandY = bandW * (exU + ezU);
      const paneA = Math.min(1, this.paneAspect());
      const plainFit = fitOf(minX, maxX, minY, maxY);
      const bandFit = fitOf(minX - 2 * bandX, maxX, minY - 2 * bandY, maxY);
      let fit = bandFit;
      this.mapHudShiftPx = 0;
      const cssH = this.container.clientHeight || 1;
      if (this.hudInsetLeftPx > 0) {
        const cssW = this.container.clientWidth || 1;
        const paneW = Math.max(1, cssW - this.paneInsetRightPx);
        const [iL] = this.effectiveHudInsets(paneW);
        if (iL > 0 && iL < paneW * 0.6) {
          // Fit into the FREE sub-pane (right of the column), centred there
          // by applyMapHudShift's window move — capped at 1.45× the plain
          // fit so a huge panel on a narrow pane degrades to partial
          // clearance instead of shrinking the scene into a stamp.
          const freeA = Math.max(0.2, paneA - iL / cssH);
          fit = Math.min(plainFit * 1.45, (bandFit * paneA) / freeA);
          this.mapHudShiftPx = iL / 2;
        }
      }
      return fit;
    }

    // Pane-aware (QA S2A-NARROW-FRAMING-CLIPS-ARROW): the docked reader
    // narrows the visible pane; the frustum itself still spans the canvas.
    return fitOf(minX, maxX, minY, maxY);
  }

  /**
   * The Map preset's frustum shift when a HUD column is docked left (QA
   * FA-1): the reserved fit centres the domain in the FREE sub-pane, which
   * needs the window moved right by half the column. Screen-space px, like
   * frameOffsetX — exact at the current zoom, zero unless a map fit reserved
   * a column. applyCamera applies it only at exact top-down, so isometric
   * poses (and everything keyed to them) never see it.
   */
  private mapHudShiftPx = 0;

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
    // Screen-space framing offsets (QA CAM-ZOOM-PIVOT / CAM-MAPVIEW-FRAMING):
    // shift the frustum window instead of the orbit target, so the offsets
    // are exact CSS px at the CURRENT zoom on every call, hold at any
    // attitude, and every zoom/orbit/preset pivots on the true content
    // centre. +sx on left/right shows content further +X ⇒ content moves
    // LEFT on screen (the pane left of the docked reader); +sy ⇒ content
    // moves DOWN (the hero's race drop).
    const wpp = (2 * this.zoomRadius) / (this.container.clientHeight || 1);
    // Map-preset HUD reserve (QA FA-1): the window shift that centres the
    // fit in the free sub-pane right of a docked HUD column. Top-down only,
    // so isometric poses never see it.
    const mxs =
      this.elevation >= 89.9 * DEG ? this.mapHudShiftPx * wpp : 0;
    const sx = this.frameOffsetXPx * wpp - mxs;
    const sy = this.frameOffsetPx * wpp;
    // The director's reveal nudge: +x moves content RIGHT (window −X),
    // +y moves content DOWN (window +Y) — same screen-space semantics.
    const nx = this.revealNudge.x * wpp;
    const ny = this.revealNudge.y * wpp;
    this.camera.left = -this.zoomRadius * aspect + sx - nx;
    this.camera.right = this.zoomRadius * aspect + sx - nx;
    this.camera.top = this.zoomRadius + sy + ny;
    this.camera.bottom = -this.zoomRadius + sy + ny;

    const e = this.elevation;
    const a = this.azimuth;
    const ce = Math.cos(e);
    const se = Math.sin(e);
    const sa = Math.sin(a);
    const ca = Math.cos(a);
    // The pan clamp runs on EVERY camera update (drag, orbit, zoom, preset,
    // resize, framing offset), so no path can push the terrain out of frame.
    this.clampPan(aspect, sx, nx, sy + ny, ca, sa, ce, se);
    this.target.copy(this.baseTarget).add(this.pan);
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

  /**
   * Pan clamp — the landscape can never leave the visible pane, at any
   * attitude INCLUDING Map view. Works in the camera's screen plane
   * (p = pan·right, q = pan·up, world units relative to the box centre):
   *
   *  1. Box rule, per axis: when the projected terrain box FITS the pane on
   *     that axis it must stay fully inside it; when it is LARGER (zoomed
   *     in) the pane must stay inside the box's projected bounds.
   *  2. Footprint rule: the pane centre must stay over the terrain's
   *     projected footprint (mid-height parallelogram), inflated by the
   *     zoomed-out slack so the rule is continuous across zoom — this stops
   *     a deep zoom from parking the pane in an empty corner of the box's
   *     bounding rect.
   *
   * Both regions are convex and contain p = 0 (the choreographed framing is
   * never moved by the clamp); alternating projections settle on a point in
   * their intersection. The pan's along-view component is left alone (it
   * does not change an orthographic image).
   */
  private clampPan(
    aspect: number, sx: number, nx: number, syy: number,
    ca: number, sa: number, ce: number, se: number,
  ): void {
    const fn = this.landscape;
    if (!fn || (this.pan.x === 0 && this.pan.y === 0 && this.pan.z === 0)) return;
    // Camera basis (see applyCamera): right = (ca, 0, −sa), up = (−se·sa, ce, −se·ca).
    const rx = ca, ry = 0, rz = -sa;
    const ux = -se * sa, uy = ce, uz = -se * ca;
    const p0 = this.pan.x * rx + this.pan.y * ry + this.pan.z * rz;
    const q0 = this.pan.x * ux + this.pan.y * uy + this.pan.z * uz;

    // Visible pane relative to the target (the docked reader covers the
    // right 2·sx of the frustum — see setFrameOffsetX).
    const Ra = this.zoomRadius * aspect;
    // Opaque HUD columns tighten the pane (QA S2CAM-PAN-BEHIND-HUD).
    const hCss = this.container.clientHeight || 1;
    const wppC = (2 * this.zoomRadius) / hCss;
    const basePaneW = (this.container.clientWidth || 1) - 2 * Math.max(0, this.frameOffsetXPx);
    const [iL, iR] = this.effectiveHudInsets(basePaneW);
    const wl = -Ra + sx - nx + iL * wppC;
    const wr = Ra + sx - nx - 2 * Math.max(0, sx) - iR * wppC;
    const wb = -this.zoomRadius + syy;
    const wt = this.zoomRadius + syy;
    const hw = Math.max(1e-6, (wr - wl) / 2);
    const hh = Math.max(1e-6, (wt - wb) / 2);
    const cxw = (wl + wr) / 2;
    const cyw = (wb + wt) / 2;

    // Projected terrain box (relative to the box centre).
    const hx = (fn.extent.xMax - fn.extent.xMin) / 2;
    const hz = (fn.extent.yMax - fn.extent.yMin) / 2;
    const hy = this.heightWorld / 2;
    let bMinX = Infinity, bMaxX = -Infinity, bMinY = Infinity, bMaxY = -Infinity;
    const foot: { x: number; y: number }[] = [];
    for (const cy of [-hy, hy]) {
      for (const [cx, cz] of [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]] as const) {
        const px = cx * rx + cy * ry + cz * rz;
        const py = cx * ux + cy * uy + cz * uz;
        bMinX = Math.min(bMinX, px); bMaxX = Math.max(bMaxX, px);
        bMinY = Math.min(bMinY, py); bMaxY = Math.max(bMaxY, py);
        if (cy > 0) foot.push({ x: cx * rx + cz * rz, y: cx * ux + cz * uz }); // mid-height
      }
    }
    // Rule 1 interval per axis (always containing 0). The box spans
    // [bMin − p, bMax − p] relative to the target.
    const axisRange = (bMin: number, bMax: number, lo: number, hi: number): [number, number] => {
      const a1 = bMax - hi; // box's far edge on the pane's far edge
      const a2 = bMin - lo; // box's near edge on the pane's near edge
      return [Math.min(a1, a2, 0), Math.max(a1, a2, 0)];
    };
    const [pLo, pHi] = axisRange(bMinX, bMaxX, wl, wr);
    const [qLo, qHi] = axisRange(bMinY, bMaxY, wb, wt);

    // Rule 2 region: hull of (footprint ⊕ slack rect) in p-space, plus 0.
    // The pane centre sits at (p + cxw, q + cyw) relative to the box centre.
    const ex = Math.max(0, hw - (bMaxX - bMinX) / 2);
    const ey = Math.max(0, hh - (bMaxY - bMinY) / 2);
    const pts: { x: number; y: number }[] = [{ x: 0, y: 0 }];
    for (const f of foot) {
      for (const [dx, dy] of [[-ex, -ey], [ex, -ey], [ex, ey], [-ex, ey]] as const) {
        pts.push({ x: f.x + dx - cxw, y: f.y + dy - cyw });
      }
    }
    const hull = convexHull(pts);

    // Exact nearest feasible pan: project onto (hull ∩ box-rule rectangle).
    // Both contain the origin, so the intersection is a non-empty convex
    // polygon (alternating projections crawled on the thin low-pitch hulls).
    const region = clipPolygonToRect(hull, pLo, pHi, qLo, qHi);
    const c = region.length > 0 ? clampToConvex(region, p0, q0) : { x: 0, y: 0 };
    const p = clamp(c.x, pLo, pHi);
    const q = clamp(c.y, qLo, qHi);
    const dp = p - p0;
    const dq = q - q0;
    if (dp !== 0 || dq !== 0) {
      this.pan.x += rx * dp + ux * dq;
      this.pan.y += ry * dp + uy * dq;
      this.pan.z += rz * dp + uz * dq;
    }
  }

  /** Re-centres a user pan on the terrain (choreographed framing). */
  resetPan(): void {
    if (this.pan.x === 0 && this.pan.y === 0 && this.pan.z === 0) return;
    this.pan.set(0, 0, 0);
    this.applyCamera();
    this.requestRender();
  }

  /**
   * Pan diagnostics (gates / probes): the screen-plane pan in world units
   * and CSS px, and the projected terrain box + footprint in canvas CSS px
   * next to the visible pane (the canvas minus the docked reader strip).
   */
  get panInfo(): {
    world: { x: number; y: number; z: number };
    px: { x: number; y: number };
    box: { minX: number; maxX: number; minY: number; maxY: number };
    pane: { left: number; right: number; top: number; bottom: number };
    centerOverFootprint: boolean;
    /** Visible share of the terrain footprint (mid-height, projected):
     *  area(footprint ∩ pane) / min(area(footprint), area(pane)). */
    footprintVisible: number;
  } {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    const wpp = (2 * this.zoomRadius) / h;
    const a = this.azimuth, e = this.elevation;
    const right = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
    const up = new THREE.Vector3(-Math.sin(e) * Math.sin(a), Math.cos(e), -Math.sin(e) * Math.cos(a));
    const fn = this.landscape;
    this.camera.updateMatrixWorld();
    const proj = (v: THREE.Vector3): { x: number; y: number } => {
      const n = v.clone().project(this.camera);
      return { x: (n.x + 1) / 2 * w, y: (1 - n.y) / 2 * h };
    };
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const foot: { x: number; y: number }[] = [];
    if (fn) {
      const hx = (fn.extent.xMax - fn.extent.xMin) / 2;
      const hz = (fn.extent.yMax - fn.extent.yMin) / 2;
      for (const cy of [0, this.heightWorld]) {
        for (const [cx, cz] of [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]] as const) {
          const s = proj(new THREE.Vector3(cx, cy, cz));
          minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x);
          minY = Math.min(minY, s.y); maxY = Math.max(maxY, s.y);
        }
        for (const [cx, cz] of [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]] as const) {
          if (cy === 0) foot.push(proj(new THREE.Vector3(cx, this.heightWorld / 2, cz)));
        }
      }
    }
    const basePaneW = w - 2 * Math.max(0, this.frameOffsetXPx);
    const [iL, iR] = this.effectiveHudInsets(basePaneW);
    const pane = { left: iL, right: basePaneW - iR, top: 0, bottom: h };
    const cxp = (pane.left + pane.right) / 2;
    const cyp = h / 2;
    // Pane centre over the (screen-space) footprint parallelogram?
    let inside = foot.length === 4;
    for (let i = 0; i < foot.length && inside; i++) {
      const p1 = foot[i], p2 = foot[(i + 1) % foot.length];
      const cross = (p2.x - p1.x) * (cyp - p1.y) - (p2.y - p1.y) * (cxp - p1.x);
      const ref = (p2.x - p1.x) * (foot[(i + 2) % 4].y - p1.y) - (p2.y - p1.y) * (foot[(i + 2) % 4].x - p1.x);
      if (cross * ref < -1e-6) inside = false;
    }
    let footprintVisible = 0;
    if (foot.length === 4) {
      const hullF = convexHull(foot);
      const vis = clipPolygonToRect(hullF, pane.left, pane.right, pane.top, pane.bottom);
      const denom = Math.min(polygonArea(hullF), (pane.right - pane.left) * (pane.bottom - pane.top));
      footprintVisible = denom > 0 ? polygonArea(vis) / denom : 0;
    }
    return {
      footprintVisible,
      world: { x: this.pan.x, y: this.pan.y, z: this.pan.z },
      px: { x: this.pan.dot(right) / wpp, y: this.pan.dot(up) / wpp },
      box: { minX, maxX, minY, maxY },
      pane,
      centerOverFootprint: inside,
    };
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
    window.addEventListener("contextmenu", this.onWindowContextMenu, { capture: true });
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
      this.dragging = false;
      this.panning = false;
      this.endStuckPuppet();
    }
    // Every pointer is tracked: two down = pinch zoom (QA cam-4).
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2 && !this.puppetDrag) {
      // A second finger cancels any single-pointer gesture and starts the
      // pinch; the spread drives zoomRadius exactly like the wheel.
      this.dragging = false;
      this.panning = false;
      const [a, b] = [...this.pointers.values()];
      this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      this.capturePointer(e);
      return;
    }
    if (e.button !== 0 && e.button !== 2) return;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.lastMoveTime = e.timeStamp;
    // A new drag grip stops any glide from the previous flick.
    this.azimVel = 0;
    this.elevVel = 0;
    this.capturePointer(e);
    if (e.button === 2) {
      // RIGHT-drag ORBITS (user scheme 2026-11-09; was a dolly). The
      // canvas context menu is suppressed (bindPointer) so the drag is free.
      this.dragging = true;
      this.dragMoved = false;
      // The user grabbed the camera: in-flight choreography must yield, or
      // its per-frame setAttitude would overwrite every drag delta.
      this.opts.onUserOrbitStart?.();
      return;
    }
    // LEFT button: listeners get first claim on the drag (e.g. grabbing the
    // learner point); an unclaimed left-drag PANS the view.
    if (this.opts.onDragStart?.(e)) {
      this.puppetDrag = true;
      return;
    }
    this.panning = true;
    this.opts.onUserOrbitStart?.(); // camera tweens yield to a pan grip too
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
    if (this.puppetDrag) {
      this.opts.onDragMove?.(e);
      return;
    }
    if (this.panning) {
      // LEFT-drag PAN: translate the orbit target in the camera's screen
      // plane so the terrain follows the cursor 1:1 (world-per-px at the
      // current zoom); applyCamera clamps it inside the pane.
      const pdx = e.clientX - this.lastX;
      const pdy = e.clientY - this.lastY;
      if (pdx === 0 && pdy === 0) return;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      const wpp = (2 * this.zoomRadius) / (this.container.clientHeight || 1);
      const a = this.azimuth, el = this.elevation;
      const ca = Math.cos(a), sa = Math.sin(a), ce = Math.cos(el), se = Math.sin(el);
      // drag right ⇒ content right ⇒ target moves −right; drag down ⇒ +up.
      this.pan.x += (-pdx * ca + pdy * -se * sa) * wpp;
      this.pan.y += (pdy * ce) * wpp;
      this.pan.z += (-pdx * -sa + pdy * -se * ca) * wpp;
      this.applyCamera();
      this.requestRender();
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
    if (this.puppetDrag) {
      this.puppetDrag = false;
      this.opts.onDragEnd?.(e);
      return;
    }
    if (this.panning) {
      this.panning = false;
      if (this.renderer.domElement.hasPointerCapture(e.pointerId)) {
        this.renderer.domElement.releasePointerCapture(e.pointerId);
      }
      return;
    }
    if (!this.dragging) return;
    this.dragging = false;
    // The right-button release fires contextmenu wherever the cursor is now
    // (capture is gone) — swallow it page-wide briefly (see bindPointer).
    this.suppressContextUntil = performance.now() + 400;
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

  /** Swallows the contextmenu a right-drag orbit's release fires off-canvas. */
  private onWindowContextMenu = (e: MouseEvent): void => {
    if (performance.now() < this.suppressContextUntil) e.preventDefault();
  };

  /** Window blur ends every gesture — the release may never be delivered. */
  private onWindowBlur = (): void => {
    if (
      this.pointers.size === 0 &&
      !this.dragging &&
      !this.puppetDrag &&
      !this.panning
    ) {
      return;
    }
    this.pointers.clear();
    this.pinchDist = 0;
    this.panning = false;
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
    // Normalize line/page-mode wheels to px (QA F16-DELTAMODE-DEAD, optional
    // consistency fix): a raw line delta of 3 zoomed ~1/32 as far as a
    // pixel-mode notch. deltaY is read before deltaMode (Firefox hedge).
    const dyRaw = e.deltaY;
    const dy =
      e.deltaMode === 1 ? dyRaw * 32
        : e.deltaMode === 2 ? dyRaw * (this.renderer.domElement.clientHeight || 1)
          : dyRaw;
    this.zoomTarget = clamp(
      this.zoomTarget * Math.exp(dy * 0.0012 * zoomSens),
      this.zoomMin,
      this.zoomMax,
    );
    // The loop integrates the approach; a render is only needed once it moves.
  };

  /**
   * Double-click resets the pose to where the step started: the user's
   * last preset IN THIS STEP, else the step's directed default
   * (setResetAttitude), else Isometric — orientation, centring AND distance
   * (QA B-3-0: the copy promises "double-click to reset"; keeping the
   * user's zoom made a deep zoom unrescuable by any affordance).
   */
  private onDblClick = (): void => {
    if (this.dragging || this.puppetDrag || this.panning) return;
    // Reset is about WHERE and HOW FAR you look: the pan re-centres with the
    // attitude (setPreset re-centres itself; the directed-attitude branch
    // needs this), and the directed branch restores the scene's standard
    // distance — fitZoom × the registered cam zoom (QA B-3-0).
    this.pan.set(0, 0, 0);
    if (this.preset) this.setPreset(this.preset);
    else if (this.resetAttitude) {
      this.setAttitude(
        this.resetAttitude.azimuthDeg,
        this.resetAttitude.elevationDeg,
        this.resetZoomMul != null ? this.fitZoom * this.resetZoomMul : undefined,
      );
    } else {
      this.setPreset("iso");
    }
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
      // A USER preset click ends in-flight camera choreography exactly like
      // a drag does (QA S2CAM-PRESET-DURING-TWEEN): the director's live
      // tweens / Skip snap would otherwise overwrite the preset.
      btn.addEventListener("click", () => {
        this.opts.onUserOrbitStart?.();
        this.setPreset(preset);
      });
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
    // f can be NaN (Inf−Inf in Rosenbrock) for a diverged run's points:
    // clamp() would pass NaN straight into the geometry (QA S8-DIVERGE-STREAKS).
    const fv = fn.f(p);
    const t = Number.isFinite(fv) ? clamp((fv - this.hMin) / this.hRange, 0, 1) : 1;
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
    // Axis objects first: the generic loop below disposeDeep's everything
    // left in terrainGroup, and the sprites' cached materials/textures (plus
    // three's shared sprite geometry) must survive the next rebuild.
    this.removeAxisFrame();
    const terrain = this.terrainMesh;
    this.terrainMesh = null;
    this.contourMat = null;
    this.contourLines = null; // disposeDeep below frees the lines' resources
    for (const child of [...this.terrainGroup.children]) {
      this.terrainGroup.remove(child);
      if (child === terrain) {
        (child as THREE.Mesh).geometry?.dispose();
        continue;
      }
      disposeDeep(child, this.deferredMatDispose);
    }
  }

  /** Removes trails/arrows/ball, disposing their GPU resources. */
  private clearOverlays(): void {
    // Retired overlays (crossfade fade-out) are at opacity 0 by the time a
    // rebuild lands — dispose them here (QA F26-CROSSFADE-BALL-CUT).
    this.flushRetired();
    this.trails = [];
    this.ball = null;
    for (const child of [...this.overlayGroup.children]) {
      this.overlayGroup.remove(child);
      disposeDeep(child, this.deferredMatDispose);
    }
  }

  /** Disposes the materials queued by disposeDeep (deduped: a trail line can
   *  be queued by clearOverlays AND its own AnimatedTrail.dispose). Runs right
   *  after a render, when the replacement same-key materials have already
   *  acquired the cached GL programs. */
  private flushDeferredMaterials(): void {
    if (this.deferredMatDispose.length === 0) return;
    const q = this.deferredMatDispose;
    this.deferredMatDispose = [];
    for (const m of new Set(q)) m.dispose();
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
    // Keep the user's zoom relative to the fit across aspect changes. The
    // fit widens as min(1, aspect) shrinks (reframeCamera), and the layout
    // offset path no longer re-fits (the offsets are a frustum shift in
    // applyCamera), so resize must adapt the radii itself. Scaling every
    // radius by the same factor keeps the zoom user-owned; a re-fit would
    // stomp it.
    this.rescaleForPane();
    this.applyPaneFit();
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
    if (this.autoOrbitDegPerSec !== 0 && !this.dragging && !this.puppetDrag && !this.panning) {
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
    // Motion tier (QA SCRUB-HITCH): apply INSIDE rAF — setPixelRatio
    // reallocates and clears the canvas, so a change outside the frame
    // would flash a blank frame.
    if (this.pendingMotionTier !== null) {
      const on = this.pendingMotionTier;
      this.pendingMotionTier = null;
      this.motionTier = on;
      this.renderer.setPixelRatio(on ? 0.35 : this.steadyPixelRatio);
      setTrailGlowSuppressed(on);
    }
    // The ring's ball occluder tracks the ball/camera of THIS frame (the
    // director moves the ball in onFrame, after the spot block above).
    if (this.spotRing?.visible) this.updateSpotOccluder();
    // PERF25-S2-LAB-REBUILD-LONGTASKS: the §5 live-rebuild throttle backs
    // off on rebuild + render cost, so time the render pass.
    const renderT0 = performance.now();
    this.renderFrame();
    this.renderCostMs = performance.now() - renderT0;
    this.flushDeferredMaterials();
  };

  /**
   * Renders one frame. Under software GL with the motion tier on — and only
   * when the scene qualifies (no fog, opaque terrain) — the terrain layer is
   * drawn into a cached render target whose key covers every static-layer
   * mutator, and the frame composites that cache with the live overlays
   * depth-tested against the cached depth. Under SwiftShader the terrain
   * fill is the single biggest per-frame GPU cost (6-17ms at the tier's
   * 800×450), and it is identical frame-to-frame during a scrub (QA
   * SCRUB-HITCH round 3). Hardware GL, fog scenes and translucent terrain
   * take the direct path unchanged.
   */
  private renderFrame(): void {
    const eligible =
      this.softwareGL &&
      this.motionTier &&
      !this.fogEnabled &&
      this.terrainOpacity >= 0.999;
    if (!eligible) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    const key = this.staticKey();
    if (key !== this.staticCacheKey) {
      this.rebuildStaticCache();
      this.staticCacheKey = key;
    }
    // Pass 1: blit the cached terrain (colour + depth).
    this.renderer.render(this.staticQuadScene, this.staticQuadCam);
    // Pass 2: overlays only, depth-tested against the cached terrain depth.
    const bg = this.scene.background;
    this.scene.background = null;
    this.terrainGroup.visible = false;
    this.renderer.autoClear = false;
    this.renderer.render(this.scene, this.camera);
    this.renderer.autoClear = true;
    this.terrainGroup.visible = true;
    this.scene.background = bg;
  }

  /**
   * One string covering every static-layer mutator (setLandscape,
   * setTerrainRise, setTerrainOpacity, setContourReveal, setFocusDim, fog
   * bind, orbit, zoom, resize). uOverlayFade is deliberately absent: it only
   * patches overlay materials, which are not in the cache.
   */
  private staticKey(): string {
    const v2 = new THREE.Vector2();
    this.renderer.getDrawingBufferSize(v2);
    const parts: string[] = [
      `${v2.x}x${v2.y}`,
      String(this.terrainGroup.visible),
      String(this.terrainGroup.scale.y),
      String(this.terrainGroup.children.length),
    ];
    const bg = this.scene.background;
    parts.push(bg === null || bg === undefined ? "none" : bg instanceof THREE.Color ? String(bg.getHex()) : String(bg.uuid));
    for (const child of this.terrainGroup.children) {
      parts.push(child.uuid, String(child.visible));
      const mesh = child as THREE.Mesh;
      const mat = mesh.material as THREE.ShaderMaterial | undefined;
      if (mat && mat.uniforms) {
        for (const name of ["uOpacity", "uDim", "uFogLift", "uGlowStrength"]) {
          const u = mat.uniforms[name];
          if (u) parts.push(String(u.value));
        }
        const fog = mat.uniforms?.uFog?.value as THREE.Texture | undefined;
        if (fog) parts.push(fog.uuid, String(fog.version));
      }
    }
    this.camera.updateMatrixWorld();
    parts.push(
      ...Array.from(this.camera.matrixWorld.elements, (x) => x.toFixed(6)),
      ...Array.from(this.camera.projectionMatrix.elements, (x) => x.toFixed(6)),
    );
    return parts.join("|");
  }

  /** Builds/resizes the static-layer cache (RT + fullscreen blit quad). */
  private rebuildStaticCache(): void {
    const v2 = new THREE.Vector2();
    this.renderer.getDrawingBufferSize(v2);
    if (!this.staticRT) {
      const rt = new THREE.WebGLRenderTarget(1, 1, {
        type: THREE.HalfFloatType, // three renders working-space linear; 8-bit would band
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        depthBuffer: true,
        depthTexture: new THREE.DepthTexture(1, 1),
      });
      this.staticRT = rt;
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          tColor: { value: rt.texture },
          tDepth: { value: rt.depthTexture },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = vec4(position.xy, 0.0, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform sampler2D tColor;
          uniform sampler2D tDepth;
          varying vec2 vUv;
          void main() {
            gl_FragColor = texture2D(tColor, vUv);
            gl_FragDepth = texture2D(tDepth, vUv).x;
            #include <colorspace_fragment>
          }
        `,
        depthTest: true,
        depthWrite: true,
        depthFunc: THREE.AlwaysDepth,
        blending: THREE.NoBlending,
        toneMapped: false,
      });
      this.staticQuadMat = mat;
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
      quad.frustumCulled = false;
      this.staticQuad = quad;
      this.staticQuadScene.add(quad);
    }
    if (!this.staticRT || !this.staticQuadMat || !this.staticQuad) return;
    const rt = this.staticRT;
    if (rt.width !== v2.x || rt.height !== v2.y) {
      rt.setSize(v2.x, v2.y);
      const dtex = rt.depthTexture;
      if (dtex) {
        dtex.image.width = v2.x;
        dtex.image.height = v2.y;
      }
    }
    // Hide everything except terrain + lights, render into the RT, restore.
    const hidden: Array<{ obj: THREE.Object3D; was: boolean }> = [];
    for (const child of this.scene.children) {
      if (child === this.terrainGroup || (child as THREE.Light).isLight) continue;
      hidden.push({ obj: child, was: child.visible });
      child.visible = false;
    }
    this.renderer.setRenderTarget(this.staticRT);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    for (const h of hidden) h.obj.visible = h.was;
  }

  /**
   * Software-GL-only "motion tier" (QA SCRUB-HITCH round 2): while ON, the
   * canvas renders at reduced pixel ratio (0.35 in round 3 — the terrain
   * cache needs the extra cut) and the trail glow passes hide. No-op on
   * hardware GL, where every frame already fits the vsync. Applied at the
   * next rendered frame to avoid a blank flash.
   */  setMotionTier(on: boolean): void {
    if (!this.softwareGL || this.motionTier === on) return;
    this.pendingMotionTier = on;
    this.dirty = true;
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.flushDeferredMaterials();
    // Static-layer cache (QA SCRUB-HITCH r3).
    const dtex = this.staticRT?.depthTexture ?? null;
    dtex?.dispose();
    this.staticRT?.dispose();
    this.staticRT = null;
    this.staticQuadMat?.dispose();
    this.staticQuadMat = null;
    this.staticQuad?.geometry.dispose();
    this.staticQuad = null;
    this.staticCacheKey = null;

    const el = this.renderer.domElement;
    el.removeEventListener("pointerdown", this.onPointerDown);
    el.removeEventListener("pointermove", this.onPointerMove);
    el.removeEventListener("pointerup", this.onPointerUp);
    el.removeEventListener("pointercancel", this.onPointerUp);
    el.removeEventListener("lostpointercapture", this.onLostCapture);
    el.removeEventListener("wheel", this.onWheel);
    el.removeEventListener("dblclick", this.onDblClick);
    window.removeEventListener("contextmenu", this.onWindowContextMenu, { capture: true });
    window.removeEventListener("pointerup", this.onWindowPointerUp, { capture: true });
    window.removeEventListener("pointercancel", this.onWindowPointerUp, { capture: true });
    window.removeEventListener("blur", this.onWindowBlur);

    this.clearTerrain();
    this.clearOverlays();
    this.flushDeferredMaterials();
    this.terrainMaterial?.dispose();
    this.terrainMaterial = null;
    this.terrainGridN = -1;
    // Axis-frame cache (COPY-PLAN §4.1): the view is gone — free every
    // cached label texture + material and the hairline material.
    for (const rec of this.axisLabelCache.values()) {
      rec.tex.dispose();
      rec.mat.dispose();
    }
    this.axisLabelCache.clear();
    this.axisLineMat?.dispose();
    this.axisLineMat = null;
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

/**
 * Tick values for the 3D axis frame — the compass minimap's niceTicks rule
 * mirrored (span/4, 1/2/5 mantissa — CompassMinimap.ts) so the two can never
 * disagree about where a tick sits.
 */
function niceAxisTicks(min: number, max: number): number[] {
  const span = max - min;
  const raw = span / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  let step = pow;
  for (const m of [1, 2, 5, 10]) {
    if (raw <= m * pow) {
      step = m * pow;
      break;
    }
  }
  const out: number[] = [];
  for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + 1e-9; v += step) {
    out.push(Math.abs(v) < step / 2 ? 0 : Math.round(v * 100) / 100);
  }
  return out;
}

/** "w = −1" tick text: unicode minus, up to 2 decimals. */
function fmtAxisTick(v: number): string {
  return String(v).replace("-", "\u2212");
}

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

/**
 * Frees an object tree's GPU resources. Geometries go now; materials go to
 * `sink` when one is given (LandscapeView's deferred-dispose queue, drained
 * right after the next render — QA SEC5-S2-REBUILD-COST-JANK /
 * PERF25-S2-LAB-REBUILD-LONGTASKS: releasing the last user of a GL program
 * deletes it, and the replacement material then pays a synchronous
 * compile/link on its first draw).
 */
function disposeDeep(obj: THREE.Object3D, sink?: THREE.Material[]): void {
  obj.traverse((node) => {
    // InstancedMesh.dispose() fires the 'dispose' event that makes three free
    // its instanceMatrix/instanceColor GL buffers; geometry.dispose() alone
    // does not (QA PERF25-S2-GL-LEAK-CROSSFADE).
    if ((node as THREE.InstancedMesh).isInstancedMesh) (node as THREE.InstancedMesh).dispose();
    const mesh = node as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = (mesh as unknown as { material?: THREE.Material | THREE.Material[] }).material;
    const mats = Array.isArray(mat) ? mat : mat ? [mat] : [];
    for (const m of mats) {
      if (sink) sink.push(m);
      else m.dispose();
    }
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
