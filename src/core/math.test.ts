/**
 * Math core tests — fully deterministic (no Math.random, no Date anywhere).
 *
 * 1. Central-difference finite-difference gradient checks for EVERY landscape,
 *    at several deterministic points. Relative error < 1e-5, where the
 *    relative error of components a (checked) vs b (analytic) is
 *    |a − b| / max(1, |b|): true relative error when |b| ≥ 1, floored to an
 *    absolute criterion near zero so stationary points can't divide by 0.
 * 2. Optimizer invariants: GD step = −lr·∇f exactly; Adam's first step moves
 *    ~lr per coordinate regardless of gradient scale; momentum velocity
 *    accumulates (and β = 0 reduces to GD).
 */

import { describe, it, expect } from "vitest";
import {
  type Vec2,
  type Landscape,
  makeBowl,
  parabola,
  rosenbrock,
  rastrigin,
  leastSquares,
  defaultBowl,
  multiWell,
  multiWellLarge,
  himmelblau,
  archipelago,
  canyonPeaks,
  ARCHIPELAGO_WELLS,
  ARCHIPELAGO_RIDGES,
  MULTI_WELL_WELLS,
  MULTI_WELL_LARGE_WELLS,
  HIMMELBLAU_WELLS,
  LEAST_SQUARES_POINTS,
} from "./functions";
import { gd, momentum, adam, type OptimizerState } from "./optimizers";

/* ------------------------------------------------------------------ */
/* Finite-difference helpers                                          */
/* ------------------------------------------------------------------ */

const H = 1e-6;

/** Central difference: (f(p+h) − f(p−h)) / 2h per coordinate. */
function fdGrad(f: (p: Vec2) => number, p: Vec2): Vec2 {
  return {
    x: (f({ x: p.x + H, y: p.y }) - f({ x: p.x - H, y: p.y })) / (2 * H),
    y: (f({ x: p.x, y: p.y + H }) - f({ x: p.x, y: p.y - H })) / (2 * H),
  };
}

function relErr(checked: number, analytic: number): number {
  return Math.abs(checked - analytic) / Math.max(1, Math.abs(analytic));
}

function checkGradient(landscape: Landscape, points: ReadonlyArray<Vec2>): void {
  for (const p of points) {
    const fd = fdGrad(landscape.f, p);
    const an = landscape.grad(p);
    expect(relErr(fd.x, an.x)).toBeLessThan(1e-5);
    expect(relErr(fd.y, an.y)).toBeLessThan(1e-5);
  }
}

/* ------------------------------------------------------------------ */
/* Gradient checks — one describe per landscape                       */
/* ------------------------------------------------------------------ */

