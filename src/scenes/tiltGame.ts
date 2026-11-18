/**
 * tiltGame — the pure, deterministic core of §7's tilt game (no DOM, no three).
 *
 * Five levels:
 *   level 1 "elongated valley" — the §2/§3 rotated bowl: tilt across it and
 *           the ball rocks wall to wall (momentum's overshoot — the §3 trap,
 *           embodied),
 *   level 2 "Rosenbrock"      — the banana valley with the seductive floor,
 *   level 3 "Rastrigin"       — an egg crate of local minima: settle anywhere,
 *   level 4 "Archipelago"     — eight ridge-walled island basins on a ±9 map:
 *           real terrain to steer through (user feedback 2026-11-17),
 *   level 5 "Canyon peaks"    — one long winding valley past two tall peaks.
 *
 * Real-time physics IN PARAMETER SPACE (the PLAN's formula, verbatim):
 *     v += ( −∇f·g + tilt − friction·v ) · dt
 *     p += v · dt
 * semi-implicit Euler at a fixed 120 Hz substep; the board is tilted by the
 * WASD/arrow keys (screen-relative, mapped through the camera azimuth by the
 * director — direction-critical reading stays in parameter space). The
 * friction slider is the damping knob — the β analogy: friction → 0 is the
 * long-memory momentum limit, high friction kills the memory almost at once.
 *
 * Scoring per level: the ball must COME TO REST where the needle is quiet
 * (|∇f| below the level's settle threshold while |v| is tiny, held for a run
 * of substeps) — or the player presses Finish. Coming to rest on quiet ground
 * is NOT the same as reaching the minimum: the verdict also checks the goal
 * radius (tiltAtGoal), the same test the machines are graded against. The
 * score is (unique visited cells, elapsed steps): cells are the scorecard's
 * measurement count; the physics itself reads ∇f at the ball on every
 * substep.
 *
 * Everything here is pure state-in/state-out so the vitest suite can verify
 * the physics the same way it verifies the math core. No Math.random: the
 * swarm's 100 starts come from a fixed Halton low-discrepancy sequence.
 */

import {
  defaultBowl,
  rosenbrock,
  rastrigin,
  multiWell,
  multiWellLarge,
  himmelblau,
  archipelago,
  canyonPeaks,
  MULTI_WELL_WELLS,
  type Landscape,
  type Vec2,
  type WellSpec,
} from "../core/functions";
import { gd, momentum, adam, type Optimizer } from "../core/optimizers";

/* ------------------------------------------------------------------ */
/* Levels                                                              */
/* ------------------------------------------------------------------ */

export type TiltLevelId = "valley" | "rosen" | "rastr" | "archi" | "canyon" | "swarm";

export interface TiltLevel {
  id: TiltLevelId;
  /** Display name for the tilt panel. */
  name: string;
  ordinal: string;
  landscape: Landscape;
  start: Vec2;
  /** Where a guided (curated) run homes to; machines are graded against it. */
  goal: Vec2;
  /** "Reached the goal" radius as a fraction of the extent diagonal. */
  goalFrac: number;
  /** Physics tuning — hand-set per landscape (param units, seconds). */
  gravity: number;
  tiltAccel: number;
  vmax: number;
  /** |∇f| below which the ball has come to rest on quiet ground (not
   *  necessarily AT the minimum — see tiltAtGoal). */
  settleGrad: number;
  /** Measurement-cell edge as a fraction of the extent diagonal. */
  cellFrac: number;
  /** ANY minimum counts as reaching one (Rastrigin's egg crate): machines
   *  that settle in a local pit are graded as having reached a minimum, and
   *  the scorecard gains a "minimum" column naming WHICH one (QA
   *  copy-tilt-which-minimum). Unset on single-minimum levels. */
  anyMinimum?: boolean;
  /** Overrides tilt-a's default camera pitch (degrees) for this level (QA
   *  S7-SW2-RASTR-BALL-OCCLUDED): Rastrigin's packed pits hide the ball from
   *  the stock 40° pose. Unset = the scene's own pitch. */
  camElevation?: number;
}

export const TILT_VALLEY: TiltLevel = {
  id: "valley",
  name: "elongated valley",
  ordinal: "1",
  landscape: defaultBowl,
  // On the valley FLOOR (the flat axis at radius 10): |∇f| ≈ 0.4, so the
  // ball drifts gently down-valley while the player finds the keys — and
  // tilting ACROSS the floor is exactly the GD zigzag, embodied.
  start: { x: -5, y: 8.66 },
  goal: { x: 0, y: 0 },
  goalFrac: 0.05,
  gravity: 1.6,
  tiltAccel: 16,
  vmax: 14,
  settleGrad: 0.5,
  cellFrac: 0.05,
};

export const TILT_ROSEN: TiltLevel = {
  id: "rosen",
  name: "Rosenbrock",
  ordinal: "2",
  landscape: rosenbrock,
  start: { x: -1.2, y: 1.44 }, // on the parabola y = x², same as the fog game
  goal: { x: 1, y: 1 },
  goalFrac: 0.09,
  gravity: 0.05,
  tiltAccel: 6,
  vmax: 4,
  settleGrad: 0.9,
  cellFrac: 0.05,
};

export const TILT_RASTR: TiltLevel = {
  id: "rastr",
  name: "Rastrigin",
  ordinal: "3",
  landscape: rastrigin,
  // A hair off an exact local min (-0.995, 1.99): starts essentially quiet
  // (the ball nuzzles into the basin) but leaves the machines — and the
  // player — something to descend.
  start: { x: -0.999, y: 1.986 },
  goal: { x: 0, y: 0 },
  goalFrac: 0.06,
  gravity: 0.5,
  // QA GP-2: tiltAccel 55 dwarfed gravity·|∇f| — the smallest key tap
  // flung the ball across the whole level (80 ms ⇒ |v| ≈ 1.2, a 250 ms
  // hold covered ~5 units), and it then rang in the near-undamped pit for
  // 25 s+. Retuned against the wall physics: the steepest pit wall has
  // |∇f| ≈ 63, so a press needs tilt > gravity·63 ≈ 32 to climb out of a
  // pit at all — tiltAccel 36 keeps that escape (and the curated ride to
  // the goal) while vmax 1.4 bounds every tap: coast distance is vmax/c,
  // so an 80 ms tap now carries ≈ one pit grid and a sustained press
  // crosses about one pit per hold, not the whole extent.
  tiltAccel: 36,
  vmax: 1.4,
  settleGrad: 0.8,
  cellFrac: 0.05,
  anyMinimum: true,
  // Inside the 26–62° play clamp with 2° headroom.
  camElevation: 60,
};

