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
  MULTI_WELL_WELLS,
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
