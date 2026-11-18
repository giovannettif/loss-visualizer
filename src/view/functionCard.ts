/**
 * functionCard — content builders for the docked function card (#func-card),
 * the fog-reveal's "the actual function with its parameters" pattern carried
 * to every other section.
 *
 * PURE: every builder returns { title, math, values } — title is plain text,
 * math is a static HTML string styled with the page's hand-styled formula
 * primitives (COPY-PLAN §3, Option B: .sum / .frac / <sub> / <sup>, serif
 * italic via the consumer's .math class; no KaTeX), and values is the
 * monospace live-parameter line. No DOM access here — the director owns the
 * element and writes on change; tests assert the strings directly.
 *
 * Numerical honesty contract: every constant printed here is the SAME
 * literal the math core uses (functions.ts — makeBowl's λs, rosenbrock's
 * a=1/b=100, rastrigin's A=10, the multi-well bowl/ripple constants,
 * archipelago's rim constants, canyon's A/B/WIND/WIND_K/PARAB, the 12
 * least-squares points). The card can never drift from the terrain because
 * the terrain is literally defined by these constants.
 */

export interface FuncCardContent {
  /** The small caption row (landscape name + context). */
  title: string;
  /** The formula (HTML; trusted static strings built from literals). */
  math: string;
  /** The live parameter line (plain text; the consumer renders it mono). */
  values: string;
}

/** "1.00" / "−0.02" — two decimals with a real minus sign. */
function fmt2(v: number): string {
  return `${v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}`;
}

/** "−36°" / "30°". */
function fmtDeg(deg: number): string {
  return `${deg < 0 ? "−" : ""}${Math.abs(Math.round(deg))}°`;
}

/**
 * One "key = value" readout pair, made unbreakable: the values line may
 * wrap (a narrow pane band caps the card), but only AT the "·" separators —
 * a pair like "λmax = 2λ₁ = 2.00" never splits after the key. The director's
 * values strings use it too (exported for that).
 */
export function nbp(pair: string): string {
  return pair.replace(/ /g, "\u00A0");
}

/** Joins readout pairs with breakable "·" separators. */
export function pairsJoin(...pairs: string[]): string {
  return pairs.map(nbp).join(" · ");
}

/** "λmax = 2λ₁ = 4.00" — the Hessian eigenvalue the §2 copy's η thresholds
 *  are stated against (gd-c: "On this landscape λ_max = 2"). */
function lambdaMax(l1: number): string {
  return `λmax = 2λ₁ = ${fmt2(2 * l1)}`;
}

/* ------------------------------------------------------------------ */
/* The rotated elongated bowl (§2 gd, §3 mom, §4 adam, §5 lab, §8 bowl) */
/* ------------------------------------------------------------------ */

/**
 * f = zᵀAz with A = R·diag(λ₁, λ₂)·Rᵀ, shown in the principal-axis frame:
 * the quadratic in the rotated coordinates plus the rotation that defines
 * them. (u, v) = Rᵀ(φ)·(x, y) — u/v are the coordinates ALONG the bowl's
 * two principal axes, exactly the frame the zigzag/glide story is told in.
 */
export function bowlCard(
  lambda1: number,
  lambda2: number,
  phiDeg: number,
  title: string,
  values?: string,
): FuncCardContent {
  return {
    title,
    math:
      "L(x, y) = λ₁u² + λ₂v²" +
      "<br>(u, v) = R<sup>T</sup>(φ)&thinsp;(x, y)",
    values:
      values ??
      pairsJoin(
        `λ₁ = ${fmt2(lambda1)}`,
        `λ₂ = ${fmt2(lambda2)}`,
        `φ = ${fmtDeg(phiDeg)}`,
        lambdaMax(lambda1),
      ),
  };
}

/* ------------------------------------------------------------------ */
/* Rosenbrock (§6 level-2 reveal, §7 level 2, §8 rosen pill)            */
/* ------------------------------------------------------------------ */

export function rosenbrockCard(title: string, values?: string): FuncCardContent {
  return {
    title,
    math: "L(x, y) = (1 − x)² + 100·(y − x²)²",
    values: values ?? pairsJoin("a = 1", "b = 100", "global min (1, 1)"),
  };
}