describe("gradient checks: rotated bowls (analytic vs finite difference)", () => {
  it("default bowl (λ1=1, λ2=0.02, θ=30°) matches FD at 4 points", () => {
    checkGradient(defaultBowl, [
      { x: 1.2, y: -0.8 },
      { x: -2.1, y: 1.4 },
      { x: 0.4, y: 2.2 },
      { x: -0.9, y: -1.7 },
    ]);
  });

  it("a second bowl parameterization matches FD at 4 points", () => {
    const bowl = makeBowl(2, 0.5, -0.7);
    checkGradient(bowl, [
      { x: 1.5, y: 0.5 },
      { x: -1.0, y: 2.0 },
      { x: 0.2, y: -1.8 },
      { x: 2.5, y: -2.5 },
    ]);
  });

  it("θ=90° bowl reduces to swapped diagonal curvatures", () => {
    const bowl = makeBowl(1, 3, Math.PI / 2);
    checkGradient(bowl, [
      { x: 0.8, y: 1.1 },
      { x: -1.5, y: -0.6 },
    ]);
  });

  it("A = R·diag(λ1,λ2)·Rᵀ construction: f along principal axes = λ1, λ2", () => {
    const lambda1 = 1;
    const lambda2 = 0.02;
    const theta = Math.PI / 6;
    const bowl = makeBowl(lambda1, lambda2, theta);
    const c = Math.cos(theta);
    const s = Math.sin(theta);

    // R(1,0) = (c, s) is the first principal axis: curvature there is λ1.
    expect(bowl.f({ x: c, y: s })).toBeCloseTo(lambda1, 12);
    // R(0,1) = (−s, c) is the second: curvature λ2.
    expect(bowl.f({ x: -s, y: c })).toBeCloseTo(lambda2, 12);

    // ∇f on-axis is parallel to that axis: 2λ·(axis).
    const g1 = bowl.grad({ x: c, y: s });
    expect(g1.x).toBeCloseTo(2 * lambda1 * c, 12);
    expect(g1.y).toBeCloseTo(2 * lambda1 * s, 12);
    const g2 = bowl.grad({ x: -s, y: c });
    expect(g2.x).toBeCloseTo(2 * lambda2 * -s, 12);
    expect(g2.y).toBeCloseTo(2 * lambda2 * c, 12);
  });

  it("bowl minimum is at the origin", () => {
    expect(defaultBowl.f({ x: 0, y: 0 })).toBe(0);
    expect(defaultBowl.grad({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });
});

describe("gradient checks: parabola", () => {
  it("matches FD at 3 points", () => {
    checkGradient(parabola, [
      { x: 1.5, y: -2.0 },
      { x: -3.0, y: 1.2 },
      { x: 0.7, y: 0.3 },
    ]);
  });
});

describe("gradient checks: rosenbrock", () => {
  it("matches FD at 4 points (a=1, b=100)", () => {
    checkGradient(rosenbrock, [
      { x: -1.2, y: 1.0 },
      { x: 0.5, y: -0.4 },
      { x: 1.7, y: 2.2 },
      { x: -0.3, y: 1.8 },
    ]);
  });

  it("global minimum (1,1) has zero gradient and value 0", () => {
    expect(rosenbrock.f({ x: 1, y: 1 })).toBe(0);
    // Numeric comparison: grad computes -2*(1-1) which is the value -0 —
    // numerically zero, but Object.is-style matchers (toBe/toEqual)
    // distinguish its sign bit, so assert closeness instead.
    expect(rosenbrock.grad({ x: 1, y: 1 }).x).toBeCloseTo(0, 12);
    expect(rosenbrock.grad({ x: 1, y: 1 }).y).toBeCloseTo(0, 12);
  });
});

describe("gradient checks: rastrigin", () => {
  it("matches FD at 4 points", () => {
    checkGradient(rastrigin, [
      { x: 0.3, y: -0.4 },
      { x: -1.1, y: 2.2 },
      { x: 2.7, y: 1.3 },
      { x: -3.4, y: -2.6 },
    ]);
  });

  it("global minimum (0,0) has zero gradient and value 0", () => {
    expect(rastrigin.f({ x: 0, y: 0 })).toBeCloseTo(0, 12);
    expect(rastrigin.grad({ x: 0, y: 0 }).x).toBeCloseTo(0, 12);
    expect(rastrigin.grad({ x: 0, y: 0 }).y).toBeCloseTo(0, 12);
  });
});

describe("gradient checks: multi-well country", () => {
  it("matches FD at 6 points (wells, flanks, rim, ripple node)", () => {
    checkGradient(multiWell, [
      { x: -1.6, y: 1.4 }, // deep canyon center
      { x: 2.6, y: -1.8 }, // narrow spike center
      { x: 2.2, y: 2.2 }, // broad bowl center
      { x: 0.3, y: -2.5 }, // trough flank
      { x: 3.5, y: 3.5 }, // rim
      { x: 0, y: 0 }, // ripple node between wells
    ]);
  });

  it("has exactly one local minimum per well — 6 distinct basins", () => {
    // Deterministic multi-start descent over a fixed grid (no Math.random).
    const mins: Array<{ x: number; y: number; f: number }> = [];
    for (let ix = 0; ix < 15; ix++) {
      for (let iy = 0; iy < 15; iy++) {
        let x = -3.9 + (ix / 14) * 7.8;
        let y = -3.9 + (iy / 14) * 7.8;
        for (let i = 0; i < 3000; i++) {
          const g = multiWell.grad({ x, y });
          x -= 0.01 * g.x;
          y -= 0.01 * g.y;
        }
        const f = multiWell.f({ x, y });
        const near = mins.find((m) => Math.hypot(m.x - x, m.y - y) < 0.2);
        if (!near) mins.push({ x, y, f });
      }
    }
    expect(mins).toHaveLength(MULTI_WELL_WELLS.length);
    // Every hardcoded well owns exactly one of the found minima.
    for (const w of MULTI_WELL_WELLS) {
      const nearest = mins.reduce((a, b) =>
        Math.hypot(b.x - w.x, b.y - w.y) < Math.hypot(a.x - w.x, a.y - w.y) ? b : a,
      );
      expect(Math.hypot(nearest.x - w.x, nearest.y - w.y)).toBeLessThan(0.3);
    }
  });

  it("basin floors are clearly DIFFERENT (clusters end at unequal losses)", () => {
    const values = MULTI_WELL_WELLS.map((w) => multiWell.f({ x: w.x, y: w.y })).sort(
      (a, b) => a - b,
    );
    // The global basin is the deep canyon and sits far below everything else.
    expect(values[0]).toBeLessThan(-5);
    // Consecutive basin floors are separated enough to read as unequal.
    for (let i = 1; i < values.length; i++) {
      expect(values[i] - values[i - 1]).toBeGreaterThan(0.3);
    }
    // And the shallowest well floor is >4 units above the deepest.
    expect(values[values.length - 1] - values[0]).toBeGreaterThan(4);
  });
});

/* ------------------------------------------------------------------ */
/* Deterministic multi-start descent (the minima-structure pattern)    */
/* ------------------------------------------------------------------ */

/** Fixed-lr gradient descent from every grid point; dedupe at `cluster`
 *  radius — the same pattern the multi-well tests established. */
function multiStartMinima(
  landscape: Landscape,
  half: number,
  grid: number,
  lr: number,
  iters: number,
  cluster: number,
): Array<{ x: number; y: number; f: number }> {
  const mins: Array<{ x: number; y: number; f: number }> = [];
  for (let ix = 0; ix < grid; ix++) {
    for (let iy = 0; iy < grid; iy++) {
      let x = -half + (ix / (grid - 1)) * 2 * half;
      let y = -half + (iy / (grid - 1)) * 2 * half;
      for (let i = 0; i < iters; i++) {
        const g = landscape.grad({ x, y });
        x -= lr * g.x;
        y -= lr * g.y;
      }
      const f = landscape.f({ x, y });
      const near = mins.find((m) => Math.hypot(m.x - x, m.y - y) < cluster);
      if (!near) mins.push({ x, y, f });
    }
  }
  return mins;
}

describe("gradient checks: multi-well large (the §7 picker's second country)", () => {
  it("matches FD at 6 points (well centers, flank, rim, between wells)", () => {
    checkGradient(multiWellLarge, [
      { x: -2.4, y: 2.6 }, // great rift center (the global basin)
      { x: 4.4, y: -3.4 }, // needle center
      { x: 1.0, y: 4.6 }, // kettle center
      { x: 0.3, y: -4.6 }, // fjord flank
      { x: 6.2, y: 6.2 }, // rim
      { x: 1.8, y: 1.8 }, // open plain between wells
    ]);
  });

  it("carries its 9-well list on the landscape", () => {
    expect(multiWellLarge.wells).toBe(MULTI_WELL_LARGE_WELLS);
    expect(MULTI_WELL_LARGE_WELLS).toHaveLength(9);
    expect(MULTI_WELL_LARGE_WELLS.filter((w) => w.global)).toHaveLength(1);
  });

  it("has exactly one local minimum per well — 9 distinct basins", () => {
    const mins = multiStartMinima(multiWellLarge, 6.35, 19, 0.01, 4000, 0.25);
    expect(mins).toHaveLength(MULTI_WELL_LARGE_WELLS.length);
    // Every hardcoded well owns exactly one of the found minima. The true
    // floor of a WIDE shallow well drifts from its nominal center (the rim
    // bowl tilts the Gaussian: shift ≈ bowl·r·a²/depth ≈ 0.3 for the
    // prairie bowl) — so the tolerance is 0.35, not the default's 0.3.
    for (const w of MULTI_WELL_LARGE_WELLS) {
      const nearest = mins.reduce((a, b) =>
        Math.hypot(b.x - w.x, b.y - w.y) < Math.hypot(a.x - w.x, a.y - w.y) ? b : a,
      );
      expect(Math.hypot(nearest.x - w.x, nearest.y - w.y)).toBeLessThan(0.35);
    }
  });

  it("basin floors are clearly DIFFERENT and the rift is far below all", () => {
    const values = MULTI_WELL_LARGE_WELLS.map((w) => multiWellLarge.f({ x: w.x, y: w.y })).sort(
      (a, b) => a - b,
    );
    expect(values[0]).toBeLessThan(-6);
    for (let i = 1; i < values.length; i++) {
      expect(values[i] - values[i - 1]).toBeGreaterThan(0.3);
    }
    expect(values[values.length - 1] - values[0]).toBeGreaterThan(5);
  });
});

describe("gradient checks: himmelblau (four equal GLOBAL minima)", () => {
  it("matches FD at 6 points (basins, saddle, rim)", () => {
    checkGradient(himmelblau, [
      { x: 2.7, y: 1.8 }, // near the (3, 2) pit
      { x: -2.5, y: 3.2 }, // near the (−2.8, 3.1) pit
      { x: -3.6, y: -3.1 }, // near the (−3.8, −3.3) pit
      { x: 3.5, y: -1.9 }, // near the (3.6, −1.8) pit
      { x: 0.2, y: 0.4 }, // the saddle between pits
      { x: 4.9, y: -4.9 }, // the steep quartic rim
    ]);
  });

  it("carries its 4-well list, every well flagged global", () => {
    expect(himmelblau.wells).toBe(HIMMELBLAU_WELLS);
    expect(HIMMELBLAU_WELLS).toHaveLength(4);
    expect(HIMMELBLAU_WELLS.every((w) => w.global === true)).toBe(true);
  });

  it("each well center is EXACTLY a stationary point with f = 0", () => {
    for (const w of HIMMELBLAU_WELLS) {
      const g = himmelblau.grad({ x: w.x, y: w.y });
      expect(Math.hypot(g.x, g.y)).toBeLessThan(1e-6);
      expect(himmelblau.f({ x: w.x, y: w.y })).toBeLessThan(1e-6);
    }
  });

  it("has exactly 4 distinct minima — ALL of them global (f = 0)", () => {
    const mins = multiStartMinima(himmelblau, 4.6, 15, 0.005, 6000, 0.2);
    expect(mins).toHaveLength(HIMMELBLAU_WELLS.length);
    for (const w of HIMMELBLAU_WELLS) {
      const nearest = mins.reduce((a, b) =>
        Math.hypot(b.x - w.x, b.y - w.y) < Math.hypot(a.x - w.x, a.y - w.y) ? b : a,
      );
      expect(Math.hypot(nearest.x - w.x, nearest.y - w.y)).toBeLessThan(0.05);
    }
    // THE counter-story to the multi-well countries: no hierarchy at all.
    for (const m of mins) {
      expect(m.f).toBeLessThan(1e-6);
    }
  });
});

describe("gradient checks: archipelago (the ridge-walled basin country)", () => {
  it("matches FD at 10 points (well centers, ridge crests, plain, rim)", () => {
    checkGradient(archipelago, [
      { x: -4.6, y: 3.9 }, // deep atoll center (the global basin)
      { x: 5.3, y: -4.6 }, // blue hole center
      { x: 6.4, y: 1.6 }, // cove center
      { x: -0.4, y: 0.0 }, // the skerry (interior plain)
      { x: 2.2, y: 3.0 }, // the tide pool (interior plain)
      { x: -2.47, y: 6.06 }, // strait wall crest (atoll ↔ crater)
      { x: 6.85, y: -1.6 }, // strait wall crest (cove ↔ blue hole)
      { x: -6.53, y: 0.68 }, // strait wall crest (lagoon ↔ atoll)
      { x: 0, y: 0 }, // the plain's drain node
      { x: 8.5, y: 8.5 }, // the sextic rim corner
    ]);
  });

  it("carries its 8-well list, deepest-first, one global basin", () => {
    expect(archipelago.wells).toBe(ARCHIPELAGO_WELLS);
    expect(ARCHIPELAGO_WELLS).toHaveLength(8);
    expect(ARCHIPELAGO_WELLS.filter((w) => w.global)).toHaveLength(1);
    expect(ARCHIPELAGO_WELLS[0].name).toBe("the deep atoll");
  });

  it("has exactly one local minimum per well — 8 distinct basins", () => {
    const mins = multiStartMinima(archipelago, 8.85, 19, 0.01, 4000, 0.35);
    expect(mins).toHaveLength(ARCHIPELAGO_WELLS.length);
    for (const w of ARCHIPELAGO_WELLS) {
      const nearest = mins.reduce((a, b) =>
        Math.hypot(b.x - w.x, b.y - w.y) < Math.hypot(a.x - w.x, a.y - w.y) ? b : a,
      );
      expect(Math.hypot(nearest.x - w.x, nearest.y - w.y)).toBeLessThan(0.35);
    }
  });

  it("basin floors are clearly DIFFERENT, all below sea level, atoll far below", () => {
    const values = ARCHIPELAGO_WELLS.map((w) => archipelago.f({ x: w.x, y: w.y })).sort(
      (a, b) => a - b,
    );
    for (const v of values) expect(v).toBeLessThan(0);
    expect(values[0]).toBeLessThan(-7);
    for (let i = 1; i < values.length; i++) {
      expect(values[i] - values[i - 1]).toBeGreaterThan(0.45);
    }
    expect(values[values.length - 1] - values[0]).toBeGreaterThan(7);
  });

  it("the strait ridges are REAL walls between neighboring basins", () => {
    // Straight lines between each neighboring ring pair must cross a ridge
    // well above both basins' floors — walls, not just empty space.
    const neighbors: Array<[number, number]> = [
      [0, 3], [3, 4], [4, 1], [1, 5], [5, 2], [2, 0],
    ];
    expect(ARCHIPELAGO_RIDGES).toHaveLength(6);
    for (const [i, j] of neighbors) {
      const a = ARCHIPELAGO_WELLS[i];
      const b = ARCHIPELAGO_WELLS[j];
      const floors = Math.max(archipelago.f({ x: a.x, y: a.y }), archipelago.f({ x: b.x, y: b.y }));
      let crossing = -Infinity;
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      for (let k = 1; k < 64; k++) {
        const u = k / 64;
        const s = u * d; // arc distance from a
        if (s < 0.2 || d - s < 0.2) continue; // skip the basin interiors
        const p = { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
        crossing = Math.max(crossing, archipelago.f(p));
      }
      expect(crossing - floors).toBeGreaterThan(1.5);
    }
  });
});

describe("gradient checks: canyon peaks (the winding valley)", () => {
  // The floor's path g(x) = 1.5·sin(1.05x) + 0.15x², as exact doubles.
  const g = (x: number): number => 1.5 * Math.sin(1.05 * x) + 0.15 * x * x;

  it("matches FD at 10 points (floor, walls, peaks, rim)", () => {
    checkGradient(canyonPeaks, [
      { x: -2.9, y: g(-2.9) }, // the high west mouth
      { x: -1.5, y: g(-1.5) }, // the southern bend
      { x: 0, y: 0 }, // the middle of the groove
      { x: 1.5, y: g(1.5) }, // the northern bend
      { x: 2.6, y: g(2.6) }, // the sea gate (the global minimum)
      { x: -1.3, y: -0.3145 }, // west peak's named center
      { x: 1.85, y: 2.811 }, // north-east peak's named center
      { x: -1.365, y: -0.025 }, // the west summit (the climb's landing)
      { x: 0, y: 2.2 }, // the north wall
      { x: -3.2, y: -3.3 }, // the south-west rim
    ]);
  });

  it("drains to the sea gate at (2.6, g(2.6)) — the global minimum", () => {
    expect(g(2.6)).toBeCloseTo(1.6141042163886286, 15);
    // The gate floor is near zero (only the north-east peak's tail lifts
    // it, to ≈ 0.06).
    expect(canyonPeaks.f({ x: 2.6, y: g(2.6) })).toBeLessThan(0.1);
    // A slow descent from mid-canyon floor converges to the gate: GD's
    // asymptotic creep leaves it within 0.15 of the exact gate point — far
    // inside the tilt game's 0.495 goal radius there.
    let p = { x: 1.5, y: g(1.5) };
    for (let i = 0; i < 20000; i++) {
      const gr = canyonPeaks.grad(p);
      p = { x: p.x - 0.001 * gr.x, y: p.y - 0.001 * gr.y };
    }
    expect(Math.hypot(p.x - 2.6, p.y - g(2.6))).toBeLessThan(0.15);
  });

  it("each named peak is a REAL local summit near its named center", () => {
    const centers: ReadonlyArray<Vec2> = [
      { x: -1.3, y: -0.3145 },
      { x: 1.85, y: 2.811 },
    ];
    for (const c of centers) {
      // Climb from the named center to the TRUE stationary summit (the
      // summit sits slightly up-wall of the center). Fixed-LENGTH steps so
      // the steep wall gradient can't fling the climber into NaN.
      let p = { ...c };
      for (let i = 0; i < 400; i++) {
        const gr = canyonPeaks.grad(p);
        const gn = Math.hypot(gr.x, gr.y);
        if (gn < 0.02) break;
        p = { x: p.x + (0.01 * gr.x) / gn, y: p.y + (0.01 * gr.y) / gn };
      }
      // …the summit stands within 0.45 of the named center (the climb
      // stayed on THIS peak, it did not escape over a wall)…
      expect(Math.hypot(p.x - c.x, p.y - c.y)).toBeLessThan(0.45);
      // …it IS stationary…
      const gr = canyonPeaks.grad(p);
      expect(Math.hypot(gr.x, gr.y)).toBeLessThan(0.05);
      // …and it towers ≥ 15 units over the floor directly below the center.
      const floorBelow = canyonPeaks.f({ x: c.x, y: g(c.x) });
      expect(canyonPeaks.f(p) - floorBelow).toBeGreaterThan(15);
    }
  });

  it("one navigable floor, dramatic walls: the groove stays low, the sides soar", () => {
    // The whole walkable floor from the mouth to the gate stays below 32
    // (the west mouth's drain height)…
    let maxFloor = -Infinity;
    for (let i = 0; i <= 118; i++) {
      const x = -2.95 + (i / 118) * 5.75;
      maxFloor = Math.max(maxFloor, canyonPeaks.f({ x, y: g(x) }));
    }
    expect(maxFloor).toBeLessThan(32);
    // …while the walls 1.6 units off the groove already exceed 20 at every
    // sample point along it (the dy⁴ far-wall term at work).
    for (const x of [-2.0, -1.0, 0, 1.0, 2.0]) {
      for (const side of [1, -1]) {
        expect(canyonPeaks.f({ x, y: g(x) + side * 1.6 })).toBeGreaterThan(20);
      }
    }
  });

  it("carries no well list — tilt-only terrain, no basin-of-attraction story", () => {
    expect(canyonPeaks.wells).toBeUndefined();
  });
});

describe("gradient checks: least squares", () => {
  it("matches FD at 4 points", () => {
    checkGradient(leastSquares, [
      { x: 0.5, y: 0.5 },
      { x: 2.0, y: -1.0 },
      { x: -1.0, y: 2.0 },
      { x: 1.5, y: 0.0 },
    ]);
  });

  it("exactly 12 hardcoded points, deterministic", () => {
    expect(LEAST_SQUARES_POINTS).toHaveLength(12);
  });

  it("closed-form optimum has ~zero gradient and sits near y = 0.9x + 1.4", () => {
    // Normal equations computed from the hardcoded data (deterministic).
    const n = LEAST_SQUARES_POINTS.length;
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let sxy = 0;
    for (const pt of LEAST_SQUARES_POINTS) {
      sx += pt.x;
      sy += pt.y;
      sxx += pt.x * pt.x;
      sxy += pt.x * pt.y;
    }
    const wStar = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    const bStar = (sy - wStar * sx) / n;

    const g = leastSquares.grad({ x: wStar, y: bStar });
    expect(relErr(g.x, 0)).toBeLessThan(1e-9);
    expect(relErr(g.y, 0)).toBeLessThan(1e-9);

    // Dataset-design intent: the points hug the line w=0.9, b=1.4.
    expect(Math.abs(wStar - 0.9)).toBeLessThan(0.15);
    expect(Math.abs(bStar - 1.4)).toBeLessThan(0.15);
  });
});

/* ------------------------------------------------------------------ */
/* Optimizer invariants                                               */
/* ------------------------------------------------------------------ */

describe("gd invariant: step = pos − lr·grad", () => {
  it("exact arithmetic at several (lr, pos, grad) combos", () => {
    const opt = gd(0.1);
    const cases: Array<{ pos: Vec2; grad: Vec2 }> = [
      { pos: { x: 2, y: -1 }, grad: { x: 3, y: -4 } },
      { pos: { x: -0.5, y: 0.25 }, grad: { x: -2, y: 8 } },
      { pos: { x: 10, y: 10 }, grad: { x: 0.001, y: -0.002 } },
    ];
    for (const { pos, grad } of cases) {
      const next = opt.step(opt.initState(pos), grad);
      expect(next.pos.x).toBeCloseTo(pos.x - 0.1 * grad.x, 12);
      expect(next.pos.y).toBeCloseTo(pos.y - 0.1 * grad.y, 12);
    }
  });

  it("halving lr halves the gd displacement", () => {
    const a = gd(0.2).step({ pos: { x: 1, y: 1 } }, { x: 3, y: -2 });
    const b = gd(0.1).step({ pos: { x: 1, y: 1 } }, { x: 3, y: -2 });
    expect(a.pos.x - 1).toBeCloseTo(2 * (b.pos.x - 1), 12);
    expect(a.pos.y - 1).toBeCloseTo(2 * (b.pos.y - 1), 12);
  });
});

describe("momentum invariants: velocity accumulates", () => {
  it("constant gradient builds velocity 1, 1.9, 2.71 with β=0.9", () => {
    const opt = momentum(0.1, 0.9);
    const grad = { x: 1, y: 2 };
    let state: OptimizerState = opt.initState({ x: 0, y: 0 });

    state = opt.step(state, grad);
    expect(state.velocity?.x).toBeCloseTo(1, 12);
    expect(state.velocity?.y).toBeCloseTo(2, 12);

    state = opt.step(state, grad);
    expect(state.velocity?.x).toBeCloseTo(1.9, 12);
    expect(state.velocity?.y).toBeCloseTo(3.8, 12);

    state = opt.step(state, grad);
    expect(state.velocity?.x).toBeCloseTo(2.71, 12);
    expect(state.velocity?.y).toBeCloseTo(5.42, 12);

    // And the position actually rode that accumulating velocity.
    expect(state.pos.x).toBeCloseTo(-0.1 * (1 + 1.9 + 2.71), 12);
    expect(state.pos.y).toBeCloseTo(-0.1 * (2 + 3.8 + 5.42), 12);
  });

  it("β=0 reduces exactly to gd", () => {
    const mom = momentum(0.1, 0);
    const plain = gd(0.1);
    const pos = { x: 1.3, y: -2.7 };
    const grad = { x: 0.4, y: 5 };
    expect(mom.step(mom.initState(pos), grad).pos).toEqual(
      plain.step(plain.initState(pos), grad).pos,
    );
  });

  it("sign-flipping gradient (wall bounce) damps instead of accumulating", () => {
    // Across a valley the gradient alternates; momentum must cancel it.
    const opt = momentum(0.1, 0.9);
    let state = opt.initState({ x: 0, y: 0 });
    for (const grad of [
      { x: 10, y: 0 },
      { x: -10, y: 0 },
    ]) {
      state = opt.step(state, grad);
    }
    expect(state.velocity?.x).toBeCloseTo(0.9 * 10 - 10, 12);
  });
});

describe("adam invariants", () => {
  it("first step moves ~lr per coordinate, opposite the gradient", () => {
    const lr = 0.5;
    const opt = adam(lr, 0.9, 0.999, 1e-8);
    const pos = { x: 3, y: -3 };
    const next = opt.step(opt.initState(pos), { x: 3, y: -0.75 });
    // |Δ| = lr·|g|/(|g|+eps) ≈ lr; sign opposite to each gradient component.
    expect(next.pos.x - pos.x).toBeLessThan(0);
    expect(next.pos.y - pos.y).toBeGreaterThan(0);
    expect(Math.abs(next.pos.x - pos.x) - lr).toBeLessThan(1e-6);
    expect(Math.abs(next.pos.y - pos.y) - lr).toBeLessThan(1e-6);
  });

  it("first step is ~lr whether the coordinate is steep or shallow", () => {
    const lr = 0.25;
    const opt = adam(lr, 0.9, 0.999, 1e-8);
    const pos = { x: 0, y: 0 };
    const next = opt.step(opt.initState(pos), { x: 1000, y: 0.001 });
    expect(Math.abs(next.pos.x - pos.x) - lr).toBeLessThan(1e-5);
    expect(Math.abs(next.pos.y - pos.y) - lr).toBeLessThan(1e-5);
  });

  it("counts timesteps and carries m, v for the inspector", () => {
    const opt = adam(0.1, 0.9, 0.999, 1e-8);
    let state = opt.initState({ x: 0, y: 0 });
    expect(state.t).toBe(0);
    state = opt.step(state, { x: 2, y: -1 });
    expect(state.t).toBe(1);
    expect(state.m?.x).toBeCloseTo(0.1 * 2, 12); // (1−β1)·g
    expect(state.v?.x).toBeCloseTo(0.001 * 4, 12); // (1−β2)·g²
    state = opt.step(state, { x: 2, y: -1 });
    expect(state.t).toBe(2);
  });

  it("50 steps on rosenbrock stay finite and are bit-identical across runs", () => {
    const run = (): Vec2 => {
      const opt = adam(0.05, 0.9, 0.999, 1e-8);
      let state = opt.initState({ x: -1.2, y: 1 });
      for (let i = 0; i < 50; i++) {
        state = opt.step(state, rosenbrock.grad(state.pos));
        expect(Number.isFinite(state.pos.x)).toBe(true);
        expect(Number.isFinite(state.pos.y)).toBe(true);
      }
      return state.pos;
    };
    const a = run();
    const b = run();
    expect(a.x).toBe(b.x);
    expect(a.y).toBe(b.y);
  });
});

describe("all optimizers: purity", () => {
  it("step() never mutates its input state", () => {
    const pos = { x: 1, y: 2 };
    const grad = { x: 3, y: -4 };
    const snapshot = JSON.stringify(pos);

    const gdNext = gd(0.1).step({ pos: { ...pos } }, grad);
    expect(JSON.stringify(gdNext.pos)).not.toBe(snapshot); // it moved...
    expect(JSON.stringify(pos)).toBe(snapshot); // ...but the input didn't.

    const momOpt = momentum(0.1, 0.9);
    const momState = momOpt.initState(pos);
    const momSnapshot = JSON.stringify(momState);
    momOpt.step(momState, grad);
    expect(JSON.stringify(momState)).toBe(momSnapshot);

    const adamOpt = adam(0.1, 0.9, 0.999, 1e-8);
    const adamState = adamOpt.initState(pos);
    const adamSnapshot = JSON.stringify(adamState);
    adamOpt.step(adamState, grad);
    expect(JSON.stringify(adamState)).toBe(adamSnapshot);
  });
});
