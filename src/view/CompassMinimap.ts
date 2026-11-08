/**
 * CompassMinimap — the design guardrail from PLAN: a small always-available
 * 2D top-down inset of the parameter plane.
 *
 * Draws: contour ghost of the landscape (d3-contour, same grid convention as
 * LandscapeView), a hairline extent frame, mono axis ticks, the current
 * parameter point (learner white), the gradient needle (−∇f, Manim purple,
 * fixed length — the ANGLE is the message), and — for §2 — the GD step arrow
 * (red), the user's own drawn step arrow (white), and the current trajectory
 * polyline. All angles/lengths live in parameter space, never screen space.
 *
 * §2 arrow drawing: with drag callbacks enabled, dragging anywhere on the
 * canvas draws an arrow FROM the current point THROUGH the pointer (tip
 * clamped to the extent). The director owns the arrow state; the minimap
 * just reports pointer positions and draws what it is told.
 *
 * The canvas redraws only on setLandscape/setPoint/setArrows/setPath — it is
 * cheap enough to call every frame of a tween.
 */

import { contours as contourGrid } from "d3-contour";
import type { Landscape, Vec2 } from "../core/functions";

const GRID_N = 60;
const CONTOUR_LEVELS = 12;
const NEEDLE_FRACTION = 0.3; // needle length as a fraction of plane height
const PAD = 18; // margin reserved above/left of the plane (the "b" letter)
// Bottom reserve: the x tick labels AND the "w" axis letter are drawn BELOW
// the plane frame (gap + 9px tick glyphs + 2px + 11px serif letter). The
// canvas bitmap clips anything past the canvas edge, so reserving less than
// this renders the ticks as unreadable top-slivers (visual verdict n-6).
const AXIS_GAP = 5;
const TICK_FONT_PX = 9;
const LETTER_FONT_PX = 11;
const PAD_BOTTOM = AXIS_GAP + TICK_FONT_PX + 2 + LETTER_FONT_PX; // = 27

export interface MinimapArrows {
  /** Committed (or live-preview) user step arrow tip, param space. */
  userTip: Vec2 | null;
  /** GD's actual step arrow tip, param space. */
  gdTip: Vec2 | null;
}

/** One trajectory polyline on the minimap (§2 GD / §3 GD-vs-momentum). */
export interface MinimapPath {
  points: readonly Vec2[];
  color: string;
}

export interface MinimapDragCallbacks {
  /** Live during a drag: the arrow tip under the pointer (clamped). */
  onPreview: (tip: Vec2) => void;
  /** On release: the final tip. */
  onCommit: (tip: Vec2) => void;
}

export interface MinimapFog {
  path: readonly Vec2[];
  reach: number;
  done: boolean;
  /** The fog cell grid (nx × ny) — drawn as a faint grid while fogged. */
  cells?: { nx: number; ny: number } | null;
}

export class CompassMinimap {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly canvas: HTMLCanvasElement;
  private w: number;
  private h: number;
  /** Re-measures the canvas after a panel resize (late layout, dock swap). */
  private readonly onResize: () => void;

  private landscape: Landscape | null = null;
  private contourPath: Path2D | null = null;
  private plane: { x0: number; y0: number; sx: number; sy: number } | null = null;
  private rect: { fx: number; fy: number; fw: number; fh: number } | null = null;
  private xTicks: number[] = [];
  private yTicks: number[] = [];

  private point: Vec2 = { x: 0, y: 0 };
  private grad: Vec2 = { x: 0, y: 0 };
  /** Last state setPoint actually drew (the no-op redraw guard, QA LP-1). */
  private lastSet: { p: Vec2; g: Vec2 } | null = null;
  private arrows: MinimapArrows = { userTip: null, gdTip: null };
  private paths: readonly MinimapPath[] | null = null;

