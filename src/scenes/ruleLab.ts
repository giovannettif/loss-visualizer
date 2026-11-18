/**
 * ruleLab — the pure, deterministic core of §8's optimizer workbench
 * (no DOM, no three), the same discipline as fogGame/tiltGame.
 *
 * Five benchmark landscapes:
 *   "bowl"   — the §2 rotated elongated valley (curvature ratio 50, θ=30°),
 *   "rosen"  — Rosenbrock's banana valley,
 *   "ls"     — the §1 least-squares surface (the §9 tie-back),
 *   "archi"  — the §7 archipelago (ridge-walled island basins; user
 *              feedback 2026-11-17): from this start every blind rule ends
 *              in the shallow skerry, miles above the −4.5 threshold —
 *              the basins lesson, scored,
 *   "canyon" — the §7 canyon peaks (the winding valley + two summits): the
 *              floor guides a steady normalized stride down the whole S.
 *
 * The benchmark: the player's assembled rule (purple) races GD / momentum /
 * Adam from the SAME start, each machine with a hand-tuned η for that
 * landscape (the same honesty as the fog game). Convergence = loss below the
 * level's threshold; the scoreboard is STEPS TO CONVERGE (DNF past 400).
 *
 * The curated config {η 0.5, β 0.9, normalize ON, clip 0.35} — verified
 * numerically against this exact core (tools/tune-rule.mjs +
 * tools/tune-newmaps*.mjs, and locked in ruleLab.test.ts): on Rosenbrock it
 * converges in 14 steps where momentum needs 113, Adam 164 and GD never
 * lands; switch to the bowl and momentum — which it beat 8× — now converges
 * 3× faster; on least squares it finishes last; on the archipelago NOTHING
 * converges, the rule included; on the canyon it wins again in 25 where
 * GD never rounds the west mouth. One rule, five verdicts: no free lunch,
 * experienced.
 *
 * Everything here is state-in/state-out so vitest verifies the benchmark the
 * same way it verifies the math core.
 */