/**
 * Level 4 "Archipelago" — eight island basins of clearly different depths
 * walled off by six true ridges, over a ±9 map (twice the valley's width:
 * the gravity games reward the bigger stage). The ridges are real terrain:
 * every straight route between neighboring basins crosses a wall ≥ 4 units
 * above both floors, so the player must steer through the strait gaps and
 * around the wall tips — the blind machines below all settle in the first
 * basin they roll into and never see the deep atoll.
 */
export const TILT_ARCHI: TiltLevel = {
  id: "archi",
  name: "Archipelago",
  ordinal: "4",
  landscape: archipelago,
  // The south-west rim: high open water (f ≈ 4.8) with a long view — the
  // whole ring lies ahead, and the deep atoll (the goal) sits across two
  // ridges to the north-west.
  start: { x: -7.4, y: -6.4 },
  goal: { x: -4.6, y: 3.9 },
  goalFrac: 0.03,
  // The multi-well countries' recipe (gravity 2, mid damping, quiet-ground
  // settle 0.1) scaled to the wider map: vmax 10 covers the longer glides
  // within the 7-second ride, and tiltAccel 18 lets a sustained press climb
  // a strait wall (wall flank slopes reach ~13·g) while vmax caps the tap.
  gravity: 2,
  tiltAccel: 18,
  vmax: 10,
  settleGrad: 0.1,
  cellFrac: 0.04,
};

/**
 * Level 5 "Canyon peaks" — one long winding valley (the Rosenbrock idea,
 * bigger and twice as twisted) running past two tall peaks. The floor is a
 * genuine route: from the high west mouth it winds a full S down to the
 * sea gate at (2.6, 1.6141), and the walls rise to ~72 at the extent edge.
 */
export const TILT_CANYON: TiltLevel = {
  id: "canyon",
  name: "Canyon peaks",
  ordinal: "5",
  landscape: canyonPeaks,
  // On the canyon floor at the west mouth (on the path y = g(x)), at f ≈ 30:
  // the whole canyon lies ahead, downhill all the way to the gate.
  start: { x: -2.9, y: 1.1168362202947417 },
  goal: { x: 2.6, y: 1.6141042163886286 },
  goalFrac: 0.05,
  // The Rosenbrock recipe (the walls, not the drain, set the scales — their
  // curvature is 2B = 16 plus the peak flanks): low gravity, bounded taps.
  gravity: 0.08,
  tiltAccel: 8,
  vmax: 4,
  settleGrad: 0.9,
  cellFrac: 0.05,
};

export const TILT_LEVELS: readonly TiltLevel[] = [
  TILT_VALLEY,
  TILT_ROSEN,
  TILT_RASTR,
  TILT_ARCHI,
  TILT_CANYON,
];

/**
 * The §7 swarm finale's OWN landscape (not a playable tilt level): the
 * multi-well country — one clear global basin plus five local basins of
 * DIFFERENT depths, widths and shapes (see functions.ts MULTI_WELL_WELLS),
 * so the 100-ball clusters end at visibly unequal final losses instead of
 * indistinguishable Rastrigin pits. The open plain between the wells is
 * GENTLER than the well walls, so a loose settle threshold let balls born
 * there "settle" without ever rolling (QA S7-SWARM-1): gravity 2 gets slow
 * creepers moving (above the launch speed), settleGrad 0.1 only accepts
 * rest on true well floors, and the swarm runs require a launch first.
 */
export const SWARM_LEVEL: TiltLevel = {
  id: "swarm",
  name: "multi-well country",
  ordinal: "S",
  landscape: multiWell,
  // The global basin (unused by the swarm — its starts are Halton-scattered —
  // but the level record needs a valid point).
  start: { x: -1.58, y: 1.4 },
  goal: { x: -1.58, y: 1.4 },
  goalFrac: 0.05,
  gravity: 2,
  tiltAccel: 12,
  vmax: 10,
  settleGrad: 0.1,
  cellFrac: 0.05,
};

/**
 * The LARGE multi-well map (the picker's second country): nine wells over
 * ±6.5 (see functions.ts MULTI_WELL_LARGE_WELLS), same gentle-plain physics
 * as the default — the extent is 62% wider, but vmax 10 covers the longer
 * glides within the same 7 s ride.
 */
export const SWARM_LEVEL_LARGE: TiltLevel = {
  id: "swarm",
  name: "multi-well large",
  ordinal: "S",
  landscape: multiWellLarge,
  start: { x: -2.38, y: 2.58 },
  goal: { x: -2.38, y: 2.58 },
  goalFrac: 0.05,
  gravity: 2,
  tiltAccel: 12,
  vmax: 10,
  settleGrad: 0.1,
  cellFrac: 0.05,
};

/**
 * The Himmelblau map (the picker's third country): the classic polynomial
 * with exactly FOUR minima — all GLOBAL (f = 0 at each), the counter-story
 * to the unequal-outcome countries. The quartic rim is far steeper than the
 * Gaussian countries' walls (∇f reaches ~600 at the extent), so the physics
 * is retuned: less gravity (the surface supplies the force) and a lower
 * vmax, so balls slam into pit walls gently enough to ring DOWN and settle
 * inside the 30 s substep cap.
 */
export const SWARM_LEVEL_HIMMEL: TiltLevel = {
  id: "swarm",
  name: "Himmelblau",
  ordinal: "S",
  landscape: himmelblau,
  start: { x: 3, y: 2 },
  goal: { x: 3, y: 2 },
  goalFrac: 0.05,
  gravity: 0.5,
  tiltAccel: 12,
  vmax: 4,
  settleGrad: 0.1,
  cellFrac: 0.05,
};

/* ------------------------------------------------------------------ */
/* The swarm's landscape picker (three countries, one finale)          */
/* ------------------------------------------------------------------ */

export type SwarmMapId = "multi-well" | "multi-well-large" | "himmelblau" | "archipelago";

export interface SwarmMapDef {
  id: SwarmMapId;
  /** Pill label (the visualizer dock). */
  label: string;
  /** One-line well census for the panel header / reader tie-ins. */
  census: string;
  level: TiltLevel;
}

/**
 * The archipelago map (the picker's fourth country): the ridge-walled
 * basin country over ±9 (see functions.ts ARCHIPELAGO_WELLS). The swarm
 * story is at its sharpest here — the strait walls mean a ball almost
 * NEVER crosses between islands, so each cluster is essentially "who was
 * born in that basin's drift shadow". 100 balls, all settle, all eight
 * basins occupied, losses spread over ~7.5 units (verified in
 * tiltGame.test.ts); the interior plain funnels the biggest crowd into
 * the shallow skerry, the deepest crowd into the atoll.
 */
