/**
 * Director — maps the step machine's named scenes to everything on screen.
 *
 * Sections:
 *   hero    — bowl + looping optimizer race, free orbit + drift
 *   §1 task — least-squares fit on the flat plane; task-c materializes the
 *             surface (rise 0 → 1) under the point at the argmin
 *   §2 gd   — the rotated bowl again, low camera over the floor:
 *             gd-a the −∇f needle (the point drifts so the needle swings),
 *             gd-b draw-your-own step arrow on the minimap vs GD's red step,
 *             gd-c η slider re-running GD live (crawl→descend→oscillate→
 *             diverge), gd-d the trajectory draped on the 3D surface.
 *   §3 mom  — strongly elongated rotated bowl: GD's zigzag (red) vs
 *             momentum's glide (blue) side by side; β slider re-runs
 *             momentum live (zigzag→glide→overshoot oscillation) with the
 *             overshoot-and-counter-swing apexes briefly highlighted.
 *   §4 adam — update inspector: white −∇f arrow vs yellow Adam update arrow
 *             at the current point (angle computed in PARAMETER space),
 *             per-coordinate m̂/√v̂ bars, steepness slider scaling one
 *             curvature up to 50× live — GD's step grows with it, Adam's
 *             barely changes; the readouts prove it.
 *
 * All motion runs through one tiny tween engine (cubic in-out, ~700 ms) fed
 * by LandscapeView's frame hook; `frozen` mode (screenshot hooks) snaps every
 * value to its target so ?shot=… renders the exact final pose with zero
 * animation and no auto-orbit.
 */

import * as THREE from "three";
import {
  defaultBowl,
  leastSquares,
  makeBowl,
  rosenbrock,
  LEAST_SQUARES_POINTS,
  MULTI_WELL_WELLS,
  type Landscape,
  type Vec2,
} from "../core/functions";
import { gd, momentum, adam } from "../core/optimizers";
import { OPTIMIZER_COLORS, MANIM } from "../view/palette";
import { AnimatedTrail, setTrailFocus } from "../view/animatedTrail";
import { LossCurves, type LossCurve } from "../view/lossCurves";
import { samplePath, cumulativeLengths, TrajectoryPlayer } from "../view/trajectoryPlayer";
import { LOOK_TARGETS, type LookTarget, type PanelId } from "../view/lookRegistry";
import type { LandscapeView } from "../view/LandscapeView";
import type { CompassMinimap } from "../view/CompassMinimap";
import type { FitPreview } from "../view/FitPreview";
import {
  createHeroRace,
  HERO_LOOP_SECONDS,
  HERO_FULL_PHASE,
  type HeroRace,
} from "./heroRace";
import {
  FOG_LS,
  FOG_RB,
  fogClampTip,
  fogCellGrid,
  fogSnapToCell,
  fogCommit,
  fogCannedRun,
  fogDiag,
  fogInit,
  fogReach,
  fogStateFromPath,
  fogMinStep,
  fogFormatLoss,
  inRosenbrockTrap,
  runFogMachines,
  FOG_RB_CURATED_MID,
  type FogLevel,
  type FogState,
} from "./fogGame";
import {
  RULE_CONFIG_DEFAULT,
  ruleBenchmark,
  ruleFormatLoss,
  ruleFormatSteps,
  ruleKnobFromClip,
  ruleKnobFromEta,
  ruleLevelById,
  type RuleBenchmark,
  type RuleLevelId,
  type RuleRun,
} from "./ruleLab";
import type { CustomRuleConfig } from "../core/optimizers";
import {
  SWARM_COUNT,
  TILT_CUE_AFTER_SEC,
  TILT_CUE_SPEED,
  TILT_DEFAULT_FRICTION,
  TILT_DT,
  TILT_MACHINE_STEPS,
  SWARM_LEVEL,
  TILT_ROSEN,
  TILT_VALLEY,
  dampingRegime,
  runTiltMachines,
  simulateSwarm,
  tiltCuratedRun,
  tiltDiag,
  tiltCellKey,
  tiltFinish,
  tiltFormatLoss,
  tiltInit,
  tiltLevelById,
  tiltScore,
  tiltStep,
  type SwarmSim,
  type TiltLevel,
  type TiltLevelId,
  type TiltMachineRun,
  type TiltRun,
} from "./tiltGame";

export type SceneName =
  | "hero"
  | "task-a"
  | "task-b"
  | "task-c"
  | "gd-a"
  | "gd-b"
  | "gd-c"
  | "gd-d"
  | "mom-a"
  | "mom-b"
  | "mom-c"
  | "adam-a"
  | "adam-b"
  | "lab"
  | "fog-a"
  | "fog-b"
  | "fog-c"
  | "tilt-a"
  | "tilt-b"
  | "swarm"
  | "labrule"
  | "epi-a"
  | "epi-b"
  | "epi-c";

export const SCENE_ORDER: readonly SceneName[] = [
  "hero",
  "task-a",
  "task-b",
  "task-c",
  "gd-a",
  "gd-b",
  "gd-c",
  "gd-d",
  "mom-a",
  "mom-b",
  "mom-c",
  "adam-a",
  "adam-b",
  "lab",
  "lab", // the two §5 reader steps share the lab scene (index-mapped)
  "fog-a",
  "fog-b",
  "fog-c",
  "tilt-a",
  "tilt-a", // the two §7 play reader steps share the tilt scene (levels live inside it)
  "tilt-b",
  "swarm",
  "labrule",
  "labrule", // the two §8 reader steps share the workbench scene (levels live inside it)
  "epi-a",
  "epi-b",
  "epi-c",
];

/**
 * Hero framing drop (CSS px): the hero's framed landscape sits this much
 * lower on screen so the looping optimizer race clears the centered caption
 * instead of running through it (visual verdict n-1). Orthographic framing
 * shift — exact at every azimuth, so it holds during the hero auto-drift.
 */
const HERO_FRAME_DROP_PX = 80;

/* ------------------------------------------------------------------ */
/* §2 constants — one fixed start, deterministic everything            */
/* ------------------------------------------------------------------ */

/** The §2 launch point (same as the hero/debug race start, proven to read). */
const GD_START: Vec2 = { x: -11, y: 9.5 };
/** Valley-floor axis toward the origin (bowl θ=30°: flat axis is (−sinθ, cosθ),
 *  and from START the origin lies along its NEGATIVE). */
const VALLEY_TOWARD_ORIGIN: Vec2 = { x: 0.5, y: -0.8660254 };
/** gd-a needle-drift far endpoint (START + 7·valley axis; inside the extent). */
const DRIFT_B: Vec2 = { x: GD_START.x + 7 * VALLEY_TOWARD_ORIGIN.x, y: GD_START.y + 7 * VALLEY_TOWARD_ORIGIN.y };
const DRIFT_PERIOD = 12; // seconds for a full there-and-back

/** η slider: log sweep over ~3 decades. */
const ETA_MIN = 0.002;
const ETA_MAX = 2;
const ETA_MID = Math.sqrt(ETA_MIN * ETA_MAX); // slider midpoint ≈ 0.0632
/** η for the "GD's actual step" arrow in gd-b: the largest safe step
 *  (just under the overshoot threshold 1/λmax = 0.5 here). */
const GD_STEP_ETA = 0.45;
/** Frozen (shot) constants. */
const GD_A_FROZEN_DRIFT_T = 0.38 * DRIFT_PERIOD;
const GD_B_FROZEN_USER_TIP: Vec2 = {
  x: GD_START.x + 8 * VALLEY_TOWARD_ORIGIN.x,
  y: GD_START.y + 8 * VALLEY_TOWARD_ORIGIN.y,
};
const GD_C_FROZEN_ETA = ETA_MID; // mid-slider
const GD_D_FROZEN_ETA = 0.9; // oscillating showcase: strong, visible bounces
/** gd-d's four curated lanes, in the copy's order (crawl → descend →
 *  oscillate → diverge). The oscillate member is the old frozen-showcase η.
 *  Verified against runGdPath: 0.01 hugs the wall (161 pts, ~1.5 units of
 *  travel), 0.2 glides two-thirds down the valley, 0.9 ribbons to the
 *  origin, 1.6 leaves the frame in 2 steps. */
const GD_D_ETAS = [0.01, 0.2, GD_D_FROZEN_ETA, 1.6];

/* ------------------------------------------------------------------ */
/* §3 constants — momentum on its own elongated, rotated bowl          */
/* ------------------------------------------------------------------ */

/** §3 landscape: ratio-50 bowl rotated −36° (strongly elongated, rotated). */
const MOM_BOWL: Landscape = makeBowl(1, 0.02, -Math.PI / 5);
/** Same η for the red reference and the blue slider run: β=0 reduces
 *  momentum to GD EXACTLY (asserted in the core tests), so the slider
 *  starts the story from a perfect zigzag overlay. */
const MOM_ETA = 0.9;
const MOM_START: Vec2 = (() => {
  const ux = Math.cos(-Math.PI / 5);
  const uy = Math.sin(-Math.PI / 5);
  // across-valley −6 (the zigzag width), along-valley +10 (glide room)
  return { x: -6 * ux + 10 * -uy, y: -6 * uy + 10 * ux };
})();
const MOM_GD_STEPS = 160;
const MOM_STEPS = 200;
const MOM_BETA_DEFAULT = 0.45; // mom-a: bounces damp fast, then a clean glide
const MOM_BETA_OVERSHOOT = 0.97; // mom-b: overshoot oscillation
const MOM_BETA_MAX = 0.99;

export type MomRegime = "zigzag" | "glide" | "overshoot";

/**
 * Momentum regime from β on this bowl (verified numerically at η=0.9):
 * β=0 is exact GD (11 wide bounces); 0.3–0.6 damps the zigzag within a few
 * steps (glide); ≥0.95 the across-valley wobble outlives the ride
 * (overshoot oscillation, 47–93 visible bounces).
 */
export function momRegimeOf(beta: number): MomRegime {
  if (beta < 0.25) return "zigzag";
  if (beta < 0.85) return "glide";
  return "overshoot";
}

function runMomentumPath(beta: number, maxSteps = MOM_STEPS): Vec2[] {
  const opt = momentum(MOM_ETA, beta);
  let state = opt.initState(MOM_START);
  const e = MOM_BOWL.extent;
  const m = 1.05;
  const path: Vec2[] = [{ ...MOM_START }];
  for (let i = 0; i < maxSteps; i++) {
    state = opt.step(state, MOM_BOWL.grad(state.pos));
    if (!Number.isFinite(state.pos.x) || !Number.isFinite(state.pos.y)) break;
    path.push({ ...state.pos });
    if (
      state.pos.x < e.xMin * m || state.pos.x > e.xMax * m ||
      state.pos.y < e.yMin * m || state.pos.y > e.yMax * m
    ) {
      break;
    }
  }
  return path;
}

function runMomGdPath(maxSteps = MOM_GD_STEPS): Vec2[] {
  const opt = gd(MOM_ETA);
  let state = opt.initState(MOM_START);
  const e = MOM_BOWL.extent;
  const m = 1.05;
  const path: Vec2[] = [{ ...MOM_START }];
  for (let i = 0; i < maxSteps; i++) {
    state = opt.step(state, MOM_BOWL.grad(state.pos));
    if (!Number.isFinite(state.pos.x) || !Number.isFinite(state.pos.y)) break;
    path.push({ ...state.pos });
    if (
      state.pos.x < e.xMin * m || state.pos.x > e.xMax * m ||
      state.pos.y < e.yMin * m || state.pos.y > e.yMax * m
    ) {
      break;
    }
  }
  return path;
}

/** Across-valley coordinate on the §3 bowl (for overshoot-apex detection). */
function momAcross(p: Vec2): number {
  const ux = Math.cos(-Math.PI / 5);
  const uy = Math.sin(-Math.PI / 5);
  return p.x * ux + p.y * uy;
}

/** Indices of overshoot apexes: across-valley direction flips with |c| > 0.5. */
function momApexes(path: readonly Vec2[]): number[] {
  const c = path.map(momAcross);
  const out: number[] = [];
  for (let i = 1; i < c.length - 1; i++) {
    if ((c[i] - c[i - 1]) * (c[i + 1] - c[i]) < 0 && Math.abs(c[i]) > 0.5) {
      out.push(i);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* §4 constants — the Adam update inspector                            */
/* ------------------------------------------------------------------ */

/** λ2 base and rotation fixed; the slider scales λ1 = steepness. */
function adamBowl(steepness: number): Landscape {
  return makeBowl(steepness, 0.02, Math.PI / 6);
}
const ADAM_STEEP_MIN = 1;
const ADAM_STEEP_MAX = 50;
/** The inspected point: across-valley 1.5, along-valley 9 on the θ=30° bowl
 *  (fixed in parameter space for every steepness). */
const ADAM_POINT: Vec2 = (() => {
  const c = Math.cos(Math.PI / 6);
  const s = Math.sin(Math.PI / 6);
  return { x: 1.5 * c + 9 * -s, y: 1.5 * s + 9 * c };
})();
const ADAM_ETA = 0.3; // SAME η for both optimizers — the honest comparison
const ADAM_WARM_STEPS = 12;
const ADAM_B1 = 0.9;
const ADAM_B2 = 0.999;
const ADAM_EPS = 1e-8;
/** A side-by-side roll lane for §4: GD or Adam from the inspected start. */
function runAdamLane(steepness: number, kind: "gd" | "adam"): Vec2[] {
  const bowl = adamBowl(steepness);
  const opt =
    kind === "gd" ? gd(ADAM_ETA) : adam(ADAM_ETA, 0.9, 0.999, 1e-8);
  let state = opt.initState(ADAM_POINT);
  const e = bowl.extent;
  const m = 1.05;
  const path: Vec2[] = [{ ...ADAM_POINT }];
  for (let i = 0; i < 60; i++) {
    state = opt.step(state, bowl.grad(state.pos));
    if (!Number.isFinite(state.pos.x) || !Number.isFinite(state.pos.y)) break;
    path.push({ ...state.pos });
    if (
      state.pos.x < e.xMin * m || state.pos.x > e.xMax * m ||
      state.pos.y < e.yMin * m || state.pos.y > e.yMax * m
    ) {
      break;
    }
  }
  return path;
}

const ADAM_FROZEN_STEEP_A = 1; // adam-a: baseline
const ADAM_FROZEN_STEEP_B = ADAM_STEEP_MAX; // adam-b: steepness maxed

/* ------------------------------------------------------------------ */
/* §5 constants — the disagreement lab                                 */
/* ------------------------------------------------------------------ */

/** λ1/λ2 = E (1 = round, 50 = strongly elongated); λ1 = √E, λ2 = 1/√E. */
const LAB_E_MIN = 1;
const LAB_E_MAX = 50;
const LAB_ROT_MAX = 90;
/** The lab's curated state: strongly elongated + rotated (also the shot). */
const LAB_E_DEFAULT = 50;
const LAB_ROT_DEFAULT = 30;
/** Fixed η per optimizer — the regimes SHIFT as the sliders reshape the
 *  valley; that shifting IS the disagreement (verified numerically). */
const LAB_ETA_GD = 0.13;
const LAB_ETA_M = 0.2;
const LAB_BETA = 0.9;
const LAB_ETA_A = 0.3;
const LAB_STEPS = 220;
/** Start direction (unit): mostly across the θ=30° valley, some along. */
const LAB_START_DIR: Vec2 = (() => {
  const l = Math.hypot(-0.94, 0.34);
  return { x: -0.94 / l, y: 0.34 / l };
})();

function labBowl(E: number, rotDeg: number): Landscape {
  return makeBowl(Math.sqrt(E), 1 / Math.sqrt(E), (rotDeg * Math.PI) / 180);
}

function labStart(bowl: Landscape): Vec2 {
  // Half the adaptive extent along a fixed direction: always framed, always
  // off-axis enough to excite the walls when they exist.
  const s = bowl.extent.xMax * 0.5;
  const l = Math.hypot(LAB_START_DIR.x, LAB_START_DIR.y);
  return { x: (LAB_START_DIR.x / l) * s, y: (LAB_START_DIR.y / l) * s };
}

function runLabPath(
  bowl: Landscape,
  kind: "gd" | "mom" | "adam",
): { path: Vec2[]; losses: number[] } {
  const opt =
    kind === "gd"
      ? gd(LAB_ETA_GD)
      : kind === "mom"
        ? momentum(LAB_ETA_M, LAB_BETA)
        : adam(LAB_ETA_A, 0.9, 0.999, 1e-8);
  const p0 = labStart(bowl);
  let state = opt.initState(p0);
  const e = bowl.extent;
  const m = 1.05;
  const path: Vec2[] = [{ ...p0 }];
  const losses: number[] = [bowl.f(p0)];
  for (let i = 0; i < LAB_STEPS; i++) {
    state = opt.step(state, bowl.grad(state.pos));
    if (!Number.isFinite(state.pos.x) || !Number.isFinite(state.pos.y)) break;
    path.push({ ...state.pos });
    losses.push(bowl.f(state.pos));
    if (
      state.pos.x < e.xMin * m || state.pos.x > e.xMax * m ||
      state.pos.y < e.yMin * m || state.pos.y > e.yMax * m
    ) {
      break;
    }
  }
  return { path, losses };
}

export interface LabChecks {
  /** GD across-valley zigzag flips (amplitude-filtered). */
  gdFlips: number;
  /** Momentum's first-crossing overshoot ratio (max|c| after the first
   *  zero-crossing ÷ |c₀|); > 1 = the memory swung past the valley. */
  momOvershoot: number;
  /** Adam's early-step max/min length ratio (~1 = near-invariant). */
  adamInvariant: number;
  /** Checklist lit states. */
  zigzag: boolean;
  overshoot: boolean;
  invariant: boolean;
}

/**
 * The three checklist probes (verified numerically at θ=30°):
 * GD flips 0→12 as E climbs (lit ≥ 3); momentum's overshoot ratio grows
 * 0.6→1.83 (lit > 1.15); Adam's early steps stay ≈ invariant (lit < 1.35 —
 * effectively always, which is the point).
 */
export function labChecks(E: number, rotDeg: number): LabChecks & {
  gdPath: Vec2[];
  momPath: Vec2[];
  adamPath: Vec2[];
  gdLosses: number[];
  momLosses: number[];
  adamLosses: number[];
} {
  const bowl = labBowl(E, rotDeg);
  const ux = Math.cos((rotDeg * Math.PI) / 180);
  const uy = Math.sin((rotDeg * Math.PI) / 180);
  const across = (p: Vec2): number => p.x * ux + p.y * uy;

  const g = runLabPath(bowl, "gd");
  const m = runLabPath(bowl, "mom");
  const a = runLabPath(bowl, "adam");

  const gc = g.path.map(across);
  let gdFlips = 0;
  for (let i = 2; i < gc.length; i++) {
    if ((gc[i] - gc[i - 1]) * (gc[i - 1] - gc[i - 2]) < 0 && Math.abs(gc[i - 1]) > 0.3) {
      gdFlips += 1;
    }
  }
  const mc = m.path.map(across);
  let momOvershoot = 0;
  for (let i = 1; i < mc.length; i++) {
    if (mc[i - 1] * mc[i] < 0) {
      for (let j = i; j < mc.length; j++) {
        momOvershoot = Math.max(momOvershoot, Math.abs(mc[j]) / (Math.abs(mc[0]) || 1));
      }
      break;
    }
  }
  let amx = 0;
  let amn = Infinity;
  const n = Math.min(3, a.path.length - 1);
  for (let i = 1; i <= n; i++) {
    const l = Math.hypot(
      a.path[i].x - a.path[i - 1].x,
      a.path[i].y - a.path[i - 1].y,
    );
    amx = Math.max(amx, l);
    amn = Math.min(amn, l);
  }
  const adamInvariant = amx / (amn || 1);

  return {
    gdFlips,
    momOvershoot,
    adamInvariant,
    zigzag: gdFlips >= 3,
    overshoot: momOvershoot > 1.15,
    invariant: adamInvariant < 1.35,
    gdPath: g.path,
    momPath: m.path,
    adamPath: a.path,
    gdLosses: g.losses,
    momLosses: m.losses,
    adamLosses: a.losses,
  };
}

export interface AdamInspector {
  /** Warm-end point the arrows are drawn at. */
  point: Vec2;
  /** Per-coordinate m̂/√v̂ (each in [−1, 1]). */
  ratio: Vec2;
  /** Angle in PARAMETER space between −∇f and the Adam update, degrees. */
  angleDeg: number;
  /** ‖η∇f‖ — the plain GD step at this point. */
  gdStepLen: number;
  /** ‖η·m̂/(√v̂+ε)‖ — the actual Adam step length. */
  adamStepLen: number;
  steepness: number;
}

/**
 * Warm Adam (ADAM_WARM_STEPS steps from ADAM_POINT), then inspect the NEXT
 * update: per-coordinate m̂/√v̂, the parameter-space angle to −∇f, and both
 * step lengths at the same η.
 */
export function adamInspect(steepness: number): AdamInspector {
  const bowl = adamBowl(steepness);
  const opt = adam(ADAM_ETA, ADAM_B1, ADAM_B2, ADAM_EPS);
  let st = opt.initState(ADAM_POINT);
  for (let i = 0; i < ADAM_WARM_STEPS; i++) {
    st = opt.step(st, bowl.grad(st.pos));
  }
  const g = bowl.grad(st.pos);
  const bc1 = 1 - Math.pow(ADAM_B1, st.t ?? 1);
  const bc2 = 1 - Math.pow(ADAM_B2, st.t ?? 1);
  const mx = (st.m?.x ?? 0) / bc1;
  const my = (st.m?.y ?? 0) / bc1;
  const sx = Math.sqrt((st.v?.x ?? 0) / bc2) + ADAM_EPS;
  const sy = Math.sqrt((st.v?.y ?? 0) / bc2) + ADAM_EPS;
  const ux = mx / sx;
  const uy = my / sy;
  const update: Vec2 = { x: -ux, y: -uy };
  const negGrad: Vec2 = { x: -g.x, y: -g.y };
  const gl = Math.hypot(negGrad.x, negGrad.y) || 1;
  const ul = Math.hypot(update.x, update.y) || 1;
  const cos = (negGrad.x * update.x + negGrad.y * update.y) / (gl * ul);
  return {
    point: { ...st.pos },
    ratio: { x: ux, y: uy },
    angleDeg: (Math.acos(clamp(cos, -1, 1)) * 180) / Math.PI,
    gdStepLen: ADAM_ETA * Math.hypot(g.x, g.y),
    adamStepLen: ADAM_ETA * ul,
    steepness,
  };
}

export type EtaRegime = "crawling" | "descending" | "oscillating" | "diverging";

/**
 * GD on A = R·diag(1, 0.02)·Rᵀ from GD_START (verified numerically against
 * the actual core): monotone while 1 − 2ηλmax > 0 (η < 0.5), overshoot flips
 * past 0.5, marginal zigzag at η = 1 = 1/λmax, divergence beyond.
 */
export function regimeOf(eta: number): EtaRegime {
  if (eta < 0.03) return "crawling";
  if (eta < 0.5) return "descending";
  if (eta <= 1.0) return "oscillating";
  return "diverging";
}

/** GD from GD_START at η, stopped when it leaves the drawn extent. */
export function runGdPath(eta: number, maxSteps = 160): Vec2[] {
  const opt = gd(eta);
  let state = opt.initState(GD_START);
  const e = defaultBowl.extent;
  const m = 1.05;
  const path: Vec2[] = [{ ...GD_START }];
  for (let i = 0; i < maxSteps; i++) {
    state = opt.step(state, defaultBowl.grad(state.pos));
    if (!Number.isFinite(state.pos.x) || !Number.isFinite(state.pos.y)) break;
    path.push({ x: state.pos.x, y: state.pos.y });
    if (
      state.pos.x < e.xMin * m || state.pos.x > e.xMax * m ||
      state.pos.y < e.yMin * m || state.pos.y > e.yMax * m
    ) {
      break;
    }
  }
  return path;
}

/** Exact least-squares argmin via the normal equations (deterministic). */
function leastSquaresArgmin(): Vec2 {
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const pt of LEAST_SQUARES_POINTS) {
    n += 1;
    sx += pt.x;
    sy += pt.y;
    sxx += pt.x * pt.x;
    sxy += pt.x * pt.y;
  }
  const det = n * sxx - sx * sx;
  const w = (n * sxy - sx * sy) / det;
  const b = (sy - w * sx) / n;
  return { x: w, y: b };
}

/* ------------------------------------------------------------------ */
/* §7 constants — the tilt game + swarm finale                         */
/* ------------------------------------------------------------------ */

/** Play-time pitch clamp (PLAN §7: "pitch clamped tighter during play").
 *  Free orbit returns the moment the run ends. */
const TILT_PLAY_CLAMP = { min: 26, max: 62 };
/** ?shot=tilt-a: the curated valley ride, cut mid-run. */
const TILT_A_FROZEN_FRAC = 0.45;
/** ?shot=tilt-b: the scrubber parked part-way through the ghost. */
const TILT_B_FROZEN_SCRUB = 0.35;
/** ?shot=swarm: late-flight — most balls parked in their pits (clusters
 *  readable), stragglers still streaming down the slopes. */
const SWARM_FROZEN_PROGRESS = 0.85;
/** Friction slider range (the damping c in v += (… − c·v)·dt). */
const TILT_FRICTION_MAX = 2.2;
/** Live trail rebuild: only every N new ghost samples (never per frame). */
const TILT_LIVE_TRAIL_CHUNK = 12;
/** Stamp-disc pool (the biggest measurement grid is 14×14). */
const TILT_STAMP_MAX = 256;
/** Swarm flight choreography: staggered launches, fixed ride length. */
const SWARM_RIDE_SEC = 7;
function swarmDelay(i: number): number {
  return (i % 20) * 0.05 + Math.floor(i / 20) * 0.12;
}
/** "Run it blind": paint-disc radius (~0.66 of a measurement cell) as a
 *  fraction of the extent diagonal — the §6 fog mechanic, cell-granular. */
const SWARM_PAINT_FRAC = 0.033;
/** ?shot=fogswarm: earlier in the flight than ?shot=swarm so the terrain
 *  reads as PARTIALLY painted (cells concentrate early in each ball's arc —
 *  probed: 110/131 ledger cells by 30% — so this still leaves real fog). */
const FOGSWARM_FROZEN_PROGRESS = 0.3;

interface CamSpec {
  azimuth: number;
  elevation: number;
  /** Multiplier on the landscape's fit zoom at scene enter. */
  zoom: number;
}

interface SceneSpec {
  landscape: "bowl" | "ls" | "mom" | "adam" | "lab" | "rule" | "fog-ls" | "fog-rb" | "tilt" | "swarm";
  /** Terrain relief target: 0 = flat parameter plane, 1 = full surface. */
  rise: number;
  /** Terrain opacity target (flat plane stays a ghost). */
  opac: number;
  /** Fit target; null = hero/§2 (fit hidden). */
  fit: Vec2 | null;
  ball: boolean;
  race: boolean;
  orbitDegPerSec: number;
  /** §2 camera choreography; absent = leave the camera alone. */
  cam?: CamSpec;
  /** §2: draw the live η trajectory (3D trail + minimap path). */
  traj?: boolean;
  /** §4: show the Adam update-inspector panel. */
  inspector?: boolean;
  /** §5: show the loss-curves panel. */
  curves?: boolean;
  /** Scene can host the universal Play transport (data permitting). */
  transport?: boolean;
  /** §7: a playable tilt-game scene (levels live inside the scene). */
  tilt?: boolean;
  /** §7 finale: the 100-ball instanced swarm on Rastrigin. */
  swarm?: boolean;
  /** §8: a playable optimizer-workbench scene (levels live inside the scene). */
  rule?: boolean;
  /** §9: the parameter lattice (the dimension-honesty beat). */
  lattice?: boolean;
  /** §9: pin the exact-formula note above the marked normal-equation minimum. */
  epiFormula?: boolean;
  hud: { hero: boolean; fit: boolean; loss: boolean; map: boolean; hint: boolean };
}

const ARGMIN: Vec2 = leastSquaresArgmin();
const START_FIT: Vec2 = { x: 0.15, y: 0.2 };
// A wrong fit of a different CHARACTER (downhill): both drag handles stay
// inside the fit-preview window, unlike a steep positive slope would.
const BAD_FIT: Vec2 = { x: -0.35, y: 0.8 };

// §2 hides §1's fit/loss panels but the compass minimap is the PROTAGONIST
// (needle, drawn arrows, trajectory) — it stays visible throughout.
const GD_HUD = { hero: false, fit: false, loss: false, map: true, hint: false };
const MOM_HUD = GD_HUD;
const ADAM_HUD = GD_HUD;

const SCENES: Record<SceneName, SceneSpec> = {
  hero: {
    landscape: "bowl",
    rise: 1,
    opac: 1,
    fit: null,
    ball: false,
    race: true,
    orbitDegPerSec: 1.5,
    hud: { hero: true, fit: false, loss: false, map: false, hint: true },
  },
  "task-a": {
    landscape: "ls",
    rise: 0,
    // Flat ghost: dimmed vs the risen state but the Viridis ramp must stay
    // clearly readable — never below ~40% opacity (user feedback: at 0.18
    // the unrisen sheet read almost black).
    opac: 0.5,
    fit: START_FIT,
    ball: true,
    race: false,
    orbitDegPerSec: 0,
    hud: { hero: false, fit: true, loss: true, map: true, hint: false },
  },
  "task-b": {
    landscape: "ls",
    rise: 0,
    // Same flat-ghost floor as task-a (see the note there).
    opac: 0.5,
    fit: BAD_FIT,
    ball: true,
    race: false,
    orbitDegPerSec: 0,
    hud: { hero: false, fit: true, loss: true, map: true, hint: false },
  },
  "task-c": {
    landscape: "ls",
    rise: 1,
    opac: 1,
    fit: ARGMIN,
    ball: true,
    race: false,
    orbitDegPerSec: 0,
    hud: { hero: false, fit: true, loss: true, map: true, hint: false },
  },
  "gd-a": {
    landscape: "bowl",
    rise: 1,
    opac: 1,
    fit: null,
    ball: true,
    race: false,
    orbitDegPerSec: 0,
    cam: { azimuth: -60, elevation: 16, zoom: 1.1 },
    hud: GD_HUD,
  },
  "gd-b": {
    landscape: "bowl",
    rise: 1,
    opac: 1,
    fit: null,
    ball: true,
    race: false,
    orbitDegPerSec: 0,
    // Azimuth 0 (same rationale as adam-a below): at −60° the wall-parallel
    // −∇f step points into the screen and the fixed step arrow collapses to
    // a hairline behind the ball. At 0° both protagonist arrows read.
    cam: { azimuth: 0, elevation: 35, zoom: 1.0 },
    transport: true,
    hud: GD_HUD,
  },
  "gd-c": {
    landscape: "bowl",
    rise: 1,
    opac: 1,
    fit: null,
    ball: true,
    race: false,
    orbitDegPerSec: 0,
    cam: { azimuth: -60, elevation: 35, zoom: 1.0 },
    traj: true,
    transport: true,
    hud: GD_HUD,
  },
  "gd-d": {
    landscape: "bowl",
    rise: 1,
    opac: 1,
    fit: null,
    ball: true,
    race: false,
    orbitDegPerSec: 0,
    // Low and swung toward the valley axis so the η path reads draped.
    cam: { azimuth: -115, elevation: 20, zoom: 0.95 },
    traj: true,
    transport: true,
    hud: GD_HUD,
  },
  "mom-a": {
    landscape: "mom",
    rise: 1,
    opac: 1,
    fit: null,
    ball: true,
    race: false,
    orbitDegPerSec: 0,
    cam: { azimuth: -60, elevation: 32, zoom: 1.0 },
    transport: true,
    hud: MOM_HUD,
  },
  "mom-b": {
    landscape: "mom",
    rise: 1,
    opac: 1,
    fit: null,
    ball: true,
    race: false,
    orbitDegPerSec: 0,
    // Slightly lower: the overshoot-and-counter-swing reads across the floor.
    cam: { azimuth: -60, elevation: 26, zoom: 1.05 },
    transport: true,
    hud: MOM_HUD,
  },
  "mom-c": {
    landscape: "mom",
    rise: 1,
    opac: 1,
    fit: null,
    ball: true,
    race: false,
    orbitDegPerSec: 0,
    cam: { azimuth: -60, elevation: 35, zoom: 0.9 },
    transport: true,
    hud: MOM_HUD,
  },
  "adam-a": {
    landscape: "adam",
    rise: 1,
    opac: 1,
    fit: null,
    ball: true,
    race: false,
    orbitDegPerSec: 0,
    // Azimuth 0: the θ=30° bowl's steep axis (and hence −∇f) points into
    // the screen at −60°, which collapses the protagonist arrows to hairlines.
    cam: { azimuth: 0, elevation: 65, zoom: 1.0 },
    inspector: true,
    transport: true,
    hud: ADAM_HUD,
  },
  "adam-b": {
    landscape: "adam",
    rise: 1,
    opac: 1,
    fit: null,
    ball: true,
    race: false,
    orbitDegPerSec: 0,
    // Steeper top-down framing: compresses the ×50 wall climb so the curated
    // pose's ×30 arrows stay fully in frame (QA V3), valley fills the frame.
    cam: { azimuth: 0, elevation: 55, zoom: 1.15 },
    inspector: true,
    transport: true,
    hud: ADAM_HUD,
  },
  lab: {
    landscape: "lab",
    rise: 1,
    opac: 1,
    fit: null,
    ball: true,
    race: false,
    orbitDegPerSec: 0,
    cam: { azimuth: -60, elevation: 35, zoom: 1.0 },
    curves: true,
    transport: true,
    hud: GD_HUD,
  },
  /* §6 fog game — the landscape goes DARK: only the fog HUD, the fit inset
   * (level 1) and the compass minimap remain. High-pitch cameras per PLAN
   * §6 (readability: the minimap drives, the 3D confirms). */
  "fog-a": {
    landscape: "fog-ls",
    rise: 1,
    opac: 1,
    fit: null,
    ball: true,
    race: false,
    orbitDegPerSec: 0,
    // Level 1 IS the §1 least-squares landscape — continuity on purpose.
    cam: { azimuth: -30, elevation: 62, zoom: 1.0 },
    hud: { hero: false, fit: true, loss: false, map: true, hint: false },
  },
  "fog-b": {
    landscape: "fog-rb",
    rise: 1,
    opac: 1,
    fit: null,
    ball: true,
    race: false,
    orbitDegPerSec: 0,
    cam: { azimuth: -40, elevation: 56, zoom: 1.0 },
    hud: { hero: false, fit: false, loss: false, map: true, hint: false },
  },
  "fog-c": {
    landscape: "fog-rb",
    rise: 1,
    opac: 1,
    fit: null,
    ball: true,
    race: false,
    orbitDegPerSec: 0,
    // Same attitude as fog-b: the reveal lifts in place, no reframe jump.
    cam: { azimuth: -40, elevation: 56, zoom: 1.0 },
    transport: true,
    hud: { hero: false, fit: false, loss: false, map: true, hint: false },
  },
  /* §7 tilt game — isometric marble-valley framing, pitch clamped tighter
   * while a run is live (PLAN §7 camera defaults); free orbit once the run
   * ends and during replays/scorecard. Levels swap the terrain in place. */
  "tilt-a": {
    landscape: "tilt",
    rise: 1,
    opac: 1,
    fit: null,
    ball: true,
    race: false,
    orbitDegPerSec: 0,
    cam: { azimuth: -60, elevation: 40, zoom: 1.0 },
    tilt: true,
    hud: { hero: false, fit: false, loss: false, map: true, hint: false },
  },
  "tilt-b": {
    landscape: "tilt",
    rise: 1,
    opac: 1,
    fit: null,
    ball: true,
    race: false,
    orbitDegPerSec: 0,
    // Slightly higher + swung: the machine trails + scorecard read from above.
    cam: { azimuth: -40, elevation: 50, zoom: 0.95 },
    tilt: true,
    hud: { hero: false, fit: false, loss: false, map: true, hint: false },
  },
  swarm: {
    landscape: "swarm",
    rise: 1,
    opac: 1,
    fit: null,
    ball: false,
    race: false,
    orbitDegPerSec: 0,
    // High enough that the 100 streams into distinct minima read at a glance.
    cam: { azimuth: -50, elevation: 58, zoom: 1.0 },
    swarm: true,
    // No compass here: with no live run it would show a stale point, and the
    // panel already carries the swarm's numbers.
    hud: { hero: false, fit: false, loss: false, map: false, hint: false },
  },
  /* §8 optimizer workbench — the SAME rule (purple) races GD/momentum/Adam
   * on the picked landscape; the level pills live in the panel (like §7).
   * The curated pose is Rosenbrock, where the workbench rule BEATS Adam. */
  labrule: {
    landscape: "rule",
    rise: 1,
    opac: 1,
    fit: null,
    ball: true,
    race: false,
    orbitDegPerSec: 0,
    cam: { azimuth: -60, elevation: 35, zoom: 1.0 },
    transport: true,
    rule: true,
    hud: GD_HUD,
  },
  /* §9 epilogue — the least-squares surface returns with its EXACT formula:
   * epi-a reveals it over the marked normal-equation minimum; epi-b lets the
   * map dissolve into a vast faint lattice of parameters (no map exists);
   * epi-c keeps the lattice under the limitations + credits. */
  "epi-a": {
    landscape: "ls",
    rise: 1,
    opac: 1,
    fit: null, // the fit stays where §6/§7 left it; the marker is the reveal
    ball: false,
    race: false,
    orbitDegPerSec: 0,
    cam: { azimuth: -35, elevation: 32, zoom: 0.92 },
    epiFormula: true,
    hud: { hero: false, fit: false, loss: false, map: true, hint: false },
  },
  "epi-b": {
    landscape: "ls",
    // The map dissolves: the surface sinks to a ghost under the lattice.
    rise: 0.04,
    opac: 0.14,
    fit: null,
    ball: false,
    race: false,
    orbitDegPerSec: 0,
    // Pulled back + raised: the lattice must read VAST against the ghost map.
    cam: { azimuth: -35, elevation: 40, zoom: 0.62 },
    lattice: true,
    hud: { hero: false, fit: false, loss: false, map: false, hint: false },
  },
  "epi-c": {
    landscape: "ls",
    rise: 0.04,
    opac: 0.14,
    fit: null,
    ball: false,
    race: false,
    orbitDegPerSec: 0,
    cam: { azimuth: -35, elevation: 40, zoom: 0.62 },
    lattice: true,
    hud: { hero: false, fit: false, loss: false, map: false, hint: false },
  },
};

const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));

