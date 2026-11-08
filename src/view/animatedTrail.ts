/**
 * AnimatedTrail — a precomputed optimizer path rendered as an animated draw
 * head advancing along the path.
 *
 * Each trail is TWO fat lines sharing one reveal counter:
 *   • a soft ADDITIVE glow pass (wide, low alpha) — the "light" of the trail;
 *   • a normal-blended CORE pass (thin, full color) — keeps the optimizer's
 *     identity color readable even over the terrain's bright mid-heights
 *     (pure additive washes out to white there).
 *
 * Both polylines (positions + per-vertex fade colors) upload ONCE; animation
 * only moves `geometry.instanceCount`, so a 60 fps reveal costs no per-frame
 * GPU uploads. Colors fade with distance back from the newest point — soft
 * glow, never harsh bloom (visual bar).
 */

import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import * as THREE from "three";
import type { Vec2 } from "../core/functions";
import type { LandscapeView } from "./LandscapeView";

/* ---------------- hover-to-look focus dim ----------------
 * Trails manage their own opacity (setAlpha is a per-trail base the class
 * re-applies), so the view's generic overlay dimmer must NOT touch trail
 * materials — dimming happens here, per instance, driven by the director:
 * `setTrailFocus(dim, kept)` dims every live trail to `dim` except the
 * spotlighted ("kept") ones, which stay at full brightness. */

/** Every live AnimatedTrail (removed on dispose). */
const liveTrails = new Set<AnimatedTrail>();
/** Materials the generic overlay dimmer must skip (self-managed here). */
export const TRAIL_MATERIALS = new WeakSet<THREE.Material>();
let trailDim = 1;

/** Hover-to-look: dim all live trails to `dim`, except the `kept` set. */
export function setTrailFocus(
  dim: number,
  kept: ReadonlySet<AnimatedTrail> | null,
): void {
  trailDim = Math.min(1, Math.max(0, dim));
  for (const t of liveTrails) {
    t.kept = kept?.has(t) ?? false;
    t.applyAlpha();
  }
}

export class AnimatedTrail {
  readonly path: readonly Vec2[];

  private readonly lines: Line2[] = [];
  private readonly mats: LineMaterial[] = [];
  private readonly segments: number;
  /** Multiplier on the ADDITIVE glow pass (the core pass is untouched).
   *  Trails that fold tightly (§3's β=0.97 overshoot bunches) stack many
   *  glow lines per pixel; unclamped, the stack saturates to a white-hot
   *  knot (visual verdict round 4) — such callers pass glow < 1. */
  private readonly glow: number;
  private disposed = false;
  /** setAlpha's base (callers think in "reveal alpha"); opacity is derived
   *  from base × focus dim so hover-to-look dimming composes cleanly. */
  baseAlpha = 1;
  /** Spotlighted by hover-to-look: exempt from the focus dim. */
  kept = false;

  constructor(
    private readonly view: LandscapeView,
    path: readonly Vec2[],
    colorHex: number,
    fadePower = 1.6,
    glow = 1,
  ) {
    if (path.length < 2) throw new Error("AnimatedTrail needs >= 2 points");
    this.path = path;
    this.segments = path.length - 1;
    this.glow = glow;

    const base = new THREE.Color(colorHex);
    const size = view.canvasSize;
    const lift = view.trailLift + view.diagonal * 0.012;

    const mkColors = (tail: number, head: number): number[] => {
      const out: number[] = [];
      for (let i = 0; i < path.length; i++) {
        const t = i / this.segments;
        const k = tail + (head - tail) * Math.pow(t, fadePower);
        out.push(base.r * k, base.g * k, base.b * k);
      }
      return out;
    };

    const mkLine = (colors: number[], widthPx: number, additive: boolean): Line2 => {
      const positions: number[] = [];
      const p = new THREE.Vector3();
      for (const pt of path) {
        view.parameterToWorld(pt, lift, p);
        positions.push(p.x, p.y, p.z);
      }
      const geo = new LineGeometry();
      geo.setPositions(positions);
      geo.setColors(colors);
      geo.instanceCount = 0; // hidden until the first setProgress()

      const mat = new LineMaterial({
        vertexColors: true,
        worldUnits: false,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        resolution: new THREE.Vector2(size.x, size.y),
      });
      TRAIL_MATERIALS.add(mat);
      // `linewidth` exists on LineMaterial (three sets/gets it) but is missing
      // from @types/three 0.186 — assign through a narrow cast (same as view).
      (mat as unknown as { linewidth: number }).linewidth = widthPx;

      const line = new Line2(geo, mat);
      line.computeLineDistances();
      line.renderOrder = 2;
      line.frustumCulled = false;
      view.addOverlayObject(line);
      this.lines.push(line);
      this.mats.push(mat);
      return line;
    };

    // Glow first (drawn under), core second (crisp identity color on top).
    // The glow pass's width and brightness both scale with `glow`. Trimmed
    // against the two-light terrain grade: the wide additive pass sits lower
    // so stacked trail segments glow without washing out to white.
    mkLine(mkColors(0.04, 0.44), 5.2 * this.glow, true);
    mkLine(mkColors(0.3, 1.0), 2.2, false);
    liveTrails.add(this);
    this.applyAlpha();
  }

  /** True once disposed (live-registry consumers skip dead trails). */
  get isDisposed(): boolean {
    return this.disposed;
  }

  /** 0 = nothing drawn, 1 = whole path drawn (quantized to whole segments). */
  setProgress(t: number): void {
    if (this.disposed) return;
    const k = Math.round(Math.min(1, Math.max(0, t)) * this.segments);
    for (const line of this.lines) {
      (line.geometry as LineGeometry).instanceCount = k;
    }
  }

  setAlpha(a: number): void {
    if (this.disposed) return;
    this.baseAlpha = Math.min(1, Math.max(0, a));
    this.applyAlpha();
  }

  /** opacity = baseAlpha × (kept ? 1 : focus dim), per pass. */
  applyAlpha(): void {
    const k = this.baseAlpha * (this.kept ? 1 : trailDim);
    // mats[0] is the additive glow; mats[1] the solid core.
    this.mats[0].opacity = 0.5 * k * this.glow;
    this.mats[1].opacity = k;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    liveTrails.delete(this);
    for (const line of this.lines) this.view.removeOverlayObject(line);
  }
}
