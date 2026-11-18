/**
 * FitPreview — the §1 fit task as a 2D plot inset (HTML canvas).
 *
 * 12 hardcoded data points, the current line y = w·x + b (Manim blue), and
 * the red residual segments. The line is draggable: grab the BODY to slide
 * the intercept b, grab an END HANDLE to pivot the slope w about the other
 * end. Every change is reported through onFitChange so the director can keep
 * the loss readout, the 3D point and the compass minimap in lockstep.
 */

import { LEAST_SQUARES_POINTS } from "../core/functions";

/** Plot window in data coordinates (covers the dataset with air). */
const X_MIN = -4.2;
const X_MAX = 4.6;
const Y_MIN = -2.1;
const Y_MAX = 5.7;

/** Parameter clamp = the least-squares landscape extent (director's world). */
const W_MIN = -1;
const W_MAX = 3;
const B_MIN = -3;
const B_MAX = 5;

/** Line-end x positions (data space) for the two drag handles. */
const HANDLE_X0 = -3.7;
const HANDLE_X1 = 4.1;

const M = { l: 30, r: 12, t: 10, b: 22 }; // canvas margins

const HIT_PX = 11; // handle grab radius
const LINE_HIT_PX = 10; // body grab distance from the line

type DragMode = "body" | "left" | "right" | null;

export interface FitPreviewOptions {
  /** Called on every drag delta with the new (clamped) parameters. */
  onFitChange: (w: number, b: number) => void;
}

export class FitPreview {
  private readonly ctx: CanvasRenderingContext2D;
  /** Live CSS size of the canvas (re-measured on resize — see measure()). */
  private w: number;
  private h: number;

  private fit = { w: 0, b: 0 };
  /** False = read-only inset (fog-a tracks the fog point; QA COV22-1). */
  private interactive = true;
  private mode: DragMode = null;
  private hover: DragMode = null;
  private grabStartY = 0;
  private grabFrom = { w: 0, b: 0 };