const wrap180 = (a: number): number => ((a + 180) % 360 + 360) % 360 - 180;

const lerp2 = (a: Vec2, b: Vec2, k: number): Vec2 => ({
  x: a.x + (b.x - a.x) * k,
  y: a.y + (b.y - a.y) * k,
});

interface Tween {
  from: number;
  to: number;
  t: number;
  dur: number;
}

export interface DirectorElements {
  /** The canvas pane (focus-dim styling scope for hover-to-look). */
  stageWrap: HTMLElement | null;
  heroOverlay: HTMLElement | null;
  fitPanel: HTMLElement | null;
  lossPanel: HTMLElement | null;
  minimapPanel: HTMLElement | null;
  lossValue: HTMLElement | null;
  roW: HTMLElement | null;
  roB: HTMLElement | null;
  etaSlider: HTMLInputElement | null;
  etaValue: HTMLElement | null;
  etaRegime: HTMLElement | null;
  /** Every β slider/readout/regime copy — mom-a and mom-b each carry one;
   *  all are kept in sync with the single momentum state. */
  betaSliders: HTMLInputElement[];
  betaValues: HTMLElement[];
  betaRegimes: HTMLElement[];
  steepSlider: HTMLInputElement | null;
  steepValue: HTMLElement | null;
  adamPanel: HTMLElement | null;
  adamAngle: HTMLElement | null;
  adamGdLen: HTMLElement | null;
  adamAdamLen: HTMLElement | null;
  barX: HTMLElement | null;
  barY: HTMLElement | null;
  barXVal: HTMLElement | null;
  barYVal: HTMLElement | null;
  elongSlider: HTMLInputElement | null;
  elongValue: HTMLElement | null;
  rotSlider: HTMLInputElement | null;
  rotValue: HTMLElement | null;
  checkGd: HTMLElement | null;
  checkMom: HTMLElement | null;
  checkAdam: HTMLElement | null;
  curvesPanel: HTMLElement | null;
  playBtn: HTMLButtonElement | null;
  /** ↻ Replay button — restarts the current replay from the beginning. */
  replayBtn: HTMLButtonElement | null;
  /** Universal replay scrub bar (0..1000, maps to the replay timeline). */
  replayScrub: HTMLInputElement | null;
  /** The transport container (carries the --replay-progress CSS var). */
  transportEl: HTMLElement | null;
  speedWrap: HTMLElement | null;
  speedButtons: HTMLButtonElement[];
  /** §6 fog game panel + reveal annotation + scorecard body. */
  fogPanel: HTMLElement | null;
  fogLevelEl: HTMLElement | null;
  fogMeas: HTMLElement | null;
  fogLoss: HTMLElement | null;
  fogBudgetFill: HTMLElement | null;
  fogFinishBtn: HTMLButtonElement | null;
  fogNote: HTMLElement | null;
  fogScoreBody: HTMLElement | null;
  fogVerdict: HTMLElement | null;
  fogRunLead: HTMLElement | null;
  fogEmptyLead: HTMLElement | null;
  fogTrapNote: HTMLElement | null;
  fogEmptyVerdictNote: HTMLElement | null;
  /** §7 tilt game panel + scorecard + replay scrubber + swarm line. */
  tiltPanel: HTMLElement | null;
  tiltLevelEl: HTMLElement | null;
  tiltInputEl: HTMLElement | null;
  tiltCells: HTMLElement | null;
  tiltSteps: HTMLElement | null;
  tiltLoss: HTMLElement | null;
  tiltFrictionSlider: HTMLInputElement | null;
  tiltFrictionValue: HTMLElement | null;
  tiltFrictionRegime: HTMLElement | null;
  tiltLevelButtons: HTMLButtonElement[];
  tiltFinishBtn: HTMLButtonElement | null;
  tiltRestartBtn: HTMLButtonElement | null;
  tiltScoreWrap: HTMLElement | null;
  tiltScoreBody: HTMLElement | null;
  tiltVerdict: HTMLElement | null;
  tiltReplayWrap: HTMLElement | null;
  tiltReplayBtn: HTMLButtonElement | null;
  /** ↻ button — restarts the tilt ghost ride from the beginning. */
  tiltReplayRestartBtn: HTMLButtonElement | null;
  tiltScrub: HTMLInputElement | null;
  tiltSwarmLine: HTMLElement | null;
  /** §7: per-cluster scorecard rows (one per occupied well). */
  tiltSwarmClusters: HTMLElement | null;
  /** §8 workbench panel: the four rule parts + landscape picker. */
  rulePanel: HTMLElement | null;
  ruleLandscapeEl: HTMLElement | null;
  ruleEtaSlider: HTMLInputElement | null;
  ruleEtaValue: HTMLElement | null;
  ruleBetaValue: HTMLElement | null;
  ruleNormToggle: HTMLInputElement | null;
  ruleClipSlider: HTMLInputElement | null;
  ruleClipValue: HTMLElement | null;
  ruleLevelButtons: HTMLButtonElement[];
  /** Both §8 reader steps carry a scoreboard; both stay synced. */
  ruleScoreBodies: HTMLElement[];
  ruleVerdicts: HTMLElement[];
  /** §9 epilogue: pinned formula note + lattice caption. */
  epiFormula: HTMLElement | null;
  epiLatticeNote: HTMLElement | null;
}

export class Director {
  /** Screenshot mode: snap everything, never animate, never drift. */
  frozen = false;

  private scene: SceneName = "hero";
  private built:
    | "bowl"
    | "ls"
    | "mom"
    | "adam"
    | "lab"
    | "rule"
    | "fog-ls"
    | "fog-rb"
    | "tilt"
    | "swarm"
    | null = null;
  /** The steepness the CURRENT adam terrain was built at. */
  private builtAdamS: number | null = null;
  private swap: { to: SceneSpec; stage: "out" | "in" } | null = null;
  private race: HeroRace | null = null;
  private raceTime = 0;

  private readonly values = new Map<string, number>([
    ["rise", 1],
    ["opac", 1],
    ["fw", START_FIT.x],
    ["fb", START_FIT.y],
  ]);
  private readonly tweens = new Map<string, Tween>();
  private camDirty = false;
  /** Final camera attitude a camera tween is flying toward (skip support). */
  private camTarget: { azimuth: number; elevation: number; zoomRadius: number } | null = null;

  private fit: Vec2 = { ...START_FIT };

  /* ---------------- §2 state ---------------- */
  /** The §2 "current point" on the bowl (drifts in gd-a, fixed elsewhere). */
  private point: Vec2 = { ...GD_START };
  private driftT = 0;
  private eta: number | null = null; // null until first §2 scene
  private userTip: Vec2 | null = null;
  private gdTipFull: Vec2 | null = null;
  private gdAnimT = 1;
  private trail: AnimatedTrail | null = null;
  /** §2 gd-d: the four curated-η trajectory lanes (QA cycle B critic-gdd). */
  private gdDLanes: AnimatedTrail[] = [];
  /** Persistent per-role §2 arrow handles — updated in place, never
   *  dispose/recreate churned per animation frame (the grow) or per
   *  minimap-drag pointermove. `arrowHandles` mirrors them for the
   *  hover-to-look keep set. */
  private gdArrowUser: THREE.Object3D | null = null;
  private gdArrowGd: THREE.Object3D | null = null;
  private arrowHandles: THREE.Object3D[] = [];

  /* ---------------- §3 state ---------------- */
  private momBeta: number | null = null; // null until first §3 scene
  private momGdTrail: AnimatedTrail | null = null;
  private momTrail: AnimatedTrail | null = null;
  /** Overshoot apex markers + their fade clock (1 = just lit, 0 = gone). */
  private momHighlight: THREE.Group | null = null;
  private momHighlightMat: THREE.MeshBasicMaterial | null = null;
  private momHighlightT = 0;
  /** Apex parameter positions (hover-to-look target for the gold markers). */
  private momApexPts: Vec2[] = [];

  /* ---------------- §4 state ---------------- */
  private adamS: number | null = null; // null until first §4 scene
  private adamHandles: THREE.Object3D[] = [];
  /** The warm-end point the inspector arrows are drawn at. */
  private adamPoint: Vec2 = { ...ADAM_POINT };
  /** A steepness move: coalesce terrain+inspector rebuilds to one per frame
   *  (input events stream faster than frames — §5's pendingLab pattern). */
  private pendingAdam = false;

  /* ---------------- §5 state ---------------- */
  private labE: number | null = null; // null until first §5 scene
  private labRot: number | null = null;
  private labTrails: AnimatedTrail[] = [];
  private curvesLog = true;
  /** A slider moved: coalesce rebuilds to one per animation frame. */
  private pendingLab = false;
  /** The lab's shared start (extent-dependent, recomputed per rebuild). */
  private labPoint: Vec2 = { x: -2.2, y: 2.2 };

  /* ---------------- §6 state — the fog game ---------------- */
  private fogLevel: FogLevel | null = null;
  private fogSt: FogState | null = null;
  /** In-flight step: the ball walks from→to over ~0.7 s, fog stamping as it
   *  rolls; the measurement is spent at commit, revealed at arrival. */
  private fogAnim: { from: Vec2; to: Vec2; t: number } | null = null;
  private fogStampFrom: Vec2 | null = null; // last stamped position
  /** Live drag preview tip (clamped to the stride ring) while drawing. */
  private fogPreviewTip: Vec2 | null = null;
  /** Gold reveal marker (core + additive halo) at the level's global min. */
  private fogMarker: THREE.Group | null = null;
  /** The four reveal ghosts (player white + GD/momentum/Adam). */
  private fogGhosts: {
    group: THREE.Group;
    lanes: Array<{
      path: Vec2[];
      trail: AnimatedTrail;
      ball: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
      player: TrajectoryPlayer;
      /** Remaining stagger delay (counts down in onFrame). */
      delay: number;
      /** The lane's original stagger — scrubbing needs the un-elapsed value. */
      delay0: number;
      dur: number;
    }>;
  } | null = null;
  /** True while the fog-c ghost cinematic is running (drives the lock). */
  private fogGhostTotal = 0;
  /** Elapsed ghost-cinematic wall clock (drives the transport scrub/progress). */
  private ghostClock = 0;
  /** Hover-to-look pause: the transport ❚❚ freezes the ghost cinematic; a
   *  paused cinematic must NOT hold the reader lock (never fight the lock). */
  private ghostsPaused = false;
  /** Whether the fog mask for the CURRENT built terrain has been reset and
   *  stamped with the start patch. */
  private fogMaskReady = false;
  /** Machine runs for the reveal scorecard (computed per level, cached). */
  private fogMachines: ReturnType<typeof runFogMachines> | null = null;

  /* ---------------- §7 state — the tilt game + swarm finale ---------------- */
  /** The level in play (terrain identity for tilt scenes). */
  private tiltLevel: TiltLevel = TILT_VALLEY;
  /** The live/replayed run (null only before the first tilt scene). */
  private tiltRun: TiltRun | null = null;
  /** Which tilt level's terrain is currently BUILT (setLandscape is costly). */
  private builtTilt: TiltLevelId | null = null;
  /** Held keys (lowercased letters + Arrow* names) → raw screen input. */
  private readonly tiltKeys = new Set<string>();
  /** Raw tilt input in SCREEN axes (x right, y away from camera). */
  private tiltInput: Vec2 = { x: 0, y: 0 };
  private tiltFriction = TILT_DEFAULT_FRICTION;
  /** Near-still seconds accumulated this run (the Finish-button pulse cue). */
  private tiltCueT = 0;
  /** Leftover frame time for the fixed 120 Hz physics substeps. */
  private tiltAccum = 0;
  /** Visited-cell measurement stamps (one additive instanced disc per cell). */
  private tiltStamps: THREE.InstancedMesh | null = null;
  private tiltStampKeys = new Set<string>();
  private readonly stampDummy = new THREE.Object3D();
  /** The growing trail of the live run (rebuilt in chunks, never per frame). */
  private tiltLiveTrail: AnimatedTrail | null = null;
  private tiltLiveBuilt = 0;
  /** The reveal ghost (scrubbable) + the machine race trails. */
  private tiltGhost:
    | { trail: AnimatedTrail; ball: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> }
    | null = null;
  private tiltGhostPos: Vec2 = { x: 0, y: 0 };
  private tiltMachineRuns: TiltMachineRun[] | null = null;
  private tiltMachineTrails: AnimatedTrail[] = [];
  /** Scrub state: 0..1 along the recorded ghost path. */
  private tiltScrub = 1;
  private tiltScrubPlaying = false;
  private tiltScrubClock = 0;
  /** The swarm finale (precomputed deterministic sim + instanced balls). */
  private swarm: {
    sim: SwarmSim;
    mesh: THREE.InstancedMesh;
    trails: AnimatedTrail[];
    time: number;
    playing: boolean;
    /** Per-ball paint ledger for "run it blind": the measurement cells each
     *  ball crosses, in crossing order, with the arc fraction at entry. */
    paint: Array<Array<{ key: string; x: number; y: number; arcFrac: number }>>;
    /** How many ledger entries each ball has stamped so far. */
    paintedIdx: number[];
  } | null = null;
  /** Distinct cells painted in the current blind run (cross-ball dedup —
   *  many balls cross the same cells; the map counts each once). */
  private readonly swarmPaintedKeys = new Set<string>();
  private readonly swarmDummy = new THREE.Object3D();
  private swarmDrawPos: Vec2[] = [];
  /** "Run it blind": the terrain hides (§6's fog mask) and the swarm paints
   *  every cell it crosses. Default OFF — the fully-visible swarm. */
  private swarmBlind = false;
  /** Cells painted so far in the current blind run (live readout). */
  private swarmPainted = 0;
  /** Frozen pose override for ?shot=fogswarm (earlier in the flight, so the
   *  terrain reads as PARTIALLY painted). */
  private swarmPoseProgress: number | null = null;

  /* ---------------- §8 state — the optimizer workbench ---------------- */
  /** The landscape the benchmark currently runs on (Rosenbrock curated:
   *  the pose where the assembled rule BEATS Adam — the ?shot=labrule hook). */
  private ruleLevel: RuleLevelId = "rosen";
  /** The four parts, as the sliders assemble them. */
  private ruleCfg: CustomRuleConfig = { ...RULE_CONFIG_DEFAULT };
  /** The last computed four-way benchmark (drives trails + scorecards). */
  private ruleRuns: RuleBenchmark | null = null;
  private ruleTrails: AnimatedTrail[] = [];
  /** Which workbench level's terrain is currently BUILT (setLandscape is
   *  costly — the pills swap it in place, exactly like the tilt levels). */
  private builtRule: RuleLevelId | null = null;
  /** A part moved or a level switched: coalesce to one rebuild per frame. */
  private pendingRule = false;

  /* ---------------- §9 state — the epilogue ---------------- */
  /** Gold marker at the normal-equation minimum (epi-a's reveal). */
  private epiMarker: THREE.Group | null = null;
  /** The vast faint parameter lattice (epi-b/c): a static THREE.Points cloud
   *  whose opacity rides the "lat" value (tweened 0→1 on entry). */
  private epiLattice: THREE.Points | null = null;

