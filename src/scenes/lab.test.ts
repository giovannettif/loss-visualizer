/**
 * §5 disagreement-lab checklist probes — the "always → Adam's step is
 * near-invariant" row must stay lit across the WHOLE slider square (the copy
 * at index.html claims Adam's step is "almost invariant to everything the
 * two sliders do"), while still separating Adam from GD and momentum.
 *
 * Slider mapping mirrors main.ts: elongation t∈[0,1] → E = 10^(t·log10 50),
 * rotation t∈[0,1] → θ = 90·t degrees.
 */

import { describe, it, expect } from "vitest";
import { labChecks, labAdamEarlyRef } from "./director";

const E_OF = (v: number): number => Math.pow(10, (v / 1000) * Math.log10(50));
const ROT_OF = (v: number): number => (v / 1000) * 90;

describe("lab invariance probe (SEC5-INVARIANT-ALWAYS-BAND)", () => {
  it("the round-bowl reference is Adam's mean early step (≈ 0.3896)", () => {
    expect(labAdamEarlyRef()).toBeCloseTo(0.3896, 3);
  });

  it("stays lit at the three reported repro points", () => {
    // elong=300 (×3.2, 30°) and E=50 at rot=60.03° were dark under the old
    // within-run max/min metric; elong=200 (×2.2) was lit.
    for (const [E, rot] of [
      [E_OF(300), 30],
      [E_OF(200), 30],
      [50, ROT_OF(667)],
    ] as const) {
      const c = labChecks(E, rot);
      expect(c.invariant).toBe(true);
      expect(c.adamInvariant).toBeLessThan(1.6);
    }
  });

  it("stays lit over the full slider square (every 50 slider units)", () => {
    let worst = 0;
    for (let ve = 0; ve <= 1000; ve += 50) {
      for (let vr = 0; vr <= 1000; vr += 50) {
        const c = labChecks(E_OF(ve), ROT_OF(vr));
        worst = Math.max(worst, c.adamInvariant);
        expect(c.invariant).toBe(true);
      }
    }
    expect(worst).toBeGreaterThanOrEqual(1); // max(r, 1/r) is never below 1
    expect(worst).toBeLessThan(1.6);
  });
});
