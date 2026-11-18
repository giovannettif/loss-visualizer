/**
 * Tilt game (§7) core rules — the same pure-function treatment the fog game
 * gets: physics invariants, curated runs, machine races, swarm clustering.
 */

import { describe, expect, it } from "vitest";
import {
  TILT_DT,
  TILT_LEVELS,
  TILT_ARCHI,
  TILT_CANYON,
  TILT_RASTR,
  TILT_ROSEN,
  TILT_VALLEY,
  SWARM_LEVEL,
  SWARM_LEVEL_LARGE,
  SWARM_LEVEL_HIMMEL,
  SWARM_LEVEL_ARCHI,
  SWARM_MAPS,
  SWARM_COUNT,
  SWARM_CAPTURE_Q,
  SWARM_FRICTION,
  TILT_CUE_SPEED,
  TILT_CUE_AFTER_SEC,
  TILT_DEFAULT_FRICTION,
  dampingRegime,
  landscapeWells,
  swarmMapById,
  swarmPaintLedger,
  tiltFrameDropPx,
  tiltScreenToParam,
  runTiltMachines,
  simulateSwarm,
  swarmBasinOf,
  swarmStarts,
  tiltAtGoal,
  tiltBasin,
  tiltCellKey,
  tiltCuratedInput,
  tiltCuratedRun,
  tiltFinish,
  tiltInit,
  tiltPitLabel,
  tiltSamePit,
  tiltStep,
  type TiltLevel,
  type TiltRun,
} from "./tiltGame";
import {
  ARCHIPELAGO_WELLS,
  HIMMELBLAU_WELLS,
  MULTI_WELL_LARGE_WELLS,
  MULTI_WELL_WELLS,
} from "../core/functions";

/** Drives `run` with a fixed input until done or `steps` substeps. */
function drive(
  level: TiltLevel,
  run: TiltRun,
  input: { x: number; y: number },
  friction: number,
  steps: number,
): TiltRun {
  for (let i = 0; i < steps && !run.done; i++) {
    tiltStep(level, run, input, friction);
  }
  return run;
}

const TILT_REC_CHECK = 10;

describe("tilt physics", () => {
  it("is deterministic: identical inputs produce identical rides", () => {
    const a = drive(TILT_VALLEY, tiltInit(TILT_VALLEY), { x: 0.5, y: -0.5 }, 0.55, 600);
    const b = drive(TILT_VALLEY, tiltInit(TILT_VALLEY), { x: 0.5, y: -0.5 }, 0.55, 600);
    expect(a.pos).toEqual(b.pos);
    expect(a.vel).toEqual(b.vel);
    expect(a.cells).toEqual(b.cells);
  });

  it("tilt input moves the ball (visible response)", () => {
    const run = tiltInit(TILT_VALLEY);
    drive(TILT_VALLEY, run, { x: 1, y: 0 }, 0.55, 120); // 1 s of push
    const d = Math.hypot(run.pos.x - TILT_VALLEY.start.x, run.pos.y - TILT_VALLEY.start.y);
    expect(d).toBeGreaterThan(1); // moved a meaningful distance in param units
  });

  it("has inertia: the ball keeps rolling after the tilt is released", () => {
    const run = tiltInit(TILT_VALLEY);
    drive(TILT_VALLEY, run, { x: 1, y: 0 }, 0.55, 60); // half a second of push
    const mid = { ...run.pos };
    drive(TILT_VALLEY, run, { x: 0, y: 0 }, 0.55, 30); // released, quarter second
    const coasted = Math.hypot(run.pos.x - mid.x, run.pos.y - mid.y);
    expect(coasted).toBeGreaterThan(0.05); // momentum carried it on
  });

  it("higher damping bleeds speed faster (the beta analogy)", () => {
    const speeds: number[] = [];
    for (const friction of [0.1, 0.8, 2.0]) {
      const run = tiltInit(TILT_VALLEY);
      // Identical impulse, then coast: measure peak speed after release.
      drive(TILT_VALLEY, run, { x: 1, y: 0 }, 0.1, 90);
      let peak = 0;
      for (let i = 0; i < 240; i++) {
        tiltStep(TILT_VALLEY, run, { x: 0, y: 0 }, friction);
        peak = Math.max(peak, Math.hypot(run.vel.x, run.vel.y));
      }
      speeds.push(peak);
    }
    expect(speeds[0]).toBeGreaterThan(speeds[1]);
    expect(speeds[1]).toBeGreaterThan(speeds[2]);
  });

  it("never leaves the extent, even at vmax into a wall", () => {
    const run = tiltInit(TILT_VALLEY);
    drive(TILT_VALLEY, run, { x: -1, y: -1 }, 0.0, 1200);
    const e = TILT_VALLEY.landscape.extent;
    expect(run.pos.x).toBeGreaterThanOrEqual(e.xMin);
    expect(run.pos.x).toBeLessThanOrEqual(e.xMax);
    expect(run.pos.y).toBeGreaterThanOrEqual(e.yMin);
    expect(run.pos.y).toBeLessThanOrEqual(e.yMax);
    expect(Number.isFinite(run.pos.x)).toBe(true);
  });

  it("records the ghost at the promised cadence", () => {
    const run = tiltInit(TILT_VALLEY);
    drive(TILT_VALLEY, run, { x: 1, y: 0 }, 0.55, 12 * TILT_REC_CHECK);
    expect(run.rec.length).toBeGreaterThanOrEqual(TILT_REC_CHECK);
  });
});

