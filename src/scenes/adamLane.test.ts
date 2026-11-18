/**
 * S2-ADAM-2 regression — the §4 side-by-side roll lanes must start from the
 * SAME warm point the inspector reads. The bug class: one lane silently
 * starting from ADAM_POINT (cold) while the other starts from
 * adamWarmState's warmed position — the "GD vs Adam, same start" claim in
 * the copy would be false for its first step.
 *
 * Both lanes and the inspector derive from adamWarmState(steepness): 12
 * Adam steps from ADAM_POINT on the steepness-scaled bowl — so lane[0]
 * must equal adamInspect(steepness).point and must NOT be ADAM_POINT
 * (12 warm steps always move off it).
 */
import { describe, it, expect } from "vitest";
import { runAdamLane, adamInspect, ADAM_POINT } from "./director";

describe("S2-ADAM-2: gd/adam lanes share the inspector's warm start", () => {
  for (const steepness of [1, 50]) {
    it(`steepness ${steepness}: lane[0] === adamInspect().point, not ADAM_POINT`, () => {
      const gdLane = runAdamLane(steepness, "gd");
      const adamLane = runAdamLane(steepness, "adam");
      const warm = adamInspect(steepness).point;

      expect(gdLane.length).toBeGreaterThan(0);
      expect(adamLane.length).toBeGreaterThan(0);

      // The two lanes start identical...
      expect(gdLane[0]).toEqual(adamLane[0]);
      // ...identical to the inspector's ball position...
      expect(gdLane[0]).toEqual(warm);
      expect(adamLane[0]).toEqual(warm);
      // ...and NOT at the cold ADAM_POINT (the warm start moved off it).
      expect(gdLane[0]).not.toEqual(ADAM_POINT);
    });
  }
});