  /** §6 fog state: when set, the contour ghost and any optimizer paths are
   *  suppressed (they would leak the hidden landscape) and the player's
   *  visited patches + stride reach ring are drawn instead. */
  private fog: MinimapFog | null = null;
  /** Rejected-stride flash: the ring draws red until this instant (QA G2-1). */
  private rejectUntil = 0;
  private rejectTimer = 0;

  private drag: MinimapDragCallbacks | null = null;
  private drawing = false;
  /** The gesture surface: the whole PANEL (canvas + padding + caption), so
   *  a press that misses the small canvas still starts the draw. */
  private readonly surface: HTMLElement;
  /** Live length/angle readout shown while an arrow drag is held. */
  private readout: HTMLDivElement | null = null;
  /** Hover-to-look: spotlights the needle (halo at the point, brighter
   *  needle) while a reader span that points at it is hovered/focused. */
  private spotlight: boolean = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("CompassMinimap: no 2d context");
    this.ctx = ctx;
    const rect = canvas.getBoundingClientRect();
    this.w = rect.width || 140;
    this.h = rect.height || 200;
    this.surface = (canvas.parentElement ?? canvas) as HTMLElement;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(this.w * dpr);
    canvas.height = Math.round(this.h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.surface.style.touchAction = "none";
    // Arrow drags may START on the panel padding/caption (the canvas is only
    // 140×220 — the guardrail interaction must not demand pixel precision to
    // grab). Mapping stays anchored to the CANVAS rect; off-canvas presses
    // clamp to the extent border.
    this.surface.addEventListener("pointerdown", this.onPointerDown);
    this.surface.addEventListener("pointermove", this.onPointerMove);
    this.surface.addEventListener("pointerup", this.onPointerUp);
    this.surface.addEventListener("pointercancel", this.onPointerUp);
    // A panel resize (or a late layout) invalidates the cached size and the
    // plane fit — re-measure and rebuild.
    this.onResize = () => {
      const r = canvas.getBoundingClientRect();
      if (Math.round(r.width) === Math.round(this.w) && Math.round(r.height) === Math.round(this.h)) return;
      this.w = r.width || this.w;
      this.h = r.height || this.h;
      const d = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(this.w * d);
      canvas.height = Math.round(this.h * d);
      ctx.setTransform(d, 0, 0, d, 0, 0);
      if (this.landscape) this.setLandscape(this.landscape);
    };
    window.addEventListener("resize", this.onResize);
  }

  /** Recomputes plane fit, ticks and the contour ghost for a landscape. */
  setLandscape(fn: Landscape): void {
    this.landscape = fn;
    const { xMin, xMax, yMin, yMax } = fn.extent;
    const iw = this.w - PAD - 8;
    const ih = this.h - PAD - PAD_BOTTOM;
    const sx = Math.min(iw / (xMax - xMin), ih / (yMax - yMin));
    const sy = sx; // equal aspect: angles must be truthful
    const x0 = PAD + (iw - (xMax - xMin) * sx) / 2;
    const y0 = PAD + (ih - (yMax - yMin) * sy) / 2;
    this.plane = { x0, y0, sx, sy };
    this.xTicks = niceTicks(xMin, xMax);
    this.yTicks = niceTicks(yMin, yMax);
    this.contourPath = this.buildContours(fn);
    this.draw();
  }

  setPoint(p: Vec2, grad: Vec2): void {
    // QA LP-1: the playback loop re-runs updateDependents every frame, which
    // re-sets the SAME point — a full canvas redraw (contours included) per
    // frame for an unchanged needle. Skip exact no-ops; every mutator that
    // changes what draw() renders also runs draw() itself, so the needle can
    // never go stale.
    const last = this.lastSet;
    if (
      last &&
      Math.abs(last.p.x - p.x) < 1e-9 &&
      Math.abs(last.p.y - p.y) < 1e-9 &&
      Math.abs(last.g.x - grad.x) < 1e-9 &&
      Math.abs(last.g.y - grad.y) < 1e-9
    ) {
      return;
    }
    this.lastSet = { p: { x: p.x, y: p.y }, g: { x: grad.x, y: grad.y } };
    this.point = p;
    this.grad = grad;
    this.draw();
  }

