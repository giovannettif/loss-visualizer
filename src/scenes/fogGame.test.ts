/**
 * §6 fog-game rules — deterministic, same discipline as the math core tests.
 *
 * Budget/reach rules, the Rosenbrock trap predicate, and the machine runs
 * the reveal scorecard reports (all finite, all inside the extent, hyper-
 * parameters verified against the real optimizers below).
 */

import { describe, it, expect } from "vitest";
import { rosenbrock, type Vec2 } from "../core/functions";
import {
  FOG_LS,
  FOG_RB,
  FOG_MACHINE_STEPS,
  FOG_RB_CANNED_RUN,
  FOG_LS_CANNED_RUN,
  FOG_RB_CURATED_MID,
  fogInit,
  fogStateFromPath,
  fogReach,
  fogClampTip,
  fogMinStep,
  fogResolveStride,
  fogSameCell,
  FOG_DRAG_SLOP_PX,
  fogCommit,
  fogCellGrid,
  fogSnapToCell,
  inRosenbrockTrap,
  runFogMachines,
} from "./fogGame";

/** Straight-line distance helper. */
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

describe("fog levels", () => {
  it("level 1 is the exact §1 least-squares landscape", () => {
    expect(FOG_LS.landscape.label).toBe("Least squares (w, b)");
  });

  it("level 2 is Rosenbrock starting on the parabola, away from (1, 1)", () => {
    expect(FOG_RB.landscape.label).toBe("Rosenbrock");
    expect(FOG_RB.start.y).toBeCloseTo(FOG_RB.start.x ** 2, 10); // on the banana
    expect(FOG_RB.start.x).toBeLessThan(0); // far half
    expect(FOG_RB.globalMin).toEqual({ x: 1, y: 1 });
  });
});