describe("measurement cells", () => {
  it("counts the starting cell exactly once", () => {
    const run = tiltInit(TILT_VALLEY);
    expect(run.cells).toEqual([tiltCellKey(TILT_VALLEY, TILT_VALLEY.start)]);
  });

  it("grows only on NEW cells", () => {
    const run = tiltInit(TILT_VALLEY);
    drive(TILT_VALLEY, run, { x: 1, y: 1 }, 0.55, 900);
    expect(run.cells.length).toBeGreaterThan(3);
    expect(new Set(run.cells).size).toBe(run.cells.length);
  });
});

describe("curated runs (frozen shots)", () => {
  it("level 1 valley: the guided ride settles in the minimum", () => {
    const run = tiltCuratedRun(TILT_VALLEY, 0.55);
    expect(run.done).toBe(true);
    expect(run.settled).toBe(true);
    expect(run.steps).toBeLessThan(40 / TILT_DT);
    const g = TILT_VALLEY.landscape.grad(run.pos);
    expect(Math.hypot(g.x, g.y)).toBeLessThan(TILT_VALLEY.settleGrad * 2);
  });

  it("a valley D-tap rest is quiet ground, NOT the minimum (QA S7-VALLEY-FALSE-MIN)", () => {
    // The reported run B: steered once, released, settled at (−1.55, 2.68) —
    // 3.10 units from (0,0), well outside the 2.12 goal radius the machines
    // are graded against.
    const run = tiltInit(TILT_VALLEY, { start: { x: -1.55, y: 2.68 } });
    run.steered = true;
    drive(TILT_VALLEY, run, { x: 0, y: 0 }, 0.55, 60 / TILT_DT);
    expect(run.done).toBe(true);
    expect(run.settled).toBe(true);
    expect(tiltAtGoal(TILT_VALLEY, run.pos)).toBe(false);
    // The curated ride, by contrast, lands INSIDE the goal radius — the
    // verdict's "settled into the minimum" branch stays reachable.
    const guided = tiltCuratedRun(TILT_VALLEY, 0.55);
    expect(tiltAtGoal(TILT_VALLEY, guided.pos)).toBe(true);
  });

  it("level 1 mid-run pose: moves but is NOT finished (the tilt-a shot)", () => {
    const full = tiltCuratedRun(TILT_VALLEY, 0.55);
    const mid = tiltCuratedRun(TILT_VALLEY, 0.55, { frac: 0.45 });
    expect(mid.done).toBe(false);
    expect(mid.rec.length).toBeGreaterThan(4);
    expect(mid.pos).not.toEqual(full.pos);
  });

  it("level 2 Rosenbrock: the guided ride reaches the (1,1) floor", () => {
    const run = tiltCuratedRun(TILT_ROSEN, 0.55);
    expect(run.done).toBe(true);
    const d = Math.hypot(run.pos.x - 1, run.pos.y - 1);
    const goalR = TILT_ROSEN.goalFrac * Math.hypot(4, 4);
    expect(d).toBeLessThan(goalR);
  });
});