  /** §2 step arrows (tips in parameter space, measured from the point). */
  setArrows(arrows: MinimapArrows): void {
    this.arrows = arrows;
    this.draw();
  }

  /** §2/§3 trajectory polylines (drawn under the arrows, clipped to the plane). */
  setPaths(paths: readonly MinimapPath[] | null): void {
    this.paths = paths;
    this.draw();
  }

  /** Single-path convenience (§2: the red GD trajectory). */
  setPath(path: readonly Vec2[] | null): void {
    this.setPaths(path ? [{ points: path, color: "rgba(252,98,85,0.85)" }] : null);
  }

  /** §6 fog game: visited patches + stride ring + cell grid (null leaves
   *  fog mode). */
  setFog(fog: MinimapFog | null): void {
    this.fog = fog;
    this.draw();
  }

  /**
   * §6 feedback for a rejected sub-minimum drag (QA G2-1/N5-S2): the stride
   * ring flashes red ~600ms so a player whose strides stall in flat ground
   * knows the stride was too short — reach further.
   */
  flashStrideReject(): void {
    if (!this.fog || this.fog.done) return;
    this.rejectUntil = performance.now() + 600;
    this.draw();
    window.clearTimeout(this.rejectTimer);
    this.rejectTimer = window.setTimeout(() => {
      this.rejectUntil = 0;
      this.draw();
    }, 620);
  }

  /** Enables §2 arrow drawing (pointer drag → callbacks). */
  enableArrowDrag(cb: MinimapDragCallbacks): void {
    this.drag = cb;
  }

  /** Hover-to-look: halo the point + brighten the needle while on. */
  setSpotlight(on: boolean): void {
    if (this.spotlight === on) return;
    this.spotlight = on;
    this.draw();
  }

  /** Diagnostics: whether the needle spotlight is lit. */
  get spotlit(): boolean {
    return this.spotlight;
  }

  disableArrowDrag(): void {
    this.drag = null;
    this.drawing = false;
    this.hideReadout();
  }

  /* ---------------- pointer -> parameter ---------------- */

  /** Canvas pixel coords -> parameter point (clamped to the extent). Presses
   *  that land on the panel around the canvas map to the extent border via
   *  the same clamp — the grab surface is the whole panel, the MAPPING is
   *  still anchored to the canvas rect. */
  private pointerToParam(e: PointerEvent): Vec2 | null {
    if (!this.landscape || !this.rect || !this.plane) return null;
    const r = this.canvas.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    const { fx, fy, fw, fh } = this.rect;
    const { xMin, xMax, yMin, yMax } = this.landscape.extent;
    const x = xMin + ((mx - fx) / fw) * (xMax - xMin);
    const y = yMax - ((my - fy) / fh) * (yMax - yMin);
    return {
      x: Math.min(xMax, Math.max(xMin, x)),
      y: Math.min(yMax, Math.max(yMin, y)),
    };
  }

  /* ---------------- live length/angle readout ---------------- */

  /** While a drag is held: |Δθ| in parameter units + the param-space angle
   *  (CCW from +x, +y up — the compass's whole job is truthful angles). */
  private showReadout(tip: Vec2): void {
    if (!this.readout) {
      const el = document.createElement("div");
      el.className = "mm-readout";
      el.dataset.visible = "false";
      this.surface.appendChild(el);
      this.readout = el;
    }
    const dx = tip.x - this.point.x;
    const dy = tip.y - this.point.y;
    const len = Math.hypot(dx, dy);
    const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
    this.readout.textContent =
      `|Δθ| ${len >= 10 ? len.toFixed(1) : len.toFixed(2)} · ∠ ${ang.toFixed(0)}°`;
    this.readout.dataset.visible = "true";
  }

