/**
 * WP-A1 entry — the two-pane app ("You Can't See the Loss").
 *
 * LEFT pane: the fixed full-viewport landscape canvas and every instrument.
 * RIGHT pane: the reader — ONE CONTINUOUS SCROLL DOCUMENT (v4). Every step's
 * text is a full-panel page stacked in flow inside #reader-body; wheeling
 * scrolls them like a document (the next step's text slides in from below as
 * part of the scroll), and when the scroll reaches the incoming step it SNAPS
 * into place — then its core animation plays under the lock (wheel frozen;
 * Skip completes it instantly; every forward entry locks, and the lock
 * releases when the animation drains — or after ~350ms when the entry has no
 * animation).
 * Scrolling back up re-enters the previous step with the scene state stepping
 * back instantly — no re-lock. Wheel over the canvas zooms the camera and
 * never advances. ArrowDown/Space match the wheel, ArrowUp reverses, the
 * right-edge rail tracks the active step and jumps anywhere. ↑/↓ always
 * page the reader — even during live §7 tilt play, which steers with WASD
 * and ←/→ only (QA S2-BWD-1).
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
import { Director, SCENES, SCENE_ORDER, type SceneName } from "./scenes/director";
import { SWARM_MAPS, type SwarmMapId } from "./scenes/tiltGame";
import { ruleClipFromKnob, ruleEtaFromKnob } from "./scenes/ruleLab";
import {
  TourEngine,
  TOURS,
  TOUR_SCENE_HOST,
  type TourDef,
  type TourHost,
  type TourSnapshot,
} from "./view/tourEngine";
import { segmentReader, resolveSentence, sentenceAt } from "./view/sentences";

const params = new URLSearchParams(window.location.search);

/** ?shot=… → scene name (invalid values fall back to null). */
function parseShot(raw: string | null): SceneName | null {
  return SCENE_ORDER.includes(raw as SceneName) ? (raw as SceneName) : null;
}

// ?shot=fogswarm — the §7 swarm in its DEFAULT blind state (the §6 fog mask
// + the ensemble painting every cell it crosses; blind is the swarm's boot
// mode since 2026-11-13), pinned to an EARLIER frozen pose so the terrain
// reads as partially painted. ?shot=intro is the full-bleed intro title's
// canonical hook: it renders the same hero pose as ?shot=hero (now always
// full-bleed — see the intro park below).
const fogswarmShot = params.get("shot") === "fogswarm";
const introShot = params.get("shot") === "intro";
const shot = parseShot(
  fogswarmShot ? "swarm" : introShot ? "hero" : params.get("shot"),
);
const stepRaw = Number.parseInt(params.get("step") ?? "", 10);
const stepIndex = Number.isInteger(stepRaw)
  ? Math.min(SCENE_ORDER.length - 1, Math.max(0, stepRaw))
  : null;