describe("machine races", () => {
  it("every machine makes progress from the player's start, on every level", () => {
    for (const level of TILT_LEVELS) {
      const startLoss = level.landscape.f(level.start);
      for (const m of runTiltMachines(level, level.start)) {
        expect(m.finalLoss, `${level.id}/${m.label}`).toBeLessThan(startLoss);
        expect(Number.isFinite(m.finalLoss)).toBe(true);
      }
    }
  });

  it("on the valley all three machines reach the minimum", () => {
    for (const m of runTiltMachines(TILT_VALLEY, TILT_VALLEY.start)) {
      expect(m.reached, m.label).toBe(true);
    }
  });

  it("on Rosenbrock momentum reaches the floor while GD crawls", () => {
    const runs = runTiltMachines(TILT_ROSEN, TILT_ROSEN.start);
    const mom = runs.find((m) => m.key === "mom")!;
    const gdR = runs.find((m) => m.key === "gd")!;
    expect(mom.reached).toBe(true);
    expect(gdR.reached).toBe(false);
    expect(mom.finalLoss).toBeLessThan(0.5);
  });

  it("on Rastrigin every machine SETTLES in the start pit — and that counts as a minimum", () => {
    // QA S7-RASTR-VERDICT: the verdict grades machines by the same settle
    // rule as the player and names the pit — the egg crate traps all three
    // blind steppers in the local minimum just inside (−1, 2).
    // QA copy-tilt-which-minimum: on Rastrigin ANY minimum counts, so a pit
    // settle is "reached", and the basin names WHICH one (local, not global).
    for (const m of runTiltMachines(TILT_RASTR, TILT_RASTR.start)) {
      expect(m.settled, m.label).toBe(true);
      expect(m.reached, m.label).toBe(true);
      expect(m.basin, m.label).toEqual({ label: "(\u22121, 2)", global: false, atMin: true });
      expect(tiltPitLabel(TILT_RASTR, m.end), m.label).toBe("a local minimum near (\u22121, 2)");
      const g = TILT_RASTR.landscape.grad(m.end);
      expect(Math.hypot(g.x, g.y)).toBeLessThan(TILT_RASTR.settleGrad);
    }
  });

  it("tiltBasin names the pit on Rastrigin and the goal elsewhere", () => {
    // Rastrigin's walls are steep (20π·sin terms): even 0.001 off the lattice
    // the gradient is ~0.9 > settleGrad 0.8, so test points ON the floor.
    expect(tiltBasin(TILT_RASTR, { x: 0.0002, y: -0.0003 })).toEqual({ label: "(0, 0)", global: true, atMin: true });
    expect(tiltBasin(TILT_RASTR, { x: -0.995, y: 1.99 })).toEqual({ label: "(\u22121, 2)", global: false, atMin: true });
    // Up a pit wall (same lattice label, but not resting at a minimum).
    expect(tiltBasin(TILT_RASTR, { x: 0.001, y: -0.002 }).atMin).toBe(false);
    // Mid-wall between pits: not at a minimum.
    expect(tiltBasin(TILT_RASTR, { x: -0.5, y: 1.5 }).atMin).toBe(false);
    // Single-minimum levels: "goal" inside the goal radius, "—" outside.
    expect(tiltBasin(TILT_VALLEY, { x: 0.1, y: 0.1 }).label).toBe("goal");
    expect(tiltBasin(TILT_VALLEY, { x: -5, y: 8.66 }).label).toBe("\u2014");
    // Valley + Rosenbrock grading is unchanged: no anyMinimum flag.
    expect(TILT_VALLEY.anyMinimum).toBeUndefined();
    expect(TILT_ROSEN.anyMinimum).toBeUndefined();
  });

  it("names Rastrigin pits by the nearest lattice point", () => {
    expect(tiltPitLabel(TILT_RASTR, { x: 0.001, y: -0.002 })).toBe("the global minimum (0, 0)");
    expect(tiltPitLabel(TILT_RASTR, { x: -0.995, y: 1.99 })).toBe("a local minimum near (\u22121, 2)");
    expect(tiltSamePit({ x: -0.995, y: 1.99 }, { x: -1.02, y: 2.03 })).toBe(true);
    expect(tiltSamePit({ x: -0.995, y: 1.99 }, { x: 0.01, y: 0.02 })).toBe(false);
    // Single-minimum levels just say "the minimum".
    expect(tiltPitLabel(TILT_VALLEY, { x: 3, y: 1 })).toBe("the minimum");
  });
});