export const SWARM_LEVEL_ARCHI: TiltLevel = {
  id: "swarm",
  name: "archipelago",
  ordinal: "S",
  landscape: archipelago,
  start: { x: -4.58, y: 3.88 },
  goal: { x: -4.58, y: 3.88 },
  goalFrac: 0.05,
  gravity: 2,
  tiltAccel: 12,
  vmax: 10,
  settleGrad: 0.1,
  cellFrac: 0.05,
};

/**
 * The §7 swarm finale's selectable countries (user feedback 2026-11-13:
 * the basins step wanted MORE maps, easily selectable; 2026-11-17: the
 * archipelago joins). Each level record carries its landscape — and the
 * landscape carries its own `wells` list — so every basin consumer
 * (swarmBasinOf, cluster rows, framing) works off the picked record alone.
 * Ordered deepest-first per wells list; the `global`-flagged well is each
 * country's gold row (Himmelblau flags all four: every pit is a global
 * minimum there).
 */
export const SWARM_MAPS: ReadonlyArray<SwarmMapDef> = [
  {
    id: "multi-well",
    label: "multi-well",
    census: "6 wells · one deep global canyon",
    level: SWARM_LEVEL,
  },
  {
    id: "multi-well-large",
    label: "multi-well large",
    census: "9 wells over a wider country",
    level: SWARM_LEVEL_LARGE,
  },
  {
    id: "himmelblau",
    label: "himmelblau",
    census: "4 equal GLOBAL minima",
    level: SWARM_LEVEL_HIMMEL,
  },
  {
    id: "archipelago",
    label: "archipelago",
    census: "8 island basins behind true ridges",
    level: SWARM_LEVEL_ARCHI,
  },
];

/** The swarm map record for a picker id (throws on an unknown id). */
export function swarmMapById(id: SwarmMapId): SwarmMapDef {
  const hit = SWARM_MAPS.find((m) => m.id === id);
  if (!hit) throw new Error(`tiltGame: no swarm map "${id}"`);
  return hit;
}

/** The well list a landscape exposes (empty when it has no well story). */
export function landscapeWells(fn: Landscape): ReadonlyArray<WellSpec> {
  return fn.wells ?? [];
}

export function tiltLevelById(id: TiltLevelId): TiltLevel {
  const hit =
    id === "swarm" ? SWARM_LEVEL : TILT_LEVELS.find((l) => l.id === id);
  if (!hit) throw new Error(`tiltGame: no level "${id}"`);
  return hit;
}

/** Extent diagonal — the world all the level's fractions live in. */
export function tiltDiag(level: TiltLevel): number {
  const e = level.landscape.extent;
  return Math.hypot(e.xMax - e.xMin, e.yMax - e.yMin);
}

export function tiltGoalRadius(level: TiltLevel): number {
  return tiltDiag(level) * level.goalFrac;
}

/** Within the goal radius of the level's true minimum — the ONE predicate
 *  the player's verdict and the machines' `reached` flag share. */
export function tiltAtGoal(level: TiltLevel, p: Vec2): boolean {
  return Math.hypot(p.x - level.goal.x, p.y - level.goal.y) < tiltGoalRadius(level);
}

/* ------------------------------------------------------------------ */
/* Physics                                                             */
/* ------------------------------------------------------------------ */

/** Fixed physics substep (s). The director accumulates frame time. */
export const TILT_DT = 1 / 120;
/** Substeps at |v| ≈ 0 and |∇f| < settleGrad before the ball counts as settled. */
export const TILT_SETTLE_SUBSTEPS = 45;
/** |v| below which the ball counts as at rest (QA GP-1: 0.05 was tighter
 *  than the damped terminal drift the physics itself produces — a tap-tap
 *  coast settled into a slow floor creep at |v| ≈ 0.2 and never ended.
 *  0.25 is "visibly still" at the levels' scale: even the fast valley's
 *  measurement cells are 2 units, so a 0.25 u/s crawl takes 8 s per cell). */
export const TILT_SETTLE_SPEED = 0.25;
/** Wall restitution: a bounce off the extent border keeps this fraction. */
const WALL_BOUNCE = 0.38;
/** One recorded ghost sample every N substeps (50 ms). */
export const TILT_REC_EVERY = 6;

/* The "still rolling…" nudge (QA GP-1): if the ball has been near-still for
 * a while without SETTLING (creeping along quiet ground, or ringing down in
 * a pit), the panel pulses the Finish button — the guaranteed escape must
 * never look like a hang. Thresholds live here with the rest of the tuning. */
/** |v| below which the ball reads as "stopped but not scored" (covers the
 *  floor-creep band between TILT_SETTLE_SPEED and full coasting). */
export const TILT_CUE_SPEED = 0.35;
/** Seconds of near-stillness before the Finish button starts pulsing. */
export const TILT_CUE_AFTER_SEC = 3;
/**
 * Chebyshev radius around a Rastrigin lattice point inside which a SLOW ball
 * counts as resting in that pit (QA S7-RASTR-FINISH-SLOPE). When the Finish
 * cue fires the ball has been under TILT_CUE_SPEED for 3 s; the pit's natural
 * frequency is ω = √(gravity·(2+40π²)) ≈ 14 rad/s, so it swings at most
 * ≈0.35/14 ≈ 0.025 from the floor, and the floor itself sits up to ≈0.025
 * off the lattice point — within 0.05 of it. 0.1 leaves 2× margin while
 * staying far from the half-integer ridges.
 */
export const TILT_PIT_REST_RADIUS = 0.1;

export interface TiltRun {
  pos: Vec2;
  vel: Vec2;
  /** Physics substeps elapsed (= elapsed steps, the score). */
  steps: number;
  /** Ghost recording: rec[0] is the start; sampled every recEvery substeps. */
  rec: Vec2[];
  /** Record cadence for THIS run (substeps between ghost samples). */
  recEvery: number;
  /** Unique visited measurement cells, in visit order (the other score). */
  cells: string[];
  /** First-visit parameter point of cells[i] (QA S7-SW2-RASTR-STAMPS-SHARDS:
   *  stamps sit where the ball actually entered each cell). */
  cellAt: Vec2[];
  cellSeen: Set<string>;
  /** Consecutive settled substeps. */
  rest: number;
  /** The run is over: came to rest on quiet ground, or Finish was pressed. */
  done: boolean;
  settled: boolean;
  /** True once ANY nonzero tilt has been applied (QA GP-1): a run born at
   *  rest on quiet ground must not score itself before the player has
   *  steered — with the loosened settle threshold the level-1 opening drift
   *  settled within half a second and the live game ended before play. */
  steered: boolean;
  /** When set, settle counting waits for `steered` (the live game). */
  requireInput: boolean;
  /** True once the ball has moved at ≥ TILT_SETTLE_SPEED at least once. */
  launched: boolean;
  /** When set, settle counting waits for `launched` (QA S7-SWARM-1: a swarm
   *  ball born at rest on gentle ground must not score itself as resting
   *  before it ever rolled). Opt-in — the live game and curated runs keep
   *  their behaviour. */
  requireLaunch: boolean;
  /** Seeded as the guided demo (QA cycle B round 2: tilt-b reached by rail
   *  tick with no session run). Graded honestly — never as the student's
   *  run — even though its simulated inputs flip `steered`. */
  curated: boolean;
}

