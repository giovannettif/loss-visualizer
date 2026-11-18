/**
 * debug.html entry — deterministic viewport check for WP0.
 *
 * URL params (both optional, invalid values fall back to defaults):
 *   ?fn=bowl|rosenbrock|rastrigin   landscape to render   (default bowl)
 *   ?cam=iso|map                    camera preset         (default iso)
 *
 * Each state is fully deterministic: fixed landscape, fixed camera attitude,
 * fixed optimizer trails (hand-written math core, no randomness anywhere).
 */

import "./view/page.css";
import { MANIM, OPTIMIZER_COLORS } from "./view/palette";
import { LandscapeView, type CameraPreset } from "./view/LandscapeView";
import {
  defaultBowl,
  rosenbrock,
  rastrigin,
  type Landscape,
  type Vec2,
} from "./core/functions";
import { gd, momentum, adam, type Optimizer } from "./core/optimizers";

/* ------------------------------------------------------------------ */
/* Landscape registry                                                  */
/* ------------------------------------------------------------------ */

type FnKey = "bowl" | "rosenbrock" | "rastrigin";

const LANDSCAPES: Record<FnKey, Landscape> = {
  bowl: defaultBowl,
  rosenbrock,
  rastrigin,
};

const FN_KEYS = Object.keys(LANDSCAPES) as FnKey[];

function parseFnKey(raw: string | null): FnKey {
  return FN_KEYS.includes(raw as FnKey) ? (raw as FnKey) : "bowl";
}

function parseCam(raw: string | null): CameraPreset {
  return raw === "map" ? "map" : "iso";
}

/* ------------------------------------------------------------------ */
/* Deterministic demo overlays                                         */
/* ------------------------------------------------------------------ */

/**
 * One three-optimizer race per landscape. Start points, learning rates and
 * step counts are fixed constants so every load renders the identical scene.
 */
interface TrailSpec {
  opt: Optimizer;
  color: number;
  steps: number;
}

const RACES: Record<FnKey, { start: Vec2; trails: TrailSpec[] }> = {
  bowl: {
    start: { x: -11, y: 9.5 },
    trails: [
      { opt: gd(0.2), color: OPTIMIZER_COLORS.gd, steps: 70 },
      { opt: momentum(0.045, 0.9), color: OPTIMIZER_COLORS.momentum, steps: 70 },
      { opt: adam(0.2, 0.9, 0.999, 1e-8), color: OPTIMIZER_COLORS.adam, steps: 70 },
    ],
  },
  rosenbrock: {
    start: { x: -1.7, y: 2.7 },
    trails: [
      { opt: gd(9e-4), color: OPTIMIZER_COLORS.gd, steps: 260 },
      { opt: momentum(3.5e-4, 0.9), color: OPTIMIZER_COLORS.momentum, steps: 260 },
      { opt: adam(0.012, 0.9, 0.999, 1e-8), color: OPTIMIZER_COLORS.adam, steps: 260 },
    ],
  },
  rastrigin: {
    start: { x: -4.3, y: 3.4 },
    trails: [
      { opt: gd(0.012), color: OPTIMIZER_COLORS.gd, steps: 120 },
      { opt: momentum(0.008, 0.9), color: OPTIMIZER_COLORS.momentum, steps: 120 },
      { opt: adam(0.04, 0.9, 0.999, 1e-8), color: OPTIMIZER_COLORS.adam, steps: 120 },
    ],
  },
};

/** Steps an optimizer from start, stopping if it leaves the drawn extent. */
function runPath(fn: Landscape, spec: TrailSpec, start: Vec2): Vec2[] {
  const e = fn.extent;
  const m = 1.05; // tiny margin so paths may kiss the frame but not escape
  const pts: Vec2[] = [{ ...start }];
  let state = spec.opt.initState(start);
  for (let i = 0; i < spec.steps; i++) {
    state = spec.opt.step(state, fn.grad(state.pos));
    const { x, y } = state.pos;
    if (!Number.isFinite(x) || !Number.isFinite(y)) break;
    if (
      x < e.xMin * m || x > e.xMax * m ||
      y < e.yMin * m || y > e.yMax * m
    ) {
      break;
    }
    pts.push({ x, y });
  }
  return pts;
}

