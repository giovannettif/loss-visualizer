/**
 * functionCard tests — the docked function card's content builders.
 *
 * The card's contract is numerical honesty with the math core: every
 * constant printed in the formula/values strings must be the literal the
 * landscape is DEFINED by (functions.ts), and the styled spans must use the
 * page's hand-styled formula primitives (COPY-PLAN §3, Option B) so the
 * card reads like every other formula on the page. These tests pin both.
 */
import { describe, expect, it } from "vitest";
import {
  archipelagoCard,
  bowlCard,
  canyonCard,
  himmelblauCard,
  leastSquaresCard,
  multiWellCard,
  nbp,
  rastriginCard,
  rosenbrockCard,
} from "./functionCard";

/** The builders nbsp-join each "key = value" pair (the values line wraps
 *  only at the "·" separators) — normalize for the plain-text assertions. */
const vals = (card: { values: string }): string => card.values.replace(/\u00A0/g, " ");
import {
  ARCHIPELAGO_RIDGES,
  ARCHIPELAGO_WELLS,
  CANYON_A,
  CANYON_B,
  CANYON_PEAKS,
  CANYON_WIND,
  CANYON_WIND_K,
  CANYON_PARAB,
  LEAST_SQUARES_POINTS,
  MULTI_WELL_WELLS,
} from "../core/functions";

describe("functionCard builders — constants match the math core", () => {
  it("bowlCard prints the live λ₁/λ₂/φ with the Hessian λmax = 2λ₁", () => {
    const card = bowlCard(1, 0.02, 30, "test landscape");
    expect(vals(card)).toContain("λ₁ = 1.00");
    expect(vals(card)).toContain("λ₂ = 0.02");
    expect(vals(card)).toContain("φ = 30°");
    // gd-c's copy states the η thresholds against λmax = 2 on this bowl —
    // the card must agree (2λ₁ = 2).
    expect(vals(card)).toContain("λmax = 2λ₁ = 2.00");
  });

  it("bowlCard formats negative rotation and fractional λ like the mom bowl", () => {
    const card = bowlCard(1, 0.02, -36, "mom bowl");
    expect(vals(card)).toContain("φ = −36°");
  });

  it("rosenbrockCard carries a = 1, b = 100 (functions.ts rosenbrock)", () => {
    const card = rosenbrockCard("rosenbrock");
    expect(card.math).toContain("(1 − x)²");
    expect(card.math).toContain("100·(y − x²)²");
    expect(vals(card)).toContain("a = 1");
    expect(vals(card)).toContain("b = 100");
  });

  it("leastSquaresCard stacks the Σ with the REAL point count (12)", () => {
    const card = leastSquaresCard("least squares");
    expect(card.math).toContain('<span class="sum">');
    expect(card.math).toContain('<span class="sum-n">12</span>');
    expect(card.math).toContain("(w·x<sub>i</sub> + b − y<sub>i</sub>)²");
    expect(LEAST_SQUARES_POINTS).toHaveLength(12);
  });

  it("rastriginCard carries A = 10 and the f = 20 global floor", () => {
    const card = rastriginCard("rastrigin");
    expect(card.math).toContain("20 + x² + y² − 10·");
    expect(vals(card)).toContain("A = 10");
    expect(vals(card)).toContain("L 20");
  });

  it("archipelagoCard counts wells/ridges from the lists, never hand-typed", () => {
    const card = archipelagoCard(
      "archipelago",
      ARCHIPELAGO_WELLS.length,
      ARCHIPELAGO_RIDGES.length,
    );
    expect(vals(card)).toContain(`${ARCHIPELAGO_WELLS.length} island wells`);
    expect(vals(card)).toContain(`${ARCHIPELAGO_RIDGES.length} strait ridges`);
    expect(card.math).toContain("0.03‖p‖²");
    expect(card.math).toContain("10<sup>−5</sup>‖p‖⁶");
  });

  it("canyonCard's g(x) and constants match the canyon core", () => {
    const card = canyonCard("canyon", CANYON_PEAKS.length);
    // g(x) = WIND·sin(WIND_K·x) + PARAB·x², with functions.ts literals.
    expect(card.math).toContain(
      `g(x) = ${CANYON_WIND}·sin(${CANYON_WIND_K}x) + ${CANYON_PARAB}x²`,
    );
    expect(card.math).toContain(`(${CANYON_A} − x)²`);
    expect(card.math).toContain(`${CANYON_B}·(y − g(x))²`);
    expect(vals(card)).toContain(`${CANYON_PEAKS.length} summits`);
  });

  it("multiWellCard's values line IS the swarm census (no double count)", () => {
    const card = multiWellCard("multi-well", "6 wells · one deep global canyon");
    expect(vals(card)).toBe("6 wells · one deep global canyon");
    expect(card.math).toContain("0.05‖p‖²");
    expect(card.math).toContain("sin(1.6x)·sin(1.6y)");
    expect(MULTI_WELL_WELLS).toHaveLength(6);
  });

  it("himmelblauCard names the four equal global pits", () => {
    const card = himmelblauCard("himmelblau");
    expect(card.math).toContain("(x² + y − 11)² + (x + y² − 7)²");
    expect(vals(card)).toContain("four pits");
    expect(vals(card)).toContain("GLOBAL");
  });
});

describe("functionCard builders — styled-span discipline", () => {
  it("math strings use only the page's formula primitives", () => {
    const cards = [
      bowlCard(1, 0.02, 30, "b"),
      rosenbrockCard("r"),
      leastSquaresCard("ls"),
      rastriginCard("ra"),
      archipelagoCard("ar", 8, 6),
      canyonCard("c", 2),
      multiWellCard("mw", "census"),
      himmelblauCard("h"),
    ];
    for (const card of cards) {
      // Serif-italic styling is the consumer's .math class; the strings
      // themselves stay span/sub/sup-based — no KaTeX, no images, no <img>.
      expect(card.math).not.toMatch(/<img|<svg|katex/i);
      // Real minus signs (U+2212) in the MATH TEXT — no ASCII hyphens
      // posing as minus, matching every other formula on the page. (The
      // .sum/.frac class attributes legitimately contain hyphens, so strip
      // the tags before checking.)
      const text = card.math.replace(/<[^>]+>/g, "");
      expect(text.includes("-")).toBe(false);
    }
  });

  it("values lines are plain text (no HTML) — the consumer renders them mono", () => {
    const cards = [
      bowlCard(7.07, 0.14, 30, "lab"),
      rosenbrockCard("r", "converge < L 1.0 · start (−1.2, 1.44)"),
      leastSquaresCard("ls"),
      rastriginCard("ra"),
      archipelagoCard("ar", 8, 6),
      canyonCard("c", 2),
      multiWellCard("mw", "9 wells over a wider country"),
      himmelblauCard("h"),
    ];
    for (const card of cards) {
      expect(vals(card)).not.toMatch(/<[^>]+>/);
    }
  });

  it("pairs are nbsp-joined, so a narrow band wraps only at the · separators", () => {
    const card = bowlCard(1, 0.02, 30, "t");
    // Each "key = value" pair is one unbreakable unit…
    expect(card.values).toContain(nbp("φ = 30°"));
    expect(card.values).toContain(nbp("λ₁ = 1.00"));
    // …joined by breakable " · " separators.
    expect(card.values).toContain(" \u00B7 ");
  });
});