export function tiltCellKey(level: TiltLevel, p: Vec2): string {
  const e = level.landscape.extent;
  const w = tiltDiag(level) * level.cellFrac;
  const ix = Math.floor((p.x - e.xMin) / w);
  const iy = Math.floor((p.y - e.yMin) / w);
  return `${ix}|${iy}`;
}

function clampToExtent(level: TiltLevel, p: Vec2, v: Vec2): void {
  const e = level.landscape.extent;
  if (p.x < e.xMin) { p.x = e.xMin; v.x = Math.abs(v.x) * WALL_BOUNCE; }
  else if (p.x > e.xMax) { p.x = e.xMax; v.x = -Math.abs(v.x) * WALL_BOUNCE; }
  if (p.y < e.yMin) { p.y = e.yMin; v.y = Math.abs(v.y) * WALL_BOUNCE; }
  else if (p.y > e.yMax) { p.y = e.yMax; v.y = -Math.abs(v.y) * WALL_BOUNCE; }
}

/** A fresh run at the level's start (standing still = 1 measurement). */
export function tiltInit(
  level: TiltLevel,
  opts: { start?: Vec2; recEvery?: number; requireInput?: boolean; requireLaunch?: boolean } = {},
): TiltRun {
  const pos = opts.start ? { ...opts.start } : { ...level.start };
  return {
    pos,
    vel: { x: 0, y: 0 },
    steps: 0,
    rec: [{ ...pos }],
    recEvery: opts.recEvery ?? TILT_REC_EVERY,
    cells: [tiltCellKey(level, pos)],
    cellAt: [{ ...pos }],
    cellSeen: new Set([tiltCellKey(level, pos)]),
    rest: 0,
    done: false,
    settled: false,
    steered: false,
    requireInput: opts.requireInput ?? false,
    launched: false,
    requireLaunch: opts.requireLaunch ?? false,
    curated: false,
  };
}

/**
 * One physics substep — THE formula from the PLAN, verbatim:
 *   v += ( −∇f·g + tilt − friction·v ) · dt ;  p += v · dt
 * `input` is the tilt in PARAMETER space (unit maximum per axis); `friction`
 * is the damping coefficient (the β analogy: 0 = long memory).
 * Mutates `run` (the live game owns one object; the swarm reuses it too).
 */
export function tiltStep(
  level: TiltLevel,
  run: TiltRun,
  input: Vec2,
  friction: number,
  dt: number = TILT_DT,
): void {
  if (run.done) return;
  if (input.x !== 0 || input.y !== 0) run.steered = true;
  const g = level.landscape.grad(run.pos);
  const ax = -g.x * level.gravity + input.x * level.tiltAccel - friction * run.vel.x;
  const ay = -g.y * level.gravity + input.y * level.tiltAccel - friction * run.vel.y;
  run.vel.x = clampAbs(run.vel.x + ax * dt, level.vmax);
  run.vel.y = clampAbs(run.vel.y + ay * dt, level.vmax);
  run.pos.x += run.vel.x * dt;
  run.pos.y += run.vel.y * dt;
  clampToExtent(level, run.pos, run.vel);
  run.steps += 1;

  if (run.steps % run.recEvery === 0) run.rec.push({ ...run.pos });

  const key = tiltCellKey(level, run.pos);
  if (!run.cellSeen.has(key)) {
    run.cellSeen.add(key);
    run.cells.push(key);
    run.cellAt.push({ ...run.pos });
  }

  // Came to rest on quiet ground? Quiet needle AND near-zero speed,
  // sustained — but only once the player has steered, when the run demands
  // input (a run born on quiet ground is the attract state, not a scored
  // rest), and only once the ball has rolled, when the run demands a launch.
  const gl = Math.hypot(g.x, g.y);
  const vl = Math.hypot(run.vel.x, run.vel.y);
  if (vl >= TILT_SETTLE_SPEED) run.launched = true;
  if (
    gl < level.settleGrad &&
    vl < TILT_SETTLE_SPEED &&
    (run.steered || !run.requireInput) &&
    (run.launched || !run.requireLaunch)
  ) {
    run.rest += 1;
    if (run.rest >= TILT_SETTLE_SUBSTEPS) {
      run.done = true;
      run.settled = true;
    }
  } else {
    run.rest = 0;
  }
}

function clampAbs(v: number, m: number): number {
  return v > m ? m : v < -m ? -m : v;
}

/**
 * Screen-relative key input → parameter-space tilt (QA
 * S7-RASTR-DEAD-KEY-DIAGONAL): rotate by the camera azimuth, then rescale so
 * the DOMINANT axis gets the full unit tilt. A pure rotation split a single
 * key into ~0.707 per axis near ±45°/±135° — 36·0.707 ≈ 25.5 < the ≈32.4 a
 * Rastrigin pit wall needs, so the ball pinned on the wall. The input domain
 * stays tiltStep's square (unit ∞-norm); direction is unchanged.
 */
export function tiltScreenToParam(input: Vec2, azimuthDeg: number): Vec2 {
  const a = (azimuthDeg * Math.PI) / 180;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const x = input.x * ca - input.y * sa;
  const y = input.x * sa + input.y * ca;
  const m = Math.max(Math.abs(x), Math.abs(y));
  return m > 1e-9 ? { x: x / m, y: y / m } : { x: 0, y: 0 };
}

/**
 * §7 tilt framing drop in CSS px (QA SW2-LW24-TILTA-BALL-UNDER-TILTPANEL-
 * 1280): #tilt-panel's bottom edge is fixed at y = 464 while the ortho fit
 * scales with viewport height — the worst-case start (Rastrigin) projects at
 * ≈0.543·H, inside the panel below ~900px of height. 0 at ≥900px tall
 * (canonical 1600×900 and 1440×900 unchanged), ≈55px at 800, ≈73px at 768,
 * capped at 120. The director applies it as a frustum shift (exact px).
 */
export function tiltFrameDropPx(vh: number): number {
  return Math.min(120, Math.max(0, Math.round((900 - vh) * 0.55)));
}

/** Finish pressed mid-run: the run is over where it stands — and the
 *  recording gains the exact final position, so the ghost ride ends ON it
 *  instead of up to 50 ms (one rec sample) short. */
