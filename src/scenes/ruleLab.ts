/**
 * ruleLab — the pure, deterministic core of §8's optimizer workbench
 * (no DOM, no three), the same discipline as fogGame/tiltGame.
 *
 * Three benchmark landscapes:
 *   "bowl"  — the §2 rotated elongated valley (curvature ratio 50, θ=30°),
 *   "rosen" — Rosenbrock's banana valley,
 *   "ls"    — the §1 least-squares surface (the §9 tie-back).
 *
 * The benchmark: the player's assembled rule (purple) races GD / momentum /
 * Adam from the SAME start, each machine with a hand-tuned η for that
 * landscape (the same honesty as the fog game). Convergence = loss below the
 * level's threshold; the scoreboard is STEPS TO CONVERGE (DNF past 400).
 *
 * The curated config {η 0.5, β 0.9, normalize ON, clip 0.35} — verified
 * numerically against this exact core (tools/tune-rule.mjs, and locked in
 * ruleLab.test.ts): on Rosenbrock it converges in 14 steps where momentum
 * needs 113, Adam 164 and GD never lands; switch to the bowl and momentum —
 * which it beat 8× — now converges 3× faster; on least squares it finishes
 * last. One rule, three verdicts: no free lunch, experienced.
 *
 * Everything here is state-in/state-out so vitest verifies the benchmark the
 * same way it verifies the math core.
 */

import {
  defaultBowl,
  leastSquares,
  rosenbrock,
  type Landscape,
  type Vec2,
} from "../core/functions";
import {
  customRule,
  gd,
  momentum,
  adam,
  type CustomRuleConfig,
  type Optimizer,
} from "../core/optimizers";

/* ------------------------------------------------------------------ */
/* Levels                                                              */
/* ------------------------------------------------------------------ */

export type RuleLevelId = "bowl" | "rosen" | "ls";

export interface RuleLevel {
  id: RuleLevelId;
  /** Display name for the picker + panel. */
  name: string;
  /** Short bet description (what this landscape rewards). */
  bet: string;
  landscape: Landscape;
  start: Vec2;
  /** Convergence: loss strictly below this. */
  threshold: number;
  /** Steps before a run is declared DNF. */
  maxSteps: number;
}

export const RULE_LEVELS: ReadonlyArray<RuleLevel> = [
  {
    id: "bowl",
    name: "elongated valley",
    bet: "rewards momentum's damping",
    landscape: defaultBowl,
    start: { x: -11, y: 9.5 }, // the §2 start
    threshold: 0.5,
    maxSteps: 400,
  },
  {
    id: "rosen",
    name: "Rosenbrock",
    bet: "rewards per-coordinate normalize",
    landscape: rosenbrock,
    start: { x: -1.2, y: 1.44 }, // on the banana, same as §6/§7
    threshold: 1.0,
    maxSteps: 400,
  },
  {
    id: "ls",
    name: "least squares",
    bet: "rewards small well-tuned steps",
    landscape: leastSquares,
    start: { x: 0.2, y: 0.5 }, // the §1 start
    // The 12 noisy points have an irreducible floor ℒ = 1.425 — "converged"
    // means reaching the neighborhood of the normal-equation minimum.
    threshold: 1.5,
    maxSteps: 400,
  },
];

export function ruleLevelById(id: RuleLevelId): RuleLevel {
  const hit = RULE_LEVELS.find((l) => l.id === id);
  if (!hit) throw new Error(`ruleLab: no level "${id}"`);
  return hit;
}

/* ------------------------------------------------------------------ */
/* The curated workbench config (the ?shot=labrule pose)               */
/* ------------------------------------------------------------------ */

export const RULE_CONFIG_DEFAULT: CustomRuleConfig = {
  lr: 0.5,
  beta: 0.9,
  normalize: true,
  clip: 0.35,
};

/** Slider ranges (main.ts maps knob 0..1000 ↔ these, log where noted). */
export const RULE_ETA_MIN = 0.002;
export const RULE_ETA_MAX = 2;
export const RULE_BETA_MAX = 0.99;
export const RULE_CLIP_MIN = 0.05;
export const RULE_CLIP_MAX = 2;

/** knob 0..1000 → η (log sweep, the §2 dial). */
export function ruleEtaFromKnob(v: number): number {
  const t = Math.min(1, Math.max(0, v / 1000));
  return Math.exp(
    Math.log(RULE_ETA_MIN) + t * (Math.log(RULE_ETA_MAX) - Math.log(RULE_ETA_MIN)),
  );
}

/** η → knob (inverse of ruleEtaFromKnob). */
export function ruleKnobFromEta(eta: number): number {
  const t =
    (Math.log(eta) - Math.log(RULE_ETA_MIN)) /
    (Math.log(RULE_ETA_MAX) - Math.log(RULE_ETA_MIN));
  return Math.round(Math.min(1, Math.max(0, t)) * 1000);
}

/** knob 0..1000 → clip; the left end (v = 0) is OFF (null). */
export function ruleClipFromKnob(v: number): number | null {
  if (v <= 0) return null;
  const t = Math.min(1, Math.max(0, v / 1000));
  return RULE_CLIP_MIN * Math.exp(t * (Math.log(RULE_CLIP_MAX / RULE_CLIP_MIN)));
}

