/**
 * WP-A1 entry — the two-pane app ("You Can't See the Loss").
 *
 * LEFT pane: the fixed full-viewport landscape canvas and every instrument.
 * RIGHT pane: the reader — ONE CONTINUOUS SCROLL DOCUMENT (v4). Every step's
 * text is a full-panel page stacked in flow inside #reader-body; wheeling
 * scrolls them like a document (the next step's text slides in from below as
 * part of the scroll), and when the scroll reaches the incoming step it SNAPS
 * into place — then its core animation plays under the lock (wheel frozen;
 * Skip completes it instantly; the lock releases when the animation drains).
 * Scrolling back up re-enters the previous step with the scene state stepping
 * back instantly — no re-lock. Wheel over the canvas zooms the camera and
 * never advances. ArrowDown/Space match the wheel, ArrowUp reverses, the
 * right-edge rail tracks the active step and jumps anywhere.
 *
 * There is no document scrolling: body overflow is hidden — the page is the
 * app. ?shot=… renders any scene deterministically; ?step=N jumps to a step.
 */

import "./view/fonts.css";
import "./view/page.css";
import { MANIM } from "./view/palette";
import { leastSquares } from "./core/functions";
import { LandscapeView } from "./view/LandscapeView";
import { FitPreview } from "./view/FitPreview";
import { CompassMinimap } from "./view/CompassMinimap";
import { LossCurves } from "./view/lossCurves";
import { Director, SCENE_ORDER, type SceneName } from "./scenes/director";
import { ruleClipFromKnob, ruleEtaFromKnob } from "./scenes/ruleLab";

const params = new URLSearchParams(window.location.search);

/** ?shot=… → scene name (invalid values fall back to null). */
function parseShot(raw: string | null): SceneName | null {
  return SCENE_ORDER.includes(raw as SceneName) ? (raw as SceneName) : null;
}

// ?shot=fogswarm — the §7 swarm in "run it blind" mode (the §6 fog mask +
// the ensemble painting every cell it crosses): same scene as ?shot=swarm,
// booted with the blind preset and an earlier frozen pose. ?shot=intro is
// the full-bleed intro title's canonical hook: it renders the same hero
// pose as ?shot=hero (now always full-bleed — see the intro park below).
const fogswarmShot = params.get("shot") === "fogswarm";
const introShot = params.get("shot") === "intro";
const shot = parseShot(
  fogswarmShot ? "swarm" : introShot ? "hero" : params.get("shot"),
);
const stepRaw = Number.parseInt(params.get("step") ?? "", 10);
const stepIndex = Number.isInteger(stepRaw)
  ? Math.min(SCENE_ORDER.length - 1, Math.max(0, stepRaw))
  : null;

/** Screenshot mode kills every CSS transition/animation (see page.css). */
if (shot) document.documentElement.classList.add("shot");

/* ---------------- boot overlay (first-load glitch fix) ------------------
 *
 * #boot (styled inline in index.html, correct from the very first paint)
 * covers the app with the title and a thin progress line until the scene is
 * built AND the fonts are ready, then fades out — the loading pop/flash is
 * gone, and a failed WebGL context gets a graceful message instead of a
 * blank page. font-display audit: the faces stay `swap` (a block period
 * would hold text invisible up to 3s and delay nothing we care about); the
 * reveal is gated on document.fonts.ready, so the swap itself happens
 * behind the overlay and causes no visible reflow.
 */
const bootEl = document.getElementById("boot");
const bootFill = document.getElementById("boot-fill");
const bootMsg = document.getElementById("boot-msg");
let bootDone = false;
let bootProgress = 0;

function bootTick(): void {
  if (bootDone || !bootFill) return;
  // Asymptotic approach to 85%: honest about being indeterminate, always
  // moving while the module graph + scene build.
  bootProgress = Math.min(0.85, bootProgress + (0.85 - bootProgress) * 0.08 + 0.004);
  bootFill.style.width = `${(bootProgress * 100).toFixed(1)}%`;
  requestAnimationFrame(bootTick);
}

/** Reveal: 100% fill, fade the overlay, then drop it (instant in shot mode). */
function finishBoot(): void {
  if (bootDone) return;
  bootDone = true;
  if (bootFill) bootFill.style.width = "100%";
  if (shot) {
    bootEl?.remove();
    return;
  }
  setTimeout(() => {
    bootEl?.setAttribute("data-done", "true");
    setTimeout(() => bootEl?.remove(), 700);
  }, 180);
}

/** Fatal boot failure: keep the overlay up with a readable message. */
function failBoot(headline: string, detail: string): void {
  if (bootDone) return;
  bootDone = true;
  bootEl?.setAttribute("data-error", "true");
  if (bootMsg) {
    bootMsg.textContent = `${headline}\n${detail}`;
    bootMsg.hidden = false;
  }
}

// A module-level crash mid-boot must not leave a silent frozen overlay.
window.addEventListener("error", (ev) => {
  if (!bootDone) {
    failBoot(
      "Something failed to load",
      ev.message || "An unexpected error stopped the page from finishing loading.",
    );
  }
});
window.addEventListener("unhandledrejection", () => {
  if (!bootDone) {
    failBoot(
      "Something failed to load",
      "An unexpected error stopped the page from finishing loading.",
    );
  }
});
if (bootEl) requestAnimationFrame(bootTick);