export function tiltFinish(run: TiltRun): void {
  run.done = true;
  const last = run.rec[run.rec.length - 1];
  if (!last || last.x !== run.pos.x || last.y !== run.pos.y) {
    run.rec.push({ ...run.pos });
  }
}

export interface TiltScore {
  cells: number;
  steps: number;
  finalLoss: number;
  settled: boolean;
}

export function tiltScore(level: TiltLevel, run: TiltRun): TiltScore {
  return {
    cells: run.cells.length,
    steps: run.steps,
    finalLoss: level.landscape.f(run.pos),
    settled: run.settled,
  };
}

/* ------------------------------------------------------------------ */
/* Curated guided runs (frozen shots + replay fallback)                */
/* ------------------------------------------------------------------ */

/**
 * The deterministic "guides' hand": full push toward the level's goal,
 * modulated by a fixed sine wobble so the ride shows real physics (the
 * valley zigzags, the banana slides) instead of a beeline. Pure function of
 * (level, pos, t) — same inputs, same ride, every time.
 */
export function tiltCuratedInput(level: TiltLevel, pos: Vec2, t: number): Vec2 {
  const dx = level.goal.x - pos.x;
  const dy = level.goal.y - pos.y;
  const l = Math.hypot(dx, dy) || 1;
  const stop = tiltDiag(level) * 0.04; // close enough: let friction settle it
  if (l < stop) return { x: 0, y: 0 };
  const wobble = 0.3 * Math.sin((2 * Math.PI * t) / 1.7);
  return {
    x: clamp11(dx / l - (dy / l) * wobble),
    y: clamp11(dy / l + (dx / l) * wobble),
  };
}

const clamp11 = (v: number): number => (v > 1 ? 1 : v < -1 ? -1 : v);

/**
 * A full curated run: the guided hand + the real integrator. Used for the
 * frozen ?shot poses (tilt-a mid-run, tilt-b scorecard) and as the replay
 * fallback when the reveal screen is reached without a played run.
 */
export function tiltCuratedRun(
  level: TiltLevel,
  friction: number,
  opts: { maxSteps?: number; frac?: number } = {},
): TiltRun {
  const run = tiltInit(level);
  const cap = opts.maxSteps ?? Math.round(TILT_CURATED_MAX_SEC / TILT_DT);
  while (run.steps < cap && !run.done) {
    const t = run.steps * TILT_DT;
    tiltStep(level, run, tiltCuratedInput(level, run.pos, t), friction);
  }
  if (opts.frac !== undefined && opts.frac < 1) {
    // Mid-run pose: replay the deterministic sim up to a fraction of the
    // full ride (never mid-settle: if it finished, keep the finish).
    const partial = tiltInit(level);
    const capFrac = Math.max(1, Math.floor(run.steps * opts.frac));
    while (partial.steps < capFrac && !partial.done) {
      const t = partial.steps * TILT_DT;
      tiltStep(level, partial, tiltCuratedInput(level, partial.pos, t), friction);
    }
    return partial;
  }
  return run;
}

/** A curated ride may take a while; hard cap (s). */
export const TILT_CURATED_MAX_SEC = 40;
/** The tilt panel's default damping (the β analogy lives mid-range — still
 *  the "damped" regime). QA GP-1: at 0.55 the ball coasted at |v| just above
 *  the settle threshold for tens of seconds; 1.2 rings down in a few seconds
 *  so a visibly-stopped run ends by itself. */
export const TILT_DEFAULT_FRICTION = 1.2;

/* ------------------------------------------------------------------ */
/* The machines (scorecard race from the player's start)               */
/* ------------------------------------------------------------------ */

/** Every machine gets this many blind steps from the player's start. */
export const TILT_MACHINE_STEPS = 400;

export interface TiltMachineSpec {
  key: "gd" | "mom" | "adam";
  label: string;
  cssColor: string;
  make: () => Optimizer;
}

/** η hand-tuned per level (verified in tiltGame.test.ts): each machine makes
 *  real progress from the player's start; on Rosenbrock GD crawls, momentum
 *  slides the banana, Adam plateaus near the floor; on Rastrigin most get
 *  trapped by the egg crate — the scorecard's whole point. */
const MACHINES: Record<TiltLevelId, TiltMachineSpec[]> = {
  valley: [
    { key: "gd", label: "GD", cssColor: "#FC6255", make: () => gd(0.35) },
    { key: "mom", label: "momentum", cssColor: "#58C4DD", make: () => momentum(0.12, 0.9) },
    { key: "adam", label: "Adam", cssColor: "#F4D345", make: () => adam(0.3, 0.9, 0.999, 1e-8) },
  ],
  rosen: [
    { key: "gd", label: "GD", cssColor: "#FC6255", make: () => gd(0.001) },
    { key: "mom", label: "momentum", cssColor: "#58C4DD", make: () => momentum(0.002, 0.9) },
    { key: "adam", label: "Adam", cssColor: "#F4D345", make: () => adam(0.05, 0.9, 0.999, 1e-8) },
  ],
  rastr: [
    // Rastrigin's cos ridge curvature is λmax ≈ 397: η must stay under
    // 2/λmax ≈ 0.005 for GD (and under ~2(1+β)/λmax for momentum).
    { key: "gd", label: "GD", cssColor: "#FC6255", make: () => gd(0.004) },
    { key: "mom", label: "momentum", cssColor: "#58C4DD", make: () => momentum(0.004, 0.9) },
    { key: "adam", label: "Adam", cssColor: "#F4D345", make: () => adam(0.08, 0.9, 0.999, 1e-8) },
  ],
  archi: [
    // The island walls' curvature tops out at 2·depth/b² ≈ 24 (atoll) and
    // the strait ridges at 2h/sW² ≈ 36: η under 2/36 ≈ 0.055 keeps GD
    // stable everywhere. From the south-west rim every blind machine rolls
    // into the FIRST basin it meets — GD and Adam dive into the lagoon
    // (f ≈ −4.1), momentum's damping carries it over the rim onto the
    // interior plain and into the skerry (f ≈ −0.5). None sees the deep
    // atoll; the curated drive steers there across two ridges (verified in
    // tiltGame.test.ts).
    { key: "gd", label: "GD", cssColor: "#FC6255", make: () => gd(0.04) },
    { key: "mom", label: "momentum", cssColor: "#58C4DD", make: () => momentum(0.06, 0.9) },
    { key: "adam", label: "Adam", cssColor: "#F4D345", make: () => adam(0.15, 0.9, 0.999, 1e-8) },
  ],
  canyon: [
    // Wall curvature 2B = 16 (plus the peak flanks' ≈ 83): η under 2/83
    // keeps GD stable near the peaks. On the gentle winding floor momentum
    // and Adam ride the whole canyon to the sea gate (verified); GD crawls
    // at the mouth — the drain term is all it sees from there.
    { key: "gd", label: "GD", cssColor: "#FC6255", make: () => gd(0.002) },
    { key: "mom", label: "momentum", cssColor: "#58C4DD", make: () => momentum(0.004, 0.9) },
    { key: "adam", label: "Adam", cssColor: "#F4D345", make: () => adam(0.05, 0.9, 0.999, 1e-8) },
  ],
  // The swarm level never races machines in-page (the swarm IS the field),
  // but the Record must cover every TiltLevelId — safe mid-rate settings.
  swarm: [
    { key: "gd", label: "GD", cssColor: "#FC6255", make: () => gd(0.1) },
    { key: "mom", label: "momentum", cssColor: "#58C4DD", make: () => momentum(0.05, 0.9) },
    { key: "adam", label: "Adam", cssColor: "#F4D345", make: () => adam(0.15, 0.9, 0.999, 1e-8) },
  ],
};