  private hideReadout(): void {
    if (this.readout) this.readout.dataset.visible = "false";
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (!this.drag || e.button !== 0) return;
    const tip = this.pointerToParam(e);
    if (!tip) return;
    this.drawing = true;
    try {
      this.surface.setPointerCapture(e.pointerId);
    } catch {
      // synthetic pointers (probes) have no active pointer to capture
    }
    e.preventDefault();
    this.showReadout(tip);
    this.drag.onPreview(tip);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.drawing || !this.drag) return;
    const tip = this.pointerToParam(e);
    if (tip) {
      this.showReadout(tip);
      this.drag.onPreview(tip);
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.drawing || !this.drag) return;
    this.drawing = false;
    this.hideReadout();
    if (this.surface.hasPointerCapture(e.pointerId)) {
      this.surface.releasePointerCapture(e.pointerId);
    }
    const tip = this.pointerToParam(e);
    if (tip) this.drag.onCommit(tip);
  };

  /* ---------------- drawing ---------------- */

  private px(x: number): number {
    const fn = this.landscape!;
    return this.plane!.x0 + (x - fn.extent.xMin) * this.plane!.sx;
  }

  private py(y: number): number {
    const fn = this.landscape!;
    return this.plane!.y0 + (fn.extent.yMax - y) * this.plane!.sy;
  }

  /** Canvas-space arrow from param `from` to param `tip`, with a head. */
  private drawArrow(
    from: Vec2,
    tip: Vec2,
    color: string,
    widthPx: number,
    glow: boolean,
  ): void {
    const ctx = this.ctx;
    const x0 = this.px(from.x);
    const y0 = this.py(from.y);
    const x1 = this.px(tip.x);
    const y1 = this.py(tip.y);
    if (Math.hypot(x1 - x0, y1 - y0) < 1) return;

    ctx.save();
    if (glow) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 6;
    }
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = widthPx;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();

    const a = Math.atan2(y1 - y0, x1 - x0);
    const hl = 6;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - hl * Math.cos(a - 0.42), y1 - hl * Math.sin(a - 0.42));
    ctx.lineTo(x1 - hl * Math.cos(a + 0.42), y1 - hl * Math.sin(a + 0.42));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** d3-contour isolines in parameter space, baked to a canvas Path2D. */
  private buildContours(fn: Landscape): Path2D | null {
    const size = GRID_N + 1;
    const { xMin, xMax, yMin, yMax } = fn.extent;
    const dx = (xMax - xMin) / GRID_N;
    const dy = (yMax - yMin) / GRID_N;

    const values = new Array<number>(size * size);
    let hMin = Infinity;
    let hMax = -Infinity;
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const v = fn.f({ x: xMin + i * dx, y: yMin + j * dy });
        values[j * size + i] = v;
        if (v < hMin) hMin = v;
        if (v > hMax) hMax = v;
      }
    }

    const levels: number[] = [];
    for (let i = 1; i <= CONTOUR_LEVELS; i++) {
      levels.push(hMin + ((hMax - hMin) * i) / (CONTOUR_LEVELS + 1));
    }
    const polys = contourGrid().size([size, size]).thresholds(levels)(values);

    const path = new Path2D();
    // Ring grid coords ⟨gx, gy⟩ = sample ⟨gx − 0.5, gy − 0.5⟩ (verified in
    // LandscapeView against the d3-contour docs/source).
    for (const poly of polys) {
      for (const polygon of poly.coordinates) {
        for (const ring of polygon) {
          for (let i = 0; i < ring.length - 1; i++) {
            const a = ring[i];
            const b = ring[i + 1];
            path.moveTo(this.px(xMin + (a[0] - 0.5) * dx), this.py(yMin + (a[1] - 0.5) * dy));
            path.lineTo(this.px(xMin + (b[0] - 0.5) * dx), this.py(yMin + (b[1] - 0.5) * dy));
          }
        }
      }
    }
    return path;
  }

  private draw(): void {
    const fn = this.landscape;
    const ctx = this.ctx;
    if (!fn || !this.plane) return;
    const { xMin, xMax, yMin, yMax } = fn.extent;
    ctx.clearRect(0, 0, this.w, this.h);

    // Extent frame (hairline).
    const fx = this.px(xMin);
    const fy = this.py(yMax);
    const fw = (xMax - xMin) * this.plane.sx;
    const fh = (yMax - yMin) * this.plane.sy;
    this.rect = { fx, fy, fw, fh };
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.lineWidth = 1;
    ctx.strokeRect(fx + 0.5, fy + 0.5, fw, fh);

    // Contour ghost — suppressed in fog mode (it would leak the landscape).
    if (this.contourPath && !this.fog) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(fx, fy, fw, fh);
      ctx.clip();
      ctx.strokeStyle = "rgba(255,255,255,0.10)";
      ctx.lineWidth = 1;
      ctx.stroke(this.contourPath);
      ctx.restore();
    }

    // §6 fog: the visited ground glows teal through the darkness; the dashed
    // ring is the maximum stride. No contours, no optimizer paths — the
    // minimap must not know more than the player does. The faint cell grid
    // is the snapping target: stride endpoints land on cell centers.
    if (this.fog) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(fx, fy, fw, fh);
      ctx.clip();
      if (this.fog.cells && !this.fog.done) {
        ctx.strokeStyle = "rgba(255,255,255,0.07)";
        ctx.lineWidth = 1;
        const { nx, ny } = this.fog.cells;
        ctx.beginPath();
        for (let i = 1; i < nx; i++) {
          const x = fx + (fw * i) / nx;
          ctx.moveTo(x, fy);
          ctx.lineTo(x, fy + fh);
        }
        for (let j = 1; j < ny; j++) {
          const y = fy + (fh * j) / ny;
          ctx.moveTo(fx, y);
          ctx.lineTo(fx + fw, y);
        }
        ctx.stroke();
      }
      const r = this.fog.reach * this.plane.sx * 0.95;
      for (const p of this.fog.path) {
        const x = this.px(p.x);
        const y = this.py(p.y);
        const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, "rgba(92, 208, 179, 0.22)");
        grad.addColorStop(0.6, "rgba(92, 208, 179, 0.10)");
        grad.addColorStop(1, "rgba(92, 208, 179, 0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      // The player's own track (faint white — private memory, not a map).
      if (this.fog.path.length >= 2) {
        ctx.strokeStyle = "rgba(255,255,255,0.35)";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(this.px(this.fog.path[0].x), this.py(this.fog.path[0].y));
        for (let i = 1; i < this.fog.path.length; i++) {
          ctx.lineTo(this.px(this.fog.path[i].x), this.py(this.fog.path[i].y));
        }
        ctx.stroke();
      }
      // Stride reach ring (hidden once the run is done). A rejected
      // sub-minimum drag flashes it red for ~600ms (QA G2-1/N5-S2).
      if (!this.fog.done) {
        const rejecting = performance.now() < this.rejectUntil;
        ctx.setLineDash([3, 4]);
        ctx.strokeStyle = rejecting
          ? "rgba(252,98,85,0.95)"
          : "rgba(255,255,255,0.28)";
        ctx.lineWidth = rejecting ? 1.6 : 1;
        ctx.beginPath();
        ctx.arc(this.px(this.point.x), this.py(this.point.y), this.fog.reach * this.plane.sx, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
    }

    // Ticks + labels (mono, grey — visual bar: every number monospace).
    ctx.fillStyle = "rgba(154,164,178,0.85)";
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.font = '9px ui-monospace, "Cascadia Mono", Consolas, monospace';
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const t of this.xTicks) {
      const x = this.px(t);
      ctx.beginPath();
      ctx.moveTo(x, fy + fh);
      ctx.lineTo(x, fy + fh + 3);
      ctx.stroke();
      ctx.fillText(String(t), x, fy + fh + 5);
    }
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const t of this.yTicks) {
      const y = this.py(t);
      ctx.beginPath();
      ctx.moveTo(fx, y);
      ctx.lineTo(fx - 3, y);
      ctx.stroke();
      ctx.fillText(String(t), fx - 6, y);
    }

    // Axis letters (italic serif math symbols).
    ctx.fillStyle = "rgba(154,164,178,0.9)";
    ctx.font = 'italic 11px "STIX Two Text", Georgia, serif';
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.fillText("w", fx + fw, fy + fh + 5 + 11);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("b", fx - 6, fy - 14);

    // §2/§3 trajectories (under the arrows, clipped to the plane). Fog mode
    // suppresses them: machine trajectories are post-reveal knowledge only.
    if (this.paths && this.paths.length > 0 && !this.fog) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(fx, fy, fw, fh);
      ctx.clip();
      ctx.lineWidth = 1.4;
      for (const mp of this.paths) {
        if (mp.points.length < 2) continue;
        ctx.strokeStyle = mp.color;
        ctx.beginPath();
        ctx.moveTo(this.px(mp.points[0].x), this.py(mp.points[0].y));
        for (let i = 1; i < mp.points.length; i++) {
          ctx.lineTo(this.px(mp.points[i].x), this.py(mp.points[i].y));
        }
        ctx.stroke();
      }
      ctx.restore();
    }

    // Gradient needle: −∇f from the point, fixed pixel length.
    const glen = Math.hypot(this.grad.x, this.grad.y);
    if (glen > 1e-9) {
      const L = fh * NEEDLE_FRACTION;
      // Needle = −∇L. Parameter +y is up, canvas y is down, so the canvas
      // direction is (−gx, +gy) — the double negation on y cancels the flip.
      const ux = -this.grad.x / glen;
      const uy = this.grad.y / glen;
      const tip = {
        x: this.point.x + (ux * L) / this.plane.sx,
        // canvas +y (down) is param −y.
        y: this.point.y - (uy * L) / this.plane.sy,
      };
      // Spotlighted needle: a soft purple halo anchors WHERE to look.
      if (this.spotlight) {
        const nx = this.px(this.point.x);
        const ny = this.py(this.point.y);
        const halo = ctx.createRadialGradient(nx, ny, 2, nx, ny, 26);
        halo.addColorStop(0, "rgba(154,114,172,0.4)");
        halo.addColorStop(1, "rgba(154,114,172,0)");
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(nx, ny, 26, 0, Math.PI * 2);
        ctx.fill();
        this.drawArrow(this.point, tip, "#C9A6DD", 2.2, true);
      } else {
        this.drawArrow(this.point, tip, "#9A72AC", 1.8, false);
      }
    }

    // §2 GD step arrow (red, optimizer identity color).
    if (this.arrows.gdTip) {
      this.drawArrow(this.point, this.arrows.gdTip, "#FC6255", 2, true);
    }

    // §2 user step arrow (white — the learner's own hand).
    if (this.arrows.userTip) {
      this.drawArrow(this.point, this.arrows.userTip, "#FFFFFF", 2.2, true);
    }

    // Learner point: soft glow + white core (drawn last, on top).
    const px = this.px(this.point.x);
    const py = this.py(this.point.y);
    ctx.beginPath();
    ctx.arc(px, py, 7, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.16)";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(px, py, 2.8, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
  }
}

/** Ticks at {1,2,5}×10^k steps, 3–6 of them, inside [min, max]. */
function niceTicks(min: number, max: number): number[] {
  const span = max - min;
  const raw = span / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  let step = pow;
  for (const m of [1, 2, 5, 10]) {
    if (raw <= m * pow) {
      step = m * pow;
      break;
    }
  }
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) {
    out.push(Math.abs(v) < step / 2 ? 0 : Math.round(v * 100) / 100);
  }
  return out;
}