describe("swarm finale", () => {
  it("scatters 100 deterministic starts inside the extent", () => {
    const a = swarmStarts(TILT_VALLEY);
    const b = swarmStarts(TILT_VALLEY);
    expect(a).toEqual(b);
    expect(a).toHaveLength(100);
    const e = TILT_VALLEY.landscape.extent;
    for (const p of a) {
      expect(p.x).toBeGreaterThan(e.xMin);
      expect(p.x).toBeLessThan(e.xMax);
      expect(p.y).toBeGreaterThan(e.yMin);
      expect(p.y).toBeLessThan(e.yMax);
    }
  });

  it("multi-well swarm: clusters fill DIFFERENT basins with unequal losses", () => {
    const sim = simulateSwarm(SWARM_LEVEL);
    expect(sim.settledCount).toBeGreaterThan(90); // essentially all settle
    // Bucket by the well's own capture ellipse (swarmBasinOf), never by
    // nearest center — a rest on open ground is not a basin (QA S7-SWARM-2).
    const f = SWARM_LEVEL.landscape.f;
    const occupied = new Set<number>();
    const clusterMeans = new Map<number, { n: number; sum: number }>();
    let open = 0;
    sim.paths.forEach((path, i) => {
      expect(path.length).toBeGreaterThanOrEqual(2);
      const last = path[path.length - 1];
      expect(Number.isFinite(last.x) && Number.isFinite(last.y)).toBe(true);
      // QA S7-SWARM-1: no ball is born frozen — a 2-point path must still
      // have moved (distinct endpoints).
      const first = path[0];
      expect(Math.hypot(last.x - first.x, last.y - first.y)).toBeGreaterThan(1e-6);
      const b = swarmBasinOf(last);
      expect(sim.basinOf[i]).toBe(b);
      if (b < 0) {
        open += 1;
        return;
      }
      occupied.add(b);
      const c = clusterMeans.get(b) ?? { n: 0, sum: 0 };
      c.n += 1;
      c.sum += f(last);
      clusterMeans.set(b, c);
    });
    // Rows sum to the swarm: basin rows + the open-ground row.
    const inBasins = [...clusterMeans.values()].reduce((s, c) => s + c.n, 0);
    expect(inBasins + open).toBe(SWARM_COUNT);
    expect(sim.capturedCount).toBeLessThanOrEqual(inBasins);
    expect(occupied.size).toBeGreaterThanOrEqual(5);
    // THE STORY: cluster outcomes are visibly unequal — the global canyon's
    // runners end ~4+ lower than the shallow basins'.
    const means = [...clusterMeans.values()].map((c) => c.sum / c.n);
    const best = Math.min(...means);
    const worst = Math.max(...means);
    expect(best).toBeLessThan(-4); // someone found the deep canyon floor
    expect(worst - best).toBeGreaterThan(2.5); // ...and the spread is legible
  });

  it("every settled swarm ball rests on a TRUE well floor (QA S7-SWARM-1)", () => {
    // The six local minima: descend the gradient from each well center.
    const L = SWARM_LEVEL.landscape;
    const floors = MULTI_WELL_WELLS.map((w) => {
      let p = { x: w.x, y: w.y };
      for (let i = 0; i < 20000; i++) {
        const g = L.grad(p);
        p = { x: p.x - 0.01 * g.x, y: p.y - 0.01 * g.y };
      }
      return p;
    });
    const sim = simulateSwarm(SWARM_LEVEL);
    expect(sim.settledCount).toBe(SWARM_COUNT);
    for (const path of sim.paths) {
      const last = path[path.length - 1];
      const d = Math.min(...floors.map((m) => Math.hypot(m.x - last.x, m.y - last.y)));
      expect(d).toBeLessThan(0.35);
    }
  });

  it("swarmBasinOf: well floors classify, open ground does not (QA S7-SWARM-2)", () => {
    MULTI_WELL_WELLS.forEach((w, i) => {
      expect(swarmBasinOf({ x: w.x, y: w.y })).toBe(i);
    });
    // The old open-plain rest of ball 0 (q ≈ 2 from the dimple): no basin.
    expect(swarmBasinOf({ x: 0, y: -1.086 })).toBe(-1);
    // A capture ellipse is elliptical: just inside q = SWARM_CAPTURE_Q along
    // the canyon's long axis classifies; the same offset on the short axis
    // (b < a) does not.
    const w = MULTI_WELL_WELLS[0];
    const c = Math.cos((w.thetaDeg * Math.PI) / 180);
    const s = Math.sin((w.thetaDeg * Math.PI) / 180);
    const along = 0.95 * SWARM_CAPTURE_Q * w.a;
    expect(swarmBasinOf({ x: w.x + along * c, y: w.y + along * s })).toBe(0);
    expect(swarmBasinOf({ x: w.x - along * s, y: w.y + along * c })).toBe(-1);
  });

  it("blind ensemble: the collective cell ledger is large and deterministic", () => {
    const a = simulateSwarm(SWARM_LEVEL);
    const b = simulateSwarm(SWARM_LEVEL);
    expect(a.paintedCells).toEqual(b.paintedCells); // deterministic
    // The ensemble's union is ~20× the mean per-ball footprint (QA
    // COPY2-SWARM-100X-OVERCLAIM: the old '100×' comment and caption were
    // never measured — the simulation gives ≈21.8 at settle).
    expect(a.paintedCells).toBeGreaterThanOrEqual(60);
    expect(a.paintedCells).toBeGreaterThanOrEqual(a.minimaCells);
    let sum = 0;
    for (const start of swarmStarts(SWARM_LEVEL)) {
      const r = tiltInit(SWARM_LEVEL, { start, requireLaunch: true });
      let n = 0;
      while (!r.done && n < 3600) {
        tiltStep(SWARM_LEVEL, r, { x: 0, y: 0 }, SWARM_FRICTION);
        n += 1;
      }
      sum += r.cells.length;
    }
    const mean = sum / SWARM_COUNT;
    expect(a.paintedCells / mean).toBeGreaterThanOrEqual(15);
  });

  it("mid-flight pose (the swarm shot): balls are strung along descent paths", () => {
    const sim = simulateSwarm(SWARM_LEVEL);
    // A mid-flight sampler at 55% must land strictly between each path's ends
    // for at least some balls (i.e. the shot shows motion, not the finish).
    let inFlight = 0;
    for (const path of sim.paths) {
      const i = Math.min(path.length - 1, Math.floor(path.length * 0.55));
      const p = path[i];
      const first = path[0];
      const last = path[path.length - 1];
      if (
        Math.hypot(p.x - first.x, p.y - first.y) > 1e-6 &&
        Math.hypot(p.x - last.x, p.y - last.y) > 1e-6
      ) {
        inFlight += 1;
      }
    }
    expect(inFlight).toBeGreaterThan(10);
  });
});