  /* ---------------- universal play system (WP-A2) ---------------- */
  /** Floating arrow-tip positions that need contact shadows. */
  private adamArrowTips: Vec2[] = [];
  private replay: {
    player: TrajectoryPlayer;
    group: THREE.Group;
    lanes: Array<{
      path: Vec2[];
      trail: AnimatedTrail;
      ball: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
    }>;
  } | null = null;
  private replaySpeed = 1;
  /** ❚❚ state of the universal lanes replay (TrajectoryPlayer.pause()). */
  private replayPaused = false;
  /** Last pure-JS lab rebuild cost in ms (diagnostics). */
  private labRebuildMs = 0;
  /** performance.now() of the last §5 slider input (the PERF-1 idle debounce). */
  private lastLabInputAt = 0;

  /* ---------------- hover-to-look state ---------------- */
  /** The active data-look key (null = no hover/focus). */
  private lookId: string | null = null;
  /** Re-evaluated per frame: the ring's parameter target (null = no ring). */
  private lookPointFn: (() => Vec2 | null) | null = null;
  /** The spotlighted HUD panels (cleared on unhover / scene change). */
  private readonly spotPanels: HTMLElement[] = [];
  /** Spotlighted trails (exempt from the focus dim). */
  private readonly keptTrails = new Set<AnimatedTrail>();

  constructor(
    private readonly view: LandscapeView,
    private readonly fitPreview: FitPreview,
    private readonly minimap: CompassMinimap,
    private readonly curves: LossCurves,
    private readonly els: DirectorElements,
  ) {}

  /* ---------------- lifecycle ---------------- */

  /** First paint: build the initial scene with everything snapped. */
  boot(scene: SceneName): void {
    this.setScene(scene, { instant: true });
  }

  setScene(name: SceneName, opts: { instant?: boolean } = {}): void {
    const instant = opts.instant === true;
    // Idempotence guard: boot + the step machine's manual setActive + the
    // IntersectionObserver can all fire for the SAME scene; §2 carries
    // per-scene interactive state (drawn arrows, frozen η pose) that a
    // non-instant re-entry would wipe. Repeat activation = no-op.
    if (!instant && name === this.scene && this.built !== null) return;
    const spec = SCENES[name];
    this.scene = name;

    this.view.setAutoOrbit(this.frozen ? 0 : spec.orbitDegPerSec);
    this.applyHud(spec);
    // Framing drop belongs to the hero only (same-landscape transitions too).
    this.view.setFrameOffsetY(spec.race ? HERO_FRAME_DROP_PX : 0);
    // Any scene change invalidates §2's step arrows/trajectory unless it is
    // a §2 scene re-entering (enterSceneState below re-lays them out).
    this.enterSceneState(name, instant);
    // §7 play-time pitch clamp: tighter only while a run is LIVE in tilt-a
    // (free orbit between runs, during replays, and everywhere else).
    this.view.setElevationClamp(
      spec.tilt === true && name === "tilt-a" && !this.frozen &&
        this.tiltRun !== null && !this.tiltRun.done
        ? { ...TILT_PLAY_CLAMP }
        : null,
    );
    // The hero race must not survive into §2 on a same-landscape transition.
    if (!spec.race && this.race) {
      this.race.dispose();
      this.race = null;
    }

    if (instant) {
      this.tweens.clear();
      this.swap = null;
      if (this.built !== spec.landscape || !this.built) {
        this.rebuildNow(spec);
      } else if (spec.race && !this.race) {
        this.createRace();
      } else if (spec.landscape === "tilt" && this.builtTilt !== this.tiltLevel.id) {
        // The tilt level changed while the tilt terrain family stayed built
        // (curated fallback on tilt-b): swap the landscape in place.
        this.view.setLandscape(this.tiltLevel.landscape);
        this.minimap.setLandscape(this.tiltLevel.landscape);
        this.builtTilt = this.tiltLevel.id;
        this.dropTiltRefs();
      } else if (spec.landscape === "rule" && this.builtRule !== this.ruleLevel) {
        // Same logic for the §8 workbench (back-nav into a picked level).
        const level = ruleLevelById(this.ruleLevel);
        this.view.setLandscape(level.landscape, { gridN: 64 });
        this.minimap.setLandscape(level.landscape);
        this.builtRule = this.ruleLevel;
      }
      this.values.set("rise", spec.rise);
      this.values.set("opac", spec.opac);
      if (spec.fit) {
        this.values.set("fw", spec.fit.x);
        this.values.set("fb", spec.fit.y);
        this.fit = { ...spec.fit };
      }
      if (spec.cam) {
        // Fit-based (QA F-2/cam-1): rebuildNow above reframed the incoming
        // landscape, so fitZoom is its own — framing is arrival-independent.
        this.view.setAttitude(
          spec.cam.azimuth,
          spec.cam.elevation,
          this.view.fitZoom * spec.cam.zoom,
        );
      } else {
        this.view.setPreset("iso");
      }
      this.camTarget = null;
      // The view holds the truth for terrain presentation — rebuildNow left
      // it at 0/0, and no tween will run in instant mode to apply the values.
      this.view.setTerrainRise(spec.rise);
      this.view.setTerrainOpacity(spec.opac);
      this.camDirty = false;
      this.refreshGdVisuals();
      this.updateDependents();
      this.view.requestRender();
      return;
    }

    if (spec.cam) this.tweenCamera(spec.cam);

    if (this.built !== spec.landscape) {
      if (!this.built) {
        this.rebuildNow(spec);
        this.refreshGdVisuals();
      } else {
        // Crossfade: sink + fade what's on stage, then rebuild and rise.
        this.swap = { to: spec, stage: "out" };
        this.tween("opac", 0, 0.55);
        this.tween("rise", 0, 0.55);
      }
    } else {
      if (spec.race && !this.race) this.createRace();
      // Same-family §4 transitions can still change the steepness (adam-a
      // <-> adam-b): rebuild the terrain in place, camera untouched (the
      // extent is steepness-independent so the reframe is a no-op).
      if (spec.landscape === "adam" && this.built === "adam" && this.builtAdamS !== (this.adamS ?? ADAM_STEEP_MIN)) {
        const fn = adamBowl(this.adamS ?? ADAM_STEEP_MIN);
        this.builtAdamS = this.adamS ?? ADAM_STEEP_MIN;
        this.view.setLandscape(fn);
        this.minimap.setLandscape(fn);
      }
      // Same-family §7 transitions can change the LEVEL (the tilt-b reveal
      // may have curated a Rosenbrock run while the valley was built).
      if (spec.landscape === "tilt" && this.builtTilt !== this.tiltLevel.id) {
        this.view.setLandscape(this.tiltLevel.landscape);
        this.minimap.setLandscape(this.tiltLevel.landscape);
        this.builtTilt = this.tiltLevel.id;
        this.dropTiltRefs();
      }
      this.tween("rise", spec.rise, spec.rise > this.val("rise") ? 1.15 : 0.7);
      this.tween("opac", spec.opac, 0.7);
      if (spec.fit) this.tweenFit(spec.fit);
      this.refreshGdVisuals();
    }
    this.updateDependents();
    this.view.requestRender();
  }

  /* ---------------- app-shell hooks (reader panel progression) ---------------- */

  /**
   * True while any scene-entry motion is in flight: tweens, a landscape
   * crossfade, the gd-b step-arrow animation or a pending lab rebuild.
   * The reader locks wheel-advance while this is true.
   */
  get animating(): boolean {
    return (
      this.tweens.size > 0 ||
      this.swap !== null ||
      this.gdAnimT < 1 ||
      this.pendingLab ||
      this.pendingAdam ||
      this.pendingRule ||
      this.fogAnim !== null ||
      this.fogGhostsPlaying()
    );
  }

  /**
   * Fraction (0..1) of the in-flight motion that has played — drives the
   * reader's thin progress hint. 0 when idle.
   */
  get animProgress(): number {
    let p = 0;
    for (const tw of this.tweens.values()) {
      p = Math.max(p, Math.min(1, tw.t / tw.dur));
    }
    if (this.swap) {
      p = Math.max(p, this.swap.stage === "out" ? 0.25 : 0.75);
    }
    if (this.gdAnimT < 1) p = Math.max(p, this.gdAnimT);
    if (this.pendingLab) p = Math.max(p, 0.5);
    if (this.pendingAdam) p = Math.max(p, 0.5);
    if (this.pendingRule) p = Math.max(p, 0.5);
    if (this.fogAnim) p = Math.max(p, Math.min(1, this.fogAnim.t));
    if (this.fogGhosts && this.fogGhostTotal > 0) {
      let played = 0;
      for (const lane of this.fogGhosts.lanes) {
        played = Math.max(
          played,
          Math.min(1, (this.fogGhostTotal - Math.max(0, lane.delay)) / this.fogGhostTotal),
        );
      }
      p = Math.max(p, played);
    }
    return p;
  }

  /**
   * Skip: completes every in-flight transition instantly — tweens snap to
   * their targets, a landscape crossfade finishes its rebuild, the gd-b
   * step-arrow jumps to full, a pending lab rebuild runs now. Safe to call
   * when nothing is animating.
   */
  finishTransitionsNow(): void {
    const spec = SCENES[this.scene];
    const hadCamTween =
      this.tweens.has("azim") || this.tweens.has("elev") || this.tweens.has("zoom");

    // Tweens: snap values to targets.
    for (const [key, tw] of [...this.tweens]) {
      this.values.set(key, tw.to);
      this.tweens.delete(key);
    }

    // Landscape crossfade: force the rebuild and the final presentation.
    if (this.swap) {
      const target = this.swap.to;
      this.swap = null;
      if (this.built !== target.landscape || !this.built) {
        this.rebuildNow(target);
      }
      // Re-base the camera destination on the incoming landscape's fit (the
      // tween was created against the outgoing one — QA F-2/cam-1).
      if (target.cam && this.camTarget) {
        this.camTarget.zoomRadius = this.view.fitZoom * target.cam.zoom;
      }
    }

    // Camera: snap to the tween's destination (only when one was flying).
    if (hadCamTween && this.camTarget) {
      this.view.setAttitude(
        this.camTarget.azimuth,
        this.camTarget.elevation,
        this.camTarget.zoomRadius,
      );
      this.camTarget = null;
    }
    this.camDirty = false;

    // Values that ride tweens.
    this.view.setTerrainRise(this.val("rise"));
    this.view.setTerrainOpacity(this.val("opac"));
    if (spec.fit) this.fit = { x: this.val("fw"), y: this.val("fb") };

    // gd-b's step arrow: jump to full.
    if (this.gdTipFull && this.gdAnimT < 1) {
      this.gdAnimT = 1;
      this.updateGdArrows(1);
    }

    // §6: the walking step lands instantly (fog stamped to the endpoint).
    if (this.fogAnim && this.fogLevel && this.fogSt) {
      this.view.fogStampSegment(
        this.fogStampFrom ?? this.fogAnim.from,
        this.fogSt.point,
        this.fogLevel.stampFrac,
      );
      this.fogAnim = null;
      this.fogStampFrom = null;
      if (this.fogSt.done) this.spawnFogMarker();
    }

    // §6 reveal ghosts: every lane lands at its end at once.
    if (this.fogGhosts) this.finishFogGhostsNow();

    // §3 markers: a skip finishes their fade.
    if (this.momHighlight && !this.frozen) this.clearMomHighlight();

    // A queued lab rebuild runs now.
    if (this.pendingLab && this.built === "lab") {
      this.pendingLab = false;
      const fn = labBowl(this.labE ?? LAB_E_DEFAULT, this.labRot ?? LAB_ROT_DEFAULT);
      this.view.setLandscape(fn, { gridN: 64 });
      this.minimap.setLandscape(fn);
      this.rebuildLabVisuals();
    }

    // A queued §4 steepness rebuild runs now (same Skip contract as §5).
    if (this.pendingAdam && this.built === "adam") {
      this.pendingAdam = false;
      const s = this.adamS ?? ADAM_STEEP_MIN;
      if (this.builtAdamS !== s) {
        const fn = adamBowl(s);
        this.view.setLandscape(fn);
        this.minimap.setLandscape(fn);
        this.builtAdamS = s;
      }
      this.rebuildAdamVisuals();
    }

    // A queued workbench rebuild runs now (part moved or level swapped).
    if (this.pendingRule && this.built === "rule") {
      this.pendingRule = false;
      if (this.builtRule !== this.ruleLevel) {
        const level = ruleLevelById(this.ruleLevel);
        this.view.setLandscape(level.landscape, { gridN: 64 });
        this.minimap.setLandscape(level.landscape);
        this.builtRule = this.ruleLevel;
      }
      this.rebuildRuleVisuals();
    }

    this.refreshGdVisuals();
    this.updateDependents();
    this.view.requestRender();
  }

  /* ---------------- per-frame ---------------- */

  onFrame(dt: number): void {
    let changed = this.advanceTweens(dt);

    if (this.swap) {
      if (this.swap.stage === "out") {
        if (this.val("opac") <= 0.002 && this.val("rise") <= 0.002) {
          const spec = this.swap.to;
          this.swap = { to: spec, stage: "in" };
          this.rebuildNow(spec);
          this.refreshGdVisuals();
          // The zoom tween was created against the OUTGOING landscape's fit;
          // re-base it (and the skip target) on the incoming one (QA F-2).
          if (spec.cam) {
            const zoomTo = this.view.fitZoom * spec.cam.zoom;
            const tw = this.tweens.get("zoom");
            if (tw) {
              this.tweens.set("zoom", { from: this.val("zoom"), to: zoomTo, t: tw.t, dur: tw.dur });
            }
            if (this.camTarget) this.camTarget.zoomRadius = zoomTo;
          }
          this.tween("rise", spec.rise, spec.rise > 0 ? 1.15 : 0.4);
          this.tween("opac", spec.opac, 0.7);
          if (spec.fit) this.tweenFit(spec.fit);
        }
      } else if (this.atTarget("rise") && this.atTarget("opac")) {
        this.swap = null;
      }
      changed = true;
    }

    const spec = SCENES[this.scene];
    if (this.race) {
      if (spec.race && !this.frozen) {
        this.raceTime = (this.raceTime + dt) % HERO_LOOP_SECONDS;
        this.race.applyPhase(this.raceTime);
      }
      // Race brightness rides the same fade as the terrain (crossfades).
      this.race.setAlpha(Math.min(1, this.val("opac")));
      if (!this.frozen) changed = true;
    }

    // §2 gd-a: the point drifts along the valley so the needle swings.
    if (this.scene === "gd-a" && !this.frozen && !this.swap && this.built === "bowl") {
      this.driftT += dt;
      this.point = this.driftPoint(this.driftT);
      changed = true;
    }

    // §2 gd-b: the red GD step grows in after the user commits an arrow.
    if (this.gdTipFull && this.gdAnimT < 1) {
      this.gdAnimT = Math.min(1, this.gdAnimT + dt / 0.7);
      this.updateGdArrows(easeInOutCubic(this.gdAnimT));
      changed = true;
    }

    // §6: the ball walks its committed step; fog is stamped behind it as it
    // rolls, so the painting animates with the walk. The reveal fires on
    // landing when the measurement budget ran out with this step.
    if (this.fogAnim && this.fogLevel) {
      this.fogAnim.t = Math.min(1, this.fogAnim.t + dt / 0.7);
      const draw = this.fogDrawPoint();
      if (this.fogStampFrom) {
        const radiusParam = this.fogLevel.stampFrac * fogDiag(this.fogLevel);
        const d = Math.hypot(draw.x - this.fogStampFrom.x, draw.y - this.fogStampFrom.y);
        if (d >= radiusParam * 0.5) {
          this.view.fogStampSegment(this.fogStampFrom, draw, this.fogLevel.stampFrac);
          this.fogStampFrom = draw;
        }
      }
      if (this.fogAnim.t >= 1) {
        this.fogAnim = null;
        if (this.fogLevel && this.fogSt) {
          this.view.fogStampAt(this.fogSt.point, this.fogLevel.stampFrac);
          this.fogStampFrom = { ...this.fogSt.point };
          if (this.fogSt.done) this.finishFogRun();
        }
      }
      changed = true;
    }

    // §3: overshoot apex markers burn bright, then fade (frozen poses hold).
    if (this.momHighlight && !this.frozen && this.momHighlightT > 0) {
      this.momHighlightT = Math.max(0, this.momHighlightT - dt / 1.8);
      if (this.momHighlightMat) {
        this.momHighlightMat.opacity = 0.9 * this.momHighlightT;
      }
      if (this.momHighlightT <= 0) this.clearMomHighlight();
      changed = true;
    }

    // §2/§4/§5: the universal player rolls balls along the replay lanes.
    // ❚❚ (replayPaused) freezes the roll; the scrub bar owns the pose then.
    if (this.replay) {
      const p = this.replayPaused ? null : this.replay.player.update(dt);
      if (p !== null) {
        for (const lane of this.replay.lanes) {
          const pos = samplePath(lane.path, p);
          this.view.parameterToWorld(
            pos,
            this.view.trailLift + this.view.diagonal * 0.016,
            lane.ball.position,
          );
          lane.trail.setProgress(p);
        }
        this.syncTransportProgress(p);
        if (p >= 1) this.syncTransport(); // the button returns to ▶ Play
        this.view.requestRender();
      }
    }

    // §6 reveal: the four ghosts launch staggered (player white first, then
    // GD/momentum/Adam), each eased along its own trajectory. A lane's
    // player starts the moment its stagger delay expires — constructing a
    // player never starts it, so without this the race sat frozen forever.
    // ❚❚ (ghostsPaused) freezes the whole cinematic and releases the reader
    // lock (fogGhostsPlaying() answers false while paused).
    if (this.fogGhosts && !this.frozen && !this.ghostsPaused) {
      // QA fogc-speed-clock: the race's OWN timeline must ride the transport
      // speed, exactly like the lane players do (their tSec advances by
      // dt·speed). Advancing ghostClock/lane.delay in raw wall clock left the
      // scrub bar frozen at ~68% at 2× (race over, clock behind) and put a
      // full bar over balls still rolling at 0.5×.
      this.ghostClock = Math.min(
        this.fogGhostTotal,
        this.ghostClock + dt * this.replaySpeed,
      );
      let moved = false;
      let launched = false;
      for (const lane of this.fogGhosts.lanes) {
        if (lane.delay > 0) {
          lane.delay -= dt * this.replaySpeed;
          moved = true;
          if (lane.delay > 0) continue;
          lane.player.play();
          launched = true;
        }
        if (lane.player.isPlaying) {
          lane.ball.visible = true;
          const p = lane.player.update(dt);
          if (p !== null) {
            const pos = samplePath(lane.path, p);
            this.view.parameterToWorld(
              pos,
              this.view.trailLift + this.view.diagonal * 0.016,
              lane.ball.position,
            );
            lane.trail.setProgress(p);
            moved = true;
          }
        }
      }
      if (moved) {
        this.syncTransportProgress(this.transportProgress());
        // QA ANIM-1: the auto-launched race never re-synced the transport,
        // so the button read "▶ Play" while the cinematic played. Sync when
        // ghosts go live (label flips to ❚❚ Pause).
        if (launched) this.syncTransport();
        if (!this.fogGhostsPlaying()) this.syncTransport();
        this.view.requestRender();
      }
    }

    // §7: the live tilt run — fixed 120 Hz substeps on the held keys. The
    // reader deliberately does NOT lock while playing (this is not a tween).
    if (
      this.scene === "tilt-a" &&
      !this.frozen &&
      this.tiltRun !== null &&
      !this.tiltRun.done &&
      this.built === "tilt" &&
      this.builtTilt === this.tiltLevel.id
    ) {
      const input = this.tiltInputParam();
      if (input.x !== 0 || input.y !== 0) this.tiltRun.steered = true;
      if (this.tiltRun.steered) {
        // QA cycle B (student-2): the attract pose is FROZEN until the first
        // real key input — the ball sits at the start with zeroed counters
        // instead of quietly racking up drift steps that later get scored as
        // if the student had played them.
        this.tiltAccum = Math.min(this.tiltAccum + dt, 0.12);
        while (this.tiltAccum >= TILT_DT && !this.tiltRun.done) {
          this.tiltAccum -= TILT_DT;
          tiltStep(this.tiltLevel, this.tiltRun, input, this.tiltFriction);
        }
        if (this.tiltRun.done) this.onTiltRunEnded();
        // QA GP-1: near-still but not settled (quiet-ground creep, ring-down)
        // must never read as a hang — pulse Finish after a few slow seconds.
        // Only once the player has actually steered: the untouched opening
        // drift is the attract state, not a scored run waiting to happen.
        const v = this.tiltRun.vel;
        if (
          !this.tiltRun.done &&
          Math.hypot(v.x, v.y) < TILT_CUE_SPEED
        ) {
          this.tiltCueT = Math.min(TILT_CUE_AFTER_SEC + 1, this.tiltCueT + dt);
        } else {
          this.tiltCueT = 0;
        }
        this.syncTiltFinishCue();
        this.rebuildTiltLiveTrail();
        changed = true;
      }
    }

    // §7 reveal: the ghost ride plays through the recorded states.
    if (this.scene === "tilt-b" && this.tiltScrubPlaying && !this.frozen) {
      this.tiltScrubClock += dt;
      const dur = this.ghostDuration();
      this.tiltScrub = clamp(this.tiltScrubClock / dur, 0, 1);
      if (this.tiltScrub >= 1) this.tiltScrubPlaying = false;
      this.applyTiltGhost();
      this.syncTiltPanel();
      changed = true;
    }

    // §7 swarm finale: advance the flight clock, re-place the instances.
    // QA cycle B (swarm-never-ends): the flight ENDS — past the last launch
    // delay plus one full ride every ball is parked, so playing flips false
    // and the tick stops re-writing 100 instanced matrices + trails forever.
    // setSwarmBlind's rewind re-arms playing.
    if (this.scene === "swarm" && this.swarm && !this.frozen && this.swarm.playing) {
      this.swarm.time += dt;
      this.updateSwarmInstances();
      if (this.swarm.time >= swarmDelay(SWARM_COUNT - 1) + SWARM_RIDE_SEC) {
        this.swarm.playing = false; // the finale has an "over" state
      }
      changed = true;
    }

    // §5: slider drags defer the rebuild to INPUT-IDLE (QA PERF-1 round 2):
    // rebuilding per input frame — or even throttled mid-drag — stacked
    // 150-400ms long tasks (rebuild + software re-raster never keep up with
    // a streaming drag). The rebuild lands ~180ms after the last input, once,
    // with the final slider values. pendingLab stays set until then, so the
    // trailing rebuild is guaranteed.
    if (this.pendingLab && this.built === "lab" && !this.swap) {
      if (performance.now() - this.lastLabInputAt < 180) {
        // Input still streaming (or settling): keep pendingLab set.
      } else {
        this.pendingLab = false;
        const t0 = performance.now();
        const fn = labBowl(this.labE ?? LAB_E_DEFAULT, this.labRot ?? LAB_ROT_DEFAULT);
        this.view.setLandscape(fn, { gridN: 64 });
        this.minimap.setLandscape(fn);
        this.rebuildLabVisuals();
        this.updateDependents();
        this.labRebuildMs = performance.now() - t0;
        changed = true;
      }
    }

    // §4: steepness moves coalesce the same way (terrain + inspector, one
    // rebuild per frame; the extent is steepness-independent so the reframe
    // is a no-op and the camera stays put).
    if (this.pendingAdam && this.built === "adam" && !this.swap) {
      this.pendingAdam = false;
      const s = this.adamS ?? ADAM_STEEP_MIN;
      if (this.builtAdamS !== s) {
        const fn = adamBowl(s);
        this.view.setLandscape(fn);
        this.minimap.setLandscape(fn);
        this.builtAdamS = s;
      }
      this.rebuildAdamVisuals();
      this.updateDependents();
      changed = true;
    }

    // §8: part drags / level swaps coalesce the same way (benchmark + trails
    // + scorecards, one rebuild per frame while a slider streams input).
    if (this.pendingRule && this.built === "rule" && !this.swap) {
      this.pendingRule = false;
      if (this.builtRule !== this.ruleLevel) {
        const level = ruleLevelById(this.ruleLevel);
        this.view.setLandscape(level.landscape, { gridN: 64 });
        this.minimap.setLandscape(level.landscape);
        this.builtRule = this.ruleLevel;
      }
      this.rebuildRuleVisuals();
      this.updateDependents();
      changed = true;
    }

    // §9: the lattice fade and the pinned formula note ride the tweens —
    // advanceTweens already flags `changed` while they run; these applies are
    // idempotent so re-applying here costs nothing when idle.
    if (this.epiLattice && (this.scene === "epi-b" || this.scene === "epi-c")) {
      this.applyEpiLatticeOpacity();
    }
    if (this.scene === "epi-a" && this.epiMarker) {
      this.positionEpiFormula();
    }

    // Hover-to-look: a spotlight over a MOVING target (the drifting ball,
    // the swinging needle's base point) tracks it every frame.
    if (this.lookPointFn) {
      const p = this.lookPointFn();
      if (p) this.view.moveSpotlight(p);
    }

    if (changed) {
      this.view.setTerrainRise(this.val("rise"));
      this.view.setTerrainOpacity(this.val("opac"));
      if (spec.fit) this.fit = { x: this.val("fw"), y: this.val("fb") };
      if (this.camDirty) {
        this.view.setAttitude(this.val("azim"), this.val("elev"), this.val("zoom"));
        if (!this.tweens.has("azim") && !this.tweens.has("elev") && !this.tweens.has("zoom")) {
          this.camDirty = false;
        }
      }
      this.updateDependents();
      this.view.requestRender();
    }
  }

  /* ---------------- §1 user fit dragging ---------------- */

  /** Snap the fit (no tween): inset handles or 3D surface drag. */
  setFitUser(w: number, b: number): void {
    this.tweens.delete("fw");
    this.tweens.delete("fb");
    const e = leastSquares.extent;
    this.fit = { x: clamp(w, e.xMin, e.xMax), y: clamp(b, e.yMin, e.yMax) };
    this.updateDependents();
    this.view.requestRender();
  }

  get currentFit(): Vec2 {
    return this.fit;
  }

  get ballVisible(): boolean {
    const s = this.scene;
    if (s === "swarm") return false; // 100 instanced balls replace the one
    if (s === "tilt-b") return false; // the scrubbable ghost replaces it
    if (s === "tilt-a") {
      return this.built === "tilt" && this.builtTilt === this.tiltLevel.id && this.tiltRun !== null;
    }
    if (s.startsWith("fog")) {
      const want = this.fogLevel?.id === "rb" ? "fog-rb" : "fog-ls";
      return SCENES[s].ball && this.built === want && this.fogSt !== null;
    }
    if (s.startsWith("gd")) return SCENES[s].ball && this.built === "bowl";
    if (s.startsWith("mom")) return SCENES[s].ball && this.built === "mom";
    if (s.startsWith("adam")) return SCENES[s].ball && this.built === "adam";
    if (s === "lab") return SCENES[s].ball && this.built === "lab";
    if (s === "labrule") {
      return (
        SCENES[s].ball && this.built === "rule" && this.builtRule === this.ruleLevel
      );
    }
    if (s === "epi-a" || s === "epi-b" || s === "epi-c") return false;
    return SCENES[s].ball && this.built === "ls";
  }