export interface TiltMachineRun {
  key: TiltMachineSpec["key"];
  label: string;
  cssColor: string;
  path: Vec2[];
  steps: number;
  /** Got within the goal radius (goalFrac·diag) of `level.goal` — the
   *  GLOBAL minimum. Resting elsewhere is not "reached" — EXCEPT on
   *  anyMinimum levels (Rastrigin), where settling in any pit counts. */
  reached: boolean;
  /** Ended on quiet ground: |∇f| < settleGrad at the final point — the SAME
   *  gradient rule the player's settle uses (wherever the pit is). False for
   *  a run that left the extent or went non-finite. */
  settled: boolean;
  /** Where the run rests (tiltBasin): basin label + global flag + atMin. */
  basin: { label: string; global: boolean; atMin: boolean };
  /** Unique measurement cells on the player's grid (tiltCellKey) the path
   *  visits — the scorecard's cells column is one scale for every row (QA
   *  COPY2-TILT-STEPS-CELLS-NOT-SAME-PAIR). */
  cells: number;
  /** Final parameter point. */
  end: Vec2;
  finalLoss: number;
}

/** Runs one machine from `start` on the level's landscape. */
export function runTiltMachine(
  level: TiltLevel,
  spec: TiltMachineSpec,
  start: Vec2,
): TiltMachineRun {
  const opt = spec.make();
  let state = opt.initState(start);
  const e = level.landscape.extent;
  const m = 1.05;
  const path: Vec2[] = [{ ...start }];
  // Same goal predicate as the player's verdict (tiltAtGoal) — sticky: a
  // machine that ever enters the goal radius counts as having reached it.
  let reached = tiltAtGoal(level, start);
  let escaped = false; // left the extent / non-finite → never "settled"
  for (let i = 0; i < TILT_MACHINE_STEPS; i++) {
    state = opt.step(state, level.landscape.grad(state.pos));
    if (!Number.isFinite(state.pos.x) || !Number.isFinite(state.pos.y)) {
      escaped = true;
      break;
    }
    if (
      state.pos.x < e.xMin * m || state.pos.x > e.xMax * m ||
      state.pos.y < e.yMin * m || state.pos.y > e.yMax * m
    ) {
      escaped = true;
      break;
    }
    path.push({ ...state.pos });
    if (!reached && tiltAtGoal(level, state.pos)) {
      reached = true;
    }
  }
  const end = { ...path[path.length - 1] };
  const gE = level.landscape.grad(end);
  const settled = !escaped && Math.hypot(gE.x, gE.y) < level.settleGrad;
  const basin = tiltBasin(level, end);
  // "Any minimum counts" levels (Rastrigin): settling in ANY pit is reaching
  // a minimum (QA copy-tilt-which-minimum). An escaped run never counts.
  if (level.anyMinimum && !escaped && basin.atMin) reached = true;
  return {
    key: spec.key,
    label: spec.label,
    cssColor: spec.cssColor,
    path,
    steps: path.length - 1,
    reached,
    settled,
    basin,
    cells: new Set(path.map((p) => tiltCellKey(level, p))).size,
    end,
    finalLoss: level.landscape.f(end),
  };
}

export function runTiltMachines(level: TiltLevel, start: Vec2): TiltMachineRun[] {
  return MACHINES[level.id].map((spec) => runTiltMachine(level, spec, start));
}

/* ------------------------------------------------------------------ */
/* The swarm finale — 100 instanced balls into distinct minima          */
/* ------------------------------------------------------------------ */

export const SWARM_COUNT = 100;
/** Damping the swarm rolls with: high enough that balls glide into their
 *  pits without ringing across them (verified: 100/100 settle, all six wells
 *  occupied, shorter paths than the underdamped variant). */
export const SWARM_FRICTION = 0.9;
/** Hard substep cap per ball. */
const SWARM_MAX_SUBSTEPS = 3600;

/**
 * A ball has been CAPTURED by a well when its normalized elliptical distance
 * q = √(u²/a² + t²/b²) (u/t = the offset rotated into the well's frame, the
 * same rotation `multiWell.f` uses) is within SWARM_CAPTURE_Q. At q = 0.5
 * the well term is still ≥ e^-0.25 ≈ 78% of its depth; measured across the
 * shipped swarm, every true floor-resting ball lands at q ≤ 0.25 and every
 * open-plain staller at q ≥ 0.86, so 0.5 splits them with a wide margin.
 */
export const SWARM_CAPTURE_Q = 0.5;

/** Index of the well whose capture ellipse contains `p` (smallest q, only
 *  when q ≤ SWARM_CAPTURE_Q), or −1 when the point belongs to no basin.
 *  Wells come from the landscape itself (`wells`), so ANY well-list
 *  landscape classifies — not just the default multi-well country. */
export function swarmBasinOf(p: Vec2, wells: ReadonlyArray<WellSpec> = MULTI_WELL_WELLS): number {
  let best = -1;
  let bestQ = SWARM_CAPTURE_Q;
  for (let i = 0; i < wells.length; i++) {
    const w = wells[i];
    const dx = p.x - w.x;
    const dy = p.y - w.y;
    const c = Math.cos((w.thetaDeg * Math.PI) / 180);
    const s = Math.sin((w.thetaDeg * Math.PI) / 180);
    const u = dx * c + dy * s;
    const t = -dx * s + dy * c;
    const q = Math.sqrt((u * u) / (w.a * w.a) + (t * t) / (w.b * w.b));
    if (q < bestQ) {
      bestQ = q;
      best = i;
    }
  }
  return best;
}