describe("swarm maps (the §7 picker's countries)", () => {
  it("registers four maps; every landscape carries its own wells list", () => {
    expect(SWARM_MAPS.map((m) => m.id)).toEqual([
      "multi-well",
      "multi-well-large",
      "himmelblau",
      "archipelago",
    ]);
    expect(landscapeWells(SWARM_LEVEL.landscape)).toBe(MULTI_WELL_WELLS);
    expect(landscapeWells(SWARM_LEVEL_LARGE.landscape)).toBe(MULTI_WELL_LARGE_WELLS);
    expect(landscapeWells(SWARM_LEVEL_HIMMEL.landscape)).toBe(HIMMELBLAU_WELLS);
    expect(landscapeWells(SWARM_LEVEL_ARCHI.landscape)).toBe(ARCHIPELAGO_WELLS);
    expect(swarmMapById("himmelblau").level).toBe(SWARM_LEVEL_HIMMEL);
    expect(swarmMapById("archipelago").level).toBe(SWARM_LEVEL_ARCHI);
  });

  it("multi-well LARGE: 100 balls settle and occupy ≥7 of the 9 basins", () => {
    const sim = simulateSwarm(SWARM_LEVEL_LARGE);
    expect(sim.settledCount).toBe(SWARM_COUNT);
    const f = SWARM_LEVEL_LARGE.landscape.f;
    const means = new Map<number, { n: number; sum: number }>();
    sim.paths.forEach((path, i) => {
      const last = path[path.length - 1];
      expect(Number.isFinite(last.x) && Number.isFinite(last.y)).toBe(true);
      const b = sim.basinOf[i];
      expect(b).toBe(swarmBasinOf(last, MULTI_WELL_LARGE_WELLS));
      if (b < 0) return;
      const c = means.get(b) ?? { n: 0, sum: 0 };
      c.n += 1;
      c.sum += f(last);
      means.set(b, c);
    });
    expect(means.size).toBeGreaterThanOrEqual(7);
    // Unequal outcomes survive the scale-up: the rift's crowd ends far lower.
    const ms = [...means.values()].map((c) => c.sum / c.n);
    expect(Math.min(...ms)).toBeLessThan(-5);
    expect(Math.max(...ms) - Math.min(...ms)).toBeGreaterThan(2.5);
  });

  it("himmelblau: 100 balls settle into all FOUR pits — all floors global", () => {
    const sim = simulateSwarm(SWARM_LEVEL_HIMMEL);
    expect(sim.settledCount).toBe(SWARM_COUNT);
    const f = SWARM_LEVEL_HIMMEL.landscape.f;
    const occupied = new Set<number>();
    sim.paths.forEach((path, i) => {
      const last = path[path.length - 1];
      expect(Number.isFinite(last.x) && Number.isFinite(last.y)).toBe(true);
      occupied.add(sim.basinOf[i]);
    });
    // The counter-story: every basin is occupied, and every outcome EQUAL.
    expect(occupied.size).toBe(HIMMELBLAU_WELLS.length);
    for (const path of sim.paths) {
      expect(f(path[path.length - 1])).toBeLessThan(0.05);
    }
  });

  it("swarmBasinOf classifies against any well list it is given", () => {
    HIMMELBLAU_WELLS.forEach((w, i) => {
      expect(swarmBasinOf({ x: w.x, y: w.y }, HIMMELBLAU_WELLS)).toBe(i);
    });
    // Halfway between the (3, 2) and (3.6, −1.8) pits: open saddle ground.
    expect(swarmBasinOf({ x: 3.3, y: 0.1 }, HIMMELBLAU_WELLS)).toBe(-1);
    // A capture ellipse is elliptical: just inside q = SWARM_CAPTURE_Q along
    // the great rift's long axis classifies; the same offset on the short
    // axis does not.
    const w = MULTI_WELL_LARGE_WELLS[0];
    const c = Math.cos((w.thetaDeg * Math.PI) / 180);
    const s = Math.sin((w.thetaDeg * Math.PI) / 180);
    const along = 0.95 * SWARM_CAPTURE_Q * w.a;
    expect(swarmBasinOf({ x: w.x + along * c, y: w.y + along * s }, MULTI_WELL_LARGE_WELLS)).toBe(0);
    expect(swarmBasinOf({ x: w.x - along * s, y: w.y + along * c }, MULTI_WELL_LARGE_WELLS)).toBe(-1);
  });

  it("archipelago: 100 balls all settle into ALL EIGHT basins, wildly unequal", () => {
    const sim = simulateSwarm(SWARM_LEVEL_ARCHI);
    expect(sim.settledCount).toBe(SWARM_COUNT);
    const f = SWARM_LEVEL_ARCHI.landscape.f;
    const means = new Map<number, { n: number; sum: number }>();
    let open = 0;
    sim.paths.forEach((path, i) => {
      const last = path[path.length - 1];
      expect(Number.isFinite(last.x) && Number.isFinite(last.y)).toBe(true);
      const b = sim.basinOf[i];
      expect(b).toBe(swarmBasinOf(last, ARCHIPELAGO_WELLS));
      if (b < 0) {
        open += 1;
        return;
      }
      const c = means.get(b) ?? { n: 0, sum: 0 };
      c.n += 1;
      c.sum += f(last);
      means.set(b, c);
    });
    // Every basin catches its crowd; no ball ends on open ground (the
    // gentle interior bowl keeps the plain creeping into the skerry).
    expect(means.size).toBe(ARCHIPELAGO_WELLS.length);
    expect(open).toBe(0);
    // THE RIDGE STORY: outcomes spread across ~7.5 units of loss — the deep
    // atoll's crowd vs the skerry's beachcombers.
    const ms = [...means.values()].map((c) => c.sum / c.n);
    expect(Math.min(...ms)).toBeLessThan(-7);
    expect(Math.max(...ms) - Math.min(...ms)).toBeGreaterThan(6);
  });
});

