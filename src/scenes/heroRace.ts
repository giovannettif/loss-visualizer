/**
 * HeroRace — the hero's looping three-optimizer animation.
 *
 * Three trails (GD red, momentum blue, Adam yellow) launch from the SAME
 * start point on the rotated bowl, easing along precomputed trajectories
 * from src/core/optimizers. Timeline (~8 s loop):
 *
 *   0.0 … 6.6   draw heads race along their paths (each eased in-out;
 *               Adam arrives ~3.4 s, momentum ~4.8 s, GD ~6.6 s)
 *   6.6 … 7.4   hold, all trails fully drawn
 *   7.4 … 7.95  global fade-out
 *   8.0         loop restarts
 *
 * Deterministic: fixed start, fixed learning rates, fixed step counts.
 */

import * as THREE from "three";
import type { Landscape, Vec2 } from "../core/functions";
import { gd, momentum, adam, type Optimizer } from "../core/optimizers";
import { OPTIMIZER_COLORS } from "../view/palette";
import { AnimatedTrail } from "../view/animatedTrail";
import type { LandscapeView } from "../view/LandscapeView";

/** Loop length in seconds (visual bar: ~8 s). */
export const HERO_LOOP_SECONDS = 8;
/** Phase at which every trail is fully drawn and still fully lit (shot pose). */
export const HERO_FULL_PHASE = 7;

const EASE = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

interface RaceSpec {
  opt: Optimizer;
  color: number;
  steps: number;
  /** Seconds for this trail's head to traverse its whole path. */
  duration: number;
}

/** Same race constants as the WP0 debug page (proven to look right). */
const SPECS: RaceSpec[] = [
  { opt: gd(0.2), color: OPTIMIZER_COLORS.gd, steps: 70, duration: 6.6 },
  { opt: momentum(0.045, 0.9), color: OPTIMIZER_COLORS.momentum, steps: 70, duration: 4.8 },
  { opt: adam(0.2, 0.9, 0.999, 1e-8), color: OPTIMIZER_COLORS.adam, steps: 70, duration: 3.4 },
];

const START: Vec2 = { x: -11, y: 9.5 };

/** Steps an optimizer from start, stopping if it leaves the extent (1.05×). */
function runPath(fn: Landscape, spec: RaceSpec): Vec2[] {
  const e = fn.extent;
  const m = 1.05;
  const pts: Vec2[] = [{ ...START }];
  let state = spec.opt.initState(START);
  for (let i = 0; i < spec.steps; i++) {
    state = spec.opt.step(state, fn.grad(state.pos));
    const { x, y } = state.pos;
    if (!Number.isFinite(x) || !Number.isFinite(y)) break;
    if (x < e.xMin * m || x > e.xMax * m || y < e.yMin * m || y > e.yMax * m) break;
    pts.push({ x, y });
  }
  return pts;
}

/** Point at parameter-space fraction t along a path (lerped inside a segment). */
function pathAt(path: readonly Vec2[], t: number): Vec2 {
  const f = Math.min(1, Math.max(0, t)) * (path.length - 1);
  const i = Math.min(path.length - 2, Math.floor(f));
  const a = path[i];
  const b = path[i + 1];
  const k = f - i;
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
}

export interface HeroRace {
  /** Advances the loop to `seconds` (caller wraps at HERO_LOOP_SECONDS). */
  applyPhase(seconds: number): void;
  setAlpha(a: number): void;
  dispose(): void;
}

export function createHeroRace(view: LandscapeView, fn: Landscape): HeroRace {
  const diag = fn.extent.xMax - fn.extent.xMin; // bowl extent is square
  const headGroup = new THREE.Group();
  headGroup.renderOrder = 3;

  const headGeo = new THREE.SphereGeometry(1, 20, 14);
  const heads: Array<{
    trail: AnimatedTrail;
    path: readonly Vec2[];
    spec: RaceSpec;
    core: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
    halo: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  }> = [];

  const scratch = new THREE.Vector3();

  for (const spec of SPECS) {
    const path = runPath(fn, spec);
    if (path.length < 2) continue;
    const trail = new AnimatedTrail(view, path, spec.color);
    const color = new THREE.Color(spec.color);

    const coreMat = new THREE.MeshBasicMaterial({ color, transparent: true });
    const core = new THREE.Mesh(headGeo, coreMat);
    core.scale.setScalar(diag * 0.013);

    // Soft additive halo: a glow, not a bloom pass.
    const haloMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const halo = new THREE.Mesh(headGeo, haloMat);
    halo.scale.setScalar(diag * 0.032);

    headGroup.add(core, halo);
    heads.push({ trail, path, spec, core, halo });
  }

  view.addOverlayObject(headGroup);

  return {
    applyPhase(seconds: number): void {
      const s = Math.min(seconds, HERO_LOOP_SECONDS);
      let alpha = 1;
      if (s > 7.4) alpha = Math.max(0, 1 - (s - 7.4) / 0.55);
      for (const h of heads) {
        const t = EASE(Math.min(1, s / h.spec.duration));
        h.trail.setProgress(t);
        h.trail.setAlpha(alpha);
        const tip = pathAt(h.path, t);
        view.parameterToWorld(tip, view.trailLift + diag * 0.012, scratch);
        h.core.position.copy(scratch);
        h.halo.position.copy(scratch);
        (h.core.material as THREE.MeshBasicMaterial).opacity = alpha;
        (h.halo.material as THREE.MeshBasicMaterial).opacity = 0.22 * alpha;
        h.core.visible = alpha > 0.01;
        h.halo.visible = alpha > 0.01;
      }
    },
    setAlpha(a: number): void {
      for (const h of heads) h.trail.setAlpha(a);
    },
    dispose(): void {
      for (const h of heads) h.trail.dispose();
      headGeo.dispose();
      view.removeOverlayObject(headGroup);
    },
  };
}