  /**
   * Whether left-dragging the 3D ball may edit the point: §1 only — §2's
   * point is choreographed (needle drift / fixed start), not grabbable.
   */
  get surfaceDragEnabled(): boolean {
    return this.scene.startsWith("task") && this.ballVisible;
  }

  /** Screen distance (px) from a pointer to the learner ball. */
  screenDistanceToBall(clientX: number, clientY: number): number | null {
    return this.view.screenDistanceToParam(this.currentPoint, clientX, clientY);
  }

  /** Client-space screen position of the learner ball (null when hidden). */
  ballScreen(): { x: number; y: number } | null {
    if (!this.ballVisible) return null;
    return this.view.projectParamToScreen(this.currentPoint);
  }

  /** Pointer -> parameter point on the surface (or flat plane). */
  pickAt(clientX: number, clientY: number): Vec2 | null {
    return this.view.pickParameter(clientX, clientY);
  }

  /* ---------------- §2: eta, arrows, trajectory ---------------- */

  private get currentPoint(): Vec2 {
    if (this.scene === "tilt-a" || this.scene === "tilt-b") {
      return this.tiltRun ? this.tiltRun.pos : { x: 0, y: 0 };
    }
    if (this.scene.startsWith("fog")) return this.fogDrawPoint();
    if (this.scene.startsWith("gd") || this.scene.startsWith("mom")) return this.point;
    if (this.scene.startsWith("adam")) return this.adamPoint;
    if (this.scene === "lab") return this.labPoint;
    if (this.scene === "labrule") return ruleLevelById(this.ruleLevel).start;
    return this.fit;
  }

  /** GD's actual step from the current point at the §2 reference η. */
  private gdStepDelta(): Vec2 {
    const g = defaultBowl.grad(this.point);
    return { x: -GD_STEP_ETA * g.x, y: -GD_STEP_ETA * g.y };
  }

  /** GD's actual step TIP (absolute parameter point) at the §2 reference η.
   *  Stored ABSOLUTE, never as a delta: updateGdArrows lerps point→tip and
   *  draws d = tip − point, so a delta here doubles the arrow's length and
   *  swings it across the valley (visual verdict n2-1). */
  private gdStepTip(): Vec2 {
    const d = this.gdStepDelta();
    return { x: this.point.x + d.x, y: this.point.y + d.y };
  }