describe("fog run rules", () => {
  it("init spends nothing and stands on the start", () => {
    for (const level of [FOG_LS, FOG_RB]) {
      const st = fogInit(level);
      expect(st.used).toBe(0);
      expect(st.path).toEqual([level.start]);
      expect(st.done).toBe(false);
      expect(st.loss).toBeCloseTo(level.landscape.f(level.start), 12);
    }
  });

  it("commit spends exactly one measurement and finishes at the budget", () => {
    let st = fogInit(FOG_RB);
    const step = { x: FOG_RB.start.x + 0.3, y: FOG_RB.start.y };
    for (let i = 1; i <= FOG_RB.budget; i++) {
      st = fogCommit(FOG_RB, st, step);
      expect(st.used).toBe(i);
    }
    expect(st.done).toBe(true);
    expect(st.used).toBe(FOG_RB.budget);
  });

  it("clamps tips into the extent and onto the reach circle", () => {
    const st = fogInit(FOG_RB);
    const reach = fogReach(FOG_RB);
    // Way outside the extent AND the reach.
    const far = fogClampTip(FOG_RB, st.point, { x: 50, y: 50 });
    expect(dist(far, st.point)).toBeCloseTo(reach, 9);
    // A short step passes through untouched.
    const near = { x: st.point.x + 0.2, y: st.point.y };
    expect(fogClampTip(FOG_RB, st.point, near)).toEqual(near);
  });

  it("fogResolveStride rejects taps/jitters but commits real drags (QA SEC6-F1)", () => {
    // Rejected: a tap with NO travel at both fresh starts — both starts are
    // off-grid, so the cell snap would otherwise convert the tap into a
    // whole stride and waste a measurement.
    for (const level of [FOG_RB, FOG_LS]) {
      const st = fogInit(level);
      expect(fogResolveStride(level, st.point, { ...st.point }, 0)).toBeNull();
    }
    // Rejected: sub-slop travel at a point HALF A CELL away — the snap moves
    // the tip a full stride, but the gesture never dragged.
    const st = fogInit(FOG_RB);
    const halfCell = fogCellGrid(FOG_RB);
    const nearTip = { x: st.point.x + halfCell.cw * 0.5, y: st.point.y };
    expect(fogResolveStride(FOG_RB, st.point, nearTip, FOG_DRAG_SLOP_PX - 1)).toBeNull();
    // Rejected: full travel but the raw tip equals the start (on-ball check
    // happens BEFORE the snap).
    expect(fogResolveStride(FOG_RB, st.point, { ...st.point }, 40)).toBeNull();
    // Rejected: a raw tip just under the minimum stride even at full travel.
    const tiny = fogClampTip(FOG_RB, st.point, {
      x: st.point.x + fogMinStep(FOG_RB) * 0.5,
      y: st.point.y,
    });
    expect(fogResolveStride(FOG_RB, st.point, tiny, 40)).toBeNull();
    // Committed: a real drag to a far tip returns a snapped cell center
    // inside the reach ring. (+0.6, not +0.3: the start (−1.2, 1.44) sits in
    // a 0.571-wide cell whose centre is 0.14 away, so +0.3 snapped back into
    // the ball's OWN cell — exactly the own-cell hop QA
    // S2A-FOG-OWNCELL-SPEND forbids.)
    const far = fogClampTip(FOG_RB, st.point, { x: st.point.x + 0.6, y: st.point.y });
    const resolved = fogResolveStride(FOG_RB, st.point, { x: st.point.x + 0.6, y: st.point.y }, 40);
    expect(resolved).not.toBeNull();
    expect(dist(resolved!, far)).toBeLessThanOrEqual(fogCellGrid(FOG_RB).cw); // snapped nearby
    expect(dist(resolved!, st.point)).toBeLessThanOrEqual(fogReach(FOG_RB) + 1e-9);
    // The result is a cell center.
    const g = fogCellGrid(FOG_RB);
    expect(((resolved!.x - FOG_RB.landscape.extent.xMin) / g.cw) % 1).toBeCloseTo(0.5, 9);
  });

  it("fogResolveStride never commits a hop back into the ball's own cell (QA S2A-FOG-OWNCELL-SPEND)", () => {
    // An off-centre ball, as every reach-clamped stride leaves it.
    const from = fogClampTip(FOG_LS, fogInit(FOG_LS).point, { x: 2.5, y: 0.111 });
    expect(from.x).toBeCloseTo(1.611, 3);
    expect(from.y).toBeCloseTo(0.261, 3);
    // Own-cell drag: the snap target is the ball's own cell centre, a hop
    // longer than minStep — the bug committed it.
    const own = { x: 1.511, y: 0.126 };
    expect(fogSameCell(FOG_LS, from, fogSnapToCell(FOG_LS, own))).toBe(true);
    expect(fogResolveStride(FOG_LS, from, own, 40)).toBeNull();
    // A genuinely different cell still commits, within reach.
    const other = fogResolveStride(FOG_LS, from, { x: 2.5, y: 0.111 }, 40);
    expect(other).not.toBeNull();
    expect(fogSameCell(FOG_LS, from, other!)).toBe(false);
    expect(dist(other!, from)).toBeLessThanOrEqual(fogReach(FOG_LS) + 1e-9);
  });

  it("snaps stride tips onto fog cell centers (grid covers the extent exactly)", () => {
    for (const level of [FOG_LS, FOG_RB]) {
      const e = level.landscape.extent;
      const g = fogCellGrid(level);
      expect(g.nx).toBeGreaterThanOrEqual(1);
      expect(g.ny).toBeGreaterThanOrEqual(1);
      expect(g.cw * g.nx).toBeCloseTo(e.xMax - e.xMin, 9);
      expect(g.ch * g.ny).toBeCloseTo(e.yMax - e.yMin, 9);
      // Every snap is a center of the grid: (center − min) / cell = k + 0.5.
      for (const p of [
        { x: e.xMin + 0.13 * (e.xMax - e.xMin), y: e.yMin + 0.42 * (e.yMax - e.yMin) },
        { x: e.xMin, y: e.yMax }, // corners too
        { x: e.xMax, y: e.yMin },
        { x: (e.xMin + e.xMax) / 2, y: (e.yMin + e.yMax) / 2 },
      ]) {
        const s = fogSnapToCell(level, p);
        expect(s.x).toBeGreaterThanOrEqual(e.xMin);
        expect(s.x).toBeLessThanOrEqual(e.xMax);
        expect((s.x - e.xMin) / g.cw - 0.5).toBeCloseTo(Math.round((s.x - e.xMin) / g.cw - 0.5), 9);
        expect((s.y - e.yMin) / g.ch - 0.5).toBeCloseTo(Math.round((s.y - e.yMin) / g.ch - 0.5), 9);
        // Snap → reach-clamp keeps the tip inside the stride ring.
        const st = fogInit(level);
        const clamped = fogClampTip(level, st.point, s);
        expect(dist(clamped, st.point)).toBeLessThanOrEqual(fogReach(level) + 1e-9);
      }
    }
  });

  it("curated/canned runs respect the reach and the mid-game pose is unfinished", () => {
    for (const [level, run] of [
      [FOG_RB, FOG_RB_CANNED_RUN],
      [FOG_RB, FOG_RB_CURATED_MID],
      [FOG_LS, FOG_LS_CANNED_RUN],
    ] as const) {
      const reach = fogReach(level);
      for (let i = 1; i < run.length; i++) {
        expect(dist(run[i], run[i - 1])).toBeLessThanOrEqual(reach + 1e-9);
      }
      const st = fogStateFromPath(level, run, false);
      expect(st.used).toBe(run.length - 1);
      expect(st.done).toBe(false);
    }
    // The frozen fog-b pose sits mid-budget, still in the trap.
    const mid = fogStateFromPath(FOG_RB, FOG_RB_CURATED_MID, false);
    expect(mid.used).toBe(3);
    expect(FOG_RB.budget).toBeGreaterThan(mid.used);
    expect(inRosenbrockTrap(mid.point)).toBe(true);
  });

  it("the canonical run ends ON the trap, two strides from the true minimum", () => {
    const end = FOG_RB_CANNED_RUN[FOG_RB_CANNED_RUN.length - 1];
    expect(inRosenbrockTrap(end)).toBe(true); // the reveal beat fires the trap line
    expect(rosenbrock.f(end)).toBeLessThan(0.5); // it FEELS finished
    expect(dist(end, FOG_RB.globalMin)).toBeGreaterThan(fogReach(FOG_RB)); // out of reach
    expect(dist(end, FOG_RB.globalMin)).toBeLessThan(2 * fogReach(FOG_RB)); // ...two strides
  });
});

