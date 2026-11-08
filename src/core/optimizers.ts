/**
 * Optimizers — pure state-machine step functions.
 *
 * Each factory returns an Optimizer whose step(state, grad) returns a NEW
 * state object (input never mutated) carrying the updated `.pos`. Pure and
 * deterministic: same (state, grad) in → same state out, every time.
 *
 * All of this is parameter-space math; rendering never touches it.
 */

import type { Vec2 } from "./functions";

/** State carried across steps. The extra fields belong to specific optimizers. */
export interface OptimizerState {
  /** Current point in parameter space. */
  pos: Vec2;
  /** Momentum velocity (momentum + the custom rule): v ← βv + g. */
  velocity?: Vec2;
  /** Adam 1st-moment estimate. */
  m?: Vec2;
  /** Adam 2nd-moment (squared-gradient) estimate. */
  v?: Vec2;
  /** Adam timestep counter (for bias correction). */
  t?: number;
  /** Custom rule: running per-coordinate mean of g² (for √normalize). */
  sq?: Vec2;
}

export interface Optimizer {
  readonly name: string;
  initState(pos: Vec2): OptimizerState;
  /** One update from `state` against gradient `grad`; returns a fresh state. */
  step(state: OptimizerState, grad: Vec2): OptimizerState;
}

/* ------------------------------------------------------------------ */
/* Gradient descent: pos ← pos − lr·∇f                                */
/* ------------------------------------------------------------------ */

export function gd(lr: number): Optimizer {
  return {
    name: "gd",
    initState(pos: Vec2): OptimizerState {
      return { pos: { ...pos } };
    },
    step(state: OptimizerState, grad: Vec2): OptimizerState {
      return {
        pos: {
          x: state.pos.x - lr * grad.x,
          y: state.pos.y - lr * grad.y,
        },
      };
    },
  };
}

/* ------------------------------------------------------------------ */
/* Momentum (PyTorch convention): v ← βv + ∇f;  pos ← pos − lr·v      */
/* ------------------------------------------------------------------ */

/**
 * The velocity is a running average of recent gradients (weights summing to
 * 1/(1−β)). Across-valley components cancel; along-valley ones accumulate.
 * β = 0 reduces exactly to GD.
 */
export function momentum(lr: number, beta: number): Optimizer {
  return {
    name: "momentum",
    initState(pos: Vec2): OptimizerState {
      return { pos: { ...pos }, velocity: { x: 0, y: 0 } };
    },
    step(state: OptimizerState, grad: Vec2): OptimizerState {
      const vPrev = state.velocity ?? { x: 0, y: 0 };
      const velocity = {
        x: beta * vPrev.x + grad.x,
        y: beta * vPrev.y + grad.y,
      };
      return {
        pos: {
          x: state.pos.x - lr * velocity.x,
          y: state.pos.y - lr * velocity.y,
        },
        velocity,
      };
    },
  };
}

/* ------------------------------------------------------------------ */
/* Adam (Kingma & Ba, with bias correction)                           */
/* ------------------------------------------------------------------ */

/**
 * t ← t+1;  m ← β₁m + (1−β₁)g;  v ← β₂v + (1−β₂)g²;
 * m̂ = m/(1−β₁ᵗ);  v̂ = v/(1−β₂ᵗ);  pos ← pos − lr·m̂/(√v̂ + eps).
 *
 * On the FIRST step, m̂ = g and v̂ = g², so the update is
 * −lr·g/(|g| + eps) ≈ −lr·sign(g): every coordinate moves ~lr regardless of
 * how steep its direction is. That's the §4 punchline.
 */
export function adam(lr: number, beta1: number, beta2: number, eps: number): Optimizer {
  return {
    name: "adam",
    initState(pos: Vec2): OptimizerState {
      return { pos: { ...pos }, m: { x: 0, y: 0 }, v: { x: 0, y: 0 }, t: 0 };
    },
    step(state: OptimizerState, grad: Vec2): OptimizerState {
      const t = (state.t ?? 0) + 1;
      const mPrev = state.m ?? { x: 0, y: 0 };
      const vPrev = state.v ?? { x: 0, y: 0 };

      const m = {
        x: beta1 * mPrev.x + (1 - beta1) * grad.x,
        y: beta1 * mPrev.y + (1 - beta1) * grad.y,
      };
      const v = {
        x: beta2 * vPrev.x + (1 - beta2) * grad.x * grad.x,
        y: beta2 * vPrev.y + (1 - beta2) * grad.y * grad.y,
      };

      const bc1 = 1 - Math.pow(beta1, t);
      const bc2 = 1 - Math.pow(beta2, t);

      return {
        pos: {
          x: state.pos.x - (lr * (m.x / bc1)) / (Math.sqrt(v.x / bc2) + eps),
          y: state.pos.y - (lr * (m.y / bc1)) / (Math.sqrt(v.y / bc2) + eps),
        },
        m,
        v,
        t,
      };
    },
  };
}

