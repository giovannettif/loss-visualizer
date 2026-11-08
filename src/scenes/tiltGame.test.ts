/**
 * Tilt game (§7) core rules — the same pure-function treatment the fog game
 * gets: physics invariants, curated runs, machine races, swarm clustering.
 */

import { describe, expect, it } from "vitest";
import {
  TILT_DT,
  TILT_LEVELS,
  TILT_ROSEN,
  TILT_VALLEY,
  SWARM_LEVEL,
  dampingRegime,
  runTiltMachines,
  simulateSwarm,
  swarmStarts,
  tiltCellKey,
  tiltCuratedInput,
  tiltCuratedRun,
  tiltFinish,
  tiltInit,
  tiltStep,
  type TiltLevel,
  type TiltRun,
} from "./tiltGame";
import { MULTI_WELL_WELLS } from "../core/functions";

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
    // Every settled ball rests within one cell-ish of SOME well floor, and
    // at least 5 of the 6 wells catch at least one ball.
    const f = SWARM_LEVEL.landscape.f;
    const occupied = new Set<string>();
    const clusterMeans = new Map<number, { n: number; sum: number }>();
    for (const path of sim.paths) {
      expect(path.length).toBeGreaterThanOrEqual(2);
      const last = path[path.length - 1];
      expect(Number.isFinite(last.x) && Number.isFinite(last.y)).toBe(true);
      if (!sim.settledCount) continue;
      let nearest = 0;
      let bd = Infinity;
      MULTI_WELL_WELLS.forEach((w, wi) => {
        const d = Math.hypot(w.x - last.x, w.y - last.y);
        if (d < bd) {
          bd = d;
          nearest = wi;
        }
      });
      occupied.add(`${nearest}`);
      const c = clusterMeans.get(nearest) ?? { n: 0, sum: 0 };
      c.n += 1;
      c.sum += f(last);
      clusterMeans.set(nearest, c);
    }
    expect(occupied.size).toBeGreaterThanOrEqual(5);
    // THE STORY: cluster outcomes are visibly unequal — the global canyon's
    // runners end ~4+ lower than the shallow basins'.
    const means = [...clusterMeans.values()].map((c) => c.sum / c.n);
    const best = Math.min(...means);
    const worst = Math.max(...means);
    expect(best).toBeLessThan(-4); // someone found the deep canyon floor
    expect(worst - best).toBeGreaterThan(2.5); // ...and the spread is legible
  });

  it("blind ensemble: the collective cell ledger is large and deterministic", () => {
    const a = simulateSwarm(SWARM_LEVEL);
    const b = simulateSwarm(SWARM_LEVEL);
    expect(a.paintedCells).toEqual(b.paintedCells); // deterministic
    // 100 walkers cross FAR more ground than any single one: the "run it
    // blind" map fills ~100× faster than the §6 single-ball game.
    expect(a.paintedCells).toBeGreaterThanOrEqual(60);
    expect(a.paintedCells).toBeGreaterThanOrEqual(a.minimaCells);
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
