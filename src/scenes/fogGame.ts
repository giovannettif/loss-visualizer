/**
 * fogGame — the pure, deterministic core of §6's fog game (no DOM, no three).
 *
 * Two levels:
 *   level 1 "least squares" — the EXACT §1 landscape (continuity: the surface
 *           you fit by hand, now invisible),
 *   level 2 "Rosenbrock"    — the banana valley whose parabolic trap region
 *           makes the local-minimum reveal beat land naturally.
 *
 * Turn loop (owned by the director): drag an arrow on the compass minimap →
 * the ball walks there → each landed step costs one MEASUREMENT (the loss and
 * the gradient at the new point — nothing else is ever learned). Reaching the
 * budget (or pressing Finish) ends the run and lifts the fog.
 *
 * Everything here is pure state-in/state-out so the vitest suite can verify
 * the game rules the same way it verifies the math core.
 */

import { LEAST_SQUARES_POINTS, rosenbrock, leastSquares, type Landscape, type Vec2 } from "../core/functions";
import { gd, momentum, adam, type Optimizer } from "../core/optimizers";

/* ------------------------------------------------------------------ */
/* Levels                                                              */
/* ------------------------------------------------------------------ */

export interface FogLevel {
  id: "ls" | "rb";
  /** Display name for the fog panel. */
  name: string;
  /** "1" or "2" — display ordinal. */
  ordinal: string;
  landscape: Landscape;
  start: Vec2;
  /** Measurements allowed per run. */
  budget: number;
  /** Max step length as a fraction of the extent diagonal. */
  reachFrac: number;
  /** Fog stamp radius as a fraction of the extent diagonal. */
  stampFrac: number;
  /** The true global minimum (marked at the reveal). */
  globalMin: Vec2;
}