describe("the Rosenbrock trap", () => {
  it("catches the parabolic valley floor left of the global minimum", () => {
    expect(inRosenbrockTrap({ x: 0, y: 0 })).toBe(true);
    expect(inRosenbrockTrap({ x: -0.6, y: 0.36 })).toBe(true); // low banana
    expect(inRosenbrockTrap({ x: 0.3, y: 0.05 })).toBe(true);
  });

  it("does not catch the global minimum, the steep walls, or far points", () => {
    expect(inRosenbrockTrap({ x: 1, y: 1 })).toBe(false); // the true min
    expect(inRosenbrockTrap({ x: -1.9, y: 2.8 })).toBe(false); // high wall
    expect(inRosenbrockTrap({ x: 1.8, y: -0.8 })).toBe(false); // off-valley
  });
});

describe("the machines", () => {
  it("run their full 60 measurements, finite and inside the extent", () => {
    for (const level of [FOG_LS, FOG_RB]) {
      for (const m of runFogMachines(level)) {
        expect(m.steps).toBe(FOG_MACHINE_STEPS);
        expect(m.path.length).toBe(FOG_MACHINE_STEPS + 1);
        for (const p of m.path) {
          expect(Number.isFinite(p.x)).toBe(true);
          expect(Number.isFinite(p.y)).toBe(true);
          const e = level.landscape.extent;
          expect(p.x).toBeGreaterThanOrEqual(e.xMin * 1.05);
          expect(p.x).toBeLessThanOrEqual(e.xMax * 1.05);
          expect(p.y).toBeGreaterThanOrEqual(e.yMin * 1.05);
          expect(p.y).toBeLessThanOrEqual(e.yMax * 1.05);
        }
      }
    }
  });

  it("least squares: every machine converges to the 1.425 noise floor", () => {
    for (const m of runFogMachines(FOG_LS)) {
      expect(m.finalLoss).toBeLessThan(1.5);
      expect(m.finalLoss).toBeGreaterThan(1.42);
    }
  });

  it("Rosenbrock: all three struggle in 60 steps (the blindness is the point)", () => {
    const [gdR, momR, adamR] = runFogMachines(FOG_RB);
    expect(gdR.finalLoss).toBeGreaterThan(4); // crawls: ~4.66
    expect(momR.finalLoss).toBeGreaterThan(2); // slides: ~3.2
    expect(adamR.finalLoss).toBeGreaterThan(2); // wall plateau: ~3.9
    // ...while the careful 4-measurement walk down the banana beats them all.
    const player = rosenbrock.f(FOG_RB_CANNED_RUN[FOG_RB_CANNED_RUN.length - 1]);
    expect(player).toBeLessThan(gdR.finalLoss);
    expect(player).toBeLessThan(momR.finalLoss);
    expect(player).toBeLessThan(adamR.finalLoss);
  });
});
