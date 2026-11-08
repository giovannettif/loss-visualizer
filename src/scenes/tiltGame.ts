/**
 * tiltGame — the pure, deterministic core of §7's tilt game (no DOM, no three).
 *
 * Three levels:
 *   level 1 "elongated valley" — the §2/§3 rotated bowl: tilt across it and
 *           the ball zigzags exactly the way vanilla GD does (feel the trap),
 *   level 2 "Rosenbrock"      — the banana valley with the seductive floor,
 *   level 3 "Rastrigin"       — an egg crate of local minima: settle anywhere.
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
 * Scoring per level ("reach a minimum"): the ball must COME TO REST where the
 * needle is quiet (|∇f| below the level's settle threshold while |v| is tiny,
 * held for a run of substeps) — or the player presses Finish. The score is
 * (unique visited cells, elapsed steps): every new cell is one fresh
 * measurement of the ground — the only information an optimizer ever gets.
 *
 * Everything here is pure state-in/state-out so the vitest suite can verify
 * the physics the same way it verifies the math core. No Math.random: the
 * swarm's 100 starts come from a fixed Halton low-discrepancy sequence.
 */

import { defaultBowl, rosenbrock, rastrigin, multiWell, type Landscape, type Vec2 } from "../core/functions";
import { gd, momentum, adam, type Optimizer } from "../core/optimizers";

/* ------------------------------------------------------------------ */
/* Levels                                                              */
/* ------------------------------------------------------------------ */

export type TiltLevelId = "valley" | "rosen" | "rastr" | "swarm";

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
  /** |∇f| below which the ball counts as settled in a minimum. */
  settleGrad: number;
  /** Measurement-cell edge as a fraction of the extent diagonal. */
  cellFrac: number;
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
};

export const TILT_LEVELS: readonly TiltLevel[] = [TILT_VALLEY, TILT_ROSEN, TILT_RASTR];

/**
 * The §7 swarm finale's OWN landscape (not a playable tilt level): the
 * multi-well country — one clear global basin plus five local basins of
 * DIFFERENT depths, widths and shapes (see functions.ts MULTI_WELL_WELLS),
 * so the 100-ball clusters end at visibly unequal final losses instead of
 * indistinguishable Rastrigin pits. settleGrad 0.35 is tight enough that
 * balls only rest at true well floors (the open rim's slope is steeper).
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
  gravity: 0.5,
  tiltAccel: 12,
  vmax: 10,
  settleGrad: 0.35,
  cellFrac: 0.05,
};

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
  cellSeen: Set<string>;
  /** Consecutive settled substeps. */
  rest: number;
  /** The run is over: settled in a minimum, or Finish was pressed. */
  done: boolean;
  settled: boolean;
  /** True once ANY nonzero tilt has been applied (QA GP-1): a run born at
   *  rest on quiet ground must not score itself before the player has
   *  steered — with the loosened settle threshold the level-1 opening drift
   *  settled within half a second and the live game ended before play. */
  steered: boolean;
  /** When set, settle counting waits for `steered` (the live game). */
  requireInput: boolean;
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
  opts: { start?: Vec2; recEvery?: number; requireInput?: boolean } = {},
): TiltRun {
  const pos = opts.start ? { ...opts.start } : { ...level.start };
  return {
    pos,
    vel: { x: 0, y: 0 },
    steps: 0,
    rec: [{ ...pos }],
    recEvery: opts.recEvery ?? TILT_REC_EVERY,
    cells: [tiltCellKey(level, pos)],
    cellSeen: new Set([tiltCellKey(level, pos)]),
    rest: 0,
    done: false,
    settled: false,
    steered: false,
    requireInput: opts.requireInput ?? false,
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
  }

  // Settled in a minimum? Quiet needle AND near-zero speed, sustained —
  // but only once the player has steered, when the run demands input: a run
  // born on quiet ground is the attract state, not a scored rest.
  const gl = Math.hypot(g.x, g.y);
  const vl = Math.hypot(run.vel.x, run.vel.y);
  if (
    gl < level.settleGrad &&
    vl < TILT_SETTLE_SPEED &&
    (run.steered || !run.requireInput)
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
  /** Got within the goal radius (or settled on quiet ground). */
  reached: boolean;
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
  const goalR = tiltGoalRadius(level);
  const path: Vec2[] = [{ ...start }];
  let reached =
    Math.hypot(start.x - level.goal.x, start.y - level.goal.y) < goalR;
  for (let i = 0; i < TILT_MACHINE_STEPS; i++) {
    state = opt.step(state, level.landscape.grad(state.pos));
    if (!Number.isFinite(state.pos.x) || !Number.isFinite(state.pos.y)) break;
    if (
      state.pos.x < e.xMin * m || state.pos.x > e.xMax * m ||
      state.pos.y < e.yMin * m || state.pos.y > e.yMax * m
    ) {
      break;
    }
    path.push({ ...state.pos });
    if (
      !reached &&
      Math.hypot(state.pos.x - level.goal.x, state.pos.y - level.goal.y) < goalR
    ) {
      reached = true;
    }
  }
  return {
    key: spec.key,
    label: spec.label,
    cssColor: spec.cssColor,
    path,
    steps: path.length - 1,
    reached,
    finalLoss: level.landscape.f(path[path.length - 1]),
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
 *  pits without ringing across them (verified: 100/100 settle, 68 distinct
 *  minima, half the path length of the underdamped variant). */
export const SWARM_FRICTION = 0.9;
/** Hard substep cap per ball. */
const SWARM_MAX_SUBSTEPS = 3600;

export interface SwarmSim {
  starts: Vec2[];
  paths: Vec2[][];
  /** Balls that came to rest on quiet ground. */
  settledCount: number;
  /** DISTINCT measurement cells occupied by settled balls (= minima hit). */
  minimaCells: number;
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
  const cells = new Set<string>();
  const painted = new Set<string>();
  const minSeg = tiltDiag(level) * level.cellFrac * 0.45;
  for (const start of starts) {
    // Time-based recording disabled (recEvery > any run); the loop below
    // records by distance instead.
    const run = tiltInit(level, { start, recEvery: SWARM_MAX_SUBSTEPS + 1 });
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
    paths.push(trimRingdown(run.rec, tiltDiag(level) * level.cellFrac * 2.2));
    // The full cell ledger lives on the run even after the ghost path is
    // trimmed — the ensemble's collective map.
    for (const key of run.cells) painted.add(key);
    if (run.settled) {
      settledCount += 1;
      cells.add(tiltCellKey(level, run.pos));
    }
  }
  return { starts, paths, settledCount, minimaCells: cells.size, paintedCells: painted.size };
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
