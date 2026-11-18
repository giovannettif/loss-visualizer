/**
 * CompassMinimap — the design guardrail from PLAN: a small always-available
 * 2D top-down inset of the parameter plane.
 *
 * Draws: contour ghost of the landscape (d3-contour, same grid convention as
 * LandscapeView), a hairline extent frame, mono axis ticks, the current
 * parameter point (learner white), the gradient needle (−∇f, fixed length —
 * the ANGLE is the message), and — for §2 — the GD step arrow (red), the
 * user's own drawn step arrow (white), and the current trajectory polyline.
 * All angles/lengths live in parameter space, never screen space.
 *
 * Needle color (FIX-4 stray-purple-arrow): the needle is LAVENDER (#C9A6DD,
 * spotlight #EBD9F7) — never the §8 custom-rule purple #9A72AC. It used to
 * draw in exactly that hex, so the §2 compass (gd-b: needle + white user
 * arrow + red GD step) showed a third arrow wearing §8's assembled-rule
 * identity color and read as a stray nobody placed (user session, 2026-11-17).
 * The needle is the only purple-family instrument on the compass; §8's
 * purple stays exclusive to the workbench rule.
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
  /**
   * Where the user's stride STARTS (QA S2A-READOUT-STALE-MIDWALK /
   * S2-FOG8-QUEUED-PREVIEW-WRONG-ORIGIN): during a fog walk the drawn ball
   * is still moving while the stride is planned from its landing point.
   * Absent = the current point (gd-b unchanged).
   */
  userOrigin?: Vec2 | null;
}

/** One trajectory polyline on the minimap (§2 GD / §3 GD-vs-momentum). */
export interface MinimapPath {
  points: readonly Vec2[];
  color: string;
}

export interface MinimapDragCallbacks {
  /**
   * Live during a drag: the arrow tip under the pointer (clamped). Returns
   * the tip actually drawn (e.g. fog-snapped/clamped), or null when the
   * current scene does not accept a drawn arrow — the minimap then neither
   * starts a draw nor shows the |Δθ|/∠ readout.
   */
  onPreview: (tip: Vec2) => Vec2 | null;
  /**
   * On release: the final tip, plus the gesture's pointer travel in CSS px —
   * the fog game rejects taps/jitters (travel < its slop) so a mis-tap never
   * spends a measurement.
   */
  onCommit: (tip: Vec2, gesture: { travelPx: number }) => void;
  /**
   * The gesture was cancelled by the UA (pointercancel): abandon the
   * preview and never commit (QA S2-FOG8-POINTERCANCEL-COMMITS).
   */
  onCancel?: () => void;
}

export interface MinimapFog {
  path: readonly Vec2[];
  reach: number;
  /** The REAL painted stamp radius in parameter units (stampFrac·diag) —
   *  the visited glow must not claim more ground than the 3D corridor. */
  stampR: number;
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
  /** Display names of the two axes (per-landscape; see setLandscape). */
  private axisNames: readonly [string, string] = ["x", "y"];
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
  /** Gesture origin + max pointer travel (CSS px) of the current drag. */
  private downX = 0;
  private downY = 0;
  private travelPx = 0;
  /** The tip the current held drag previews (null when no drag is held). */
  private previewTip: Vec2 | null = null;
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
    this.surface.addEventListener("pointercancel", this.onPointerCancel);
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

  /**
   * Recomputes plane fit, ticks and (by default) the contour ghost for a
   * landscape. `opts.contours = false` defers the d3-contour build to the
   * next full setLandscape — the §5 live throttle uses it so the dragged
   * valley keeps its fit/ticks/extent frame (which move) without the 5-6ms
   * contour pass, and contours blank until the idle rebuild (QA
   * PERF25-S2-REBUILD-COST-JANK).
   */
  setLandscape(
    fn: Landscape,
    opts: { contours?: boolean } = {},
  ): void {
    const withContours = opts.contours !== false;
    this.landscape = fn;
    // Axis names follow the landscape (QA copy-symbol-drift): w/b on least
    // squares, x/y on every test landscape; the HUD caption mirrors them.
    this.axisNames = fn.axes ?? ["x", "y"];
    const capX = this.canvas.closest("#minimap-panel")?.querySelector("#mm-ax-x");
    const capY = this.canvas.closest("#minimap-panel")?.querySelector("#mm-ax-y");
    if (capX) capX.textContent = this.axisNames[0];
    if (capY) capY.textContent = this.axisNames[1];
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
    // contours:false leaves contourPath null — draw() skips the ghost, so no
    // STALE contour from the previous landscape can linger.
    this.contourPath = withContours ? this.buildContours(fn) : null;
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
    this.refreshReadout();
  }