describe("the two wilder tilt maps (user feedback 2026-11-17)", () => {
  it("level 4 archipelago: the guided ride reaches the deep atoll across the ridges", () => {
    const run = tiltCuratedRun(TILT_ARCHI, TILT_DEFAULT_FRICTION);
    expect(run.done).toBe(true);
    const d = Math.hypot(run.pos.x - TILT_ARCHI.goal.x, run.pos.y - TILT_ARCHI.goal.y);
    expect(d).toBeLessThan(tiltDiagOf(TILT_ARCHI) * TILT_ARCHI.goalFrac);
    expect(run.steps).toBeLessThan(40 / TILT_DT);
  });

  it("level 4 archipelago: the blind machines all settle SHORT of the atoll", () => {
    const runs = runTiltMachines(TILT_ARCHI, TILT_ARCHI.start);
    const startLoss = TILT_ARCHI.landscape.f(TILT_ARCHI.start);
    for (const m of runs) {
      // Everyone makes real progress downhill from the rim…
      expect(m.finalLoss, m.label).toBeLessThan(startLoss);
      expect(Number.isFinite(m.finalLoss)).toBe(true);
      expect(m.settled, m.label).toBe(true);
      // …but the ridges keep every one of them out of the deep atoll —
      // the steered drive is the only way across (the level's lesson).
      expect(m.reached, `${m.label} reached the atoll`).toBe(false);
    }
    // GD and Adam dive into the nearest ring island (the lagoon, well 2);
    // momentum's damping carries it over the rim onto the interior skerry
    // (well 7) instead.
    const byKey = new Map(runs.map((m) => [m.key, m]));
    expect(swarmBasinOf(byKey.get("gd")!.end, ARCHIPELAGO_WELLS)).toBe(2);
    expect(swarmBasinOf(byKey.get("adam")!.end, ARCHIPELAGO_WELLS)).toBe(2);
    expect(swarmBasinOf(byKey.get("mom")!.end, ARCHIPELAGO_WELLS)).toBe(7);
  });

  it("level 5 canyon peaks: the guided ride runs the canyon to the sea gate", () => {
    const run = tiltCuratedRun(TILT_CANYON, TILT_DEFAULT_FRICTION);
    expect(run.done).toBe(true);
    const d = Math.hypot(run.pos.x - TILT_CANYON.goal.x, run.pos.y - TILT_CANYON.goal.y);
    expect(d).toBeLessThan(tiltDiagOf(TILT_CANYON) * TILT_CANYON.goalFrac);
    expect(run.steps).toBeLessThan(40 / TILT_DT);
  });

  it("level 5 canyon peaks: momentum and Adam run the whole canyon; GD crawls", () => {
    const runs = runTiltMachines(TILT_CANYON, TILT_CANYON.start);
    const startLoss = TILT_CANYON.landscape.f(TILT_CANYON.start);
    const byKey = new Map(runs.map((m) => [m.key, m]));
    // The gentle winding floor guides momentum and Adam all the way to the
    // sea gate…
    for (const key of ["mom", "adam"] as const) {
      expect(byKey.get(key)!.reached, `${key} reached the gate`).toBe(true);
      expect(byKey.get(key)!.finalLoss).toBeLessThan(1);
    }
    // …while GD's small steps barely round the west mouth.
    expect(byKey.get("gd")!.reached).toBe(false);
    expect(byKey.get("gd")!.finalLoss).toBeGreaterThan(20);
    expect(byKey.get("gd")!.finalLoss).toBeLessThan(startLoss);
  });
});