const appRoot = document.querySelector<HTMLElement>("#app");
const stage = document.querySelector<HTMLDivElement>("#app #stage");
const reader = document.querySelector<HTMLElement>("#reader");
const readerBody = document.querySelector<HTMLElement>("#reader-body");
const rsteps = [...document.querySelectorAll<HTMLElement>("#reader-body .rstep")];
const rail = document.querySelector<HTMLElement>("#rail");
const skipBtn = document.querySelector<HTMLButtonElement>("#skip-btn");
const continueHint = document.querySelector<HTMLElement>("#continue-hint");
const edgeFill = document.querySelector<HTMLElement>("#edge-fill");
const readerCount = document.querySelector<HTMLElement>("#reader-count");
const fitCanvas = document.querySelector<HTMLCanvasElement>("#fit-canvas");
const minimapCanvas = document.querySelector<HTMLCanvasElement>("#minimap-canvas");
const etaSlider = document.querySelector<HTMLInputElement>("#eta-slider");

if (appRoot && stage && reader && readerBody && rsteps.length > 0 && rail && skipBtn && continueHint && edgeFill && readerCount && fitCanvas && minimapCanvas) {
  // Assigned before the first animation frame or pointer event can fire.
  let director: Director;

  // Non-null aliases: the guards above proved these exist, but function
  // declarations below capture them across scopes where TS won't narrow.
  const appEl: HTMLElement = appRoot;
  const readerEl: HTMLElement = reader;
  const bodyEl: HTMLElement = readerBody;
  const railEl: HTMLElement = rail;
  const skipEl: HTMLButtonElement = skipBtn;
  const hintEl: HTMLElement = continueHint;
  const fillEl: HTMLElement = edgeFill;
  const countEl: HTMLElement = readerCount;

  /** Reader step index k → scene name (the two §5 steps share the lab). */
  const sceneOf = (k: number): SceneName =>
    SCENE_ORDER[Math.min(Math.max(k, 0), SCENE_ORDER.length - 1)];

  let current = 0;

  // The 3D viewport needs WebGL; a failed context must surface as a graceful
  // message on the boot overlay, not a blank page or a thrown module.
  let view: LandscapeView;
  try {
    view = new LandscapeView(stage, {
      gridN: 160,
      background: MANIM.background,
      onFrame: (dt) => director.onFrame(dt),
      // Left-drag on the learner ball moves the §1 point (the inset handles
      // also work); any other drag orbits the camera — free orbit everywhere.
      // §2's point is choreographed and never grabbable.
      onDragStart: (e) => {
        if (!director.surfaceDragEnabled) return false;
        const d = director.screenDistanceToBall(e.clientX, e.clientY);
        return d !== null && d <= 26;
      },
      onDragMove: (e) => {
        const p = director.pickAt(e.clientX, e.clientY);
        if (p) director.setFitUser(p.x, p.y);
      },
      onDragEnd: () => {},
      // The user grabbed the camera: in-flight step-change camera tweens must
      // yield immediately, or their per-frame setAttitude stomps the drag.
      onUserOrbitStart: () => director.cancelCameraTweens(),
    });
  } catch (err) {
    failBoot(
      "WebGL is unavailable",
      "This explorable draws its landscape with WebGL, and your browser " +
        "could not start a WebGL context. Try a current version of Edge, " +
        "Chrome, or Firefox with hardware acceleration enabled.",
    );
    throw err;
  }

  const fitPreview = new FitPreview(fitCanvas, {
    onFitChange: (w, b) => director.setFitUser(w, b),
  });
  const minimap = new CompassMinimap(minimapCanvas);
  // §2 gd-b: dragging on the compass draws the user's own step arrow.
  minimap.enableArrowDrag({
    onPreview: (tip) => director.onArrowPreview(tip),
    onCommit: (tip) => director.onArrowCommit(tip),
  });

  const curvesCanvas = document.querySelector<HTMLCanvasElement>("#curves-canvas");
  if (!curvesCanvas) throw new Error("main: #curves-canvas missing from index.html");
  const curves = new LossCurves(curvesCanvas);

  director = new Director(view, fitPreview, minimap, curves, {
    stageWrap: document.querySelector<HTMLElement>("#stage-wrap"),
    heroOverlay: document.querySelector<HTMLElement>("#hero-overlay"),
    fitPanel: document.querySelector<HTMLElement>("#fit-panel"),
    lossPanel: document.querySelector<HTMLElement>("#loss-panel"),
    minimapPanel: document.querySelector<HTMLElement>("#minimap-panel"),
    lossValue: document.querySelector<HTMLElement>("#loss-value"),
    roW: document.querySelector<HTMLElement>("#ro-w"),
    roB: document.querySelector<HTMLElement>("#ro-b"),
    etaSlider,
    etaValue: document.querySelector<HTMLElement>("#eta-value"),
    etaRegime: document.querySelector<HTMLElement>("#eta-regime"),
    betaSliders: [...document.querySelectorAll<HTMLInputElement>(".beta-slider")],
    betaValues: [...document.querySelectorAll<HTMLElement>(".beta-value")],
    betaRegimes: [...document.querySelectorAll<HTMLElement>(".beta-regime")],
    steepSlider: document.querySelector<HTMLInputElement>("#steep-slider"),
    steepValue: document.querySelector<HTMLElement>("#steep-value"),
    adamPanel: document.querySelector<HTMLElement>("#adam-panel"),
    adamAngle: document.querySelector<HTMLElement>("#adam-angle"),
    adamGdLen: document.querySelector<HTMLElement>("#adam-gd-len"),
    adamAdamLen: document.querySelector<HTMLElement>("#adam-adam-len"),
    barX: document.querySelector<HTMLElement>("#bar-x"),
    barY: document.querySelector<HTMLElement>("#bar-y"),
    barXVal: document.querySelector<HTMLElement>("#bar-x-val"),
    barYVal: document.querySelector<HTMLElement>("#bar-y-val"),
    elongSlider: document.querySelector<HTMLInputElement>("#elong-slider"),
    elongValue: document.querySelector<HTMLElement>("#elong-value"),
    rotSlider: document.querySelector<HTMLInputElement>("#rot-slider"),
    rotValue: document.querySelector<HTMLElement>("#rot-value"),
    checkGd: document.querySelector<HTMLElement>("#check-gd"),
    checkMom: document.querySelector<HTMLElement>("#check-mom"),
    checkAdam: document.querySelector<HTMLElement>("#check-adam"),
    curvesPanel: document.querySelector<HTMLElement>("#curves-panel"),
    playBtn: document.querySelector<HTMLButtonElement>("#play-btn"),
    replayBtn: document.querySelector<HTMLButtonElement>("#replay-btn"),
    replayScrub: document.querySelector<HTMLInputElement>("#replay-scrub"),
    transportEl: document.querySelector<HTMLElement>("#transport"),
    speedWrap: document.querySelector<HTMLElement>("#speed-wrap"),
    speedButtons: [...document.querySelectorAll<HTMLButtonElement>("#speed-wrap button")],
    fogPanel: document.querySelector<HTMLElement>("#fog-panel"),
    fogLevelEl: document.querySelector<HTMLElement>("#fog-level"),
    fogMeas: document.querySelector<HTMLElement>("#fog-meas"),
    fogLoss: document.querySelector<HTMLElement>("#fog-loss"),
    fogBudgetFill: document.querySelector<HTMLElement>("#fog-budget-fill"),
    fogFinishBtn: document.querySelector<HTMLButtonElement>("#fog-finish"),
    fogNote: document.querySelector<HTMLElement>("#fog-reveal-note"),
    fogScoreBody: document.querySelector<HTMLElement>("#fog-scorecard-body"),
    fogVerdict: document.querySelector<HTMLElement>("#fog-verdict"),
    fogRunLead: document.querySelector<HTMLElement>("#fog-run-lead"),
    fogEmptyLead: document.querySelector<HTMLElement>("#fog-empty-lead"),
    fogTrapNote: document.querySelector<HTMLElement>("#fog-trap-note"),
    fogEmptyVerdictNote: document.querySelector<HTMLElement>("#fog-empty-verdict-note"),
    tiltPanel: document.querySelector<HTMLElement>("#tilt-panel"),
    tiltLevelEl: document.querySelector<HTMLElement>("#tilt-level"),
    tiltInputEl: document.querySelector<HTMLElement>("#tilt-input"),
    tiltCells: document.querySelector<HTMLElement>("#tilt-cells"),
    tiltSteps: document.querySelector<HTMLElement>("#tilt-steps"),
    tiltLoss: document.querySelector<HTMLElement>("#tilt-loss"),
    tiltFrictionSlider: document.querySelector<HTMLInputElement>("#tilt-friction"),
    tiltFrictionValue: document.querySelector<HTMLElement>("#tilt-friction-value"),
    tiltFrictionRegime: document.querySelector<HTMLElement>("#tilt-friction-regime"),
    tiltLevelButtons: [
      ...document.querySelectorAll<HTMLButtonElement>("#tilt-levels button"),
    ],
    tiltFinishBtn: document.querySelector<HTMLButtonElement>("#tilt-finish"),
    tiltRestartBtn: document.querySelector<HTMLButtonElement>("#tilt-restart"),
    tiltScoreWrap: document.querySelector<HTMLElement>("#tilt-score"),
    tiltScoreBody: document.querySelector<HTMLElement>("#tilt-scorecard-body"),
    tiltVerdict: document.querySelector<HTMLElement>("#tilt-verdict"),
    tiltReplayWrap: document.querySelector<HTMLElement>("#tilt-replay"),
    tiltReplayBtn: document.querySelector<HTMLButtonElement>("#tilt-replay-play"),
    tiltReplayRestartBtn: document.querySelector<HTMLButtonElement>("#tilt-replay-restart"),
    tiltScrub: document.querySelector<HTMLInputElement>("#tilt-scrub"),
    tiltSwarmLine: document.querySelector<HTMLElement>("#tilt-swarm-line"),
    tiltSwarmClusters: document.querySelector<HTMLElement>("#tilt-swarm-clusters"),
    rulePanel: document.querySelector<HTMLElement>("#rule-panel"),
    ruleLandscapeEl: document.querySelector<HTMLElement>("#rule-landscape"),
    ruleEtaSlider: document.querySelector<HTMLInputElement>("#rule-eta"),
    ruleEtaValue: document.querySelector<HTMLElement>("#rule-eta-value"),
    ruleBetaValue: document.querySelector<HTMLElement>("#rule-beta-value"),
    ruleNormToggle: document.querySelector<HTMLInputElement>("#rule-norm"),
    ruleClipSlider: document.querySelector<HTMLInputElement>("#rule-clip"),
    ruleClipValue: document.querySelector<HTMLElement>("#rule-clip-value"),
    ruleLevelButtons: [
      ...document.querySelectorAll<HTMLButtonElement>("#rule-levels button"),
    ],
    ruleScoreBodies: [
      ...document.querySelectorAll<HTMLElement>("#rule-score-body-a, #rule-score-body-b"),
    ],
    ruleVerdicts: [
      ...document.querySelectorAll<HTMLElement>("#rule-verdict-a, #rule-verdict-b"),
    ],
    epiFormula: document.querySelector<HTMLElement>("#epi-formula"),
    epiLatticeNote: document.querySelector<HTMLElement>("#epi-lattice-note"),
  });

  /* ---------------- reader: a continuous scroll document (v4) ----------------
   *
   * Every .rstep is a full-panel page stacked in flow inside #reader-body —
   * one document, read by scrolling. #reader-body never scrolls natively
   * (overflow: hidden in CSS): wheel deltas accumulate into a VIRTUAL scroll
   * target that the per-frame easing chases, so the next step's text slides
   * in from below as part of the scroll. Crossing the midpoint between two
   * steps' park offsets SNAPS the incoming step into place (the target parks
   * exactly on its offsetTop) and enters it — forward under the lock model
   * (wheel frozen while the scene-entry animation plays; Skip drains it),
   * backward instantly (the scene state steps back; no re-lock required).
   */

  const stepCount = rsteps.length;
  let locked = false;
  let lockStart = 0;

  /* ---------------- the intro park (full-bleed title) ----------------
   *
   * The virtual scroll document starts BELOW zero: the range [-introPark, 0)
   * is the intro — the title + landscape fill the whole viewport and the
   * reader panel is slid off-screen. Crossing y = -introPark/2 downward
   * slides the reader in and the layout settles into the two-pane app (the
   * camera re-centers the scene left of the panel over the same eased
   * ~700ms); crossing it upward re-expands to full-bleed. The intro is a
   * park, not a step: step indices, ?step=N hooks and the rail all keep
   * their meaning.
   */

  /** Intro park depth as a fraction of the reader-body height. */
  const INTRO_PARK_FRAC = 0.62;
  /** Depth (px, positive) of the intro park below the step-0 park. */
  let introPark = 0;
  /** True while the page is full-bleed (reader off, wheel owns the page). */
  let introMode = false;

  /** Park offset (scroll coordinate) of each step's top edge. */
  let tops: number[] = [];
  /** Boundary between step k and k+1: crossing it enters k+1 (or k). */
  let bounds: number[] = [];
  let maxScroll = 0;
  /** Current document position (drives scrollTop through the easing). */
  let scrollY = 0;
  /** Virtual scroll target the easing chases. */
  let targetY = 0;
  /** performance.now() of the last wheel gesture — arms the idle snap. */

  function measureTops(): void {
    tops = rsteps.map((el) => el.offsetTop);
    bounds = tops.slice(0, -1).map((t, k) => (t + tops[k + 1]) / 2);
    maxScroll = Math.max(0, bodyEl.scrollHeight - bodyEl.clientHeight);
    introPark = Math.round(Math.max(240, bodyEl.clientHeight * INTRO_PARK_FRAC));
  }

  function applyScroll(): void {
    scrollY = Math.min(Math.max(scrollY, -introPark), maxScroll);
    bodyEl.scrollTop = Math.max(0, scrollY); // the DOM never scrolls negative
  }

  /** Flips the full-bleed layout: reader slide (CSS), wheel ownership and
   *  the camera's re-centering target (eased in poll, see frameX below). */
  function setIntroMode(on: boolean): void {
    if (on === introMode) return;
    introMode = on;
    applyIntroLayout();
  }

  /** Font swap / resize reflow shifts park offsets: keep the parked step
   *  parked (the whole document shifts by the same delta around `current`);
   *  the intro park re-parks on itself (its depth tracks the viewport). */
  function reanchor(): void {
    const old = tops[current] ?? 0;
    measureTops();
    if (introMode) {
      scrollY = targetY = -introPark;
      applyScroll();
      return;
    }
    const shift = (tops[current] ?? 0) - old;
    if (shift !== 0) {
      scrollY += shift;
      targetY += shift;
      applyScroll();
    }
  }

  function syncReader(dir: 1 | -1): void {
    rsteps.forEach((el, k) => {
      el.dataset.active = String(k === current);
    });
    bodyEl.dataset.dir = dir === -1 ? "back" : "fwd";

    countEl.textContent = `${current + 1} / ${stepCount}`;
    railButtons.forEach((b, k) => {
      b.dataset.current = String(k === current);
      b.dataset.visited = String(k < current);
    });

    skipEl.hidden = !locked;
    hintEl.hidden = locked || current >= stepCount - 1;
    if (!locked) fillEl.style.height = "0%";
  }

  function lock(): void {
    locked = true;
    lockStart = performance.now();
    skipEl.hidden = false;
    hintEl.hidden = true;
  }

  function unlock(): void {
    locked = false;
    skipEl.hidden = true;
    hintEl.hidden = current >= stepCount - 1;
    fillEl.style.height = "0%";
  }

  /**
   * Enter step k as part of the scroll. Forward plays the scene-entry
   * animation under the lock; backward steps the scene state back instantly
   * and never re-locks. `teleport` (far rail jumps) moves the document to
   * the new park in one frame instead of scrolling every page between.
   * Leaving the intro on the way in is implicit: any step entry docks the
   * reader (the camera re-centering follows through applyIntroLayout).
   */
  function enterStep(
    k: number,
    dir: 1 | -1,
    opts: { teleport?: boolean } = {},
  ): void {
    const target = Math.min(Math.max(k, 0), stepCount - 1);
    if (target === current && !introMode) return;
    if (introMode) setIntroMode(false);
    const sameScene = sceneOf(target) === sceneOf(current);
    current = target;
    targetY = tops[current]; // snap the incoming step into place
    if (opts.teleport) {
      scrollY = targetY;
      applyScroll();
    }
    if (!sameScene) {
      director.setScene(sceneOf(current), { instant: dir === -1 });
    }
    syncReader(dir);
    if (dir === 1 && director.animating) lock();
    else unlock();
  }

  function advance(): void {
    if (locked) return;
    if (introMode) {
      // From the full-bleed title, the first advance docks the reader on
      // step 0 (its scene — the hero — is already live).
      setIntroMode(false);
      targetY = tops[0];
      return;
    }
    if (current >= stepCount - 1) return;
    enterStep(current + 1, 1);
  }

  /** Backward re-enters the previous step's state instantly (no re-lock);
   *  from step 0 it re-expands the full-bleed intro. */
  function goBack(): void {
    if (locked) return;
    if (current === 0 && !introMode) {
      setIntroMode(true);
      targetY = -introPark;
      return;
    }
    if (current <= 0) return;
    enterStep(current - 1, -1);
  }

  /** Space semantics: skip the playing animation, or advance. */
  function skipOrAdvance(): void {
    if (locked) director.finishTransitionsNow();
    else advance();
  }

  const railButtons: HTMLButtonElement[] = [];
  for (let k = 0; k < stepCount; k++) {
    const b = document.createElement("button");
    b.type = "button";
    const name = rsteps[k].querySelector("h2")?.textContent?.trim() ?? `Step ${k + 1}`;
    const nameSpan = document.createElement("span");
    nameSpan.className = "tick-name";
    nameSpan.textContent = name;
    b.appendChild(nameSpan);
    b.setAttribute("aria-label", `Go to ${name}`);
    b.addEventListener("click", () => {
      if (locked || (k === current && !introMode)) return;
      if (Math.abs(k - current) === 1 && !(k === 0 && introMode)) {
        enterStep(k, k > current ? 1 : -1); // adjacent: scroll one page
        return;
      }
      enterStep(k, k > current ? 1 : -1, { teleport: true });
    });
    railEl.appendChild(b);
    railButtons.push(b);
  }

  /* ---------------- input: wheel, keys, skip ---------------- */

  /**
   * One gesture's worth of document scroll + boundary crossings, shared by
   * the reader wheel (docked) and the window wheel (intro full-bleed).
   * Crossing a boundary re-parks the target exactly on the new park and
   * performs ONE transition per gesture.
   */
  function nudgeScroll(dy: number): void {
    if (locked) return; // a step is animating — the scroll is frozen
    targetY = Math.min(Math.max(targetY + dy, -introPark), maxScroll);

    // The intro boundary: halfway between the intro park and step 0's park.
    const introBound = -introPark / 2;
    if (introMode) {
      if (targetY >= introBound) {
        setIntroMode(false);
        targetY = tops[0]; // re-park: the reader docks on step 0
      }
      return; // full-bleed: no step crossings below the boundary
    }
    if (current === 0 && targetY <= introBound) {
      setIntroMode(true);
      targetY = -introPark; // re-park in the intro
      return;
    }

    // Crossing a boundary enters the adjacent step (one per gesture:
    // entering re-parks the target exactly on the new step's offset).
    if (current < stepCount - 1 && targetY >= bounds[current]) {
      enterStep(current + 1, 1);
    } else if (current > 0 && targetY <= bounds[current - 1]) {
      enterStep(current - 1, -1);
    }
  }

  // Wheel over the READER scrolls the document: each gesture adds its delta
  // to the virtual scroll target, the text glides, and crossing a step
  // boundary snaps the incoming step into place (and enters it — forward
  // under the lock, backward instantly). While the lock holds, the document
  // is frozen: wheel deltas are dropped, never queued. Wheel over the CANVAS
  // never hits this listener and zooms the camera through LandscapeView's
  // own wheel handler.
  readerEl.addEventListener(
    "wheel",
    (e) => {
      if (e.deltaMode !== 0) return; // line/page scrolling: ignore
      e.preventDefault(); // we own this gesture: the reader is the document
      nudgeScroll(e.deltaY);
    },
    { passive: false },
  );

  // Wheel during the INTRO (full-bleed): the reader is slid off-screen, so
  // the whole viewport scrolls past the intro. The camera's wheel zoom is
  // muted for the duration (setWheelZoomEnabled), making this the only wheel
  // handler that acts; docked, it no-ops and the split policy resumes
  // (canvas = zoom, reader = scroll).
  window.addEventListener(
    "wheel",
    (e) => {
      if (!introMode || locked) return;
      if (e.deltaMode !== 0) return;
      e.preventDefault();
      nudgeScroll(e.deltaY);
    },
    { passive: false },
  );

  // §7 tilt keys: while a tilt run is live, WASD/arrows tilt the BOARD and
  // must not advance the reader (wheel/Space still do). Always keep the
  // director's key set current so releasing a key after leaving tilt-a
  // cannot leave a stuck input.
  const TILT_KEYS = new Set(["w", "a", "s", "d", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
  window.addEventListener("keydown", (e) => {
    if (TILT_KEYS.has(e.key)) {
      director.setTiltKey(e.key, true);
      if (director.wantsTiltKeys) {
        e.preventDefault();
        return;
      }
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!locked) advance();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      goBack();
    } else if (e.key === " " || e.code === "Space") {
      e.preventDefault();
      skipOrAdvance();
    }
  });
  window.addEventListener("keyup", (e) => {
    if (TILT_KEYS.has(e.key)) director.setTiltKey(e.key, false);
  });
  window.addEventListener("blur", () => director.clearTiltKeys());

  skipBtn.addEventListener("click", () => director.finishTransitionsNow());

  // Click-to-advance (Interaction model v2): the continue hint is a button,
  // and a plain click on the reader body also advances. Drags, text
  // selection and clicks on the step's own controls are excluded.
  hintEl.addEventListener("click", () => {
    if (!locked) advance();
  });
  let readerDown: { x: number; y: number } | null = null;
  bodyEl.addEventListener("pointerdown", (e) => {
    readerDown = { x: e.clientX, y: e.clientY };
  });
  bodyEl.addEventListener("click", (e) => {
    if (locked) return;
    const down = readerDown;
    readerDown = null;
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) {
      return; // a drag or text selection, not a click
    }
    const t = e.target as HTMLElement | null;
    if (t && t.closest("button, input, select, label, a, canvas")) return;
    advance();
  });

  // Click-to-advance at the INTRO: a plain click on the full-bleed landscape
  // docks the reader on step 0. Orbit drags and the camera preset buttons
  // are excluded (the 8px travel guard, the button closest() check).
  let stageDown: { x: number; y: number } | null = null;
  stage.addEventListener("pointerdown", (e) => {
    stageDown = { x: e.clientX, y: e.clientY };
  });
  stage.addEventListener("click", (e) => {
    if (!introMode || locked) return;
    const down = stageDown;
    stageDown = null;
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) {
      return; // an orbit drag, not a click
    }
    const t = e.target as HTMLElement | null;
    if (t && t.closest("button")) return; // Isometric / Map view buttons
    setIntroMode(false);
    targetY = tops[0];
  });

  /* ---------------- hover-to-look (declarative registry) ----------------
   *
   * `.look[data-look]` spans in the reader spotlight WHERE to look on the
   * scene. Pure lens: hovering/focusing never advances, never locks, never
   * animates — so it cannot fight the step lock. Only the ACTIVE step's
   * spans respond (inactive pages have pointer-events: none already; the
   * active guard also covers keyboard focus roaming to other pages).
   */

  const lookFromEvent = (e: Event): string | null => {
    const t = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-look]");
    if (!t) return null;
    const step = t.closest(".rstep") as HTMLElement | null;
    if (step?.dataset.active !== "true") return null;
    return t.dataset.look ?? null;
  };
  bodyEl.addEventListener("pointerover", (e) => {
    director.setLook(lookFromEvent(e));
  });
  bodyEl.addEventListener("pointerout", (e) => {
    if (lookFromEvent(e) !== null) director.setLook(null);
  });
  bodyEl.addEventListener("focusin", (e) => {
    const id = lookFromEvent(e);
    if (id !== null) director.setLook(id);
  });
  bodyEl.addEventListener("focusout", (e) => {
    if (lookFromEvent(e) !== null) director.setLook(null);
  });

  /* ---------------- per-frame reader upkeep ---------------- */

  let lastFrame = performance.now();
  function poll(): void {
    requestAnimationFrame(poll);
    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;

    // Ease the document toward the virtual scroll target: wheel glides and
    // boundary snaps both land as one smooth motion (~cubic out, ~700ms).
    if (scrollY !== targetY) {
      const approach = (targetY - scrollY) * (1 - Math.exp(-dt * 9));
      scrollY = Math.abs(targetY - scrollY) <= 0.25 ? targetY : scrollY + approach;
      applyScroll();
    }

    // Ease the camera's horizontal re-centering toward the layout target
    // (0 = full-bleed intro, readerWidth/2 = docked two-pane): the landscape
    // glides out from under the reader as it slides in, on the same clock.
    if (Math.abs(frameXTarget - frameXApplied) > 0.5) {
      frameXApplied += (frameXTarget - frameXApplied) * (1 - Math.exp(-dt * 9));
      if (Math.abs(frameXTarget - frameXApplied) <= 0.5) frameXApplied = frameXTarget;
      view.setFrameOffsetX(Math.round(frameXApplied * 10) / 10);
    }

    // No idle snap: partial progress between parks PERSISTS, so hesitant
    // notch-at-a-time scrolling accumulates toward the next boundary instead
    // of being yanked back after 160ms of quiet (QA IMP-1/VIS-1/N5-R5-1 —
    // the discarded distance made paced wheel scrolling permanently inert).
    // The document is one continuous reader; resting mid-seam is normal.

    if (!locked) return;
    const elapsed = now - lockStart;
    const progress = director.animating ? director.animProgress : 1;
    const shown = Math.min(1, Math.max(progress, elapsed > 350 ? 1 : 0.06));
    // Style-write only on change: a per-frame write of the same value still
    // forces recalc/paint of the reader pane (measurable in software GL).
    const pct = `${Math.round(shown * 100)}%`;
    if (fillEl.style.height !== pct) fillEl.style.height = pct;
    if (!director.animating && elapsed >= 350) unlock();
  }
  requestAnimationFrame(poll);

  /* ---------------- framing: the intro ↔ two-pane layout ----------------
   *
   * The camera's horizontal framing offset glides between the two layout
   * states: full-bleed intro centers the scene in the whole viewport
   * (offset 0); docked, it re-centers left of the reader panel
   * (+panelWidth/2). `applyIntroLayout` states the target; poll() eases the
   * applied value on the same clock as the reader's CSS slide.
   */

  let frameXApplied = 0;
  let frameXTarget = 0;

  function readerHalf(): number {
    const w = readerEl.getBoundingClientRect().width;
    return w > 0 ? w / 2 : 0;
  }

  function applyIntroLayout(): void {
    appEl.dataset.intro = String(introMode);
    // Full-bleed owns the wheel: the camera must not zoom during the intro.
    view.setWheelZoomEnabled(!introMode);
    frameXTarget = introMode ? 0 : readerHalf();
  }

  /** Resize / reflow: recompute the framing target and snap (no ease). */
  function applyFrameX(): void {
    applyIntroLayout();
    frameXApplied = frameXTarget;
    view.setFrameOffsetX(frameXApplied);
  }
  window.addEventListener("resize", () => {
    applyFrameX();
    reanchor();
  });

  /* ---------------- boot ---------------- */

  // Deep links: shots snap to their scene (fully instant, frozen); ?step=N
  // parks the document on page N and plays that scene's entry animation
  // under the lock model, so the landed state is deterministic once it
  // drains. A fresh boot starts in the INTRO PARK — full-bleed title, reader
  // slid off — and ?shot=hero / ?shot=intro pin that same full-bleed pose
  // deterministically; every other deep link boots docked.
  const initialIndex = shot
    ? SCENE_ORDER.indexOf(shot)
    : stepIndex ?? 0;
  const startIntro = shot
    ? sceneOf(initialIndex) === "hero"
    : stepIndex === null;
  director.frozen = shot !== null;
  if (fogswarmShot) director.presetSwarmBlind(true);
  measureTops();
  introMode = startIntro;
  applyIntroLayout();
  frameXApplied = frameXTarget; // boot snaps: no entrance ease on load
  view.setFrameOffsetX(frameXApplied);
  scrollY = targetY = startIntro ? -introPark : tops[initialIndex];
  applyScroll();
  director.boot(shot ? sceneOf(initialIndex) : SCENE_ORDER[0]);
  current = initialIndex;
  syncReader(1);
  if (initialIndex > 0 && !shot) {
    director.setScene(sceneOf(current), { instant: false });
    if (director.animating) lock();
  }
  if (shot) {
    director.finishTransitionsNow();
    unlock();
  }
  // Late font swap reflows the document: re-measure and re-park.
  document.fonts?.ready.then(() => reanchor());

  // Reveal: hold the boot overlay until the scene is built, the fonts are
  // ready, and the first real frame has painted — the first load shows the
  // title + progress line the whole time, then fades; no pop, no blank.
  Promise.resolve(document.fonts?.ready ?? null).then(() => {
    requestAnimationFrame(() => requestAnimationFrame(finishBoot));
  });

  /* ---------------- §2/§3/§4/§5 instrument wiring ---------------- */

  // η slider (§2 gd-c): every input re-runs GD from the fixed start.
  etaSlider?.addEventListener("input", () => {
    const t = Number(etaSlider.value) / 1000;
    const logMin = Math.log10(0.002);
    const eta = Math.pow(10, logMin + t * (Math.log10(2) - logMin));
    director.setEta(eta);
  });

  // β sliders (§3 mom-a + mom-b): either copy drives the same momentum
  // state; both stay in sync through syncBetaUi.
  for (const slider of document.querySelectorAll<HTMLInputElement>(".beta-slider")) {
    slider.addEventListener("input", () => {
      director.setBeta(Number(slider.value) / 1000);
    });
  }

  // Steepness slider (§4 adam-a): scales λ1 live; same extent throughout.
  const steepSlider = document.querySelector<HTMLInputElement>("#steep-slider");
  steepSlider?.addEventListener("input", () => {
    const t = Number(steepSlider.value) / 1000;
    director.setSteepness(Math.pow(10, t * Math.log10(50)));
  });

  // §5 lab sliders: elongation is a log sweep ×1→×50; rotation 0→90°.
  const elongSlider = document.querySelector<HTMLInputElement>("#elong-slider");
  elongSlider?.addEventListener("input", () => {
    const t = Number(elongSlider.value) / 1000;
    const rot = director.labParams?.rot ?? 30;
    director.setLab(Math.pow(10, t * Math.log10(50)), rot);
  });
  const rotSlider = document.querySelector<HTMLInputElement>("#rot-slider");
  rotSlider?.addEventListener("input", () => {
    const E = director.labParams?.E ?? 50;
    director.setLab(E, (Number(rotSlider.value) / 1000) * 90);
  });
  const curvesLog = document.querySelector<HTMLInputElement>("#curves-log");
  curvesLog?.addEventListener("change", () => {
    director.setCurvesLog(curvesLog.checked);
  });

  // Universal play transport (§2/§3/§4/§5, §6 reveal, §8): ▶/❚❚ toggle,
  // ↻ restart, scrub bar, 0.5×/1×/2×. Space stays a READER key (skip/advance)
  // and never touches the transport.
  document.querySelector<HTMLButtonElement>("#play-btn")?.addEventListener("click", () => {
    director.toggleReplay();
  });
  document.querySelector<HTMLButtonElement>("#replay-btn")?.addEventListener("click", () => {
    director.playReplay();
  });
  const replayScrubEl = document.querySelector<HTMLInputElement>("#replay-scrub");
  replayScrubEl?.addEventListener("input", () => {
    director.setReplayScrub(Number(replayScrubEl.value) / 1000);
  });
  for (const b of document.querySelectorAll<HTMLButtonElement>("#speed-wrap button")) {
    b.addEventListener("click", () => {
      director.setReplaySpeed(Number(b.dataset.speed));
    });
  }

  // §6 fog game: Finish ends the run and fires the reveal beat.
  document.querySelector<HTMLButtonElement>("#fog-finish")?.addEventListener("click", () => {
    director.finishFogRun();
  });

  /* ---------------- §7 tilt game wiring ---------------- */

  // Friction = damping (the β analogy): slider 0..1000 → c ∈ [0, 2.2], live.
  const tiltFriction = document.querySelector<HTMLInputElement>("#tilt-friction");
  tiltFriction?.addEventListener("input", () => {
    director.setTiltFriction((Number(tiltFriction.value) / 1000) * 2.2);
  });
  // Level buttons: swap the terrain in place, fresh run.
  for (const b of document.querySelectorAll<HTMLButtonElement>("#tilt-levels button")) {
    b.addEventListener("click", () => {
      director.setTiltLevel(b.dataset.level as Parameters<Director["setTiltLevel"]>[0]);
    });
  }
  document.querySelector<HTMLButtonElement>("#tilt-finish")?.addEventListener("click", () => {
    director.finishTiltRun();
  });
  // Restart run: a fresh, unsteered run at the current level (the board
  // re-arms; counters zero).
  document.querySelector<HTMLButtonElement>("#tilt-restart")?.addEventListener("click", () => {
    director.restartTiltRun();
  });
  // Replay scrubber + ghost play (tilt-b).
  const tiltScrubEl = document.querySelector<HTMLInputElement>("#tilt-scrub");
  tiltScrubEl?.addEventListener("input", () => {
    director.setTiltScrub(Number(tiltScrubEl.value) / 1000);
  });
  document.querySelector<HTMLButtonElement>("#tilt-replay-play")?.addEventListener("click", () => {
    director.playTiltGhost();
  });
  document.querySelector<HTMLButtonElement>("#tilt-replay-restart")?.addEventListener("click", () => {
    director.restartTiltGhost();
  });
  // "Run it blind" (swarm step): hide the map (§6's fog) and let the swarm
  // paint every cell it crosses. Flipping it re-runs the swarm cleanly.
  const swarmBlind = document.querySelector<HTMLInputElement>("#swarm-blind");
  if (fogswarmShot && swarmBlind) swarmBlind.checked = true; // match the preset
  swarmBlind?.addEventListener("change", () => {
    director.setSwarmBlind(swarmBlind.checked);
  });

  /* ---------------- §8 workbench wiring ---------------- */

  // η dial (log sweep 0.002 → 2, the §2 convention) — every move re-runs
  // the benchmark against the same three machines.
  const ruleEta = document.querySelector<HTMLInputElement>("#rule-eta");
  ruleEta?.addEventListener("input", () => {
    director.setRulePart({ lr: ruleEtaFromKnob(Number(ruleEta.value)) });
  });
  // β: 0..0.99, linear like §3.
  const ruleBeta = document.querySelector<HTMLInputElement>("#rule-beta");
  ruleBeta?.addEventListener("input", () => {
    director.setRulePart({ beta: Number(ruleBeta.value) / 1000 });
  });
  // Clip: knob 0 = off, else log 0.05 → 2.0.
  const ruleClip = document.querySelector<HTMLInputElement>("#rule-clip");
  ruleClip?.addEventListener("input", () => {
    director.setRulePart({ clip: ruleClipFromKnob(Number(ruleClip.value)) });
  });
  // Per-coordinate normalize: the Adam part.
  const ruleNorm = document.querySelector<HTMLInputElement>("#rule-norm");
  ruleNorm?.addEventListener("change", () => {
    director.setRulePart({ normalize: ruleNorm.checked });
  });
  // Landscape pills: the no-free-lunch beat (same rule, new terrain).
  for (const b of document.querySelectorAll<HTMLButtonElement>("#rule-levels button")) {
    b.addEventListener("click", () => {
      director.setRuleLevel(b.dataset.level as Parameters<Director["setRuleLevel"]>[0]);
    });
  }

  // Grab cursor when hovering the draggable §1 point.
  stage.addEventListener("pointermove", (e) => {
    const cv = stage.querySelector<HTMLCanvasElement>(".lv-canvas");
    if (!cv) return;
    if (!director.surfaceDragEnabled) {
      cv.style.cursor = "";
      return;
    }
    const d = director.screenDistanceToBall(e.clientX, e.clientY);
    cv.style.cursor = d !== null && d <= 26 ? "grab" : "";
  });

  /* ---------------- diagnostics (smoke checks only) ---------------- */

  type Diagnostics = {
    scene: () => SceneName;
    step: () => number;
    count: () => number;
    locked: () => boolean;
    animating: () => boolean;
    /** v4 reader scroll state: positions, park offsets, snap/lock helpers. */
    scroll: () => {
      y: number;
      target: number;
      max: number;
      tops: number[];
      parked: boolean;
      atSnap: boolean;
      intro: boolean;
      introPark: number;
    };
    /** Intro choreography layout state (full-bleed ↔ two-pane). */
    layout: () => {
      intro: boolean;
      introPark: number;
      frameX: number;
      readerTransform: string;
      overlayRight: string;
    };
    fit: () => { w: number; b: number };
    loss: () => number;
    ballScreen: () => { x: number; y: number } | null;
    gd: () => Director["gdState"];
    debug: () => Director["debugSnap"];
    mom: () => Director["momState"];
    adam: () => Director["adamState"];
    lab: () => Director["labState"];
    fog: () => Director["fogState"];
    tilt: () => Director["tiltState"];
    swarm: () => Director["swarmState"];
    rule: () => Director["ruleState"];
    epi: () => Director["epiState"];
    replayInfo: () => Director["replayInfo"];
    look: () => Director["lookState"];
    skip: () => void;
    flashStrideReject: () => void;
  };
  (window as unknown as { __wp1: Diagnostics }).__wp1 = {
    scene: () => sceneOf(current),
    step: () => current,
    count: () => rsteps.length,
    locked: () => locked,
    animating: () => director.animating,
    scroll: () => ({
      y: Math.round(scrollY * 10) / 10,
      target: Math.round(targetY * 10) / 10,
      max: Math.round(maxScroll),
      tops: tops.map((t) => Math.round(t)),
      parked: Math.abs(scrollY - (tops[current] ?? 0)) < 2,
      atSnap: Math.abs(targetY - (tops[current] ?? 0)) < 1,
      intro: introMode,
      introPark: Math.round(introPark),
    }),
    layout: () => ({
      intro: introMode,
      introPark: Math.round(introPark),
      frameX: Math.round(view.frameOffsetX),
      readerTransform: getComputedStyle(readerEl).transform,
      overlayRight: getComputedStyle(document.querySelector<HTMLElement>("#hero-overlay")!).right,
    }),
    fit: () => {
      const f = director.currentFit;
      return { w: f.x, b: f.y };
    },
    loss: () => leastSquares.f(director.currentFit),
    ballScreen: () => director.ballScreen(),
    gd: () => director.gdState,
    debug: () => director.debugSnap,
    mom: () => director.momState,
    adam: () => director.adamState,
    lab: () => director.labState,
    fog: () => director.fogState,
    tilt: () => director.tiltState,
    swarm: () => director.swarmState,
    rule: () => director.ruleState,
    epi: () => director.epiState,
    replayInfo: () => director.replayInfo,
    look: () => director.lookState,
    skip: () => director.finishTransitionsNow(),
    flashStrideReject: () => minimap.flashStrideReject(),
  };
} else {
  // The app shell is malformed (a required element is missing): surface it
  // on the boot overlay instead of leaving it frozen mid-progress.
  failBoot(
    "The page is incomplete",
    "A required part of the app shell failed to load. Reload the page; " +
      "if this persists, the deployment itself may be broken.",
  );
}