export interface SwarmSim {
  starts: Vec2[];
  paths: Vec2[][];
  /** Balls that came to rest on quiet ground. */
  settledCount: number;
  /** Per-ball basin classification by swarmBasinOf (−1 = open ground). */
  basinOf: number[];
  /** Balls captured by a well's basin (basinOf ≥ 0). */
  capturedCount: number;
  /** DISTINCT measurement cells occupied by CAPTURED settled balls. A long
   *  well's rest cluster can straddle cell borders, so this over-counts
   *  minima — use minimaFound for that. */
  minimaCells: number;
  /** DISTINCT wells (swarmBasinOf ≥ 0) holding a captured, settled ball —
   *  one per local minimum (QA S2-SWARM-SEVEN-MINIMA /
   *  COPY2-SWARM-SIX-BASINS-VS-7-MINIMA). */
  minimaFound: number;
  /** DISTINCT measurement cells crossed by ANY ball — the blind ensemble's
   *  collective map ("run it blind" paints exactly these). */
  paintedCells: number;
}

/** Halton low-discrepancy sequence — deterministic, no Math.random. */
function halton(index: number, base: number): number {
  let f = 1;
  let r = 0;
  let i = index;
  while (i > 0) {
    f /= base;
    r += f * (i % base);
    i = Math.floor(i / base);
  }
  return r;
}

/** The 100 scattered starts: Halton points 1..N inside a 0.82 margin. */
export function swarmStarts(level: TiltLevel, count: number = SWARM_COUNT): Vec2[] {
  const e = level.landscape.extent;
  const mx = (e.xMax - e.xMin) / 2;
  const my = (e.yMax - e.yMin) / 2;
  const cx = (e.xMin + e.xMax) / 2;
  const cy = (e.yMin + e.yMax) / 2;
  const out: Vec2[] = [];
  for (let i = 1; i <= count; i++) {
    out.push({
      x: cx + (halton(i, 2) * 2 - 1) * mx * 0.82,
      y: cy + (halton(i, 3) * 2 - 1) * my * 0.82,
    });
  }
  return out;
}

/**
 * Simulates the whole swarm with the SAME physics (no tilt, fixed damping):
 * each ball races down the landscape and settles into whatever minimum
 * catches it — the basins-of-attraction showcase, precomputed so the scene
 * can scrub/loop it deterministically. Recording is DISTANCE-based (a sample
 * only when the ball has moved ~half a measurement cell) so the ring-down
 * oscillations inside a pit never draw as scribble — the ghost shows the
 * glide, then the arrival.
 */
export function simulateSwarm(level: TiltLevel, count: number = SWARM_COUNT): SwarmSim {
  const starts = swarmStarts(level, count);
  const paths: Vec2[][] = [];
  let settledCount = 0;
  let capturedCount = 0;
  const basinOf: number[] = [];
  const cells = new Set<string>();
  const basinsHit = new Set<number>();
  const painted = new Set<string>();
  const minSeg = tiltDiag(level) * level.cellFrac * 0.45;
  for (const start of starts) {
    // Time-based recording disabled (recEvery > any run); the loop below
    // records by distance instead. requireLaunch: a ball born on gentle
    // ground must actually roll before its rest counts as settled
    // (QA S7-SWARM-1).
    const run = tiltInit(level, { start, recEvery: SWARM_MAX_SUBSTEPS + 1, requireLaunch: true });
    // requireLaunch's one blind spot (multi-well large): a Halton start can
    // land EXACTLY on a basin floor (|∇f| < settleGrad — the prairie bowl's
    // flat bottom). That ball will never launch and never settle, but it is
    // already resting IN its basin, permanently — the honest verdict is
    // settled+captured at the start point, not a 30 s cap timeout.
    const g0 = level.landscape.grad(start);
    if (
      Math.hypot(g0.x, g0.y) < level.settleGrad &&
      swarmBasinOf(start, level.landscape.wells) >= 0
    ) {
      run.done = true;
      run.settled = true;
      run.launched = true;
    }
    while (run.steps < SWARM_MAX_SUBSTEPS && !run.done) {
      tiltStep(level, run, { x: 0, y: 0 }, SWARM_FRICTION);
      const last = run.rec[run.rec.length - 1];
      if (Math.hypot(run.pos.x - last.x, run.pos.y - last.y) >= minSeg) {
        run.rec.push({ ...run.pos });
      }
    }
    // Ensure the final resting position is on the ghost path.
    const last = run.rec[run.rec.length - 1];
    if (!last || last.x !== run.pos.x || last.y !== run.pos.y) {
      run.rec.push({ ...run.pos });
    }
    // A slow CRAWLER (its speed never reached the launch threshold —
    // multi-well large's prairie-bowl floor is that gentle) that comes to
    // rest INSIDE a basin is a basin member, not a staller: QA S7-SWARM-1
    // guards open-ground self-scoring, and this rest is on a true floor.
    if (!run.done && Math.hypot(run.vel.x, run.vel.y) < TILT_SETTLE_SPEED) {
      const ge = level.landscape.grad(run.pos);
      if (
        Math.hypot(ge.x, ge.y) < level.settleGrad &&
        swarmBasinOf(run.pos, level.landscape.wells) >= 0
      ) {
        run.done = true;
        run.settled = true;
      }
    }
    paths.push(trimRingdown(run.rec, tiltDiag(level) * level.cellFrac * 2.2));
    // The full cell ledger lives on the run even after the ghost path is
    // trimmed — the ensemble's collective map.
    for (const key of run.cells) painted.add(key);
    // Basins classify against THE LEVEL'S OWN wells (any well-list landscape).
    const basin = swarmBasinOf(run.pos, level.landscape.wells);
    basinOf.push(basin);
    if (run.settled) {
      settledCount += 1;
      // Basin membership decides the "minima found" count: a rest on open
      // ground (basin −1) is not a minimum (QA S7-SWARM-2).
      if (basin >= 0) {
        capturedCount += 1;
        cells.add(tiltCellKey(level, run.pos));
        basinsHit.add(basin);
      }
    }
  }
  return {
    starts,
    paths,
    settledCount,
    basinOf,
    capturedCount,
    minimaCells: cells.size,
    minimaFound: basinsHit.size,
    paintedCells: painted.size,
  };
}

/** One cell the swarm's blind paint stamps, and WHEN (the ball's
 *  distance-paced progress at which it enters the cell). */
export interface SwarmPaintEntry {
  key: string;
  /** Cell centre (parameter space). */
  x: number;
  y: number;
  /** Progress p ∈ [0, 1] along the ball's ghost path (samplePath's
   *  arc-length pacing) at which the ball reaches the cell. */
  arcFrac: number;
}

/**
 * Exact paint ledger for one swarm ghost path (QA
 * S2-SWARM-PAINT-MISSES-CROSSED-CELLS): the start cell (arcFrac 0) plus every
 * cell each straight segment crosses, found by exact grid-line traversal —
 * the old vertex-only ledger skipped start cells and every cell under a
 * chord. arcFrac inverts samplePath's per-segment smoothstep so a stamp
 * fires exactly when the drawn ball reaches the cell boundary.
 */