  /** §2 step arrows (tips in parameter space, measured from the point). */
  setArrows(arrows: MinimapArrows): void {
    this.arrows = arrows;
    this.draw();
    this.refreshReadout();
  }

  /** The user stride's origin (see MinimapArrows.userOrigin). */
  private strideOrigin(): Vec2 {
    return this.arrows.userOrigin ?? this.point;
  }

  /** A HELD drag's readout re-measures on state changes, not only on
   *  pointermove — the ball landing (or a queued replay) moves the origin. */
  private refreshReadout(): void {
    if (this.drawing && this.previewTip) this.showReadout(this.previewTip);
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

  /** Diagnostics: true while the compass suppresses contours/paths (§6 fog
   *  and §7's run-scoped board fog). */
  get fogMode(): boolean {
    return this.fog !== null;
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

  /**
   * Viewport position of the needle's base — the learner point the needle
   * radiates from and the spotlight halo is drawn on (REG-2-NEEDLE-ANCHOR).
   * Null while no landscape/plane is laid out (the caller falls back to the
   * panel anchor). The old "needle" look anchored the PANEL's fixed 42%/50%
   * fraction, which sits up to ~100px from the needle wherever the learner
   * point is not mid-panel — the arrow pointed at bare contour rings while
   * the halo glowed elsewhere (qa-needle-drift-probe: 102px static on
   * task-b, 34–101px swinging on gd-a's drift).
   */
  needleScreenPoint(): { x: number; y: number } | null {
    if (!this.landscape || !this.plane) return null;
    // The needle (and its halo) draw only from a non-zero gradient — with
    // none drawn there is nothing at the point to point at (the caller
    // falls back to the panel anchor).
    if (Math.hypot(this.grad.x, this.grad.y) <= 1e-9) return null;
    const r = this.canvas.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    return { x: r.left + this.px(this.point.x), y: r.top + this.py(this.point.y) };
  }

  /** Diagnostics: whether the needle spotlight is lit. */
  get spotlit(): boolean {
    return this.spotlight;
  }

  disableArrowDrag(): void {
    this.drag = null;
    this.drawing = false;
    this.previewTip = null;
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
    const o = this.strideOrigin();
    const dx = tip.x - o.x;
    const dy = tip.y - o.y;
    const len = Math.hypot(dx, dy);
    const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
    const text = `|Δθ| ${len >= 10 ? len.toFixed(1) : len.toFixed(2)} · ∠ ${ang.toFixed(0)}°`;
    if (this.readout.textContent !== text) this.readout.textContent = text;
    if (this.readout.dataset.visible !== "true") this.readout.dataset.visible = "true";
  }

  private hideReadout(): void {
    if (this.readout) this.readout.dataset.visible = "false";
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (!this.drag || e.button !== 0) return;
    const tip = this.pointerToParam(e);
    if (!tip) return;
    // The director decides whether this scene accepts a drawn arrow; a
    // read-only compass press stays an ordinary press (no capture, no
    // readout, and onPointerUp's !drawing guard skips the commit).
    const shown = this.drag.onPreview(tip);
    if (!shown) return;
    this.previewTip = shown;
    this.drawing = true;
    this.downX = e.clientX;
    this.downY = e.clientY;
    this.travelPx = 0;
    try {
      this.surface.setPointerCapture(e.pointerId);
    } catch {
      // synthetic pointers (probes) have no active pointer to capture
    }
    e.preventDefault();
    this.showReadout(shown);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.drawing || !this.drag) return;
    const tip = this.pointerToParam(e);
    if (!tip) return;
    // Gesture travel (CSS px) — the commit reports it so the fog game can
    // tell a real drag from a tap/jitter.
    this.travelPx = Math.max(
      this.travelPx,
      Math.hypot(e.clientX - this.downX, e.clientY - this.downY),
    );
    // A scene change or freeze mid-drag stops the preview — hide the readout.
    const shown = this.drag.onPreview(tip);
    this.previewTip = shown;
    if (shown) this.showReadout(shown);
    else this.hideReadout();
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.drawing || !this.drag) return;
    this.drawing = false;
    this.previewTip = null;
    this.hideReadout();
    if (this.surface.hasPointerCapture(e.pointerId)) {
      this.surface.releasePointerCapture(e.pointerId);
    }
    const tip = this.pointerToParam(e);
    this.travelPx = Math.max(
      this.travelPx,
      Math.hypot(e.clientX - this.downX, e.clientY - this.downY),
    );
    if (tip) this.drag.onCommit(tip, { travelPx: this.travelPx });
  };

