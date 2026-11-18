/**
 * Step-clock sampler (QA SEC5-S2-REPLAY-TRAIL-LEAD / S8SW2-RACE-
 * SIMULTANEOUS-ARRIVAL).
 */
import { describe, expect, it } from "vitest";
import { samplePathAtStep } from "./trajectoryPlayer";

describe("samplePathAtStep", () => {
  const path = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 1 },
    { x: 12, y: 1 },
  ];
  it("integer steps land exactly on the path's points", () => {
    path.forEach((p, k) => expect(samplePathAtStep(path, k)).toEqual(p));
  });
  it("past the end the ball rests at its last point", () => {
    expect(samplePathAtStep(path, 99)).toEqual(path[3]);
  });
  it("half a step is the segment midpoint (smoothstep(0.5) = 0.5)", () => {
    expect(samplePathAtStep(path, 0.5)).toEqual({ x: 5, y: 0 });
    expect(samplePathAtStep(path, 2.5)).toEqual({ x: 11, y: 1 });
  });
  it("every step takes the same time, however long it is", () => {
    // The 10-unit first step and the 1-unit second step each take one step.
    expect(samplePathAtStep(path, 1.0).x).toBe(10);
    expect(samplePathAtStep(path, 1.5)).toEqual({ x: 10, y: 0.5 });
  });
  it("degenerate paths", () => {
    expect(samplePathAtStep([], 3)).toEqual({ x: 0, y: 0 });
    expect(samplePathAtStep([{ x: 2, y: 3 }], 0.4)).toEqual({ x: 2, y: 3 });
  });
});