/** Exact least-squares argmin via the normal equations (deterministic). */
function lsArgmin(): Vec2 {
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

export const FOG_LS: FogLevel = {
  id: "ls",
  name: "least squares",
  ordinal: "1",
  landscape: leastSquares,
  start: { x: 0.2, y: 0.5 },
  budget: 10,
  reachFrac: 0.16,
  stampFrac: 0.07,
  globalMin: lsArgmin(),
};

export const FOG_RB: FogLevel = {
  id: "rb",
  name: "Rosenbrock",
  ordinal: "2",
  landscape: rosenbrock,
  start: { x: -1.2, y: 1.44 }, // ON the parabola y = x², far from (1, 1)
  budget: 10,
  reachFrac: 0.16,
  stampFrac: 0.07,
  globalMin: { x: 1, y: 1 },
};

/* ------------------------------------------------------------------ */
/* State + rules                                                       */
/* ------------------------------------------------------------------ */

export interface FogState {
  /** Where the player stands (the latest committed point). */
  point: Vec2;
  /** Visited points in order — path[0] is always level.start. */
  path: Vec2[];
  /** Measurements spent. */
  used: number;
  /** Loss at `point` (the only number the fog ever gives up). */
  loss: number;
  /** Run finished (budget spent or Finish pressed): fog lifts. */
  done: boolean;
}

export function fogInit(level: FogLevel): FogState {
  return {
    point: { ...level.start },
    path: [{ ...level.start }],
    used: 0,
    loss: level.landscape.f(level.start),
    done: false,
  };
}

/** A run reconstructed from a full point path (curated/frozen poses). */
export function fogStateFromPath(
  level: FogLevel,
  path: readonly Vec2[],
  done: boolean,
): FogState {
  const pts = path.map((p) => ({ ...p }));
  return {
    point: { ...pts[pts.length - 1] },
    path: pts,
    used: pts.length - 1,
    loss: level.landscape.f(pts[pts.length - 1]),
    done,
  };
}

/** Extent diagonal (world of the reach/stamp fractions). */
export function fogDiag(level: FogLevel): number {
  const e = level.landscape.extent;
  return Math.hypot(e.xMax - e.xMin, e.yMax - e.yMin);
}

/** Maximum step length in parameter units. */
export function fogReach(level: FogLevel): number {
  return fogDiag(level) * level.reachFrac;
}

/**
 * Clamps a desired tip into the extent AND inside the reach circle around
 * `from` — the player can never draw a step longer than the stride ring.
 */
export function fogClampTip(level: FogLevel, from: Vec2, tip: Vec2): Vec2 {
  const e = level.landscape.extent;
  const cx = Math.min(e.xMax, Math.max(e.xMin, tip.x));
  const cy = Math.min(e.yMax, Math.max(e.yMin, tip.y));
  const dx = cx - from.x;
  const dy = cy - from.y;
  const d = Math.hypot(dx, dy);
  const reach = fogReach(level);
  if (d <= reach) return { x: cx, y: cy };
  return { x: from.x + (dx / d) * reach, y: from.y + (dy / d) * reach };
}

/** Steps worth counting: a tap closer than this to the current point is a
 *  mis-drag, not a measurement — the budget is never wasted by accident. */
export function fogMinStep(level: FogLevel): number {
  return fogReach(level) * 0.05;
}

/* ---------------- the fog cell grid ----------------
 *
 * In fog mode the compass draws a faint cell grid and every stride endpoint
 * SNAPS to the nearest cell center: strides read like board-game moves, the
 * drawn arrow lands on an unambiguous spot, and equal strides stamp equal
 * patches. Cell sides are ~diag/10 with per-axis counts rounded to integers.
 */

export interface FogCellGrid {
  nx: number;
  ny: number;
  /** Cell width/height in parameter units. */
  cw: number;
  ch: number;
}

export function fogCellGrid(level: FogLevel): FogCellGrid {
  const e = level.landscape.extent;
  const spanX = e.xMax - e.xMin;
  const spanY = e.yMax - e.yMin;
  const cell = fogDiag(level) / 10;
  const nx = Math.max(1, Math.round(spanX / cell));
  const ny = Math.max(1, Math.round(spanY / cell));
  return { nx, ny, cw: spanX / nx, ch: spanY / ny };
}

/** Nearest cell center of the fog grid for parameter point `p`. */
export function fogSnapToCell(level: FogLevel, p: Vec2): Vec2 {
  const e = level.landscape.extent;
  const g = fogCellGrid(level);
  const ix = Math.min(g.nx - 1, Math.max(0, Math.floor((p.x - e.xMin) / g.cw)));
  const iy = Math.min(g.ny - 1, Math.max(0, Math.floor((p.y - e.yMin) / g.ch)));
  return {
    x: e.xMin + (ix + 0.5) * g.cw,
    y: e.yMin + (iy + 0.5) * g.ch,
  };
}

/** True when `a` and `b` sit in the same fog grid cell (the indices
 *  fogSnapToCell uses). */
export function fogSameCell(level: FogLevel, a: Vec2, b: Vec2): boolean {
  const e = level.landscape.extent;
  const g = fogCellGrid(level);
  const ix = (p: Vec2): number => Math.min(g.nx - 1, Math.max(0, Math.floor((p.x - e.xMin) / g.cw)));
  const iy = (p: Vec2): number => Math.min(g.ny - 1, Math.max(0, Math.floor((p.y - e.yMin) / g.ch)));
  return ix(a) === ix(b) && iy(a) === iy(b);
}

/** Pure commit: spends one measurement and moves to `tip`. */
export function fogCommit(level: FogLevel, st: FogState, tip: Vec2): FogState {
  return {
    point: { ...tip },
    path: [...st.path, { ...tip }],
    used: st.used + 1,
    loss: level.landscape.f(tip),
    done: st.used + 1 >= level.budget,
  };
}

/** A compass gesture that travelled less than this (CSS px) is a tap or a
 *  jitter, not a drag — the copy says "Drag on the compass". */
export const FOG_DRAG_SLOP_PX = 6;

/**
 * Resolves a compass gesture into the stride it commits, or null when it must
 * NOT spend a measurement:
 *   (a) the pointer travelled < FOG_DRAG_SLOP_PX — a tap/jitter, not a drag
 *       (the cell snap would otherwise turn any tap into a whole stride);
 *   (b) the RAW (reach-clamped) tip is on or next to the ball — checked
 *       BEFORE snapping, which would move it a cell away;
 *   (c) the snapped + clamped tip falls back into the ball's own cell.
 * Otherwise returns the snapped, reach-clamped tip (the same snap-then-clamp
 * order the live preview uses).
 */
export function fogResolveStride(
  level: FogLevel,
  from: Vec2,
  rawTip: Vec2,
  travelPx: number,
): Vec2 | null {
  if (travelPx < FOG_DRAG_SLOP_PX) return null;
  const minStep = fogMinStep(level);
  const raw = fogClampTip(level, from, rawTip);
  if (Math.hypot(raw.x - from.x, raw.y - from.y) < minStep) return null;
  const snapped = fogClampTip(level, from, fogSnapToCell(level, rawTip));
  if (Math.hypot(snapped.x - from.x, snapped.y - from.y) < minStep) return null;
  // Rule (c) on cell INDICES (QA S2A-FOG-OWNCELL-SPEND): reach-clamped
  // strides land off-grid, so a hop back to the ball's own cell centre can be
  // far longer than minStep — it must still never spend a measurement.
  if (fogSameCell(level, from, snapped)) return null;
  return snapped;
}

/**
 * The Rosenbrock trap: the parabolic valley floor (|y − x²| small) left of
 * x = 0.45 — low, smooth, and self-announcing in every measurable direction,
 * while the true minimum (1, 1) sits across the curvature.
 */
export function inRosenbrockTrap(p: Vec2): boolean {
  return (
    Math.abs(p.y - p.x * p.x) < 0.35 &&
    p.x < 0.45 &&
    rosenbrock.f(p) < 3
  );
}

/* ------------------------------------------------------------------ */
/* The machines (reveal screen)                                        */
/* ------------------------------------------------------------------ */

/** Every machine gets 60 blind measurements from the player's start. */
export const FOG_MACHINE_STEPS = 60;

export interface FogMachineSpec {
  key: "gd" | "mom" | "adam";
  label: string;
  cssColor: string;
  make: () => Optimizer;
}

/** η tuned per level (verified numerically against the real core — see
 *  fog.test.ts): on least squares all three converge to the 1.425 floor of
 *  the 12 noisy points; on Rosenbrock GD crawls (4.66), momentum slides
 *  (3.23) and Adam plateaus on the parabolic wall (~3.9) after 60 steps. */
const MACHINES: Record<FogLevel["id"], FogMachineSpec[]> = {
  ls: [
    { key: "gd", label: "GD", cssColor: "#FC6255", make: () => gd(0.008) },
    { key: "mom", label: "momentum", cssColor: "#58C4DD", make: () => momentum(0.006, 0.9) },
    { key: "adam", label: "Adam", cssColor: "#F4D345", make: () => adam(0.1, 0.9, 0.999, 1e-8) },
  ],
  rb: [
    { key: "gd", label: "GD", cssColor: "#FC6255", make: () => gd(0.001) },
    { key: "mom", label: "momentum", cssColor: "#58C4DD", make: () => momentum(0.001, 0.9) },
    { key: "adam", label: "Adam", cssColor: "#F4D345", make: () => adam(0.05, 0.9, 0.999, 1e-8) },
  ],
};

export interface FogMachineRun {
  key: FogMachineSpec["key"];
  label: string;
  cssColor: string;
  /** Parameter-space trajectory (deterministic). */
  path: Vec2[];
  /** Measurements actually spent (stops early if it leaves the extent). */
  steps: number;
  finalLoss: number;
}

/** Runs one machine from `start` on the level's landscape. */
export function runFogMachine(level: FogLevel, spec: FogMachineSpec): FogMachineRun {
  const opt = spec.make();
  let state = opt.initState(level.start);
  const e = level.landscape.extent;
  const m = 1.05;
  const path: Vec2[] = [{ ...level.start }];
  for (let i = 0; i < FOG_MACHINE_STEPS; i++) {
    state = opt.step(state, level.landscape.grad(state.pos));
    if (!Number.isFinite(state.pos.x) || !Number.isFinite(state.pos.y)) break;
    if (
      state.pos.x < e.xMin * m || state.pos.x > e.xMax * m ||
      state.pos.y < e.yMin * m || state.pos.y > e.yMax * m
    ) {
      break;
    }
    path.push({ ...state.pos });
  }
  return {
    key: spec.key,
    label: spec.label,
    cssColor: spec.cssColor,
    path,
    steps: path.length - 1,
    finalLoss: level.landscape.f(path[path.length - 1]),
  };
}

export function runFogMachines(level: FogLevel): FogMachineRun[] {
  return MACHINES[level.id].map((spec) => runFogMachine(level, spec));
}

/* ------------------------------------------------------------------ */
/* Curated deterministic runs (frozen shots + ghost fallback)          */
/* ------------------------------------------------------------------ */

/** The canonical player story: follow the needle down the banana, the floor
 *  flattens, stop feeling done — 4 measurements, loss 0.36, ON the trap.
 *  Every stride ≤ the 0.905 reach (verified in fogGame.test.ts). The reveal
 *  then shows the true minimum two strides across the unvisited ridge. */
export const FOG_RB_CANNED_RUN: readonly Vec2[] = [
  { x: -1.2, y: 1.44 },
  { x: -0.8, y: 0.64 },
  { x: -0.4, y: 0.16 },
  { x: 0.0, y: 0.0 },
  { x: 0.4, y: 0.16 },
];

/** Same idea on least squares: three strides to the argmin floor (1.425). */
export const FOG_LS_CANNED_RUN: readonly Vec2[] = [
  { x: 0.2, y: 0.5 },
  { x: 0.55, y: 0.85 },
  { x: 0.85, y: 1.15 },
  { x: 0.95, y: 1.28 },
];

export function fogCannedRun(level: FogLevel): readonly Vec2[] {
  return level.id === "ls" ? FOG_LS_CANNED_RUN : FOG_RB_CANNED_RUN;
}

/** ?shot=fog-b mid-game pose: 3 committed steps down the banana, 7 left. */
export const FOG_RB_CURATED_MID: readonly Vec2[] = FOG_RB_CANNED_RUN.slice(0, 4);

/** Monospace-friendly loss formatting shared by panel + scorecard. */
export function fogFormatLoss(loss: number): string {
  if (loss !== 0 && Math.abs(loss) < 0.001) return loss.toExponential(2);
  if (loss >= 100) return loss.toFixed(1);
  return loss.toPrecision(3);
}