/** Extent diagonal for the new levels (tiltDiag is module-private there —
 *  the same hypot the level's fractions live in). */
function tiltDiagOf(level: TiltLevel): number {
  const e = level.landscape.extent;
  return Math.hypot(e.xMax - e.xMin, e.yMax - e.yMin);
}

describe("damping slider", () => {
  it("maps friction to the promised regimes", () => {
    expect(dampingRegime(0.05)).toBe("long memory");
    expect(dampingRegime(0.55)).toBe("damped");
    expect(dampingRegime(2.0)).toBe("over-damped");
  });
});

describe("finish rule", () => {
  it("Finish ends the run where it stands", () => {
    const run = tiltInit(TILT_VALLEY);
    drive(TILT_VALLEY, run, { x: 1, y: 0 }, 0.55, 60);
    tiltFinish(run);
    expect(run.done).toBe(true);
    expect(run.settled).toBe(false);
  });

  it("curated input honors the parameter space (unit-bounded)", () => {
    const t = tiltCuratedInput(TILT_VALLEY, TILT_VALLEY.start, 0.3);
    expect(Math.abs(t.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(t.y)).toBeLessThanOrEqual(1);
  });
});

describe("sweep-2 tilt/swarm fixes", () => {
  it("cellAt records the first-visit point of every cell (QA S7-SW2-RASTR-STAMPS-SHARDS)", () => {
    const run = tiltInit(TILT_RASTR);
    for (let i = 0; i < 400; i++) {
      tiltStep(TILT_RASTR, run, i < 120 ? { x: 1, y: 0.4 } : { x: 0, y: 0 }, TILT_DEFAULT_FRICTION);
    }
    expect(run.cells.length).toBeGreaterThan(1);
    expect(run.cellAt.length).toBe(run.cells.length);
    run.cellAt.forEach((p, i) => expect(tiltCellKey(TILT_RASTR, p)).toBe(run.cells[i]));
  });

  it("a slow ball ringing in a Rastrigin pit rests there; machine grading unchanged (QA S7-RASTR-FINISH-SLOPE)", () => {
    const p = { x: -0.9948, y: 1.994 };
    expect(tiltBasin(TILT_RASTR, p, { x: 0.007, y: 0 }).atMin).toBe(true);
    expect(tiltBasin(TILT_RASTR, p).atMin).toBe(false); // no vel: as before
    expect(tiltBasin(TILT_RASTR, { x: -0.5, y: 1.5 }, { x: 0.01, y: 0 }).atMin).toBe(false);
    expect(tiltBasin(TILT_RASTR, p, { x: 0.5, y: 0 }).atMin).toBe(false);
    // Simulated: tap W for 80 ms, wait for the Finish cue, then Finish.
    const run = tiltInit(TILT_RASTR, { requireInput: true });
    let t = 0;
    let cueT = 0;
    while (t < 20 && !run.done) {
      tiltStep(TILT_RASTR, run, t < 0.08 ? { x: 0, y: 1 } : { x: 0, y: 0 }, TILT_DEFAULT_FRICTION);
      t += TILT_DT;
      const v = Math.hypot(run.vel.x, run.vel.y);
      cueT = v < TILT_CUE_SPEED ? cueT + TILT_DT : 0;
      if (cueT >= TILT_CUE_AFTER_SEC) break;
    }
    tiltFinish(run);
    const b = tiltBasin(TILT_RASTR, run.pos, run.vel);
    expect(b.label).toBe("(\u22121, 2)");
    expect(b.atMin).toBe(true);
  });

  it("screen keys always give the dominant axis the full tilt (QA S7-RASTR-DEAD-KEY-DIAGONAL)", () => {
    const combos = [
      { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
      { x: 1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: 1 }, { x: -1, y: -1 },
    ];
    let dead = 0;
    for (let az = -180; az < 180; az++) {
      for (const k of combos) {
        const inp = tiltScreenToParam(k, az);
        expect(Math.max(Math.abs(inp.x), Math.abs(inp.y))).toBeCloseTo(1, 12);
        for (const c of [0, TILT_DEFAULT_FRICTION, 2.2]) {
          const run = tiltInit(TILT_RASTR);
          const start = { ...run.pos };
          for (let i = 0; i < 5 / TILT_DT; i++) tiltStep(TILT_RASTR, run, inp, c);
          if (tiltSamePit(start, run.pos)) dead += 1;
        }
      }
    }
    expect(dead).toBe(0);
    expect(tiltScreenToParam({ x: 0, y: 0 }, 37)).toEqual({ x: 0, y: 0 });
  }, 30000);

  it("machines report cells on the player's grid (QA COPY2-TILT-STEPS-CELLS-NOT-SAME-PAIR)", () => {
    for (const level of TILT_LEVELS) {
      for (const m of runTiltMachines(level, level.start)) {
        expect(m.cells).toBe(new Set(m.path.map((p) => tiltCellKey(level, p))).size);
        expect(m.cells).toBeGreaterThanOrEqual(1);
      }
    }
    // Blind steppers never leave a Rastrigin pit.
    for (const m of runTiltMachines(TILT_RASTR, TILT_RASTR.start)) expect(m.cells).toBe(1);
  });

  it("minima found counts wells, not cells (QA S2-SWARM-SEVEN-MINIMA)", () => {
    const sim = simulateSwarm(SWARM_LEVEL);
    expect(sim.minimaFound).toBe(new Set(sim.basinOf.filter((b) => b >= 0)).size);
    expect(sim.minimaFound).toBe(6);
    expect(sim.minimaFound).toBeLessThanOrEqual(MULTI_WELL_WELLS.length);
    expect(sim.minimaCells).toBeGreaterThanOrEqual(sim.minimaFound);
  });

  it("the blind paint ledger covers every cell the drawn trails cross (QA S2-SWARM-PAINT-MISSES-CROSSED-CELLS)", () => {
    const sim = simulateSwarm(SWARM_LEVEL);
    const union = new Set<string>();
    const dense = new Set<string>();
    const missed: string[] = [];
    for (const path of sim.paths) {
      const ledger = swarmPaintLedger(SWARM_LEVEL, path);
      expect(ledger[0].key).toBe(tiltCellKey(SWARM_LEVEL, path[0]));
      expect(ledger[0].arcFrac).toBe(0);
      for (let i = 1; i < ledger.length; i++) {
        expect(ledger[i].arcFrac).toBeGreaterThanOrEqual(ledger[i - 1].arcFrac);
      }
      const keys = new Set(ledger.map((c) => c.key));
      dense.add(tiltCellKey(SWARM_LEVEL, path[0]));
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1];
        const b = path[i];
        for (let k = 0; k <= 1000; k++) {
          const u = k / 1000;
          const key = tiltCellKey(SWARM_LEVEL, { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
          if (!keys.has(key)) missed.push(key);
          dense.add(key);
        }
      }
      for (const k of keys) union.add(k);
    }
    expect(missed).toEqual([]);
    expect(union.size).toBe(dense.size);
    expect(union.size).toBeGreaterThanOrEqual(120);
  }, 30000);

  it("tilt framing drop is 0 at canonical heights (QA SW2-LW24-TILTA-BALL-UNDER-TILTPANEL-1280)", () => {
    expect(tiltFrameDropPx(900)).toBe(0);
    expect(tiltFrameDropPx(1080)).toBe(0);
    expect(tiltFrameDropPx(800)).toBe(55);
    expect(tiltFrameDropPx(768)).toBe(73);
    expect(tiltFrameDropPx(400)).toBe(120);
  });
});