/** Draws the demo overlays for a landscape. */
function drawDemo(view: LandscapeView, fnKey: FnKey): void {
  const fn = LANDSCAPES[fnKey];
  const race = RACES[fnKey];

  let learnerEnd: Vec2 | null = null;
  for (const spec of race.trails) {
    const path = runPath(fn, spec, race.start);
    if (path.length >= 2) view.addTrail(path, spec.color);
    learnerEnd = path[path.length - 1] ?? null;
  }
  if (learnerEnd) {
    view.setBall(learnerEnd, OPTIMIZER_COLORS.learner);
    // −∇f at the ball, in the tangent plane (Manim purple, distinct from the
    // optimizer identity colors).
    const g = fn.grad(learnerEnd);
    view.addArrow(learnerEnd, { x: -g.x, y: -g.y }, MANIM.purple);
  }
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

const params = new URLSearchParams(window.location.search);
let currentFn = parseFnKey(params.get("fn"));
let currentCam = parseCam(params.get("cam"));

const stage = document.querySelector<HTMLDivElement>("#stage");
const roFn = document.querySelector<HTMLElement>("#ro-fn");
const roAzim = document.querySelector<HTMLElement>("#ro-azim");
const roElev = document.querySelector<HTMLElement>("#ro-elev");
const roZoom = document.querySelector<HTMLElement>("#ro-zoom");
const roPan = document.querySelector<HTMLElement>("#ro-pan");

function setUrlParam(key: string, value: string | null): void {
  const next = new URLSearchParams(window.location.search);
  if (value === null) next.delete(key);
  else next.set(key, value);
  const q = next.toString();
  window.history.replaceState(null, "", window.location.pathname + (q ? `?${q}` : ""));
}

function refreshFnButtons(): void {
  document.querySelectorAll<HTMLButtonElement>("#fn-buttons .btn").forEach((b) => {
    b.dataset.active = String(b.dataset.fn === currentFn);
  });
}

function fmt(n: number, digits = 1): string {
  return n.toFixed(digits);
}

if (stage) {
  const view = new LandscapeView(stage, {
    onCameraPreset: (preset) => {
      currentCam = preset;
      setUrlParam("cam", preset);
    },
    onUserOrbit: () => {
      // The attitude is no longer a preset — the URL must not claim one.
      currentCam = parseCam(null);
      setUrlParam("cam", null);
    },
  });

  function show(key: FnKey): void {
    currentFn = key;
    // Preset first: setLandscape fits the camera around the current attitude.
    view.setPreset(currentCam);
    view.setLandscape(LANDSCAPES[key]);
    drawDemo(view, key);
    setUrlParam("fn", key);
    refreshFnButtons();
    if (roFn) roFn.textContent = LANDSCAPES[key].label;
  }

  document.querySelectorAll<HTMLButtonElement>("#fn-buttons .btn").forEach((b) => {
    b.addEventListener("click", () => {
      const key = parseFnKey(b.dataset.fn ?? null);
      if (key !== currentFn) show(key);
    });
  });

  show(currentFn);
  // Probe hook (camera gates read the pan clamp state: tools/cdp-interact-cam.mjs).
  (window as unknown as { __view?: LandscapeView }).__view = view;

  // Live attitude readout (monospace numbers per the visual bar).
  function tick(): void {
    const a = view.attitude;
    if (roAzim) roAzim.textContent = `${fmt(a.azimuthDeg)}°`;
    if (roElev) roElev.textContent = `${fmt(a.elevationDeg)}°`;
    if (roZoom) roZoom.textContent = fmt(a.zoomRadius, 2);
    if (roPan) {
      const p = view.panInfo.px; // screen-plane pan, CSS px (x right, y up)
      roPan.textContent = `${fmt(p.x, 0)},${fmt(p.y, 0)}`;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