export function swarmPaintLedger(level: TiltLevel, path: readonly Vec2[]): SwarmPaintEntry[] {
  const out: SwarmPaintEntry[] = [];
  if (path.length === 0) return out;
  const e = level.landscape.extent;
  const w = tiltDiag(level) * level.cellFrac;
  const seen = new Set<string>();
  const cum: number[] = [0];
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
    cum.push(total);
  }
  const invSmooth = (y: number): number =>
    0.5 - Math.sin(Math.asin(Math.min(1, Math.max(-1, 1 - 2 * y))) / 3);
  const push = (p: Vec2, arcFrac: number): void => {
    const key = tiltCellKey(level, p);
    if (seen.has(key)) return;
    seen.add(key);
    const ix = Math.floor((p.x - e.xMin) / w);
    const iy = Math.floor((p.y - e.yMin) / w);
    out.push({ key, x: e.xMin + (ix + 0.5) * w, y: e.yMin + (iy + 0.5) * w, arcFrac });
  };
  push(path[0], 0);
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const us: number[] = [0, 1];
    for (const axis of ["x", "y"] as const) {
      const lo = axis === "x" ? e.xMin : e.yMin;
      const g0 = (a[axis] - lo) / w;
      const g1 = (b[axis] - lo) / w;
      if (Math.abs(g1 - g0) < 1e-12) continue;
      const kMin = Math.floor(Math.min(g0, g1)) + 1;
      const kMax = Math.floor(Math.max(g0, g1));
      for (let k = kMin; k <= kMax; k++) {
        const u = (k - g0) / (g1 - g0);
        if (u > 0 && u < 1) us.push(u);
      }
    }
    us.sort((p, q) => p - q);
    const seg = cum[i] - cum[i - 1];
    for (let k = 0; k + 1 < us.length; k++) {
      const u0 = us[k];
      const u1 = us[k + 1];
      if (u1 - u0 <= 1e-12) continue;
      const um = (u0 + u1) / 2;
      const mid = { x: a.x + (b.x - a.x) * um, y: a.y + (b.y - a.y) * um };
      const arcFrac = total > 1e-9 ? (cum[i - 1] + seg * invSmooth(u0)) / total : 1;
      push(mid, Math.min(1, Math.max(0, arcFrac)));
    }
  }
  return out;
}

/**
 * Cuts the trailing ring-down: walks back from the end to the last sample
 * that still has ≥ `keepArc` of approach ahead of it, drops the wobble
 * samples between there and the pit, and keeps ONE straight final segment
 * into the resting point — the ghost shows the clean descent and the
 * arrival, not the wobbling settling-in.
 */
function trimRingdown(path: Vec2[], keepArc: number): Vec2[] {
  if (path.length <= 2) return path;
  const end = path[path.length - 1];
  let arc = 0;
  let i = path.length - 1;
  while (i > 0 && arc < keepArc) {
    arc += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
    i -= 1;
  }
  if (i === 0) return [path[0], end];
  return [...path.slice(0, i + 1), end];
}

/* ------------------------------------------------------------------ */
/* Damping slider (the β analogy)                                      */
/* ------------------------------------------------------------------ */

export type DampingRegime = "long memory" | "damped" | "over-damped";

export function dampingRegime(friction: number): DampingRegime {
  if (friction < 0.4) return "long memory";
  if (friction <= 1.4) return "damped";
  return "over-damped";
}

/** Monospace-friendly loss formatting (shared with §6's scorecards). */
export function tiltFormatLoss(loss: number): string {
  if (loss !== 0 && Math.abs(loss) < 0.001) return loss.toExponential(2);
  if (loss >= 100) return loss.toFixed(1);
  return loss.toPrecision(3);
}

/** Rastrigin pit index: its local minima sit just inside the integer
 *  lattice points (e.g. (−0.995, 1.990)), so rounding names the pit. */
function rastrPit(p: Vec2): { i: number; j: number } {
  // `+ 0` folds −0 into 0 so the global pit always reads (0, 0).
  return { i: Math.round(p.x) + 0, j: Math.round(p.y) + 0 };
}

/** Typographic minus for coordinates (U+2212). */
function fmtCoord(n: number): string {
  return n < 0 ? `\u2212${Math.abs(n)}` : String(n);
}

/**
 * Names the minimum a point rests in. On Rastrigin: "the global minimum
 * (0, 0)" or "a local minimum near (i, j)" by the nearest lattice point;
 * the single-minimum levels just say "the minimum".
 */
export function tiltPitLabel(level: TiltLevel, p: Vec2): string {
  if (level.id !== "rastr") return "the minimum";
  const { i, j } = rastrPit(p);
  if (i === 0 && j === 0) return "the global minimum (0, 0)";
  return `a local minimum near (${fmtCoord(i)}, ${fmtCoord(j)})`;
}

/** Same Rastrigin pit (same nearest lattice point). */
export function tiltSamePit(a: Vec2, b: Vec2): boolean {
  const pa = rastrPit(a);
  const pb = rastrPit(b);
  return pa.i === pb.i && pa.j === pb.j;
}

/**
 * Classifies WHERE a point rests, for the tilt scorecard's "minimum" column
 * (QA copy-tilt-which-minimum). `atMin` applies the SAME quiet-ground rule
 * the settle uses; on Rastrigin the basin is the nearest lattice point (its
 * minima sit just inside the integer grid), labeled "(i, j)" with a real
 * minus sign; single-minimum levels report "goal" inside the goal radius and
 * "—" elsewhere.
 */
export function tiltBasin(
  level: TiltLevel,
  p: Vec2,
  vel?: Vec2,
): { label: string; global: boolean; atMin: boolean } {
  const g = level.landscape.grad(p);
  const quiet = Math.hypot(g.x, g.y) < level.settleGrad;
  const atMin = quiet;
  if (level.anyMinimum) {
    const { i, j } = rastrPit(p);
    const global = i === 0 && j === 0;
    // A SLOW ball ringing down inside a pit rests in it (QA
    // S7-RASTR-FINISH-SLOPE): the gradient test alone passes only within
    // ~0.002 of a 397-curvature pit floor. Only the player's row passes vel;
    // machine grading (no vel) is unchanged.
    const resting =
      vel !== undefined &&
      Math.hypot(vel.x, vel.y) < TILT_CUE_SPEED &&
      Math.max(Math.abs(p.x - i), Math.abs(p.y - j)) < TILT_PIT_REST_RADIUS;
    return { label: `(${fmtCoord(i)}, ${fmtCoord(j)})`, global, atMin: quiet || resting };
  }
  const global = tiltAtGoal(level, p);
  return { label: global ? "goal" : "\u2014", global, atMin };
}
