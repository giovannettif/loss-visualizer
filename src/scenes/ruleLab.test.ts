/**
 * §8 workbench tests — the custom rule's invariants + the no-free-lunch
 * benchmark flip, verified against the REAL TypeScript core (the curated
 * constants were picked with tools/tune-rule.mjs and are LOCKED here so any
 * drift that would break the page's story fails the suite).
 */

import { describe, it, expect } from "vitest";
import { defaultBowl, leastSquares, rosenbrock, type Vec2 } from "../core/functions";
import { customRule, gd, momentum, type OptimizerState } from "../core/optimizers";
import {
  RULE_CONFIG_DEFAULT,
  ruleBenchmark,
  ruleBestSteps,
  ruleClipFromKnob,
  ruleEtaFromKnob,
  ruleKnobFromClip,
  ruleKnobFromEta,
  ruleLevelById,
} from "./ruleLab";

const CFG = RULE_CONFIG_DEFAULT;

/* ------------------------------------------------------------------ */
/* customRule invariants                                               */
/* ------------------------------------------------------------------ */

describe("customRule: the parts reproduce the whole cast", () => {
  it("β=0, normalize off, clip off is EXACT gd(lr)", () => {
    const custom = customRule({ lr: 0.3, beta: 0, normalize: false, clip: null });
    const plain = gd(0.3);
    const pos: Vec2 = { x: 1.3, y: -2.7 };
    const grad: Vec2 = { x: 0.4, y: 5 };
    const a = custom.step(custom.initState(pos), grad);
    const b = plain.step(plain.initState(pos), grad);
    expect(a.pos.x).toBeCloseTo(b.pos.x, 12);
    expect(a.pos.y).toBeCloseTo(b.pos.y, 12);
  });

  it("β>0, normalize off, clip off is EXACT momentum(lr, β)", () => {
    const custom = customRule({ lr: 0.2, beta: 0.9, normalize: false, clip: null });
    const mom = momentum(0.2, 0.9);
    let a: OptimizerState = custom.initState({ x: -1, y: 2 });
    let b: OptimizerState = mom.initState({ x: -1, y: 2 });
    // Three steps on a real landscape gradient so the accumulator builds.
    for (let i = 0; i < 3; i++) {
      const g = defaultBowl.grad(a.pos);
      a = custom.step(a, g);
      b = mom.step(b, g);
      expect(a.pos.x).toBeCloseTo(b.pos.x, 12);
      expect(a.pos.y).toBeCloseTo(b.pos.y, 12);
    }
  });

  it("normalize on: the first step moves ~lr per coordinate (the Adam mechanism)", () => {
    const lr = 0.25;
    const opt = customRule({ lr, beta: 0, normalize: true, clip: null });
    const pos: Vec2 = { x: 0, y: 0 };
    const next = opt.step(opt.initState(pos), { x: 1000, y: 0.001 });
    expect(Math.abs(next.pos.x - pos.x) - lr).toBeLessThan(1e-5);
    expect(Math.abs(next.pos.y - pos.y) - lr).toBeLessThan(1e-5);
  });

  it("clip caps the update NORM exactly", () => {
    const clip = 0.4;
    const opt = customRule({ lr: 5, beta: 0, normalize: false, clip });
    const next = opt.step(opt.initState({ x: 0, y: 0 }), { x: 3, y: -4 });
    const len = Math.hypot(next.pos.x, next.pos.y);
    expect(len).toBeCloseTo(clip, 12);
  });

  it("clip never shortens a step already inside the cap", () => {
    const opt = customRule({ lr: 0.001, beta: 0, normalize: false, clip: 10 });
    const uncapped = customRule({ lr: 0.001, beta: 0, normalize: false, clip: null });
    const g = { x: 0.3, y: -0.2 };
    const a = opt.step(opt.initState({ x: 1, y: 1 }), g);
    const b = uncapped.step(uncapped.initState({ x: 1, y: 1 }), g);
    expect(a.pos.x).toBe(b.pos.x);
    expect(a.pos.y).toBe(b.pos.y);
  });

  it("step() never mutates its input state", () => {
    const opt = customRule(CFG);
    const state = opt.initState({ x: 1, y: 2 });
    const snapshot = JSON.stringify(state);
    opt.step(state, { x: 3, y: -4 });
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it("50 steps on Rosenbrock stay finite and are bit-identical across runs", () => {
    const run = (): Vec2 => {
      const opt = customRule(CFG);
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

/* ------------------------------------------------------------------ */
/* Slider mappings                                                     */
/* ------------------------------------------------------------------ */

describe("§8 slider mappings round-trip", () => {
  it("η knob ↔ η (log sweep, within one integer-knob tick ≈ 0.7%)", () => {
    for (const eta of [0.002, 0.05, 0.5, 2]) {
      const back = ruleEtaFromKnob(ruleKnobFromEta(eta));
      expect(Math.abs(back - eta) / eta).toBeLessThan(0.007);
    }
    expect(ruleEtaFromKnob(0)).toBeCloseTo(0.002, 9);
    expect(ruleEtaFromKnob(1000)).toBeCloseTo(2, 9);
  });

  it("clip knob: 0 is OFF; a positive clip round-trips within one tick", () => {
    expect(ruleClipFromKnob(0)).toBeNull();
    for (const clip of [0.05, 0.35, 2]) {
      const back = ruleClipFromKnob(ruleKnobFromClip(clip)) ?? 0;
      expect(Math.abs(back - clip) / clip).toBeLessThan(0.005);
    }
    // knob 0 must never read as a clip: OFF stays OFF.
    expect(ruleKnobFromClip(null)).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* The benchmark + the no-free-lunch flip (LOCKED constants)           */
/* ------------------------------------------------------------------ */

describe("§8 benchmark: one rule, three verdicts (the flip)", () => {
  it("Rosenbrock: the curated rule converges FIRST, beating Adam by ~10×", () => {
    const b = ruleBenchmark("rosen", CFG);
    expect(b.custom.steps).toBe(14);
    const mom = b.machines.find((m) => m.key === "mom");
    const adamRun = b.machines.find((m) => m.key === "adam");
    const gdRun = b.machines.find((m) => m.key === "gd");
    expect(mom?.steps).toBe(113);
    expect(adamRun?.steps).toBe(164);
    expect(gdRun?.steps).toBeNull(); // GD crawls: DNF
    expect(ruleBestSteps(b)).toBe(14);
  });

  it("bowl: the advantage FLIPS — momentum (beaten 8×) now wins, custom is mid-pack", () => {
    const b = ruleBenchmark("bowl", CFG);
    const mom = b.machines.find((m) => m.key === "mom");
    expect(mom?.steps).toBe(21);
    expect(b.custom.steps).toBe(57);
    // The rule that lost to custom by 8× on Rosenbrock now wins by 2.7×.
    expect(b.custom.steps! > mom!.steps! * 2).toBe(true);
    expect(ruleBestSteps(b)).toBe(21);
  });

  it("least squares: the curated rule finishes LAST", () => {
    const b = ruleBenchmark("ls", CFG);
    const adamRun = b.machines.find((m) => m.key === "adam");
    expect(adamRun?.steps).toBe(8);
    expect(ruleBestSteps(b)).toBe(8);
    const all = [b.custom, ...b.machines].filter((r) => r.steps !== null);
    const customRank = all.filter((r) => r.steps! <= b.custom.steps!).length;
    expect(customRank).toBe(all.length); // nobody converged slower
  });

  it("every run's recorded losses match the landscape (and start at f(start))", () => {
    for (const id of ["bowl", "rosen", "ls"] as const) {
      const level = ruleLevelById(id);
      const b = ruleBenchmark(id, CFG);
      for (const run of [b.custom, ...b.machines]) {
        expect(run.losses[0]).toBeCloseTo(level.landscape.f(level.start), 12);
        expect(run.path[0]).toEqual(level.start);
        const i = run.path.length - 1;
        expect(run.losses[i]).toBeCloseTo(level.landscape.f(run.path[i]), 12);
      }
    }
  });

  it("runs are deterministic: two benchmarks agree bit-for-bit", () => {
    const a = ruleBenchmark("rosen", CFG);
    const b = ruleBenchmark("rosen", CFG);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("least squares is only 'converged' relative to its 1.425 noise floor", () => {
    // The threshold must sit ABOVE the irreducible residual floor, else the
    // level is unwinnable by construction.
    const level = ruleLevelById("ls");
    let n = 0;
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let sxy = 0;
    for (const p of [
      { x: -3.0, y: -1.35 }, { x: -2.4, y: -0.4 }, { x: -1.8, y: -0.95 },
      { x: -1.2, y: 0.55 }, { x: -0.6, y: 0.35 }, { x: 0.0, y: 1.5 },
      { x: 0.6, y: 1.75 }, { x: 1.2, y: 2.15 }, { x: 1.8, y: 3.35 },
      { x: 2.4, y: 3.3 }, { x: 3.0, y: 3.75 }, { x: 3.6, y: 4.95 },
    ]) {
      n += 1; sx += p.x; sy += p.y; sxx += p.x * p.x; sxy += p.x * p.y;
    }
    const det = n * sxx - sx * sx;
    const w = (n * sxy - sx * sy) / det;
    const bInt = (sy - w * sx) / n;
    expect(level.threshold).toBeGreaterThan(leastSquares.f({ x: w, y: bInt }));
  });
});