/* ------------------------------------------------------------------ */
/* Least squares (§6 level-1 reveal, §8 ls pill)                        */
/* ------------------------------------------------------------------ */

/** The F1/F2 styled form: the stacked Σ carries the real 12-point count. */
export function leastSquaresCard(title: string, values?: string): FuncCardContent {
  return {
    title,
    math:
      "L(w, b) = " +
      '<span class="sum"><span class="sum-n">12</span>' +
      '<span class="sum-sym">Σ</span><span class="sum-sub">i=1</span></span>' +
      " (w·x<sub>i</sub> + b − y<sub>i</sub>)²",
    values: values ?? pairsJoin("12 points", "global min (0.909, 1.306)"),
  };
}

/* ------------------------------------------------------------------ */
/* Rastrigin (§7 level 3)                                               */
/* ------------------------------------------------------------------ */

export function rastriginCard(title: string, values?: string): FuncCardContent {
  return {
    title,
    math: "L(x, y) = 20 + x² + y² − 10·(cos&thinsp;2πx + cos&thinsp;2πy)",
    values: values ?? pairsJoin("A = 10", "global min (0, 0) at L 20"),
  };
}

/* ------------------------------------------------------------------ */
/* Archipelago (§7 level 4 + swarm archi pill, §8 archi pill)           */
/* ------------------------------------------------------------------ */

/**
 * The functions.ts:430-437 form, compacted: the drain bowl + sextic rim,
 * minus the eight Gaussian island wells, plus the six Gaussian strait
 * ridges — u/t are each feature's rotated local coordinates. The counts in
 * the values line come from the well/ridge lists, never hand-typed.
 */
export function archipelagoCard(
  title: string,
  wells: number,
  ridges: number,
  values?: string,
): FuncCardContent {
  return {
    title,
    math:
      "L(p) = 0.03‖p‖² + 10<sup>−5</sup>‖p‖⁶" +
      "<br>− Σ<sub>i</sub>&thinsp;d<sub>i</sub>·e<sup>−u²/a² − t²/b²</sup>" +
      " + Σ<sub>j</sub>&thinsp;h<sub>j</sub>·e<sup>−u²/s²L − t²/s²W</sup>",
    values:
      values ??
      pairsJoin(
        `${wells} island wells`,
        `${ridges} strait ridges`,
        "global min (−4.6, 3.9)",
      ),
  };
}

/* ------------------------------------------------------------------ */
/* Canyon peaks (§7 level 5, §8 canyon pill)                            */
/* ------------------------------------------------------------------ */

/** The floor's winding path g(x) gets its own row — the formula names it. */
export function canyonCard(title: string, peaks: number, values?: string): FuncCardContent {
  return {
    title,
    math:
      "L(x, y) = (2.6 − x)² + 8·(y − g(x))²" +
      "<br>+ Σ<sub>k</sub>&thinsp;p<sub>k</sub>·e<sup>−‖p−c‖²/s²</sup>" +
      "<br>g(x) = 1.5·sin(1.05x) + 0.15x²",
    values:
      values ??
      pairsJoin(`${peaks} summits`, "global min ≈ (2.6, 1.614)"),
  };
}

/* ------------------------------------------------------------------ */
/* Multi-well countries (§7 swarm: multi-well, multi-well large)        */
/* ------------------------------------------------------------------ */

/** The makeMultiWell form (functions.ts:214-223): rim + ripple − Σ wells.
 *  The census line (SWARM_MAPS) IS the values line — it already carries the
 *  well count ("6 wells · one deep global canyon"), so no double-counting. */
export function multiWellCard(title: string, census: string): FuncCardContent {
  return {
    title,
    math:
      "L(p) = 0.05‖p‖² + 0.02·sin(1.6x)·sin(1.6y)" +
      "<br>− Σ<sub>i</sub>&thinsp;d<sub>i</sub>·e<sup>−u²/a² − t²/b²</sup>",
    values: census,
  };
}

/* ------------------------------------------------------------------ */
/* Himmelblau (§7 swarm himmelblau pill)                                */
/* ------------------------------------------------------------------ */

export function himmelblauCard(title: string, values?: string): FuncCardContent {
  return {
    title,
    math: "L(x, y) = (x² + y − 11)² + (x + y² − 7)²",
    values: values ?? pairsJoin("four pits", "all four are GLOBAL minima at L 0"),
  };
}