  private readonly resizeObserver: ResizeObserver | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly opts: FitPreviewOptions,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("FitPreview: no 2d context");
    this.ctx = ctx;
    const rect = canvas.getBoundingClientRect();
    this.w = rect.width || 320;
    this.h = rect.height || 240;
    this.applyBackingStore();

    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("pointerup", this.onUp);
    canvas.addEventListener("pointercancel", this.onUp);
    canvas.addEventListener("pointerleave", this.onLeave);
    // The ≤1100px media query (and vw-based sizing below ~867px) shrinks
    // #fit-canvas after boot; the inset must follow its live CSS size or the
    // pointer mapping keeps the stale boot geometry (same re-measure pattern
    // as CompassMinimap). The ResizeObserver also covers late layout.
    window.addEventListener("resize", this.onResize);
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(this.onResize);
      this.resizeObserver.observe(canvas);
    }

    this.draw();
  }

  /** Read-only vs draggable (the inset only owns the fit in §1). */
  setInteractive(on: boolean): void {
    if (on === this.interactive) return;
    this.interactive = on;
    if (!on) {
      this.mode = null;
      this.hover = null;
      this.canvas.style.cursor = "default";
    }
    this.draw();
  }

  /** Updates the fitted parameters and redraws (called by the director). */
  setFit(w: number, b: number): void {
    this.fit = { w, b };
    this.draw();
  }

  dispose(): void {
    const c = this.canvas;
    c.removeEventListener("pointerdown", this.onDown);
    c.removeEventListener("pointermove", this.onMove);
    c.removeEventListener("pointerup", this.onUp);
    c.removeEventListener("pointercancel", this.onUp);
    c.removeEventListener("pointerleave", this.onLeave);
    window.removeEventListener("resize", this.onResize);
    this.resizeObserver?.disconnect();
  }

  /* ---------------- sizing ---------------- */

  /**
   * Allocates the backing store for the current CSS size (DPR-capped at 2).
   * Setting canvas.width resets the context state, so the transform is
   * applied AFTER the resize.
   */
  private applyBackingStore(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /**
   * Re-reads the canvas CSS size; returns true when it changed and the
   * backing store was reallocated. Zero dimensions never replace a good
   * size (a hidden canvas must not clobber the last known geometry).
   */
  private measure(): boolean {
    const r = this.canvas.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    if (
      Math.round(r.width) === Math.round(this.w) &&
      Math.round(r.height) === Math.round(this.h)
    ) {
      return false;
    }
    this.w = r.width;
    this.h = r.height;
    this.applyBackingStore();
    return true;
  }

  private readonly onResize = (): void => {
    if (this.measure()) this.draw();
  };

  /* ---------------- coordinate mapping ---------------- */

  private px(x: number): number {
    return M.l + ((x - X_MIN) / (X_MAX - X_MIN)) * (this.w - M.l - M.r);
  }
  private py(y: number): number {
    return this.h - M.b - ((y - Y_MIN) / (Y_MAX - Y_MIN)) * (this.h - M.t - M.b);
  }
  private dataY(dyPx: number): number {
    // Canvas y grows downward; data y grows up.
    return (-dyPx / (this.h - M.t - M.b)) * (Y_MAX - Y_MIN);
  }

  /* ---------------- interaction ---------------- */

  private hitMode(mx: number, my: number): DragMode {
    const yL = this.py(this.fit.w * HANDLE_X0 + this.fit.b);
    const yR = this.py(this.fit.w * HANDLE_X1 + this.fit.b);
    if (Math.hypot(mx - this.px(HANDLE_X0), my - yL) <= HIT_PX) return "left";
    if (Math.hypot(mx - this.px(HANDLE_X1), my - yR) <= HIT_PX) return "right";
    if (mx >= this.px(HANDLE_X0) && mx <= this.px(HANDLE_X1)) {
      const xData = X_MIN + ((mx - M.l) / (this.w - M.l - M.r)) * (X_MAX - X_MIN);
      if (Math.abs(my - this.py(this.fit.w * xData + this.fit.b)) <= LINE_HIT_PX) {
        return "body";
      }
    }
    return null;
  }

  private onDown = (e: PointerEvent): void => {
    if (!this.interactive) return;
    const rect = this.canvas.getBoundingClientRect();
    const mode = this.hitMode(e.clientX - rect.left, e.clientY - rect.top);
    if (!mode) return;
    this.mode = mode;
    this.grabStartY = e.clientY;
    this.grabFrom = { ...this.fit };
    this.canvas.setPointerCapture(e.pointerId);
    this.canvas.style.cursor = "grabbing";
    e.preventDefault();
  };

  private onMove = (e: PointerEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (!this.mode) {
      if (!this.interactive) return;
      const hover = this.hitMode(mx, my);
      if (hover !== this.hover) {
        this.hover = hover;
        this.canvas.style.cursor = hover ? "grab" : "default";
        this.draw();
      }
      return;
    }

    const dy = this.dataY(e.clientY - this.grabStartY);
    const { w: w0, b: b0 } = this.grabFrom;
    let w = w0;
    let b = b0;
    if (this.mode === "body") {
      b = clamp(b0 + dy, B_MIN, B_MAX);
    } else if (this.mode === "left") {
      // Pivot about the RIGHT handle.
      const yR = w0 * HANDLE_X1 + b0;
      const yL = w0 * HANDLE_X0 + b0 + dy;
      w = (yR - yL) / (HANDLE_X1 - HANDLE_X0);
      b = yR - w * HANDLE_X1;
    } else {
      // Pivot about the LEFT handle.
      const yL = w0 * HANDLE_X0 + b0;
      const yR = w0 * HANDLE_X1 + b0 + dy;
      w = (yR - yL) / (HANDLE_X1 - HANDLE_X0);
      b = yL - w * HANDLE_X0;
    }
    w = clamp(w, W_MIN, W_MAX);
    b = clamp(b, B_MIN, B_MAX);
    this.fit = { w, b };
    this.opts.onFitChange(w, b);
    this.draw();
  };

  private onUp = (e: PointerEvent): void => {
    if (!this.mode) return;
    this.mode = null;
    if (this.canvas.hasPointerCapture(e.pointerId)) {
      this.canvas.releasePointerCapture(e.pointerId);
    }
    this.canvas.style.cursor = "default";
  };

  private onLeave = (): void => {
    if (!this.mode && this.hover) {
      this.hover = null;
      this.canvas.style.cursor = "default";
      this.draw();
    }
  };

  /* ---------------- drawing ---------------- */

  private draw(): void {
    const ctx = this.ctx;
    const { w, h } = this;
    ctx.clearRect(0, 0, w, h);

    // Axes through the origin (Manim-quiet hairlines) + mono ticks.
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(M.l, this.py(0));
    ctx.lineTo(w - M.r, this.py(0));
    ctx.moveTo(this.px(0), M.t);
    ctx.lineTo(this.px(0), h - M.b);
    ctx.stroke();

    ctx.fillStyle = "rgba(154,164,178,0.85)";
    ctx.font = '9px ui-monospace, "Cascadia Mono", Consolas, monospace';
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const t of [-3, 0, 3]) {
      const x = this.px(t);
      ctx.beginPath();
      ctx.moveTo(x, h - M.b);
      ctx.lineTo(x, h - M.b + 3);
      ctx.strokeStyle = "rgba(255,255,255,0.22)";
      ctx.stroke();
      ctx.fillText(String(t), x, h - M.b + 5);
    }
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const t of [0, 2, 4]) {
      const y = this.py(t);
      ctx.beginPath();
      ctx.moveTo(M.l, y);
      ctx.lineTo(M.l - 3, y);
      ctx.stroke();
      ctx.fillText(String(t), M.l - 6, y);
    }

    // Residual segments (red) — the visual definition of the loss.
    ctx.strokeStyle = "rgba(252,98,85,0.75)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const pt of LEAST_SQUARES_POINTS) {
      ctx.moveTo(this.px(pt.x), this.py(pt.y));
      ctx.lineTo(this.px(pt.x), this.py(this.fit.w * pt.x + this.fit.b));
    }
    ctx.stroke();

    // Data points (white, softly glowing).
    ctx.save();
    ctx.shadowColor = "rgba(255,255,255,0.55)";
    ctx.shadowBlur = 5;
    ctx.fillStyle = "#ffffff";
    for (const pt of LEAST_SQUARES_POINTS) {
      ctx.beginPath();
      ctx.arc(this.px(pt.x), this.py(pt.y), 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Fitted line (Manim blue, gentle glow).
    ctx.save();
    ctx.strokeStyle = "#58C4DD";
    ctx.lineWidth = 2;
    ctx.shadowColor = "rgba(88,196,221,0.6)";
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.moveTo(this.px(HANDLE_X0), this.py(this.fit.w * HANDLE_X0 + this.fit.b));
    ctx.lineTo(this.px(HANDLE_X1), this.py(this.fit.w * HANDLE_X1 + this.fit.b));
    ctx.stroke();
    ctx.restore();

    // Drag handles at the line ends (brighter on hover/grab).
    const yL = this.py(this.fit.w * HANDLE_X0 + this.fit.b);
    const yR = this.py(this.fit.w * HANDLE_X1 + this.fit.b);
    const handles: Array<[number, number, boolean]> = [
      [this.px(HANDLE_X0), yL, this.mode === "left" || (this.hover === "left" && !this.mode)],
      [this.px(HANDLE_X1), yR, this.mode === "right" || (this.hover === "right" && !this.mode)],
    ];
    // No grab handles on a read-only inset — it must not look draggable.
    for (const [hx, hy, active] of this.interactive ? handles : []) {
      ctx.beginPath();
      ctx.arc(hx, hy, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = active ? "rgba(255,255,255,0.25)" : "rgba(11,13,16,0.9)";
      ctx.fill();
      ctx.strokeStyle = active ? "#ffffff" : "rgba(255,255,255,0.7)";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