  /** pointercancel: the UA took the gesture (scroll, palm rejection…) —
   *  abandon the preview and NEVER commit (QA S2-FOG8-POINTERCANCEL-COMMITS).
   *  The director owns the arrow state, so restoring it is its job. */
  private onPointerCancel = (e: PointerEvent): void => {
    if (!this.drawing || !this.drag) return;
    this.drawing = false;
    this.previewTip = null;
    this.travelPx = 0;
    this.hideReadout();
    if (this.surface.hasPointerCapture(e.pointerId)) {
      this.surface.releasePointerCapture(e.pointerId);
    }
    this.drag.onCancel?.();
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
      // Visited glow at the REAL painted radius (the 3D stamp is
      // stampFrac·diag; the old reach-sized discs over-claimed explored
      // ground), drawn along every path SEGMENT as well as at the vertices
      // so it reads as the same continuous corridor the 3D view paints.
      const r = Math.max(1, this.fog.stampR * this.plane.sx);
      const glowAt = (x: number, y: number): void => {
        const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, "rgba(92, 208, 179, 0.22)");
        grad.addColorStop(0.6, "rgba(92, 208, 179, 0.10)");
        grad.addColorStop(1, "rgba(92, 208, 179, 0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      };
      const fp = this.fog.path;
      for (let i = 0; i < fp.length; i++) {
        const ax = this.px(fp[i].x);
        const ay = this.py(fp[i].y);
        if (i > 0) {
          const bx = this.px(fp[i - 1].x);
          const by = this.py(fp[i - 1].y);
          const steps = Math.max(1, Math.ceil(Math.hypot(ax - bx, ay - by) / (r * 0.5)));
          for (let s = 1; s < steps; s++) {
            glowAt(bx + ((ax - bx) * s) / steps, by + ((ay - by) * s) / steps);
          }
        }
        glowAt(ax, ay);
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
      // sub-minimum drag flashes it red for ~600ms (QA G2-1). reach 0 = the
      // fog has no stride instrument (§7's real-time board) — no ring.
      if (!this.fog.done && this.fog.reach > 0) {
        const rejecting = performance.now() < this.rejectUntil;
        ctx.setLineDash([3, 4]);
        ctx.strokeStyle = rejecting
          ? "rgba(252,98,85,0.95)"
          : "rgba(255,255,255,0.28)";
        ctx.lineWidth = rejecting ? 1.6 : 1;
        ctx.beginPath();
        // While a stride is previewed, the ring bounding its tip sits on the
        // stride's real origin (the landing point mid-walk); idle, it
        // follows the ball.
        const rc = this.arrows.userTip && this.arrows.userOrigin ? this.arrows.userOrigin : this.point;
        ctx.arc(this.px(rc.x), this.py(rc.y), this.fog.reach * this.plane.sx, 0, Math.PI * 2);
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

    // Axis letters (italic serif math symbols) — named by the LANDSCAPE
    // (w/b on least squares, x/y on the test landscapes).
    ctx.fillStyle = "rgba(154,164,178,0.9)";
    ctx.font = 'italic 11px "STIX Two Text", Georgia, serif';
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.fillText(this.axisNames[0], fx + fw, fy + fh + 5 + 11);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(this.axisNames[1], fx - 6, fy - 14);

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
        // Guard (QA S8-DIVERGE-STREAKS): a non-finite canvas coordinate
        // corrupts the whole subpath — break the polyline there.
        let pen = false;
        for (const pt of mp.points) {
          const x = this.px(pt.x);
          const y = this.py(pt.y);
          if (!Number.isFinite(x) || !Number.isFinite(y)) {
            pen = false;
            continue;
          }
          if (pen) ctx.lineTo(x, y);
          else {
            ctx.moveTo(x, y);
            pen = true;
          }
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
      // Spotlighted needle: a soft lavender halo anchors WHERE to look.
      if (this.spotlight) {
        const nx = this.px(this.point.x);
        const ny = this.py(this.point.y);
        const halo = ctx.createRadialGradient(nx, ny, 2, nx, ny, 26);
        halo.addColorStop(0, "rgba(201, 166, 221, 0.42)");
        halo.addColorStop(1, "rgba(201, 166, 221, 0)");
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(nx, ny, 26, 0, Math.PI * 2);
        ctx.fill();
        this.drawArrow(this.point, tip, "#EBD9F7", 2.2, true);
      } else {
        // Lavender — never §8's custom-rule purple #9A72AC (FIX-4: on gd-b
        // the needle used to read as a stray third arrow wearing the §8
        // workbench rule's identity color).
        this.drawArrow(this.point, tip, "#C9A6DD", 1.8, false);
      }
    }

    // §2 GD step arrow (red, optimizer identity color).
    if (this.arrows.gdTip) {
      this.drawArrow(this.point, this.arrows.gdTip, "#FC6255", 2, true);
    }

    // §2 user step arrow (white — the learner's own hand).
    if (this.arrows.userTip) {
      this.drawArrow(this.strideOrigin(), this.arrows.userTip, "#FFFFFF", 2.2, true);
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
