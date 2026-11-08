/**
 * LossCurves — the §5 lab's loss-vs-step panel (HTML canvas).
 *
 * Up to three monospace-axed curves (GD red, momentum blue, Adam yellow) on
 * shared axes, with an optional log-ℒ scale. Redrawn only on setCurves —
 * cheap enough to call on every lab rebuild.
 */

export interface LossCurve {
  /** loss at step 0..n */
  losses: number[];
  color: string;
}

const M = { l: 34, r: 10, t: 8, b: 20 };

export class LossCurves {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly w: number;
  private readonly h: number;

  private curves: LossCurve[] | null = null;
  private logScale = true;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("LossCurves: no 2d context");
    this.ctx = ctx;
    const rect = canvas.getBoundingClientRect();
    this.w = rect.width || 276;
    this.h = rect.height || 168;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(this.w * dpr);
    canvas.height = Math.round(this.h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  setCurves(curves: LossCurve[] | null, logScale: boolean): void {
    this.curves = curves;
    this.logScale = logScale;
    this.draw();
  }

  private y(v: number, lo: number, hi: number): number {
    const t = this.logScale
      ? (Math.log10(Math.max(v, 1e-6)) - Math.log10(Math.max(lo, 1e-6))) /
        (Math.log10(Math.max(hi, 1e-6)) - Math.log10(Math.max(lo, 1e-6)))
      : (v - lo) / (hi - lo || 1);
    const k = Math.min(1, Math.max(0, t));
    return M.t + (1 - k) * (this.h - M.t - M.b);
  }

  private draw(): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);

    const plotW = this.w - M.l - M.r;
    const plotH = this.h - M.t - M.b;

    // Frame (hairline).
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.lineWidth = 1;
    ctx.strokeRect(M.l + 0.5, M.t + 0.5, plotW, plotH);

    let maxSteps = 1;
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of this.curves ?? []) {
      maxSteps = Math.max(maxSteps, c.losses.length - 1);
      for (const v of c.losses) {
        const vv = this.logScale ? Math.max(v, 1e-6) : v;
        lo = Math.min(lo, vv);
        hi = Math.max(hi, vv);
      }
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return;
    if (this.logScale) lo = Math.max(lo, 1e-2);
    if (hi - lo < 1e-9) hi = lo + 1;

    // Mono ticks: x = steps, y = loss decade/half marks.
    ctx.fillStyle = "rgba(154,164,178,0.85)";
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.font = '9px ui-monospace, "Cascadia Mono", Consolas, monospace';
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const s of [0, Math.round(maxSteps / 2), maxSteps]) {
      const x = M.l + (s / maxSteps) * plotW;
      ctx.beginPath();
      ctx.moveTo(x, M.t + plotH);
      ctx.lineTo(x, M.t + plotH + 3);
      ctx.stroke();
      ctx.fillText(String(s), x, M.t + plotH + 5);
    }
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    const yTicks = this.logScale
      ? [lo, Math.sqrt(lo * hi), hi].map((v) => Math.max(v, 1e-2))
      : [lo, (lo + hi) / 2, hi];
    for (const t of yTicks) {
      const y = this.y(t, lo, hi);
      ctx.beginPath();
      ctx.moveTo(M.l - 3, y);
      ctx.lineTo(M.l, y);
      ctx.stroke();
      const label = t >= 10 ? t.toFixed(0) : t >= 1 ? t.toFixed(1) : t.toExponential(0);
      ctx.fillText(label, M.l - 6, y);
    }

    // Curves.
    ctx.save();
    ctx.beginPath();
    ctx.rect(M.l, M.t, plotW, plotH);
    ctx.clip();
    ctx.lineWidth = 1.6;
    for (const c of this.curves ?? []) {
      if (c.losses.length < 2) continue;
      ctx.strokeStyle = c.color;
      ctx.beginPath();
      for (let i = 0; i < c.losses.length; i++) {
        const x = M.l + (i / maxSteps) * plotW;
        const y = this.y(c.losses[i], lo, hi);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
}