import {
  defaultBowl,
  leastSquares,
  rosenbrock,
  archipelago,
  canyonPeaks,
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

export type RuleLevelId = "bowl" | "rosen" | "ls" | "archi" | "canyon";

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
  {
    id: "archi",
    name: "archipelago",
    bet: "rewards starting in the right basin",
    landscape: archipelago,
    // Open water on the archipelago's south-east plain, f ≈ 1.0: every
    // blind rule from here funnels into the shallow skerry (f ≈ −0.5) or
    // crawls on the plain — miles above the −4.5 threshold, which only the
    // blue hole (−5.33) or the deep atoll (−8.03) could meet. The basins
    // lesson, scored: WHERE you start decides more than HOW you step.
    // (Tuned with tools/tune-newmaps*.mjs; locked in ruleLab.test.ts.)
    start: { x: 4.6, y: -2.6 },
    threshold: -4.5,
    maxSteps: 400,
  },
  {
    id: "canyon",
    name: "canyon peaks",
    bet: "rewards a steady normalized stride",
    landscape: canyonPeaks,
    // On the canyon floor at the west mouth (on the path y = g(x)), f ≈ 30.
    // The threshold 2.0 sits just above the gate floor (≈ 0.06 + peak
    // tails along the last stretch): convergence means riding the winding
    // groove most of the way to the sea gate.
    start: { x: -2.9, y: 1.1168362202947417 },
    threshold: 2.0,
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

/** Slider ranges (main.ts maps knob 0..1000 ↔ these, log where noted).
 *  η floor 0.001 = Rosenbrock's tuned GD/momentum η, so the §8 dial reaches
 *  the machines' value and the parts-off equivalence is checkable live
 *  (QA GP-3). */
export const RULE_ETA_MIN = 0.001;
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
  // Archipelago: the walls cap every usable η (wall curvature reaches
  // 2h/sW² ≈ 36), and from this start even a well-tuned rule funnels into
  // the skerry — all three machines DNF above the −4.5 threshold (locked).
  archi: [
    { key: "gd", label: "GD", make: () => gd(0.01) },
    { key: "mom", label: "momentum", make: () => momentum(0.05, 0.9) },
    { key: "adam", label: "Adam", make: () => adam(0.12, 0.9, 0.999, 1e-8) },
  ],
  // Canyon peaks: the walls' curvature 2B = 16 (plus the peak flanks ≈ 83)
  // caps GD under 2/83; momentum 0.008 rides the groove to the gate in 38
  // steps, Adam needs 160, GD never rounds the west mouth (locked).
  canyon: [
    { key: "gd", label: "GD", make: () => gd(0.002) },
    { key: "mom", label: "momentum", make: () => momentum(0.008, 0.9) },
    { key: "adam", label: "Adam", make: () => adam(0.05, 0.9, 0.999, 1e-8) },
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

/**
 * The DRAWABLE prefix of a run's path (QA S8-DIVERGE-STREAKS). A diverged
 * custom rule keeps finite-but-huge points (1e25…1e306) that overflow the
 * Float32 line buffers to ±Infinity (NaN bounding sphere) or draw full-height
 * streaks across the plot. The display path keeps points while they are
 * finite, inside the landscape EXTENT (the mesh edge; `marginFrac` grows it
 * per side, default 0), and have finite f; at the first failing point with
 * finite coordinates the segment from the last kept point is cut exactly at
 * the box edge — the trail ends ON the terrain rim, the same as §2's
 * clipPathToExtent (QA F27-DIVERGE-PAST-EXTENT / S8SW2-DIVERGE-NEEDLE-PAST-
 * EXTENT / SW2-S8-DIVERGED-TRAIL-PAST-EXTENT: a +10% box left the last point
 * off the mesh with a huge f — a needle into the void).
 * The raw RuleRun (losses, steps, finalLoss) is untouched — the scoreboard
 * still reports "diverged"/DNF. path[0] is the level start, so the result is
 * never empty; well-behaved runs come back unchanged.
 */
export function ruleDisplayPath(
  level: RuleLevel,
  path: readonly Vec2[],
  marginFrac = 0,
): Vec2[] {
  const e = level.landscape.extent;
  const mx = (e.xMax - e.xMin) * marginFrac;
  const my = (e.yMax - e.yMin) * marginFrac;
  const box = { x0: e.xMin - mx, x1: e.xMax + mx, y0: e.yMin - my, y1: e.yMax + my };
  const inside = (p: Vec2): boolean =>
    Number.isFinite(p.x) && Number.isFinite(p.y) &&
    p.x >= box.x0 && p.x <= box.x1 && p.y >= box.y0 && p.y <= box.y1 &&
    Number.isFinite(level.landscape.f(p));
  const out: Vec2[] = [];
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    if (inside(p)) {
      out.push({ ...p });
      continue;
    }
    const prev = out[out.length - 1];
    if (prev && Number.isFinite(p.x) && Number.isFinite(p.y)) {
      // Parametric cut of prev→p at the box: the largest t in [0, 1] that
      // keeps every coordinate inside (prev is inside, so t ≥ 0 exists).
      const dx = p.x - prev.x;
      const dy = p.y - prev.y;
      let t = 1;
      if (dx > 0) t = Math.min(t, (box.x1 - prev.x) / dx);
      else if (dx < 0) t = Math.min(t, (box.x0 - prev.x) / dx);
      if (dy > 0) t = Math.min(t, (box.y1 - prev.y) / dy);
      else if (dy < 0) t = Math.min(t, (box.y0 - prev.y) / dy);
      t = Math.max(0, t);
      // Clamped into the box: with a zero margin the cut lies ON the
      // boundary, and rounding must not drop the exit point.
      const edge = {
        x: Math.min(box.x1, Math.max(box.x0, prev.x + dx * t)),
        y: Math.min(box.y1, Math.max(box.y0, prev.y + dy * t)),
      };
      if (inside(edge) && (edge.x !== prev.x || edge.y !== prev.y)) out.push(edge);
    }
    break;
  }
  if (out.length === 0) out.push({ ...level.start });
  return out;
}

/**
 * Exact cache identity of a benchmark (QA S8SW2-VERDICT-CACHE-STALE /
 * S8-SWEEP2-STALE-VERDICT): same key ⇒ the same runs ⇒ the same verdict.
 * Number#toString round-trips doubles exactly, so knobs 822 and 823 (both
 * labelled "η 0.52") never collide the way the rounded parts label did.
 */
export function ruleVerdictKey(level: RuleLevelId, c: CustomRuleConfig): string {
  return `${level}|${c.lr}|${c.beta}|${c.normalize ? 1 : 0}|${c.clip ?? "off"}`;
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
  // QA S8-HUGE-LOSS-FORMAT: a FINITE blow-up (the valley's 4.13e50) fell
  // through to toFixed(1), printing every integer digit (or the raw
  // full-precision exponential) and wrapping the scoreboard row. Keep the
  // number honest but compact.
  if (Math.abs(loss) >= 1e5) return loss.toExponential(1);
  if (loss >= 100) return loss.toFixed(1);
  return loss.toPrecision(3);
}

/** What triggered the latest benchmark rebuild: a landscape pill, a part
 *  move, or nothing yet (scene entry). */
export type RuleChangeCause = "level" | "part" | null;

/** True when the custom rule has the best (fewest) converged step count. */
export function ruleCustomWins(b: RuleBenchmark): boolean {
  return b.custom.steps !== null && b.custom.steps === ruleBestSteps(b);
}

/**
 * The scoreboard's one-line read of WHO won — naming the RIGHT cause
 * (QA S8-VERDICT-WRONG-CAUSE): a part change on an unchanged landscape must
 * never claim "a different landscape", and "flips" is only true when the
 * rule was winning before the landscape changed. Scoreboard tokens ("DNF")
 * never leak into prose.
 */
export function ruleVerdictSentence(
  b: RuleBenchmark,
  cause: RuleChangeCause,
  prevCustomWon: boolean,
): string {
  const level = ruleLevelById(b.level);
  const custom = b.custom;
  const byFewestSteps = (x: RuleRun, y: RuleRun): number =>
    (x.steps ?? Infinity) - (y.steps ?? Infinity);
  if (ruleCustomWins(b)) {
    const runnerUp = b.machines.filter((m) => m.steps !== null).sort(byFewestSteps)[0];
    const tail = runnerUp
      ? `${runnerUp.label} needed ${ruleFormatSteps(runnerUp.steps)}.`
      : "no optimizer converged at all.";
    return `Your rule wins ${level.name}: ${custom.steps} steps — ${tail} On this landscape, the bet pays off.`;
  }
  const winner = b.machines.filter((m) => m.steps !== null).sort(byFewestSteps)[0] ?? null;
  if (!winner) {
    return `Nothing converges below L ${ruleFormatLoss(level.threshold)} within ${level.maxSteps} steps — including your rule.`;
  }
  const ruleTail =
    custom.steps === null ? "your rule did not converge" : `your rule needed ${custom.steps}`;
  const head = `${winner.label} wins ${level.name} in ${winner.steps} steps; ${ruleTail}.`;
  const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
  if (cause === "level") {
    return prevCustomWon
      ? `The verdict flips: ${head} Same rule — a different landscape, a different ranking.`
      : `${cap(head)} Same rule — a different landscape, still not its landscape.`;
  }
  return `${cap(head)} Same landscape — these parts lose here.`;
}