/* ------------------------------------------------------------------ */
/* The §8 custom rule: momentum + per-coordinate normalize + clip      */
/* ------------------------------------------------------------------ */

/** Decay of the custom rule's running g² average (Adam's β₂). */
const CUSTOM_GAMMA = 0.999;
/** Same ε as Adam: guards the √ of a possibly-zero running average. */
const CUSTOM_EPS = 1e-8;

/**
 * The parts the §8 workbench assembles (every part optional):
 *   1. momentum accumulator   v ← β·v + g          (β = 0 → raw gradients)
 *   2. per-coordinate normalize  u = v/(√s̄ + ε),  s̄ = s/(1−γᵗ) bias-corrected,
 *      s ← γ·s + (1−γ)·g²                          (the Adam mechanism)
 *   3. update   Δ = −η·u
 *   4. clip     ‖Δ‖ ← min(‖Δ‖, clip)             (null/0 = unclipped)
 *
 * The parts reproduce the whole cast: {β:0, normalize:off, clip:null} is
 * EXACT gd(η); {β:β, normalize:off, clip:null} is EXACT momentum(η, β);
 * normalize on is Adam's m̂/√v̂ mechanism with momentum in place of m̂.
 * An update rule is a bet about landscape structure (§8's thesis) — these
 * are the four bets, made explicit and toggleable.
 */
export interface CustomRuleConfig {
  /** η — how far to trust the (possibly normalized) accumulator. */
  lr: number;
  /** β — how long the gradient accumulator remembers. */
  beta: number;
  /** Per-coordinate normalize (the Adam mechanism) on the accumulator. */
  normalize: boolean;
  /** Max update norm in parameter units; null or 0 = unclipped. */
  clip: number | null;
}

export function customRule(cfg: CustomRuleConfig): Optimizer {
  return {
    name: "custom",
    initState(pos: Vec2): OptimizerState {
      return {
        pos: { ...pos },
        velocity: { x: 0, y: 0 },
        sq: { x: 0, y: 0 },
        t: 0,
      };
    },
    step(state: OptimizerState, grad: Vec2): OptimizerState {
      const t = (state.t ?? 0) + 1;
      const vPrev = state.velocity ?? { x: 0, y: 0 };
      const sPrev = state.sq ?? { x: 0, y: 0 };

      // Part 1 — the momentum accumulator.
      const velocity = {
        x: cfg.beta * vPrev.x + grad.x,
        y: cfg.beta * vPrev.y + grad.y,
      };
      // Part 2 — the running g² average + bias-corrected √normalize.
      const sq = {
        x: CUSTOM_GAMMA * sPrev.x + (1 - CUSTOM_GAMMA) * grad.x * grad.x,
        y: CUSTOM_GAMMA * sPrev.y + (1 - CUSTOM_GAMMA) * grad.y * grad.y,
      };
      let ux: number;
      let uy: number;
      if (cfg.normalize) {
        const bc = 1 - Math.pow(CUSTOM_GAMMA, t);
        ux = velocity.x / (Math.sqrt(sq.x / bc) + CUSTOM_EPS);
        uy = velocity.y / (Math.sqrt(sq.y / bc) + CUSTOM_EPS);
      } else {
        ux = velocity.x;
        uy = velocity.y;
      }

      // Part 3 — the scaled update.
      let dx = -cfg.lr * ux;
      let dy = -cfg.lr * uy;

      // Part 4 — clip the step NORM (a ball around the current point).
      if (cfg.clip != null && cfg.clip > 0) {
        const len = Math.hypot(dx, dy);
        if (len > cfg.clip) {
          dx *= cfg.clip / len;
          dy *= cfg.clip / len;
        }
      }

      return {
        pos: { x: state.pos.x + dx, y: state.pos.y + dy },
        velocity,
        sq,
        t,
      };
    },
  };
}