/** clip → knob (0 when off; a positive clip never collapses to knob 0,
 *  because knob 0 IS "off" — the smallest clip parks at knob 1). */
export function ruleKnobFromClip(clip: number | null): number {
  if (clip == null || clip <= 0) return 0;
  const t =
    Math.log(clip / RULE_CLIP_MIN) / Math.log(RULE_CLIP_MAX / RULE_CLIP_MIN);
  return Math.max(1, Math.round(Math.min(1, Math.max(0, t)) * 1000));
}

/* ------------------------------------------------------------------ */
/* The machines (hand-tuned η per landscape, as in the fog game)       */
/* ------------------------------------------------------------------ */

export type MachineKey = "gd" | "mom" | "adam";

export interface MachineSpec {
  key: MachineKey;
  label: string;
  make: () => Optimizer;
}

const MACHINES: Record<RuleLevelId, MachineSpec[]> = {
  bowl: [
    { key: "gd", label: "GD", make: () => gd(0.13) },
    { key: "mom", label: "momentum", make: () => momentum(0.2, 0.9) },
    { key: "adam", label: "Adam", make: () => adam(0.3, 0.9, 0.999, 1e-8) },
  ],
  rosen: [
    { key: "gd", label: "GD", make: () => gd(0.001) },
    { key: "mom", label: "momentum", make: () => momentum(0.001, 0.9) },
    { key: "adam", label: "Adam", make: () => adam(0.05, 0.9, 0.999, 1e-8) },
  ],
  ls: [
    { key: "gd", label: "GD", make: () => gd(0.008) },
    { key: "mom", label: "momentum", make: () => momentum(0.006, 0.9) },
    { key: "adam", label: "Adam", make: () => adam(0.1, 0.9, 0.999, 1e-8) },
  ],
};

/* ------------------------------------------------------------------ */
/* Runs + benchmark                                                    */
/* ------------------------------------------------------------------ */

export interface RuleRun {
  key: MachineKey | "custom";
  label: string;
  /** Parameter-space trajectory (path[0] = the start). */
  path: Vec2[];
  /** Loss at every path point (losses[i] = f(path[i])). */
  losses: number[];
  /** Steps to converge (first i with losses[i] < threshold); null = DNF. */
  steps: number | null;
  /** Loss at the last visited point. */
  finalLoss: number;
}

/** Runs one rule from the level's start; STOPS at convergence (the metric
 *  is steps-to-threshold, and a stopped trail reads cleanly on the surface). */
export function runRuleOn(
  level: RuleLevel,
  opt: Optimizer,
  key: RuleRun["key"],
  label: string,
): RuleRun {
  let state = opt.initState(level.start);
  const path: Vec2[] = [{ ...level.start }];
  const losses: number[] = [level.landscape.f(level.start)];
  let steps: number | null = null;
  for (let i = 1; i <= level.maxSteps; i++) {
    state = opt.step(state, level.landscape.grad(state.pos));
    if (!Number.isFinite(state.pos.x) || !Number.isFinite(state.pos.y)) break;
    path.push({ ...state.pos });
    const L = level.landscape.f(state.pos);
    losses.push(L);
    if (L < level.threshold) {
      steps = i;
      break;
    }
  }
  return {
    key,
    label,
    path,
    losses,
    steps,
    finalLoss: losses[losses.length - 1] ?? level.landscape.f(level.start),
  };
}

export interface RuleBenchmark {
  level: RuleLevelId;
  config: CustomRuleConfig;
  /** The player's rule (purple) — FIRST row of the scoreboard. */
  custom: RuleRun;
  /** GD (red), momentum (blue), Adam (yellow). */
  machines: RuleRun[];
}

/** The full four-way benchmark on one landscape, from the same start. */
export function ruleBenchmark(
  levelId: RuleLevelId,
  config: CustomRuleConfig,
): RuleBenchmark {
  const level = ruleLevelById(levelId);
  const custom = runRuleOn(level, customRule(config), "custom", "your rule");
  const machines = MACHINES[levelId].map((m) =>
    runRuleOn(level, m.make(), m.key, m.label),
  );
  return { level: levelId, config: { ...config }, custom, machines };
}

/** Best (fewest) steps among runs that converged; null when nobody did. */
export function ruleBestSteps(b: RuleBenchmark): number | null {
  const all = [b.custom, ...b.machines];
  const converged = all.filter((r): r is RuleRun & { steps: number } => r.steps !== null);
  if (converged.length === 0) return null;
  return Math.min(...converged.map((r) => r.steps));
}

/** "14" / "DNF" — the scoreboard's steps cell. */
export function ruleFormatSteps(steps: number | null): string {
  return steps === null ? "DNF" : String(steps);
}

/** Monospace-friendly loss formatting (same convention as the fog game). */
export function ruleFormatLoss(loss: number): string {
  // QA GP-3: a rule that blew up overflows f to ±Infinity (or NaN) — the raw
  // number read as a weird value rather than the verdict it is.
  if (!Number.isFinite(loss)) return "diverged";
  if (loss !== 0 && Math.abs(loss) < 0.001) return loss.toExponential(2);
  if (loss >= 100) return loss.toFixed(1);
  return loss.toPrecision(3);
}
