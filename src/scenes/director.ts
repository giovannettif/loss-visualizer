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
  ARCHIPELAGO_RIDGES,
  ARCHIPELAGO_WELLS,
  CANYON_PEAKS,
  defaultBowl,
  leastSquares,
  makeBowl,
  rosenbrock,
  LEAST_SQUARES_POINTS,
  type Extent,
  type Landscape,
  type Vec2,
  type WellSpec,
} from "../core/functions";
import { gd, momentum, adam } from "../core/optimizers";
import { OPTIMIZER_COLORS, MANIM } from "../view/palette";
import { AnimatedTrail, setTrailFocus } from "../view/animatedTrail";
import { LossCurves, type LossCurve } from "../view/lossCurves";
import { samplePath, samplePathAtStep, TrajectoryPlayer } from "../view/trajectoryPlayer";
import { LOOK_TARGETS, type LookTarget, type PanelId } from "../view/lookRegistry";
import type { LandscapeView } from "../view/LandscapeView";
import type { CompassMinimap } from "../view/CompassMinimap";
import type { FitPreview } from "../view/FitPreview";
import {
  archipelagoCard,
  bowlCard,
  canyonCard,
  himmelblauCard,
  leastSquaresCard,
  multiWellCard,
  nbp,
  pairsJoin,
  rastriginCard,
  rosenbrockCard,
  type FuncCardContent,
} from "../view/functionCard";
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
  fogResolveStride,
  FOG_DRAG_SLOP_PX,
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
  ruleCustomWins,
  ruleDisplayPath,
  ruleVerdictKey,
  ruleFormatLoss,
  ruleFormatSteps,
  ruleKnobFromClip,
  ruleKnobFromEta,
  ruleLevelById,
  ruleVerdictSentence,
  type RuleBenchmark,
  type RuleChangeCause,
  type RuleLevelId,
  type RuleRun,
} from "./ruleLab";
import type { CustomRuleConfig, OptimizerState } from "../core/optimizers";
import {
  SWARM_COUNT,
  TILT_CUE_AFTER_SEC,
  TILT_CUE_SPEED,
  TILT_DEFAULT_FRICTION,
  TILT_DT,
  TILT_MACHINE_STEPS,
  TILT_ROSEN,
  TILT_VALLEY,
  dampingRegime,
  landscapeWells,
  runTiltMachines,
  simulateSwarm,
  swarmMapById,
  tiltCuratedRun,
  tiltDiag,
  tiltFinish,
  tiltFormatLoss,
  tiltAtGoal,
  tiltBasin,
  tiltScreenToParam,
  tiltFrameDropPx,
  swarmPaintLedger,
  swarmBasinOf,
  tiltInit,
  tiltLevelById,
  tiltPitLabel,
  tiltSamePit,
  tiltScore,
  tiltStep,
  type SwarmMapId,
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

/** Deferred fog-c entry (QA F16-FOGC-FILL-PEG round 2): the share of the
 *  edge fill the ENTRY motion owns; the ghost race fills the remaining 75%
 *  (measured entry ≈ 2.4 s, race ≈ 6.5 s). */
const FOGC_ENTRY_SHARE = 0.25;

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
 *  (just under the overshoot threshold 1/λmax = 0.5 here — λmax is the
 *  largest Hessian eigenvalue, λmax = 2λ₁ = 2). */
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
export const ADAM_POINT: Vec2 = (() => {
  const c = Math.cos(Math.PI / 6);
  const s = Math.sin(Math.PI / 6);
  return { x: 1.5 * c + 9 * -s, y: 1.5 * s + 9 * c };
})();
const ADAM_ETA = 0.3; // SAME η for both optimizers — the honest comparison
const ADAM_WARM_STEPS = 12;
const ADAM_B1 = 0.9;
const ADAM_B2 = 0.999;
const ADAM_EPS = 1e-8;
/** Adam warmed ADAM_WARM_STEPS steps from ADAM_POINT — the state the §4
 *  inspector reads (its point is the white ball / arrows origin). */
function adamWarmState(steepness: number): OptimizerState {
  const bowl = adamBowl(steepness);
  const opt = adam(ADAM_ETA, ADAM_B1, ADAM_B2, ADAM_EPS);
  let st = opt.initState(ADAM_POINT);
  for (let i = 0; i < ADAM_WARM_STEPS; i++) st = opt.step(st, bowl.grad(st.pos));
  return st;
}

/**
 * A side-by-side roll lane for §4: GD or Adam from the INSPECTED point (QA
 * S2-ADAM-2) — the warm point the inspector, ball and arrows sit at. GD has
 * no memory, so its first step is exactly the red η∇L arrow; Adam keeps its
 * warm m, v, t, so its first step is exactly the yellow Δadam arrow.
 */
export function runAdamLane(steepness: number, kind: "gd" | "adam"): Vec2[] {
  const bowl = adamBowl(steepness);
  const warm = adamWarmState(steepness);
  const opt =
    kind === "gd" ? gd(ADAM_ETA) : adam(ADAM_ETA, ADAM_B1, ADAM_B2, ADAM_EPS);
  let state: OptimizerState = kind === "gd" ? opt.initState(warm.pos) : warm;
  const e = bowl.extent;
  const m = 1.05;
  const path: Vec2[] = [{ ...warm.pos }];
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
/** Minimum spacing between LIVE §5 rebuilds while a slider drag streams
 *  (QA PERF25-SWEEP-NO-LIVE); the gate additionally backs off to 2× the
 *  measured rebuild+render cost on slow rasterizers. After the Viridis LUT
 *  + light-grid + contour-deferral cuts the live rebuild to ~6-9ms, ~34ms
 *  (2 frames) keeps up with a drag without stacking long tasks
 *  (QA PERF25-S2-REBUILD-COST-JANK). */
const LAB_LIVE_MS = 34;
/** Fixed η per optimizer — the regimes SHIFT as the sliders reshape the
 *  valley; that shifting IS the disagreement (verified numerically). */
const LAB_ETA_GD = 0.13;
const LAB_ETA_M = 0.2;
const LAB_BETA = 0.9;
const LAB_ETA_A = 0.3;
const LAB_STEPS = 220;
/** "always → Adam's step is near-invariant" lights while Adam's mean early
 *  step stays within this factor of the round bowl's (worst case over the
 *  full slider square ≈ 1.42; GD ≈ 19.7×, momentum ≈ 9×). */
const LAB_ADAM_INV_MAX = 1.6;
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

/** Mean length of the first (up to) 3 steps of a path. */
function meanEarlyStep(path: readonly Vec2[]): number {
  const n = Math.min(3, path.length - 1);
  let sum = 0;
  for (let i = 1; i <= n; i++) {
    sum += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  }
  return sum / n;
}

/** Adam's mean early step on the ROUND bowl (E = 1 is the same at every
 *  rotation) — the reference the invariance probe compares against.
 *  Memoized: one 220-step run, computed on first use (≈ 0.3896). */
let labAdamRef = 0;
export function labAdamEarlyRef(): number {
  if (labAdamRef === 0) labAdamRef = meanEarlyStep(runLabPath(labBowl(1, 0), "adam").path);
  return labAdamRef;
}

export interface LabChecks {
  /** GD across-valley zigzag flips (amplitude-filtered). */
  gdFlips: number;
  /** Momentum's first-crossing overshoot ratio (max|c| after the first
   *  zero-crossing ÷ |c₀|); > 1 = the memory swung past the valley. */
  momOvershoot: number;
  /** Adam's mean early step length relative to the round bowl, as
   *  max(r, 1/r) (~1 = near-invariant). Worst case over the full slider
   *  square ≈ 1.42 (GD ≈ 19.7×, momentum ≈ 9×), so lit < 1.6 holds
   *  everywhere — which is the point. */
  adamInvariant: number;
  /** Checklist lit states. */
  zigzag: boolean;
  overshoot: boolean;
  invariant: boolean;
}

/**
 * The three checklist probes (verified numerically at θ=30°):
 * GD flips 0→12 as E climbs (lit ≥ 3); momentum's overshoot ratio grows
 * 0.6→1.83 (lit > 1.15); Adam's mean early step length relative to the
 * round bowl stays ≈ invariant ACROSS slider settings — worst case over the
 * full slider square ≈ 1.42 (GD ≈ 19.7×, momentum ≈ 9×), so lit < 1.6
 * holds everywhere — which is the point.
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
  // Invariance ACROSS slider settings (the claim the row and the copy make):
  // Adam's mean early step here vs on the round bowl. The old max/min over
  // one run's first 3 steps measured how fast the step shrinks inside a run
  // (rotation-dependent) and went dark in a band across rot ≈ 10–80°.
  const r = meanEarlyStep(a.path) / labAdamEarlyRef();
  const adamInvariant = Math.max(r, 1 / r);

  return {
    gdFlips,
    momOvershoot,
    adamInvariant,
    zigzag: gdFlips >= 3,
    overshoot: momOvershoot > 1.15,
    invariant: adamInvariant < LAB_ADAM_INV_MAX,
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
  const st = adamWarmState(steepness);
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

/**
 * GD's true step length at the TOP of the §4 steepness slider (≈ 10.5) — the
 * log arrow map in rebuildAdamVisuals is normalized to it, so no arrow ever
 * clamps. Memoized: adamInspect warms ADAM_WARM_STEPS Adam steps per call.
 */
let ADAM_GD_MAX_LEN = 0;
function adamGdMaxLen(): number {
  if (ADAM_GD_MAX_LEN === 0) ADAM_GD_MAX_LEN = adamInspect(ADAM_STEEP_MAX).gdStepLen;
  return ADAM_GD_MAX_LEN;
}

export type EtaRegime = "crawling" | "descending" | "oscillating" | "diverging";

/**
 * GD on A = R·diag(1, 0.02)·Rᵀ from GD_START (verified numerically against
 * the actual core): the surface is f = zᵀAz, so the Hessian is 2A with
 * largest eigenvalue λmax = 2λ₁ = 2. Monotone while 1 − ηλmax > 0 (η < 0.5),
 * overshoot flips past η = 1/λmax = 0.5, divergence beyond η = 2/λmax = 1
 * (matches the §2 gloss).
 */
export function regimeOf(eta: number): EtaRegime {
  if (eta < 0.03) return "crawling";
  if (eta < 0.5) return "descending";
  if (eta <= 1.0) return "oscillating";
  return "diverging";
}

/** GD from GD_START at η, stopped when it leaves the drawn extent. */
/**
 * Clips a path to the landscape extent (QA F27-DIVERGE-PAST-EXTENT): keeps
 * in-extent points, and at the first segment that leaves the box pushes the
 * exact exit point on the boundary, then stops — later points are dropped
 * even if they wander back inside, because the trail has left the map.
 * Callers that need fewer than 2 points already skip short paths.
 */
export function clipPathToExtent(path: readonly Vec2[], e: Extent): Vec2[] {
  const inside = (p: Vec2): boolean =>
    p.x >= e.xMin && p.x <= e.xMax && p.y >= e.yMin && p.y <= e.yMax;
  const out: Vec2[] = [];
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    if (inside(p)) {
      out.push({ ...p });
      continue;
    }
    const prev = out[out.length - 1];
    if (prev && i > 0) {
      // Exit parameter of segment prev→p: the first boundary the segment
      // crosses (prev is inside, so t ∈ [0, 1] exists on every axis).
      let t = 1;
      if (p.x > e.xMax) t = Math.min(t, (e.xMax - prev.x) / (p.x - prev.x));
      else if (p.x < e.xMin) t = Math.min(t, (e.xMin - prev.x) / (p.x - prev.x));
      if (p.y > e.yMax) t = Math.min(t, (e.yMax - prev.y) / (p.y - prev.y));
      else if (p.y < e.yMin) t = Math.min(t, (e.yMin - prev.y) / (p.y - prev.y));
      t = Math.max(0, t);
      out.push({ x: prev.x + (p.x - prev.x) * t, y: prev.y + (p.y - prev.y) * t });
    }
    break;
  }
  return out;
}

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
  // Clip to the EXTENT (not the 1.05 break bound): points between 1.0× and
  // 1.05× are already off the terrain and turned the last segment into a
  // needle into empty space (QA F27-DIVERGE-PAST-EXTENT).
  return clipPathToExtent(path, e);
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
/** §7 fog-of-war stamp radius (fraction of the extent diagonal) — the §6
 *  fog game's stampFrac (fogGame.ts), so the paint idiom reads identically.
 *  A stamp fully covers one measurement cell (cellFrac 0.05 < 0.07). */
const TILT_FOG_STAMP_FRAC = 0.07;
/** Hard cap on fog stamps per run's init (the frozen curated rides carry
 *  whole path histories; beyond this the mask just reads as explored). */
const TILT_FOG_STAMP_MAX = 256;

/** The §7 fog minimap's faint snapping grid — the scorecard's measurement
 *  grid (tiltCellKey's: cellFrac·diag squares from the extent corner),
 *  expressed as the MinimapFog {nx, ny} shape. */
function tiltMinimapCells(level: TiltLevel): { nx: number; ny: number } {
  const e = level.landscape.extent;
  const w = tiltDiag(level) * level.cellFrac;
  return { nx: Math.round((e.xMax - e.xMin) / w), ny: Math.round((e.yMax - e.yMin) / w) };
}
/** A swarm ball counts as ARRIVED (panel scorecard) once its ride is this
 *  far along AND it is already inside its final basin's capture ellipse
 *  (QA S2-SWARM-SCORECARD-PRECOMPUTED-SPOILER). The frozen poster pins every
 *  ball at 0.85, so the poster still shows its clusters. */
const SWARM_ARRIVE_FRAC = 0.8;
/** Surface-following stamp decal tessellation (QA S7-SW2-RASTR-STAMPS-
 *  SHARDS): a centre fan plus RINGS rings of SEGS vertices per stamp. */
const TILT_STAMP_RINGS = 4;
const TILT_STAMP_SEGS = 20;
const TILT_STAMP_V = 1 + TILT_STAMP_RINGS * TILT_STAMP_SEGS;
const TILT_STAMP_I = 3 * (TILT_STAMP_SEGS + 2 * TILT_STAMP_SEGS * (TILT_STAMP_RINGS - 1));
/** Swarm flight choreography: staggered launches, fixed ride length. */
const SWARM_RIDE_SEC = 7;
function swarmDelay(i: number): number {
  return (i % 20) * 0.05 + Math.floor(i / 20) * 0.12;
}
/** "Run it blind": paint-disc radius (~0.66 of a measurement cell) as a
 *  fraction of the extent diagonal — the §6 fog mechanic, cell-granular. */
const SWARM_PAINT_FRAC = 0.033;
/** ?shot=fogswarm: earlier in the flight than ?shot=swarm so the terrain
 *  reads as PARTIALLY painted, corridors mid-paint. The exact ledger (QA
 *  S2-SWARM-PAINT-MISSES-CROSSED-CELLS) stamps every crossed cell, start
 *  cells at launch (p > 0): 0 cells at p=0, ~119 of the 126 ledger cells by
 *  p=0.25 (diagnosis prototype numbers), so some fog remains between the
 *  wells. */
const FOGSWARM_FROZEN_PROGRESS = 0.25;

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
  /** Keep the ball clear of the opaque HUD panels with a director-owned
   *  framing nudge (QA SW2-LW24-TASKC-POINT-UNDER-LOSSPANEL-1280 /
   *  S1-BALL-UNDER-HUD). */
  hudClear?: boolean;
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

/** The §9 parameter lattice's heart (the box is centered on the plane). */
const latticeCenter = (): Vec2 => {
  const e = leastSquares.extent;
  return { x: (e.xMin + e.xMax) / 2, y: (e.yMin + e.yMax) / 2 };
};

// §2 hides §1's fit/loss panels but the compass minimap is the PROTAGONIST
// (needle, drawn arrows, trajectory) — it stays visible throughout.
const GD_HUD = { hero: false, fit: false, loss: false, map: true, hint: false };
const MOM_HUD = GD_HUD;
const ADAM_HUD = GD_HUD;

/** Scene table — exported for main.ts's inspector-aware framing nudge. */
export const SCENES: Record<SceneName, SceneSpec> = {  hero: {
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
    // §1 directs its camera like every other section (QA
    // S2CAM-HERO-POSE-LEAKS-INTO-S1): without a cam the hero's drifting pose
    // (or the reader's orbit) leaked into the task.
    cam: { azimuth: -60, elevation: 35, zoom: 1.0 },
    hudClear: true,
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
    cam: { azimuth: -60, elevation: 35, zoom: 1.0 },
    hudClear: true,
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
    cam: { azimuth: -60, elevation: 35, zoom: 1.0 },
    hudClear: true,
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
    // pose's log-scaled arrows (white at its 14-unit cap here) stay fully in
    // frame (QA V3), valley fills the frame.
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
    hudClear: true,
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

/* ------------------------------------------------------------------ */
/* The function card's per-landscape builders (FUNC-CARD)               */
/* ------------------------------------------------------------------ */

/** The narrowest top-band interval that still hosts the chip in BAND mode
 *  (layoutFuncCard); below it the card drops below the instrument column. */
const FUNC_CARD_MIN_BAND = 200;

/** The §8 workbench benchmark landscapes (ruleLab RULE_LEVELS ids) — the
 *  card swaps with the pills; counts come from the literal feature lists,
 *  never hand-typed. */
function funcCardForLevel(
  id: RuleLevelId,
  title: string,
  values: string,
): FuncCardContent {
  switch (id) {
    case "bowl":
      return bowlCard(1, 0.02, 30, title, values);
    case "rosen":
      return rosenbrockCard(title, values);
    case "ls":
      return leastSquaresCard(title, values);
    case "archi":
      return archipelagoCard(title, ARCHIPELAGO_WELLS.length, ARCHIPELAGO_RIDGES.length, values);
    case "canyon":
      return canyonCard(title, CANYON_PEAKS.length, values);
  }
}

/** The §7 tilt levels (tiltGame TILT_LEVELS ids) — the level-complete card
 *  shows the map the run just ended on (show-after with the scorecard). */
function funcCardForTiltLevel(
  id: TiltLevelId,
  title: string,
): FuncCardContent {
  switch (id) {
    case "valley":
      // TILT_VALLEY IS defaultBowl: makeBowl(1, 0.02, π/6).
      return bowlCard(1, 0.02, 30, title);
    case "rosen":
      return rosenbrockCard(title);
    case "rastr":
      return rastriginCard(title);
    case "archi":
      return archipelagoCard(title, ARCHIPELAGO_WELLS.length, ARCHIPELAGO_RIDGES.length);
    case "canyon":
      return canyonCard(title, CANYON_PEAKS.length);
    case "swarm":
      // Unreachable as a tilt run level (the swarm is its own scene); the
      // multi-well country keeps the switch total.
      return multiWellCard(title, "6 wells · one deep global canyon");
  }
}

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

/** "1 measurement" / "N measurements". */
function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export interface DirectorElements {
  /** The canvas pane (focus-dim styling scope for hover-to-look). */
  stageWrap: HTMLElement | null;
  heroOverlay: HTMLElement | null;
  fitPanel: HTMLElement | null;
  /** The fit inset caption's action clause (QA COV22-1). */
  fitCaptionAct?: HTMLElement | null;
  /** The fog panel's how-to caption (QA COV22-1). */
  fogCaption?: HTMLElement | null;
  /** §7 tilt-b body paragraphs: a played run vs the guided demo (QA
   *  COPY2-TILTB-NORUN-ROW-HAS-DEMO-NUMBERS). */
  tiltRunLead?: HTMLElement | null;
  tiltDemoLead?: HTMLElement | null;
  tiltEmptyLead?: HTMLElement | null;
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
  /** §7 the level-pill row inside the tilt panel (the "tilt-levels" look
   *  anchors HERE, not the whole panel — U5-POINT-LEVELS). */
  tiltLevels: HTMLElement | null;
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
  /** §7 keys caption's first line — swaps to a "reader is back" notice when
   *  the run is over (QA KW-4). */
  tiltKeysMessage: HTMLElement | null;
  /** §7: per-cluster scorecard rows (one per occupied well). */
  tiltSwarmClusters: HTMLElement | null;
  /** §7 swarm dock (mounted on the VISUALIZER, bottom-left): the landscape
   *  picker pills, the "run blind / show map" toggle and the replay+scrub
   *  transport — the finale's controls live on the canvas pane, never in
   *  the reader text (user feedback 2026-11-13). */
  swarmDock: HTMLElement | null;
  /** §5 lab dock (the same visualizer pattern — COPY-PLAN §2.10): the
   *  λ₁/λ₂ + rotation sliders and the regime checklist, on stage for BOTH
   *  lab reader pages (the copy says "the dock (bottom-left)"). */
  labDock: HTMLElement | null;
  swarmMapButtons: HTMLButtonElement[];
  swarmReplayBtn: HTMLButtonElement | null;
  swarmRestartBtn: HTMLButtonElement | null;
  swarmScrub: HTMLInputElement | null;
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
  /** The function card (FUNC-CARD): the docked formula chip — the current
   *  landscape's function with its live parameters. The card element rides
   *  the .hud data-visible machinery; the three inner rows carry the
   *  content built by view/functionCard.ts. */
  funcCard: HTMLElement | null;
  funcCardTitle: HTMLElement | null;
  funcCardMath: HTMLElement | null;
  funcCardVals: HTMLElement | null;
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
  private swap: {
    to: SceneSpec;
    stage: "out" | "in";
    /** Terrain opacity when the crossfade started (fade normalisation). */
    fromOpac: number;
  } | null = null;
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
  /** Monotonic count of committed gd-b arrow draws (onArrowCommit's gd-b
   *  branch — pointer-up of a real gesture). The tour's arrowDrawn gate
   *  keys to this, not userTip: onArrowPreview fires at pointerDOWN, so a
   *  bare press satisfied the gate mid-gesture (TOUR QA
   *  S2-TOUR-GATE-KEYED-TO-PRESS). */
  arrowCommits = 0;
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
  /** A slider moved: the frame loop rebuilds live under the PERF25 throttle
   *  (≤1 per max(130ms, 2× last cost)) plus a guaranteed trailing rebuild at
   *  180ms input-idle. */
  private pendingLab = false;
  /** Overlay builds deferred until the relief settles (QA
   *  F27-OVERLAYS-BURIED): set by same-family setScene when the rise moves. */
  private overlaysPending = false;
  /** The lab's shared start (extent-dependent, recomputed per rebuild). */
  private labPoint: Vec2 = { x: -2.2, y: 2.2 };

  /* ---------------- §6 state — the fog game ---------------- */
  private fogLevel: FogLevel | null = null;
  private fogSt: FogState | null = null;
  /** In-flight step: the ball walks from→to over ~0.7 s, fog stamping as it
   *  rolls; the measurement is spent at commit, revealed at arrival. */
  private fogAnim: { from: Vec2; to: Vec2; t: number } | null = null;
  private fogStampFrom: Vec2 | null = null; // last stamped position
  /** A commit made MID-WALK waits here (latest real drag wins) and replays
   *  from the landing point B once the stride lands — cutting the walk short
   *  orphaned the unpainted corridor and teleported the ball (QA SEC6-F2).
   *  The gesture travels with the tip: a queued tap must still be rejectable
   *  at replay time (QA SEC6-F1 round 2). */
  private fogQueued: { tip: Vec2; travelPx: number } | null = null;
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
  /** QA F16-FOGC-FILL-PEG round 2: a cross-family entry into fog-c builds
   *  its ghost race only after the landscape crossfade (~2.4 s), while the
   *  edge fill runs on entry motion alone. This flag marks that deferred
   *  window so animProgress caps it at FOGC_ENTRY_SHARE, and fogRaceBase
   *  maps the race clock into the remaining 75% of the bar. */
  private fogRaceDeferred = false;
  private fogRaceBase = 0;
  /** One-shot latch: a live ghost race owes its final forced transport sync
   *  (see the tick's finish branch). True when nothing is pending. */
  private ghostFinishSynced = true;
  /** Elapsed ghost-cinematic wall clock (drives the transport scrub/progress). */
  private ghostClock = 0;
  /** Hover-to-look pause: the transport ❚❚ freezes the ghost cinematic; a
   *  paused cinematic must NOT hold the reader lock (never fight the lock). */
  private ghostsPaused = false;
  /** Whether the fog mask for the CURRENT built terrain has been reset and
   *  stamped with the start patch. */
  private fogMaskReady = false;
  /** HUD-rect cache for the reveal-note safety net (invalidated on resize). */
  private fogObstacleCache: Array<{ l: number; t: number; r: number; b: number }> | null = null;
  /** Viewport signature the nudge was computed for ("WxH"). */
  private fogNudgeViewport = "";
  /** The reader's last level-2 run that spent a measurement, kept across
   *  leaving §6 (QA S2-FOG-RUN-LOST-ON-RETURN). */
  private fogRbResult: FogState | null = null;
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
  private tiltStamps: THREE.Mesh | null = null;
  private tiltStampKeys = new Set<string>();
  /** Stamps written into the preallocated decal buffer. */
  private tiltStampCount = 0;
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
  /** FIX (user bug — the reveal raced LINES only): each machine lane rolls a
   *  BALL along its replayed path during the scorecard/replay (§6's
   *  ghost-ball approach — identity colors, contact shadows in
   *  updateShadows), positioned per scrub fraction in applyTiltGhost. */
  private tiltMachineBalls: Array<{
    ball: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
    path: Vec2[];
  }> = [];
  /** The machine balls' current parameter-space positions (applyTiltGhost;
   *  updateShadows grounds one contact shadow per ball). */
  private tiltMachinePos: Vec2[] = [];
  /** Scrub state: 0..1 along the recorded ghost path. */
  private tiltScrub = 1;
  private tiltScrubPlaying = false;
  private tiltScrubClock = 0;
  /** §7 fog of war (run-scoped): the tilt board starts DARK and paints in
   *  along the ball's path — the §6 mask machinery, reused per attempt.
   *  LAYERS OVER the teal measurement stamps: the stamps keep drawing (they
   *  are the scorecard's cells record); the fog lives beneath them on the
   *  terrain material, and since a stamp only appears where the ball rolled,
   *  every decal sits inside already-revealed ground. Armed on every fresh
   *  run (scene entry, level swap, restart), lifted at the run's end
   *  (settle / Finish — the reveal), torn down on tilt-b, the swarm and
   *  every scene exit (armTiltFog / initTiltFogMaskIfNeeded /
   *  stampTiltFogTo / liftTiltFog / teardownTiltFog). */
  private tiltFogArmed = false;
  /** The mask is initialized on the CURRENT tilt terrain (a crossfade's
   * incoming terrain does not exist at arm time — F26 pattern). */
  private tiltFogReady = false;
  /** Last fog-stamped point (paint-on-roll continues from it). */
  private tiltFogFrom: Vec2 | null = null;
  /** Fog stamps spent this run (diagnostics; reset with the fog). */
  private tiltFogStamps = 0;
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
    /** Distinct cells across the whole ledger — the blind map's true total
     *  (the live painted count ends exactly here). */
    paintTotal: number;
    /** How many ledger entries each ball has stamped so far. */
    paintedIdx: number[];
    /** Per-ball "has arrived on screen" (QA S2-SWARM-SCORECARD-PRECOMPUTED-
     *  SPOILER): the panel counts only balls the reader has seen land. */
    arrived: Uint8Array;
    arrivedCount: number;
  } | null = null;
  /** Last swarm panel signature (arrivals · painted · playing): the tick
   *  re-syncs the panel only when it changes. */
  private swarmPanelSig = "";
  /** Director-owned HUD-clear framing nudge for non-fog scenes (task-a/b/c,
   *  tilt-a, swarm): target + eased applied value, pushed through the
   *  view's reveal-nudge channel (fog owns that channel in §6). */
  private hudNudgeTarget = { x: 0, y: 0 };
  private hudNudgeApplied = { x: 0, y: 0 };
  /** Recompute the ball-clear nudge once the scene is settled. */
  private hudNudgeDirty = true;
  private hudNudgeViewport = "";
  /** Swarm canyon framing signature (viewport · attitude · panel height). */
  private swarmNudgeSig = "";
  /** The reader expanded a collapsed swarm cluster list (until the
   *  viewport changes). */
  private swarmClustersExpanded = false;
  /** The frame's dt (onFrame), for frame-locked eases outside tweens. */
  private lastDt = 1 / 60;
  /** Distinct cells painted in the current blind run (cross-ball dedup —
   *  many balls cross the same cells; the map counts each once). */
  private readonly swarmPaintedKeys = new Set<string>();
  private readonly swarmDummy = new THREE.Object3D();
  private swarmDrawPos: Vec2[] = [];
  /** "Run it blind": the terrain hides (§6's fog mask) and the swarm paints
   *  every cell it crosses. Default ON (user feedback 2026-11-13): the swarm
   *  now ENTERS fogged — the reveal is the reader's choice, on the dock's
   *  "run blind / show map" toggle (the §6 mechanic carried into the finale). */
  private swarmBlind = true;
  /** Cells painted so far in the current blind run (live readout). */
  private swarmPainted = 0;
  /** Frozen pose override for ?shot=fogswarm (earlier in the flight, so the
   *  terrain reads as PARTIALLY painted). */
  private swarmPoseProgress: number | null = null;
  /** The picked swarm map (the dock's landscape pills). */
  private swarmMapId: SwarmMapId = "multi-well";
  /** Which swarm map's terrain is currently BUILT (setLandscape is costly —
   *  the pills swap it in place, exactly like the tilt/rule levels). */
  private builtSwarmMap: SwarmMapId | null = null;

  /* ---------------- §8 state — the optimizer workbench ---------------- */
  /** The landscape the benchmark currently runs on (Rosenbrock curated:
   *  the pose where the assembled rule BEATS Adam — the ?shot=labrule hook). */
  private ruleLevel: RuleLevelId = "rosen";
  /** The four parts, as the sliders assemble them. */
  private ruleCfg: CustomRuleConfig = { ...RULE_CONFIG_DEFAULT };
  /** The last computed four-way benchmark (drives trails + scorecards). */
  private ruleRuns: RuleBenchmark | null = null;
  /** What triggered the most recent real benchmark change (pill or part) —
   *  the verdict names the right cause (QA S8-VERDICT-WRONG-CAUSE). */
  private ruleLastChange: RuleChangeCause = null;
  /** Whether the custom rule was winning just BEFORE that change ("flips"
   *  is only true when a win turned into a loss). */
  private rulePrevCustomWon = false;
  /** The last rendered verdict, keyed by landscape + RAW config (full-
   *  precision η/β/clip via ruleVerdictKey, not the rounded label — QA
   *  S8-SWEEP2-STALE-VERDICT) (QA S8-FLIP-FALSEFLIP): an identical re-render
   *  (scene re-entry, coalesced rebuild) returns the cached text, so a
   *  verdict can never drift or re-word without a real level/part change. */
  private ruleVerdictPrev: { level: RuleLevelId; cfgKey: string; text: string } | null = null;
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

  /* ---------------- the function card (FUNC-CARD) ---------------- */
  /** Last rendered card signature ("v|title|math|values"): the sync runs
   *  from per-frame fog/tilt tick paths and per-input slider setters, so
   *  every write is guarded on change. */
  private funcCardSig: string | null = null;
  /** Last layout signature the visible card was positioned for (FUNC-CARD):
   *  viewport + the measured free band — the per-frame layout call is one
   *  string compare when nothing moved. */
  private funcCardLayoutSig = "";

  /* ---------------- universal play system (WP-A2) ---------------- */
  /** Floating arrow-tip positions that need contact shadows. */
  private adamArrowTips: Vec2[] = [];
  private replay: {
    player: TrajectoryPlayer;
    /** The shared step clock: the longest lane's step count. Timeline p maps
     *  to step s = p·maxSteps on EVERY lane (QA SEC5-S2-REPLAY-TRAIL-LEAD /
     *  S8SW2-RACE-SIMULTANEOUS-ARRIVAL). */
    maxSteps: number;
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
  /** performance.now() of the last §5 live rebuild (the PERF25 throttle). */
  private lastLabRebuildAt = 0;

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
    this.fogRaceDeferred = false; // re-armed at the end of the entry path
    // Ball-clear framing re-measures once the new scene settles.
    this.hudNudgeDirty = true;
    if (!spec.hudClear && !spec.swarm) this.hudNudgeTarget = { x: 0, y: 0 };
    const cam = this.sceneCam(name, spec);

    // Double-click reset target (QA CAM-DBLCLICK-SCENE-DEFAULT): registered
    // from the SPEC here, not from camTarget — the double-click's own
    // pointerdown cancels camera tweens (onUserOrbitStart), nulling
    // camTarget, so a reset during a flight still needs the spec value. The
    // zoom rides along as a MULTIPLIER over the live fit (the fit is stale
    // at setScene time — the incoming landscape has not reframed yet), so a
    // double-click restores the scene's standard distance too (QA B-3-0).
    this.view.setResetAttitude(
      cam
        ? { azimuthDeg: cam.azimuth, elevationDeg: cam.elevation, zoomMul: cam.zoom }
        : null,
    );
    this.view.setAutoOrbit(this.frozen ? 0 : spec.orbitDegPerSec);
    this.applyHud(spec);
    // Framing drop: the hero's race drop and the tilt scenes' HUD clearance
    // (same-landscape transitions too).
    this.view.setFrameOffsetY(this.frameDropFor(spec));
    // The hero zooms out to fit the docked pane (QA S2-HERO-RACE-CLIPPED-NARROW).
    this.view.setPaneFit(spec.race === true);
    // A landscape crossfade retires the outgoing overlays BEFORE the clears
    // below: enterSceneState's dispose calls then leave the retired objects
    // in place (removeOverlayObject), and the ball/trails/shadows fade out
    // with the terrain until flushRetired disposes them (QA
    // F26-CROSSFADE-BALL-CUT / S2B26-RETIRED-REMOVE-CUTS).
    const crossfade =
      !instant && this.built !== null && this.built !== spec.landscape;
    if (crossfade) this.view.retireOverlays();
    // Same-landscape transitions skip the rebuild: register the destination
    // attitude and re-measure the fit there, so the camera tween below
    // targets a deterministic fit (QA LW24-ADAM-BALL-UNDER-PANEL-1280).
    if (this.built === spec.landscape) {
      this.view.setFrameAttitude(
        cam ? cam.azimuth : null,
        cam ? cam.elevation : null,
      );
      this.view.reframe();
    }
    // Any scene change invalidates §2's step arrows/trajectory unless it is
    // a §2 scene re-entering (enterSceneState below re-lays them out).
    this.enterSceneState(name, instant);
    // FUNC-CARD: enterSceneState curates the scene's LIVE parameters (the
    // adam-b steepness pin, the lab's defaults) AFTER applyHud ran — re-sync
    // here so the card never reads the previous scene's stale values (QA'd
    // by probe: ?step=11 → ?step=12 landed λ₁ = 1.00 before this line).
    this.syncFuncCard();
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
      this.view.flushRetired();
      this.view.setOverlayFade(1);
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
      if (cam) {
        // Fit-based (QA F-2/cam-1): rebuildNow above reframed the incoming
        // landscape, so fitZoom is its own — framing is arrival-independent.
        this.view.setAttitude(
          cam.azimuth,
          cam.elevation,
          this.view.fitZoom * cam.zoom,
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
      this.overlaysPending = false; // instant path built at spec.rise
      this.refreshGdVisuals();
      this.updateDependents();
      this.view.requestRender();
      return;
    }

    if (cam) this.tweenCamera(cam);

    if (this.built !== spec.landscape) {
      if (!this.built) {
        // First build ever: snap the presentation values BEFORE building
        // overlays, so they bake at the final relief (QA F27-OVERLAYS-BURIED).
        this.rebuildNow(spec);
        this.values.set("rise", spec.rise);
        this.values.set("opac", spec.opac);
        this.view.setTerrainRise(spec.rise);
        this.view.setTerrainOpacity(spec.opac);
        this.refreshGdVisuals();
      } else {
        // Crossfade: sink + fade what's on stage, then rebuild and rise.
        // The swap record's fromOpac normalises the overlay fade (the fade
        // must reach 1 even on steps whose resting opac < 1).
        this.swap = { to: spec, stage: "out", fromOpac: Math.max(1e-3, this.val("opac")) };
        this.tween("opac", 0, 0.55);
        this.tween("rise", 0, 0.55);
      }
    } else {
      // Same-family transition: any pending crossfade state must go (it can
      // be left over from aSkip mid-fade — a pre-existing hazard, QA
      // F26-CROSSFADE-BALL-CUT), and the retired copies are at opacity 0.
      this.swap = null;
      this.view.flushRetired();
      this.view.setOverlayFade(1);
      // When the relief is about to MOVE (a leftover swap, or a real rise
      // change like epi-b 0.04 → 1), defer overlay builds until the rise
      // settles — otherwise refreshGdVisuals bakes them flat at the current
      // rise and the risen terrain buries them (QA F27-OVERLAYS-BURIED).
      const riseMoves =
        Math.abs(this.val("rise") - spec.rise) > 0.01;
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
      if (riseMoves) {
        this.overlaysPending = true; // built at settled rise (onFrame)
      } else {
        this.refreshGdVisuals();
      }
    }
    // A cross-family fog-c entry (deep link, rail jump) builds its ghost race
    // only after the landscape crossfade — mark the deferred window so the
    // edge fill is capped and the race fills the rest (QA F16-FOGC-FILL-PEG
    // round 2). Same-family/wheel entries build the race synchronously and
    // keep the round-1 behaviour.
    this.fogRaceDeferred =
      name === "fog-c" && !this.frozen && !instant && this.fogGhosts === null;
    this.updateDependents();
    this.view.requestRender();
  }

  /**
   * Normalised overlay fade for the current crossfade stage: 1 when no swap
   * is in flight, opac/fromOpac while fading OUT (the outgoing stage's own
   * resting opacity may be < 1), opac/to.opac while fading IN — so incoming
   * overlays reach FULL strength even on steps whose resting opac is 0.14 or
   * 0.5 (QA F26-CROSSFADE-BALL-CUT).
   */
  private overlayFadeK(): number {
    if (!this.swap) return 1;
    const opac = this.val("opac");
    const k =
      this.swap.stage === "out"
        ? opac / this.swap.fromOpac
        : opac / Math.max(1e-3, this.swap.to.opac);
    return clamp(k, 0, 1);
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
    // Deferred fog-c entry (QA F16-FOGC-FILL-PEG round 2): before the ghost
    // race exists, the entry motion fills at most FOGC_ENTRY_SHARE of the
    // bar — the ratchet then hands off to the race, which fills the rest.
    if (this.fogRaceDeferred && this.fogGhosts === null) {
      p *= FOGC_ENTRY_SHARE;
    }
    // The fog-c ghost race IS the lock-spanning motion: while it plays, its
    // OWN clock decides the fill (taking precedence over the tweens, whose
    // own completion would jump the bar to 100% within ~1.5s of a ~7s lock;
    // the old delay-derived term pegged it at 100% from the first frame).
    // On a deferred entry the race fills from the entry share to 100%.
    if (this.fogGhosts && this.fogGhostTotal > 0 && this.fogGhostsPlaying()) {
      const r = Math.min(1, this.ghostClock / this.fogGhostTotal);
      p = this.fogRaceBase + (1 - this.fogRaceBase) * r;
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
      // The retired (fade-out) copies are at opacity 0 by now — dispose them.
      this.view.flushRetired();
      this.view.setOverlayFade(1);
      if (this.built !== target.landscape || !this.built) {
        this.rebuildNow(target);
      }
      // Out-stage skip (QA S2-SKIP-CROSSFADE-BLANK / S2B26-SKIP-DURING-
      // FADEOUT-VOID): rebuildNow zeroed rise/opac and the out tweens
      // targeted 0, and the 'in' tweens are only created at onFrame's
      // out→in hand-off — land on the incoming scene's resting presentation
      // here, as the instant path does. In the 'in' stage these equal the
      // snapped tween targets already.
      this.values.set("rise", target.rise);
      this.values.set("opac", target.opac);
      if (target.fit) {
        this.values.set("fw", target.fit.x);
        this.values.set("fb", target.fit.y);
      }
      // Same cosmetic onFrame does at the out→in hand-off.
      if (target.landscape === "adam" && this.adamS !== null) {
        this.adamPoint = adamInspect(this.adamS).point;
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
    this.view.setOverlayFade(1); // skip resolved: everything at full strength
    if (spec.fit) this.fit = { x: this.val("fw"), y: this.val("fb") };

    // gd-b's step arrow: jump to full.
    if (this.gdTipFull && this.gdAnimT < 1) {
      this.gdAnimT = 1;
      this.updateGdArrows(1);
    }

    // §6: the walking step lands instantly (fog stamped to the endpoint).
    if (this.fogAnim && this.fogLevel && this.fogSt) {
      this.landFogWalk();
      this.fogQueued = null; // a skipped run drops any queued commit
      if (this.fogSt.done) this.spawnFogMarker();
    }

    // §6 reveal ghosts: every lane lands at its end at once.
    if (this.fogGhosts) this.finishFogGhostsNow();

    // A queued lab rebuild runs now.
    if (this.pendingLab && this.built === "lab") {
      this.pendingLab = false;
      const fn = labBowl(this.labE ?? LAB_E_DEFAULT, this.labRot ?? LAB_ROT_DEFAULT);
      this.view.setLandscape(fn, { gridN: 64, keepCamera: true });
      this.minimap.setLandscape(fn);
      this.rebuildLabVisuals();
    }

    // A queued §4 steepness rebuild runs now (same Skip contract as §5).
    if (this.pendingAdam && this.built === "adam") {
      this.pendingAdam = false;
      const s = this.adamS ?? ADAM_STEEP_MIN;
      if (this.builtAdamS !== s) {
        const fn = adamBowl(s);
        this.view.setLandscape(fn, { keepCamera: true });
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
    // §3 markers: a skip finishes their fade. This must run AFTER
    // refreshGdVisuals — it rebuilds the mom visuals (markers included at
    // full brightness), so clearing first would draw them straight back.
    // Hide, never dispose: the mom-apexes look span relights this group
    // (applyLook momApex) — disposal left the span dead until the β slider
    // rebuilt the markers (QA MOM-APEX-RELIGHT-AFTER-SKIP). Same end state as
    // the natural fade.
    if (this.momHighlight && !this.frozen && !this.momApexLookActive()) {
      this.momHighlightT = 0;
      if (this.momHighlightMat) this.momHighlightMat.opacity = 0;
      this.momHighlight.visible = false;
    }
    // Deferred fog-c entry (QA S2-SKIP-FOGC-RACE-NOT-SKIPPED): the ghost race
    // did not exist at the check above — refreshGdVisuals may have just
    // built it LIVE. Land it at its end now, or it plays the full ~6.6 s
    // race with the reader lock held.
    if (this.fogGhosts) this.finishFogGhostsNow();
    this.overlaysPending = false; // the skip built everything at settled rise
    this.updateDependents();
    // A reveal-nudge tween created DURING the skip (updateFogDependents'
    // first built frame on a deferred fog-c entry) lands now too, or it held
    // the reader lock ~0.9s after Skip (QA S2-SKIP-FOGC-RACE-NOT-SKIPPED).
    for (const key of ["fognx", "fogny"]) {
      const tw = this.tweens.get(key);
      if (tw) {
        this.values.set(key, tw.to);
        this.tweens.delete(key);
      }
    }
    if (this.scene.startsWith("fog")) this.view.setRevealNudge(this.val("fognx"), this.val("fogny"));
    // Ball-clear framing lands with the skip (snap).
    if (spec.hudClear && !this.scene.startsWith("fog")) {
      this.hudNudgeDirty = false;
      this.computeHudClearNudge();
      this.hudNudgeApplied = { ...this.hudNudgeTarget };
      this.view.setRevealNudge(this.hudNudgeApplied.x, this.hudNudgeApplied.y);
    }
    this.view.requestRender();
  }

  /* ---------------- per-frame ---------------- */

  onFrame(dt: number): void {
    this.lastDt = dt;
    let changed = this.advanceTweens(dt);

    if (this.swap) {
      if (this.swap.stage === "out") {
        if (this.val("opac") <= 0.002 && this.val("rise") <= 0.002) {
          const spec = this.swap.to;
          this.swap = { to: spec, stage: "in", fromOpac: this.swap.fromOpac };
          this.rebuildNow(spec);
          // NOTE: no refreshGdVisuals here — building overlays now would
          // bake them flat at rise 0 and the risen terrain would bury them
          // (QA F27-OVERLAYS-BURIED / F26-ADAM-ARROW-FLAT). They are built
          // at settled rise in the swap-end branch below.
          // Adam cosmetic: park the ball at the scene's inspected point so
          // it doesn't jump when the deferred rebuild lands (its readouts
          // would otherwise show the ADAM_POINT default until then).
          if (spec.landscape === "adam" && this.adamS !== null) {
            this.adamPoint = adamInspect(this.adamS).point;
          }
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
        // The relief has settled: NOW build the overlays, so every baked
        // position hugs the risen surface (QA F27-OVERLAYS-BURIED). The
        // retired fade-out copies were flushed at rebuildNow.
        this.swap = null;
        this.view.setTerrainRise(this.val("rise"));
        this.refreshGdVisuals();
        this.updateDependents();
        this.view.requestRender();
      }
      changed = true;
    }

    // Deferred overlays from a same-family rise move (setScene): same rule.
    if (this.overlaysPending && !this.swap && this.atTarget("rise")) {
      this.overlaysPending = false;
      this.refreshGdVisuals();
      this.updateDependents();
      changed = true;
    }

    const spec = SCENES[this.scene];
    // Tilt framing drop follows resizes (no-op when unchanged).
    if (spec.tilt) this.view.setFrameOffsetY(this.frameDropFor(spec));
    if (this.hudNudgeUpkeep(spec)) changed = true;
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
        this.landFogWalk();
        if (this.fogLevel && this.fogSt) {
          if (this.fogSt.done) {
            this.fogQueued = null; // the run is over — drop any queue
            this.finishFogRun();
          } else if (this.fogQueued) {
            // Replay the mid-walk commit from the landing point B, with its
            // ORIGINAL gesture (QA SEC6-F1 round 2) so the tap/slop and
            // min-step checks run on the real travel distance.
            const q = this.fogQueued;
            this.fogQueued = null;
            this.fogCommitStep(q.tip, { travelPx: q.travelPx });
          } else {
            this.fogQueued = null;
          }
        }
      }
      changed = true;
    }

    // §3: overshoot apex markers burn bright, then fade (frozen poses hold;
    // scene-entry motion and an active mom-apexes hover hold the decay so
    // the burn-bright phase is actually seen — rebuildMomVisuals builds the
    // markers while the terrain is still rising in, and hover-to-look must
    // be able to relight them).
    if (
      this.momHighlight && !this.frozen && this.momHighlightT > 0 &&
      !this.animating && !this.momApexLookActive()
    ) {
      this.momHighlightT = Math.max(0, this.momHighlightT - dt / 1.8);
      if (this.momHighlightMat) {
        this.momHighlightMat.opacity = 0.9 * this.momHighlightT;
      }
      if (this.momHighlightT <= 0) {
        // Hide instead of disposing: the mom-apexes look span relights this
        // group (visible = true, opacity reset) for as long as it is held.
        if (this.momHighlight) this.momHighlight.visible = false;
      }
      changed = true;
    }

    // §2/§4/§5: the universal player rolls balls along the replay lanes.
    // ❚❚ (replayPaused) freezes the roll; the scrub bar owns the pose then.
    if (this.replay) {
      const p = this.replayPaused ? null : this.replay.player.update(dt);
      if (p !== null) {
        for (const lane of this.replay.lanes) {
          const { pos, s } = this.replayLanePose(lane.path, p);
          this.view.parameterToWorld(
            pos,
            this.view.trailLift + this.view.diagonal * 0.016,
            lane.ball.position,
          );
          // playReplay builds the balls hidden (no flash at the path start
          // before the first frame); show them once the ride has begun — the
          // same `> 0` rule setReplayScrub uses (QA transport-ball-invisible:
          // balls only ever appeared after a scrub).
          lane.ball.visible = p > 0;
          lane.trail.setStep(s);
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
            // Step-paced like the universal replay (QA
            // SEC5-S2-REPLAY-TRAIL-LEAD): ball and trail share one step.
            const sl = p * Math.max(0, lane.path.length - 1);
            const pos = samplePathAtStep(lane.path, sl);
            this.view.parameterToWorld(
              pos,
              this.view.trailLift + this.view.diagonal * 0.016,
              lane.ball.position,
            );
            lane.trail.setStep(sl);
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
        if (!this.fogGhostsPlaying()) {
          // The race drained on THIS frame: snap the clock to the end before
          // the sync, so the very first idle state already reads a full bar
          // and '▶ Play' (the last lane can finish a frame short of the
          // total — QA transport-finished-label-resume).
          this.ghostClock = this.fogGhostTotal;
          this.ghostFinishSynced = true;
          this.syncTransport();
        }
        this.view.requestRender();
      } else if (
        !this.ghostFinishSynced &&
        this.fogGhostTotal > 0 &&
        !this.fogGhostsPlaying()
      ) {
        // One-shot drain sync. The race can drain with the clock a frame
        // SHORT of the total (a delayed lane gets a full dt·speed on its
        // launch frame) or saturate a frame AFTER the last lane ended — either
        // way that frame moves nothing, so the bar stuck at its last
        // throttled write (998 at 0.5×) and the label on '▶ Resume'. This
        // block only runs when !ghostsPaused, so "not playing" here means the
        // race is over: snap the clock to the end and sync once (QA
        // fog-reveal-3 / transport-finished-label-resume).
        this.ghostFinishSynced = true;
        this.ghostClock = this.fogGhostTotal;
        this.syncTransport();
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
        // Live stamp flush: run.cells grows during play, but the discs were
        // only (re)built on scene entry/reset — the cell count outran the
        // disc count all run long (QA S7-1). ensureTiltStamps is a no-op
        // once the mesh exists; the rebuild only touches NEW cell keys.
        if (this.tiltRun.cells.length !== this.tiltStampKeys.size) {
          this.ensureTiltStamps();
          this.rebuildTiltStamps();
        }
        // Fog of war paints in along the covered path (§6's mechanic, live):
        // the mask init is idempotent (it lands at the rebuild on crossfade
        // entries), then each frame stamps the segment the ball covered.
        this.initTiltFogMaskIfNeeded();
        this.stampTiltFogTo(this.tiltRun.pos);
        changed = true;
      }
    }

    // §7 reveal: the ghost ride plays through the recorded states.
    if (this.scene === "tilt-b" && this.tiltScrubPlaying && !this.frozen) {
      // The ghost ride honours the transport speed (QA TP2-TILT-NO-SPEED);
      // ghostDuration stays nominal, so only the tick scales.
      this.tiltScrubClock += dt * this.replaySpeed;
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
      // The panel builds up as balls arrive / cells paint (QA S2-SWARM-
      // SCORECARD-PRECOMPUTED-SPOILER): re-sync only on a real change —
      // syncTiltPanel rebuilds the cluster list.
      const sig = `${this.swarm.arrivedCount}|${this.swarmPainted}|${this.swarm.playing}`;
      if (sig !== this.swarmPanelSig) {
        this.swarmPanelSig = sig;
        this.syncTiltPanel();
      }
      changed = true;
    }

    // §5: slider drags rebuild LIVE under a throttle — at most one rebuild
    // per max(LAB_LIVE_MS, 2× the last rebuild's measured cost, so long
    // software-raster tasks back off automatically) while input streams, plus
    // a guaranteed trailing rebuild ~180ms after the last input with the
    // final values (QA PERF-1 round 2; QA PERF25-SWEEP-NO-LIVE: the pure
    // idle-debounce version drew NOTHING during a continuous drag — 0.1
    // renders/s — because nothing set `changed` until the pointer went idle).
    if (this.pendingLab && this.built === "lab" && !this.swap) {
      const now = performance.now();
      const idle = now - this.lastLabInputAt >= 180;
      // PERF25-S2-LAB-REBUILD-LONGTASKS: back off on the whole frame cost —
      // rebuild (labRebuildMs) + render (renderCostMs) — not just the
      // rebuild, since under software raster the render dominates.
      const throttleDue =
        now - this.lastLabRebuildAt >=
        Math.max(LAB_LIVE_MS, 2 * (this.labRebuildMs + this.view.renderCostMs));
      if (idle || throttleDue) {
        // PERF25-S2-REBUILD-COST-JANK: a LIVE rebuild keeps pendingLab set —
        // the cadence can otherwise consume the final input's flag non-idle
        // (throttleDue fires every ~34ms while idle needs 180ms), and the
        // guaranteed trailing idle rebuild — the one that restores the full
        // 64-grid + minimap contours — would never run (caught by
        // diag-s2-lab-contours-defer).
        this.pendingLab = !idle;
        const t0 = performance.now();
        const fn = labBowl(this.labE ?? LAB_E_DEFAULT, this.labRot ?? LAB_ROT_DEFAULT);
        // QA PERF25-S2-REBUILD-COST-JANK: during a streamed drag rebuild at
        // the lighter grid and skip the minimap's d3-contour pass (the
        // extent frame + ticks stay live); the guaranteed trailing idle
        // rebuild here restores full grid + contours.
        this.view.setLandscape(fn, { gridN: idle ? 64 : 48, keepCamera: true });
        this.minimap.setLandscape(fn, { contours: idle });
        this.rebuildLabVisuals();
        this.updateDependents();
        this.labRebuildMs = performance.now() - t0;
        this.lastLabRebuildAt = performance.now();
        changed = true;
        if (!idle) {
          // PERF25-S2-LAB-REBUILD-LONGTASKS: input still streaming — keep
          // the cheap tier armed for the next live rebuild (setLab's timer
          // alone would release it mid-drag; clearReplayVisuals and the
          // trailing idle rebuild both land after it expires).
          this.view.setMotionTier(true);
          clearTimeout(this.labTierTimer);
          this.labTierTimer = window.setTimeout(() => {
            this.view.setMotionTier(false);
          }, 250);
        }
      }
    }

    // §4: steepness moves coalesce the same way (terrain + inspector, one
    // rebuild per frame). The camera is preserved by keepCamera — the zoom
    // and pan stay relative to the fit (QA S2CAM-SLIDER-REFRAME-STOMPS-
    // ZOOM-PAN): a plain reframe reset them and dropped the scene's zoom.
    if (this.pendingAdam && this.built === "adam" && !this.swap) {
      this.pendingAdam = false;
      const s = this.adamS ?? ADAM_STEEP_MIN;
      if (this.builtAdamS !== s) {
        const fn = adamBowl(s);
        this.view.setLandscape(fn, { keepCamera: true });
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
    // §6: the reveal note tracks the camera even when the DIRECTOR is idle —
    // an orbit, inertial glide, wheel/pinch zoom or resize changes the pose
    // inside LandscapeView without setting `changed` (QA fog-reveal-2). Same
    // built-guard as updateFogDependents' crossfade check.
    if (
      this.scene.startsWith("fog") &&
      this.fogSt?.done &&
      this.fogLevel &&
      this.built === (this.fogLevel.id === "ls" ? "fog-ls" : "fog-rb")
    ) {
      this.positionFogNote();
    }

    // FUNC-CARD: the chip's band layout follows resizes and the CSS re-dock
    // tiers even when nothing else changed (sig-guarded — an idle frame
    // costs one string compare).
    this.layoutFuncCard();

    // Hover-to-look: a spotlight over a MOVING target (the drifting ball,
    // the swinging needle's base point) tracks it every frame.
    if (this.lookPointFn) {
      const p = this.lookPointFn();
      if (p) this.view.moveSpotlight(p);
    }

    if (changed) {
      this.view.setTerrainRise(this.val("rise"));
      this.view.setTerrainOpacity(this.val("opac"));
      // Overlays (ball/trails/shadows) fade with the same tween, normalised
      // so they reach full strength even on steps whose resting opac < 1
      // (QA F26-CROSSFADE-BALL-CUT).
      this.view.setOverlayFade(this.overlayFadeK());
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
    // Only §1 owns the fit: fog-a shows the inset read-only (QA COV22-1).
    if (!this.scene.startsWith("task")) return;
    this.tweens.delete("fw");
    this.tweens.delete("fb");
    const e = leastSquares.extent;
    this.fit = { x: clamp(w, e.xMin, e.xMax), y: clamp(b, e.yMin, e.yMax) };
    // fw/fb are the single source of truth for every reader (onFrame's
    // changed branch, the skip path, the next tweenFit's `from`): a stale
    // mid-tween value overwrote the drag every frame and the next advance
    // snapped back to it (QA S1-DRAG-VS-TWEEN / S1-ADVANCE-SNAP).
    this.values.set("fw", this.fit.x);
    this.values.set("fb", this.fit.y);
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

  /**
   * Screen anchor of a lookRegistry target for the guided tour's pointing
   * overlay. Mirrors applyLook's availability guards: where the spotlight
   * would no-op (target not on stage) there is no anchor either — the same
   * never-invents-a-target rule as hover-to-look. Panels anchor at their
   * HUD rect; scene targets project through the live camera (call per
   * frame — moving targets re-anchor as the camera and the point move).
   */
  lookScreenPoint(key: string): { x: number; y: number } | null {
    const entry = LOOK_TARGETS[key];
    if (!entry) return null;
    const t: LookTarget = entry.target;
    const panelPoint = (id: PanelId): { x: number; y: number } | null => {
      const el = this.panelEl(id);
      if (!el || el.dataset.visible !== "true") return null;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return null;
      return { x: r.left + r.width * 0.42, y: r.top + r.height / 2 };
    };
    switch (t.kind) {
      case "panel": {
        // TOUR-POINT-S8-PILLS-CLIP: `sub` narrows ONLY the leader anchor to
        // a descendant of the panel (e.g. #rule-levels inside #rule-panel) —
        // the spotlight stays panel-level. Fall back to the panel rect when
        // the sub-node is missing or collapsed (never invents a target).
        if (t.sub) {
          const host = this.panelEl(t.panel);
          if (!host || host.dataset.visible !== "true") return null;
          const sub = host.querySelector(t.sub);
          const r = sub instanceof HTMLElement ? sub.getBoundingClientRect() : null;
          if (r && r.width > 0 && r.height > 0) {
            return { x: r.left + r.width * 0.42, y: r.top + r.height / 2 };
          }
        }
        return panelPoint(t.panel);
      }
      case "panelChild": {
        // TOUR-POINT-S4-BARS-READOUT: the union of every matched child anchors
        // the leader (e.g. the two .bar-row rows). Same panel guards as
        // panelPoint; no match → null (the never-invents-a-target rule).
        const host = this.panelEl(t.panel);
        if (!host || host.dataset.visible !== "true") return null;
        const rects: DOMRect[] = [];
        for (const el of host.querySelectorAll(t.selector)) {
          if (el instanceof HTMLElement) {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) rects.push(r);
          }
        }
        if (rects.length === 0) return null;
        const l = Math.min(...rects.map((r) => r.left));
        const rgt = Math.max(...rects.map((r) => r.right));
        const tp = Math.min(...rects.map((r) => r.top));
        const bt = Math.max(...rects.map((r) => r.bottom));
        return { x: (l + rgt) / 2, y: (tp + bt) / 2 };
      }
      case "panelPart": {
        // TOUR-POINT-S7-SCRUBBER-SCORECARD: one descendant (e.g. #tilt-replay)
        // anchors the leader at the panel's fixed ratio on the PART's rect.
        const host = this.panelEl(t.panel);
        if (!host || host.dataset.visible !== "true") return null;
        const part = host.querySelector(t.selector);
        if (!(part instanceof HTMLElement)) return null;
        if (part.hidden) return null;
        if (getComputedStyle(part).display === "none") return null;
        const r = part.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return null;
        return { x: r.left + r.width * 0.42, y: r.top + r.height / 2 };
      }
      case "tiltLevels": {
        // §7's level sentence anchors the PILLS row, not the whole panel
        // (U5-POINT-LEVELS: the generic panel-fraction point landed on the
        // damping slider row ~56px above #tilt-levels). Same visibility
        // guard as panelPoint.
        if (this.els.tiltPanel?.dataset.visible !== "true") return null;
        const r = this.els.tiltLevels?.getBoundingClientRect();
        if (!r || r.width <= 0 || r.height <= 0) return null;
        return { x: r.left + r.width * 0.5, y: r.top + r.height / 2 };
      }
      case "control": {
        // A reader-side DOM control by id (U1-POINT-ETA): anchor its rect
        // center. The visibility guard mirrors resolveSentence
        // (sentences.ts) — a hidden / non-active page's control no-ops,
        // never inventing a target.
        const el = document.getElementById(t.el);
        if (!(el instanceof HTMLElement) || el.getClientRects().length === 0) return null;
        const cr = el.getBoundingClientRect();
        if (cr.width <= 0 || cr.height <= 0) return null;
        return { x: cr.left + cr.width * 0.5, y: cr.top + cr.height / 2 };
      }
      case "needle":
        // REG-2-NEEDLE-ANCHOR: anchor the NEEDLE itself — the learner point
        // the needle radiates from and the spotlight halo is drawn on — not
        // the panel's fixed 42%/50% fraction. The old fraction sat up to
        // ~100px from the needle wherever the learner point was not
        // mid-panel (static on task-b, swinging with gd-a's drift): the
        // arrow pointed at bare contour rings while the halo glowed
        // elsewhere. Falls back to the panel when the needle is not drawn
        // (no landscape laid out, zero gradient) — never invents a target.
        return this.minimap.needleScreenPoint() ?? panelPoint("minimap");
      case "ball":
        if (!this.ballVisible || !this.view.ballObject) return null;
        return this.view.projectParamToScreen(this.currentPoint);
      case "ensemble": {
        // §7's swarm: the 100 instanced balls replace the single learner
        // ball (ballVisible is false by design), so the ensemble anchors at
        // a representative member — the first ball's live draw position.
        if (this.scene !== "swarm" || !this.swarm || this.swarmDrawPos.length === 0) {
          return null;
        }
        return this.view.projectParamToScreen(this.swarmDrawPos[0]);
      }
      case "gdStep": {
        // Same pre-commit guard as applyLook (QA S2A-GDSTEP-LOOK-PRECOMMIT).
        if (this.scene !== "gd-b" || this.built !== "bowl" || this.gdTipFull === null) {
          return null;
        }
        return this.view.projectParamToScreen(this.gdTipFull);
      }
      case "trail": {
        const trails = this.liveTrails(t.which);
        if (trails.length === 0) return null;
        const pts = trails[0].path;
        return this.view.projectParamToScreen(pts[pts.length - 1]);
      }
      case "arrows":
        if (!this.scene.startsWith("adam") || this.adamHandles.length === 0) return null;
        return this.view.projectParamToScreen(this.adamPoint);
      case "momApex":
        if (!this.scene.startsWith("mom") || this.momApexPts.length === 0) return null;
        return this.view.projectParamToScreen(this.momApexPts[0]);
      case "marker":
        if (t.which === "fog") {
          if (this.fogMarker === null || !this.fogLevel) return null;
          return this.view.projectParamToScreen(this.fogLevel.globalMin);
        }
        if (this.epiMarker === null) return null;
        return this.view.projectParamToScreen(ARGMIN);
      case "lattice":
        if (this.epiLattice === null) return null;
        return this.view.projectParamToScreen(latticeCenter());
    }
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
    // FUNC-CARD: λ₁ IS this slider — the card's values line updates with
    // every input event, not just at the coalesced terrain rebuild.
    this.syncFuncCard();
    this.pendingAdam = true;
    this.view.requestRender();
  }

  /**
   * Minimap arrow-drag: live preview of the user's step (gd-b, fog-a/b).
   * Returns the tip actually drawn (the fog scenes' snapped/clamped stride),
   * or null when this scene does not accept a drawn arrow — that return
   * value is the single gate for the minimap's readout and draw state.
   */
  onArrowPreview(tip: Vec2): Vec2 | null {
    if (this.fogPreview(tip)) return this.fogPreviewTip;
    if (this.scene !== "gd-b" || this.frozen) return null;
    // A redraw invalidates any ride of the OLD arrow (QA gdb-redraw-stale-
    // replay): its lane path was copied at Play time. Drop it so the button
    // returns to ▶ Play and the next Play rides the new tip. No-op when
    // nothing is loaded, so per-pointermove calls cost nothing.
    this.clearReplayVisuals();
    this.userTip = { ...tip };
    this.gdAnimT = 0; // re-drag restarts the step animation
    this.updateGdArrows(0);
    this.updateTransport();
    this.view.requestRender();
    return this.userTip;
  }

  /**
   * Minimap arrow-drag: commit — the user arrow stays, GD's step animates.
   * `gesture.travelPx` is how far the pointer moved during the drag (the fog
   * game rejects taps/jitters with it; gd-b has no budget and ignores it).
   */
  onArrowCommit(tip: Vec2, gesture?: { travelPx: number }): void {
    if (this.fogCommitStep(tip, gesture)) return;
    if (this.scene !== "gd-b") return;
    // Also here: a commit with no preview first (click-release, or the
    // frozen path where preview returns early) must drop a stale ride too.
    this.clearReplayVisuals();
    this.userTip = { ...tip };
    this.arrowCommits += 1; // tour gate releases on commit, not pointer-down
    this.gdTipFull = this.gdStepTip();
    this.gdAnimT = this.frozen ? 1 : 0;
    this.updateGdArrows(this.gdAnimT);
    this.updateTransport(); // the Play transport appears once data exists
    this.view.requestRender();
  }

  /**
   * Minimap arrow-drag: the UA cancelled the gesture (pointercancel). Never
   * a commit (QA S2-FOG8-POINTERCANCEL-COMMITS): the fog game restores the
   * preview to its pre-gesture state — the queued drag's arrow mid-walk,
   * else none — and spends nothing, flashes nothing. gd-b keeps today's
   * behaviour: the half-applied preview is committed so the drawn arrow and
   * GD's step stay consistent.
   */
  onArrowCancel(): void {
    const level = this.fogLevel;
    const st = this.fogSt;
    if (
      (this.scene === "fog-a" || this.scene === "fog-b") &&
      !this.frozen && level && st && !st.done
    ) {
      this.fogPreviewTip =
        this.fogAnim && this.fogQueued
          ? fogClampTip(level, st.point, fogSnapToCell(level, this.fogQueued.tip))
          : null;
      this.minimap.setArrows({ userTip: this.fogPreviewTip, gdTip: null, userOrigin: st.point });
      this.view.requestRender();
      return;
    }
    if (this.scene === "gd-b" && !this.frozen && this.userTip) {
      this.onArrowCommit(this.userTip);
    }
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
      overlayFade: this.view.overlayFade,
      retired: this.view.retiredCount,
      ball: this.view.ballOpacity !== null && this.view.ballOpacity !== undefined,
      cam: { azim: this.val("azim"), elev: this.val("elev"), zoom: this.val("zoom") },
      viewAttitude: { ...this.view.attitude },
      viewPan: this.view.panInfo,
      /** Fog-leak probes (QA TILTFOG-*): the compass's fog mode and the
       *  view's contour-reveal multiplier. */
      minimapFog: this.minimap.fogMode,
      contourRevealK: this.view.contourReveal,
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
    // FUNC-CARD: λ₁/λ₂/φ are these two sliders — the card's values line
    // tracks every input event (the terrain rebuild itself is throttled).
    this.syncFuncCard();
    this.lastLabInputAt = performance.now();
    this.pendingLab = true;
    // PERF25-S2-LAB-REBUILD-LONGTASKS: while a drag streams, rebuild+render
    // stack into long tasks under software raster — arm the motion tier now
    // and release it ~250ms after the last input (mirrors setReplayScrub's
    // keyboard tier; clearReplayVisuals force-releases it before a replay).
    this.view.setMotionTier(true);
    clearTimeout(this.labTierTimer);
    this.labTierTimer = window.setTimeout(() => {
      this.view.setMotionTier(false);
    }, 250);
    // NO requestRender here (QA PERF-1): per-input renders re-raster the
    // whole scene and stack 100-400ms long tasks. The onFrame throttle
    // rebuilds live — at most once per max(LAB_LIVE_MS, 2× last cost) — and
    // its changed-flag drives the render; an idle trailing rebuild lands the
    // final values exactly once.
  }

  setCurvesLog(log: boolean): void {
    // A scale-only change: redraw the stored curves. Queuing a lab rebuild
    // here disposed the live replay (QA SEC5-S2-LOGTOGGLE-KILLS-REPLAY).
    this.curvesLog = log;
    this.curves.setLogScale(log);
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
  /**
   * Re-initializes the fog mask if the incoming terrain needs it (QA
   * F26-FOG-AB-FLASH round 2): enables fog, resets to opaque, and stamps
   * everything the run has already walked. Extracted from
   * refreshFogVisuals so rebuildNow can call it synchronously during a
   * crossfade's swap-in — refreshFogVisuals itself is deferred to swap end
   * (F27-OVERLAYS-BURIED), and without this the INCOMING level-2 terrain
   * would fade and rise completely un-fogged for ~0.65-1.1 s.
   */
  private initFogMaskIfNeeded(): void {
    const level = this.fogLevel;
    const st = this.fogSt;
    if (!level || !st) return;
    const want = level.id === "ls" ? "fog-ls" : "fog-rb";
    if (this.built !== want) return; // not this landscape (yet) — no-op
    if (this.fogMaskReady) return; // already initialized
    // The deferred fog-a ↔ fog-b reset lands here, on the INCOMING material
    // (QA S2-FOG-AB-REVEAL-REFOGS): setFogEnabled copies the view's fogLift
    // into the new uniform, and level 1's lift would show level 2 unfogged.
    this.view.setFogReveal(this.val("fogrev"));
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
    // setFogEnabled(false) forced contourRevealK to 1 (LandscapeView restores
    // the contours when fog turns off) — restore the reveal value it must
    // ride while fog is on.
    this.view.setContourReveal(this.val("fogrev"));
  }

  private refreshFogVisuals(): void {
    const level = this.fogLevel;
    const st = this.fogSt;
    if (!level || !st) return;
    const want = level.id === "ls" ? "fog-ls" : "fog-rb";
    if (this.built !== want) return; // swap still sinking — again after rebuild
    this.initFogMaskIfNeeded();
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
    // Measured and drawn from the stride's REAL origin (the landing point
    // mid-walk), not the moving ball (QA S2A-READOUT-STALE-MIDWALK).
    this.minimap.setArrows({ userTip: this.fogPreviewTip, gdTip: null, userOrigin: this.fogSt.point });
    this.view.requestRender();
    return true;
  }

  /**
   * Minimap drag commit (fog scenes): spend a measurement, start the walk.
   * Mid-walk commits are QUEUED (no spend, no cut) until the stride lands;
   * taps/jitters (travel < slop) and tips that fall back onto the ball are
   * rejected without wasting the budget (QA SEC6-F1).
   */
  private fogCommitStep(tip: Vec2, gesture?: { travelPx: number }): boolean {
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
    if (this.fogAnim) {
      // Mid-walk taps are rejected NOW, not at replay time: the replay's
      // min-step check measures from the landing point B, but a tap was aimed
      // at the moving ball — up to a whole stride away — so it would slip
      // through and spend a measurement (QA SEC6-F1 round 2).
      const travel = gesture?.travelPx ?? 0;
      if (travel < FOG_DRAG_SLOP_PX) {
        this.minimap.flashStrideReject();
        // The tap's pointerdown overwrote the preview arrow — restore the
        // queued drag's preview if one is parked, else clear it.
        this.fogPreviewTip = this.fogQueued
          ? fogClampTip(level, st.point, fogSnapToCell(level, this.fogQueued.tip))
          : null;
        this.minimap.setArrows({ userTip: this.fogPreviewTip, gdTip: null, userOrigin: st.point });
        this.view.requestRender();
        return true; // handled: nothing queued, nothing spent
      }
      // A real drag parks here, gesture included (single slot, latest wins).
      // st.point is already the in-flight stride's endpoint B, so the preview
      // is correct from the landing point.
      this.fogQueued = { tip: { ...tip }, travelPx: travel };
      this.fogPreviewTip = fogClampTip(level, st.point, fogSnapToCell(level, tip));
      this.minimap.setArrows({ userTip: this.fogPreviewTip, gdTip: null, userOrigin: st.point });
      this.view.requestRender();
      return true;
    }
    // Gesture-aware resolution: the RAW tip is min-step-checked BEFORE the
    // cell snap could move a near-ball tap a whole stride away, and a
    // pointer travel under the slop is a tap, not a drag. Default 0 fails
    // CLOSED — a commit without gesture info can never bypass the tap gate.
    const clamped = fogResolveStride(level, st.point, tip, gesture?.travelPx ?? 0);
    if (clamped === null) {
      // Visible cue (QA G2-1/N5-S2): flash the compass stride ring red, and
      // clear the preview arrow that pointerdown drew.
      this.minimap.flashStrideReject();
      this.fogPreviewTip = null;
      this.minimap.setArrows({ userTip: null, gdTip: null });
      this.view.requestRender();
      return true; // the fog scene handled the gesture — never commit it
    }
    this.fogPreviewTip = null;
    this.fogSt = fogCommit(level, st, clamped); // measurement spent NOW
    this.fogAnim = { from: { ...st.point }, to: { ...clamped }, t: 0 };
    this.fogStampFrom = { ...st.point };
    this.minimap.setArrows({ userTip: null, gdTip: null });
    // Keep the walking ball clear of the HUD panels (QA
    // S2-FOG8-BALL-UNDER-FIT-INSET).
    this.computeFogPlayNudge(st.point, clamped);
    this.view.requestRender();
    return true;
  }

  /**
   * Lands an in-flight fog walk instantly: stamps the rest of the corridor
   * (from the last stamped point to the committed endpoint) AND the landing
   * disc, then parks the stamp origin at the endpoint. Shared by the skip
   * path, the tick landing, and finishFogRun so all three paint the same
   * thing — the skip/finish paths used to leave the landing disc unpainted.
   */
  private landFogWalk(): void {
    const level = this.fogLevel;
    const st = this.fogSt;
    if (!this.fogAnim || !level || !st) return;
    this.view.fogStampSegment(
      this.fogStampFrom ?? this.fogAnim.from,
      st.point,
      level.stampFrac,
    );
    this.view.fogStampAt(st.point, level.stampFrac);
    this.fogAnim = null;
    this.fogStampFrom = { ...st.point };
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
      this.landFogWalk();
    }
    this.fogQueued = null; // the run is over — drop any queued commit
    this.tween("fogrev", 1, 1.6);
    this.spawnFogMarker();
    this.syncFogPanel();
    // Steer the marker + note clear of the HUD panels before the reveal eases
    // in (QA L900-FOG-REVEAL-NOTE-OVER-HUD).
    this.fogNudgeViewport = `${innerWidth}x${innerHeight}`;
    this.fogObstacleCache = null;
    this.computeFogRevealNudge();
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
    // Draw after the terrain: same-depth transparent sort buried the halo
    // once the terrain reached full opacity (QA F26-EPI-HALO-BURIED).
    halo.renderOrder = 3;
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
    // Deferred fog-c entry (QA F16-FOGC-FILL-PEG round 2): the race fills
    // the bar from 25% (the entry motion's capped share) to 100%. A Replay/
    // relaunch builds its race synchronously, so it starts from 0.
    this.fogRaceBase =
      !frozen && this.fogRaceDeferred ? FOGC_ENTRY_SHARE : 0;
    this.fogRaceDeferred = false;
    // A live race owes one final transport sync when it finishes (see the
    // one-shot in the tick): arm the latch here, satisfy it in skip.
    this.ghostFinishSynced = frozen;
    // QA ANIM-1: the auto-played race never re-synced the transport — the
    // button kept reading "▶ Play" for the whole cinematic. Sync at race
    // start so it reads ❚❚ Pause while the ghosts run.
    if (!frozen) this.syncTransport();
  }

  /**
   * The race has FINISHED (not paused): nothing is playing and the clock sat
   * at the end. The single predicate both the transport label and
   * toggleReplay's relaunch branch use, so label and action can never
   * disagree (QA transport-finished-label-resume). A frozen race (total 0)
   * reads finished, which toggleReplay also treats as "relaunch".
   */
  private fogGhostsFinished(): boolean {
    return (
      this.fogGhosts !== null &&
      !this.fogGhostsPlaying() &&
      this.ghostClock >= this.fogGhostTotal
    );
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
    // Keep the timeline VALID: "finished" is ghostClock >= fogGhostTotal.
    // Zeroing both left a stale '❚❚ Pause' with the scrub bar stuck mid-race,
    // and a later scrub computed f·0 → a rewind to the top (QA fog-reveal-3).
    // Frozen ghosts keep total = 0 and stay parked at 0/0 as before.
    this.ghostClock = this.fogGhostTotal;
    this.ghostsPaused = false;
    this.ghostFinishSynced = true; // skip syncs the transport right below
    this.syncTransport();
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

    // C1-VERDICT-REMNANT: an empty run has NO verdict to read — the old
    // branch still wrote the accusatory line here, leaving it sandwiched
    // between the softened #fog-empty-lead (which already carries the
    // scroll-back guidance) and #fog-empty-verdict-note ("no verdict to
    // read"), which contradicted it. Hide the element instead; the toggle
    // runs on every call, so returning with a played run un-hides and
    // rewrites it, and the frozen ?shot=fog-c poses (canned played run)
    // keep the verdict.
    if (this.els.fogVerdict) {
      this.els.fogVerdict.hidden = empty;
      if (!empty) {
        const you = rows[0];
        const best = machines.reduce((a, b) => (b.finalLoss < a.finalLoss ? b : a));
        this.els.fogVerdict.textContent =
          you.loss <= best.finalLoss
            ? `You stopped lower than every optimizer — on ${you.meas} measurements, not ${best.steps}.`
            : `The best optimizer stopped lower (L ${fogFormatLoss(best.finalLoss)}) — but it spent ${best.steps} measurements to your ${you.meas}.`;
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
    // The how-to caption must not promise a dead control (QA COV22-1): once
    // the run is done (Finish, an exhausted budget, or the fog-c reveal)
    // the compass is read-only. Written only on change (per-frame caller).
    if (this.els.fogCaption) {
      const want = !st.done
        ? "Drag on the compass to step — each landing measures the loss and the gradient there."
        : this.scene === "fog-c"
          ? "Reveal — the footer's Replay and scrubber re-run all four ghosts."
          : "Run finished — the compass is read-only.";
      if (this.els.fogCaption.textContent !== want) this.els.fogCaption.textContent = want;
    }
    if (this.els.minimapPanel && (this.scene === "fog-a" || this.scene === "fog-b")) {
      const drawing = String(!st.done);
      if (this.els.minimapPanel.dataset.drawing !== drawing) {
        this.els.minimapPanel.dataset.drawing = drawing;
      }
    }
    // FUNC-CARD (show-after): the card appears exactly when st.done flips —
    // the same beat that lifts the fog (budget spent, Finish, or the fog-c
    // reveal). syncFogPanel runs per frame, so the write-guard keeps this
    // free; the sig change fires once, at the reveal.
    this.syncFuncCard();
  }

  /** Pins the gold reveal annotation just above the true-minimum marker. */
  private positionFogNote(): void {
    const note = this.els.fogNote;
    if (!note || !this.fogLevel || !this.fogSt || !this.fogSt.done) return;
    const s = this.view.projectParamToScreen(this.fogLevel.globalMin);
    if (!s) return;
    // Per-frame calls (orbit/zoom re-pins) must not churn styles when the
    // note has not actually moved.
    const left = `${Math.round(s.x)}px`;
    const top = `${Math.round(s.y)}px`;
    if (note.style.left !== left) note.style.left = left;
    if (note.style.top !== top) note.style.top = top;
    // Safety net (QA L900-FOG-REVEAL-NOTE-OVER-HUD): a user orbit can carry
    // the pinned note over a HUD panel — flip it below the marker, then
    // clamp it into the canvas pane; keep whichever placement overlaps least.
    const obstacles = this.fogNoteObstacles();
    const pane = this.fogNotePane();
    const overlap = (l: number, t: number, r: number, b: number): number => {
      let area = 0;
      for (const o of obstacles) {
        const w = Math.min(r, o.r) - Math.max(l, o.l);
        const h = Math.min(b, o.b) - Math.max(t, o.t);
        if (w > 0 && h > 0) area += w * h;
      }
      return area;
    };
    const nw = note.offsetWidth || 178;
    const nh = note.offsetHeight || 21;
    const boxFor = (place: "above" | "below") =>
      place === "above"
        ? { l: s.x - nw / 2, t: s.y - 30 - nh, r: s.x + nw / 2, b: s.y - 30 }
        : { l: s.x - nw / 2, t: s.y + 30, r: s.x + nw / 2, b: s.y + 30 + nh };
    const above = boxFor("above");
    const below = boxFor("below");
    const aboveA = overlap(above.l, above.t, above.r, above.b);
    const belowA = overlap(below.l, below.t, below.r, below.b);
    const want = belowA < aboveA ? "below" : "above";
    if (note.dataset.place !== want) note.dataset.place = want;
    const box = want === "below" ? below : above;
    let lx = box.l;
    const minX = pane.l + nw / 2;
    const maxX = pane.r - nw / 2;
    if (maxX > minX && lx > maxX) lx = maxX;
    if (lx < minX) lx = minX;
    const leftPx = `${Math.round(lx + nw / 2)}px`;
    if (note.style.left !== leftPx) note.style.left = leftPx;
  }

  /** The canvas pane's usable rect (8px inset; right edge = the docked
   *  reader's left edge, or the window if the reader is off-screen). */
  private fogNotePane(): { l: number; t: number; r: number; b: number } {
    const reader = document.getElementById("reader");
    const readerL =
      reader && getComputedStyle(reader).transform !== "none"
        ? innerWidth - 8
        : reader
          ? reader.getBoundingClientRect().left
          : innerWidth - 8;
    return { l: 8, t: 8, r: readerL - 8, b: innerHeight - 8 };
  }

  /** Visible HUD panels in the canvas pane, each grown by an 8px margin. */
  private fogNoteObstacles(): Array<{ l: number; t: number; r: number; b: number }> {
    if (this.fogObstacleCache) return this.fogObstacleCache;
    const out: Array<{ l: number; t: number; r: number; b: number }> = [];
    document
      .querySelectorAll<HTMLElement>("#stage-wrap .hud.panel[data-visible=\"true\"]")
      .forEach((el) => {
        if (el === this.els.fogNote) return;
        const r = el.getBoundingClientRect();
        out.push({ l: r.left - 8, t: r.top - 8, r: r.right + 8, b: r.bottom + 8 });
      });
    this.fogObstacleCache = out;
    return out;
  }

  /**
   * Steers the reveal marker + note clear of the HUD panels at narrow
   * viewports (QA L900-FOG-REVEAL-NOTE-OVER-HUD): grid-search the pane for
   * the placement closest to the projected marker whose note+marker footprint
   * hits no HUD panel, then ease the view's reveal nudge there. At the
   * canonical 1600×900 the stock framing is already clear and the nudge stays
   * 0. Runs on the reveal beat, on fog-c entry, and on viewport changes.
   */
  private computeFogRevealNudge(): void {
    const level = this.fogLevel;
    const note = this.els.fogNote;
    if (!level || !note || !this.fogSt?.done) return;
    setHud(note, true); // make it measurable (opacity handles the visual)
    const nw = note.offsetWidth || 178;
    const nh = note.offsetHeight || 21;
    const pane = this.fogNotePane();
    const obstacles = this.fogNoteObstacles();
    const s0raw = this.view.projectParamToScreen(level.globalMin);
    if (!s0raw) return;
    const applied = this.view.appliedRevealNudge;
    const s0 = { x: s0raw.x - applied.x, y: s0raw.y - applied.y };
    const clear = (t: { x: number; y: number }): boolean => {
      const l = t.x - nw / 2;
      const r = t.x + nw / 2;
      const tTop = Math.min(t.y - 30 - nh, t.y - 20);
      const bBot = Math.max(t.y - 30, t.y + 20);
      if (l < pane.l || r > pane.r || tTop < pane.t || bBot > pane.b) return false;
      const hit = (l1: number, t1: number, r1: number, b1: number): boolean =>
        obstacles.some(
          (o) => Math.min(r1, o.r) - Math.max(l1, o.l) > 0 && Math.min(b1, o.b) - Math.max(t1, o.t) > 0,
        );
      return (
        !hit(l, t.y - 30 - nh, r, t.y - 30) && // note above
        !hit(t.x - 20, t.y - 20, t.x + 20, t.y + 20) // marker disc
      );
    };
    let target = { x: 0, y: 0 };
    if (!clear(s0)) {
      let best = Infinity;
      for (let ty = pane.t + nh / 2; ty <= pane.b - nh / 2; ty += 8) {
        for (let tx = pane.l + nw / 2; tx <= pane.r - nw / 2; tx += 8) {
          if (!clear({ x: tx, y: ty })) continue;
          const d = (tx - s0.x) ** 2 + (ty - s0.y) ** 2;
          if (d < best) {
            best = d;
            target = { x: tx - s0.x, y: ty - s0.y };
          }
        }
      }
    }
    const already =
      Math.abs(this.val("fognx") - target.x) < 0.5 && Math.abs(this.val("fogny") - target.y) < 0.5 &&
      !this.tweens.has("fognx") && !this.tweens.has("fogny");
    if (this.frozen || already) {
      // Frozen shots have no frame clock: snap. An unchanged target needs no
      // tween (a no-op tween still counted as animating — the reader lock).
      this.values.set("fognx", target.x);
      this.values.set("fogny", target.y);
      this.view.setRevealNudge(target.x, target.y);
    } else {
      this.tween("fognx", target.x, 0.9);
      this.tween("fogny", target.y, 0.9);
    }
  }

  /**
   * Play-time framing (QA S2-FOG8-BALL-UNDER-FIT-INSET): while the run is
   * live, ease the camera (the same reveal-nudge channel) just enough that
   * the stride's landing disc AND its start disc sit clear of every visible
   * HUD panel — minimal camera motion, never moved when already clear. The
   * reveal (computeFogRevealNudge) takes over once the run is done.
   */
  private computeFogPlayNudge(from: Vec2, to: Vec2): void {
    const level = this.fogLevel;
    if (!level || !this.fogSt || this.fogSt.done) return;
    this.fogObstacleCache = null; // the visible panel set changes per scene
    const obstacles = this.fogNoteObstacles();
    const pane = this.fogNotePane();
    const sTo = this.view.projectParamToScreen(to);
    const sFrom = this.view.projectParamToScreen(from);
    if (!sTo || !sFrom) return;
    const applied = this.view.appliedRevealNudge;
    const bTo = { x: sTo.x - applied.x, y: sTo.y - applied.y };
    const bFrom = { x: sFrom.x - applied.x, y: sFrom.y - applied.y };
    // Disc radius: the painted stamp at the landing point, in screen px.
    const rp = level.stampFrac * fogDiag(level);
    const sx = this.view.projectParamToScreen({ x: to.x + rp, y: to.y });
    const sy = this.view.projectParamToScreen({ x: to.x, y: to.y + rp });
    const rr = Math.max(
      sx ? Math.hypot(sx.x - sTo.x, sx.y - sTo.y) : 0,
      sy ? Math.hypot(sy.x - sTo.x, sy.y - sTo.y) : 0,
    );
    const rPx = clamp(rr, 24, 48);
    const discClear = (c: { x: number; y: number }): boolean => {
      if (c.x - rPx < pane.l || c.x + rPx > pane.r || c.y - rPx < pane.t || c.y + rPx > pane.b) return false;
      for (const o of obstacles) {
        const qx = clamp(c.x, o.l, o.r);
        const qy = clamp(c.y, o.t, o.b);
        if ((c.x - qx) ** 2 + (c.y - qy) ** 2 < rPx * rPx) return false;
      }
      return true;
    };
    const clear = (n: { x: number; y: number }): boolean =>
      discClear({ x: bTo.x + n.x, y: bTo.y + n.y }) &&
      discClear({ x: bFrom.x + n.x, y: bFrom.y + n.y });
    if (clear(applied)) return; // already clear: no camera motion
    let target: { x: number; y: number } | null = null;
    let best = Infinity;
    for (let ty = pane.t + rPx; ty <= pane.b - rPx; ty += 8) {
      for (let tx = pane.l + rPx; tx <= pane.r - rPx; tx += 8) {
        const n = { x: tx - bTo.x, y: ty - bTo.y };
        const d = (n.x - applied.x) ** 2 + (n.y - applied.y) ** 2;
        if (d >= best || !clear(n)) continue;
        best = d;
        target = n;
      }
    }
    if (!target) return; // tiny viewport: nothing clears — leave it
    if (this.frozen) {
      this.values.set("fognx", target.x);
      this.values.set("fogny", target.y);
      this.view.setRevealNudge(target.x, target.y);
    } else {
      this.tween("fognx", target.x, 0.9);
      this.tween("fogny", target.y, 0.9);
    }
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
      // The REAL painted radius (LandscapeView stamps stampFrac·diag), so the
      // minimap's visited glow never over-claims the explored ground.
      stampR: level.stampFrac * fogDiag(level),
      done: st.done,
      cells: { nx: cells.nx, ny: cells.ny },
    });
    this.minimap.setArrows({ userTip: this.fogPreviewTip, gdTip: null, userOrigin: st.point });

    if (level.id === "ls") {
      // Continuity with §1: the fit inset + w/b readouts track the fog point.
      this.fitPreview.setFit(p.x, p.y);
      if (this.els.roW) this.els.roW.textContent = p.x.toFixed(2);
      if (this.els.roB) this.els.roB.textContent = p.y.toFixed(2);
    }

    this.syncFogPanel();
    this.positionFogNote();
    // Reveal-nudge upkeep (QA L900-FOG-REVEAL-NOTE-OVER-HUD): recompute on
    // viewport change, ride the tween into the view otherwise. The HUD rect
    // cache is dropped with the viewport signature.
    const vp = `${innerWidth}x${innerHeight}`;
    if (vp !== this.fogNudgeViewport) {
      this.fogNudgeViewport = vp;
      this.fogObstacleCache = null;
      if (this.fogSt?.done) this.computeFogRevealNudge();
      else {
        const path = st.path;
        const prev = path.length >= 2 ? path[path.length - 2] : st.point;
        this.computeFogPlayNudge(prev, st.point);
      }
    }
    this.view.setRevealNudge(this.val("fognx"), this.val("fogny"));
  }

  /**
   * Everything the fog section put on stage (leaving §6 / new level).
   * `outgoingRetired`: a landscape crossfade already retired the overlays —
   * the marker fades with the terrain (flushRetired disposes it) and the
   * compass stays in fog mode until the incoming level's state replaces it
   * (QA S2-FOG-AB-REVEAL-REFOGS: the contour ghost flashed otherwise).
   */
  private clearFogStage(opts: { outgoingRetired?: boolean } = {}): void {
    // The reader's level-2 run survives leaving §6 (QA
    // S2-FOG-RUN-LOST-ON-RETURN): fog-c restores it on re-entry. The reveal
    // ends a run however the reader got there, so it is kept done.
    if (!this.frozen && this.fogLevel?.id === "rb" && this.fogSt && this.fogSt.used > 0) {
      this.fogRbResult = {
        ...this.fogSt,
        point: { ...this.fogSt.point },
        path: this.fogSt.path.map((p) => ({ ...p })),
        done: true,
      };
    }
    this.clearFogGhostStage();
    if (this.fogMarker) {
      if (!opts.outgoingRetired) this.view.removeOverlayObject(this.fogMarker);
      this.fogMarker = null;
    }
    this.fogLevel = null;
    this.fogSt = null;
    this.fogMaskReady = false;
    // Reveal framing resets with the stage (QA L900-FOG-REVEAL-NOTE-OVER-HUD).
    this.values.set("fognx", 0);
    this.values.set("fogny", 0);
    this.view.setRevealNudge(0, 0);
    if (this.els.fogNote) delete this.els.fogNote.dataset.place;
    if (!opts.outgoingRetired) this.minimap.setFog(null);
    this.minimap.setArrows({ userTip: null, gdTip: null });
    // NOTE: no view.setFogEnabled(false) here (QA F26-FOG-AB-FLASH): this
    // runs during setScene's scene-state phase, while the OUTGOING fogged
    // terrain is still fully opaque and fading — unbinding the mask now
    // renders the whole bowl un-fogged for the whole fade-out. The teardown
    // moved to rebuildNow (fresh material there needs it anyway).
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
    // Rotate + renormalize to the dominant axis (QA S7-RASTR-DEAD-KEY-DIAGONAL).
    return tiltScreenToParam(this.tiltInput, this.view.attitude.azimuthDeg);
  }

  /** Friction slider input (live during play): the damping c, the β analogy. */
  setTiltFriction(c: number): void {
    // Defensive: the damping knob has no effect outside a live tilt-a run
    // (tiltFriction is only read by tiltStep). A stray input event (focus
    // carried over from tilt-a, a probe's dispatchEvent) must not change
    // state — re-sync so the slider snaps back to the stored value.
    if (this.scene !== "tilt-a") {
      this.syncTiltPanel();
      return;
    }
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
    this.resetTiltRunVisuals();
    if (this.built === "tilt" && this.builtTilt !== level.id) {
      this.view.setLandscape(level.landscape);
      this.minimap.setLandscape(level.landscape);
      this.builtTilt = level.id;
      this.dropTiltRefs();
    }
    // A new level is a new attempt: fog of war re-arms (dark board + start
    // patch), regardless of whether the terrain was swapped above.
    this.armTiltFog();
    this.view.setElevationClamp(this.frozen ? null : { ...TILT_PLAY_CLAMP });
    // Picking a level re-poses the camera to that level's curated pitch (QA
    // S7-SW2-RASTR-BALL-OCCLUDED); valley/Rosenbrock return to 40°.
    const cam = this.sceneCam("tilt-a", SCENES["tilt-a"]);
    if (cam) {
      this.view.setResetAttitude({
        azimuthDeg: cam.azimuth,
        elevationDeg: cam.elevation,
        zoomMul: cam.zoom,
      });
      this.tweenCamera(cam);
    }
    this.hudNudgeDirty = true;
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
    this.resetTiltRunVisuals();
    // Restart = a fresh attempt on the same board: fog re-arms (the painted
    // map of the abandoned attempt is wiped back to the start patch).
    this.armTiltFog();
    this.hudNudgeDirty = true;
    this.refreshTiltVisuals();
    this.updateDependents();
    this.view.requestRender();
  }

  /** The run just ended (settled or Finish): unclamps the camera, scores it. */
  private onTiltRunEnded(): void {
    this.view.setElevationClamp(null);
    this.tiltCueT = 0;
    this.syncTiltFinishCue();
    // Final stamp flush: the ending substep batch (settle or a Finish click
    // via finishTiltRun) can still add cells after the last live-tick flush,
    // and the tick's guard stops once done — stamp them before scoring.
    this.ensureTiltStamps();
    this.rebuildTiltStamps();
    // The reveal beat: the painted map opens fully (and the fog's run state
    // resets — the next attempt re-arms from scratch).
    this.liftTiltFog();
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
    // FIX: the machines roll too — each lane's ball sits at the SAME scrub
    // fraction of its replayed path (the §6 ghost-race reading, on the
    // scrubber's shared clock), so the reveal races BALLS, not lines.
    for (const [i, lane] of this.tiltMachineBalls.entries()) {
      const mp = samplePath(lane.path, p);
      this.view.parameterToWorld(
        mp,
        this.view.trailLift + this.view.diagonal * 0.016,
        lane.ball.position,
      );
      this.tiltMachinePos[i] = mp;
    }
  }

  /** Landscape-bound tilt visuals — after any rebuild / scene layout. */
  private refreshTiltVisuals(): void {
    const run = this.tiltRun;
    if (!run || this.built !== "tilt" || this.builtTilt !== this.tiltLevel.id) return;
    // The run-scoped fog arms here if it somehow deferred past rebuildNow
    // (idempotent; tilt-b no-ops inside — only tilt-a arms).
    this.initTiltFogMaskIfNeeded();
    this.ensureTiltStamps();
    this.rebuildTiltStamps();
    this.rebuildTiltLiveTrail(true);
    if (this.scene === "tilt-b") {
      this.buildTiltReveal();
      this.applyTiltGhost();
    }
    this.syncTiltPanel();
  }

  /**
   * One soft surface-following decal per visited measurement cell (QA
   * S7-SW2-RASTR-STAMPS-SHARDS): every decal vertex is projected onto the
   * terrain, so stamps follow Rastrigin's steep pit walls instead of
   * standing up as rigid tangent discs (blades / half-buried ellipses).
   * One preallocated mesh, a draw range grown per stamp.
   */
  private ensureTiltStamps(): void {
    if (this.tiltStamps) return;
    const R = TILT_STAMP_RINGS;
    const S = TILT_STAMP_SEGS;
    const geo = new THREE.BufferGeometry();
    const pos = new THREE.BufferAttribute(new Float32Array(TILT_STAMP_MAX * TILT_STAMP_V * 3), 3);
    pos.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("position", pos);
    // Grey radial falloff (additive: darker = more transparent).
    const col = new Float32Array(TILT_STAMP_MAX * TILT_STAMP_V * 3);
    const idx = new Uint16Array(TILT_STAMP_MAX * TILT_STAMP_I);
    let ii = 0;
    for (let slot = 0; slot < TILT_STAMP_MAX; slot++) {
      const b = slot * TILT_STAMP_V;
      col.fill(1, b * 3, b * 3 + 3);
      for (let k = 1; k <= R; k++) {
        const g = 1 - 0.65 * (k / R) ** 2;
        for (let j = 0; j < S; j++) {
          const v = b + 1 + (k - 1) * S + j;
          col[v * 3] = g;
          col[v * 3 + 1] = g;
          col[v * 3 + 2] = g;
        }
      }
      const ring = (k: number, j: number): number => b + 1 + (k - 1) * S + (j % S);
      for (let j = 0; j < S; j++) {
        idx[ii++] = b;
        idx[ii++] = ring(1, j);
        idx[ii++] = ring(1, j + 1);
      }
      for (let k = 1; k < R; k++) {
        for (let j = 0; j < S; j++) {
          idx[ii++] = ring(k, j);
          idx[ii++] = ring(k + 1, j);
          idx[ii++] = ring(k + 1, j + 1);
          idx[ii++] = ring(k, j);
          idx[ii++] = ring(k + 1, j + 1);
          idx[ii++] = ring(k, j + 1);
        }
      }
    }
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.setDrawRange(0, 0);
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        color: MANIM.teal,
        vertexColors: true,
        transparent: true,
        opacity: 0.42,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -4,
      }),
    );
    mesh.renderOrder = 1;
    mesh.frustumCulled = false;
    this.view.addOverlayObject(mesh);
    this.tiltStamps = mesh;
    this.tiltStampKeys = new Set();
    this.tiltStampCount = 0;
  }

  /** Stamps any not-yet-drawn cells (live runs grow the set) — centred
   *  where the ball first ENTERED each cell, so stamps sit on the trail. */
  private rebuildTiltStamps(): void {
    const mesh = this.tiltStamps;
    const run = this.tiltRun;
    const level = this.tiltLevel;
    if (!mesh || !run) return;
    const w = tiltDiag(level) * level.cellFrac;
    const e = level.landscape.extent;
    const R = w * 0.4;
    // Just under the trail; polygonOffset covers the tessellation error.
    const lift = this.view.trailLift * 0.8;
    const pos = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const tmp = new THREE.Vector3();
    let wrote = false;
    for (let i = 0; i < run.cells.length; i++) {
      const key = run.cells[i];
      if (this.tiltStampKeys.has(key)) continue;
      if (this.tiltStampCount >= TILT_STAMP_MAX) break;
      this.tiltStampKeys.add(key);
      let c = run.cellAt?.[i];
      if (!c) {
        const bar = key.indexOf("|");
        const ix = Number(key.slice(0, bar));
        const iy = Number(key.slice(bar + 1));
        c = { x: e.xMin + (ix + 0.5) * w, y: e.yMin + (iy + 0.5) * w };
      }
      const base = this.tiltStampCount * TILT_STAMP_V;
      const put = (v: number, q: Vec2): void => {
        const qc = {
          x: clamp(q.x, e.xMin, e.xMax),
          y: clamp(q.y, e.yMin, e.yMax),
        };
        this.view.parameterToWorld(qc, lift, tmp);
        arr[v * 3] = tmp.x;
        arr[v * 3 + 1] = tmp.y;
        arr[v * 3 + 2] = tmp.z;
      };
      put(base, c);
      for (let k = 1; k <= TILT_STAMP_RINGS; k++) {
        const rk = (R * k) / TILT_STAMP_RINGS;
        for (let j = 0; j < TILT_STAMP_SEGS; j++) {
          const th = (j / TILT_STAMP_SEGS) * Math.PI * 2;
          put(base + 1 + (k - 1) * TILT_STAMP_SEGS + j, {
            x: c.x + rk * Math.cos(th),
            y: c.y + rk * Math.sin(th),
          });
        }
      }
      this.tiltStampCount += 1;
      wrote = true;
    }
    if (wrote) {
      pos.needsUpdate = true;
      mesh.geometry.setDrawRange(0, this.tiltStampCount * TILT_STAMP_I);
    }
  }

  private clearTiltStampMesh(): void {
    if (this.tiltStamps) {
      this.view.removeOverlayObject(this.tiltStamps);
      this.tiltStamps = null;
    }
    this.tiltStampKeys = new Set();
    this.tiltStampCount = 0;
  }

  /** A fresh run's stage: no old discs, no old live trail, chunk counter
   *  zeroed (QA S7-SW2-BACKNAV-STALE-STAMPS-TRAIL). */
  private resetTiltRunVisuals(): void {
    this.clearTiltStampMesh();
    if (this.tiltLiveTrail) {
      this.tiltLiveTrail.dispose();
      this.tiltLiveTrail = null;
    }
    this.tiltLiveBuilt = 0;
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
        // FIX: §6's ghost-ball approach — each machine rolls a ball along
        // its replayed path (identity color, sized like the player ghost),
        // scrubbed by applyTiltGhost on the shared ghost clock.
        const ball = new THREE.Mesh(
          new THREE.SphereGeometry(1, 16, 12),
          new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.95,
          }),
        );
        ball.scale.setScalar(this.view.diagonal * 0.016);
        const end = m.path[m.path.length - 1];
        this.view.parameterToWorld(
          end,
          this.view.trailLift + this.view.diagonal * 0.016,
          ball.position,
        );
        this.view.addOverlayObject(ball);
        this.tiltMachineBalls.push({ ball, path: m.path });
        this.tiltMachinePos.push({ ...end });
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
    for (const lane of this.tiltMachineBalls) {
      this.view.removeOverlayObject(lane.ball);
    }
    this.tiltMachineBalls = [];
    this.tiltMachinePos = [];
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

    // Three kinds of "you" row (QA COPY2-TILTB-NORUN-ROW-HAS-DEMO-NUMBERS /
    // COV22-2): a steered run (graded), the guided demo seeded on tilt-b with
    // no session run (its honest numbers, labelled as the demo, never gold),
    // and an empty unsteered run (no numbers at all).
    const demo = run.curated && !run.steered;
    const empty = !run.steered && !run.curated;
    const rows: Array<{
      label: string;
      color: string;
      steps: number | null;
      cells: number | null;
      loss: number | null;
      end: Vec2;
      basin: { label: string; global: boolean; atMin: boolean };
      machine: boolean;
    }> = [
      {
        label: run.steered ? "you (tilt)" : demo ? "guided demo" : "you (no run)",
        color: "#FFFFFF",
        steps: empty ? null : score.steps,
        cells: empty ? null : score.cells,
        loss: empty ? null : score.finalLoss,
        end: { ...run.pos },
        // The player's row passes its velocity: a slow ball ringing down in
        // a Rastrigin pit rests there (QA S7-RASTR-FINISH-SLOPE).
        basin: tiltBasin(level, run.pos, run.vel),
        machine: false,
      },
      ...machines.map((m) => ({
        label: m.label,
        color: m.cssColor,
        steps: m.steps as number | null,
        // Machine cells on the player's grid (QA COPY2-TILT-STEPS-CELLS-NOT-SAME-PAIR).
        cells: m.cells as number | null,
        loss: m.finalLoss as number | null,
        end: { ...m.end },
        basin: m.basin,
        machine: true,
      })),
    ];
    // Gold is for graded rows only: an unsteered row (demo or empty) never
    // takes it from the machines.
    const scored = rows.filter((r) => r.loss !== null && (r.machine || run.steered));
    const minLoss = Math.min(...scored.map((r) => r.loss as number));
    const minLossRow = scored.reduce((x, y) => ((y.loss as number) < (x.loss as number) ? y : x), scored[0]);
    // Rastrigin's ℒ gold is graded by PIT, not exact float: the settle
    // tolerance can park the player slightly up the same pit's wall as a
    // machine (same minimum, ℒ differing in the 3rd digit) — same pit,
    // same gold. A row graded "on a slope" never shares the gold just for
    // its lattice label (QA S7-RASTR-FINISH-SLOPE). Other levels keep the
    // exact-ℒ check.
    const lossBest = (r: (typeof rows)[number]): boolean => {
      if (r.loss === null || !scored.includes(r)) return false;
      return level.id === "rastr"
        ? r === minLossRow ||
            (r.basin.atMin && minLossRow.basin.atMin && tiltSamePit(r.end, minLossRow.end))
        : r.loss === minLoss;
    };
    // The steps column holds two units (your 120 Hz physics substeps vs the
    // machines' update iterations): never ranked, never gold (QA
    // COPY2-TILT-STEPS-CELLS-NOT-SAME-PAIR).

    // "Which minimum" footer — shown only where ANY minimum counts
    // (Rastrigin), so the single-minimum levels' tables are unchanged (QA
    // copy-tilt-which-minimum round 2: the table is `table-layout: fixed`
    // with four 100%-summing columns; a fifth nowrap column cannot fit, so
    // the basins live in a full-width tfoot row instead).
    const showMin = level.anyMinimum === true;
    body.replaceChildren(
      ...rows.map((r) => {
        const tr = document.createElement("tr");
        const name = document.createElement("td");
        name.textContent = r.label;
        name.style.color = r.color;
        // The demo label is the longest row name: a hair smaller so the
        // fixed first column never truncates it (QA L900-TILT-SCORECARD-TRUNC).
        if (!r.machine && demo) name.className = "tc-demo";
        const steps = document.createElement("td");
        steps.textContent = r.steps === null ? "—" : String(r.steps);
        steps.className = "mono";
        const cells = document.createElement("td");
        cells.textContent = r.cells === null ? "—" : String(r.cells);
        cells.className = "mono";
        const loss = document.createElement("td");
        loss.textContent = r.loss === null ? "—" : tiltFormatLoss(r.loss);
        loss.className = "mono";
        if (lossBest(r)) loss.dataset.best = "true";
        tr.append(name, steps, cells, loss);
        return tr;
      }),
    );

    const foot = body.closest("table")?.querySelector<HTMLElement>("#tilt-scorecard-min");
    if (foot) {
      foot.hidden = !showMin;
      const footTd = foot.querySelector("td");
      if (showMin && footTd) {
        // Group by resting basin: one line per distinct pit, run labels
        // first ("GD · momentum · Adam: (−1, 2) local"); rows that never
        // reached a minimum get one shared "on a slope" line. A row with no
        // run (COV22-2) is in neither group.
        const listed = rows.filter((r) => r.loss !== null);
        const settled = listed.filter((r) => r.basin.atMin);
        const slope = listed.filter((r) => !r.basin.atMin);
        const line = (text: string, gold = false): HTMLDivElement => {
          const div = document.createElement("div");
          div.textContent = text;
          if (gold) div.dataset.best = "true";
          return div;
        };
        footTd.replaceChildren();
        const byPit = new Map<string, string[]>();
        const pitGlobal = new Map<string, boolean>();
        for (const r of settled) {
          const key = r.basin.label;
          const labels = byPit.get(key) ?? [];
          labels.push(r.label);
          byPit.set(key, labels);
          pitGlobal.set(key, r.basin.global);
        }
        for (const [pit, labels] of byPit) {
          // COPY-PLAN D8: Rastrigin's pit labels already say "global/local
          // minimum" — append the word only for the single-minimum levels'
          // bare "the minimum" (the doubled word read as a stutter).
          const bare = !/\b(?:global|local) minimum\b/.test(pit);
          const pitName = bare
            ? `${pit} — ${pitGlobal.get(pit) ? "global" : "local"}`
            : pit;
          footTd.append(
            line(`${labels.join(" · ")}: ${pitName}`, pitGlobal.get(pit) === true),
          );
        }
        if (slope.length > 0) {
          footTd.append(line(`${slope.map((r) => r.label).join(" · ")}: no rest — still on a slope`));
        }
      }
    }

    // tilt-b body copy follows the row: the run story, the demo story, or —
    // for an untouched run carried over from tilt-a (STUDENT-TILTB-EMPTY-
    // RUN-LEAD: the old toggle keyed on `demo` alone) — the no-run story.
    if (this.els.tiltRunLead) this.els.tiltRunLead.hidden = demo || empty;
    if (this.els.tiltDemoLead) this.els.tiltDemoLead.hidden = !demo || empty;
    if (this.els.tiltEmptyLead) this.els.tiltEmptyLead.hidden = !empty;

    if (this.els.tiltVerdict) {
      const meas = plural(score.cells, "measurement");
      // QA cycle B (student-2): an untouched run is the attract pose and a
      // rail-tick-seeded curated ride is a demo — neither is a performance,
      // and neither is graded as one.
      if (demo) {
        this.els.tiltVerdict.textContent =
          `You never tilted the board — the white ghost is a guided demo ride through ${level.name}'s valley ` +
          `(${score.steps} steps, L ${tiltFormatLoss(score.finalLoss)}), not your run. ` +
          "The optimizers raced the same start; take the drive to be graded.";
        return;
      }
      if (!run.steered) {
        this.els.tiltVerdict.textContent =
          "You never tilted the board — nothing on stage is your run. The optimizers ran the same start blind.";
        return;
      }
      if (level.id === "rastr") {
        // Grade EVERYONE by the same settle rule (|∇f| on quiet ground) and
        // name WHICH pit each row rests in — the goal-radius 'reached' flag
        // only marks the global minimum at (0, 0), so on the egg crate both
        // the machines and the player usually rest in minima 'reached' can
        // never see (QA S7-RASTR-VERDICT).
        const settledMachines = machines.filter((m) => m.settled);
        const pitList = (list: typeof machines): string =>
          list
            .map((m) => `${m.label} rests in ${tiltPitLabel(level, m.end)} (L ${tiltFormatLoss(m.finalLoss)})`)
            .join(", ");
        const playerGlobal = tiltSamePit(run.pos, { x: 0, y: 0 });
        // A Finished ball still ringing down inside a pit RESTS there (QA
        // S7-RASTR-FINISH-SLOPE) — the verdict names the pit like the footer.
        const youRest = rows[0].basin.atMin;
        if (score.settled || youRest) {
          const shared = settledMachines.filter((m) => tiltSamePit(m.end, run.pos));
          let machineLine: string;
          if (shared.length === machines.length && shared.length > 0) {
            const sharedLoss = Math.min(...shared.map((m) => m.finalLoss));
            machineLine = `all three optimizers settled in that same pit (L ${tiltFormatLoss(sharedLoss)}) within ${TILT_MACHINE_STEPS} steps`;
          } else if (shared.length > 0) {
            const other = settledMachines.filter((m) => !tiltSamePit(m.end, run.pos));
            machineLine =
              `${shared.map((m) => m.label).join(", ")} settled in that same pit` +
              (other.length > 0 ? `, while ${pitList(other)}` : "");
          } else {
            machineLine =
              settledMachines.length === 0
                ? `no optimizer settled within ${TILT_MACHINE_STEPS} steps`
                : `the optimizers settled elsewhere: ${pitList(settledMachines)}`;
          }
          const globalLine = playerGlobal
            ? ""
            : ` The global minimum is at (0, 0), L 0.`;
          const lead = score.settled
            ? `You settled into ${tiltPitLabel(level, run.pos)}`
            : `You stopped in ${tiltPitLabel(level, run.pos)}`;
          this.els.tiltVerdict.textContent =
            `${lead}, L ${tiltFormatLoss(score.finalLoss)}, ` +
            `after ${score.steps} steps and ${meas} — ${machineLine}.${globalLine}`;
        } else {
          const machineLine =
            settledMachines.length === 0
              ? `no optimizer settled within ${TILT_MACHINE_STEPS} steps`
              : pitList(settledMachines);
          this.els.tiltVerdict.textContent =
            `You stopped on a pit wall near ${rows[0].basin.label} after ${score.steps} steps and ${meas} — ${machineLine}.` +
            (playerGlobal ? "" : " The global minimum is at (0, 0), L 0.");
        }
        return;
      }
      const reached = machines.filter((m) => m.reached);
      const reachedNames =
        reached.length === 0
          ? "no optimizer reached a minimum"
          : reached.length === machines.length
            ? "all three optimizers reached a minimum"
            : `${reached.map((m) => m.label).join(" and ")} reached a minimum`;
      // A settle is "quiet ground", not "the minimum" (QA S7-VALLEY-FALSE-MIN:
      // the valley floor's gradient is ≈0.04·r, under settleGrad 0.5 out to
      // r ≈ 12). Grade the player with the SAME goal predicate the machines'
      // `reached` flag uses.
      const goalD = Math.hypot(run.pos.x - level.goal.x, run.pos.y - level.goal.y);
      const atGoal = tiltAtGoal(level, run.pos);
      const goalLoss = level.landscape.f(level.goal);
      const shortClause =
        `L ${tiltFormatLoss(score.finalLoss)}, ${goalD.toFixed(1)} units short of the ` +
        `true minimum (L≈${tiltFormatLoss(goalLoss)})`;
      if (score.settled && atGoal) {
        this.els.tiltVerdict.textContent =
          `You settled into the minimum after ${score.steps} steps and ${meas} — ${reachedNames} within ${TILT_MACHINE_STEPS} steps.`;
      } else if (score.settled) {
        this.els.tiltVerdict.textContent =
          `You came to rest where the needle went quiet after ${score.steps} steps and ${meas} — ` +
          `${shortClause}. A quiet needle isn't a minimum; ${reachedNames} within ${TILT_MACHINE_STEPS} steps.`;
      } else {
        this.els.tiltVerdict.textContent =
          `You stopped after ${score.steps} steps and ${meas}` +
          (atGoal ? "" : ` — ${shortClause}`) +
          ` — ${reachedNames}.`;
      }
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
   * MEAN final loss. Balls are classified by swarmBasinOf (the well's own
   * capture ellipse, QA S7-SWARM-2) — not nearest-center, which put balls
   * stalled on open ground into basin rows and dragged their means down.
   * Unclassified balls get one trailing "never found a basin" row (only when
   * any exist) so the counts still sum to the swarm size. The wells come
   * from the PICKED map's landscape (`wells` on the Landscape), deepest
   * first; the `global`-flagged well(s) get the gold row (Himmelblau flags
   * all four — every pit is a global minimum there).
   */
  private swarmClusterRows(): Array<{
    name: string;
    count: number;
    meanLoss: number;
    global: boolean;
    basin: boolean;
  }> {
    const sw = this.swarm;
    if (!sw) return [];
    const level = this.swarmLevel();
    const f = level.landscape.f;
    const rows = landscapeWells(level.landscape).map((w) => ({
      name: w.name,
      count: 0,
      sum: 0,
      meanLoss: 0,
      global: w.global === true,
    }));
    let openCount = 0;
    let openSum = 0;
    sw.sim.paths.forEach((path, i) => {
      // Only balls the reader has seen arrive count (QA S2-SWARM-SCORECARD-
      // PRECOMPUTED-SPOILER) — the final outcome is not shown on frame one.
      if (!sw.arrived[i]) return;
      const end = path[path.length - 1];
      const b = sw.sim.basinOf[i];
      if (b >= 0) {
        rows[b].count += 1;
        rows[b].sum += f(end);
      } else {
        openCount += 1;
        openSum += f(end);
      }
    });
    const out = rows
      .filter((r) => r.count > 0)
      .map((r) => ({ name: r.name, count: r.count, meanLoss: r.sum / r.count, global: r.global, basin: true }));
    if (openCount > 0) {
      out.push({
        name: "never found a basin",
        count: openCount,
        meanLoss: openSum / openCount,
        global: false,
        basin: false,
      });
    }
    return out;
  }

  /** Panel readouts, sub-section visibility, slider/button state. */
  private syncTiltPanel(): void {
    const tiltScene = this.scene === "tilt-a" || this.scene === "tilt-b";
    const swarmScene = this.scene === "swarm";
    setHud(this.els.tiltPanel, tiltScene || swarmScene);
    if (!this.els.tiltPanel) return;
    // The swarm and the tilt-b reveal reuse the panel but hide the play
    // controls (they would be dead: no live run to damp, no level to switch —
    // setTiltLevel is tilt-a only and tiltFriction is only read by a live
    // tilt-a run). QA S7-TILTB-DEAD-CONTROLS, same class as F-3.
    this.els.tiltPanel.dataset.mode = swarmScene
      ? "swarm"
      : this.scene === "tilt-b"
        ? "reveal"
        : "game";
    const run = this.tiltRun;
    const level = this.tiltLevel;

    if (this.els.tiltLevelEl) {
      this.els.tiltLevelEl.textContent = swarmScene
        ? `swarm finale — ${swarmMapById(this.swarmMapId).census}`
        : `level ${level.ordinal} · ${level.name}`;
    }
    if (this.els.tiltInputEl) {
      const t = this.tiltInput;
      this.els.tiltInputEl.textContent = this.wantsTiltKeys
        ? `${t.x >= 0 ? "+" : "−"}${Math.abs(t.x).toFixed(1)} / ${t.y >= 0 ? "+" : "−"}${Math.abs(t.y).toFixed(1)}`
        : "—";
    }
    // A finished run the player never steered (the guided demo, an
    // untouched Finish) is not theirs: no numbers presented as theirs (QA
    // COV22-2). The live, not-yet-done starting pose keeps its readouts.
    const ungraded = !!run && run.done && !run.steered;
    if (this.els.tiltCells) this.els.tiltCells.textContent = ungraded ? "—" : String(run?.cells.length ?? 0);
    if (this.els.tiltSteps) this.els.tiltSteps.textContent = ungraded ? "—" : String(run?.steps ?? 0);
    if (this.els.tiltLoss) {
      this.els.tiltLoss.textContent =
        run && tiltScene && !ungraded ? tiltFormatLoss(level.landscape.f(run.pos)) : "—";
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
    // §7 keys caption: once a run is DONE the arrow keys no longer tilt
    // (wantsTiltKeys is false) — say so, instead of leaving a dead instruction
    // on screen (QA KW-4). Deliberately does NOT point at ↻ Restart: it is
    // hidden for a done run; the way back is the level pills.
    if (this.els.tiltKeysMessage) {
      const runOver =
        this.scene === "tilt-a" && this.tiltRun !== null && this.tiltRun.done;
      // ↑/↓ never tilt (QA S2-BWD-1): they always drive the reader.
      const done =
        'Run finished — the tilt keys are off. Pick another level to tilt again.';
      const live =
        '<span class="mono">W A S D</span> (or <span class="mono">← →</span>) tilt the board relative to your screen — the physics runs in the parameter plane, so with the camera swung around a "down" key can raise the loss.';
      const want = runOver ? done : live;
      if (this.els.tiltKeysMessage.innerHTML !== want) {
        this.els.tiltKeysMessage.innerHTML = want;
      }
    }
    if (this.els.tiltSwarmLine) {
      this.els.tiltSwarmLine.hidden = !swarmScene;
      if (swarmScene && this.swarm) {
        // Report basin capture, not raw "settled" (QA S7-SWARM-2: a rest on
        // open ground is not a minimum).
        // Counted as they ARRIVE (QA S2-SWARM-SCORECARD-PRECOMPUTED-SPOILER),
        // and minima are distinct WELLS (QA S2-SWARM-SEVEN-MINIMA: a long
        // well's rest cluster straddles two cells).
        const sw = this.swarm;
        const n = sw.sim.paths.length;
        let captured = 0;
        let stalled = 0;
        const wells = new Set<number>();
        for (let i = 0; i < n; i++) {
          if (!sw.arrived[i]) continue;
          if (sw.sim.basinOf[i] >= 0) {
            captured += 1;
            wells.add(sw.sim.basinOf[i]);
          } else {
            stalled += 1;
          }
        }
        this.els.tiltSwarmLine.textContent = this.swarmBlind
          ? `${n} balls blind · ${this.swarmPainted} cells painted · ${wells.size} minima found`
          : sw.arrivedCount === 0 && sw.playing
            ? `${n} balls · rolling…`
            : `${n} balls · ${captured} in a basin` +
              (stalled > 0 ? ` · ${stalled} stalled on open ground` : "");
      }
    }
    // Per-cluster scorecard: one row per OCCUPIED well — crowd size + mean
    // final loss — so the unequal outcomes are legible at a glance. The
    // global basin's row is gold.
    if (this.els.tiltSwarmClusters) {
      const clusterRows = swarmScene && this.swarm ? this.swarmClusterRows() : [];
      // No empty box before the first arrival.
      this.els.tiltSwarmClusters.hidden = !swarmScene || this.swarm === null || clusterRows.length === 0;
      if (swarmScene && this.swarm) {
        this.els.tiltSwarmClusters.replaceChildren(
          ...clusterRows.map((r) => {
            const li = document.createElement("li");
            li.dataset.global = String(r.global);
            if (!r.basin) li.dataset.basin = "none";
            const name = document.createElement("span");
            name.className = "tc-name";
            name.textContent = r.name;
            const count = document.createElement("span");
            count.className = "tc-count mono";
            count.textContent = `×${r.count}`;
            const loss = document.createElement("span");
            loss.className = "tc-loss mono";
            loss.textContent = `L ${tiltFormatLoss(r.meanLoss)}`;
            li.append(name, count, loss);
            return li;
          }),
        );
        // Collapsed fallback (QA S2-SWARM-PANEL-OCCLUDES-CANYON): only the
        // gold global row shows — with a visible expand control.
        const collapsed = this.els.tiltPanel?.dataset.clusters === "collapsed";
        const hiddenRows = clusterRows.filter((r) => !r.global).length;
        if (collapsed && hiddenRows > 0) {
          const li = document.createElement("li");
          li.className = "tc-more";
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "btn";
          btn.textContent = `+${hiddenRows} more`;
          btn.addEventListener("click", () => {
            this.swarmClustersExpanded = true;
            if (this.els.tiltPanel) delete this.els.tiltPanel.dataset.clusters;
            this.syncTiltPanel();
          });
          li.append(btn);
          this.els.tiltSwarmClusters.append(li);
        }
      }
    }
    // The swarm dock (mounted on the VISUALIZER, bottom-left): visible only
    // on the swarm scene. Carries the landscape pills, the "run blind /
    // show map" toggle and the replay/scrub transport — the finale's
    // controls live on the canvas pane (user feedback 2026-11-13).
    if (this.els.swarmDock) {
      setHud(this.els.swarmDock, swarmScene);
      for (const b of this.els.swarmMapButtons) {
        b.dataset.on = String(b.dataset.map === this.swarmMapId);
      }
      const sw = this.swarm;
      const frac = sw ? clamp(sw.time / this.swarmFlightTotal(), 0, 1) : 0;
      if (this.els.swarmReplayBtn) {
        this.els.swarmReplayBtn.textContent = sw?.playing ? "❚❚ pause" : "▶ replay";
      }
      if (this.els.swarmScrub) {
        this.els.swarmScrub.hidden = !swarmScene;
        this.els.swarmScrub.value = String(Math.round(frac * 1000));
        // Visible playback progress ON the scrub control itself (the
        // #tilt-scrub pattern: fill gradient via --scrub-progress).
        this.els.swarmScrub.style.setProperty("--scrub-progress", frac.toFixed(3));
      }
    }
    // FUNC-CARD (show-after): tilt shows it exactly with the scorecard
    // (showScore = a DONE run — the level-complete beat); the swarm shows
    // it exactly when the blind fog is lifted (the "show map" reveal).
    // syncTiltPanel runs per frame on §7 — the sig guard keeps this free.
    this.syncFuncCard();
  }

  /* ---------------- §7: the swarm finale ---------------- */

  /** The swarm level record for the PICKED map (its landscape carries the
   *  wells list every basin consumer reads). */
  private swarmLevel(): TiltLevel {
    return swarmMapById(this.swarmMapId).level;
  }

  /** The picked map's gold basin well (canyon framing, swarm diagnostics). */
  private swarmGlobalWell(): WellSpec {
    const wells = landscapeWells(this.swarmLevel().landscape);
    return wells.find((w) => w.global === true) ?? wells[0];
  }

  /** Total flight wall-clock (last launch delay + one full ride). */
  private swarmFlightTotal(): number {
    return swarmDelay(SWARM_COUNT - 1) + SWARM_RIDE_SEC;
  }

  /** Builds (once per terrain) the 100 instanced balls + ghost trails. */
  private refreshSwarmVisuals(): void {
    if (this.built !== "swarm" || this.swarm) return;
    const level = this.swarmLevel();
    this.builtSwarmMap = this.swarmMapId;
    const sim = simulateSwarm(level);
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
    const paint = this.buildSwarmPaint(sim);
    this.swarm = {
      sim,
      mesh,
      trails,
      time: 0,
      playing: !this.frozen,
      paint,
      paintTotal: new Set(paint.flat().map((c) => c.key)).size,
      paintedIdx: sim.paths.map(() => 0),
      arrived: new Uint8Array(sim.paths.length),
      arrivedCount: 0,
    };
    this.swarmPanelSig = "";
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
   * The blind-mode paint ledger: per ball, EVERY measurement cell its drawn
   * path crosses — the start cell first (arcFrac 0), then each cell a
   * straight segment passes through, by exact grid traversal — each with the
   * progress at which the drawn ball reaches it (swarmPaintLedger, QA
   * S2-SWARM-PAINT-MISSES-CROSSED-CELLS: the vertex-only ledger left start
   * cells and every cell under a chord black under a drawn trail). S7-SWARM-
   * 3's "nothing painted at t=0" holds through the `p > 0` gate in
   * updateSwarmInstances: start cells stamp at launch.
   */
  private buildSwarmPaint(
    sim: SwarmSim,
  ): Array<Array<{ key: string; x: number; y: number; arcFrac: number }>> {
    return sim.paths.map((path) => swarmPaintLedger(this.swarmLevel(), path));
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
    let arrivedCount = 0;
    for (let i = 0; i < sw.sim.paths.length; i++) {
      const p = this.swarmProgress(i);
      const pos = samplePath(sw.sim.paths[i], p);
      this.swarmDrawPos[i] = pos;
      // Arrival (QA S2-SWARM-SCORECARD-PRECOMPUTED-SPOILER): at rest, or late
      // in the ride AND already inside its own final basin's capture
      // ellipse. Recomputed every call (no latch), so a rewind clears it.
      const b = sw.sim.basinOf[i];
      const arrived =
        p >= 1 ||
        (p >= SWARM_ARRIVE_FRAC &&
          b >= 0 &&
          swarmBasinOf(pos, landscapeWells(this.swarmLevel().landscape)) === b);
      sw.arrived[i] = arrived ? 1 : 0;
      if (arrived) arrivedCount += 1;
      this.view.parameterToWorld(pos, lift, scratch);
      this.swarmDummy.position.copy(scratch);
      this.swarmDummy.scale.setScalar(scale);
      this.swarmDummy.updateMatrix();
      sw.mesh.setMatrixAt(i, this.swarmDummy.matrix);
      const trail = sw.trails[i];
      if (trail) trail.setProgress(p);
      // "Run it blind": every cell the ball MOVES INTO stamps into the §6
      // fog mask as the ball enters it — the ensemble paints the map (start
      // cells are not pre-stamped; see buildSwarmPaint).
      if (this.swarmBlind) {
        const entries = sw.paint[i];
        let idx = sw.paintedIdx[i];
        while (p > 0 && idx < entries.length && entries[idx].arcFrac <= p) {
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
    sw.arrivedCount = arrivedCount;
    sw.mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Rewinds the flight to t=0 (the replay/restart primitive): paint ledger
   * reset, fog mask re-inited when blind, arrival counters recomputed on the
   * next instance update. The flight re-arms (or stays parked, when the
   * caller wants a scrub pose).
   */
  private rewindSwarmFlight(rearm: boolean): void {
    const sw = this.swarm;
    this.swarmPaintedKeys.clear();
    this.swarmPainted = 0;
    if (sw) {
      sw.time = 0;
      sw.playing = rearm && !this.frozen;
      sw.paintedIdx.fill(0);
      sw.arrivedCount = 0;
    }
    if (this.swarmBlind) {
      // Re-init the mask (fogReset) so re-stamping rebuilds exactly the
      // prefix the rewound flight has painted — never double-darkened.
      this.applySwarmFogMode();
    }
  }

  /**
   * Flips the blind mode and RE-RUNS the swarm cleanly: the flight rewinds
   * to t=0, the paint ledger resets, and the fog mask state is rebuilt for
   * the chosen mode (dark + cell-granular painting; or fully visible).
   */
  setSwarmBlind(on: boolean): void {
    if (this.swarmBlind === on) return;
    this.swarmBlind = on;
    if (this.swarm) {
      // Clean re-run: rewind and redraw the first frame in the new mode.
      this.rewindSwarmFlight(true);
      if (!on) {
        // V4-F1: the rewind's fog-mode arm is guarded by swarmBlind (it
        // only fogResets when turning blind ON), so the OFF path must apply
        // the mode HERE: setFogEnabled(false) is the only thing that lifts
        // the stale painted mask, and painting has already stopped (the
        // stamp guard keys on swarmBlind) — without this the frozen blind
        // mask stays on stage and show-map renders identical to blind.
        this.applySwarmFogMode();
      }
      this.updateSwarmInstances();
    } else {
      this.applySwarmFogMode();
    }
    this.swarmPanelSig = "";
    this.syncTiltPanel();
    this.view.requestRender();
  }

  /** The blind mode's live state (the dock toggle, tour gate snapshot). */
  get swarmBlindOn(): boolean {
    return this.swarmBlind;
  }

  /**
   * ?shot=fogswarm boot preset: blind is already the default — this pins the
   * EARLIER frozen pose so the terrain reads as PARTIALLY painted.
   */
  presetSwarmBlind(on: boolean): void {
    if (on) this.swarmBlind = on;
    this.swarmPoseProgress = on ? FOGSWARM_FROZEN_PROGRESS : null;
  }

  /**
   * ?shot=swarm&map=… boot preset: setSwarmMap early-returns in frozen mode
   * (it rebuilds a LIVE flight), so a deep-linked shot pins the PICKED
   * country before boot builds the scene — the build reads swarmLevel(),
   * which reads swarmMapId (see the "swarm" branch of the landscape switch).
   */
  presetSwarmMap(id: SwarmMapId): void {
    this.swarmMapId = swarmMapById(id).id; // swarmMapById throws on unknown
  }

  /**
   * Swarm landscape pill input (user feedback 2026-11-13: MORE maps): swaps
   * the terrain in place, rebuilds the sim + clusters + paint ledger, and
   * restarts the flight from t=0. The rule of the section is untouched —
   * only the country changes.
   */
  setSwarmMap(id: SwarmMapId): void {
    if (this.frozen || this.scene !== "swarm") return;
    if (id === this.swarmMapId && this.builtSwarmMap === id) return;
    this.swarmMapId = swarmMapById(id).id;
    this.clearSwarmVisuals();
    if (this.built === "swarm" && this.builtSwarmMap !== id) {
      this.view.setLandscape(this.swarmLevel().landscape);
      this.minimap.setLandscape(this.swarmLevel().landscape);
      this.builtSwarmMap = id;
      // Same-grid rebuilds REUSE the terrain material — bind the fog state
      // for the new terrain explicitly (the new map must not inherit the old
      // mask/lift). Handles both modes: opaque + reset when blind, empty
      // texture + lift 1 when visible.
      this.applySwarmFogMode();
    }
    this.hudNudgeDirty = true;
    this.swarmNudgeSig = "";
    this.refreshSwarmVisuals();
    this.updateDependents();
    this.view.requestRender();
  }

  /** ▶/❚❚ on the dock: pause a flying swarm; resume mid-flight; restart
   *  from t=0 when parked at the end (the tilt ghost's contract). */
  swarmReplay(): void {
    if (this.scene !== "swarm" || this.frozen || !this.swarm) return;
    const sw = this.swarm;
    if (sw.playing) {
      sw.playing = false;
    } else if (sw.time >= this.swarmFlightTotal()) {
      this.rewindSwarmFlight(true);
    } else {
      sw.playing = true;
    }
    this.swarmPanelSig = "";
    this.updateSwarmInstances();
    this.syncTiltPanel();
    this.view.requestRender();
  }

  /** ↻ on the dock: restart the flight from t=0 and let it fly. */
  restartSwarmFlight(): void {
    if (this.scene !== "swarm" || this.frozen || !this.swarm) return;
    this.rewindSwarmFlight(true);
    this.updateSwarmInstances();
    this.swarmPanelSig = "";
    this.syncTiltPanel();
    this.view.requestRender();
  }

  /**
   * Scrubber input: parks the flight at `frac` of the flight timeline
   * (swarm.time ↔ every ball's own per-path progress, via swarmProgress).
   * Scrubbing backward re-paints the blind map from scratch (fogReset + a
   * full re-stamp of the prefix), so the painted ledger always matches
   * exactly what the drawn flight has covered.
   */
  setSwarmScrub(frac: number): void {
    if (this.scene !== "swarm" || this.frozen || !this.swarm) return;
    const sw = this.swarm;
    const f = clamp(frac, 0, 1);
    const backward = f < sw.time / this.swarmFlightTotal();
    // Backward + blind: reset the paint ledger + fog mask FIRST (the rewind
    // zeroes sw.time), THEN park at the scrub target. The old order set
    // sw.time from the scrub and only then called the rewind, whose
    // sw.time = 0 clobbered the target — every backward drag snapped the
    // flight home and wiped the painted map (QA SWARM-MAPS-BWD-SCRUB-
    // REWINDS-TO-ZERO). The updateSwarmInstances below re-stamps the blind
    // prefix up to f (per-ball paint entries with arcFrac ≤ each ball's own
    // progress), so the parked pose matches the parked fraction exactly.
    if (backward && this.swarmBlind) {
      this.rewindSwarmFlight(false);
    }
    sw.time = f * this.swarmFlightTotal();
    sw.playing = false; // scrubbing parks the flight (the tilt-scrub pattern)
    this.updateSwarmInstances();
    this.swarmPanelSig = "";
    this.syncTiltPanel();
    this.view.requestRender();
  }

  /** Everything the swarm put on stage (picker switch / leaving §7). */
  private clearSwarmVisuals(): void {
    if (this.swarm) {
      for (const t of this.swarm.trails) t.dispose();
      this.view.removeOverlayObject(this.swarm.mesh);
      this.swarm = null;
    }
    this.swarmPaintedKeys.clear();
    this.swarmPainted = 0;
    this.swarmPanelSig = "";
    this.swarmDrawPos = [];
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
      // §6's reveal leaves view.fogLift at 1 and nothing outside fog scenes
      // resets it — without this, the opaque blind mask renders fully lifted
      // and the whole map leaks in any post-§6 session (QA
      // S2-SWARM-BLIND-ENTRY-UNFOGGED round 2). Only the view field resets;
      // val("fogrev") stays 1 so a §6 re-entry re-binds instantly.
      this.view.setFogReveal(0);
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
    this.clearSwarmVisuals();
    this.view.setElevationClamp(null);
    setHud(this.els.tiltPanel, false);
    setHud(this.els.swarmDock, false);
    if (this.els.tiltPanel) delete this.els.tiltPanel.dataset.clusters;
    this.swarmClustersExpanded = false;
    this.swarmNudgeSig = "";
    // Scene exit: the run-scoped fog dies with the section. Field-only on
    // purpose — every non-§7 target is a DIFFERENT landscape family, so
    // rebuildNow's setFogEnabled(false) runs on the fresh material; calling
    // it HERE would un-fog the outgoing fogged terrain mid-fade (the
    // F26-FOG-AB-FLASH class of bug).
    this.tiltFogArmed = false;
    this.tiltFogReady = false;
    this.tiltFogFrom = null;
    this.tiltFogStamps = 0;
  }

  /* ---------------- §7 fog of war (run-scoped) ---------------- */

  /**
   * Re-arms the run-scoped fog of war: every fresh attempt (play-scene
   * entry, level swap, Restart) begins on a DARK board. The mask itself
   * initializes here when the tilt terrain is already the built one
   * (same-family transitions — zero un-fogged frames), otherwise at the
   * rebuild (initTiltFogMaskIfNeeded is re-entered from rebuildNow and
   * refreshTiltVisuals).
   */
  private armTiltFog(): void {
    this.tiltFogArmed = true;
    this.tiltFogReady = false;
    this.tiltFogFrom = null;
    this.tiltFogStamps = 0;
    this.initTiltFogMaskIfNeeded();
  }

  /**
   * Enables fog + resets the mask opaque on the CURRENT tilt terrain, then
   * stamps what the run has already walked: a fresh run is just the start
   * patch; the frozen curated shots (?shot=tilt-a) arrive pre-played, so
   * their visited cells paint in here (the initFogMaskIfNeeded precedent).
   * No-op unless a run-scoped fog is armed AND the built terrain is this
   * level's — never touches the fog game's or the swarm's fog state.
   */
  private initTiltFogMaskIfNeeded(): void {
    if (!this.tiltFogArmed || this.tiltFogReady) return;
    const run = this.tiltRun;
    if (this.scene !== "tilt-a" || !run) return;
    if (this.built !== "tilt" || this.builtTilt !== this.tiltLevel.id) return;
    this.tiltFogReady = true;
    this.view.setFogEnabled(true);
    this.view.fogReset();
    // Blind means blind: any in-flight reveal tween from a previous run is
    // snapped off (this view uniform is tilt-owned while armed). The CONTOUR
    // reveal joins it — contours and the height-following axis frame ride
    // contourRevealK, and at 1 they drew the hidden landscape's structure
    // straight through the blacked-out board (QA TILTFOG-CONTOUR-OVER-FOG;
    // §6's entry and the blind swarm set this to 0 for the same reason).
    // liftTiltFog / teardownTiltFog restore it with the map.
    this.view.setFogReveal(0);
    this.view.setContourReveal(0);
    // The x-y compass goes blind WITH the board: its contour ghost draws the
    // full landscape — a complete 2D map of the terrain the 3D pane hides
    // (QA TILTFOG-MINIMAP-GHOST-LEAK; §6 drives this same fog mode at
    // updateFogDependents). The visited glow rides the REAL painted radius,
    // fog.path is the live run recording (drawn as the player's own faint
    // track — private memory, not a map), and reach 0 hides §6's stride ring
    // (tilt is real-time; the ring is the fog game's stride instrument).
    // Cleared at the reveal (liftTiltFog) and on teardown (teardownTiltFog /
    // rebuildNow).
    this.minimap.setFog({
      path: run.rec,
      reach: 0,
      stampR: TILT_FOG_STAMP_FRAC * tiltDiag(this.tiltLevel),
      done: run.done,
      cells: tiltMinimapCells(this.tiltLevel),
    });
    // Start patch + every already-visited measurement cell (cells[0] IS the
    // start point, so the loop runs from 1 — no double stamp).
    this.view.fogStampAt(run.rec[0], TILT_FOG_STAMP_FRAC);
    this.tiltFogStamps = 1;
    const e = this.tiltLevel.landscape.extent;
    const w = tiltDiag(this.tiltLevel) * this.tiltLevel.cellFrac;
    for (let i = 1; i < run.cells.length && this.tiltFogStamps < TILT_FOG_STAMP_MAX; i++) {
      const c = run.cellAt[i];
      const key = run.cells[i];
      const p =
        c ??
        (() => {
          const bar = key.indexOf("|");
          return {
            x: e.xMin + (Number(key.slice(0, bar)) + 0.5) * w,
            y: e.yMin + (Number(key.slice(bar + 1)) + 0.5) * w,
          };
        })();
      this.view.fogStampAt(p, TILT_FOG_STAMP_FRAC);
      this.tiltFogStamps += 1;
    }
    this.tiltFogFrom = { ...run.pos };
  }

  /**
   * Paint-on-roll: fog stamps along the segment covered since the last
   * flush. The tilt tick calls this once per frame while the ball moves
   * (the §6 walk's per-frame stamping precedent) — a vmax-bounded frame
   * never needs more than one or two discs.
   */
  private stampTiltFogTo(p: Vec2): void {
    if (!this.tiltFogArmed || !this.tiltFogReady) return;
    const from = this.tiltFogFrom ?? p;
    this.view.fogStampSegment(from, p, TILT_FOG_STAMP_FRAC);
    this.tiltFogStamps += 1;
    this.tiltFogFrom = { ...p };
  }

  /**
   * The run-scoped fog's reveal beat: the run ended (came to rest on quiet
   * ground, or Finish). The final covered segment flushes, then the map
   * opens fully so the scorecard's machine race reads against the whole
   * terrain — §6's reveal, in tilt's instant idiom (no per-frame uniform
   * driver exists on tilt scenes). The fog STATE resets: the next attempt
   * re-arms from scratch.
   */
  private liftTiltFog(): void {
    if (!this.tiltFogArmed) return;
    if (this.tiltFogReady && this.tiltRun) {
      this.stampTiltFogTo(this.tiltRun.pos);
      // The reveal beat opens EVERYTHING the arm gated (§6's fogrev 0→1
      // pattern): the fog itself, the contours + height-following axis
      // frame (contourRevealK), and the x-y compass's fog mode — the ghost
      // returns exactly here, with the map (QA TILTFOG-*).
      this.view.setFogReveal(1);
      this.view.setContourReveal(1);
      this.minimap.setFog(null);
    }
    this.tiltFogArmed = false;
    this.tiltFogFrom = null;
  }

  /**
   * Tears the run-scoped fog down (tilt-b's reveal, the swarm, scene exit).
   * Disables the view's fog sampling ONLY when no crossfade is about to
   * retire the outgoing fogged terrain — setFogEnabled(false) mid-fade
   * would flash the full landscape while the old copy sinks (the
   * F26-FOG-AB-FLASH class; rebuildNow disables on the fresh material).
   */
  private teardownTiltFog(): void {
    const crossfadePending =
      !this.frozen && this.built !== null && this.built !== SCENES[this.scene].landscape;
    if (!crossfadePending && this.view.fogOn) {
      this.view.setFogEnabled(false); // also restores contourRevealK = 1
    }
    // The x-y compass leaves fog mode with the section — but like §6
    // (clearFogStage's outgoingRetired rule), NOT mid-crossfade: the
    // minimap still shows the OUTGOING landscape until the rebuild swaps
    // it, and dropping the fog here would flash that landscape's contour
    // ghost while the fogged board sinks (the F26-FOG-AB-FLASH class).
    // rebuildNow clears it when the fresh landscape binds.
    if (!crossfadePending) this.minimap.setFog(null);
    this.tiltFogArmed = false;
    this.tiltFogReady = false;
    this.tiltFogFrom = null;
    this.tiltFogStamps = 0;
  }

  /** Refs whose GPU resources setLandscape already disposed. */
  private dropTiltRefs(): void {
    this.tiltStamps = null;
    this.tiltStampKeys = new Set();
    this.tiltStampCount = 0;
    this.tiltLiveTrail = null;
    this.tiltLiveBuilt = 0;
    this.tiltGhost = null;
    this.tiltMachineTrails = [];
    this.tiltMachineBalls = [];
    this.tiltMachinePos = [];
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
    /** FIX diagnostics: the reveal's visible BALL count (player ghost +
     *  the three machine balls) and each ball's current parameter position
     *  (player first, then machines) — the replay races balls, not lines. */
    revealBalls: number;
    revealBallPos: Vec2[];
    stamps: number;
    /** §7 fog of war: the view's fog sampling bound (the tilt board owns it
     *  while a run is armed; the blind swarm / fog game own it elsewhere). */
    fogOn: boolean;
    /** Fog reveal: 0 = the board is dark, 1 = fully lifted (run's reveal). */
    fogLift: number;
    /** Fog stamps spent this run (paint-on-roll ledger; resets with the fog). */
    fogStamps: number;
    machines: Array<{ label: string; steps: number; reached: boolean; settled: boolean; finalLoss: number; cells: number }> | null;
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
      revealBalls:
        (this.tiltGhost ? 1 : 0) +
        this.tiltMachineBalls.filter((l) => l.ball.visible).length,
      revealBallPos:
        this.tiltGhost !== null
          ? [this.tiltGhostPos, ...this.tiltMachinePos.map((p) => ({ ...p }))]
          : [],
      stamps: this.tiltStamps ? this.tiltStampCount : 0,
      fogOn: this.view.fogOn,
      fogLift: this.view.fogReveal,
      fogStamps: this.tiltFogStamps,
      machines: this.tiltMachineRuns
        ? this.tiltMachineRuns.map((m) => ({
            label: m.label,
            steps: m.steps,
            reached: m.reached,
            settled: m.settled,
            finalLoss: m.finalLoss,
            cells: m.cells,
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
    total: number;
    scrub: number;
    playing: boolean;
    blind: boolean;
    painted: number;
    paintedTotal: number;
    stamps: number;
    clusters: Array<{ name: string; count: number; meanLoss: number; global: boolean }>;
    arrived: number;
    minimaFound: number;
    /** The picked swarm map id (the dock's landscape pills). */
    map: SwarmMapId;
    /** Framing diagnostics (QA S2-SWARM-PANEL-OCCLUDES-CANYON). */
    nudge: { x: number; y: number };
    clustersCollapsed: boolean;
    canyonScreenBox: { l: number; t: number; r: number; b: number } | null;
    panelRect: { l: number; t: number; r: number; b: number } | null;
  } | null {
    if (!this.swarm) return null;
    const w0 = this.swarmGlobalWell();
    const c0 = Math.cos((w0.thetaDeg * Math.PI) / 180);
    const s0 = Math.sin((w0.thetaDeg * Math.PI) / 180);
    let cb: { l: number; t: number; r: number; b: number } | null = { l: Infinity, t: Infinity, r: -Infinity, b: -Infinity };
    for (let k = 0; k < 24 && cb; k++) {
      const th = (k / 24) * Math.PI * 2;
      const u = 0.7 * w0.a * Math.cos(th);
      const v = 0.7 * w0.b * Math.sin(th);
      const sp = this.view.projectParamToScreen({ x: w0.x + u * c0 - v * s0, y: w0.y + u * s0 + v * c0 });
      if (!sp) { cb = null; break; }
      cb = { l: Math.min(cb.l, sp.x), t: Math.min(cb.t, sp.y), r: Math.max(cb.r, sp.x), b: Math.max(cb.b, sp.y) };
    }
    const pr = this.els.tiltPanel?.getBoundingClientRect();
    const sw = this.swarm;
    const wells = new Set<number>();
    sw.sim.basinOf.forEach((b, i) => {
      if (b >= 0 && sw.arrived[i]) wells.add(b);
    });
    return {
      nudge: { ...this.hudNudgeApplied },
      clustersCollapsed: this.els.tiltPanel?.dataset.clusters === "collapsed",
      canyonScreenBox: cb,
      panelRect: pr ? { l: pr.left, t: pr.top, r: pr.right, b: pr.bottom } : null,
      arrived: sw.arrivedCount,
      minimaFound: wells.size,
      balls: this.swarm.sim.paths.length,
      settled: this.swarm.sim.settledCount,
      minima: this.swarm.sim.minimaFound,
      time: this.swarm.time,
      total: this.swarmFlightTotal(),
      scrub: clamp(this.swarm.time / this.swarmFlightTotal(), 0, 1),
      playing: this.swarm.playing,
      blind: this.swarmBlind,
      painted: this.swarmPainted,
      paintedTotal: this.swarm.paintTotal,
      stamps: this.view.fogStamps,
      clusters: this.swarmClusterRows(),
      map: this.swarmMapId,
    };
  }

  /* ---------------- §8: the optimizer workbench ---------------- */

  /** Landscape pill input: swap the terrain in place, re-run the benchmark.
   *  The rule itself is untouched — THAT is the no-free-lunch beat (the same
   *  rule, a different landscape, a flipped verdict). */
  setRuleLevel(id: RuleLevelId): void {
    if (this.frozen || this.scene !== "labrule") return;
    if (id === this.ruleLevel && this.builtRule === id) return;
    this.noteRuleChange("level");
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
    this.noteRuleChange("part");
    this.ruleCfg = { ...this.ruleCfg, ...part };
    this.syncRulePanel();
    this.pendingRule = true;
    this.view.requestRender();
  }

  /**
   * Records WHAT triggered the coming rebuild and whether the custom rule was
   * winning BEFORE it (QA S8-VERDICT-WRONG-CAUSE). Recorded at the change,
   * not at rebuild time, so scene-entry / coalesced rebuilds of an unchanged
   * benchmark keep the last real cause.
   */
  private noteRuleChange(cause: "level" | "part"): void {
    this.rulePrevCustomWon = this.ruleRuns !== null && ruleCustomWins(this.ruleRuns);
    this.ruleLastChange = cause;
  }

  /** Re-runs the four-way benchmark and redraws trails + scorecards. */
  private rebuildRuleVisuals(): void {
    this.clearReplayVisuals();
    this.clearRuleVisuals();
    if (this.built !== "rule" || this.builtRule !== this.ruleLevel) return;

    const bench = ruleBenchmark(this.ruleLevel, this.ruleCfg);
    this.ruleRuns = bench;
    const runs = [bench.custom, ...bench.machines];
    // Draw only the in-bounds prefix of every path (QA S8-DIVERGE-STREAKS):
    // a diverged rule's huge-but-finite points overflow the Float32 line
    // buffers (NaN bounding sphere) or streak across the plot. The raw run
    // still feeds the scoreboard ("diverged" / DNF).
    const level = ruleLevelById(this.ruleLevel);
    const shown = runs.map((r) => ruleDisplayPath(level, r.path));
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
      runs.map((r, i) => ({ points: shown[i], color: cssOf(r.key) })),
    );
    runs.forEach((r, i) => {
      if (shown[i].length >= 2) {
        const t = new AnimatedTrail(this.view, shown[i], colorOf(r.key));
        t.setProgress(1);
        t.setAlpha(1);
        this.ruleTrails.push(t);
      }
    });
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

    const verdict = this.ruleVerdictText(bench);
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

  /** The scoreboard's one-line read of WHO won and WHY the ranking moved —
   *  the cause (pill vs part) decides the sentence (ruleVerdictSentence),
   *  and an unchanged re-render reuses the cached text. The cache key is the
   *  EXACT (level, config) the benchmark ran with, not the rounded parts
   *  label (QA S8SW2-VERDICT-CACHE-STALE / S8-SWEEP2-STALE-VERDICT). */
  private ruleVerdictText(bench: RuleBenchmark): string {
    const cfgKey = ruleVerdictKey(bench.level, bench.config);
    const prev = this.ruleVerdictPrev;
    if (prev && prev.level === bench.level && prev.cfgKey === cfgKey) {
      return prev.text;
    }
    const text = ruleVerdictSentence(bench, this.ruleLastChange, this.rulePrevCustomWon);
    this.ruleVerdictPrev = { level: bench.level, cfgKey, text };
    return text;
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
        `${level.name} · converge < L ${ruleFormatLoss(level.threshold)}`;
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
    // FUNC-CARD: §8's card swaps with the landscape pills (an OPEN section —
    // live for the whole scene).
    this.syncFuncCard();
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
    // Draw after the terrain: same-depth transparent sort buried the halo
    // once the terrain reached full opacity (QA F26-EPI-HALO-BURIED).
    halo.renderOrder = 3;
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
        const { pos } = this.replayLanePose(lane.path, p);
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
    this.replay = { player, maxSteps, group, lanes: laneViews };
    this.replayPaused = false;
    // Duplicate-raster dedupe (QA LP-1): the replay trails progressively
    // redraw the SAME polylines the static trails already show — hide the
    // statics while the replay runs (clearedReplayVisuals restores them).
    if (this.scene === "lab" && this.labTrails.length === laneViews.length) {
      this.labTrails.forEach((t) => t.setVisible(false));
    } else if (
      this.scene === "labrule" &&
      this.ruleTrails.length === laneViews.length
    ) {
      this.ruleTrails.forEach((t) => t.setVisible(false));
    }
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
      } else if (this.fogGhostsFinished()) {
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
  /** Scrub motion tier idle timer (QA SCRUB-HITCH): keyboard arrow scrubbing
   *  has no pointer events, so setReplayScrub re-arms the tier itself. */
  private scrubTierTimer = 0;

  /** §5 slider motion tier idle timer (QA PERF25-S2-LAB-REBUILD-LONGTASKS):
   *  armed by setLab and re-armed by the onFrame live-rebuild throttle. */
  private labTierTimer = 0;

  /** Software-GL motion tier (QA SCRUB-HITCH): forwards to the view; no-op
   *  on hardware GL. */
  setScrubTier(on: boolean): void {
    this.view.setMotionTier(on);
  }

  setReplayScrub(frac: number): void {
    if (!this.replayAvailable) return;
    const f = clamp(frac, 0, 1);
    // Keyboard scrubbing has no pointerdown/up: arm the motion tier here and
    // release it after ~200ms of scrub idle (QA SCRUB-HITCH round 2).
    this.view.setMotionTier(true);
    clearTimeout(this.scrubTierTimer);
    this.scrubTierTimer = window.setTimeout(() => this.setScrubTier(false), 200);
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
        const sl = p * Math.max(0, lane.path.length - 1);
        const pos = samplePathAtStep(lane.path, sl);
        this.view.parameterToWorld(
          pos,
          this.view.trailLift + this.view.diagonal * 0.016,
          lane.ball.position,
        );
        lane.ball.visible = lane.delay <= 0 && p > 0;
        lane.trail.setStep(sl);
      }
    } else if (this.replay) {
      this.replayPaused = true;
      this.replay.player.pause();
      this.replay.player.setFraction(f);
      for (const lane of this.replay.lanes) {
        const { pos, s } = this.replayLanePose(lane.path, f);
        this.view.parameterToWorld(
          pos,
          this.view.trailLift + this.view.diagonal * 0.016,
          lane.ball.position,
        );
        lane.ball.visible = f > 0;
        lane.trail.setStep(s);
      }
      this.syncTransportProgress(f, true); // scrub tracking is 1:1 (QA LP-2)
    }
    this.syncTransport();
    this.view.requestRender();
  }

  /** One lane's pose on the shared step clock: s = p·maxSteps, clamped to
   *  the lane's own length (a shorter lane waits at its end). */
  private replayLanePose(path: Vec2[], p: number): { pos: Vec2; s: number } {
    const maxSteps = this.replay?.maxSteps ?? Math.max(0, path.length - 1);
    const s = Math.min(clamp(p, 0, 1) * maxSteps, Math.max(0, path.length - 1));
    return { pos: samplePathAtStep(path, s), s };
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
      // Clipped exactly at the terrain edge (QA S2-ADAM-1): at ×50 GD's
      // first step is 45 long and the raw lane ran out over the void.
      const e = adamBowl(steepness).extent;
      const shown = (p: Vec2[]): Vec2[] => clipPathToExtent(p, e);
      return [
        { path: shown(runAdamLane(steepness, "gd")), trailColor: OPTIMIZER_COLORS.gd, ballColor: OPTIMIZER_COLORS.gd },
        { path: shown(runAdamLane(steepness, "adam")), trailColor: OPTIMIZER_COLORS.adam, ballColor: OPTIMIZER_COLORS.adam },
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
      // Same in-bounds display prefix as the static trails (QA
      // S8-DIVERGE-STREAKS): the transport must not rebuild NaN geometry.
      const level = ruleLevelById(b.level);
      const shown = (path: Vec2[]): Vec2[] => ruleDisplayPath(level, path);
      return [
        { path: shown(b.custom.path), trailColor: OPTIMIZER_COLORS.custom, ballColor: OPTIMIZER_COLORS.custom },
        { path: shown(b.machines[0].path), trailColor: OPTIMIZER_COLORS.gd, ballColor: OPTIMIZER_COLORS.gd },
        { path: shown(b.machines[1].path), trailColor: OPTIMIZER_COLORS.momentum, ballColor: OPTIMIZER_COLORS.momentum },
        { path: shown(b.machines[2].path), trailColor: OPTIMIZER_COLORS.adam, ballColor: OPTIMIZER_COLORS.adam },
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
    // The tier must never outlive its replay (QA SCRUB-HITCH). The §5 lab
    // tier likewise: a replay's lanes must not render under the ghosting
    // motion tier (QA PERF25-S2-LAB-REBUILD-LONGTASKS).
    clearTimeout(this.scrubTierTimer);
    clearTimeout(this.labTierTimer);
    this.setScrubTier(false);
    // Bring the static trails back — the dedupe hid them for the replay
    // (QA LP-1). rebuildLabVisuals recreates them visible, so a rebuild
    // needs no extra handling.
    if (this.scene === "lab") this.labTrails.forEach((t) => t.setVisible(true));
    if (this.scene === "labrule") this.ruleTrails.forEach((t) => t.setVisible(true));
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
      // A FINISHED ride (played out, skip-landed, or scrubbed to the end)
      // reads '▶ Play' — the next click relaunches from the top. Paused
      // mid-ride reads '▶ Resume'. fogGhostsFinished is the SAME predicate
      // toggleReplay uses, so the label and the action can never disagree
      // (QA transport-finished-label-resume).
      const finished =
        this.scene === "fog-c"
          ? this.fogGhostsFinished()
          : this.replay?.player.finishedOnce === true;
      const paused = started && !playing && !finished;
      this.els.playBtn.textContent = playing
        ? "❚❚ Pause"
        : finished
          ? "▶ Play"
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
      // The shared `input.scrub` fill gradient reads --scrub-progress (same
      // pattern as #tilt-scrub); it was never written here, so the bar's
      // fill sat at 0% (QA transport-scrub-no-fill).
      this.els.replayScrub.style.setProperty("--scrub-progress", k.toFixed(3));
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
    // §7 reveal: the ghost ball casts its own spot — and so does every
    // machine ball (FIX: the reveal races balls, not lines).
    if (this.scene === "tilt-b" && this.tiltGhost) {
      const t = this.view.heightFrac(this.tiltGhostPos);
      list.push({
        pos: this.tiltGhostPos,
        radiusFrac: 0.016 * (0.85 + 0.5 * t),
        opacity: 0.38 - 0.24 * t,
      });
      for (const mp of this.tiltMachinePos) {
        const tm = this.view.heightFrac(mp);
        list.push({
          pos: mp,
          radiusFrac: 0.016 * (0.85 + 0.5 * tm),
          opacity: 0.38 - 0.24 * tm,
        });
      }
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

  /** True while the reader hovers/focuses the §3 mom-apexes look span. */
  private momApexLookActive(): boolean {
    const id = this.lookId;
    return id !== null && LOOK_TARGETS[id]?.target.kind === "momApex";
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
      case "fog": return this.els.fogPanel;
      case "tilt": return this.els.tiltPanel;
      case "rule": return this.els.rulePanel;
      case "swarmDock": return this.els.swarmDock;
      case "funcCard": return this.els.funcCard;
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
      // TOUR-POINT-S4-BARS-READOUT / TOUR-POINT-S7-SCRUBBER-SCORECARD: child/
      // part targets narrow ONLY the leader anchor — the spotlight stays at
      // panel level (the sentences say "In the panel…" / name the panel's
      // controls; the rows live inside the panel glow, like "needle" and its
      // minimap).
      case "panelChild": {
        this.spotPanel(t.panel, 0.45, 0.4);
        break;
      }
      case "panelPart": {
        this.spotPanel(t.panel, 0.45, 0.4);
        break;
      }
      case "tiltLevels": {
        // Spotlight the tilt panel like "panel", then glow the pills row too
        // so the spotlight singles out the level row the sentence names
        // (U5-POINT-LEVELS). clearLookNow already strips data-spot from
        // every spotPanels entry, so cleanup stays generic.
        if (!this.spotPanel("tilt", 0.45, 0.4)) return;
        const pills = this.els.tiltLevels;
        if (pills) {
          pills.dataset.spot = "true";
          this.spotPanels.push(pills);
        }
        break;
      }
      case "control": {
        // A reader-side DOM control by id (U1-POINT-ETA): glow it through
        // the generic data-spot cleanup. Deliberately NO markSceneFocus /
        // setFocusDim / spotlightAt — the target is reader DOM, not a scene
        // object, so the scene stays undimmed (lookState: active, no
        // sceneDim/ring) and the leader points into the reader panel.
        const el = document.getElementById(t.el);
        if (!(el instanceof HTMLElement) || el.getClientRects().length === 0) return;
        el.dataset.spot = "true";
        this.spotPanels.push(el);
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
      case "ensemble": {
        // §7's swarm finale: the single learner ball is OFF stage here (the
        // 100 instanced balls replace it), so the spotlight keeps the whole
        // instanced mesh bright and the ring tracks a representative member
        // (the first ball — the leader overlay anchors the same point).
        if (this.scene !== "swarm" || !this.swarm || this.swarmDrawPos.length === 0) return;
        this.markSceneFocus();
        this.view.setFocusDim({ terrain: 0.26, overlay: 0.2, keep: [this.swarm.mesh] });
        this.view.spotlightAt(this.swarmDrawPos[0], MANIM.white, 0.05);
        this.lookPointFn = (): Vec2 | null => this.swarmDrawPos[0] ?? null;
        break;
      }
      case "gdStep": {
        // No reveal before the learner commits an arrow (QA
        // S2A-GDSTEP-LOOK-PRECOMMIT): GD's answer is the bet's payoff. A hover
        // held through the commit lights up on its own (onArrowCommit →
        // updateGdArrows → reapplyLook).
        if (this.scene !== "gd-b" || this.built !== "bowl" || this.gdTipFull === null) return;
        this.markSceneFocus();
        this.view.setFocusDim({ terrain: 0.3, overlay: 0.22, keep: [...this.arrowHandles] });
        const tip = this.gdTipFull;
        this.view.spotlightAt(tip, MANIM.red, 0.042);
        this.lookPointFn = (): Vec2 | null => this.gdTipFull;
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
        // A finished fade hides the markers — relight them for as long as
        // the hover lasts (the fade loop holds while this look is active,
        // and decays again once the pointer leaves). The focus base-opacity
        // cache is refreshed BEFORE setFocusDim: a value cached mid-fade
        // must not restore a faded marker.
        if (!this.frozen) {
          // Live: full brightness for the hover (also mid-fade). Frozen
          // poses never fade and keep their 0.95 material opacity.
          this.momHighlight.visible = true;
          if (this.momHighlightMat) this.momHighlightMat.opacity = 0.9;
          this.momHighlightT = 1;
        }
        if (this.momHighlightMat) {
          this.view.refreshFocusBaseOpacity(this.momHighlightMat);
        }
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
      case "lattice": {
        // §9's parameter lattice (epi-b/c): glow the vast point cloud's
        // heart — the surface is a ghost under it, so the terrain dim stays
        // shallow and the ring sits at the plane's center.
        if (this.epiLattice === null) return;
        this.markSceneFocus();
        this.view.setFocusDim({ terrain: 0.3, overlay: 0.18, keep: null });
        const c = latticeCenter();
        this.view.spotlightAt(c, MANIM.white, 0.05);
        this.lookPointFn = (): Vec2 => c;
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
    // The ball x-ray ghost belongs to tilt-a's live ball only (QA
    // S7-SW2-RASTR-BALL-OCCLUDED part B): every other scene's baseline stays.
    this.view.setBallXray(name === "tilt-a" && !this.frozen);
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

    // Reset the footer transport to the incoming scene's state. The fog-c
    // ghost race lives outside this.replay, so clearReplayVisuals() returns
    // early and never resyncs; without this, fog-c's label, scrub and fill
    // carried into the next transport scene (QA TP2-FOGC-STALE-CARRY).
    // Entry paths that build a ride/ghosts below overwrite it.
    this.syncTransport();

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
      // The session run SURVIVES the swarm (QA S7-SW2-SWARM-BACK-LOSES-RUN):
      // back on tilt-b the reader's own run is graded, not the curated demo.
      // clearTiltStage already took everything off stage; a non-null run is
      // inert outside tilt-a/tilt-b. The machine race cache goes with the
      // stage and is recomputed for the current level on return (QA
      // SW2-TILTB-STALE-MACHINE-TRAILS).
      this.clearTiltStage();
      this.tiltMachineRuns = null;
      // The run-scoped fog dies with tilt-a. rebuildNow disables the view's
      // fog on the landscape change, then applySwarmFogMode re-arms it for
      // the blind ensemble — the tilt ledger never reaches the finale.
      this.teardownTiltFog();
      return;
    }

    if (name === "tilt-b") {
      // The reveal page is §7's post-reveal state: the map reads whole (the
      // machine race + ghost need the full terrain). Same-family tilt-a →
      // tilt-b has no rebuild, so the disable must happen HERE; a crossfade
      // (swarm → tilt-b) defers it to rebuildNow (teardownTiltFog guards).
      this.teardownTiltFog();
    }

    if (instant && this.frozen) {
      // Deterministic shot poses (?shot=tilt-a / ?shot=tilt-b).
      if (name === "tilt-a") {
        this.tiltLevel = TILT_VALLEY;
        this.tiltRun = tiltCuratedRun(TILT_VALLEY, TILT_DEFAULT_FRICTION, {
          frac: TILT_A_FROZEN_FRAC,
        });
        // The frozen poster is a MID-RUN pose: its fog of war arms here and
        // paints the curated ride's visited cells at the rebuild
        // (initTiltFogMaskIfNeeded) — the shot shows a half-explored board.
        this.armTiltFog();
      } else {
        this.tiltLevel = TILT_ROSEN;
        this.tiltRun = tiltCuratedRun(TILT_ROSEN, TILT_DEFAULT_FRICTION);
      }
      // A swapped run/level never keeps another level's race (QA
      // SW2-TILTB-STALE-MACHINE-TRAILS).
      this.tiltMachineRuns = null;
      this.clearTiltReveal();
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
        // The demo is graded against ITS level's machines, not a stale
        // valley race (QA SW2-TILTB-STALE-MACHINE-TRAILS / S7-SW2-SWARM-
        // BACK-LOSES-RUN part 2).
        this.tiltMachineRuns = null;
        this.clearTiltReveal();
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
      // The old run's discs and live trail must go too: the level is
      // unchanged, so no setLandscape clears them (QA
      // S7-SW2-BACKNAV-STALE-STAMPS-TRAIL).
      this.resetTiltRunVisuals();
      // Every fresh attempt starts blind: fog re-arms with the run (per
      // level, per restart, per re-entry).
      this.armTiltFog();
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
    this.fogQueued = null;
    this.fogPreviewTip = null;

    if (name === "fog-a" || name === "fog-b") {
      // A landscape crossfade (fog-a ↔ fog-b) keeps the OUTGOING level's
      // revealed surface, marker and compass on stage until the swap-in
      // rebuild (QA S2-FOG-AB-REVEAL-REFOGS): reset the view's fog uniforms
      // there (initFogMaskIfNeeded), not here.
      const crossfade =
        !instant && this.built !== null && this.built !== SCENES[name].landscape;
      // T6-S6-BACK-RESETS-FINISHED-FOG-RUN: capture the outgoing run BEFORE
      // clearFogStage (which archives only used > 0 runs into fogRbResult,
      // missing the bare-Finish flavor). A BACKWARD instant re-entry of
      // fog-b (fog-c → Back, or a backward rail jump) is a REVIEW of the run
      // just played — restore it instead of wiping to a fresh game (the §6
      // twin of S2-FOG-RUN-LOST-ON-RETURN's fogRbResult restore and §7's
      // SW2-SWARM-BACK-LOSES-RUN; fog-c always forces done=true, so
      // prevSt.done here means "the revealed, finished run"). Forward
      // fog-a→fog-b stays a fresh game (prevLevel is 'ls'); boot has no
      // previous state; ?shot=fog-b is handled by the frozen branch below.
      // An EMPTY finished run (used = 0 — the bare-Finish flavor fog-c's
      // #fog-goto-l2 lead ships an inline jump for) has nothing to review:
      // restoring it lands the reader on a finished, revealed, read-only
      // board where the promised fresh level-2 run is impossible (QA INT-1),
      // so the restore skips it and fogInit re-arms a playable game — the
      // same state the fog-a→fog-b forward path would give.
      const prevSt = this.fogSt;
      const prevLevelId = this.fogLevel?.id ?? null;
      const restoreBack =
        name === "fog-b" &&
        instant &&
        !this.frozen &&
        prevSt !== null &&
        prevSt.done &&
        prevSt.used > 0 &&
        prevLevelId === "rb";
      this.clearFogStage({ outgoingRetired: crossfade });
      this.fogLevel = name === "fog-a" ? FOG_LS : FOG_RB;
      this.fogMachines = null;
      if (instant && this.frozen && name === "fog-b") {
        // ?shot=fog-b: mid-game, partially painted, 6 measurements left.
        this.fogSt = fogStateFromPath(this.fogLevel, FOG_RB_CURATED_MID, false);
      } else if (restoreBack && prevSt !== null) {
        this.fogSt = {
          ...prevSt,
          point: { ...prevSt.point },
          path: prevSt.path.map((p) => ({ ...p })),
        };
      } else {
        this.fogSt = fogInit(this.fogLevel);
      }
      if (restoreBack) {
        // The restored run arrives FINISHED and REVEALED: fogrev is set
        // DIRECTLY (no tween) because the instant path clears tweens after
        // enterSceneState — a tween started here would never play.
        this.values.set("fogrev", 1);
        this.tweens.delete("fogrev"); // a stale tween must not re-push it
        this.view.setFogReveal(1);
        this.view.setContourReveal(1);
      } else {
        this.values.set("fogrev", 0);
        // An in-flight reveal tween must not push fogrev back up onto the
        // incoming terrain.
        this.tweens.delete("fogrev");
        if (!crossfade) {
          this.view.setFogReveal(0);
          this.view.setContourReveal(0);
        }
      }
      // Play always starts from the stock framing (QA L900-FOG-REVEAL-NOTE).
      this.values.set("fognx", 0);
      this.values.set("fogny", 0);
      this.view.setRevealNudge(0, 0);
      // The first built frame re-measures and clears the START position of
      // HUD panels (QA S2-FOG8-BALL-UNDER-FIT-INSET).
      this.fogNudgeViewport = "";
      this.fogMaskReady = false; // re-initialized after the rebuild lands
      return;
    }

    // ---- fog-c: the reveal ----
    const live = this.fogLevel?.id === "rb" ? this.fogSt : null;
    if (live && live.used > 0) {
      // The live level-2 run: unchanged.
    } else if (this.fogRbResult && !(instant && this.frozen)) {
      // Back from a later section (or through a fresh fog-b): the reader's
      // played run, not an empty one (QA S2-FOG-RUN-LOST-ON-RETURN).
      this.fogLevel = FOG_RB;
      this.fogSt = {
        ...this.fogRbResult,
        point: { ...this.fogRbResult.point },
        path: this.fogRbResult.path.map((p) => ({ ...p })),
      };
      this.fogMachines = null;
    } else if (!live) {
      // Jumped straight here (or revealing after a level-1 run): the reveal
      // screen is the Rosenbrock story — start its curated run if needed.
      this.fogLevel = FOG_RB;
      this.fogSt = fogInit(FOG_RB);
      this.fogMachines = null;
    }
    if (this.fogSt === null) {
      // Unreachable (the branches above always leave a state) — narrows the type.
      this.fogLevel = FOG_RB;
      this.fogSt = fogInit(FOG_RB);
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

    // Overshoot apexes: gold markers that burn bright, then fade to HIDDEN
    // (the fade loop holds them for frozen poses and relights them for the
    // mom-apexes hover — see the decay gate in onFrame). Normal blending —
    // additive gold washes out to white over the blue valley floor.
    const apexes = momApexes(momPath);
    this.momApexPts = apexes.map((i) => ({ ...momPath[i] }));
    if (apexes.length > 0) {
      const group = new THREE.Group();
      // Draw above the terrain (0) and the trails (2): all-transparent
      // objects sort by depth, and a marker centred farther than the terrain
      // mesh's centre was drawn first and painted over (QA
      // F26-APEX-MARKERS-BURIED).
      group.renderOrder = 3;
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
      // Always start at full brightness: the per-frame fade runs from here
      // (it holds while frozen, so frozen poses keep the 0.95 material
      // opacity for the screenshot gate). Seeding 0 outside frozen left the
      // markers stuck at full opacity forever — the decay loop never ran.
      this.momHighlightT = 1;
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
    // Both arrows share one compressive LOG map, normalized so even GD's
    // worst-case step (top of the slider) never clamps. A linear ×30 scale
    // needed ~314 world units at ×50 (~10× the stage) and capped GD's arrow
    // from λ₁ ≈ 1.9 on — flat over ~83% of the slider while the readout
    // kept growing. GD's step ∝ λ₁ and the slider is log-scaled, so the
    // log map grows GD's arrow roughly linearly across the whole slider
    // while Adam's stays flat (the inspector readouts keep the TRUE lengths).
    const maxLen = 14;
    const L0 = 0.1;
    const drawScale = maxLen / Math.log1p(adamGdMaxLen() / L0);
    const drawLen = (L: number): number => drawScale * Math.log1p(L / L0);
    // White: −∇f with GD's step length (grows with steepness — the point).
    const gdDrawn = drawLen(gdLen);
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
    const adamDrawn = drawLen(updateLen);
    const h2 = this.view.addArrow(ins.point, { x: ux, y: uy }, OPTIMIZER_COLORS.adam, {
      length: adamDrawn,
    });
    if (h2) this.adamHandles.push(h2);

    // Contact shadows under the floating arrow endpoints (WP-A2) — at each
    // arrow's DRAWN tip, not its true step length.
    const ul = Math.hypot(ux, uy) || 1;
    this.adamArrowTips = [
      {
        x: ins.point.x + (-g.x / gl) * gdDrawn,
        y: ins.point.y + (-g.y / gl) * gdDrawn,
      },
      { x: ins.point.x + (ux / ul) * adamDrawn, y: ins.point.y + (uy / ul) * adamDrawn },
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
    // Measure the reframe at the DESTINATION attitude, not whatever happens
    // to be live mid-crossfade — otherwise the fit (and the ball's landing
    // spot relative to the HUD) depend on arrival path and timing (QA
    // LW24-ADAM-BALL-UNDER-PANEL-1280).
    const cam = this.sceneCam(this.scene, spec);
    this.view.setFrameAttitude(
      cam ? cam.azimuth : null,
      cam ? cam.elevation : null,
    );
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
      fn = this.swarmLevel().landscape;
      this.builtSwarmMap = this.swarmMapId;
      this.builtTilt = null;
    } else {
      fn = adamBowl(this.adamS ?? ADAM_STEEP_MIN);
      this.builtAdamS = this.adamS ?? ADAM_STEEP_MIN;
    }
    // Must precede setLandscape: the framing offset is applied by the reframe.
    this.view.setFrameOffsetY(this.frameDropFor(spec));
    this.view.setPaneFit(spec.race === true);
    this.view.setLandscape(
      fn,
      spec.landscape === "lab" || spec.landscape === "rule" ? { gridN: 64 } : {},
    );
    this.built = spec.landscape;
    // A fresh terrain carries a fresh material — the fog mask must rebind.
    this.fogMaskReady = false;
    // Teardown of the fog toggle happens HERE, not in clearFogStage: this is
    // the only place the terrain material is recreated, it runs at swap
    // stage 'in' (or synchronously). refreshFogVisuals does NOT re-enable
    // fog on crossfades — it is deferred to swap end (F27-OVERLAYS-BURIED) —
    // so the mask is re-initialized SYNCHRONOUSLY right below: the outgoing
    // fogged terrain keeps its mask while it fades, and the incoming level is
    // never seen un-fogged (QA F26-FOG-AB-FLASH round 2).
    this.view.setFogEnabled(false);
    this.initFogMaskIfNeeded();
    // §7 fog of war: an armed tilt-a run re-arms SYNCHRONOUSLY on the
    // incoming terrain — the same F26-FOG-AB-FLASH rule as the line above
    // (a crossfade's incoming tilt board must rise already fogged, never
    // un-fogged for the fade-in). Idempotent with the refresh hooks.
    this.initTiltFogMaskIfNeeded();
    // setLandscape disposed everything §7 had on stage — drop the dead refs
    // (refreshTiltVisuals / refreshSwarmVisuals rebuild what the scene needs).
    this.dropTiltRefs();
    // Blind swarm: the incoming terrain must be fogged from its first rise
    // frame (QA S2-SWARM-BLIND-ENTRY-UNFOGGED). refreshSwarmVisuals waits
    // until the swap ends (F27) — the same class of bug as F26-FOG-AB-FLASH.
    // After dropTiltRefs, so no dead swarm's paint ledger is touched.
    if (spec.swarm && this.swarmBlind) this.applySwarmFogMode();
    this.minimap.setLandscape(fn);
    // §7's run-scoped compass fog dies with the section: when the tilt fog
    // did NOT just arm for the incoming terrain (initTiltFogMaskIfNeeded
    // above), any fog state left over from the outgoing §7 board is dropped
    // HERE — exactly when the fresh landscape binds — never mid-fade, where
    // the compass would flash the outgoing landscape's contour ghost (the
    // F26 rule teardownTiltFog defers by).
    if (!this.tiltFogReady) this.minimap.setFog(null);
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

  /** The scene's directed camera — tilt-a takes the picked level's own pitch
   *  (QA S7-SW2-RASTR-BALL-OCCLUDED). */
  private sceneCam(name: SceneName, spec: SceneSpec): CamSpec | undefined {
    if (!spec.cam) return undefined;
    return name === "tilt-a" && this.tiltLevel.camElevation !== undefined
      ? { ...spec.cam, elevation: this.tiltLevel.camElevation }
      : spec.cam;
  }

  /** Vertical framing drop: the hero's race drop, the tilt scenes' HUD
   *  clearance (QA SW2-LW24-TILTA-BALL-UNDER-TILTPANEL-1280). */
  private frameDropFor(spec: SceneSpec): number {
    return spec.race ? HERO_FRAME_DROP_PX : spec.tilt ? tiltFrameDropPx(innerHeight) : 0;
  }

  /**
   * Ball-clear framing (QA SW2-LW24-TASKC-POINT-UNDER-LOSSPANEL-1280 /
   * S1-BALL-UNDER-HUD Fix A): when the settled ball projects under an
   * opaque HUD panel (grown by ball radius + air), grid-search the smallest
   * frame nudge (+x preferred: away from the left HUD column) that clears
   * it while staying ≥40px inside the pane. 0 when already clear — the
   * canonical 1600×900 framing is unchanged.
   */
  private computeHudClearNudge(): void {
    const CLEAR = 28;
    const pane = this.fogNotePane();
    const obstacles: Array<{ l: number; t: number; r: number; b: number }> = [];
    document
      .querySelectorAll<HTMLElement>('#stage-wrap .hud.panel[data-visible="true"]')
      .forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        obstacles.push({ l: r.left - CLEAR, t: r.top - CLEAR, r: r.right + CLEAR, b: r.bottom + CLEAR });
      });
    const raw = this.view.projectParamToScreen(this.currentPoint);
    if (!raw) return;
    const applied = this.view.appliedRevealNudge;
    const s0 = { x: raw.x - applied.x, y: raw.y - applied.y };
    const inside = (x: number, y: number): boolean =>
      obstacles.some((o) => x > o.l && x < o.r && y > o.t && y < o.b);
    const ok = (x: number, y: number): boolean =>
      !inside(x, y) && x >= pane.l + 40 && x <= pane.r - 40 && y >= pane.t + 40 && y <= pane.b - 40;
    let target = { x: 0, y: 0 };
    if (inside(s0.x, s0.y)) {
      let best = Infinity;
      let found: { x: number; y: number } | null = null;
      for (let dx = 0; dx <= 200; dx += 4) {
        for (let dy = -120; dy <= 160; dy += 4) {
          const d = dx * dx + dy * dy;
          if (d >= best || !ok(s0.x + dx, s0.y + dy)) continue;
          best = d;
          found = { x: dx, y: dy };
        }
      }
      if (found) target = found;
    }
    this.hudNudgeTarget = target;
  }

  /**
   * §7 swarm canyon framing (QA S2-SWARM-PANEL-OCCLUDES-CANYON): keep the
   * global basin's crowd (the canyon, at 0.7σ) clear of #tilt-panel and
   * inside the pane, without pushing the terrain further out of the pane
   * than the stock framing does. When no nudge clears it, the cluster list
   * collapses to the gold global row (with an expand control) and the search
   * runs again against the shorter panel.
   */
  private computeSwarmNudge(allowCollapse = true): void {
    const panelEl = this.els.tiltPanel;
    if (!panelEl) return;
    const pane = this.fogNotePane();
    const pr = panelEl.getBoundingClientRect();
    const ob = { l: pr.left - 8, t: pr.top - 8, r: pr.right + 8, b: pr.bottom + 8 };
    const applied = this.view.appliedRevealNudge;
    const box = (pts: Vec2[]): { l: number; t: number; r: number; b: number } | null => {
      let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
      for (const p of pts) {
        const sp = this.view.projectParamToScreen(p);
        if (!sp) return null;
        const x = sp.x - applied.x;
        const y = sp.y - applied.y;
        l = Math.min(l, x); r = Math.max(r, x);
        t = Math.min(t, y); b = Math.max(b, y);
      }
      return { l, t, r, b };
    };
    const w = this.swarmGlobalWell();
    const c = Math.cos((w.thetaDeg * Math.PI) / 180);
    const sn = Math.sin((w.thetaDeg * Math.PI) / 180);
    const ell: Vec2[] = [];
    for (let k = 0; k < 24; k++) {
      const th = (k / 24) * Math.PI * 2;
      const u = 0.7 * w.a * Math.cos(th);
      const v = 0.7 * w.b * Math.sin(th);
      ell.push({ x: w.x + u * c - v * sn, y: w.y + u * sn + v * c });
    }
    const e = this.swarmLevel().landscape.extent;
    const canyon = box(ell);
    const terrain = box([
      { x: e.xMin, y: e.yMin }, { x: e.xMax, y: e.yMin },
      { x: e.xMax, y: e.yMax }, { x: e.xMin, y: e.yMax },
    ]);
    if (!canyon || !terrain) return;
    const overflow = (n: { x: number; y: number }): number =>
      Math.max(0, pane.l - (terrain.l + n.x)) + Math.max(0, terrain.r + n.x - pane.r) +
      Math.max(0, pane.t - (terrain.t + n.y)) + Math.max(0, terrain.b + n.y - pane.b);
    const base = overflow({ x: 0, y: 0 });
    const clear = (n: { x: number; y: number }): boolean => {
      const l = canyon.l + n.x, r = canyon.r + n.x, t = canyon.t + n.y, b = canyon.b + n.y;
      if (l < pane.l || r > pane.r || t < pane.t || b > pane.b) return false;
      if (Math.min(r, ob.r) - Math.max(l, ob.l) > 0 && Math.min(b, ob.b) - Math.max(t, ob.t) > 0) return false;
      return overflow(n) <= base + 0.5;
    };
    let target: { x: number; y: number } | null = clear({ x: 0, y: 0 }) ? { x: 0, y: 0 } : null;
    if (!target) {
      const kx = Math.floor((pane.r - pane.l) / 2 / 8);
      const ky = Math.floor((pane.b - pane.t) / 2 / 8);
      let best = Infinity;
      for (let dx = -kx * 8; dx <= kx * 8; dx += 8) {
        for (let dy = -ky * 8; dy <= ky * 8; dy += 8) {
          const d = dx * dx + dy * dy;
          if (d >= best || !clear({ x: dx, y: dy })) continue;
          best = d;
          target = { x: dx, y: dy };
        }
      }
    }
    if (!target && allowCollapse && !this.swarmClustersExpanded && panelEl.dataset.clusters !== "collapsed") {
      panelEl.dataset.clusters = "collapsed";
      this.syncTiltPanel();
      this.computeSwarmNudge(false);
      return;
    }
    this.hudNudgeTarget = target ?? { x: 0, y: 0 };
  }

  /**
   * Per-frame upkeep of the non-fog framing nudge: recompute when dirty and
   * settled (never during a drag — the frame must not chase the ball), then
   * ease the applied value (frame-locked, NOT a tween: a tween would extend
   * `animating` and re-lock the reader). Returns true while it moves.
   */
  private hudNudgeUpkeep(spec: SceneSpec): boolean {
    if (this.scene.startsWith("fog")) {
      // §6 owns the reveal-nudge channel (fognx/fogny).
      this.hudNudgeTarget = { x: 0, y: 0 };
      this.hudNudgeApplied = { x: 0, y: 0 };
      return false;
    }
    const vp = `${innerWidth}x${innerHeight}`;
    if (vp !== this.hudNudgeViewport) {
      this.hudNudgeViewport = vp;
      this.hudNudgeDirty = true;
      if (spec.swarm) {
        this.swarmClustersExpanded = false;
        if (this.els.tiltPanel) delete this.els.tiltPanel.dataset.clusters;
      }
    }
    const settled = !this.animating && !this.view.userGesturing;
    if (spec.hudClear) {
      if (this.hudNudgeDirty && settled) {
        this.hudNudgeDirty = false;
        this.computeHudClearNudge();
      }
    } else if (spec.swarm && this.swarm) {
      const a = this.view.attitude;
      const ph = Math.round(this.els.tiltPanel?.getBoundingClientRect().height ?? 0);
      const sig = `${vp}|${Math.round(a.azimuthDeg)}|${Math.round(a.elevationDeg)}|${ph}`;
      if ((sig !== this.swarmNudgeSig || this.hudNudgeDirty) && settled && !this.camDirty) {
        this.swarmNudgeSig = sig;
        this.hudNudgeDirty = false;
        this.computeSwarmNudge();
      }
    } else {
      this.hudNudgeTarget = { x: 0, y: 0 };
    }
    const t = this.hudNudgeTarget;
    const ap = this.hudNudgeApplied;
    if (ap.x === t.x && ap.y === t.y) {
      this.view.setRevealNudge(ap.x, ap.y);
      return false;
    }
    if (this.frozen) {
      this.hudNudgeApplied = { ...t };
    } else {
      const k = 1 - Math.exp(-(this.lastDt || 1 / 60) * 9);
      const nx = ap.x + (t.x - ap.x) * k;
      const ny = ap.y + (t.y - ap.y) * k;
      this.hudNudgeApplied = {
        x: Math.abs(t.x - nx) <= 0.5 ? t.x : nx,
        y: Math.abs(t.y - ny) <= 0.5 ? t.y : ny,
      };
    }
    this.view.setRevealNudge(this.hudNudgeApplied.x, this.hudNudgeApplied.y);
    return true;
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
    // The §5 lab dock (the #swarm-dock pattern): on stage for BOTH lab
    // reader pages — the sliders/checklist never live in the reader text
    // (COPY-PLAN §2.10; the copy says "the dock (bottom-left)").
    setHud(this.els.labDock, this.scene === "lab");
    setHud(this.els.playBtn, spec.transport === true);
    setHud(this.els.speedWrap, spec.transport === true);
    // The fit inset only owns the fit in §1; fog-a shows it read-only, as a
    // readout of the fog point (QA COV22-1).
    const fitLive = this.scene.startsWith("task");
    this.fitPreview.setInteractive(fitLive);
    if (this.els.fitCaptionAct) {
      const want = fitLive ? "drag the line or its ends" : "tracks your current point";
      if (this.els.fitCaptionAct.textContent !== want) this.els.fitCaptionAct.textContent = want;
    }
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
    // The function card (FUNC-CARD): every scene entry re-derives visibility
    // + content (the sliders' live paths call it again mid-scene).
    this.syncFuncCard();
  }

  /* ---------------- the function card (FUNC-CARD) ---------------- */

  /**
   * The docked function card: the CURRENT landscape's function with its
   * LIVE parameters — the fog-game reveal's "actual function with its
   * parameters" pattern, carried to every other section under an explicit
   * show-first vs show-after policy:
   *
   *   OPEN (live): §2 gd, §3 mom, §4 adam, §5 lab, §8 labrule — visible for
   *     the whole scene; the λ₁/λ₂/φ values track the sliders (setSteepness
   *     / setLab) and the §8 card swaps per landscape pill (setRuleLevel).
   *   SHOW-AFTER: §6 fog-a/fog-b never show it (the map is hidden — the
   *     formula would spoil it exactly like the terrain would); fog-c shows
   *     it at the reveal (fogSt.done, synced from syncFogPanel); §7 tilt
   *     shows it only WITH the scorecard (run done — the level-complete
   *     beat, synced from syncTiltPanel); the §7 swarm shows it only when
   *     the "run blind / show map" toggle lifts the fog — that toggle is
   *     the reveal (the flight's end leaves the fog on).
   *   §9 keeps its own pinned #epi-formula; hero/§1 carry no card (§1's
   *   formula lives in the reader, and its surface never hides).
   *
   * Written only on change: the signature covers visibility + all three
   * rows, and innerHTML receives only the static builder strings.
   */
  private syncFuncCard(): void {
    const card = this.funcCardContent();
    const sig = card
      ? `1|${card.title}|${card.math}|${card.values}`
      : "0";
    if (sig === this.funcCardSig) return;
    this.funcCardSig = sig;
    if (!this.els.funcCard) return;
    setHud(this.els.funcCard, card !== null);
    if (!card) {
      this.funcCardLayoutSig = ""; // the CSS centering default returns
      return;
    }
    if (this.els.funcCardTitle) this.els.funcCardTitle.textContent = card.title;
    if (this.els.funcCardMath) this.els.funcCardMath.innerHTML = card.math;
    if (this.els.funcCardVals) this.els.funcCardVals.textContent = card.values;
    this.layoutFuncCard();
  }

  /**
   * Lays the visible card out inside the TOP BAND's free interval
   * (FUNC-CARD). The chip's slot is top-center of the canvas pane, but the
   * band's occupancy varies per scene and per CSS re-dock tier (the §1–§8
   * instrument column top-left; the compass top-right on fog/gd/lab tiers),
   * so the position is MEASURED, never re-derived: every visible canvas-pane
   * HUD (and the camera-preset bar) whose rect reaches into the top strip
   * bounds the band on its side, and the card centers in whatever remains —
   * the pane center when nothing bounds it. BAND MODE needs ≥ FUNC_CARD_
   * MIN_BAND px; on narrow panes (a ~432px reader leaves less) the strip is
   * too congested for any chip, so BELOW-COLUMN MODE drops the card under
   * the instrument column instead and centers it across the pane — it can
   * never underhang the reader (QA'd at w900: cdp-responsive's reader-
   * overlap rule). Runs from the frame tick with a signature guard, so an
   * idle frame costs one string compare.
   */
  private layoutFuncCard(): void {
    const card = this.els.funcCard;
    if (!card || card.dataset.visible !== "true") return;
    const pane = this.fogNotePane();
    let lo = pane.l + 6;
    let hi = pane.r - 6;
    const stripBottom = 140; // the top band: presets row + the 62px columns
    const center0 = (lo + hi) / 2;
    const obstacles: Array<{ l: number; r: number; b: number; c: number }> = [];
    if (this.els.stageWrap) {
      this.els.stageWrap
        .querySelectorAll<HTMLElement>(".hud.panel[data-visible='true'], #stage .lv-controls")
        .forEach((el) => {
          if (el === card) return;
          const r = el.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0 || r.top > stripBottom) return;
          obstacles.push({
            l: r.left,
            r: r.right,
            b: r.bottom,
            c: r.left + r.width / 2,
          });
        });
    }
    for (const o of obstacles) {
      if (o.c <= center0) lo = Math.max(lo, o.r + 12);
      else hi = Math.min(hi, o.l - 12);
    }
    const belowCap = Math.max(180, innerHeight - 240);
    const band = hi - lo;
    const belowMode = band < FUNC_CARD_MIN_BAND;
    let left: string;
    let maxW: string;
    let top = "";
    if (belowMode) {
      // Under the column: clear EVERY strip obstacle's bottom (the reveal
      // note steers around the card wherever it sits — fogNoteObstacles).
      let below = 0;
      for (const o of obstacles) below = Math.max(below, o.b);
      top = `${Math.round(Math.min(below + 12, belowCap))}px`;
      left = `${Math.round((pane.l + pane.r) / 2)}px`;
      maxW = `${Math.round(pane.r - pane.l - 24)}px`;
    } else {
      left = `${Math.round((lo + hi) / 2)}px`;
      maxW = `${Math.round(band)}px`;
    }
    const sig = `${innerWidth}x${innerHeight}|${Math.round(lo)}|${Math.round(hi)}|${top}`;
    if (sig === this.funcCardLayoutSig) return;
    this.funcCardLayoutSig = sig;
    // The chip centers on `left` via its translateX(-50%) transform; the
    // width cap makes the formula wrap INSIDE the free space, never under
    // the reader or a panel.
    card.style.left = left;
    card.style.maxWidth = maxW;
    card.style.top = top;
  }

  /** "(1.614)" / "−4.6" — three decimals, trailing zeros trimmed, real
   *  minus (the mono values lines never carry HTML). */
  private static fmtParam(v: number): string {
    return Number(v.toFixed(3)).toString().replace("-", "−");
  }

  /** The card's content for the CURRENT scene + live state (null = hidden). */
  private funcCardContent(): FuncCardContent | null {
    const s = this.scene;
    /* ---- OPEN: the bowl family, live where sliders exist ---- */
    if (s.startsWith("gd")) {
      // The §2 bowl is makeBowl(1, 0.02, π/6) — λmax = 2 is the copy's
      // threshold constant (gd-c), and the card shows where it comes from.
      return bowlCard(1, 0.02, 30, "test landscape · the rotated bowl");
    }
    if (s.startsWith("mom")) {
      // MOM_BOWL: the same ratio-50 bowl rotated −36° (director.ts §3).
      return bowlCard(1, 0.02, -36, "test landscape · the rotated bowl");
    }
    if (s.startsWith("adam")) {
      // λ₁ IS the steepness slider (setSteepness re-syncs this live).
      const k = this.adamS ?? ADAM_STEEP_MIN;
      return bowlCard(k, 0.02, 30, "test landscape · the rotated bowl");
    }
    if (s === "lab") {
      // λ₁ = √E, λ₂ = 1/√E, φ = rotation — the dock's two sliders, live
      // (setLab re-syncs this on every input event).
      const E = this.labE ?? LAB_E_DEFAULT;
      const rot = this.labRot ?? LAB_ROT_DEFAULT;
      const l1 = Math.sqrt(E);
      return bowlCard(l1, 1 / l1, rot, "the disagreement lab · live bowl");
    }
    if (s === "labrule") {
      const level = ruleLevelById(this.ruleLevel);
      const title = `benchmark · ${level.name}`;
      const values = pairsJoin(
        `converge < L ${ruleFormatLoss(level.threshold)}`,
        `start (${Director.fmtParam(level.start.x)}, ${Director.fmtParam(level.start.y)})`,
      );
      return funcCardForLevel(this.ruleLevel, title, values);
    }
    /* ---- SHOW-AFTER: §6 — the card appears only at the reveal ---- */
    if (s.startsWith("fog")) {
      const level = this.fogLevel;
      const st = this.fogSt;
      if (!level || !st || !st.done) return null;
      const title = `level ${level.ordinal} · ${level.name} — revealed`;
      const min =
        `global min (${Director.fmtParam(level.globalMin.x)}` +
        `, ${Director.fmtParam(level.globalMin.y)})`;
      return level.id === "ls"
        ? leastSquaresCard(title, pairsJoin("12 points", min))
        : rosenbrockCard(title, nbp(min));
    }
    /* ---- SHOW-AFTER: §7 tilt — with the scorecard (run done) only ---- */
    if (s === "tilt-a" || s === "tilt-b") {
      if (!(this.tiltRun !== null && this.tiltRun.done)) return null;
      const level = this.tiltLevel;
      const title = `level ${level.ordinal} · ${level.name} — the map`;
      return funcCardForTiltLevel(level.id, title);
    }
    /* ---- SHOW-AFTER: §7 swarm — "show map" (not blind) only ---- */
    if (s === "swarm") {
      if (this.swarmBlind) return null;
      const map = swarmMapById(this.swarmMapId);
      const wells = landscapeWells(map.level.landscape);
      if (map.id === "himmelblau") return himmelblauCard(`swarm finale · ${map.label}`);
      if (map.id === "archipelago") {
        return archipelagoCard(
          `swarm finale · ${map.label}`,
          wells.length,
          ARCHIPELAGO_RIDGES.length,
          map.census,
        );
      }
      return multiWellCard(`swarm finale · ${map.label}`, map.census);
    }
    return null;
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