  private driftPoint(t: number): Vec2 {
    const k = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / DRIFT_PERIOD);
    return lerp2(GD_START, DRIFT_B, k);
  }

  /** Slider input (live): re-run GD at η and refresh every readout. */
  setEta(eta: number): void {
    if (this.scene !== "gd-c" && this.scene !== "gd-d") return;
    this.eta = clamp(eta, ETA_MIN, ETA_MAX);
    this.syncEtaUi();
    this.rebuildTrajectory();
    this.updateDependents();
    this.view.requestRender();
  }

  /** β slider input (live): re-run momentum and relight the apex markers. */
  setBeta(beta: number): void {
    if (!this.scene.startsWith("mom")) return;
    this.momBeta = clamp(beta, 0, MOM_BETA_MAX);
    this.syncBetaUi();
    this.rebuildMomVisuals();
    this.updateDependents();
    this.view.requestRender();
  }

  /** Steepness slider input (live): store the scale; ONE coalesced terrain +
   *  inspector rebuild lands on the next animation frame (input events fire
   *  several times per frame — a setLandscape per event was pure churn). */
  setSteepness(s: number): void {
    if (!this.scene.startsWith("adam")) return;
    this.adamS = clamp(s, ADAM_STEEP_MIN, ADAM_STEEP_MAX);
    this.syncSteepUi();
    this.pendingAdam = true;
    this.view.requestRender();
  }

  /** Minimap arrow-drag: live preview of the user's step (gd-b, fog-a/b). */
  onArrowPreview(tip: Vec2): void {
    if (this.fogPreview(tip)) return;
    if (this.scene !== "gd-b" || this.frozen) return;
    this.userTip = { ...tip };
    this.gdAnimT = 0; // re-drag restarts the step animation
    this.updateGdArrows(0);
    this.updateTransport();
    this.view.requestRender();
  }

  /** Minimap arrow-drag: commit — the user arrow stays, GD's step animates. */
  onArrowCommit(tip: Vec2): void {
    if (this.fogCommitStep(tip)) return;
    if (this.scene !== "gd-b") return;
    this.userTip = { ...tip };
    this.gdTipFull = this.gdStepTip();
    this.gdAnimT = this.frozen ? 1 : 0;
    this.updateGdArrows(this.gdAnimT);
    this.updateTransport(); // the Play transport appears once data exists
    this.view.requestRender();
  }

  /** Diagnostics for smoke checks (no page behavior). */
  get debugSnap(): Record<string, unknown> {
    return {
      scene: this.scene,
      built: this.built,
      rise: this.val("rise"),
      opac: this.val("opac"),
      tweens: [...this.tweens.keys()],
      camDirty: this.camDirty,
      swap: this.swap ? this.swap.stage : null,
      cam: { azim: this.val("azim"), elev: this.val("elev"), zoom: this.val("zoom") },
      viewAttitude: { ...this.view.attitude },
      frozen: this.frozen,
    };
  }

  /** Diagnostics for smoke checks (no page behavior). */
  get gdState(): {
    point: Vec2;
    eta: number | null;
    regime: EtaRegime | null;
    userTip: Vec2 | null;
    gdTip: Vec2 | null;
    pathSteps: number;
    pathEnd: Vec2 | null;
  } {
    const path = this.eta === null ? null : runGdPath(this.eta);
    return {
      point: { ...this.point },
      eta: this.eta,
      regime: this.eta === null ? null : regimeOf(this.eta),
      userTip: this.userTip ? { ...this.userTip } : null,
      gdTip: this.gdTipFull ? { ...this.gdTipFull } : null,
      pathSteps: path ? path.length - 1 : 0,
      pathEnd: path ? { ...path[path.length - 1] } : null,
    };
  }

  /** Diagnostics for smoke checks (no page behavior). */
  get momState(): {
    beta: number | null;
    regime: MomRegime | null;
    gdSteps: number;
    momSteps: number;
    gdEnd: Vec2 | null;
    momEnd: Vec2 | null;
    apexes: number;
  } {
    const gdP = runMomGdPath();
    const momP = this.momBeta === null ? null : runMomentumPath(this.momBeta);
    return {
      beta: this.momBeta,
      regime: this.momBeta === null ? null : momRegimeOf(this.momBeta),
      gdSteps: gdP.length - 1,
      momSteps: momP ? momP.length - 1 : 0,
      gdEnd: gdP[gdP.length - 1] ?? null,
      momEnd: momP ? (momP[momP.length - 1] ?? null) : null,
      apexes: momP ? momApexes(momP).length : 0,
    };
  }

  /** Diagnostics for smoke checks (no page behavior). */
  get adamState(): AdamInspector | null {
    return this.adamS === null ? null : adamInspect(this.adamS);
  }

  get steepness(): number | null {
    return this.adamS;
  }

  /* ---------------- §5: the disagreement lab ---------------- */

  /**
   * Lab slider input (live): stores the state and flags ONE coalesced
   * rebuild, DEBOUNCED to input-idle (QA PERF-1 round 2: a rebuild per
   * input event stacked 150-300ms+ long tasks under software raster —
   * rebuild+re-raster never kept up with a streaming drag). While the drag
   * streams, the built valley holds its last state; ~180ms after the last
   * input, one rebuild lands with the final slider values.
   */
  setLab(E: number, rotDeg: number): void {
    if (this.scene !== "lab") return; // exact: §8's "labrule" is a different scene
    this.labE = clamp(E, LAB_E_MIN, LAB_E_MAX);
    this.labRot = clamp(rotDeg, 0, LAB_ROT_MAX);
    this.syncLabUi();
    this.lastLabInputAt = performance.now();
    this.pendingLab = true;
    // NO requestRender here (QA PERF-1): per-input renders re-raster the
    // whole scene and stack 100-400ms long tasks. The canvas keeps showing
    // the last-built valley until the idle rebuild lands — that rebuild's
    // updateDependents + requestRender render the new state exactly once.
  }

  setCurvesLog(log: boolean): void {
    this.curvesLog = log;
    if (this.scene === "lab") this.pendingLab = true;
  }

  /** Current lab slider state (so the two sliders stay in sync). */
  get labParams(): { E: number; rot: number } | null {
    return this.labE === null || this.labRot === null
      ? null
      : { E: this.labE, rot: this.labRot };
  }

  /** Diagnostics for smoke checks (no page behavior). */
  get labState(): {
    E: number | null;
    rot: number | null;
    checks: LabChecks | null;
    rebuildMs: number;
  } {
    if (this.labE === null || this.labRot === null) {
      return { E: null, rot: null, checks: null, rebuildMs: this.labRebuildMs };
    }
    const full = labChecks(this.labE, this.labRot);
    return {
      E: this.labE,
      rot: this.labRot,
      checks: {
        gdFlips: full.gdFlips,
        momOvershoot: full.momOvershoot,
        adamInvariant: full.adamInvariant,
        zigzag: full.zigzag,
        overshoot: full.overshoot,
        invariant: full.invariant,
      },
      rebuildMs: this.labRebuildMs,
    };
  }

  /** Re-runs the three races, redraws trails + curves + checklist. */
  private rebuildLabVisuals(): void {
    this.clearReplayVisuals();
    this.clearLabVisuals();
    if (this.labE === null || this.labRot === null || this.built !== "lab") return;

    const checks = labChecks(this.labE, this.labRot);
    this.labPoint = labStart(labBowl(this.labE, this.labRot));
    const specs: Array<{ path: Vec2[]; color: number; losses: number[] }> = [
      { path: checks.gdPath, color: OPTIMIZER_COLORS.gd, losses: checks.gdLosses },
      { path: checks.momPath, color: OPTIMIZER_COLORS.momentum, losses: checks.momLosses },
      { path: checks.adamPath, color: OPTIMIZER_COLORS.adam, losses: checks.adamLosses },
    ];

    this.minimap.setPaths(
      specs.map((s) => ({
        points: s.path,
        color:
          s.color === OPTIMIZER_COLORS.gd
            ? "rgba(252,98,85,0.85)"
            : s.color === OPTIMIZER_COLORS.momentum
              ? "rgba(88,196,221,0.9)"
              : "rgba(244,211,69,0.9)",
      })),
    );
    for (const s of specs) {
      if (s.path.length >= 2) {
        const t = new AnimatedTrail(this.view, s.path, s.color);
        t.setProgress(1);
        t.setAlpha(1);
        this.labTrails.push(t);
      }
    }

    const curves: LossCurve[] = specs.map((s) => ({
      losses: s.losses,
      color:
        s.color === OPTIMIZER_COLORS.gd
          ? "#FC6255"
          : s.color === OPTIMIZER_COLORS.momentum
            ? "#58C4DD"
            : "#F4D345",
    }));
    this.curves.setCurves(curves, this.curvesLog);

    this.updateChecklist(checks);
    // A hover spotlight re-dims the fresh trails (hover-to-look).
    this.reapplyLook();
  }

  private updateChecklist(checks: LabChecks): void {
    if (this.els.checkGd) this.els.checkGd.dataset.lit = String(checks.zigzag);
    if (this.els.checkMom) this.els.checkMom.dataset.lit = String(checks.overshoot);
    if (this.els.checkAdam) this.els.checkAdam.dataset.lit = String(checks.invariant);
  }

  private clearLabVisuals(): void {
    for (const t of this.labTrails) t.dispose();
    this.labTrails = [];
  }

  private syncLabUi(): void {
    if (this.els.elongSlider && this.labE !== null) {
      const t =
        Math.log10(this.labE / LAB_E_MIN) / Math.log10(LAB_E_MAX / LAB_E_MIN);
      this.els.elongSlider.value = String(Math.round(clamp(t, 0, 1) * 1000));
    }
    if (this.els.elongValue && this.labE !== null) {
      this.els.elongValue.textContent = `×${this.labE.toFixed(0)}`;
    }
    if (this.els.rotSlider && this.labRot !== null) {
      this.els.rotSlider.value = String(Math.round((this.labRot / LAB_ROT_MAX) * 1000));
    }
    if (this.els.rotValue && this.labRot !== null) {
      this.els.rotValue.textContent = `${this.labRot.toFixed(0)}°`;
    }
  }

  /* ---------------- §6: the fog game ---------------- */

  /** The ball's CURRENT drawn position: mid-step it walks from→to eased. */
  private fogDrawPoint(): Vec2 {
    if (this.fogAnim) {
      const k = easeInOutCubic(Math.min(1, this.fogAnim.t));
      return lerp2(this.fogAnim.from, this.fogAnim.to, k);
    }
    return this.fogSt ? this.fogSt.point : { x: 0, y: 0 };
  }

  /** Live loss under the ball (the one number the fog gives up). */
  private fogDrawLoss(): number {
    if (!this.fogLevel) return 0;
    return this.fogLevel.landscape.f(this.fogDrawPoint());
  }

  /**
   * Landscape-bound fog visuals: (re)initialize the mask after a rebuild,
   * spawn the reveal marker, build the fog-c ghosts + scorecard. Runs after
   * every rebuild / scene layout via refreshGdVisuals.
   */
  private refreshFogVisuals(): void {
    const level = this.fogLevel;
    const st = this.fogSt;
    if (!level || !st) return;
    const want = level.id === "ls" ? "fog-ls" : "fog-rb";
    if (this.built !== want) return; // swap still sinking — again after rebuild
    if (!this.fogMaskReady) {
      this.view.setFogEnabled(true);
      this.view.fogReset();
      // Paint everything the run has already walked (a fresh game = just the
      // start patch). Curated frozen poses (?shot=fog-b) arrive pre-played,
      // so their walked segments must be painted in here.
      this.view.fogStampAt(st.path[0], level.stampFrac);
      for (let i = 1; i < st.path.length; i++) {
        this.view.fogStampSegment(st.path[i - 1], st.path[i], level.stampFrac);
      }
      this.fogStampFrom = { ...st.path[st.path.length - 1] };
      this.fogMaskReady = true;
    }
    if (st.done) this.spawnFogMarker();
    if (this.scene === "fog-c") {
      this.updateFogScorecard();
      if (!this.fogGhosts) this.buildFogGhosts(this.frozen);
    }
  }

  /** Minimap drag preview (fog scenes): clamped to the stride ring. */
  private fogPreview(tip: Vec2): boolean {
    if (
      (this.scene !== "fog-a" && this.scene !== "fog-b") ||
      this.frozen ||
      !this.fogLevel ||
      !this.fogSt ||
      this.fogSt.done
    ) {
      return false;
    }
    // Snap to the fog cell grid FIRST (strides read like board-game moves
    // and the drawn arrow lands on an unambiguous spot), then cap at the
    // stride ring so a snap can never buy extra reach.
    this.fogPreviewTip = fogClampTip(
      this.fogLevel,
      this.fogSt.point,
      fogSnapToCell(this.fogLevel, tip),
    );
    this.minimap.setArrows({ userTip: this.fogPreviewTip, gdTip: null });
    this.view.requestRender();
    return true;
  }

  /** Minimap drag commit (fog scenes): spend a measurement, start the walk. */
  private fogCommitStep(tip: Vec2): boolean {
    const level = this.fogLevel;
    const st = this.fogSt;
    if (
      (this.scene !== "fog-a" && this.scene !== "fog-b") ||
      this.frozen ||
      !level ||
      !st ||
      st.done
    ) {
      return false;
    }
    // Same order as the preview: snap to the cell grid, then cap at the ring.
    const clamped = fogClampTip(
      level,
      st.point,
      fogSnapToCell(level, tip),
    );
    if (Math.hypot(clamped.x - st.point.x, clamped.y - st.point.y) < fogMinStep(level)) {
      // Visible cue (QA G2-1/N5-S2): a silently rejected stride stalled
      // players in flat basins — flash the compass stride ring red.
      this.minimap.flashStrideReject();
      return false; // a mis-drag must never waste the budget
    }
    this.fogPreviewTip = null;
    this.fogSt = fogCommit(level, st, clamped); // measurement spent NOW
    this.fogAnim = { from: { ...st.point }, to: { ...clamped }, t: 0 };
    this.fogStampFrom = { ...st.point };
    this.minimap.setArrows({ userTip: null, gdTip: null });
    this.view.requestRender();
    return true;
  }

  /**
   * The reveal beat: the run ends (budget spent or Finish pressed) — the fog
   * lifts fully (eased), the true global minimum gets its gold marker, and
   * the annotation names the trap when the player stopped on it.
   */
  finishFogRun(): void {
    const level = this.fogLevel;
    const st = this.fogSt;
    if (!level || !st) return;
    const doneSt: FogState = st.done ? st : { ...st, done: true };
    this.fogSt = doneSt;
    if (this.fogAnim) {
      // Finish pressed mid-stride: land the walk instantly.
      this.view.fogStampSegment(
        this.fogStampFrom ?? this.fogAnim.from,
        doneSt.point,
        level.stampFrac,
      );
      this.fogAnim = null;
      this.fogStampFrom = null;
    }
    this.tween("fogrev", 1, 1.6);
    this.spawnFogMarker();
    this.syncFogPanel();
    this.view.requestRender();
  }

  /** Gold core + additive halo at the level's true global minimum. */
  private spawnFogMarker(): void {
    const level = this.fogLevel;
    if (!level || this.fogMarker) return;
    const group = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(1, 18, 14),
      new THREE.MeshBasicMaterial({
        color: MANIM.gold,
        transparent: true,
        opacity: this.frozen ? 0.98 : 0.95,
      }),
    );
    core.scale.setScalar(this.view.diagonal * 0.013);
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(1, 18, 14),
      new THREE.MeshBasicMaterial({
        color: MANIM.gold,
        transparent: true,
        opacity: 0.25,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    halo.scale.setScalar(this.view.diagonal * 0.034);
    group.add(core, halo);
    this.view.parameterToWorld(
      level.globalMin,
      this.view.trailLift + this.view.diagonal * 0.014,
      group.position,
    );
    this.view.addOverlayObject(group);
    this.fogMarker = group;

    // The annotation: the local-minimum story lands only when the player
    // actually finished ON the Rosenbrock trap.
    if (this.els.fogNote) {
      const onTrap = level.id === "rb" && this.fogSt !== null && inRosenbrockTrap(this.fogSt.point);
      this.els.fogNote.textContent = onTrap
        ? "the global minimum lay across this unvisited ridge"
        : "the true global minimum";
    }
  }

  /** The four reveal ghosts: the player's run in white, then GD/momentum/
   *  Adam from the SAME start, staggered ~0.9 s apart. */
  private buildFogGhosts(frozen: boolean): void {
    this.clearFogGhostStage();
    const level = this.fogLevel;
    const st = this.fogSt;
    if (!level || !st) return;
    const want = level.id === "ls" ? "fog-ls" : "fog-rb";
    if (this.built !== want) return;
    const machines = this.fogMachines ?? runFogMachines(level);
    this.fogMachines = machines;
    // QA cycle B (student-1): an untouched run stages no white ghost at all
    // — substituting the curated ride narrated a run the student never made.
    // (Frozen ?shot=fog-c poses carry the canned run in fogSt, so they keep
    // the full four-lane reveal.)
    const moved = st.path.length >= 2;
    const specs: Array<{ path: Vec2[]; color: number; delay: number; glow: number }> = moved
      ? [
          { path: st.path.map((p) => ({ ...p })), color: OPTIMIZER_COLORS.learner, delay: 0, glow: 1 },
          { path: machines[0].path, color: OPTIMIZER_COLORS.gd, delay: 0.9, glow: 0.4 },
          { path: machines[1].path, color: OPTIMIZER_COLORS.momentum, delay: 1.8, glow: 0.4 },
          { path: machines[2].path, color: OPTIMIZER_COLORS.adam, delay: 2.7, glow: 0.4 },
        ]
      : [
          { path: machines[0].path, color: OPTIMIZER_COLORS.gd, delay: 0, glow: 0.4 },
          { path: machines[1].path, color: OPTIMIZER_COLORS.momentum, delay: 0.9, glow: 0.4 },
          { path: machines[2].path, color: OPTIMIZER_COLORS.adam, delay: 1.8, glow: 0.4 },
        ];

    const group = new THREE.Group();
    const lanes = specs.map((spec) => {
      const trail = new AnimatedTrail(this.view, spec.path, spec.color, 1.6, spec.glow);
      const ball = new THREE.Mesh(
        new THREE.SphereGeometry(1, 16, 12),
        new THREE.MeshBasicMaterial({ color: spec.color }),
      );
      ball.scale.setScalar(this.view.diagonal * 0.014);
      group.add(ball);
      const dur = frozen
        ? 1
        : clamp(1.8 + (spec.path.length - 1) * 0.05, 2.4, 4.8);
      const player = new TrajectoryPlayer(dur, this.replaySpeed);
      if (frozen) {
        trail.setProgress(1);
        trail.setAlpha(1);
        const end = spec.path[spec.path.length - 1];
        this.view.parameterToWorld(
          end,
          this.view.trailLift + this.view.diagonal * 0.016,
          ball.position,
        );
      } else {
        trail.setProgress(0);
        ball.visible = false;
        // Start every lane now: the per-frame loop gates each update() behind
        // the lane's stagger delay, but constructing a player never starts
        // it — without play() here the delay-0 player lane (and any lane
        // that hadn't expired yet) sat frozen forever (QA F-1).
        player.play();
      }
      return {
        path: spec.path,
        trail,
        ball,
        player,
        delay: frozen ? 0 : spec.delay,
        delay0: spec.delay,
        dur,
      };
    });
    this.view.addOverlayObject(group);
    this.fogGhosts = { group, lanes };
    this.fogGhostTotal = frozen
      ? 0
      : Math.max(...lanes.map((l) => l.delay + l.dur));
    this.ghostClock = 0;
    this.ghostsPaused = false;
    // QA ANIM-1: the auto-played race never re-synced the transport — the
    // button kept reading "▶ Play" for the whole cinematic. Sync at race
    // start so it reads ❚❚ Pause while the ghosts run.
    if (!frozen) this.syncTransport();
  }

  private fogGhostsPlaying(): boolean {
    if (!this.fogGhosts || this.ghostsPaused) return false;
    return this.fogGhosts.lanes.some(
      (lane) => lane.delay > 0 || lane.player.isPlaying,
    );
  }

  /** Skip support: every ghost lands at its end instantly. */
  private finishFogGhostsNow(): void {
    if (!this.fogGhosts) return;
    for (const lane of this.fogGhosts.lanes) {
      lane.delay = 0;
      lane.player.update(999); // drives tSec past the end; stops the player
      lane.trail.setProgress(1);
      const end = lane.path[lane.path.length - 1];
      this.view.parameterToWorld(
        end,
        this.view.trailLift + this.view.diagonal * 0.016,
        lane.ball.position,
      );
      lane.ball.visible = true;
    }
    this.fogGhostTotal = 0;
    this.ghostClock = 0;
    this.ghostsPaused = false;
    this.view.requestRender();
  }

  /** Reveal scorecard: you vs the machines — measurements + final loss. */
  private updateFogScorecard(): void {
    const body = this.els.fogScoreBody;
    const level = this.fogLevel;
    const st = this.fogSt;
    if (!body || !level || !st) return;
    const machines = this.fogMachines ?? runFogMachines(level);
    this.fogMachines = machines;
    // QA cycle B (student-1): a scrolled-through run gets an honest
    // empty-run verdict, never a trap narrative for a stop never made.
    const empty = st.used === 0;

    const rows: Array<{ label: string; color: string; meas: number; loss: number; you: boolean }> = [
      {
        label: empty ? "you (no run)" : "you (manual run)",
        color: "#FFFFFF",
        meas: st.used,
        loss: level.landscape.f(st.point),
        you: true,
      },
      ...machines.map((m) => ({
        label: m.label,
        color: m.cssColor,
        meas: m.steps,
        loss: m.finalLoss,
        you: false,
      })),
    ];
    const minMeas = Math.min(...rows.map((r) => r.meas));
    const minLoss = Math.min(...rows.map((r) => r.loss));

    body.replaceChildren(
      ...rows.map((r) => {
        const tr = document.createElement("tr");
        const name = document.createElement("td");
        name.textContent = r.label;
        name.style.color = r.color;
        const meas = document.createElement("td");
        meas.textContent = String(r.meas);
        meas.className = "mono";
        if (r.meas === minMeas) meas.dataset.best = "true";
        const loss = document.createElement("td");
        loss.textContent = fogFormatLoss(r.loss);
        loss.className = "mono";
        if (r.loss === minLoss) loss.dataset.best = "true";
        tr.append(name, meas, loss);
        return tr;
      }),
    );

    if (this.els.fogVerdict) {
      if (empty) {
        this.els.fogVerdict.textContent =
          "You never took a measurement — the three optimizers ran the shared start blind. Scroll back to Level 2 and draw at least one stride.";
      } else {
        const you = rows[0];
        const best = machines.reduce((a, b) => (b.finalLoss < a.finalLoss ? b : a));
        this.els.fogVerdict.textContent =
          you.loss <= best.finalLoss
            ? `You stopped lower than every optimizer — on ${you.meas} measurements, not ${best.steps}.`
            : `The best optimizer stopped lower (ℒ ${fogFormatLoss(best.finalLoss)}) — at the cost of ${best.steps} measurements to your ${you.meas}.`;
      }
    }

    // The reveal's narrative paragraphs: only the played-run story talks
    // about a run. Swap them out wholesale for the empty-run case.
    if (this.els.fogRunLead) this.els.fogRunLead.hidden = empty;
    if (this.els.fogEmptyLead) this.els.fogEmptyLead.hidden = !empty;
    if (this.els.fogTrapNote) this.els.fogTrapNote.hidden = empty;
    if (this.els.fogEmptyVerdictNote) this.els.fogEmptyVerdictNote.hidden = !empty;
  }

  /** Fog panel: level name, measurements/budget, live loss, budget bar,
   *  Finish button, reveal annotation. */
  private syncFogPanel(): void {
    const on = this.fogLevel !== null && this.fogSt !== null && this.scene.startsWith("fog");
    setHud(this.els.fogPanel, on);
    if (!on || !this.fogLevel || !this.fogSt) {
      setHud(this.els.fogNote, false);
      if (this.els.fogFinishBtn) this.els.fogFinishBtn.hidden = true;
      return;
    }
    const level = this.fogLevel;
    const st = this.fogSt;
    // fog-a keeps the §1 fit inset in the top-left slot — stack below it.
    if (this.els.fogPanel) {
      this.els.fogPanel.dataset.below = String(level.id === "ls" && SCENES[this.scene].hud.fit === true);
    }
    if (this.els.fogLevelEl) {
      this.els.fogLevelEl.textContent = `level ${level.ordinal} · ${level.name}`;
    }
    if (this.els.fogMeas) {
      this.els.fogMeas.textContent = `${st.used} / ${level.budget}`;
    }
    if (this.els.fogLoss) {
      this.els.fogLoss.textContent = fogFormatLoss(this.fogDrawLoss());
    }
    if (this.els.fogBudgetFill) {
      this.els.fogBudgetFill.style.width = `${Math.min(100, (st.used / level.budget) * 100)}%`;
      this.els.fogBudgetFill.dataset.full = String(st.used >= level.budget);
    }
    if (this.els.fogFinishBtn) this.els.fogFinishBtn.hidden = st.done;
    setHud(this.els.fogNote, st.done);
  }

  /** Pins the gold reveal annotation just above the true-minimum marker. */
  private positionFogNote(): void {
    const note = this.els.fogNote;
    if (!note || !this.fogLevel || !this.fogSt || !this.fogSt.done) return;
    const s = this.view.projectParamToScreen(this.fogLevel.globalMin);
    if (!s) return;
    note.style.left = `${Math.round(s.x)}px`;
    note.style.top = `${Math.round(s.y)}px`;
  }

  /** Per-frame fog scene upkeep: uniforms, ball, minimap, panel, note. */
  private updateFogDependents(): void {
    const level = this.fogLevel;
    const st = this.fogSt;
    if (!level || !st) {
      setHud(this.els.fogPanel, false);
      setHud(this.els.fogNote, false);
      return;
    }
    const want = level.id === "ls" ? "fog-ls" : "fog-rb";
    if (this.built !== want) {
      // Crossfade in flight: the outgoing terrain is still on stage — keep
      // the dark panel state and wait for the rebuild.
      this.view.setBall(null);
      setHud(this.els.fogPanel, false);
      setHud(this.els.fogNote, false);
      return;
    }

    // Fog uniforms ride whatever tween is running (the reveal beat).
    const rev = this.val("fogrev");
    this.view.setFogReveal(rev);
    this.view.setContourReveal(rev);

    const p = this.fogDrawPoint();
    this.view.setBall(p, OPTIMIZER_COLORS.learner);
    this.minimap.setPoint(p, level.landscape.grad(p));
    const cells = fogCellGrid(level);
    this.minimap.setFog({
      path: st.path,
      reach: fogReach(level),
      done: st.done,
      cells: { nx: cells.nx, ny: cells.ny },
    });
    this.minimap.setArrows({ userTip: this.fogPreviewTip, gdTip: null });

    if (level.id === "ls") {
      // Continuity with §1: the fit inset + w/b readouts track the fog point.
      this.fitPreview.setFit(p.x, p.y);
      if (this.els.roW) this.els.roW.textContent = p.x.toFixed(2);
      if (this.els.roB) this.els.roB.textContent = p.y.toFixed(2);
    }

    this.syncFogPanel();
    this.positionFogNote();
  }

  /** Everything the fog section put on stage (leaving §6 / new level). */
  private clearFogStage(): void {
    this.clearFogGhostStage();
    if (this.fogMarker) {
      this.view.removeOverlayObject(this.fogMarker);
      this.fogMarker = null;
    }
    this.fogLevel = null;
    this.fogSt = null;
    this.fogMaskReady = false;
    this.minimap.setFog(null);
    this.minimap.setArrows({ userTip: null, gdTip: null });
    this.view.setFogEnabled(false);
    setHud(this.els.fogPanel, false);
    setHud(this.els.fogNote, false);
  }

  private clearFogGhostStage(): void {
    if (this.fogGhosts) {
      for (const lane of this.fogGhosts.lanes) lane.trail.dispose();
      this.view.removeOverlayObject(this.fogGhosts.group);
      this.fogGhosts = null;
    }
    this.fogGhostTotal = 0;
    this.ghostClock = 0;
    this.ghostsPaused = false;
  }

  /** Diagnostics for smoke checks (no page behavior). */
  get fogState(): {
    level: FogLevel["id"] | null;
    used: number;
    budget: number;
    point: Vec2;
    pathLen: number;
    /** The committed path (copy) — probes verify where strides landed. */
    path: Vec2[];
    loss: number;
    done: boolean;
    trapFinish: boolean;
    reveal: number;
    maskReady: boolean;
    stamps: number;
    ghosts: number;
    ghostsPlaying: boolean;
    ghostsPaused: boolean;
    machines: Array<{ label: string; steps: number; finalLoss: number }> | null;
  } | null {
    if (!this.fogLevel || !this.fogSt) return null;
    return {
      level: this.fogLevel.id,
      used: this.fogSt.used,
      budget: this.fogLevel.budget,
      point: { ...this.fogSt.point },
      pathLen: this.fogSt.path.length,
      path: this.fogSt.path.map((p) => ({ ...p })),
      loss: this.fogSt.loss,
      done: this.fogSt.done,
      trapFinish:
        this.fogLevel.id === "rb" && inRosenbrockTrap(this.fogSt.point),
      reveal: this.val("fogrev"),
      maskReady: this.fogMaskReady,
      stamps: this.view.fogStamps,
      ghosts: this.fogGhosts ? this.fogGhosts.lanes.length : 0,
      ghostsPlaying: this.fogGhostsPlaying(),
      ghostsPaused: this.ghostsPaused,
      machines: this.fogMachines
        ? this.fogMachines.map((m) => ({
            label: m.label,
            steps: m.steps,
            finalLoss: m.finalLoss,
          }))
        : null,
    };
  }

  /* ---------------- §7: the tilt game ---------------- */

  /** Held keys → screen-axis tilt; the director maps it to parameter space
   *  through the camera azimuth so W is always "up-screen". */
  setTiltKey(key: string, down: boolean): void {
    const k = key.length === 1 ? key.toLowerCase() : key;
    if (down) this.tiltKeys.add(k);
    else this.tiltKeys.delete(k);
    const pos = (names: string[]): number =>
      names.some((n) => this.tiltKeys.has(n)) ? 1 : 0;
    this.tiltInput = {
      x: pos(["d", "ArrowRight"]) - pos(["a", "ArrowLeft"]),
      y: pos(["w", "ArrowUp"]) - pos(["s", "ArrowDown"]),
    };
  }

  clearTiltKeys(): void {
    this.tiltKeys.clear();
    this.tiltInput = { x: 0, y: 0 };
  }

  /** Whether the tilt game currently owns the movement keys. */
  get wantsTiltKeys(): boolean {
    return (
      this.scene === "tilt-a" &&
      !this.frozen &&
      this.tiltRun !== null &&
      !this.tiltRun.done
    );
  }

  /** Screen-axis input → parameter-space tilt (rotated by the camera azimuth
   *  so the keys stay screen-relative while the world stays in parameters). */
  private tiltInputParam(): Vec2 {
    const a = (this.view.attitude.azimuthDeg * Math.PI) / 180;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    return {
      x: this.tiltInput.x * ca - this.tiltInput.y * sa,
      y: this.tiltInput.x * sa + this.tiltInput.y * ca,
    };
  }

  /** Friction slider input (live during play): the damping c, the β analogy. */
  setTiltFriction(c: number): void {
    this.tiltFriction = clamp(c, 0, TILT_FRICTION_MAX);
    this.syncTiltPanel();
    this.view.requestRender();
  }

  get tiltFrictionValue(): number {
    return this.tiltFriction;
  }

  /** Level switch: fresh run, terrain swapped in place (same tilt scene). */
  setTiltLevel(id: TiltLevelId): void {
    if (this.frozen || !(this.scene === "tilt-a")) return;
    const level = tiltLevelById(id);
    if (level.id === this.tiltLevel.id && this.tiltRun && !this.tiltRun.done) return;
    this.tiltLevel = level;
    this.tiltRun = tiltInit(level, { requireInput: true });
    this.tiltMachineRuns = null;
    this.tiltAccum = 0;
    this.tiltCueT = 0;
    this.syncTiltFinishCue();
    this.clearTiltReveal();
    this.clearTiltStampMesh();
    this.tiltLiveTrail = null;
    this.tiltLiveBuilt = 0;
    if (this.built === "tilt" && this.builtTilt !== level.id) {
      this.view.setLandscape(level.landscape);
      this.minimap.setLandscape(level.landscape);
      this.builtTilt = level.id;
      this.dropTiltRefs();
    }
    this.view.setElevationClamp(this.frozen ? null : { ...TILT_PLAY_CLAMP });
    this.refreshTiltVisuals();
    this.updateDependents();
    this.view.requestRender();
  }

  /** Finish pressed mid-run: the run ends where it stands. */
  finishTiltRun(): void {
    const run = this.tiltRun;
    if (!run || run.done || this.frozen) return;
    tiltFinish(run);
    this.onTiltRunEnded();
    this.view.requestRender();
  }

  /**
   * Restart pressed mid-run (QA cycle B student-2): a fresh, unsteered run
   * at the current level — counters zeroed, stamps and live trail cleared.
   * The board re-freezes at the start until the next key input.
   */
  restartTiltRun(): void {
    const run = this.tiltRun;
    if (this.frozen || this.scene !== "tilt-a" || !run || run.done) return;
    this.tiltRun = tiltInit(this.tiltLevel, { requireInput: true });
    this.tiltMachineRuns = null;
    this.tiltAccum = 0;
    this.tiltCueT = 0;
    this.syncTiltFinishCue();
    this.clearTiltStampMesh();
    this.tiltLiveTrail = null;
    this.tiltLiveBuilt = 0;
    this.refreshTiltVisuals();
    this.updateDependents();
    this.view.requestRender();
  }

  /** The run just ended (settled or Finish): unclamps the camera, scores it. */
  private onTiltRunEnded(): void {
    this.view.setElevationClamp(null);
    this.tiltCueT = 0;
    this.syncTiltFinishCue();
    this.updateTiltScorecard();
    this.syncTiltPanel();
  }

  /**
   * The GP-1 cue: past TILT_CUE_AFTER_SEC of near-stillness the Finish
   * button pulses (dataset flag → CSS animation). Idempotent per state so
   * the tick can call it every frame.
   */
  private syncTiltFinishCue(): void {
    const btn = this.els.tiltFinishBtn;
    if (!btn) return;
    const cue = this.tiltCueT >= TILT_CUE_AFTER_SEC;
    if (cue && btn.dataset.cue !== "pulse") btn.dataset.cue = "pulse";
    else if (!cue && btn.dataset.cue !== undefined) delete btn.dataset.cue;
  }

  /** Ghost-ride length in seconds (recorded samples → wall clock). */
  private ghostDuration(): number {
    const n = this.tiltRun ? this.tiltRun.rec.length : 60;
    return clamp(n * 0.014, 2.5, 11);
  }

  /** Scrubber input: parks the ghost at `frac` of the recorded ride. */
  setTiltScrub(frac: number): void {
    if (this.scene !== "tilt-b" || !this.tiltGhost) return;
    this.tiltScrub = clamp(frac, 0, 1);
    this.tiltScrubPlaying = false;
    this.tiltScrubClock = this.tiltScrub * this.ghostDuration();
    this.applyTiltGhost();
    this.syncTiltPanel();
    this.view.requestRender();
  }

  /**
   * Ghost ▶/❚❚ button: playing → pause; parked mid-ride → resume from the
   * scrub position; parked at the end → restart from the top.
   */
  playTiltGhost(): void {
    if (this.scene !== "tilt-b" || !this.tiltGhost) return;
    if (this.tiltScrubPlaying) {
      this.tiltScrubPlaying = false;
    } else if (this.tiltScrub >= 1) {
      this.tiltScrub = 0;
      this.tiltScrubClock = 0;
      this.tiltScrubPlaying = true;
    } else {
      this.tiltScrubPlaying = true;
    }
    this.applyTiltGhost();
    this.syncTiltPanel();
    this.view.requestRender();
  }

  /** Ghost ↻ button: restarts the recorded ride from the beginning. */
  restartTiltGhost(): void {
    if (this.scene !== "tilt-b" || !this.tiltGhost) return;
    this.tiltScrub = 0;
    this.tiltScrubClock = 0;
    this.tiltScrubPlaying = true;
    this.applyTiltGhost();
    this.syncTiltPanel();
    this.view.requestRender();
  }

  private applyTiltGhost(): void {
    const g = this.tiltGhost;
    const run = this.tiltRun;
    if (!g || !run) return;
    const p = clamp(this.tiltScrub, 0, 1);
    g.trail.setProgress(p);
    const pos = samplePath(run.rec, p);
    this.view.parameterToWorld(
      pos,
      this.view.trailLift + this.view.diagonal * 0.016,
      g.ball.position,
    );
    this.tiltGhostPos = pos;
  }

  /** Landscape-bound tilt visuals — after any rebuild / scene layout. */
  private refreshTiltVisuals(): void {
    const run = this.tiltRun;
    if (!run || this.built !== "tilt" || this.builtTilt !== this.tiltLevel.id) return;
    this.ensureTiltStamps();
    this.rebuildTiltStamps();
    this.rebuildTiltLiveTrail(true);
    if (this.scene === "tilt-b") {
      this.buildTiltReveal();
      this.applyTiltGhost();
    }
    this.syncTiltPanel();
  }

  /** One additive instanced disc per visited measurement cell. */
  private ensureTiltStamps(): void {
    if (this.tiltStamps) return;
    const mesh = new THREE.InstancedMesh(
      new THREE.CircleGeometry(1, 20),
      new THREE.MeshBasicMaterial({
        color: MANIM.teal,
        transparent: true,
        opacity: 0.42,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
      TILT_STAMP_MAX,
    );
    mesh.count = 0;
    mesh.renderOrder = 1;
    mesh.frustumCulled = false;
    this.view.addOverlayObject(mesh);
    this.tiltStamps = mesh;
    this.tiltStampKeys = new Set();
  }

  /** Stamps any not-yet-drawn cells (live runs grow the set). */
  private rebuildTiltStamps(): void {
    const mesh = this.tiltStamps;
    const run = this.tiltRun;
    const level = this.tiltLevel;
    if (!mesh || !run) return;
    const w = tiltDiag(level) * level.cellFrac;
    const e = level.landscape.extent;
    for (const key of run.cells) {
      if (this.tiltStampKeys.has(key)) continue;
      if (mesh.count >= TILT_STAMP_MAX) break;
      this.tiltStampKeys.add(key);
      const bar = key.indexOf("|");
      const ix = Number(key.slice(0, bar));
      const iy = Number(key.slice(bar + 1));
      const p = { x: e.xMin + (ix + 0.5) * w, y: e.yMin + (iy + 0.5) * w };
      this.view.placeOnSurface(p, this.stampDummy, this.view.diagonal * 0.006);
      this.stampDummy.scale.setScalar(w * 0.4);
      this.stampDummy.updateMatrix();
      mesh.setMatrixAt(mesh.count, this.stampDummy.matrix);
      mesh.count += 1;
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  private clearTiltStampMesh(): void {
    if (this.tiltStamps) {
      this.view.removeOverlayObject(this.tiltStamps);
      this.tiltStamps = null;
    }
    this.tiltStampKeys = new Set();
  }

  /** The live run's growing trail — rebuilt in chunks, not per frame. */
  private rebuildTiltLiveTrail(force = false): void {
    const run = this.tiltRun;
    if (!run) return;
    if (!force && run.rec.length - this.tiltLiveBuilt < TILT_LIVE_TRAIL_CHUNK) return;
    if (run.rec.length < 2) return;
    if (this.tiltLiveTrail) this.tiltLiveTrail.dispose();
    this.tiltLiveTrail = new AnimatedTrail(this.view, run.rec, OPTIMIZER_COLORS.learner, 1.6, 0.55);
    this.tiltLiveTrail.setProgress(1);
    this.tiltLiveTrail.setAlpha(0.9);
    this.tiltLiveBuilt = run.rec.length;
  }

  /** The reveal: the scrubbable ghost + the three machine race trails. */
  private buildTiltReveal(): void {
    const run = this.tiltRun;
    const level = this.tiltLevel;
    if (!run || this.built !== "tilt" || this.builtTilt !== level.id) return;

    if (!this.tiltGhost) {
      const rec: Vec2[] = run.rec.length >= 2 ? run.rec : [run.pos, { ...run.pos }];
      const trail = new AnimatedTrail(this.view, rec, OPTIMIZER_COLORS.learner, 1.4, 0.7);
      const ball = new THREE.Mesh(
        new THREE.SphereGeometry(1, 18, 12),
        new THREE.MeshBasicMaterial({
          color: OPTIMIZER_COLORS.learner,
          transparent: true,
          opacity: 0.95,
        }),
      );
      ball.scale.setScalar(this.view.diagonal * 0.016);
      this.view.addOverlayObject(ball);
      this.tiltGhost = { trail, ball };
    }
    if (!this.tiltMachineRuns) {
      this.tiltMachineRuns = runTiltMachines(level, level.start);
    }
    if (this.tiltMachineTrails.length === 0) {
      for (const m of this.tiltMachineRuns) {
        if (m.path.length < 2) continue;
        const color =
          m.key === "gd"
            ? OPTIMIZER_COLORS.gd
            : m.key === "mom"
              ? OPTIMIZER_COLORS.momentum
              : OPTIMIZER_COLORS.adam;
        const t = new AnimatedTrail(this.view, m.path, color, 1.6, 0.45);
        t.setProgress(1);
        t.setAlpha(0.95);
        this.tiltMachineTrails.push(t);
      }
    }
    this.updateTiltScorecard();
  }

  private clearTiltReveal(): void {
    if (this.tiltGhost) {
      this.tiltGhost.trail.dispose();
      this.view.removeOverlayObject(this.tiltGhost.ball);
      this.tiltGhost = null;
    }
    for (const t of this.tiltMachineTrails) t.dispose();
    this.tiltMachineTrails = [];
  }

  /** Scorecard: you vs GD/momentum/Adam, raced from your start. */
  private updateTiltScorecard(): void {
    const body = this.els.tiltScoreBody;
    const run = this.tiltRun;
    const level = this.tiltLevel;
    if (!body || !run) return;
    if (!this.tiltMachineRuns) {
      this.tiltMachineRuns = runTiltMachines(level, level.start);
    }
    const machines = this.tiltMachineRuns;
    const score = tiltScore(level, run);

    const rows: Array<{
      label: string;
      color: string;
      steps: number;
      cells: number | null;
      loss: number;
    }> = [
      {
        label: run.steered ? "you (tilt)" : "you (no run)",
        color: "#FFFFFF",
        steps: score.steps,
        cells: score.cells,
        loss: score.finalLoss,
      },
      ...machines.map((m) => ({
        label: m.label,
        color: m.cssColor,
        steps: m.steps,
        cells: null as number | null,
        loss: m.finalLoss,
      })),
    ];
    const minSteps = Math.min(...rows.map((r) => r.steps));
    const minLoss = Math.min(...rows.map((r) => r.loss));

    body.replaceChildren(
      ...rows.map((r) => {
        const tr = document.createElement("tr");
        const name = document.createElement("td");
        name.textContent = r.label;
        name.style.color = r.color;
        const steps = document.createElement("td");
        steps.textContent = String(r.steps);
        steps.className = "mono";
        if (r.steps === minSteps) steps.dataset.best = "true";
        const cells = document.createElement("td");
        cells.textContent = r.cells === null ? "—" : String(r.cells);
        cells.className = "mono";
        const loss = document.createElement("td");
        loss.textContent = tiltFormatLoss(r.loss);
        loss.className = "mono";
        if (r.loss === minLoss) loss.dataset.best = "true";
        tr.append(name, steps, cells, loss);
        return tr;
      }),
    );

    if (this.els.tiltVerdict) {
      // QA cycle B (student-2): an untouched run is the attract pose and a
      // rail-tick-seeded curated ride is a demo — neither is a performance,
      // and neither is graded as one.
      if (!run.steered) {
        this.els.tiltVerdict.textContent =
          "You never tilted the board — nothing on stage is your run. The optimizers ran the same start blind; scroll back and take a drive.";
        return;
      }
      const reached = machines.filter((m) => m.reached);
      const reachedNames =
        reached.length === 0
          ? "no optimizer reached a minimum"
          : reached.length === machines.length
            ? "all three optimizers reached a minimum"
            : `${reached.map((m) => m.label).join(" and ")} reached a minimum`;
      this.els.tiltVerdict.textContent = score.settled
        ? `You settled into a minimum after ${score.steps} steps and ${score.cells} measurements — ${reachedNames} within ${TILT_MACHINE_STEPS} steps.`
        : `You stopped after ${score.steps} steps and ${score.cells} measurements — ${reachedNames}.`;
    }
  }

  /** Per-frame tilt upkeep: panel, minimap, ball, reveal ghost. */
  private updateTiltDependents(): void {
    const run = this.tiltRun;
    const level = this.tiltLevel;
    if (!run || this.built !== "tilt" || this.builtTilt !== level.id) {
      this.view.setBall(null);
      setHud(this.els.tiltPanel, false);
      return;
    }
    if (this.scene === "tilt-b") {
      this.view.setBall(null); // the ghost replaces the live ball on the reveal
    } else {
      this.view.setBall(run.pos, OPTIMIZER_COLORS.learner);
    }
    this.minimap.setPoint(run.pos, level.landscape.grad(run.pos));
    // The recorded ride is the PLAYER's path — white, not §2's GD red.
    this.minimap.setPaths([{ points: run.rec, color: "rgba(255,255,255,0.9)" }]);
    this.syncTiltPanel();
  }

  /**
   * The swarm scorecard: one row per OCCUPIED well with its crowd size and
   * MEAN final loss. Balls are bucketed to the nearest well center (the six
   * basins are far apart, so nearest-center == basin); MULTI_WELL_WELLS is
   * ordered deepest-first, so the canyon row is the global basin.
   */
  private swarmClusterRows(): Array<{
    name: string;
    count: number;
    meanLoss: number;
    global: boolean;
  }> {
    const sw = this.swarm;
    if (!sw) return [];
    const f = SWARM_LEVEL.landscape.f;
    const rows = MULTI_WELL_WELLS.map((w) => ({
      name: w.name,
      count: 0,
      sum: 0,
      meanLoss: 0,
      global: w === MULTI_WELL_WELLS[0], // the deep canyon IS the global basin
    }));
    for (const path of sw.sim.paths) {
      const end = path[path.length - 1];
      let nearest = 0;
      let bd = Infinity;
      MULTI_WELL_WELLS.forEach((w, wi) => {
        const d = Math.hypot(w.x - end.x, w.y - end.y);
        if (d < bd) {
          bd = d;
          nearest = wi;
        }
      });
      rows[nearest].count += 1;
      rows[nearest].sum += f(end);
    }
    return rows
      .filter((r) => r.count > 0)
      .map((r) => ({ name: r.name, count: r.count, meanLoss: r.sum / r.count, global: r.global }));
  }

  /** Panel readouts, sub-section visibility, slider/button state. */
  private syncTiltPanel(): void {
    const tiltScene = this.scene === "tilt-a" || this.scene === "tilt-b";
    const swarmScene = this.scene === "swarm";
    setHud(this.els.tiltPanel, tiltScene || swarmScene);
    if (!this.els.tiltPanel) return;
    // The swarm reuses the panel but hides the play controls (they would be
    // dead: no run, no levels, no damping to tune).
    this.els.tiltPanel.dataset.mode = swarmScene ? "swarm" : "game";
    const run = this.tiltRun;
    const level = this.tiltLevel;

    if (this.els.tiltLevelEl) {
      this.els.tiltLevelEl.textContent = swarmScene
        ? "swarm finale · many minima"
        : `level ${level.ordinal} · ${level.name}`;
    }
    if (this.els.tiltInputEl) {
      const t = this.tiltInput;
      this.els.tiltInputEl.textContent = this.wantsTiltKeys
        ? `${t.x >= 0 ? "+" : "−"}${Math.abs(t.x).toFixed(1)} / ${t.y >= 0 ? "+" : "−"}${Math.abs(t.y).toFixed(1)}`
        : "—";
    }
    if (this.els.tiltCells) this.els.tiltCells.textContent = String(run?.cells.length ?? 0);
    if (this.els.tiltSteps) this.els.tiltSteps.textContent = String(run?.steps ?? 0);
    if (this.els.tiltLoss) {
      this.els.tiltLoss.textContent =
        run && tiltScene ? tiltFormatLoss(level.landscape.f(run.pos)) : "—";
    }
    if (this.els.tiltFrictionSlider) {
      this.els.tiltFrictionSlider.value = String(
        Math.round((this.tiltFriction / TILT_FRICTION_MAX) * 1000),
      );
    }
    if (this.els.tiltFrictionValue) {
      this.els.tiltFrictionValue.textContent = this.tiltFriction.toFixed(2);
    }
    if (this.els.tiltFrictionRegime) {
      const r = dampingRegime(this.tiltFriction);
      this.els.tiltFrictionRegime.textContent = r;
      this.els.tiltFrictionRegime.dataset.regime = r;
    }
    for (const b of this.els.tiltLevelButtons) {
      b.dataset.on = String(b.dataset.level === level.id);
    }
    const gameOn = tiltScene && run !== null;
    if (this.els.tiltFinishBtn) {
      this.els.tiltFinishBtn.hidden = !gameOn || (run?.done ?? false) || swarmScene;
    }
    if (this.els.tiltRestartBtn) {
      // Restart matters only for a run the student has actually begun; the
      // frozen attract pose IS a fresh run already.
      this.els.tiltRestartBtn.hidden =
        !gameOn || (run?.done ?? false) || swarmScene || !(run?.steered ?? false);
    }
    const showScore = gameOn && (run?.done ?? false);
    if (this.els.tiltScoreWrap) this.els.tiltScoreWrap.hidden = !showScore;
    // The replay row drives the tilt-B ghost only: on tilt-a a finished run
    // shows the scorecard alone — visible-but-inert controls read as broken
    // (QA F-3).
    if (this.els.tiltReplayWrap) {
      this.els.tiltReplayWrap.hidden = !(showScore && this.scene === "tilt-b");
    }
    if (this.els.tiltReplayBtn) {
      this.els.tiltReplayBtn.textContent = this.tiltScrubPlaying ? "❚❚ pause" : "▶ ghost";
    }
    if (this.els.tiltScrub && tiltScene) {
      this.els.tiltScrub.value = String(Math.round(this.tiltScrub * 1000));
      // Visible playback progress ON the scrub control itself (fill gradient).
      this.els.tiltScrub.style.setProperty("--scrub-progress", this.tiltScrub.toFixed(3));
    }
    if (this.els.tiltSwarmLine) {
      this.els.tiltSwarmLine.hidden = !swarmScene;
      if (swarmScene && this.swarm) {
        this.els.tiltSwarmLine.textContent = this.swarmBlind
          ? `${this.swarm.sim.paths.length} balls blind · ${this.swarmPainted} cells painted · ${this.swarm.sim.minimaCells} minima found`
          : `${this.swarm.sim.paths.length} balls · ${this.swarm.sim.settledCount} settled · final losses below`;
      }
    }
    // Per-cluster scorecard: one row per OCCUPIED well — crowd size + mean
    // final loss — so the unequal outcomes are legible at a glance. The
    // global basin's row is gold.
    if (this.els.tiltSwarmClusters) {
      this.els.tiltSwarmClusters.hidden = !swarmScene || this.swarm === null;
      if (swarmScene && this.swarm) {
        this.els.tiltSwarmClusters.replaceChildren(
          ...this.swarmClusterRows().map((r) => {
            const li = document.createElement("li");
            li.dataset.global = String(r.global);
            const name = document.createElement("span");
            name.className = "tc-name";
            name.textContent = r.name;
            const count = document.createElement("span");
            count.className = "tc-count mono";
            count.textContent = `×${r.count}`;
            const loss = document.createElement("span");
            loss.className = "tc-loss mono";
            loss.textContent = `ℒ ${tiltFormatLoss(r.meanLoss)}`;
            li.append(name, count, loss);
            return li;
          }),
        );
      }
    }
  }

  /* ---------------- §7: the swarm finale ---------------- */

  /** Builds (once per terrain) the 100 instanced balls + ghost trails. */
  private refreshSwarmVisuals(): void {
    if (this.built !== "swarm" || this.swarm) return;
    const sim = simulateSwarm(SWARM_LEVEL);
    const mesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 12, 8),
      new THREE.MeshLambertMaterial({
        color: MANIM.white,
        // Half-emissive so every ball reads as a small light even where the
        // terrain runs bright (visual bar: light exists as glowing strokes).
        emissive: new THREE.Color(MANIM.white).multiplyScalar(0.5),
      }),
      SWARM_COUNT,
    );
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    this.view.addOverlayObject(mesh);
    const trails: AnimatedTrail[] = [];
    for (const path of sim.paths) {
      if (path.length < 2) continue;
      const t = new AnimatedTrail(this.view, path, MANIM.white, 1.6, 0.45);
      t.setProgress(this.frozen ? this.swarmFrozenFrac() : 0);
      t.setAlpha(1);
      trails.push(t);
    }
    this.swarm = {
      sim,
      mesh,
      trails,
      time: 0,
      playing: !this.frozen,
      paint: this.buildSwarmPaint(sim),
      paintedIdx: sim.paths.map(() => 0),
    };
    this.swarmPaintedKeys.clear();
    this.swarmPainted = 0;
    this.swarmDrawPos = sim.paths.map((path) =>
      samplePath(path, this.frozen ? this.swarmFrozenFrac() : 0),
    );
    // Fog mode BEFORE the first instance update: applySwarmFogMode resets
    // the mask, and the update below stamps the frozen paint prefix into it.
    if (this.swarmBlind) this.applySwarmFogMode();
    this.updateSwarmInstances();
    this.syncTiltPanel();
  }

  /**
   * The blind-mode paint ledger: per ball, the measurement cells its recorded
   * path crosses, in crossing order, each with the arc fraction at which the
   * ball ENTERS the cell. From these the §6 fog mask is erased cell by cell.
   */
  private buildSwarmPaint(
    sim: SwarmSim,
  ): Array<Array<{ key: string; x: number; y: number; arcFrac: number }>> {
    const level = SWARM_LEVEL;
    const e = level.landscape.extent;
    const w = tiltDiag(level) * level.cellFrac;
    return sim.paths.map((path) => {
      const { total, cum } = cumulativeLengths(path);
      const entries: Array<{ key: string; x: number; y: number; arcFrac: number }> = [];
      let lastKey = "";
      for (let i = 0; i < path.length; i++) {
        const key = tiltCellKey(level, path[i]);
        if (key === lastKey) continue;
        lastKey = key;
        const bar = key.indexOf("|");
        entries.push({
          key,
          x: e.xMin + (Number(key.slice(0, bar)) + 0.5) * w,
          y: e.yMin + (Number(key.slice(bar + 1)) + 0.5) * w,
          arcFrac: total > 1e-9 ? cum[i] / total : 1,
        });
      }
      return entries;
    });
  }

  /** The frozen swarm pose (overridable for ?shot=fogswarm). */
  private swarmFrozenFrac(): number {
    return this.swarmPoseProgress ?? SWARM_FROZEN_PROGRESS;
  }

  /** Per-ball eased progress through its own recorded descent. */
  private swarmProgress(i: number): number {
    if (this.frozen) return this.swarmFrozenFrac();
    if (!this.swarm) return 0;
    return clamp((this.swarm.time - swarmDelay(i)) / SWARM_RIDE_SEC, 0, 1);
  }

  private updateSwarmInstances(): void {
    const sw = this.swarm;
    if (!sw) return;
    const lift = this.view.trailLift + this.view.diagonal * 0.008;
    const scale = this.view.diagonal * 0.014;
    const scratch = new THREE.Vector3();
    for (let i = 0; i < sw.sim.paths.length; i++) {
      const p = this.swarmProgress(i);
      const pos = samplePath(sw.sim.paths[i], p);
      this.swarmDrawPos[i] = pos;
      this.view.parameterToWorld(pos, lift, scratch);
      this.swarmDummy.position.copy(scratch);
      this.swarmDummy.scale.setScalar(scale);
      this.swarmDummy.updateMatrix();
      sw.mesh.setMatrixAt(i, this.swarmDummy.matrix);
      const trail = sw.trails[i];
      if (trail) trail.setProgress(p);
      // "Run it blind": every cell the ball crosses stamps into the §6 fog
      // mask as the ball reaches it — the ensemble paints the map.
      if (this.swarmBlind) {
        const entries = sw.paint[i];
        let idx = sw.paintedIdx[i];
        while (idx < entries.length && entries[idx].arcFrac <= p) {
          const cell = entries[idx];
          if (!this.swarmPaintedKeys.has(cell.key)) {
            this.view.fogStampAt({ x: cell.x, y: cell.y }, SWARM_PAINT_FRAC);
            this.swarmPaintedKeys.add(cell.key);
          }
          idx += 1;
        }
        sw.paintedIdx[i] = idx;
      }
    }
    this.swarmPainted = this.swarmPaintedKeys.size;
    sw.mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Flips the blind mode and RE-RUNS the swarm cleanly: the flight rewinds
   * to t=0, the paint ledger resets, and the fog mask state is rebuilt for
   * the chosen mode (dark + cell-granular painting; or fully visible).
   */
  setSwarmBlind(on: boolean): void {
    if (this.swarmBlind === on) return;
    this.swarmBlind = on;
    this.applySwarmFogMode();
    if (this.swarm) {
      // Clean re-run: rewind and redraw the first frame in the new mode.
      this.swarm.time = 0;
      this.swarm.playing = !this.frozen;
      this.swarm.paintedIdx.fill(0);
      this.swarmPaintedKeys.clear();
      this.swarmPainted = 0;
      this.updateSwarmInstances();
    }
    this.syncTiltPanel();
    this.view.requestRender();
  }

  /** ?shot=fogswarm boot preset: blind mode + earlier frozen pose. */
  presetSwarmBlind(on: boolean): void {
    this.swarmBlind = on;
    this.swarmPoseProgress = on ? FOGSWARM_FROZEN_PROGRESS : null;
  }

  /**
   * Fog state for the current blind mode. ON: §6's mechanic — the mask goes
   * fully opaque and the swarm's cell stamps erase it as the balls fly; the
   * contour map hides until the mode is off. OFF: everything visible again.
   */
  private applySwarmFogMode(): void {
    if (this.swarmBlind) {
      this.view.setFogEnabled(true);
      this.view.fogReset();
      this.view.setContourReveal(0);
    } else {
      // setFogEnabled(false) also restores the contour reveal to 1.
      this.view.setFogEnabled(false);
    }
    this.swarmPainted = 0;
    this.swarmPaintedKeys.clear();
    if (this.swarm) this.swarm.paintedIdx.fill(0);
  }

  /** Everything §7 put on stage (leaving the section). */
  private clearTiltStage(): void {
    this.clearTiltReveal();
    this.clearTiltStampMesh();
    if (this.tiltLiveTrail) {
      this.tiltLiveTrail.dispose();
      this.tiltLiveTrail = null;
    }
    this.tiltLiveBuilt = 0;
    if (this.swarm) {
      for (const t of this.swarm.trails) t.dispose();
      this.view.removeOverlayObject(this.swarm.mesh);
      this.swarm = null;
    }
    this.view.setElevationClamp(null);
    setHud(this.els.tiltPanel, false);
  }

  /** Refs whose GPU resources setLandscape already disposed. */
  private dropTiltRefs(): void {
    this.tiltStamps = null;
    this.tiltStampKeys = new Set();
    this.tiltLiveTrail = null;
    this.tiltLiveBuilt = 0;
    this.tiltGhost = null;
    this.tiltMachineTrails = [];
    this.swarm = null;
  }

  /** Diagnostics for smoke checks (no page behavior). */
  get tiltState(): {
    level: TiltLevelId;
    hasRun: boolean;
    pos: Vec2 | null;
    vel: Vec2 | null;
    steps: number;
    cells: number;
    done: boolean;
    settled: boolean;
    steered: boolean;
    curated: boolean;
    friction: number;
    input: Vec2;
    inputParam: Vec2;
    scrub: number;
    scrubPlaying: boolean;
    ghost: boolean;
    ghostPos: Vec2 | null;
    stamps: number;
    machines: Array<{ label: string; steps: number; reached: boolean; finalLoss: number }> | null;
  } {
    const run = this.tiltRun;
    return {
      level: this.tiltLevel.id,
      hasRun: run !== null,
      pos: run ? { ...run.pos } : null,
      vel: run ? { ...run.vel } : null,
      steps: run?.steps ?? 0,
      cells: run?.cells.length ?? 0,
      done: run?.done ?? false,
      settled: run?.settled ?? false,
      steered: run?.steered ?? false,
      curated: run?.curated ?? false,
      friction: this.tiltFriction,
      input: { ...this.tiltInput },
      inputParam: this.tiltInputParam(),
      scrub: this.tiltScrub,
      scrubPlaying: this.tiltScrubPlaying,
      ghost: this.tiltGhost !== null,
      ghostPos: this.tiltGhost ? { ...this.tiltGhostPos } : null,
      stamps: this.tiltStamps ? this.tiltStamps.count : 0,
      machines: this.tiltMachineRuns
        ? this.tiltMachineRuns.map((m) => ({
            label: m.label,
            steps: m.steps,
            reached: m.reached,
            finalLoss: m.finalLoss,
          }))
        : null,
    };
  }

  /** Diagnostics for smoke checks (no page behavior). */
  get swarmState(): {
    balls: number;
    settled: number;
    minima: number;
    time: number;
    playing: boolean;
    blind: boolean;
    painted: number;
    paintedTotal: number;
    stamps: number;
    clusters: Array<{ name: string; count: number; meanLoss: number; global: boolean }>;
  } | null {
    if (!this.swarm) return null;
    return {
      balls: this.swarm.sim.paths.length,
      settled: this.swarm.sim.settledCount,
      minima: this.swarm.sim.minimaCells,
      time: this.swarm.time,
      playing: this.swarm.playing,
      blind: this.swarmBlind,
      painted: this.swarmPainted,
      paintedTotal: this.swarm.sim.paintedCells,
      stamps: this.view.fogStamps,
      clusters: this.swarmClusterRows(),
    };
  }

  /* ---------------- §8: the optimizer workbench ---------------- */

  /** Landscape pill input: swap the terrain in place, re-run the benchmark.
   *  The rule itself is untouched — THAT is the no-free-lunch beat (the same
   *  rule, a different landscape, a flipped verdict). */
  setRuleLevel(id: RuleLevelId): void {
    if (this.frozen || this.scene !== "labrule") return;
    if (id === this.ruleLevel && this.builtRule === id) return;
    this.ruleLevel = id;
    this.clearRuleVisuals();
    if (this.built === "rule" && this.builtRule !== id) {
      const level = ruleLevelById(id);
      this.view.setLandscape(level.landscape, { gridN: 64 });
      this.minimap.setLandscape(level.landscape);
      this.builtRule = id;
    }
    this.pendingRule = true;
    this.syncRulePanel();
    this.view.requestRender();
  }

  /** A part moved (live): merge, sync the panel, coalesced rebuild. */
  setRulePart(part: Partial<CustomRuleConfig>): void {
    if (this.frozen || this.scene !== "labrule") return;
    this.ruleCfg = { ...this.ruleCfg, ...part };
    this.syncRulePanel();
    this.pendingRule = true;
    this.view.requestRender();
  }

  /** Re-runs the four-way benchmark and redraws trails + scorecards. */
  private rebuildRuleVisuals(): void {
    this.clearReplayVisuals();
    this.clearRuleVisuals();
    if (this.built !== "rule" || this.builtRule !== this.ruleLevel) return;

    const bench = ruleBenchmark(this.ruleLevel, this.ruleCfg);
    this.ruleRuns = bench;
    const runs = [bench.custom, ...bench.machines];
    const colorOf = (key: string): number =>
      key === "custom" ? OPTIMIZER_COLORS.custom
        : key === "gd" ? OPTIMIZER_COLORS.gd
          : key === "mom" ? OPTIMIZER_COLORS.momentum
            : OPTIMIZER_COLORS.adam;
    const cssOf = (key: string): string =>
      key === "custom" ? "rgba(154,114,172,0.95)"
        : key === "gd" ? "rgba(252,98,85,0.85)"
          : key === "mom" ? "rgba(88,196,221,0.9)"
            : "rgba(244,211,69,0.9)";

    this.minimap.setPaths(
      runs.map((r) => ({ points: r.path, color: cssOf(r.key) })),
    );
    for (const r of runs) {
      if (r.path.length >= 2) {
        const t = new AnimatedTrail(this.view, r.path, colorOf(r.key));
        t.setProgress(1);
        t.setAlpha(1);
        this.ruleTrails.push(t);
      }
    }
    this.updateRuleScorecards();
  }

  /** Both §8 reader steps carry a scoreboard; both are rewritten together. */
  private updateRuleScorecards(): void {
    const bench = this.ruleRuns;
    if (!bench) return;
    const rows = [bench.custom, ...bench.machines];
    const converged = rows.filter((r): r is RuleRun & { steps: number } => r.steps !== null);
    const bestSteps = converged.length > 0 ? Math.min(...converged.map((r) => r.steps)) : null;
    const bestLoss = Math.min(...rows.map((r) => r.finalLoss));
    const cssOf = (key: string): string =>
      key === "custom" ? "#9A72AC"
        : key === "gd" ? "#FC6255"
          : key === "mom" ? "#58C4DD"
            : "#F4D345";

    for (const body of this.els.ruleScoreBodies) {
      body.replaceChildren(
        ...rows.map((r) => {
          const tr = document.createElement("tr");
          const name = document.createElement("td");
          name.textContent =
            r.key === "custom"
              ? `your rule (${r.key === "custom" ? this.rulePartsLabel() : r.label})`
              : r.label;
          name.style.color = cssOf(r.key);
          const steps = document.createElement("td");
          steps.textContent = ruleFormatSteps(r.steps);
          steps.className = "mono";
          if (r.steps !== null && r.steps === bestSteps) steps.dataset.best = "true";
          const loss = document.createElement("td");
          loss.textContent = ruleFormatLoss(r.finalLoss);
          loss.className = "mono";
          if (r.finalLoss === bestLoss) loss.dataset.best = "true";
          tr.append(name, steps, loss);
          return tr;
        }),
      );
    }

    const verdict = this.ruleVerdictText(bench, bestSteps);
    for (const el of this.els.ruleVerdicts) el.textContent = verdict;
  }

  /** "η 0.5 · β 0.9 · norm · clip 0.35" — the assembled parts, compact. */
  private rulePartsLabel(): string {
    const c = this.ruleCfg;
    return [
      `η ${c.lr.toPrecision(2)}`,
      `β ${c.beta.toFixed(2)}`,
      c.normalize ? "norm" : "raw",
      c.clip != null ? `clip ${c.clip.toFixed(2)}` : "unclipped",
    ].join(" · ");
  }

  /** The scoreboard's one-line read of WHO won and whether it flipped. */
  private ruleVerdictText(bench: RuleBenchmark, bestSteps: number | null): string {
    const level = ruleLevelById(bench.level);
    const custom = bench.custom;
    if (custom.steps !== null && custom.steps === bestSteps) {
      const runnerUp = bench.machines
        .filter((m) => m.steps !== null)
        .sort((a, b) => (a.steps ?? Infinity) - (b.steps ?? Infinity))[0];
      const tail = runnerUp
        ? `${runnerUp.label} needed ${ruleFormatSteps(runnerUp.steps)}.`
        : "no optimizer converged at all.";
      return `Your rule wins ${level.name}: ${custom.steps} steps — ${tail} On this landscape, the bet pays off.`;
    }
    const winner =
      bench.machines
        .filter((m) => m.steps !== null)
        .sort((a, b) => (a.steps ?? Infinity) - (b.steps ?? Infinity))[0] ?? null;
    if (!winner) {
      return `Nothing converges below ℒ ${ruleFormatLoss(level.threshold)} within ${level.maxSteps} steps — including your rule.`;
    }
    return `The verdict flips: ${winner.label} converges in ${ruleFormatSteps(winner.steps)} steps, your rule in ${ruleFormatSteps(custom.steps)}. Same rule — a different landscape, a different ranking.`;
  }

  private clearRuleVisuals(): void {
    for (const t of this.ruleTrails) t.dispose();
    this.ruleTrails = [];
    this.minimap.setPaths(null);
  }

  /** Panel readouts + pill state (parts panel, canvas pane). */
  private syncRulePanel(): void {
    const on = this.scene === "labrule";
    setHud(this.els.rulePanel, on);
    if (!on) return;
    const level = ruleLevelById(this.ruleLevel);
    if (this.els.ruleLandscapeEl) {
      this.els.ruleLandscapeEl.textContent =
        `${level.name} · converge < ℒ ${ruleFormatLoss(level.threshold)}`;
    }
    if (this.els.ruleEtaSlider) {
      this.els.ruleEtaSlider.value = String(ruleKnobFromEta(this.ruleCfg.lr));
    }
    if (this.els.ruleEtaValue) {
      this.els.ruleEtaValue.textContent = this.ruleCfg.lr.toPrecision(3);
    }
    if (this.els.ruleBetaValue) {
      this.els.ruleBetaValue.textContent = this.ruleCfg.beta.toFixed(2);
    }
    if (this.els.ruleNormToggle) this.els.ruleNormToggle.checked = this.ruleCfg.normalize;
    if (this.els.ruleClipSlider) {
      this.els.ruleClipSlider.value = String(ruleKnobFromClip(this.ruleCfg.clip));
    }
    if (this.els.ruleClipValue) {
      this.els.ruleClipValue.textContent =
        this.ruleCfg.clip == null ? "off" : this.ruleCfg.clip.toFixed(2);
    }
    for (const b of this.els.ruleLevelButtons) {
      b.dataset.on = String(b.dataset.level === this.ruleLevel);
    }
  }

  /** Diagnostics for smoke checks (no page behavior). */
  get ruleState(): {
    level: RuleLevelId;
    built: RuleLevelId | null;
    config: CustomRuleConfig;
    runs: Array<{ key: string; label: string; steps: number | null; finalLoss: number }> | null;
  } {
    return {
      level: this.ruleLevel,
      built: this.builtRule,
      config: { ...this.ruleCfg },
      runs: this.ruleRuns
        ? [this.ruleRuns.custom, ...this.ruleRuns.machines].map((r) => ({
          key: r.key,
          label: r.label,
          steps: r.steps,
          finalLoss: r.finalLoss,
        }))
        : null,
    };
  }

  /* ---------------- §9: the epilogue ---------------- */

  /** Landscape-bound epilogue visuals: the gold formula marker (epi-a) and
   *  the parameter lattice (epi-b/c). Idempotent — called on every layout. */
  private refreshEpiVisuals(): void {
    if (this.built !== "ls") return;
    if (this.scene === "epi-a") {
      this.spawnEpiMarker();
    } else {
      this.removeEpiMarker();
    }
    if (SCENES[this.scene].lattice === true) {
      this.buildEpiLattice();
      this.applyEpiLatticeOpacity();
    } else {
      this.removeEpiLattice();
    }
    setHud(this.els.epiFormula, this.scene === "epi-a");
    setHud(this.els.epiLatticeNote, this.scene === "epi-b" || this.scene === "epi-c");
    this.positionEpiFormula();
    this.view.requestRender();
  }

  /** Gold core + additive halo at the normal-equation minimum — the same
   *  marker language as the fog game's reveal, now naming the EXACT answer. */
  private spawnEpiMarker(): void {
    if (this.epiMarker) return;
    const group = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(1, 18, 14),
      new THREE.MeshBasicMaterial({ color: MANIM.gold, transparent: true, opacity: 0.98 }),
    );
    core.scale.setScalar(this.view.diagonal * 0.013);
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(1, 18, 14),
      new THREE.MeshBasicMaterial({
        color: MANIM.gold,
        transparent: true,
        opacity: 0.25,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    halo.scale.setScalar(this.view.diagonal * 0.036);
    group.add(core, halo);
    this.view.parameterToWorld(
      ARGMIN,
      this.view.trailLift + this.view.diagonal * 0.014,
      group.position,
    );
    this.view.addOverlayObject(group);
    this.epiMarker = group;
  }

  private removeEpiMarker(): void {
    if (!this.epiMarker) return;
    this.view.removeOverlayObject(this.epiMarker);
    this.epiMarker = null;
  }

  /**
   * The dimension-honesty stage: a regular lattice of faint additive points
   * filling a box that dwarfs the ghost map — 24³ = 13 824 of them here, one
   * visible stand-in per ~10² real coordinates of a 10⁶-parameter model.
   * Static geometry: the only motion is its fade (the "lat" value).
   */
  private buildEpiLattice(): void {
    if (this.epiLattice) return;
    const N = 24;
    const span = this.view.diagonal * 1.7;
    const e = leastSquares.extent;
    const cx = (e.xMin + e.xMax) / 2;
    const cy = (e.yMin + e.yMax) / 2;
    const positions = new Float32Array(N * N * N * 3);
    let k = 0;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        for (let l = 0; l < N; l++) {
          positions[k++] = cx - span / 2 + (span * i) / (N - 1);
          positions[k++] = cy - span / 2 + (span * j) / (N - 1);
          // Height: from just under the ghost sheet to far above it.
          positions[k++] = -span * 0.18 + (span * 0.62 * l) / (N - 1);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: MANIM.greyText,
      size: 2.0,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.renderOrder = 3;
    this.view.addOverlayObject(points);
    this.epiLattice = points;
  }

  private applyEpiLatticeOpacity(): void {
    if (!this.epiLattice) return;
    const mat = this.epiLattice.material as THREE.PointsMaterial;
    mat.opacity = 0.5 * this.val("lat");
  }

  private removeEpiLattice(): void {
    if (!this.epiLattice) return;
    this.view.removeOverlayObject(this.epiLattice);
    this.epiLattice = null;
  }

  /** Pins the formula note just above the marked minimum (epi-a). */
  private positionEpiFormula(): void {
    const note = this.els.epiFormula;
    if (!note || this.scene !== "epi-a") return;
    const s = this.view.projectParamToScreen(ARGMIN);
    if (!s) return;
    note.style.left = `${Math.round(s.x)}px`;
    note.style.top = `${Math.round(s.y)}px`;
  }

  /** Per-scene epilogue state (the "lat" fade), applied at setScene time. */
  private enterEpiState(name: SceneName, instant: boolean): void {
    this.clearGdArrows();
    this.clearTrajectory();
    if (name === "epi-a" || (instant && this.frozen)) {
      // epi-a is the map reveal (no lattice); frozen shots snap the fade.
      this.values.set("lat", name === "epi-a" ? 0 : 1);
      if (name === "epi-a") this.removeEpiLattice();
    } else if (this.val("lat") < 1) {
      this.tween("lat", 1, 1.4);
    }
  }

  /** Everything §9 put on stage (leaving the section / re-entering §9). */
  private clearEpiStage(): void {
    this.removeEpiMarker();
    this.removeEpiLattice();
    this.tweens.delete("lat");
    this.values.set("lat", 0);
    setHud(this.els.epiFormula, false);
    setHud(this.els.epiLatticeNote, false);
  }

  /** Diagnostics for smoke checks (no page behavior). */
  get epiState(): {
    scene: SceneName;
    marker: boolean;
    lattice: boolean;
    latticeOpacity: number;
    argmin: Vec2;
  } {
    return {
      scene: this.scene,
      marker: this.epiMarker !== null,
      lattice: this.epiLattice !== null,
      latticeOpacity:
        this.epiLattice
          ? (this.epiLattice.material as THREE.PointsMaterial).opacity
          : 0,
      argmin: { ...ARGMIN },
    };
  }

  /** Whether the current scene has trajectory data the transport can roll. */
  get replayAvailable(): boolean {
    const s = this.scene;
    if (s === "gd-b") return this.userTip !== null;
    if (s === "gd-c" || s === "gd-d") return this.eta !== null;
    if (s.startsWith("mom")) return this.momBeta !== null;
    if (s.startsWith("adam")) return this.adamS !== null;
    if (s === "lab") return this.labE !== null;
    if (s === "labrule") return this.ruleRuns !== null;
    if (s === "fog-c") return this.fogLevel !== null && this.fogSt !== null;
    return false;
  }

  /** Diagnostics: replay lanes/progress/speed. */
  get replayInfo(): {
    lanes: number;
    playing: boolean;
    paused: boolean;
    progress: number;
    speed: number;
    positions: Vec2[];
  } {
    if (!this.replay) {
      return {
        lanes: 0,
        playing: false,
        paused: false,
        progress: 0,
        speed: this.replaySpeed,
        positions: [],
      };
    }
    const p = this.replay.player.isPlaying
      ? Math.min(1, this.replay.player.getElapsedFraction())
      : this.replay.player.getElapsedFraction();
    return {
      lanes: this.replay.lanes.length,
      playing: this.replay.player.isPlaying,
      paused: this.replayPaused,
      progress: p,
      speed: this.replaySpeed,
      positions: this.replay.lanes.map((lane) => {
        const pos = samplePath(lane.path, p);
        return { x: pos.x, y: pos.y };
      }),
    };
  }

  /** Starts (or restarts) the roll for the current scene's data. */
  playReplay(): void {
    if (!this.replayAvailable) return;
    // §6 fog-c: the transport replays the ghost race (staggered relaunch).
    if (this.scene === "fog-c") {
      this.buildFogGhosts(false);
      this.syncTransport();
      this.view.requestRender();
      return;
    }
    this.clearReplayVisuals();
    const lanes = this.buildReplayLanes();
    if (lanes.length === 0) return;
    const maxSteps = Math.max(...lanes.map((l) => l.path.length - 1));
    const durationSec = clamp(2.2 + maxSteps * 0.028, 2.6, 9);
    const player = new TrajectoryPlayer(durationSec, this.replaySpeed);
    const group = new THREE.Group();
    const laneViews = lanes.map((lane) => {
      const trail = new AnimatedTrail(this.view, lane.path, lane.trailColor);
      trail.setProgress(0);
      trail.setAlpha(0.95);
      const ball = new THREE.Mesh(
        new THREE.SphereGeometry(1, 18, 12),
        new THREE.MeshBasicMaterial({ color: lane.ballColor }),
      );
      ball.scale.setScalar(this.view.diagonal * 0.014);
      ball.visible = false;
      group.add(ball);
      return { path: lane.path as Vec2[], trail, ball };
    });
    this.view.addOverlayObject(group);
    this.replay = { player, group, lanes: laneViews };
    this.replayPaused = false;
    player.play();
    this.syncTransport();
    this.view.requestRender();
  }

  /**
   * The transport's ▶/❚❚ button: idle → play, playing → pause, paused →
   * resume, finished → replay from the top. One control, four states.
   */
  toggleReplay(): void {
    if (!this.replayAvailable) return;
    if (this.scene === "fog-c") {
      if (!this.fogGhosts) {
        this.buildFogGhosts(false);
      } else if (this.fogGhostsPlaying()) {
        this.ghostsPaused = true;
      } else if (this.ghostClock >= this.fogGhostTotal) {
        this.buildFogGhosts(false); // finished → relaunch from the top
      } else {
        this.ghostsPaused = false; // paused mid-ride → resume
      }
      this.syncTransport();
      this.view.requestRender();
      return;
    }
    if (!this.replay) {
      this.playReplay();
      return;
    }
    const player = this.replay.player;
    if (player.isPlaying) {
      player.pause();
      this.replayPaused = true;
    } else if (player.finishedOnce) {
      this.playReplay(); // finished → replay from the top
      return;
    } else {
      player.resume();
      this.replayPaused = false;
    }
    this.syncTransport();
    this.view.requestRender();
  }

  /**
   * Scrub bar input (0..1): parks the replay at that fraction of its
   * timeline and pauses it — the balls, trails and progress all jump.
   */
  setReplayScrub(frac: number): void {
    if (!this.replayAvailable) return;
    const f = clamp(frac, 0, 1);
    if (this.scene === "fog-c" && this.fogGhosts) {
      this.ghostsPaused = true;
      this.ghostClock = f * this.fogGhostTotal;
      for (const lane of this.fogGhosts.lanes) {
        const p =
          lane.dur > 0
            ? clamp((this.ghostClock - lane.delay0) / lane.dur, 0, 1)
            : 1;
        lane.delay = Math.max(0, lane.delay0 - this.ghostClock);
        lane.player.setFraction(p);
        if (p < 1 && lane.delay <= 0) lane.player.resume();
        else lane.player.pause();
        const pos = samplePath(lane.path, p);
        this.view.parameterToWorld(
          pos,
          this.view.trailLift + this.view.diagonal * 0.016,
          lane.ball.position,
        );
        lane.ball.visible = lane.delay <= 0 && p > 0;
        lane.trail.setProgress(p);
      }
    } else if (this.replay) {
      this.replayPaused = true;
      this.replay.player.pause();
      this.replay.player.setFraction(f);
      for (const lane of this.replay.lanes) {
        const pos = samplePath(lane.path, f);
        this.view.parameterToWorld(
          pos,
          this.view.trailLift + this.view.diagonal * 0.016,
          lane.ball.position,
        );
        lane.ball.visible = f > 0;
        lane.trail.setProgress(f);
      }
      this.syncTransportProgress(f, true); // scrub tracking is 1:1 (QA LP-2)
    }
    this.syncTransport();
    this.view.requestRender();
  }

  setReplaySpeed(speed: number): void {
    this.replaySpeed = speed;
    this.replay?.player.setSpeed(speed);
    for (const lane of this.fogGhosts?.lanes ?? []) lane.player.setSpeed(speed);
    this.syncTransport();
  }

  private buildReplayLanes(): Array<{ path: Vec2[]; trailColor: number; ballColor: number }> {
    const s = this.scene;
    if (s === "gd-b" && this.userTip) {
      return [
        {
          path: [this.point, { ...this.userTip }],
          trailColor: OPTIMIZER_COLORS.learner,
          ballColor: OPTIMIZER_COLORS.learner,
        },
      ];
    }
    if (s === "gd-c") {
      const path = runGdPath(this.eta ?? ETA_MID);
      return [{ path, trailColor: OPTIMIZER_COLORS.gd, ballColor: OPTIMIZER_COLORS.gd }];
    }
    if (s === "gd-d") {
      // QA cycle B (critic-gdd): the transport rides all four curated lanes.
      return GD_D_ETAS.map((e) => ({
        path: runGdPath(e),
        trailColor: OPTIMIZER_COLORS.gd,
        ballColor: OPTIMIZER_COLORS.gd,
      }));
    }
    if (s.startsWith("mom")) {
      const path = runMomentumPath(this.momBeta ?? MOM_BETA_DEFAULT);
      return [{ path, trailColor: OPTIMIZER_COLORS.momentum, ballColor: OPTIMIZER_COLORS.momentum }];
    }
    if (s.startsWith("adam")) {
      const steepness = this.adamS ?? ADAM_STEEP_MIN;
      return [
        { path: runAdamLane(steepness, "gd"), trailColor: OPTIMIZER_COLORS.gd, ballColor: OPTIMIZER_COLORS.gd },
        { path: runAdamLane(steepness, "adam"), trailColor: OPTIMIZER_COLORS.adam, ballColor: OPTIMIZER_COLORS.adam },
      ];
    }
    if (s === "lab") {
      const full = labChecks(this.labE ?? LAB_E_DEFAULT, this.labRot ?? LAB_ROT_DEFAULT);
      return [
        { path: full.gdPath, trailColor: OPTIMIZER_COLORS.gd, ballColor: OPTIMIZER_COLORS.gd },
        { path: full.momPath, trailColor: OPTIMIZER_COLORS.momentum, ballColor: OPTIMIZER_COLORS.momentum },
        { path: full.adamPath, trailColor: OPTIMIZER_COLORS.adam, ballColor: OPTIMIZER_COLORS.adam },
      ];
    }
    if (s === "labrule" && this.ruleRuns) {
      const b = this.ruleRuns;
      return [
        { path: b.custom.path, trailColor: OPTIMIZER_COLORS.custom, ballColor: OPTIMIZER_COLORS.custom },
        { path: b.machines[0].path, trailColor: OPTIMIZER_COLORS.gd, ballColor: OPTIMIZER_COLORS.gd },
        { path: b.machines[1].path, trailColor: OPTIMIZER_COLORS.momentum, ballColor: OPTIMIZER_COLORS.momentum },
        { path: b.machines[2].path, trailColor: OPTIMIZER_COLORS.adam, ballColor: OPTIMIZER_COLORS.adam },
      ];
    }
    return [];
  }

  private clearReplayVisuals(): void {
    if (!this.replay) return;
    for (const lane of this.replay.lanes) lane.trail.dispose();
    this.view.removeOverlayObject(this.replay.group);
    this.replay = null;
    this.replayPaused = false;
    this.syncTransport();
  }

  /** Transport button label + scrub state from the live replay state. */
  private syncTransport(): void {
    if (this.els.playBtn) {
      const playing =
        this.fogGhosts !== null && this.scene === "fog-c"
          ? this.fogGhostsPlaying()
          : this.replay?.player.isPlaying === true;
      const started =
        this.scene === "fog-c"
          ? this.fogGhosts !== null
          : this.replay !== null;
      const paused = started && !playing;
      this.els.playBtn.textContent = playing
        ? "❚❚ Pause"
        : paused
          ? "▶ Resume"
          : "▶ Play";
    }
    for (const b of this.els.speedButtons) {
      b.dataset.on = String(Number(b.dataset.speed) === this.replaySpeed);
    }
    // Label/segment syncs (pause, resume, finish, speed change) must land
    // immediately — only the per-frame playback callers are throttled.
    this.syncTransportProgress(this.transportProgress(), true);
  }

  /** Current replay progress 0..1 (0 when nothing is loaded). */
  private transportProgress(): number {
    if (this.scene === "fog-c" && this.fogGhosts && this.fogGhostTotal > 0) {
      return clamp(this.ghostClock / this.fogGhostTotal, 0, 1);
    }
    if (this.replay) {
      return this.replay.player.getElapsedFraction();
    }
    return 0;
  }

  /** Wall-clock ms of the last transport progress write (LP-1 throttle). */
  private transportWriteAt = -1e9;

  /**
   * Writes playback progress onto the controls: scrub position + the fill
   * gradient on the bar and the progress underline under the ▶ button
   * (both driven by one CSS variable on #transport).
   *
   * QA LP-1: the continuous-playback paths call this EVERY frame; a style
   * write + input value write per frame is pure recalc/paint pressure. The
   * per-frame callers are throttled to ~10 Hz (the bar is 300+ px wide; a
   * 10 Hz refresh is visually continuous), while scrub drags and label syncs
   * pass force=true to keep their exact 1:1 tracking (QA LP-2 measured
   * scrub input tracking at ~1-2 ms median lag — that must not regress).
   * 0 and 1 always write so start/end states are exact.
   */
  private syncTransportProgress(p: number, force = false): void {
    const k = clamp(p, 0, 1);
    const now = performance.now();
    if (!force && k > 0 && k < 1 && now - this.transportWriteAt < 100) {
      return;
    }
    this.transportWriteAt = now;
    if (this.els.transportEl) {
      this.els.transportEl.style.setProperty("--replay-progress", k.toFixed(3));
    }
    if (this.els.replayScrub) {
      this.els.replayScrub.value = String(Math.round(k * 1000));
    }
  }

  /** Footer transport visibility + labels (data-gated per scene). */
  private updateTransport(): void {
    const on = SCENES[this.scene].transport === true && this.replayAvailable;
    if (this.els.playBtn) this.els.playBtn.hidden = !on;
    if (this.els.replayBtn) this.els.replayBtn.hidden = !on;
    if (this.els.replayScrub) this.els.replayScrub.hidden = !on;
    if (this.els.speedWrap) this.els.speedWrap.hidden = !on;
  }

  /** Contact shadows under the ball and floating arrow endpoints. */
  private updateShadows(): void {
    const list: Array<{ pos: Vec2; radiusFrac: number; opacity: number }> = [];
    if (this.ballVisible) {
      const t = this.view.heightFrac(this.currentPoint);
      list.push({
        pos: this.currentPoint,
        radiusFrac: 0.02 * (0.85 + 0.5 * t),
        opacity: 0.42 - 0.26 * t,
      });
    }
    // §7 reveal: the ghost ball casts its own spot.
    if (this.scene === "tilt-b" && this.tiltGhost) {
      const t = this.view.heightFrac(this.tiltGhostPos);
      list.push({
        pos: this.tiltGhostPos,
        radiusFrac: 0.016 * (0.85 + 0.5 * t),
        opacity: 0.38 - 0.24 * t,
      });
    }
    // §7 swarm: every rolling ball grounds itself (radius/opacity by height).
    if (this.scene === "swarm" && this.swarm && this.built === "swarm") {
      for (const p of this.swarmDrawPos) {
        const t = this.view.heightFrac(p);
        list.push({
          pos: p,
          radiusFrac: 0.012 * (0.85 + 0.5 * t),
          opacity: 0.3 - 0.18 * t,
        });
      }
    }
    if (this.scene === "gd-b" && this.userTip) {
      list.push({ pos: this.userTip, radiusFrac: 0.012, opacity: 0.3 });
    }
    for (const tip of this.adamArrowTips) {
      list.push({ pos: tip, radiusFrac: 0.011, opacity: 0.3 });
    }
    this.view.setContactShadows(list);
  }

  /* ---------------- hover-to-look (the declarative registry) ----------------
   *
   * Reader spans carry data-look="<key>"; LOOK_TARGETS (src/view/
   * lookRegistry.ts) is the single table mapping keys to scene targets.
   * Hovering or keyboard-focusing a span calls setLook(key); leaving calls
   * setLook(null). The spotlight NEVER advances, locks, or animates the
   * step machine — it is a pure lens over the current scene, so it cannot
   * fight the step lock.
   */

  /** Diagnostics for smoke checks (no page behavior). */
  get lookState(): {
    id: string | null;
    label: string | null;
    active: boolean;
    sceneDim: boolean;
    ring: boolean;
    spotPanels: string[];
    minimapSpot: boolean;
    keptTrails: number;
    ballOpacity: number | null;
  } {
    return {
      id: this.lookId,
      label: this.lookId ? LOOK_TARGETS[this.lookId]?.label ?? null : null,
      active: this.lookId !== null,
      sceneDim: this.view.focusActive,
      ring: this.view.spotlightActive,
      spotPanels: this.spotPanels.map((el) => el.id),
      minimapSpot: this.minimap.spotlit,
      keptTrails: this.keptTrails.size,
      ballOpacity: this.view.ballOpacity,
    };
  }

  /** Hover or keyboard focus on a data-look span (null = left). */
  setLook(id: string | null): void {
    if (id === this.lookId) return;
    this.clearLookNow();
    if (id === null || !LOOK_TARGETS[id]) {
      this.lookId = null;
      this.view.requestRender();
      return;
    }
    this.lookId = id;
    this.applyLook();
  }

  /** Trail rebuilds create fresh objects: re-resolve the active spotlight. */
  private reapplyLook(): void {
    if (this.lookId === null) return;
    const id = this.lookId;
    this.clearLookNow();
    this.lookId = id;
    this.applyLook();
  }

  /** Drops every spotlight artifact (dims, ring, panel states). */
  private clearLookNow(): void {
    this.lookId = null;
    this.lookPointFn = null;
    this.keptTrails.clear();
    setTrailFocus(1, null);
    this.view.setFocusDim(null);
    this.view.clearSpotlight();
    this.minimap.setSpotlight(false);
    for (const el of this.spotPanels) el.removeAttribute("data-spot");
    this.spotPanels.length = 0;
    if (this.els.stageWrap) this.els.stageWrap.removeAttribute("data-scene-focus");
  }

  private panelEl(id: PanelId): HTMLElement | null {
    switch (id) {
      case "fit": return this.els.fitPanel;
      case "loss": return this.els.lossPanel;
      case "minimap": return this.els.minimapPanel;
      case "adam": return this.els.adamPanel;
      case "curves": return this.els.curvesPanel;
    }
  }

  /** Marks a HUD panel as the spotlight (CSS glow) and dims the rest.
   *  Returns false when the panel is not visible (the look then no-ops). */
  private spotPanel(panel: PanelId, terrainDim: number, overlayDim: number): boolean {
    const el = this.panelEl(panel);
    if (!el || el.dataset.visible !== "true") return false; // target absent
    this.markSceneFocus();
    el.dataset.spot = "true";
    this.spotPanels.push(el);
    this.view.setFocusDim({ terrain: terrainDim, overlay: overlayDim, keep: null });
    return true;
  }

  private markSceneFocus(): void {
    if (this.els.stageWrap) this.els.stageWrap.setAttribute("data-scene-focus", "true");
  }

  /**
   * Live optimizer trails for a registry target, by scene family. Returns
   * [] when the scene has no such trail on stage (the look then no-ops).
   */
  private liveTrails(which: "gd" | "mom" | "adam" | "all"): AnimatedTrail[] {
    const s = this.scene;
    const pick = (...ts: Array<AnimatedTrail | null>): AnimatedTrail[] =>
      ts.filter((t): t is AnimatedTrail => t !== null && !t.isDisposed);
    if (s === "gd-d") {
      // The four curated lanes are one story; spotlight the whole family.
      if (which === "gd" || which === "all") {
        return this.gdDLanes.filter((t) => !t.isDisposed);
      }
      return [];
    }
    if (s.startsWith("gd")) {
      if (which === "gd" || which === "all") return pick(this.trail);
      return [];
    }
    if (s.startsWith("mom")) {
      if (which === "all") return pick(this.momGdTrail, this.momTrail);
      if (which === "gd") return pick(this.momGdTrail);
      if (which === "mom") return pick(this.momTrail);
      return [];
    }
    if (s === "lab") {
      const all = pick(this.labTrails[0] ?? null, this.labTrails[1] ?? null, this.labTrails[2] ?? null);
      if (which === "all") return all;
      const idx = which === "gd" ? 0 : which === "mom" ? 1 : 2;
      return pick(this.labTrails[idx] ?? null);
    }
    return [];
  }

  private applyLook(): void {
    const id = this.lookId;
    if (id === null) return;
    const entry = LOOK_TARGETS[id];
    if (!entry) return;
    const t: LookTarget = entry.target;

    switch (t.kind) {
      case "panel": {
        this.spotPanel(t.panel, 0.45, 0.4);
        break;
      }
      case "needle": {
        // The needle lives on the minimap: glow the panel AND the needle.
        if (!this.spotPanel("minimap", 0.4, 0.35)) return;
        this.minimap.setSpotlight(true);
        break;
      }
      case "ball": {
        const ball = this.view.ballObject;
        if (!ball || !this.ballVisible) return;
        this.markSceneFocus();
        this.view.setFocusDim({ terrain: 0.26, overlay: 0.2, keep: [ball] });
        this.view.spotlightAt(this.currentPoint, MANIM.white, 0.05);
        this.lookPointFn = (): Vec2 | null => this.currentPoint;
        break;
      }
      case "gdStep": {
        if (this.scene !== "gd-b" || this.built !== "bowl") return;
        this.markSceneFocus();
        this.view.setFocusDim({ terrain: 0.3, overlay: 0.22, keep: [...this.arrowHandles] });
        const tip = this.gdTipFull ?? this.gdStepTip();
        this.view.spotlightAt(tip, MANIM.red, 0.042);
        this.lookPointFn = (): Vec2 => this.gdTipFull ?? this.gdStepTip();
        break;
      }
      case "trail": {
        const trails = this.liveTrails(t.which);
        if (trails.length === 0) return;
        this.markSceneFocus();
        this.keptTrails.clear();
        for (const tr of trails) this.keptTrails.add(tr);
        setTrailFocus(0.16, this.keptTrails);
        this.view.setFocusDim({ terrain: 0.3, overlay: 0.18, keep: null });
        break;
      }
      case "arrows": {
        if (!this.scene.startsWith("adam") || this.adamHandles.length === 0) return;
        this.markSceneFocus();
        this.view.setFocusDim({ terrain: 0.28, overlay: 0.2, keep: [...this.adamHandles] });
        this.view.spotlightAt(this.adamPoint, MANIM.white, 0.055);
        this.lookPointFn = (): Vec2 => this.adamPoint;
        break;
      }
      case "momApex": {
        if (!this.scene.startsWith("mom") || this.momHighlight === null || this.momApexPts.length === 0) return;
        this.markSceneFocus();
        this.view.setFocusDim({ terrain: 0.3, overlay: 0.22, keep: [this.momHighlight] });
        this.view.spotlightAt(this.momApexPts[0], MANIM.gold, 0.045);
        break;
      }
      case "marker": {
        if (t.which === "fog") {
          const level = this.fogMarker === null ? null : this.fogLevel;
          if (level === null) return;
          this.markSceneFocus();
          this.view.setFocusDim({ terrain: 0.3, overlay: 0.22, keep: [this.fogMarker!] });
          this.view.spotlightAt(level.globalMin, MANIM.gold, 0.05);
          this.lookPointFn = (): Vec2 => level.globalMin;
        } else {
          if (this.epiMarker === null) return;
          this.markSceneFocus();
          this.view.setFocusDim({ terrain: 0.3, overlay: 0.22, keep: [this.epiMarker] });
          this.view.spotlightAt(ARGMIN, MANIM.gold, 0.05);
          this.lookPointFn = (): Vec2 => ARGMIN;
        }
        break;
      }
    }
  }

  /* ---------------- internals ---------------- */

  /** Relative-label helper for the §4 readouts (vs the s=1 baseline). */
  private adamLenLabel(ins: AdamInspector): string {
    const base = adamInspect(ADAM_STEEP_MIN).adamStepLen || 1;
    return `${ins.adamStepLen.toFixed(3)} (×${(ins.adamStepLen / base).toFixed(1)})`;
  }

  /** Per-scene state, applied at setScene time (landscape-independent). */
  private enterSceneState(name: SceneName, instant: boolean): void {
    this.setLook(null); // a spotlight never survives a scene change
    this.minimap.setPaths(null);
    this.userTip = null;
    this.gdTipFull = null;
    this.gdAnimT = 1;
    this.clearMomVisuals();
    this.clearAdamVisuals();
    this.clearReplayVisuals();
    this.clearRuleVisuals();
    this.adamArrowTips = [];
    this.pendingRule = false;
    // A pending lab rebuild is meaningless once the scene leaves the lab —
    // and leaving it set pins `animating` (the reader lock) forever, since
    // its rebuild block requires built === "lab". Re-entering §5 rebuilds
    // from the current labE/labRot regardless (QA PERF-1 adjacent hazard).
    if (name !== "lab") this.pendingLab = false;

    const isFog = name === "fog-a" || name === "fog-b" || name === "fog-c";
    const isTilt = name === "tilt-a" || name === "tilt-b" || name === "swarm";
    const isEpi = name === "epi-a" || name === "epi-b" || name === "epi-c";
    // Leaving §6/§7: everything those games put on stage must go — in BOTH
    // directions. Entering §6 from §7 must clear §7's HUD (a rail jump
    // swarm → fog-b left the stale tilt panel overlapping the fog game and
    // blocking its Finish button — QA N2-R2-1); entering §7 already clears
    // the fog stage inside enterTiltState.
    if (!isFog && !isTilt) {
      this.clearFogStage();
    }
    if (!isTilt) {
      this.clearTiltStage();
    }
    // Leaving §9: the marker + lattice go with it.
    if (!isEpi) this.clearEpiStage();

    if (isFog) {
      this.enterFogState(name, instant);
    } else if (isTilt) {
      this.enterTiltState(name, instant);
    } else if (name === "gd-a") {
      this.driftT = instant && this.frozen ? GD_A_FROZEN_DRIFT_T : 0;
      this.point = this.driftPoint(this.driftT);
      this.clearGdArrows();
      this.clearTrajectory();
    } else if (name === "gd-b") {
      this.point = { ...GD_START };
      this.clearGdArrows();
      this.clearTrajectory();
      if (instant && this.frozen) {
        // Deterministic pose: a drawn user arrow + GD's full red step.
        this.userTip = { ...GD_B_FROZEN_USER_TIP };
        this.gdTipFull = this.gdStepTip();
        this.gdAnimT = 1;
      }
    } else if (name === "gd-c" || name === "gd-d") {
      this.point = { ...GD_START };
      this.driftT = 0;
      this.clearGdArrows();
      if (this.eta === null) this.eta = ETA_MID;
      if (instant && this.frozen) {
        this.eta = name === "gd-c" ? GD_C_FROZEN_ETA : GD_D_FROZEN_ETA;
      }
      this.syncEtaUi();
    } else if (name.startsWith("mom")) {
      this.point = { ...MOM_START };
      this.driftT = 0;
      this.clearGdArrows();
      this.clearTrajectory();
      if (name === "mom-b") {
        // The curated overshoot beat (live re-entry re-curates it too).
        this.momBeta = MOM_BETA_OVERSHOOT;
      } else if (this.momBeta === null) {
        this.momBeta = MOM_BETA_DEFAULT;
      }
      if (instant && this.frozen) {
        this.momBeta = name === "mom-b" ? MOM_BETA_OVERSHOOT : MOM_BETA_DEFAULT;
      }
      this.syncBetaUi();
    } else if (name.startsWith("adam")) {
      this.point = { ...ADAM_POINT };
      this.driftT = 0;
      this.clearGdArrows();
      this.clearTrajectory();
      if (this.adamS === null) this.adamS = ADAM_STEEP_MIN;
      // adam-b is the curated "steepness maxed" beat, live and frozen alike.
      if (name === "adam-b") this.adamS = ADAM_FROZEN_STEEP_B;
      if (instant && this.frozen && name === "adam-a") {
        this.adamS = ADAM_FROZEN_STEEP_A;
      }
      this.syncSteepUi();
    } else if (name === "labrule") {
      this.driftT = 0;
      this.clearGdArrows();
      this.clearTrajectory();
      // First entry curates the default config + Rosenbrock (where the rule
      // beats Adam); re-entry keeps whatever the player assembled — the same
      // persistence §5's sliders have. The frozen hook pose IS the default.
      this.syncRulePanel();
    } else if (isEpi) {
      this.enterEpiState(name, instant);
    } else if (name === "lab") {
      this.driftT = 0;
      this.clearGdArrows();
      this.clearTrajectory();
      if (this.labE === null) this.labE = LAB_E_DEFAULT;
      if (this.labRot === null) this.labRot = LAB_ROT_DEFAULT;
      this.labPoint = labStart(labBowl(this.labE, this.labRot));
      this.syncLabUi();
    } else {
      // Hero / §1: §2's step arrows and trajectory do not belong here.
      this.clearGdArrows();
      this.clearTrajectory();
    }
  }

  /* ---------------- §7: tilt-game scene state ---------------- */

  /**
   * tilt-a starts (or restarts) a run at the CURRENT level; tilt-b is the
   * reveal — it keeps the played run (finishing it if still live) or falls
   * back to the curated Rosenbrock story; swarm clears the game stage and
   * lets refreshSwarmVisuals rebuild the 100-ball finale after the rebuild.
   */
  private enterTiltState(name: SceneName, instant: boolean): void {
    this.clearGdArrows();
    this.clearTrajectory();
    this.clearFogStage();

    if (name === "swarm") {
      this.clearTiltStage();
      this.tiltRun = null;
      return;
    }

    if (instant && this.frozen) {
      // Deterministic shot poses (?shot=tilt-a / ?shot=tilt-b).
      if (name === "tilt-a") {
        this.tiltLevel = TILT_VALLEY;
        this.tiltRun = tiltCuratedRun(TILT_VALLEY, TILT_DEFAULT_FRICTION, {
          frac: TILT_A_FROZEN_FRAC,
        });
      } else {
        this.tiltLevel = TILT_ROSEN;
        this.tiltRun = tiltCuratedRun(TILT_ROSEN, TILT_DEFAULT_FRICTION);
      }
    } else if (name === "tilt-b") {
      // The reveal: keep the played run (finish it now), or nothing was
      // played — the curated Rosenbrock story. QA cycle B round 2: a
      // rail-tick/`?step` jump lands here with NO session run, and the
      // curated ride's simulated inputs flip `steered` — so the seed is
      // marked curated AND unsteered, and the scorecard grades it honestly
      // ("you (no run)"), never as the student's run. (The frozen
      // ?shot=tilt-b pose above is a staged demo shot and keeps its labels.)
      if (!this.tiltRun) {
        this.tiltLevel = TILT_ROSEN;
        this.tiltRun = tiltCuratedRun(TILT_ROSEN, TILT_DEFAULT_FRICTION);
        this.tiltRun.curated = true;
        this.tiltRun.steered = false;
      } else if (!this.tiltRun.done) {
        this.finishTiltRun();
      }
    } else {
      // A fresh run at the current level (re-entry keeps the player's level).
      // requireInput: the opening drift (quiet ground at the level's start)
      // is the attract state — the run must not score itself before the
      // player has steered (QA GP-1 round 2).
      this.tiltRun = tiltInit(this.tiltLevel, { requireInput: true });
      this.tiltMachineRuns = null;
      this.clearTiltReveal();
    }

    this.tiltAccum = 0;
    this.tiltCueT = 0;
    this.syncTiltFinishCue();
    this.clearTiltKeys();
    this.tiltScrub = instant && this.frozen && name === "tilt-b" ? TILT_B_FROZEN_SCRUB : 1;
    this.tiltScrubPlaying = false;
    this.tiltScrubClock = this.tiltScrub * this.ghostDuration();
  }

  /* ---------------- §6: fog-game scene state ---------------- */

  /**
   * fog-a/b start (or resume curated) runs; fog-c is the reveal screen — it
   * KEEPS the level-2 run (finishing it if the player skipped), builds the
   * four ghosts and tweens the fog fully open.
   */
  private enterFogState(name: SceneName, instant: boolean): void {
    this.clearGdArrows();
    this.clearTrajectory();
    this.fogAnim = null;
    this.fogStampFrom = null;
    this.fogPreviewTip = null;

    if (name === "fog-a" || name === "fog-b") {
      this.clearFogStage();
      this.fogLevel = name === "fog-a" ? FOG_LS : FOG_RB;
      this.fogMachines = null;
      if (instant && this.frozen && name === "fog-b") {
        // ?shot=fog-b: mid-game, partially painted, 6 measurements left.
        this.fogSt = fogStateFromPath(this.fogLevel, FOG_RB_CURATED_MID, false);
      } else {
        this.fogSt = fogInit(this.fogLevel);
      }
      this.values.set("fogrev", 0);
      this.view.setFogReveal(0);
      this.view.setContourReveal(0);
      this.fogMaskReady = false; // re-initialized after the rebuild lands
      return;
    }

    // ---- fog-c: the reveal ----
    if (this.fogLevel === null || this.fogSt === null || this.fogLevel.id !== "rb") {
      // Jumped straight here (or revealing after a level-1 run): the reveal
      // screen is the Rosenbrock story — start its curated run if needed.
      this.fogLevel = FOG_RB;
      this.fogSt = fogInit(FOG_RB);
      this.fogMachines = null;
    }
    // The reveal ends the run no matter how the player got here.
    if (!this.fogSt.done) {
      this.fogSt = { ...this.fogSt, done: true };
    }
    if (this.fogSt.used === 0 && instant && this.frozen) {
      // ?shot=fog-c: the full curated player run, finished.
      this.fogSt = fogStateFromPath(FOG_RB, fogCannedRun(FOG_RB), true);
      this.fogMachines = null;
    }
    this.clearFogGhostStage(); // rebuilt fresh by refreshFogVisuals
    if (instant && this.frozen) {
      this.values.set("fogrev", 1);
      this.view.setFogReveal(1);
      this.view.setContourReveal(1);
    } else if (this.val("fogrev") < 1) {
      this.tween("fogrev", 1, 1.6);
    }
  }

  /** Landscape-bound section visuals — call after any rebuild / scene layout. */
  private refreshGdVisuals(): void {
    const name = this.scene;
    if (name === "swarm") {
      this.refreshSwarmVisuals();
      return;
    }
    if (name === "tilt-a" || name === "tilt-b") {
      this.refreshTiltVisuals();
      return;
    }
    if (name.startsWith("fog")) {
      this.refreshFogVisuals();
      return;
    }
    if (name.startsWith("gd")) {
      if (name === "gd-b") {
        this.updateGdArrows(this.gdAnimT);
      } else {
        this.clearGdArrows();
      }
      if (SCENES[name].traj === true) {
        this.rebuildTrajectory();
      } else {
        this.clearTrajectory();
      }
      return;
    }
    if (name.startsWith("mom")) {
      this.rebuildMomVisuals();
      return;
    }
    if (name.startsWith("adam")) {
      this.rebuildAdamVisuals();
      return;
    }
    if (name === "labrule") {
      this.rebuildRuleVisuals();
      return;
    }
    if (name === "epi-a" || name === "epi-b" || name === "epi-c") {
      this.refreshEpiVisuals();
      return;
    }
    if (name === "lab") {
      this.rebuildLabVisuals();
      return;
    }
  }

  /** Red arrows (user white, GD red at `frac` of its length) on map + 3D.
   *  The 3D arrows are persistent handles mutated via userData.update — the
   *  grow animation and drag previews re-emit them every frame. */
  private updateGdArrows(gdFrac: number): void {
    if (this.built !== "bowl") {
      this.clearGdArrows();
      return;
    }
    this.gdArrowUser = this.syncGdArrow(this.gdArrowUser, this.userTip, OPTIMIZER_COLORS.learner);
    const gdTip: Vec2 | null =
      this.gdTipFull && gdFrac > 0.001 ? lerp2(this.point, this.gdTipFull, gdFrac) : null;
    this.gdArrowGd = this.syncGdArrow(this.gdArrowGd, gdTip, OPTIMIZER_COLORS.gd);
    this.arrowHandles =
      this.gdArrowUser !== null && this.gdArrowGd !== null
        ? [this.gdArrowUser, this.gdArrowGd]
        : this.gdArrowUser !== null
          ? [this.gdArrowUser]
          : this.gdArrowGd !== null
            ? [this.gdArrowGd]
            : [];
    this.minimap.setArrows({ userTip: this.userTip, gdTip });
    // A hover spotlight keeps the fresh arrows bright (hover-to-look).
    this.reapplyLook();
  }

  /** Reuses `handle` for a tip, creating it on demand / freeing when null.
   *  A handle whose parent is gone was disposed by a landscape rebuild —
   *  treat it as freed rather than mutating a dead object. */
  private syncGdArrow(
    handle: THREE.Object3D | null,
    tip: Vec2 | null,
    color: number,
  ): THREE.Object3D | null {
    if (handle && handle.parent === null) handle = null;
    if (!tip) {
      if (handle) this.view.removeOverlayObject(handle);
      return null;
    }
    const d = { x: tip.x - this.point.x, y: tip.y - this.point.y };
    const len = Math.hypot(d.x, d.y);
    if (!handle) {
      return this.view.addArrow(this.point, d, color, { length: len });
    }
    (handle.userData.update as (pos: Vec2, dir: Vec2, length?: number) => void)(
      this.point,
      d,
      len,
    );
    return handle;
  }

  private clearGdArrows(): void {
    if (this.gdArrowUser) this.view.removeOverlayObject(this.gdArrowUser);
    if (this.gdArrowGd) this.view.removeOverlayObject(this.gdArrowGd);
    this.gdArrowUser = null;
    this.gdArrowGd = null;
    this.arrowHandles = [];
    this.minimap.setArrows({ userTip: null, gdTip: null });
  }

  /** Re-runs GD at the current η and redraws the trail on map + surface.
   *  On gd-d it stages the copy's four curated lanes instead: "Four
   *  settings, four trajectories." (QA cycle B critic-gdd — live entry used
   *  to inherit the η=0.0632 crawl from gd-c, the least legible of the
   *  four, with the full ribbon existing only in the frozen shot). */
  private rebuildTrajectory(): void {
    this.clearReplayVisuals();
    this.clearTrajectory();
    if (this.eta === null || this.built !== "bowl") {
      this.minimap.setPath(null);
      return;
    }
    if (this.scene === "gd-d") {
      const paths = GD_D_ETAS.map((e) => runGdPath(e));
      this.minimap.setPaths(
        paths.map((p) => ({ points: p, color: "rgba(252,98,85,0.85)" })),
      );
      for (const path of paths) {
        if (path.length < 2) continue;
        const t = new AnimatedTrail(this.view, path, OPTIMIZER_COLORS.gd);
        t.setProgress(1);
        t.setAlpha(1);
        this.gdDLanes.push(t);
      }
      // A hover spotlight re-dims the fresh trails (hover-to-look).
      this.reapplyLook();
      return;
    }
    const path = runGdPath(this.eta);
    this.minimap.setPath(path);
    if (path.length >= 2) {
      this.trail = new AnimatedTrail(this.view, path, OPTIMIZER_COLORS.gd);
      this.trail.setProgress(1);
      this.trail.setAlpha(1);
    }
    // A hover spotlight re-dims the fresh trail (hover-to-look).
    this.reapplyLook();
  }

  private clearTrajectory(): void {
    if (this.trail) {
      this.trail.dispose();
      this.trail = null;
    }
    for (const t of this.gdDLanes) t.dispose();
    this.gdDLanes = [];
    this.minimap.setPath(null);
  }

  private syncEtaUi(): void {
    if (this.els.etaSlider && this.eta !== null) {
      const t = (Math.log10(this.eta) - Math.log10(ETA_MIN)) / (Math.log10(ETA_MAX) - Math.log10(ETA_MIN));
      this.els.etaSlider.value = String(Math.round(t * 1000));
    }
    if (this.els.etaValue && this.eta !== null) {
      this.els.etaValue.textContent = formatEta(this.eta);
    }
    if (this.els.etaRegime && this.eta !== null) {
      const r = regimeOf(this.eta);
      this.els.etaRegime.textContent = r;
      this.els.etaRegime.dataset.regime = r;
    }
  }

  /* ---------------- §3: momentum visuals ---------------- */

  /** Re-runs GD (red) and momentum (blue) at the current β, redraws both
   *  trails on map + surface and lights the overshoot apexes. */
  private rebuildMomVisuals(): void {
    this.clearReplayVisuals();
    this.clearMomVisuals();
    this.clearMomHighlight();
    if (this.momBeta === null || this.built !== "mom") return;

    const gdPath = runMomGdPath();
    const momPath = runMomentumPath(this.momBeta);
    this.minimap.setPaths([
      { points: gdPath, color: "rgba(252,98,85,0.85)" },
      { points: momPath, color: "rgba(88,196,221,0.9)" },
    ]);
    if (gdPath.length >= 2) {
      // glow 0.35: the β=0.97 zigzag bunches tightly at its apexes; unclamped
      // additive stacking there blooms to a white-hot knot (visual verdict).
      this.momGdTrail = new AnimatedTrail(this.view, gdPath, OPTIMIZER_COLORS.gd, 1.6, 0.35);
      this.momGdTrail.setProgress(1);
      this.momGdTrail.setAlpha(1);
    }
    if (momPath.length >= 2) {
      this.momTrail = new AnimatedTrail(this.view, momPath, OPTIMIZER_COLORS.momentum, 1.6, 0.35);
      this.momTrail.setProgress(1);
      this.momTrail.setAlpha(1);
    }

    // Overshoot apexes: gold markers that burn bright and fade (frozen poses
    // hold them visible for the screenshot gate). Normal blending — additive
    // gold washes out to white over the blue valley floor.
    const apexes = momApexes(momPath);
    this.momApexPts = apexes.map((i) => ({ ...momPath[i] }));
    if (apexes.length > 0) {
      const group = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({
        color: MANIM.gold,
        transparent: true,
        opacity: this.frozen ? 0.95 : 0.9,
        blending: THREE.NormalBlending,
        depthWrite: false,
      });
      const geo = new THREE.SphereGeometry(1, 14, 10);
      const r = MOM_BOWL.extent.xMax * 2 * 0.009;
      for (const i of apexes.slice(0, 12)) {
        const m = new THREE.Mesh(geo, mat);
        m.scale.setScalar(r);
        this.view.parameterToWorld(momPath[i], this.view.trailLift + this.view.diagonal * 0.014, m.position);
        group.add(m);
      }
      this.momHighlight = group;
      this.momHighlightMat = mat;
      this.momHighlightT = this.frozen ? 1 : 0;
      this.view.addOverlayObject(group);
    }
    // A hover spotlight re-dims the fresh trails/markers (hover-to-look).
    this.reapplyLook();
  }

  private clearMomVisuals(): void {
    if (this.momGdTrail) {
      this.momGdTrail.dispose();
      this.momGdTrail = null;
    }
    if (this.momTrail) {
      this.momTrail.dispose();
      this.momTrail = null;
    }
    this.clearMomHighlight();
    this.momApexPts = [];
    this.minimap.setPaths(null);
  }

  private clearMomHighlight(): void {
    if (this.momHighlight) {
      this.view.removeOverlayObject(this.momHighlight);
      this.momHighlight = null;
      this.momHighlightMat = null;
    }
  }

  private syncBetaUi(): void {
    if (this.momBeta === null) return;
    for (const slider of this.els.betaSliders) {
      slider.value = String(Math.round(this.momBeta * 1000));
    }
    for (const el of this.els.betaValues) {
      el.textContent = this.momBeta.toFixed(2);
    }
    const r = momRegimeOf(this.momBeta);
    for (const el of this.els.betaRegimes) {
      el.textContent = r;
      el.dataset.regime = r;
    }
  }

  /* ---------------- §4: adam inspector visuals ---------------- */

  /** Rebuilds the inspector: warm Adam at the point, both tangent arrows,
   *  the angle readout, the m̂/√v̂ bars and both step lengths. */
  private rebuildAdamVisuals(): void {
    this.clearReplayVisuals();
    this.clearAdamVisuals();
    if (this.adamS === null || this.built !== "adam") return;

    const ins = adamInspect(this.adamS);
    this.adamPoint = ins.point;

    const g = adamBowl(this.adamS).grad(ins.point);
    const gdLen = ins.gdStepLen;
    // True step lengths are ~1% of the extent — magnify for legibility and
    // clamp GD's runaway so it stays on stage (the readout keeps the truth).
    const MAG = 30;
    const maxLen = 14;
    // White: −∇f with GD's step length (grows with steepness — the point).
    const gdDrawn = Math.min(gdLen * MAG, maxLen);
    const gl = Math.hypot(g.x, g.y) || 1;
    const h1 = this.view.addArrow(
      ins.point,
      { x: -g.x, y: -g.y },
      OPTIMIZER_COLORS.learner,
      { length: gdDrawn },
    );
    if (h1) this.adamHandles.push(h1);
    // Yellow: the actual Adam update direction and length (barely moves).
    const updateLen = ins.adamStepLen;
    const ux = -ins.ratio.x;
    const uy = -ins.ratio.y;
    const h2 = this.view.addArrow(ins.point, { x: ux, y: uy }, OPTIMIZER_COLORS.adam, {
      length: Math.min(updateLen * MAG, maxLen),
    });
    if (h2) this.adamHandles.push(h2);

    // Contact shadows under the floating arrow endpoints (WP-A2).
    const ul = Math.hypot(ux, uy) || 1;
    this.adamArrowTips = [
      {
        x: ins.point.x + (-g.x / gl) * gdDrawn,
        y: ins.point.y + (-g.y / gl) * gdDrawn,
      },
      { x: ins.point.x + (ux / ul) * updateLen, y: ins.point.y + (uy / ul) * updateLen },
    ];

    if (this.els.adamAngle) {
      this.els.adamAngle.textContent = `${ins.angleDeg.toFixed(1)}°`;
    }
    if (this.els.adamGdLen) {
      this.els.adamGdLen.textContent = `${gdLen.toFixed(2)} (×${(gdLen / (adamInspect(ADAM_STEEP_MIN).gdStepLen || 1)).toFixed(1)})`;
    }
    if (this.els.adamAdamLen) {
      this.els.adamAdamLen.textContent = this.adamLenLabel(ins);
    }
    this.setBar("X", ins.ratio.x);
    this.setBar("Y", ins.ratio.y);
    // A hover spotlight keeps the fresh arrows bright (hover-to-look).
    this.reapplyLook();
  }

  private setBar(axis: "X" | "Y", v: number): void {
    const fill = axis === "X" ? this.els.barX : this.els.barY;
    const val = axis === "X" ? this.els.barXVal : this.els.barYVal;
    const k = clamp(Math.abs(v), 0, 1);
    if (fill) {
      fill.style.width = `${k * 50}%`;
      fill.dataset.sign = v >= 0 ? "pos" : "neg";
    }
    if (val) val.textContent = `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`;
  }

  private clearAdamVisuals(): void {
    for (const h of this.adamHandles) this.view.removeOverlayObject(h);
    this.adamHandles = [];
  }

  private syncSteepUi(): void {
    if (this.els.steepSlider && this.adamS !== null) {
      const t = Math.log10(this.adamS / ADAM_STEEP_MIN) / Math.log10(ADAM_STEEP_MAX / ADAM_STEEP_MIN);
      this.els.steepSlider.value = String(Math.round(clamp(t, 0, 1) * 1000));
    }
    if (this.els.steepValue && this.adamS !== null) {
      this.els.steepValue.textContent = `×${this.adamS.toFixed(0)}`;
    }
  }

  /** Full landscape rebuild: disposes the race, swaps terrain, refits cam. */
  private rebuildNow(spec: SceneSpec): void {
    if (this.race) {
      this.race.dispose();
      this.race = null;
    }
    let fn: Landscape;
    if (spec.landscape === "bowl") fn = defaultBowl;
    else if (spec.landscape === "ls") fn = leastSquares;
    else if (spec.landscape === "mom") fn = MOM_BOWL;
    else if (spec.landscape === "lab") {
      fn = labBowl(this.labE ?? LAB_E_DEFAULT, this.labRot ?? LAB_ROT_DEFAULT);
    } else if (spec.landscape === "rule") {
      fn = ruleLevelById(this.ruleLevel).landscape;
      this.builtRule = this.ruleLevel;
    } else if (spec.landscape === "fog-ls") {
      fn = leastSquares;
    } else if (spec.landscape === "fog-rb") {
      fn = rosenbrock;
    } else if (spec.landscape === "tilt") {
      fn = this.tiltLevel.landscape;
      this.builtTilt = this.tiltLevel.id;
    } else if (spec.landscape === "swarm") {
      fn = SWARM_LEVEL.landscape;
      this.builtTilt = null;
    } else {
      fn = adamBowl(this.adamS ?? ADAM_STEEP_MIN);
      this.builtAdamS = this.adamS ?? ADAM_STEEP_MIN;
    }
    // Must precede setLandscape: the framing offset is applied by the reframe.
    this.view.setFrameOffsetY(spec.race ? HERO_FRAME_DROP_PX : 0);
    this.view.setLandscape(
      fn,
      spec.landscape === "lab" || spec.landscape === "rule" ? { gridN: 64 } : {},
    );
    this.built = spec.landscape;
    // A fresh terrain carries a fresh material — the fog mask must rebind.
    this.fogMaskReady = false;
    // setLandscape disposed everything §7 had on stage — drop the dead refs
    // (refreshTiltVisuals / refreshSwarmVisuals rebuild what the scene needs).
    this.dropTiltRefs();
    this.minimap.setLandscape(fn);
    if (spec.race) this.createRace();
    // Rebuilds start invisible; tweens (or an instant snap) bring them up.
    this.values.set("rise", 0);
    this.values.set("opac", 0);
    this.view.setTerrainRise(0);
    this.view.setTerrainOpacity(0);
  }

  private createRace(): void {
    this.race = createHeroRace(this.view, defaultBowl);
    this.raceTime = 0;
    this.race.applyPhase(this.frozen ? HERO_FULL_PHASE : 0);
  }

  /** Eased camera flight (shortest-path azimuth). */
  private tweenCamera(cam: CamSpec): void {
    const a = this.view.attitude;
    // Zoom targets the LANDSCAPE'S FIT × the spec multiplier (QA F-2/cam-1):
    // multiplying the inherited radius compounded on every same-landscape
    // re-entry and made framing arrival-path-dependent.
    const zoomTo = this.view.fitZoom * cam.zoom;
    const dAz = wrap180(cam.azimuth - a.azimuthDeg);
    this.tweens.set("azim", { from: a.azimuthDeg, to: a.azimuthDeg + dAz, t: 0, dur: 0.9 });
    this.tweens.set("elev", { from: a.elevationDeg, to: cam.elevation, t: 0, dur: 0.9 });
    this.tweens.set("zoom", { from: a.zoomRadius, to: zoomTo, t: 0, dur: 0.9 });
    this.camTarget = { azimuth: a.azimuthDeg + dAz, elevation: cam.elevation, zoomRadius: zoomTo };
    this.camDirty = true;
  }

  /**
   * The user grabbed the camera (orbit drag started): drop any in-flight
   * camera choreography. Without this, a step-change camera tween keeps
   * applying setAttitude every frame (camDirty) and the drag visibly does
   * nothing until the tween drains.
   */
  cancelCameraTweens(): void {
    this.tweens.delete("azim");
    this.tweens.delete("elev");
    this.tweens.delete("zoom");
    this.camDirty = false;
    this.camTarget = null;
  }

  private tweenFit(target: Vec2): void {
    this.tween("fw", target.x, 0.95);
    this.tween("fb", target.y, 0.95);
  }

  private tween(key: string, to: number, dur: number): void {
    this.tweens.set(key, { from: this.val(key), to, t: 0, dur });
  }

  private val(key: string): number {
    return this.values.get(key) ?? 0;
  }

  private atTarget(key: string): boolean {
    const tw = this.tweens.get(key);
    return !tw || tw.t >= tw.dur;
  }

  private advanceTweens(dt: number): boolean {
    if (this.tweens.size === 0) return false;
    let changed = false;
    for (const [key, tw] of [...this.tweens]) {
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.dur);
      this.values.set(key, tw.from + (tw.to - tw.from) * easeInOutCubic(k));
      changed = true;
      if (k >= 1) this.tweens.delete(key);
    }
    return changed;
  }

  private applyHud(spec: SceneSpec): void {
    const { hud } = spec;
    setHud(this.els.heroOverlay, hud.hero);
    setHud(this.els.fitPanel, hud.fit);
    setHud(this.els.lossPanel, hud.loss);
    setHud(this.els.minimapPanel, hud.map);
    setHud(this.els.adamPanel, spec.inspector === true);
    setHud(this.els.curvesPanel, spec.curves === true);
    setHud(this.els.playBtn, spec.transport === true);
    setHud(this.els.speedWrap, spec.transport === true);
    // The minimap is the §2 drawing surface — crosshair while in gd-b. The
    // fog game draws there too (§6's turn loop). §7's tall panel owns the
    // top-left slot, so the compass docks bottom-RIGHT during tilt play.
    if (this.els.minimapPanel) {
      this.els.minimapPanel.dataset.drawing = String(
        this.scene === "gd-b" || this.scene === "fog-a" || this.scene === "fog-b",
      );
      this.els.minimapPanel.dataset.dock =
        this.scene === "tilt-a" || this.scene === "tilt-b" ? "right" : "left";
    }
  }

  /** Pushes the current fit everywhere: 3D ball, minimap, inset, readouts. */
  private updateDependents(): void {
    // Universal-play transport gating + contact shadows: pure getters, so
    // they are evaluated before the per-family branches place anything.
    this.updateTransport();
    this.updateShadows();
    // The §8 workbench lives in the canvas pane and must show on labrule
    // scenes ONLY: every branch below returns early, so the hide happens
    // up front — otherwise the panel stayed stuck over every later step
    // after visiting §8 (user report: workbench stuck on top of the screen).
    if (this.scene !== "labrule") setHud(this.els.rulePanel, false);
    const spec = SCENES[this.scene];
    if (this.scene.startsWith("gd")) {
      if (this.built === "bowl") {
        this.view.setBall(this.point, OPTIMIZER_COLORS.learner);
        this.minimap.setPoint(this.point, defaultBowl.grad(this.point));
      } else {
        this.view.setBall(null);
      }
      return;
    }
    if (this.scene.startsWith("mom")) {
      if (this.built === "mom") {
        this.view.setBall(MOM_START, OPTIMIZER_COLORS.learner);
        this.minimap.setPoint(MOM_START, MOM_BOWL.grad(MOM_START));
      } else {
        this.view.setBall(null);
      }
      return;
    }
    if (this.scene.startsWith("adam")) {
      if (this.built === "adam") {
        this.view.setBall(this.adamPoint, OPTIMIZER_COLORS.learner);
        this.minimap.setPoint(
          this.adamPoint,
          adamBowl(this.adamS ?? ADAM_STEEP_MIN).grad(this.adamPoint),
        );
      } else {
        this.view.setBall(null);
      }
      return;
    }
    if (this.scene.startsWith("fog")) {
      this.updateFogDependents();
      return;
    }
    if (this.scene === "tilt-a" || this.scene === "tilt-b") {
      this.updateTiltDependents();
      return;
    }
    if (this.scene === "swarm") {
      // The swarm's instanced balls replace the single learner ball here;
      // their ground spots ride along with the same shadow list.
      this.view.setBall(null);
      this.syncTiltPanel();
      return;
    }
    if (this.scene === "lab") {
      if (this.built === "lab") {
        const bowl = labBowl(this.labE ?? LAB_E_DEFAULT, this.labRot ?? LAB_ROT_DEFAULT);
        this.view.setBall(this.labPoint, OPTIMIZER_COLORS.learner);
        this.minimap.setPoint(this.labPoint, bowl.grad(this.labPoint));
      } else {
        this.view.setBall(null);
      }
      return;
    }
    if (this.scene === "labrule") {
      if (this.built === "rule" && this.builtRule === this.ruleLevel) {
        const level = ruleLevelById(this.ruleLevel);
        this.view.setBall(level.start, OPTIMIZER_COLORS.learner);
        this.minimap.setPoint(level.start, level.landscape.grad(level.start));
        this.syncRulePanel();
      } else {
        this.view.setBall(null);
        setHud(this.els.rulePanel, false);
      }
      return;
    }
    if (this.scene === "epi-a" || this.scene === "epi-b" || this.scene === "epi-c") {
      this.view.setBall(null);
      this.refreshEpiVisuals();
      return;
    }
    if (spec.ball && this.built === "ls") {
      this.view.setBall(this.fit, OPTIMIZER_COLORS.learner);
    } else {
      this.view.setBall(null);
    }
    if (this.built === "ls") {
      this.minimap.setPoint(this.fit, leastSquares.grad(this.fit));
    }
    this.fitPreview.setFit(this.fit.x, this.fit.y);
    if (this.els.roW) this.els.roW.textContent = this.fit.x.toFixed(2);
    if (this.els.roB) this.els.roB.textContent = this.fit.y.toFixed(2);
    if (this.els.lossValue) {
      this.els.lossValue.textContent = leastSquares.f(this.fit).toFixed(2);
    }
  }
}

function setHud(el: HTMLElement | null, visible: boolean): void {
  if (el) el.dataset.visible = String(visible);
}

/** 3 significant digits, monospace-friendly: 0.0632, 0.450, 1.60. */
export function formatEta(eta: number): string {
  return eta.toPrecision(3);
}