// ?map=<swarm country> — pairs with ?shot=swarm to pin a NON-default picker
// map (the landscape pills live only in the live dock; deep links need their
// own handle). Invalid ids fall back to the default multi-well.
const swarmMapRaw = params.get("map");
const swarmMapParam: SwarmMapId | null =
  swarmMapRaw && SWARM_MAPS.some((m) => m.id === swarmMapRaw)
    ? (swarmMapRaw as SwarmMapId)
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
  // Chromium's "ResizeObserver loop …" notice is a benign layout-timing
  // report, not a script failure — never a boot failure.
  if (typeof ev.message === "string" && ev.message.startsWith("ResizeObserver loop")) return;
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
      // also work); any other left-drag PANS the camera and a right-drag orbits.
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
    onCommit: (tip, g) => director.onArrowCommit(tip, g),
    onCancel: () => director.onArrowCancel(),
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
    // Footer transport + the §7 ghost row share one speed (QA TP2-TILT-NO-SPEED).
    speedButtons: [...document.querySelectorAll<HTMLButtonElement>("#speed-wrap button, #tilt-speed button")],
    fogPanel: document.querySelector<HTMLElement>("#fog-panel"),
    fogCaption: document.querySelector<HTMLElement>("#fog-caption"),
    fitCaptionAct: document.querySelector<HTMLElement>("#fit-caption-act"),
    tiltRunLead: document.querySelector<HTMLElement>("#tilt-run-lead"),
    tiltDemoLead: document.querySelector<HTMLElement>("#tilt-demo-lead"),
    tiltEmptyLead: document.querySelector<HTMLElement>("#tilt-empty-lead"),
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
    tiltLevels: document.querySelector<HTMLElement>("#tilt-levels"),
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
    tiltKeysMessage: document.querySelector<HTMLElement>("#tilt-keys-message"),
    tiltSwarmClusters: document.querySelector<HTMLElement>("#tilt-swarm-clusters"),
    swarmDock: document.querySelector<HTMLElement>("#swarm-dock"),
    // §5 lab dock (the swarm-dock pattern, COPY-PLAN §2.10): the lab
    // sliders + checklist live on the canvas pane, visible on both lab pages.
    labDock: document.querySelector<HTMLElement>("#lab-dock"),
    swarmMapButtons: [
      ...document.querySelectorAll<HTMLButtonElement>("#swarm-maps button"),
    ],
    swarmReplayBtn: document.querySelector<HTMLButtonElement>("#swarm-replay-play"),
    swarmRestartBtn: document.querySelector<HTMLButtonElement>("#swarm-replay-restart"),
    swarmScrub: document.querySelector<HTMLInputElement>("#swarm-scrub"),
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
    // The function card (FUNC-CARD): the docked formula chip — content is
    // synced by the director (syncFuncCard), visibility rides data-visible.
    funcCard: document.querySelector<HTMLElement>("#func-card"),
    funcCardTitle: document.querySelector<HTMLElement>("#func-card-title"),
    funcCardMath: document.querySelector<HTMLElement>("#func-card-math"),
    funcCardVals: document.querySelector<HTMLElement>("#func-card-vals"),
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
  /** Monotone within one lock (QA F16-FOGC-FILL-PEG): the edge-fill hint
   *  never moves backwards while a step's animation plays. */
  let fillLatch = 0;

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

  // Dock-gesture guard (QA KW-5): the wheel notch that crosses the intro
  // boundary docks the reader and hands the canvas its zoom back in the SAME
  // gesture — the leftover notches would otherwise zoom immediately. While
  // the guard is armed, wheel events are swallowed (and re-arm the idle
  // timer, covering trackpad inertia); a deliberate new gesture after 300ms
  // of idle zooms at once.
  const DOCK_GESTURE_IDLE_MS = 300;
  let dockGestureTimer = 0;
  function armDockGestureGuard(): void {
    clearTimeout(dockGestureTimer);
    dockGestureTimer = window.setTimeout(releaseDockGestureGuard, DOCK_GESTURE_IDLE_MS);
    view.setWheelZoomEnabled(false);
  }
  function releaseDockGestureGuard(): void {
    dockGestureTimer = 0;
    view.setWheelZoomEnabled(!introMode);
  }

  /** §8 labrule fit levels (QA L900-LABRULE-STEP22-UNDERFOLD): the step's
   *  height depends on the reader width and the live scoreboard text, so
   *  measure it — the lightest level whose page fits the park wins. The
   *  bottom padding tracks the live footer (it wraps at narrow widths); the
   *  same measured value feeds EVERY step's --foot-clear (QA RF-2: a
   *  wrapped/tall footer must not sit under any step's tail), with the base
   *  84px kept via max() so the default layout never moves. */
  const footEl = document.querySelector<HTMLElement>("#reader-foot");
  /** Scenes with measured fit tiers, and their ladders (A1: fog-c/tilt-a
   *  joined labrule — at a 700px park their parked content overflowed past
   *  the footer; labrule gained the fit-3 floor). The lightest level whose
   *  page fits the park wins; the deepest tier is the fall-through. */
  const FIT_LADDERS: Record<string, string[]> = {
    labrule: ["0", "1", "2", "3"],
    "fog-c": ["0", "1", "2"],
    "tilt-a": ["0", "1", "2"],
  };
  function fitLabrule(): void {
    const footClear = `${Math.ceil((footEl?.offsetHeight ?? 46) + 12)}px`;
    if (bodyEl.style.getPropertyValue("--foot-clear") !== footClear) {
      bodyEl.style.setProperty("--foot-clear", footClear); // inherits to every .rstep
    }
    const park = bodyEl.clientHeight;
    for (const el of rsteps) {
      const ladder = FIT_LADDERS[el.dataset.scene ?? ""];
      if (!ladder) continue;
      let lvl = ladder[ladder.length - 1];
      for (const l of ladder) {
        el.dataset.fit = l;
        if (el.offsetHeight <= park) { lvl = l; break; }
      }
      el.dataset.fit = lvl;
    }
  }

  function measureTops(): void {
    fitLabrule();
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
   *  the intro park re-parks on itself (its depth tracks the viewport).
   *  `repark: false` (content reflow, QA S2EPI-1 / L900-LABRULE-STALE-TOPS-
   *  PARK) only re-measures during the intro: it must not yank a partially
   *  nudged intro target. */
  function reanchor(opts: { repark?: boolean } = { repark: true }): void {
    const old = tops[current] ?? 0;
    const oldMax = maxScroll;
    measureTops();
    if (introMode) {
      if (opts.repark !== false) {
        scrollY = targetY = -introPark;
        noteReaderMotion();
        applyScroll();
      }
      return;
    }
    const shift = (tops[current] ?? 0) - old;
    if (shift !== 0) {
      scrollY += shift;
      targetY += shift;
      noteReaderMotion(); // reflow moved content without an ease
    }
    // A page that shrank must not leave the target past the end.
    targetY = Math.min(Math.max(targetY, -introPark), maxScroll);
    if (shift !== 0 || maxScroll !== oldMax) applyScroll();
  }

  function syncReader(dir: 1 | -1): void {
    rsteps.forEach((el, k) => {
      el.dataset.active = String(k === current);
      // Inactive pages leave the Tab order entirely (QA LOOK-KB-DESYNC):
      // pointer-events:none blocked only the pointer, so their 34 look
      // spans, inputs and links stayed focusable — and a focus there made
      // Chromium natively scroll #reader-body behind the virtual scroll.
      el.inert = k !== current;
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
    refreshTourEntry(); // FIX-4: the entry relabels/reveals per parked step
  }

  function lock(): void {
    locked = true;
    lockStart = performance.now();
    fillLatch = 0;
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
   * Enter step k as part of the scroll. Every forward entry locks (a
   * no-animation entry auto-releases after ~350ms; an animated entry drains
   * under the lock as before); backward steps the scene state back instantly
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
    // Every step change drops the hover-to-look spotlight (QA
    // LOOK-STALE-SAMESCENE): the director only clears it on a SCENE change,
    // so a same-scene step (lab 13→14) kept a stale dim + ring. A focused
    // look span on a page that is no longer current is blurred too, so no
    // stray focus event can revive it. (setLook(null) is idempotent, so the
    // director's own clear on a cross-scene step becomes a no-op.)
    director.setLook(null);
    const focused = document.activeElement;
    if (
      focused instanceof HTMLElement &&
      focused.closest("[data-look]") &&
      focused.closest(".rstep") !== rsteps[current]
    ) {
      focused.blur();
    }
    targetY = tops[current]; // snap the incoming step into place
    noteReaderMotion(); // covers the teleport (scrollY = targetY, no ease)
    if (opts.teleport) {
      scrollY = targetY;
      applyScroll();
    }
    if (!sameScene) {
      director.setScene(sceneOf(current), { instant: dir === -1 });
    }
    // Re-target the framing (the inspector nudge depends on the scene) and
    // glide it like the reader slide (QA LW24-ADAM-BALL-UNDER-PANEL-1280).
    applyIntroLayout();
    syncReader(dir);
    // EVERY forward entry locks (user feedback 2026-11-13): the old
    // `dir === 1 && director.animating` left the steps with no entry
    // animation (the same-scene steps 14, 19, 23) unlocked, so a held key or
    // a wheel burst ran straight through them. poll() releases a lock whose
    // step is not animating after ~350ms (main.ts poll loop), so a
    // no-animation entry holds just long enough to register as a step; an
    // animated entry drains as before. Backward entries step the scene state
    // back instantly and never re-lock.
    if (dir === 1) lock();
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
  /* FIX-RAIL (user feedback: clicks between ticks did nothing / missed the
     small targets): one jump entry point shared by the ticks and the rail's
     own surface. The CSS gives every tick an equal, contiguous flex cell
     (the hit area), and the rail routes clicks and hovers through
     nearest-tick math — a click ANYWHERE on the strip (between ticks, on
     the padding) lands on the NEAREST step, and hovering transiently
     highlights it ([data-near]). The step lock is respected exactly as
     before: a locked jump is ignored, not queued. */
  const goToStep = (k: number): void => {
    if (locked || (k === current && !introMode)) return;
    if (Math.abs(k - current) === 1 && !(k === 0 && introMode)) {
      enterStep(k, k > current ? 1 : -1); // adjacent: scroll one page
      return;
    }
    enterStep(k, k > current ? 1 : -1, { teleport: true });
  };
  /** The tick whose cell center is nearest to a viewport y. */
  const nearestTick = (y: number): number => {
    let best = 0;
    let bestDist = Infinity;
    for (const [k, b] of railButtons.entries()) {
      const r = b.getBoundingClientRect();
      const d = Math.abs(r.top + r.height / 2 - y);
      if (d < bestDist) {
        bestDist = d;
        best = k;
      }
    }
    return best;
  };
  let railNear = -1;
  for (let k = 0; k < stepCount; k++) {
    const b = document.createElement("button");
    b.type = "button";
    const name = rsteps[k].querySelector("h2")?.textContent?.trim() ?? `Step ${k + 1}`;
    const nameSpan = document.createElement("span");
    nameSpan.className = "tick-name";
    nameSpan.textContent = name;
    b.appendChild(nameSpan);
    b.setAttribute("aria-label", `Go to ${name}`);
    b.addEventListener("click", (e) => {
      e.stopPropagation(); // the tick answered; the rail fallback must not re-run
      goToStep(k);
    });
    railEl.appendChild(b);
    railButtons.push(b);
  }
  // Clicks on the rail surface itself (padding, any future gap): nearest tick.
  railEl.addEventListener("click", (e) => {
    goToStep(nearestTick(e.clientY));
  });
  // Hovering between ticks transiently highlights the nearest one.
  railEl.addEventListener("pointermove", (e) => {
    const k = nearestTick(e.clientY);
    if (k === railNear) return;
    railNear = k;
    for (const [i, b] of railButtons.entries()) {
      if (i === k) b.setAttribute("data-near", "true");
      else b.removeAttribute("data-near");
    }
  });
  railEl.addEventListener("pointerleave", () => {
    railNear = -1;
    for (const b of railButtons) b.removeAttribute("data-near");
  });

  /* COPY-PLAN §2.15/§2.19 — the inline jump buttons inside the fog-c
     empty-run lead and the tilt-b ghost leads. Same entry point the rail
     ticks use above (enterStep), targeted by the step's data-scene so the
     wiring survives reader reordering. The controls are E1's answer to
     "the action lives on another page": the step ships its own jump. */
  for (const b of document.querySelectorAll<HTMLButtonElement>(
    "#fog-goto-l2, #tilt-goto-drive, #tilt-goto-drive-empty",
  )) {
    b.addEventListener("click", () => {
      const scene = b.id === "fog-goto-l2" ? "fog-b" : "tilt-a";
      const k = rsteps.findIndex((el) => el.dataset.scene === scene);
      if (k < 0 || (k === current && !introMode)) return;
      // An explicit jump is a user command, not a step advance (QA
      // COPY-JUMP-LOCK): while the step's entry lock holds (fog-c's reveal
      // choreography runs ~8s, and this button is ON that page), draining
      // the entry like Skip does beats silently dropping the click — the
      // control the copy ships as the answer to "the action lives on
      // another page" must never be a no-op on its own page. The backward
      // jump itself re-enters instantly (no re-lock), so nothing queues.
      if (locked) director.finishTransitionsNow();
      enterStep(k, k > current ? 1 : -1, { teleport: Math.abs(k - current) > 1 });
    });
  }

  /* ---------------- input: wheel, keys, skip ---------------- */

  /** Wheel delta in CSS px, whatever unit the device reports (0 = px,
   *  1 = lines, 2 = pages). QA F16-DELTAMODE-DEAD: line/page wheels used to
   *  be dropped outright, and #reader-body is overflow:hidden, so there was
   *  no native fallback — those wheels did nothing at all. */
  const WHEEL_LINE_PX = 32; // ~a browser line height: 3 lines/notch ≈ 96 px ≈ a pixel-mode notch
  function wheelPx(e: WheelEvent): number {
    // Read deltaY BEFORE deltaMode: Firefox reports pixel mode to handlers
    // that touch deltaY first (line mode to legacy handlers checking
    // deltaMode first) — a cheap hedge either way.
    const dy = e.deltaY;
    if (e.deltaMode === 1) return dy * WHEEL_LINE_PX;
    if (e.deltaMode === 2) return dy * bodyEl.clientHeight;
    return dy;
  }

  /**
   * One gesture's worth of document scroll + boundary crossings, shared by
   * the reader wheel (docked) and the window wheel (intro full-bleed).
   * Crossing a boundary re-parks the target exactly on the new park and
   * performs ONE transition per gesture.
   */
  function nudgeScroll(dy: number): void {
    if (locked) return; // a step is animating — the scroll is frozen
    // Forward motion stops at the LAST step's park (user feedback
    // 2026-11-13): maxScroll runs past tops[last] whenever the final page
    // overflows the viewport, and wheeling into that zone scrolled the
    // document into a dead stretch past the last step with nothing left to
    // cross. Keys, the hint and rail ticks already refuse past the last
    // step (advance()); the wheel now refuses with them.
    const lastPark = tops[stepCount - 1] ?? maxScroll;
    targetY = Math.min(Math.max(targetY + dy, -introPark), Math.min(maxScroll, lastPark));

    // The intro boundary: halfway between the intro park and step 0's park.
    const introBound = -introPark / 2;
    if (introMode) {
      if (targetY >= introBound) {
        setIntroMode(false);
        targetY = tops[0]; // re-park: the reader docks on step 0
        armDockGestureGuard(); // consume the rest of this gesture (QA KW-5)
      }
      return; // full-bleed: no step crossings below the boundary
    }
    if (current === 0 && targetY <= introBound) {
      setIntroMode(true);
      targetY = -introPark; // re-park in the intro
      stepGestureGuard = true; // the rest of this gesture is spent
      return;
    }

    // Crossing a boundary enters the adjacent step (one per gesture:
    // entering re-parks the target exactly on the new step's offset, and
    // the step-gesture guard swallows the rest of the gesture — QA KW-8).
    if (current < stepCount - 1 && targetY >= bounds[current]) {
      enterStep(current + 1, 1);
      stepGestureGuard = true;
    } else if (current > 0 && targetY <= bounds[current - 1]) {
      enterStep(current - 1, -1);
      stepGestureGuard = true;
    }
  }

  /**
   * Step-gesture guard (QA KW-8 — "steps not locking on fast wheel"): ONE
   * boundary crossing per wheel gesture. Before, the lock dropped deltas
   * only while it was held, so a single fling or fast spin that outlasted a
   * short entry animation sailed on into the next step the moment the lock
   * released — and straight through the steps with no entry animation (the
   * same-scene steps 14, 19, 23), which then never appeared to lock at all.
   * Probe (tools/probe-stepper-lock.mjs, pre-fix build): 70 notches at
   * 50 ms from step 4 ran 4→11; 30 fast notches ran 13→16 and 18→21; a
   * spin held through a rail-jump lock ran 8→11. Now, once a gesture
   * crosses a boundary — or is dropped by the lock — every further wheel
   * event of that gesture is swallowed until the wheel has been idle for
   * STEP_GESTURE_IDLE_MS: a new gesture is needed to move on (PLAN.md:26 —
   * "continue ↓" shows, then you scroll again). Hesitant notch-at-a-time
   * scrolling is untouched: partial progress below a boundary still
   * accumulates (no guard is armed until a crossing).
   */
  const STEP_GESTURE_IDLE_MS = 180;
  let stepGestureGuard = false;
  let lastReaderWheel = -Infinity;

  /** The docked reader's wheel policy — shared by the reader panel and the
   *  rail + counter chip drawn over it (QA F16-RAIL-CHIP-WHEEL-DEAD / KW-6). */
  function onReaderWheel(e: WheelEvent): void {
    // Ctrl+wheel / trackpad pinch belongs to the browser (page zoom), never
    // to the stepper (QA KW-7: it used to advance steps).
    if (e.ctrlKey) return;
    // Dock-gesture guard (QA KW-5): leftover deltas from the docking notch
    // are dropped, so they can't also cross into step 1 in one gesture.
    if (dockGestureTimer !== 0) {
      e.preventDefault();
      armDockGestureGuard();
      return;
    }
    if (introMode) return; // full-bleed: the window handler below owns it
    e.preventDefault(); // we own this gesture: the reader is the document
    const now = performance.now();
    const idle = now - lastReaderWheel;
    lastReaderWheel = now;
    if (stepGestureGuard && idle < STEP_GESTURE_IDLE_MS) return; // same gesture
    stepGestureGuard = false;
    if (locked) {
      // Dropped by the lock: this gesture must not resume once it releases.
      stepGestureGuard = true;
      return;
    }
    nudgeScroll(wheelPx(e));
  }

  // Wheel over the READER scrolls the document: each gesture adds its delta
  // to the virtual scroll target, the text glides, and crossing a step
  // boundary snaps the incoming step into place (and enters it — forward
  // under the lock, backward instantly). While the lock holds, the document
  // is frozen: wheel deltas are dropped, never queued. Wheel over the CANVAS
  // never hits this listener and zooms the camera through LandscapeView's
  // own wheel handler. Line/page-mode deltas are normalized to px (wheelPx).
  // The rail and the counter chip sit over the reader's edge as siblings of
  // #reader (fixed): they scroll the reader exactly like the panel itself.
  const chipEl = document.querySelector<HTMLElement>("#reader-chip");
  for (const el of [readerEl, railEl, chipEl]) {
    el?.addEventListener("wheel", onReaderWheel, { passive: false });
  }

  // Wheel during the INTRO (full-bleed): the reader is slid off-screen, so
  // the whole viewport scrolls past the intro. The camera's wheel zoom is
  // muted for the duration (setWheelZoomEnabled), making this the only wheel
  // handler that acts; docked, it no-ops and the split policy resumes
  // (canvas = zoom, reader = scroll).
  window.addEventListener(
    "wheel",
    (e) => {
      // Ctrl+wheel / trackpad pinch is the browser's page zoom (QA KW-7 /
      // S2-INTRO-CTRLWHEEL): never scroll, dock, or swallow it.
      if (e.ctrlKey) return;
      // Dock-gesture guard: consume the tail of the docking gesture before
      // anything else (it must not reach the canvas zoom handler below us).
      if (dockGestureTimer !== 0) {
        if (e.deltaMode === 0) e.preventDefault();
        armDockGestureGuard();
        return;
      }
      if (!introMode || locked) return;
      e.preventDefault();
      nudgeScroll(wheelPx(e));
    },
    { passive: false },
  );

  // §7 tilt keys: while a tilt run is live, WASD and ←/→ tilt the BOARD and
  // must not advance the reader (wheel/Space/↑/↓ still do). ↑/↓ are NOT tilt
  // keys: they duplicated W/S for steering and, captured, trapped the reader
  // on §7 for as long as the run was live (QA S2-BWD-1). Always keep the
  // director's key set current so releasing a key after leaving tilt-a
  // cannot leave a stuck input.
  const TILT_KEYS = new Set(["w", "a", "s", "d", "ArrowLeft", "ArrowRight"]);
  // Keys still PHYSICALLY held from a live run (QA KW-4): OS auto-repeat
  // keeps re-pressing them after the run ends (Finish or settle), and every
  // repeat would otherwise fall through to reader navigation and sail past
  // the scorecard. Swallowed until the key is released.
  const heldTiltKeys = new Set<string>();
  // Focus modality (QA KW2-SPACE-DEAD-AFTER-BUTTON-CLICK): Chromium leaves
  // focus on a clicked button, and :focus-visible cannot tell us how focus
  // arrived (Chromium sets it during the keydown itself). Track it ourselves.
  let focusViaPointer = false;
  document.addEventListener("pointerdown", () => { focusViaPointer = true; }, true);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Tab") focusViaPointer = false;
    // A focused range slider owns its arrow keys natively — even during a
    // live tilt run (the damping slider must stay keyboard-tunable), and it
    // must never register as a tilt key (QA KW-1).
    const kt = e.target instanceof HTMLElement ? e.target : null;
    if (
      kt instanceof HTMLInputElement && kt.type === "range" &&
      (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight")
    ) {
      return;
    }
    if (TILT_KEYS.has(e.key)) {
      if (director.wantsTiltKeys) {
        // Live run: the keys own the board. Remember the physical press so
        // its OS auto-repeat stays swallowed even after the run ends
        // mid-hold (Finish click / settle while still held — QA KW-4).
        if (!e.repeat) heldTiltKeys.add(e.key);
        director.setTiltKey(e.key, true);
        e.preventDefault();
        return;
      }
      // Run over: a key still held from the run stays swallowed until it is
      // released; a FRESH post-run press falls through to reader navigation.
      if (heldTiltKeys.has(e.key)) {
        e.preventDefault();
        return;
      }
    }
    // A focused control keeps its OWN key behavior (QA S8-KEY-HIJACK): the
    // reader navigation below preventDefaults and swallows Space/↑/↓ before
    // the browser can act on the control. Space is the native ACTIVATION key
    // of buttons/checkboxes/links; ↑/↓ are native value keys of sliders,
    // numbers, selects and text fields. Buttons and checkboxes have no
    // native ↑/↓ behavior, so arrows keep navigating from them (Chromium
    // leaves focus on a button after a mouse click — swallowing ↓ there
    // would silently stop the reader).
    const tgt = e.target instanceof Element ? e.target : null;
    if (tgt) {
      const ACTIVATES =
        "button, a[href], input, select, textarea, summary, [contenteditable]:not([contenteditable='false'])";
      const OWNS_ARROWS =
        "input:not([type=checkbox]):not([type=button]):not([type=submit]):not([type=reset]), select, textarea, [contenteditable]:not([contenteditable='false'])";
      if (e.key === " " || e.code === "Space") {
        const ctl = tgt.closest(ACTIVATES);
        if (ctl) {
          // Controls that take typed input always keep Space.
          const TYPES_SPACE =
            "input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=reset]):not([type=range]), select, textarea, [contenteditable]:not([contenteditable='false'])";
          // Keyboard-focused control: native activation (S8-KEY-HIJACK).
          if (ctl.matches(TYPES_SPACE) || !focusViaPointer) return;
          // Mouse-focused button/checkbox/slider: the stray focus must not
          // eat the reader's Space (and re-click the button) — drop it and
          // fall through; preventDefault below blocks the native activation.
          if (ctl instanceof HTMLElement) ctl.blur();
        }
      }
      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && tgt.closest(OWNS_ARROWS)) return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault(); // still stop the native page scroll on every repeat
      // One advance per physical press (user feedback 2026-11-13): a held
      // ArrowDown's OS auto-repeat must not sail through steps — the same
      // guard Space has (QA KW2-SPACE-REPEAT-BYPASSES-LOCK).
      if (e.repeat) return;
      if (!locked) advance();
    } else if (e.key === "ArrowUp") {
      e.preventDefault(); // still stop the native page scroll on every repeat
      // One step back per physical press — the mirror of the ArrowDown
      // guard above (IMP-1-ARROWUP-REPEAT-SAIL: a held ArrowUp's auto-repeat
      // sailed backward through every page into the intro; the tour's own
      // ArrowUp handler has had this guard all along).
      if (e.repeat) return;
      goBack();
    } else if (e.key === " " || e.code === "Space") {
      e.preventDefault(); // still stop the native page scroll on every repeat
      // One skip-or-advance per physical press (QA KW2-SPACE-REPEAT-BYPASSES-
      // LOCK — the keyboard analog of the KW-8 wheel guard,
      // STEP_GESTURE_IDLE_MS): a held Space's auto-repeat skipped, advanced,
      // skipped… straight through the locks.
      if (e.repeat) return;
      skipOrAdvance();
    }
  });
  window.addEventListener("keyup", (e) => {
    heldTiltKeys.delete(e.key);
    if (TILT_KEYS.has(e.key)) director.setTiltKey(e.key, false);
  });
  window.addEventListener("blur", () => {
    heldTiltKeys.clear();
    director.clearTiltKeys();
  });

  skipBtn.addEventListener("click", () => director.finishTransitionsNow());

  // The continue hint advances (a button click is a deliberate gesture). A
  // plain click on the reader text does NOTHING (user feedback 2026-11-13,
  // supersedes the v2 click-to-advance): readers click to select and re-read
  // — progression is wheel / Space / ArrowDown / the hint / Skip / the rail.
  // Text selection is native and needs no handler; the old drag-distance
  // guard existed only to protect this advance and is gone with it.
  hintEl.addEventListener("click", () => {
    if (!locked) advance();
  });

  // A text selection spanning a range slider poisons its drag: Chromium
  // treats press-and-drag on the slider as a native drag of the selected
  // content — dragstart fires on the input right after the first move, then
  // pointercancel ends the drag, so the value changes once and freezes
  // (§5's elongation/rotation sliders over a selected paragraph). Block the
  // native drag for sliders (document-level capture: it covers every
  // range input on the page), and collapse a stale selection when a slider
  // is pressed so no highlight lingers over the control. Step clicks are
  // unaffected — the advance guard above excludes input targets.
  document.addEventListener(
    "dragstart",
    (e) => {
      if ((e.target as Element | null)?.closest?.('input[type="range"]')) {
        e.preventDefault();
      }
    },
    true,
  );
  document.addEventListener(
    "pointerdown",
    (e) => {
      if ((e.target as Element | null)?.closest?.('input[type="range"]')) {
        window.getSelection()?.removeAllRanges();
      }
    },
    true,
  );

  // Click-to-advance at the INTRO: a plain click on the full-bleed landscape
  // docks the reader on step 0. Pan drags and the camera preset buttons
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
      return; // a pan drag, not a click
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
  // SET side stays guarded (an inactive page can never turn a spotlight on);
  // the CLEAR side is not (QA LOOK-STALE-SAMESCENE): a span whose page just
  // went inactive must still be able to turn its own spotlight off, or the
  // look sticks forever. Moving between two spans: out clears, over sets.
  //
  // GUIDED TOUR: while a tour plays, the tour owns the spotlight (it re-
  // asserts its sentence's look every frame) — hover is suspended, not
  // removed; it resumes untouched on exit (Esc / completion / navigation).
  const lookSuppressed = (): boolean => tour.running;
  // MOTION GATE (QA F26-RING-SCROLL): while the document scrolls or eases —
  // or just after it did — Chromium fires trusted pointerover/out pairs as
  // spans slide under a cursor that is NOT moving; without the gate the ring
  // and dim flickered on for ~66ms and toggled for ~180ms. `lastAimMove`
  // keeps REAL pointer moves authoritative, so live hovering still works
  // (keyboard focus has no pointer move: focusin gates on document rest only).
  let lastReaderMotion = 0;
  let lastAimMove = 0;
  const LOOK_MOTION_GRACE_MS = 150;
  const documentAtRest = (): boolean =>
    scrollY === targetY && !locked && performance.now() - lastReaderMotion >= LOOK_MOTION_GRACE_MS;
  const pointerHoverAllowed = (): boolean =>
    documentAtRest() && lastAimMove >= lastReaderMotion;
  window.addEventListener("pointermove", (e) => {
    if (e.isTrusted) lastAimMove = performance.now();
  });
  // Assigned once the TourEngine exists (sentence hover graduation below):
  // scrolling must clear a lit sentence hover exactly like a span hover.
  let clearSentenceHoverHook: () => void = () => {};
  function noteReaderMotion(): void {
    lastReaderMotion = performance.now();
    clearSentenceHoverHook();
    director.setLook(null); // scrolling cancels a hover; no-op when unlit
  }
  const leavesLook = (e: Event): boolean =>
    (e.target as HTMLElement | null)?.closest?.("[data-look]") != null;
  // HOVER GRADUATION (tour v2): a registered sentence (data-slook from the
  // TOURS table) responds as a WHOLE — highlight it, spotlight its target,
  // point the leader at it. Unregistered sentences fall through to the
  // per-span .look behavior. Same guards as spans: only the parked step,
  // only at rest, suspended while the tour owns the spotlight.
  let sentenceHoverEl: HTMLElement | null = null;
  const sentenceFromEvent = (e: Event): { el: HTMLElement; look: string } | null => {
    const t = (e.target as HTMLElement | null)?.closest<HTMLElement>(".sent[data-slook]");
    if (!t) return null;
    const step = t.closest(".rstep") as HTMLElement | null;
    if (step?.dataset.active !== "true") return null;
    return { el: t, look: t.dataset.slook ?? "" };
  };
  function clearSentenceHover(): void {
    if (sentenceHoverEl) sentenceHoverEl.removeAttribute("data-slook-hover");
    sentenceHoverEl = null;
    tour.hoverPoint(null, null);
  }
  clearSentenceHoverHook = clearSentenceHover;
  bodyEl.addEventListener("pointerover", (e) => {
    if (lookSuppressed() || !pointerHoverAllowed()) return;
    const sh = sentenceFromEvent(e);
    if (sh && sh.look) {
      if (sentenceHoverEl !== sh.el) {
        clearSentenceHover();
        sentenceHoverEl = sh.el;
        sh.el.setAttribute("data-slook-hover", "true");
        tour.hoverPoint(sh.el, sh.look);
      }
      return;
    }
    // Left the lit sentence for unregistered ground: clear its highlight
    // (the span machinery below takes over from here).
    if (sentenceHoverEl && !sentenceHoverEl.contains(e.target as Node)) {
      clearSentenceHover();
    }
    director.setLook(lookFromEvent(e));
  });
  bodyEl.addEventListener("pointerout", (e) => {
    if (lookSuppressed()) return;
    if (sentenceHoverEl) {
      const to = e.relatedTarget instanceof Node ? e.relatedTarget : null;
      if (!to || !sentenceHoverEl.contains(to)) clearSentenceHover();
      return;
    }
    if (pointerHoverAllowed() && leavesLook(e)) director.setLook(null);
  });
  bodyEl.addEventListener("focusin", (e) => {
    if (lookSuppressed() || !documentAtRest()) return;
    const id = lookFromEvent(e);
    if (id !== null) director.setLook(id);
  });
  bodyEl.addEventListener("focusout", (e) => {
    if (lookSuppressed()) return;
    if (leavesLook(e)) director.setLook(null);
  });

  // Backstop (QA LOOK-KB-DESYNC): anything that natively scrolls the
  // overflow:hidden #reader-body (find-in-page, a focus below the fold on an
  // over-tall page) must not desync from the virtual scroll — re-pin it.
  // The scroll events applyScroll causes itself see want === scrollTop and
  // are a no-op.
  bodyEl.addEventListener("scroll", () => {
    const want = Math.max(0, scrollY);
    if (Math.abs(bodyEl.scrollTop - want) > 1) bodyEl.scrollTop = want;
  });

  /* ---------------- guided tour (v2: all nine sections) ----------------
   *
   * TOURS (src/view/tourEngine.ts) is the declarative script table; this
   * host is the only scene-aware wiring: navigation through the v4 stepper
   * (enterStep — the tour WAITS for rest, it never holds the lock),
   * spotlights through setLook, screen anchors through the director's
   * lookScreenPoint, and the gate table reading director state. The reader
   * is segmented into sentence spans first (src/view/sentences.ts) so tour
   * steps address one sentence each, and every registered sentence carries
   * its look key for the free-play hover graduation.
   */

  // RUNTIME SENTENCE SEGMENTATION (tour v2): every paragraph of every step
  // is split into sentence spans (plain-text boundaries only; sentences
  // containing .look/.math/em stay one unit) — before anything below
  // resolves a sentence address.
  segmentReader(rsteps);

  // Sentence registry: each tour step's look key lands on its sentence span
  // (data-slook), powering BOTH the guided walk and the free-play hover
  // graduation (hovering a registered sentence spotlights its target).
  // TOUR-HOVER-S7-GHOST-FLAVOR-DEAD: stamp EVERY flavor paragraph, not just
  // the one visible at boot — resolveSentence's visibility gate resolved the
  // §7 ghost step to #tilt-run-lead (the only un-hidden lead at boot), and
  // the director's flavor toggle later hid it, orphaning the stamp: the
  // revealed #tilt-demo-lead/#tilt-empty-lead sentences carried no wire, so
  // free-play hover was dead on both flavors. sentenceAt has no visibility
  // guard, so all three flavors' addressed spans get the key; hidden stamps
  // are inert (pointerover cannot hit a hidden span) and survive the flavor
  // toggles. Steps without alternates behave identically to today.
  for (const def of TOURS) {
    for (const st of def.steps) {
      for (const p of [st.para, st.altPara, st.altPara2]) {
        if (p === undefined) continue;
        const el = sentenceAt(rsteps[st.page], p, st.sent);
        if (el) el.dataset.slook = st.look;
      }
    }
  }

  const tourSnapshot = (): TourSnapshot => {
    const f = director.currentFit;
    const gd = director.gdState;
    const fog = director.fogState;
    const tilt = director.tiltState;
    const rule = director.ruleState;
    return {
      fit: { x: f.x, y: f.y },
      eta: gd.eta,
      userTip: gd.userTip !== null,
      arrowCommits: director.arrowCommits,
      fogUsed: fog?.used ?? -1,
      fogDone: fog?.done ?? false,
      ghostsPlaying: fog?.ghostsPlaying ?? false,
      momBeta: director.momState.beta,
      steep: director.steepness,
      lab: director.labParams,
      tiltCells: tilt.cells,
      tiltSteps: tilt.steps,
      tiltDone: tilt.done,
      tiltGhostPlaying: tilt.scrubPlaying,
      swarmBlind: director.swarmBlindOn,
      rule: {
        level: rule.level,
        lr: rule.config.lr,
        beta: rule.config.beta,
        clip: rule.config.clip,
        normalize: rule.config.normalize,
      },
    };
  };

  const tourHost: TourHost = {
    stepEl: (page) => rsteps[page] ?? null,
    activePage: () => current,
    atRest: () =>
      !locked && !director.animating && !introMode && Math.abs(scrollY - targetY) < 1,
    goToPage: (page) => {
      const k = Math.min(Math.max(page, 0), rsteps.length - 1);
      if (k === current && !introMode) return;
      enterStep(k, k > current ? 1 : -1, { teleport: Math.abs(k - current) > 1 });
    },
    applyLook: (key) => director.setLook(key),
    lookScreenPoint: (key) => director.lookScreenPoint(key),
    readerLeft: () => readerEl.getBoundingClientRect().left,
    snapshot: tourSnapshot,
    gateSatisfied: (kind, snap, cur) => {
      switch (kind) {
        case "fitMoved": // inset drag or §1 surface drag — either moves w/b
          return Math.abs(cur.fit.x - snap.fit.x) + Math.abs(cur.fit.y - snap.fit.y) > 1e-9;
        case "etaMoved":
          return cur.eta !== null && snap.eta !== null && Math.abs(cur.eta - snap.eta) > 1e-9;
        case "arrowDrawn":
          // Keyed to COMMITTED draws, not userTip: onArrowPreview fires at
          // pointer-DOWN, so `cur.userTip` released the gate on a bare
          // press, mid-gesture (TOUR QA S2-TOUR-GATE-KEYED-TO-PRESS).
          return cur.arrowCommits > snap.arrowCommits;
        case "fogStride":
          // Releases on a stride OR on the run finishing however it finishes
          // (TOURUX-S6-L1-STRIDE-GATE-FINISHED-RUN-LOCK): a premature Finish
          // (or a drained budget) sets done=true — the compass goes read-only
          // (fogCommitStep refuses st.done) and the Finish button hides — so
          // a stride-after-finish is impossible and the gate would soft-lock
          // over the revealed landscape with Next/Space swallowed. Same
          // rationale as the level-2 fogRun case below. The gate can only be
          // open while parked on page 15 (level 1's gate page), so there is
          // no cross-level leakage; the stride-first order survives as the
          // chip's preferred instruction, not an enforcement.
          return cur.fogUsed > snap.fogUsed || cur.fogDone;
        case "fogFinish": // Finish button or a drained budget both lift the fog
          return cur.fogDone;
        case "fogRun":
          // Releases when the level-2 run finishes, however it finishes.
          // Round 1 required a stride drawn since arriving on the level;
          // that soft-locked visitors who pressed Finish first (TOURUX-S6-
          // FOGRUN-PREMATURE-FINISH-LOCK / -DEADEND, cycle A round 2): a
          // bare Finish ends the run (done=true), the Finish button hides,
          // and the run-over compass is read-only (!st.done stride guard) —
          // so the demanded stride was impossible and Next/Space are
          // swallowed by gate design. fog-b's own copy sanctions the bare
          // Finish ("Spend the budget or press Finish run — either way the
          // fog lifts"), so the gate defers to the game: the stride-first
          // order survives as the chip's instruction (the better experience,
          // not an enforcement), and the no-run reveal's lead copy is
          // softened (#fog-empty-lead) to state the fact without the
          // scolding that motivated round 1.
          return cur.fogDone;
        case "ghostReplay": // the §6 footer Replay or the §7 panel ghost
          return cur.ghostsPlaying || cur.tiltGhostPlaying;
        case "betaMoved": // §3's β slider
          return (
            cur.momBeta !== null && snap.momBeta !== null &&
            Math.abs(cur.momBeta - snap.momBeta) > 1e-9
          );
        case "steepMoved": // §4's steepness slider
          return cur.steep !== null && snap.steep !== null && cur.steep !== snap.steep;
        case "labMoved": // §5's elongation/rotation sliders (either moves)
          return (
            cur.lab !== null && snap.lab !== null &&
            (Math.abs(cur.lab.E - snap.lab.E) > 1e-9 ||
              Math.abs(cur.lab.rot - snap.lab.rot) > 1e-9)
          );
        case "tiltSteered":
          // §7: a live run's counters only grow on input — OR the run is
          // finished (TOUR-TR-2, the fogRun precedent below): `wantsTiltKeys`
          // goes false once tiltRun.done, freezing the physics tick and the
          // steering keys, so a premature "Finish run · score" (or an
          // auto-settle) while the gate is open permanently falsifies the
          // counter deltas and the gate — which swallows Next/Space by
          // design — would dead-end over the "run finished" panel. Absolute
          // cur.tiltDone (like cur.fogDone) also releases a tour started on
          // an already-finished run at the first poll; the chip's steer-first
          // copy stays as the preferred instruction, not an enforcement.
          return cur.tiltDone || cur.tiltCells > snap.tiltCells || cur.tiltSteps > snap.tiltSteps;
        case "blindToggled": // §7 swarm's "run blind" checkbox
          return cur.swarmBlind !== snap.swarmBlind;
        case "ruleMoved": // §8: any of the four rule parts moved
          return (
            cur.rule !== null && snap.rule !== null &&
            (cur.rule.lr !== snap.rule.lr ||
              cur.rule.beta !== snap.rule.beta ||
              cur.rule.clip !== snap.rule.clip ||
              cur.rule.normalize !== snap.rule.normalize)
          );
        case "ruleLevelMoved": // §8: a landscape pill picked
          return cur.rule !== null && snap.rule !== null && cur.rule.level !== snap.rule.level;
        default:
          return false;
      }
    },
    skipAnimation: () => director.finishTransitionsNow(),
  };
  const tour = new TourEngine(tourHost);

  /* ---------------- the fixed tour entry (FIX-4) ----------------
   * ONE "▶ Tour section N" chip pinned to the bottom-center of the CANVAS
   * pane — the slot the controller bar takes while a tour runs — replacing
   * the old per-step chip buried at the tail of the step prose (user
   * session 2026-11-17: the entry had to be hunted inside the paragraph).
   * Visible exactly while a section's steps are parked: [hidden] on the
   * hero step, in the intro park, while a tour owns the bottom-center, and
   * in shot mode (CSS). Relabeled per parked scene from TOUR_SCENE_HOST;
   * the section number is the tour's order. Clicking starts the section's
   * tour AT THE PARKED STEP (TourEngine.start's FIX-4 seed — a mid-section
   * start never scrolls back up). */
  const tourEntry = document.createElement("button");
  tourEntry.type = "button";
  tourEntry.id = "tour-entry";
  document.body.appendChild(tourEntry);

  const tourEntryDef = (): TourDef | null => {
    const hostId = TOUR_SCENE_HOST[sceneOf(current)];
    return hostId ? (TOURS.find((t) => t.id === hostId) ?? null) : null;
  };

  function refreshTourEntry(): void {
    const def = tourEntryDef();
    const show = def !== null && !introMode && !tour.running;
    if (tourEntry.hidden !== !show) tourEntry.hidden = !show;
    if (!def || !show) return;
    const label = `▶ Tour section ${TOURS.indexOf(def) + 1}`;
    if (tourEntry.textContent !== label) tourEntry.textContent = label;
    if (tourEntry.dataset.tour !== def.id) tourEntry.dataset.tour = def.id;
    const aria = `Start the guided tour: ${def.label}`;
    if (tourEntry.getAttribute("aria-label") !== aria) {
      tourEntry.setAttribute("aria-label", aria);
    }
    // BRK-3 free-play twin: on the §7 swarm page the dock's replay
    // transport owns the bottom-center (its hit-test wins over a chip at
    // that slot were measured at 900×620 / 1280×800 when the controller
    // bar sat there), so the chip lifts to the sanctioned 166px exactly
    // while that dock is on stage.
    const dockOn = document.querySelector<HTMLElement>("#swarm-dock");
    const lift = dockOn?.dataset.visible === "true";
    if (tourEntry.dataset.lift !== String(lift)) {
      tourEntry.dataset.lift = String(lift);
    }
  }

  tourEntry.addEventListener("click", () => {
    const def = tourEntryDef();
    if (def && !tour.running) tour.start(def);
  });

  // Tour start/exit flips body[data-tour-live]: the observer hands the
  // bottom-center slot to the controller bar and takes it back on exit.
  new MutationObserver(refreshTourEntry).observe(document.body, {
    attributes: true,
    attributeFilter: ["data-tour-live"],
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
      // The content is moving under the cursor: hover-to-look must not fire
      // from Chromium's synthetic pointerover/out pairs (QA F26-RING-SCROLL).
      // Recorded BEFORE the scrollTop write so boundary events dispatched by
      // it already see the fresh timestamp.
      noteReaderMotion();
      const approach = (targetY - scrollY) * (1 - Math.exp(-dt * 9));
      scrollY = Math.abs(targetY - scrollY) <= 0.25 ? targetY : scrollY + approach;
      applyScroll();
    }

    // Ease the camera's horizontal re-centering toward the layout target
    // (0 = full-bleed intro, readerWidth/2 = docked two-pane): the landscape
    // glides out from under the reader as it slides in, on the same clock.
    if (Math.abs(paneInsetTarget - paneInsetApplied) > 0.5) {
      paneInsetApplied += (paneInsetTarget - paneInsetApplied) * (1 - Math.exp(-dt * 9));
      if (Math.abs(paneInsetTarget - paneInsetApplied) <= 0.5) paneInsetApplied = paneInsetTarget;
      view.setPaneInsetRight(Math.round(paneInsetApplied * 10) / 10);
    } else if (paneInsetApplied !== paneInsetTarget) {
      paneInsetApplied = paneInsetTarget;
      view.setPaneInsetRight(paneInsetApplied);
    }
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
    // Ratchet, not a peg (QA F16-FOGC-FILL-PEG): the old `elapsed > 350 → 1`
    // rule forced the bar to 100% for every lock longer than 350ms. The fill
    // tracks the director's real progress, latched so it never decreases.
    fillLatch = Math.min(1, Math.max(fillLatch, progress, 0.06));
    // Style-write only on change: a per-frame write of the same value still
    // forces recalc/paint of the reader pane (measurable in software GL).
    const pct = `${Math.round(fillLatch * 100)}%`;
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
  /** Reader width, refreshed whenever the framing target is recomputed. */
  let readerW = 0;

  function readerHalf(): number {
    readerW = readerEl.getBoundingClientRect().width;
    return readerW > 0 ? readerW / 2 : 0;
  }

  /**
   * Scenes with a fixed HUD inspector (§4) need the stage content shifted a
   * little further RIGHT so the ball/arrows clear the panel at narrow panes
   * (QA LW24-ADAM-BALL-UNDER-PANEL-1280): nudge = (880 − pane)/2, capped at
   * 80px. 880 is the pane width above which the stock centering already
   * clears the 300px panel.
   */
  function inspectorNudge(): number {
    if (!SCENES[sceneOf(current)]?.inspector) return 0;
    const paneW = Math.max(1, innerWidth - readerW);
    return Math.min(80, Math.max(0, Math.round((880 - paneW) / 2)));
  }

  /** The docked reader's width as a pane inset for the camera FIT (QA
   *  S2A-NARROW-FRAMING-CLIPS-ARROW): eased on the frameX clock so the dock
   *  glide re-fits smoothly (QA S2-HERO-RACE-CLIPPED-NARROW). */
  let paneInsetApplied = 0;
  let paneInsetTarget = 0;

  function applyIntroLayout(): void {
    appEl.dataset.intro = String(introMode);
    // The slid-off reader must leave the Tab order: focusing its continue/
    // skip buttons made Chromium scroll #app sideways (QA KW2-INTRO-TAB-
    // SHIFTS-LAYOUT). An inert ancestor overrides syncReader's per-page inert.
    readerEl.inert = introMode;
    // Full-bleed owns the wheel: the camera must not zoom during the intro.
    // The dock-gesture guard also keeps it muted (QA KW-5).
    view.setWheelZoomEnabled(!introMode && dockGestureTimer === 0);
    frameXTarget = introMode ? 0 : readerHalf() - inspectorNudge();
    paneInsetTarget = introMode ? 0 : readerW;
    applyHudInsets();
    refreshTourEntry(); // FIX-4: the intro park hides the entry chip
  }

  /** Visible HUD panels as pan-clamp insets (QA S2CAM-PAN-BEHIND-HUD): the
   *  view's pan clamp keeps the zoomed-out box clear of the opaque HUD
   *  column instead of letting it hide entirely under it. Only tightens the
   *  clamp — never moves the frustum or the choreographed framing. */
  function applyHudInsets(): void {
    const stage = document.querySelector<HTMLElement>("#stage-wrap");
    if (introMode || !stage) {
      view.setPaneInsets(0, 0);
      return;
    }
    const sr = stage.getBoundingClientRect();
    const pr = sr.width - readerW;
    let left = 0;
    let right = 0;
    for (const el of stage.querySelectorAll<HTMLElement>('.hud.panel[data-visible="true"]')) {
      // The compass is a small corner instrument, not a column: blocking the
      // pane's full height for it made the convex-pane clamp forbid ordinary
      // pans in every §2+ scene (the stock framing already overlaps its
      // column). The opaque HUD COLUMNS (fit/loss, fog, tilt, inspector…)
      // are what a zoomed-out terrain hid under. The §7 swarm dock joined
      // the .hud.panel class for spotlight participation only
      // (TOUR-POINT-S7-BLINDTOGGLE-DOCK) — it is the same small corner
      // instrument, so it must not tighten the pan clamp either.
      if (el.id === "minimap-panel") continue;
      if (el.id === "swarm-dock") continue;
      // §5's lab dock joins them (COPY-PLAN §2.10): the same small corner
      // instrument, docked bottom-left on the lab scene — spotlight
      // participation only, never a pan-clamp column.
      if (el.id === "lab-dock") continue;
      // The function card (FUNC-CARD): a small top-center chip — the same
      // small-instrument rule, never a pan-clamp column.
      if (el.id === "func-card") continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      const x0 = r.left - sr.left;
      const x1 = r.right - sr.left;
      if (x0 >= pr) continue; // under the reader: already outside the pane
      if ((x0 + x1) / 2 < pr / 2) left = Math.max(left, x1 + 14);
      else right = Math.max(right, pr - x0 + 14);
    }
    view.setPaneInsets(Math.round(left), Math.round(right));
  }
  let hudInsetsQueued = false;
  function queueHudInsets(): void {
    if (hudInsetsQueued) return;
    hudInsetsQueued = true;
    requestAnimationFrame(() => {
      hudInsetsQueued = false;
      applyHudInsets();
      refreshTourEntry(); // FIX-4: the swarm-dock lift tracks the dock
    });
  }

  /** Resize / reflow: recompute the framing target and snap (no ease). */
  function applyFrameX(): void {
    applyIntroLayout();
    frameXApplied = frameXTarget;
    paneInsetApplied = paneInsetTarget;
    view.setPaneInsetRight(paneInsetApplied);
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
  if (shot === "swarm" && swarmMapParam) director.presetSwarmMap(swarmMapParam);
  measureTops();
  introMode = startIntro;
  applyIntroLayout();
  frameXApplied = frameXTarget; // boot snaps: no entrance ease on load
  paneInsetApplied = paneInsetTarget;
  view.setPaneInsetRight(paneInsetApplied);
  view.setFrameOffsetX(frameXApplied);
  scrollY = targetY = startIntro ? -introPark : tops[initialIndex];
  applyScroll();
  director.boot(shot ? sceneOf(initialIndex) : SCENE_ORDER[0]);
  current = initialIndex;
  applyIntroLayout(); // the boot scene's framing target (e.g. inspector nudge)
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
  // Step content reflows after boot (the labrule scorecard/verdicts fill in
  // when the benchmark runs; dials/pills rewrite them; fog/tilt scorecards
  // likewise): any .rstep height change moves every later park offset —
  // re-measure and keep the parked step parked (QA S2EPI-1 /
  // L900-LABRULE-STALE-TOPS-PARK). The labrule bodies and the footer are
  // observed too: their size picks the labrule fit level.
  if (typeof ResizeObserver !== "undefined") {
    // Coalesced into one rAF: re-measuring (and the labrule fit level it
    // picks) resizes observed elements, which must not happen inside the
    // observer's own delivery.
    let reflowQueued = false;
    const stepSizeObserver = new ResizeObserver(() => {
      if (reflowQueued) return;
      reflowQueued = true;
      requestAnimationFrame(() => {
        reflowQueued = false;
        reanchor({ repark: false });
      });
    });
    for (const el of rsteps) {
      stepSizeObserver.observe(el, { box: "border-box" });
      if (el.dataset.scene === "labrule") {
        const b = el.querySelector(".step__body");
        if (b) stepSizeObserver.observe(b);
      }
    }
    if (footEl) stepSizeObserver.observe(footEl);
  }
  // HUD panels come and go per scene (and the fog panel re-docks): keep the
  // pan-clamp insets current (QA S2CAM-PAN-BEHIND-HUD).
  {
    const stage = document.querySelector<HTMLElement>("#stage-wrap");
    if (stage) {
      new MutationObserver(queueHudInsets).observe(stage, {
        subtree: true,
        attributes: true,
        attributeFilter: ["data-visible", "data-dock", "data-below"],
      });
    }
  }

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
  // Motion tier while scrubbing (QA SCRUB-HITCH round 3): under software GL
  // the tier drops the pixel ratio to 0.35, hides the trail glow passes AND
  // serves the terrain from a static-layer cache (renderFrame), keeping the
  // drag at the vsync. No-op on hardware GL.
  replayScrubEl?.addEventListener("pointerdown", () => director.setScrubTier(true));
  for (const evt of ["pointerup", "pointercancel"]) {
    replayScrubEl?.addEventListener(evt, () => director.setScrubTier(false));
  }
  // Safety net: a pointerup that misses the slider (drag-out) must still
  // release the tier.
  window.addEventListener(
    "pointerup",
    () => director.setScrubTier(false),
    { capture: true },
  );
  replayScrubEl?.addEventListener("input", () => {
    director.setReplayScrub(Number(replayScrubEl.value) / 1000);
  });
  for (const b of document.querySelectorAll<HTMLButtonElement>("#speed-wrap button, #tilt-speed button")) {
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
  // "Run it blind / show map" (the swarm dock, ON the visualizer): hide the
  // map (§6's fog) and let the swarm paint every cell it crosses. Default is
  // BLIND — the swarm now enters fogged (user feedback 2026-11-13) — and
  // flipping it re-runs the swarm cleanly.
  const swarmBlind = document.querySelector<HTMLInputElement>("#swarm-blind");
  if (swarmBlind) swarmBlind.checked = director.swarmBlindOn; // boot sync (default: blind)
  swarmBlind?.addEventListener("change", () => {
    director.setSwarmBlind(swarmBlind.checked);
  });
  // Swarm landscape pills (the dock): swap the country in place, re-run.
  for (const b of document.querySelectorAll<HTMLButtonElement>("#swarm-maps button")) {
    b.addEventListener("click", () => {
      director.setSwarmMap(b.dataset.map as Parameters<Director["setSwarmMap"]>[0]);
    });
  }
  // Swarm replay transport (the dock): ▶/❚❚ + ↻ + the flight scrubber.
  document.querySelector<HTMLButtonElement>("#swarm-replay-play")?.addEventListener("click", () => {
    director.swarmReplay();
  });
  document.querySelector<HTMLButtonElement>("#swarm-replay-restart")?.addEventListener("click", () => {
    director.restartSwarmFlight();
  });
  const swarmScrubEl = document.querySelector<HTMLInputElement>("#swarm-scrub");
  swarmScrubEl?.addEventListener("input", () => {
    director.setSwarmScrub(Number(swarmScrubEl.value) / 1000);
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
    /** Screen anchor of a lookRegistry target (the pointing overlay's
     *  source of truth — the hover gate clamps + compares against it). */
    lookPoint: (key: string) => { x: number; y: number } | null;
    tour: () => TourEngine["state"];
    /** Tour v2 authoring guard: every step of every tour resolves to a
     *  visible sentence whose text contains `expect` (gate-tour asserts). */
    tourCheck: () => Array<{
      id: string;
      label: string;
      pages: number[];
      steps: Array<{ page: number; para: number; sent: number; ok: boolean; text: string | null }>;
    }>;
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
    lookPoint: (key) => director.lookScreenPoint(key),
    tour: () => tour.state,
    tourCheck: () =>
      TOURS.map((def) => ({
        id: def.id,
        label: def.label,
        pages: def.pages,
        steps: def.steps.map((st) => {
          const el = resolveSentence(rsteps[st.page], st.para, st.sent, st.altPara, st.altPara2);
          // Match against whitespace-COLLAPSED text: sentence spans keep the
          // source's line wraps, and `expect` phrases span them.
          const text = el ? (el.textContent ?? "").trim().replace(/\s+/g, " ") : null;
          return {
            page: st.page,
            para: st.para,
            sent: st.sent,
            ok: el !== null && text !== null && text.includes(st.expect),
            text,
          };
        }),
      })),
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
