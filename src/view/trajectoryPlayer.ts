/**
 * TrajectoryPlayer — the universal play system's animation driver.
 *
 * Pure timing, no rendering: the director consumes update()'s eased
 * progress and places balls/trails along the path. Speed multiplies the
 * wall-clock (0.5× / 1× / 2×).
 *
 * Motion is "eased per step": progress is arc-length parameterized over the
 * path and each step's local fraction is smoothstepped, so the ball brakes
 * into and accelerates out of every optimizer step — the stop-and-go of
 * gradient descent, embodied.
 */

import type { Vec2 } from "../core/functions";

/** Cumulative arc lengths of a polyline (parallel to its points). */
export function cumulativeLengths(path: readonly Vec2[]): {
  total: number;
  cum: number[];
} {
  const cum: number[] = [0];
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
    cum.push(total);
  }
  return { total, cum };
}

const smooth = (u: number): number => u * u * (3 - 2 * u);

/**
 * Position at progress p ∈ [0,1]: arc-length parameterized, smoothstepped
 * within each step so motion eases per step.
 */
export function samplePath(path: readonly Vec2[], p: number): Vec2 {
  if (path.length === 0) return { x: 0, y: 0 };
  if (path.length === 1) return { ...path[0] };
  const { total, cum } = cumulativeLengths(path);
  if (total <= 1e-9) return { ...path[0] };
  const d = Math.min(1, Math.max(0, p)) * total;
  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i++;
  const seg = cum[i] - cum[i - 1] || 1;
  const u = smooth(Math.min(1, Math.max(0, (d - cum[i - 1]) / seg)));
  const a = path[i - 1];
  const b = path[i];
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
}

export class TrajectoryPlayer {
  private tSec = 0;
  private playing = false;

  constructor(
    private readonly durationSec: number,
    private speed = 1,
  ) {}

  /** Starts from the beginning (a second press while playing = replay). */
  play(): void {
    this.tSec = 0;
    this.playing = true;
  }

  /** Halts at the current position (resume continues from here). */
  pause(): void {
    this.playing = false;
  }

  /** Continues from the paused position (no-op when already finished). */
  resume(): void {
    if (!this.finishedOnce) this.playing = true;
  }

  /** Parks the player at an absolute progress fraction 0..1 (scrubbing). */
  setFraction(f: number): void {
    this.tSec = Math.min(1, Math.max(0, f)) * this.durationSec;
  }

  setSpeed(speed: number): void {
    this.speed = speed;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /** Elapsed fraction 0..1 regardless of playing state. */
  getElapsedFraction(): number {
    return Math.min(1, Math.max(0, this.tSec / this.durationSec));
  }

  get finishedOnce(): boolean {
    return this.tSec >= this.durationSec;
  }

  /**
   * Advances by dtSec of wall clock (scaled by speed). Returns the eased
   * progress 0..1, or null when idle. 1 is returned exactly once on the
   * finishing frame.
   */
  update(dtSec: number): number | null {
    if (!this.playing) return null;
    this.tSec = Math.min(this.durationSec, this.tSec + dtSec * this.speed);
    const raw = this.tSec / this.durationSec;
    if (raw >= 1) {
      this.playing = false;
      return 1;
    }
    return raw;
  }
}
