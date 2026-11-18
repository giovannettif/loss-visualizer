/**
 * TourEngine — the guided tour, presentation model v2 (all nine sections).
 *
 * A tour is DATA: a section's reader pages and a playlist of SENTENCE visits
 * (page + paragraph + sentence index — resolved at runtime against the
 * sentence segmentation in src/view/sentences.ts), each with a lookRegistry
 * target and an optional interaction gate. Adding a section is pure data
 * entry in TOURS + TOUR_SCENE_HOST rows (main.ts mounts the section's
 * "▶ Tour section N" chip — ONE fixed bottom-center entry, not per-step
 * chips — from that table).
 *
 * Start-where-you-are (FIX-4): start() seeds the playlist at the FIRST
 * curated step on or after the parked page, so launching from the second
 * half of a section begins THERE and runs forward — the tour never scrolls
 * the reader back up. Only a start before the section's first tour page
 * travels (forward) to it.
 *
 * The v2 presentation model (user-approved; supersedes the pilot's per-chip
 * auto-advance):
 *
 *   1. SENTENCE PRECISION — a step addresses ONE sentence; markSentence
 *      brightens it (bright + subtle underline) while sibling sentences and
 *      paragraphs dim to 0.35.
 *   2. CENTRAL CONTROLLER — a floating bar at the bottom of the canvas pane:
 *      [Back] [sentence i / n] [Next] [Auto] [minimize] [Exit]. Next advances
 *      one sentence; at a tour page's last sentence it advances the STEP (the
 *      reader pages forward and the entry animation plays under the v4
 *      lock semantics). Auto toggles timed advance (the pilot's beat) — OFF
 *      by default. Back reverses one sentence. Minimize collapses the bar to
 *      a small chip. Exit ends the tour cleanly.
 *   3. CLICK DOES NOTHING — the engine installs NO click handler. Plain
 *      clicks advance neither the reader (removed in WP1) nor the tour;
 *      Next/Back/Esc/Space/wheel only.
 *   4. WHEEL STAYS MASTER — the v4 reader keeps its exact wheel semantics
 *      (snap, lock+skip, reverse). The controller SYNCs: each frame it
 *      watches the parked page — within the tour's section it jumps to that
 *      page's first registered sentence; past the section's last page the
 *      tour exits cleanly. The tour yields to the reader, never the reverse.
 *   5. HOVER GRADUATION — free-play hovering of a registered sentence
 *      (hoverPoint) highlights it and spotlights its target through the same
 *      pointing overlay; main.ts wires it with the same rest guards.
 *
 * Gates PAUSE on a "try it" chip until the visitor performs the action
 * (detected from director state by the host's gate table). Gates never trap
 * (FIX-4): Back ALWAYS works — it reverses one sentence and disarms the
 * gate — and Next always politely SKIPS the gate (disarm + advance);
 * performing the action is still the preferred way through, and the only
 * thing that auto-releases (the release also advances). Esc exits anytime;
 * exit removes every artifact (highlight, spotlight, overlay, bar,
 * listeners): free play resumes exactly as it was.
 */

/* ---------------- tour data (pure data entry for new sections) ------------- */

import { resolveSentence } from "./sentences";

const DEFAULT_BEAT_MS = 4200;
// Beat scaling (TOUR QA TOUR-S1-BEAT-READTIME): an Auto beat must dwell ~
// the sentence's reading time, not one fixed tick — ≈300ms/word ≈ 200wpm
// plus a small gaze base, floored at the old default so short sentences
// keep today's pace; an explicit TourStepDef.beatMs still wins.
const BEAT_MS_PER_WORD = 300;
const BEAT_BASE_MS = 800;

export interface TourGateDef {
  /** Key into the host's gate table (main.ts) — how the action is detected. */
  kind: string;
  /** The "try it:" chip copy, e.g. "drag an arrow on the compass". */
  label: string;
}

export interface TourStepDef {
  /** Reader page index (the .rstep in #reader-body the sentence lives on). */
  page: number;
  /** Paragraph index: the <p> children of the step's .step__body, in order. */
  para: number;
  /** Sentence index within that paragraph (runtime segmentation). */
  sent: number;
  /** Alternate paragraph tried when (para, sent) resolves to a hidden
   *  sentence — the fog/tilt reveals swap their lead paragraphs wholesale
   *  between the played-run and empty-run flavors. */
  altPara?: number;
  /** Second alternate (tried after altPara) for THREE-flavor wholesale
   *  swaps — the §7 ghost step's reachable empty-run flavor hides BOTH lead
   *  paragraphs and reveals a third (para 3) that no tour data referenced
   *  (S2-TOUR-S7-GHOST-STEP-EMPTY-FLAVOR-NO-SENTENCE). */
  altPara2?: number;
  /** lookRegistry key: what the scene spotlights and the leader points at. */
  look: string;
  /** Present = pause on the "try it" chip until the action is performed. */
  gate?: TourGateDef;
  /** Auto-advance dwell override for this sentence (Auto mode only — Auto
   *  is OFF by default; the default scales with the sentence's word count). */
  beatMs?: number;
  /** Authoring guard: the resolved sentence must contain this substring
   *  (asserted for every step by tools/gate-tour.mjs via __wp1.tourCheck). */
  expect: string;
}

export interface TourDef {
  /** Short id ("s1") — also the launch chip's data-tour attribute. */
  id: string;
  /** Controller/chip label ("§1 · The task"). */
  label: string;
  /** Every reader page of the section (the wheel-sync scope: the tour syncs
   *  to a parked page in here and exits past the section's last page). */
  pages: number[];
  /** The curated sentence walk, in order. */
  steps: TourStepDef[];
}

/**
 * The nine section tours. Sentence selectors are (page, para, sent) against
 * the runtime segmentation; `expect` pins each address to its copy so an
 * index drift fails the gate, not the reader.
 */
export const TOURS: TourDef[] = [
  {
    id: "s1",
    label: "§1 · The task",
    pages: [1, 2, 3],
    steps: [
      {
        page: 1,
        para: 1,
        sent: 2,
        look: "fit-inset",
        gate: { kind: "fitMoved", label: "drag the line in the inset" },
        expect: "Drag the line",
      },
      { page: 1, para: 3, sent: 0, look: "loss-readout", expect: "loss is one number" },
      { page: 2, para: 2, sent: 2, look: "needle", expect: "purple needle" },
      {
        page: 3,
        para: 2,
        sent: 0,
        look: "ball",
        gate: { kind: "fitMoved", label: "drag the white point" },
        expect: "Drag the white point",
      },
    ],
  },
  {
    id: "s2",
    label: "§2 · Gradient descent",
    pages: [4, 5, 6, 7],
    steps: [
      { page: 4, para: 1, sent: 1, look: "needle", expect: "needle" },
      {
        page: 5,
        para: 1,
        sent: 0,
        look: "compass",
        gate: { kind: "arrowDrawn", label: "drag an arrow on the compass" },
        expect: "commit to a step",
      },
      { page: 5, para: 2, sent: 1, look: "gd-step", expect: "almost straight" },
      {
        // U1-POINT-ETA: the gate demands sliding #eta-slider, which lives in
        // the READER panel — "ball" pointed the leader + spotlight at the
        // learner sphere on the stage, ~856px away from the demanded control.
        // "eta-slider" (lookRegistry kind "control") anchors the slider's
        // rect and glows it; free-play sentence hover points there too (the
        // sentence's inline data-look="ball" span keeps its scene meaning
        // for unregistered hover paths).
        page: 6,
        para: 1,
        sent: 1,
        look: "eta-slider",
        gate: { kind: "etaMoved", label: "slide the learning rate η" },
        expect: "same white point",
      },
      { page: 7, para: 1, sent: 0, look: "trail-gd", expect: "different route" },
    ],
  },
  {
    id: "s3",
    label: "§3 · Momentum",
    pages: [8, 9, 10],
    steps: [
      { page: 8, para: 1, sent: 0, look: "trail-gd", expect: "for both" },
      { page: 8, para: 1, sent: 2, look: "trail-mom", expect: "running average" },
      {
        // TOUR-POINT-S3-BETA-GATE-STAGE: the gate demands sliding #beta-slider
        // in the READER panel — "trail-mom" anchored the stage trail tip
        // ~590px away from the demanded control. Same U1-POINT-ETA
        // "control" precedent as §2's eta-slider step; the "running
        // average" and "discards" steps keep the stage trail.
        page: 8,
        para: 2,
        sent: 0,
        look: "beta-slider",
        gate: { kind: "betaMoved", label: "slide the momentum β" },
        expect: "averaging window",
      },
      { page: 9, para: 1, sent: 0, look: "mom-apexes", expect: "gold markers" },
      { page: 10, para: 2, sent: 1, look: "trail-mom", expect: "discards" },
    ],
  },
  {
    id: "s4",
    label: "§4 · Adam",
    pages: [11, 12],
    steps: [
      { page: 11, para: 1, sent: 1, look: "adam-bars", expect: "each bar" },
      { page: 11, para: 2, sent: 0, look: "adam-arrows", expect: "yellow arrow" },
      {
        // TOUR-POINT-S4-STEEP-GATE-STAGE: the gate demands sliding
        // #steep-slider in the reader panel — "adam-arrows" anchored the
        // stage inspector arrows ~713px away from it. The page-11
        // inspector sentence keeps "adam-arrows" (stage target).
        page: 12,
        para: 1,
        sent: 2,
        look: "steep-slider",
        gate: { kind: "steepMoved", label: "slide the steepness λ₁" },
        expect: "absorbs exactly",
      },
    ],
  },
  {
    id: "s5",
    label: "§5 · The disagreement lab",
    pages: [13, 14],
    steps: [
      {
        // TOUR-POINT-S5-LAB-GATE-STAGE: the gate demands moving the lab
        // sliders in the reader panel — anchored on the BLOCK wrapper
        // (#lab-sliders) so one target covers both named rows; "trails-all"
        // put the dot ~630px away on the stage trails.
        // COPY-PLAN E3 re-sync: lab-1's P1 merged its first two sentences
        // at a colon (the slider sentence now opens the paragraph), so the
        // addressed sentence index moved 1 → 0.
        page: 13,
        para: 1,
        sent: 0,
        look: "lab-sliders",
        gate: { kind: "labMoved", label: "reshape the valley with the sliders" },
        expect: "curvature ratio",
      },
      {
        // TOUR-POINT-S5-CHECKLIST-LOOK: this sentence names the regime
        // checklist (#lab-checklist) — the stage trails sat ~788px from it.
        page: 13,
        para: 2,
        sent: 1,
        look: "lab-checklist",
        expect: "checklist lights",
      },
      { page: 14, para: 1, sent: 0, look: "trail-gd", expect: "Steep walls" },
      { page: 14, para: 1, sent: 2, look: "trail-adam", expect: "invariant" },
    ],
  },
  {
    id: "s6",
    label: "§6 · The fog game",
    pages: [15, 16, 17],
    steps: [
      { page: 15, para: 1, sent: 1, look: "needle", expect: "compass needle" },
      {
        // LEVEL-1 stride gate. Releases on a stride OR on the run finishing
        // however it finishes (main.ts fogStride: cur.fogUsed > snap.fogUsed
        // || cur.fogDone) — a premature Finish used to soft-lock HERE: done
        // makes the compass read-only and hides Finish, so the demanded
        // stride became impossible while Next/Space were swallowed
        // (TOURUX-S6-L1-STRIDE-GATE-FINISHED-RUN-LOCK; the level-2 mirror is
        // TOURUX-S6-FOGRUN-PREMATURE-FINISH-LOCK, cycle A round 2). The chip
        // keeps the stride-first order as the preferred instruction.
        page: 15,
        para: 2,
        sent: 0,
        look: "compass",
        gate: { kind: "fogStride", label: "drag a stride on the compass" },
        expect: "to take a step",
      },
      { page: 15, para: 2, sent: 1, look: "ball", expect: "paints itself in" },
      {
        // Releases when the level-2 run finishes (kind fogRun, main.ts).
        // Round 1 required a stride drawn HERE first; that soft-locked
        // visitors who pressed Finish first — the run-over compass is
        // read-only, so the demanded stride became impossible (TOURUX-S6-
        // FOGRUN-PREMATURE-FINISH-LOCK / -DEADEND, cycle A round 2). The
        // chip keeps the stride-first order as the preferred instruction;
        // a premature Finish now releases into the no-run reveal, whose
        // lead copy (#fog-empty-lead) states the fact without scolding.
        page: 16,
        para: 2,
        sent: 0,
        look: "fog-panel",
        gate: { kind: "fogRun", label: "take a stride here, then press Finish run" },
        expect: "fog lifts",
      },
      {
        // The reveal's lesson sentence swaps per flavor: the played run's
        // #fog-trap-note hides wholesale on an empty run, where
        // #fog-empty-verdict-note carries the equivalent sentence.
        page: 17,
        para: 4,
        sent: 0,
        altPara: 5,
        look: "gold-marker",
        expect: "gold marker",
      },
      {
        // TOUR-POINT-S6-FOOTER-REPLAY-STAGE: the sentence and the gate demand
        // the reader-footer's #replay-btn — "ball" anchored the stage ball
        // ~900px away from the demanded control. The sentence's inline
        // data-look="ball" span keeps its scene meaning for per-span hover;
        // the §7 tilt-replay step is the sibling precedent.
        page: 17,
        para: 6,
        sent: 0,
        look: "replay-btn",
        gate: { kind: "ghostReplay", label: "press Replay in the footer" },
        expect: "re-runs all four ghosts",
      },
    ],
  },
  {
    id: "s7",
    label: "§7 · The tilt game",
    pages: [18, 19, 20, 21],
    steps: [
      {
        page: 18,
        para: 1,
        sent: 0,
        look: "ball",
        gate: { kind: "tiltSteered", label: "steer with W A S D (or ← →)" },
        expect: "tilt it",
      },
      {
        // POINT-TS2-1: this sentence NAMES the damping c-slider row —
        // "tilt-panel" anchored the leader at the panel rect's vertical
        // midpoint, which falls ~67px below the named row unsteered and on
        // the #tilt-levels pills' top edge mid-tour (the step-1 steer gate
        // sets run.steered, un-hiding #tilt-restart and growing the panel).
        // "tilt-damp" anchors the named #tilt-friction control itself
        // (panelPart — spotlight stays panel-level); data-slook is derived
        // from this table (main.ts), so the free-play hover re-targets with
        // the same one-line change. The scorecard step keeps "tilt-panel".
        page: 18,
        para: 2,
        sent: 0,
        look: "tilt-damp",
        expect: "damping coefficient",
      },
      {
        // U5-POINT-LEVELS: this sentence NAMES the level pills — point at
        // the pills row, not the whole panel (the generic panel anchor
        // landed on the damping slider row above them). The damping,
        // scorecard and ghost steps below keep the panel-level target.
        page: 19,
        para: 1,
        sent: 0,
        look: "tilt-levels",
        expect: "Rosenbrock",
      },
      {
        // The scorecard lead swaps flavors THREE ways (played run para 1 /
        // guided-demo para 2 / empty-run para 3 — the reachable
        // `empty = !run.steered && !run.curated` flavor hides both leads,
        // S2-TOUR-S7-GHOST-STEP-EMPTY-FLAVOR-NO-SENTENCE, so altPara2: 3
        // keeps the sentence highlight alive on every flavor).
        // TOUR-POINT-S7-SCRUBBER-SCORECARD; S2B-ANCHOR-1: the look anchors
        // the sentence's ▶ ghost BUTTON (#tilt-replay-play) — the generic
        // panel midpoint landed on the scorecard's momentum row, and the
        // two-line ROW anchor landed in the row's line gap.
        // REG-1-GHOST-NO-GATE (user regression, 2026-11-15): this step
        // deliberately carries NO interaction gate. The old ghostReplay gate
        // made the ghost press "the way through" — the frame poll released
        // it and gotoStep jumped to the next step, whose page is the SWARM
        // section, so clicking ▶ ghost teleported the reader off tilt-b
        // mid-sentence instead of playing back the recorded run. The ghost
        // button must replay/scrub the ghost AND NOTHING ELSE: no gate, the
        // sentence highlights, the visitor plays, Next/Space advance.
        page: 20,
        para: 1,
        sent: 0,
        altPara: 2,
        altPara2: 3,
        look: "tilt-replay",
        expect: "ghost",
      },
      {
        // The swarm page has NO single learner ball (the 100 instanced
        // balls replace it — ballVisible is false on the swarm scene), so
        // this sentence points at the ensemble itself, not "ball"
        // (TOURUX-S7-SWARM-BALL-LOOK-DEAD: a dead target left the pointing
        // overlay dark for the whole step).
        // COPY-PLAN E3 re-sync: the swarm P1 rewrite fronts the terrain
        // pills ("The pills on the dock…" then one sentence per terrain),
        // so the "One hundred balls" sentence moved 1 → 4; the 2026-11-17
        // archipelago sentence (4th terrain, after Himmelblau) moves it
        // 4 → 5.
        page: 21,
        para: 1,
        sent: 5,
        look: "swarm-ensemble",
        expect: "One hundred balls",
      },
      {
        // COPY-PLAN E3 re-sync (2026-11-17): the archipelago note inserted
        // after the unequal-outcomes sentence moves "scorecard keeps"
        // 2 → 3.
        page: 21,
        para: 2,
        sent: 3,
        look: "tilt-panel",
        expect: "scorecard keeps",
      },
      {
        // TOUR-POINT-S7-BLINDTOGGLE-DOCK: the gate ticks #swarm-blind in the
        // #swarm-dock HUD (bottom-left of the canvas) — the generic
        // "tilt-panel" anchor pointed at the OPPOSITE-corner scorecard,
        // ~716px from the checkbox. The dock is a registered panel target.
        // COPY-PLAN E3 re-sync: the caption now opens capitalized
        // ("Ensembles cover ground faster…"), so the expect casing moves
        // with it — the sentence index stays 0.
        page: 21,
        para: 3,
        sent: 0,
        look: "swarm-dock",
        gate: { kind: "blindToggled", label: "tick run blind / show map on the dock (bottom-left)" },
        expect: "Ensembles cover ground",
      },
    ],
  },
  {
    id: "s8",
    label: "§8 · The optimizer lab",
    pages: [22, 23],
    steps: [
      { page: 22, para: 1, sent: 1, look: "rule-panel", expect: "exposes all four" },
      {
        // TOUR-POINT-S8-PILLS-CLIP: this sentence NAMES the #rule-levels
        // pills row — the generic panel midpoint fell on the clip-dial row
        // above it. The dial-naming steps keep "rule-panel".
        page: 22,
        para: 1,
        sent: 2,
        look: "rule-levels",
        expect: "pills beneath",
      },
      {
        page: 22,
        para: 2,
        sent: 0,
        look: "rule-panel",
        gate: { kind: "ruleMoved", label: "move a dial (η, β, clip, normalize)" },
        expect: "beats Adam",
      },
      { page: 23, para: 1, sent: 0, look: "rule-panel", expect: "Change nothing" },
      {
        // TOUR-POINT-S8-PILLS-CLIP: the gate clicks a landscape pill — the
        // leader sits on the pills row it demands.
        page: 23,
        para: 1,
        sent: 1,
        look: "rule-levels",
        gate: { kind: "ruleLevelMoved", label: "pick another landscape pill" },
        expect: "verdict flips",
      },
    ],
  },
  {
    id: "s9",
    label: "§9 · Epilogue",
    pages: [24, 25, 26],
    steps: [
      { page: 24, para: 1, sent: 0, look: "epi-marker", expect: "debt to settle" },
      { page: 24, para: 3, sent: 0, look: "epi-marker", expect: "gold point" },
      { page: 24, para: 3, sent: 2, look: "epi-marker", expect: "literal truth" },
      { page: 25, para: 1, sent: 0, look: "epi-lattice", expect: "dissolve" },
      { page: 25, para: 2, sent: 2, look: "epi-lattice", expect: "never visible" },
      { page: 26, para: 1, sent: 0, look: "epi-lattice", expect: "hand-written optimizer math" },
    ],
  },
];

/** Which tour a scene's reader steps host (drives the launch chips). */
export const TOUR_SCENE_HOST: Readonly<Record<string, string>> = {
  "task-a": "s1",
  "task-b": "s1",
  "task-c": "s1",
  "gd-a": "s2",
  "gd-b": "s2",
  "gd-c": "s2",
  "gd-d": "s2",
  "mom-a": "s3",
  "mom-b": "s3",
  "mom-c": "s3",
  "adam-a": "s4",
  "adam-b": "s4",
  lab: "s5",
  "fog-a": "s6",
  "fog-b": "s6",
  "fog-c": "s6",
  "tilt-a": "s7",
  "tilt-b": "s7",
  swarm: "s7",
  labrule: "s8",
  "epi-a": "s9",
  "epi-b": "s9",
  "epi-c": "s9",
};

/* ---------------- engine ↔ host contract ---------------- */

/** Sample of the director state the gate table judges actions against. */
export interface TourSnapshot {
  fit: { x: number; y: number };
  eta: number | null;
  userTip: boolean;
  /** Monotonic count of committed gd-b arrow draws (pointer-up of a real
   *  gesture) — the arrowDrawn gate compares against the gate-start sample:
   *  userTip alone releases on pointer-DOWN (onArrowPreview), mid-gesture. */
  arrowCommits: number;
  fogUsed: number;
  fogDone: boolean;
  ghostsPlaying: boolean;
  /** §3 momentum β (null off the mom scenes). */
  momBeta: number | null;
  /** §4 steepness λ₁ multiplier (null off the adam scenes). */
  steep: number | null;
  /** §5 lab sliders (null off the lab scene). */
  lab: { E: number; rot: number } | null;
  /** §7 tilt run counters + ghost replay. */
  tiltCells: number;
  tiltSteps: number;
  /** §7: the CURRENT run is finished (TOUR-TR-2 — a done run can never grow
   *  the counters above, so gates must also accept this absolute). */
  tiltDone: boolean;
  tiltGhostPlaying: boolean;
  /** §7 swarm blind mode. */
  swarmBlind: boolean;
  /** §8 workbench: the assembled rule + the benchmark landscape (clip null =
   *  off). */
  rule: {
    level: string;
    lr: number;
    beta: number;
    clip: number | null;
    normalize: boolean;
  } | null;
}

export interface TourHost {
  /** The .rstep element parked on `page` (null out of range). */
  stepEl(page: number): HTMLElement | null;
  /** The currently parked reader page. */
  activePage(): number;
  /** True when the reader is parked, unlocked, and the director idle. */
  atRest(): boolean;
  /** Navigate the reader to a page (the v4 stepper; may lock + animate). */
  goToPage(page: number): void;
  /** Spotlight/dim through the existing hover-to-look machinery. */
  applyLook(key: string | null): void;
  /** Screen anchor of a registry target (null when it no-ops on stage). */
  lookScreenPoint(key: string): { x: number; y: number } | null;
  /** The reader panel's left edge (the leader line's anchor x). */
  readerLeft(): number;
  snapshot(): TourSnapshot;
  /** The gate table: has the visitor performed this action since `snap`? */
  gateSatisfied(kind: string, snap: TourSnapshot, cur: TourSnapshot): boolean;
  /** Drain the playing entry animation (Space during travel = Skip). */
  skipAnimation(): void;
}

type TourPhase = "idle" | "travel" | "active" | "closing";

const GATE_POLL_MS = 140;
const DONE_MS = 1600;
const SVG_NS = "http://www.w3.org/2000/svg";

export interface TourState {
  running: boolean;
  phase: TourPhase;
  id: string | null;
  label: string | null;
  /** Position in the tour's sentence playlist (0-based). */
  stepIndex: number;
  count: number;
  /** True while paused on a "try it" chip. */
  gate: boolean;
  gateKind: string | null;
  gateLabel: string | null;
  /** A sentence highlight is live. */
  sentenceActive: boolean;
  /** The leader overlay is visible. */
  overlayOn: boolean;
  lookKey: string | null;
  /** Timed advance (the Auto toggle) — OFF by default in v2. */
  auto: boolean;
  /** The controller is collapsed to its chip. */
  minimized: boolean;
  /** The reader page the controller is parked on. */
  page: number;
  /** The highlighted sentence's text ("" when none is marked). */
  sentenceText: string;
}

export class TourEngine {
  private readonly host: TourHost;
  private readonly overlay: SVGSVGElement;
  private readonly lead: SVGPathElement;
  private readonly head: SVGPolygonElement;
  private readonly dot: SVGCircleElement;
  private readonly pulse: SVGCircleElement;
  private readonly bar: HTMLElement;
  private readonly barFull: HTMLElement;
  private readonly barLabel: HTMLElement;
  private readonly barCount: HTMLElement;
  private readonly backBtn: HTMLButtonElement;
  private readonly nextBtn: HTMLButtonElement;
  private readonly autoBtn: HTMLButtonElement;
  private readonly minBtn: HTMLButtonElement;
  private readonly chipBtn: HTMLButtonElement;
  private readonly statusEl: HTMLElement;
  private readonly gateEl: HTMLElement;

  private def: TourDef | null = null;
  private idx = 0;
  private phase: TourPhase = "idle";
  private expectedPage = -1;
  private sentenceEl: Element | null = null;
  private dimEl: HTMLElement | null = null;
  private auto = false;
  private minimized = false;
  private beatAt = 0;
  private gateOpen = false;
  private gateSnap: TourSnapshot | null = null;
  /** T6-S6-BACK-RESETS-FINISHED-FOG-RUN: set by gotoStep on a BACKWARD move
   *  — the PRE-navigation snapshot plus flag let activate() skip re-arming a
   *  gate the visitor already satisfied before stepping back (a finished fog
   *  run re-entered with Back must not re-demand itself). Cleared in exit,
   *  start, activate, and the frame-loop page-sync. */
  private arriveSnap: TourSnapshot | null = null;
  private arrivedBack = false;
  private lastPoll = 0;
  private closingAt = 0;
  private overlayOn = false;
  /** Free-play sentence hover (hover graduation; idle-only). */
  private hoverEl: HTMLElement | null = null;
  private hoverLook: string | null = null;
  private raf = 0;

  constructor(host: TourHost) {
    this.host = host;

    // Fixed, pointer-transparent leader overlay (drawn over the stage HUD
    // so the arrowhead stays visible over panels; under the right rail).
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.id = "tour-overlay";
    svg.dataset.on = "false";
    svg.setAttribute("aria-hidden", "true");
    const mk = (tag: string, id: string): SVGElement => {
      const n = document.createElementNS(SVG_NS, tag);
      n.id = id;
      svg.appendChild(n);
      return n;
    };
    this.lead = mk("path", "tour-lead") as SVGPathElement;
    this.head = mk("polygon", "tour-arrow") as SVGPolygonElement;
    this.pulse = mk("circle", "tour-pulse") as SVGCircleElement;
    this.dot = mk("circle", "tour-dot") as SVGCircleElement;
    document.body.appendChild(svg);
    this.overlay = svg;

    // The central controller: one flat bar centered at the bottom of the
    // canvas pane. Unlike the pilot's narrate-only chips, the bar is LIVE
    // (pointer-events on itself) — the tour's only click affordances.
    const bar = document.createElement("div");
    bar.id = "tour-bar";
    bar.dataset.on = "false";
    bar.dataset.min = "false";
    this.barFull = document.createElement("div");
    this.barFull.id = "tour-bar-full";
    this.barLabel = document.createElement("span");
    this.barLabel.id = "tour-bar-label";
    this.backBtn = document.createElement("button");
    this.backBtn.id = "tour-back";
    this.backBtn.type = "button";
    this.backBtn.title = "Back one sentence (ArrowUp)";
    this.backBtn.textContent = "◀ Back";
    this.barCount = document.createElement("span");
    this.barCount.id = "tour-count";
    this.nextBtn = document.createElement("button");
    this.nextBtn.id = "tour-next";
    this.nextBtn.type = "button";
    this.nextBtn.title = "Next sentence (Space / ArrowDown)";
    this.nextBtn.textContent = "Next ▶";
    this.autoBtn = document.createElement("button");
    this.autoBtn.id = "tour-auto";
    this.autoBtn.type = "button";
    this.autoBtn.title = "Timed advance — off by default";
    this.autoBtn.textContent = "Auto";
    this.autoBtn.dataset.auto = "false";
    this.minBtn = document.createElement("button");
    this.minBtn.id = "tour-min";
    this.minBtn.type = "button";
    this.minBtn.title = "Minimize the controller";
    this.minBtn.textContent = "–";
    const exitBtn = document.createElement("button");
    exitBtn.id = "tour-exit";
    exitBtn.type = "button";
    exitBtn.title = "Exit the tour (Esc)";
    exitBtn.textContent = "Exit";
    this.barFull.append(
      this.barLabel,
      this.backBtn,
      this.barCount,
      this.nextBtn,
      this.autoBtn,
      this.minBtn,
      exitBtn,
    );
    this.chipBtn = document.createElement("button");
    this.chipBtn.id = "tour-bar-chip";
    this.chipBtn.type = "button";
    this.chipBtn.title = "Restore the controller";
    this.chipBtn.dataset.on = "false";
    bar.append(this.barFull, this.chipBtn);
    document.body.appendChild(bar);
    this.bar = bar;
    this.minBtn.addEventListener("click", () => this.setMinimized(true));
    this.chipBtn.addEventListener("click", () => this.setMinimized(false));
    exitBtn.addEventListener("click", () => this.exit());
    this.nextBtn.addEventListener("click", () => {
      if (this.phase === "travel") this.host.skipAnimation();
      else this.nextNow();
    });
    this.backBtn.addEventListener("click", () => this.backNow());
    this.autoBtn.addEventListener("click", () => this.toggleAuto());

    // Closing pill + "try it" chip, centered above the bar. Purely
    // informational: pointer-events none so they can never block a drag.
    this.statusEl = document.createElement("div");
    this.statusEl.id = "tour-status";
    this.statusEl.dataset.on = "false";
    this.gateEl = document.createElement("div");
    this.gateEl.id = "tour-gate-chip";
    this.gateEl.dataset.on = "false";
    document.body.append(this.statusEl, this.gateEl);
  }

  get running(): boolean {
    return this.phase !== "idle";
  }

  /** Diagnostics for smoke checks / the tour gate (no page behavior). */
  get state(): TourState {
    const step = this.def?.steps[this.idx];
    return {
      running: this.phase !== "idle",
      phase: this.phase,
      id: this.def?.id ?? null,
      label: this.def?.label ?? null,
      stepIndex: this.idx,
      count: this.def?.steps.length ?? 0,
      gate: this.phase === "active" && this.gateOpen,
      gateKind: this.gateOpen ? (step?.gate?.kind ?? null) : null,
      gateLabel: this.gateOpen ? (step?.gate?.label ?? null) : null,
      sentenceActive: this.sentenceEl?.hasAttribute("data-tour-active") ?? false,
      overlayOn: this.overlayOn && (this.phase === "active" || this.hoverEl !== null),
      lookKey: this.phase === "active" ? (step?.look ?? null) : this.hoverLook,
      auto: this.auto,
      minimized: this.minimized,
      page: this.expectedPage,
      sentenceText:
        this.sentenceEl instanceof HTMLElement
          ? (this.sentenceEl.textContent ?? "").trim()
          : "",
    };
  }

  /** Starts (or restarts) a tour. Safe mid-flight: switches cleanly.
   *  START-WHERE-YOU-ARE (FIX-4, supersedes the old start-at-head rule):
   *  seeds the playlist at the FIRST curated step on or after the parked
   *  page — launched from the second half of a section the tour begins
   *  THERE (counter "n / total") and runs forward to the section's end,
   *  and the reader never scrolls back up. Travel fires only when the
   *  parked page precedes the seeded step's page (forward-only fallback —
   *  the entry chip mounts only on the section's own pages, all of which
   *  host steps, so today never). */
  start(def: TourDef): void {
    this.exit();
    this.def = def;
    // FIX-4 seed (replaces U4-START-TRAVEL's idx=0): first step on or
    // after the parked page. The per-frame wheel-sync watch still re-seeds
    // to the parked page's first step whenever activePage() !==
    // expectedPage, so with the seeded step already on the parked page
    // (the only reachable case) no travel fires and the walk activates at
    // rest exactly where the reader sits.
    this.idx = Math.max(0, def.steps.findIndex((s) => s.page >= this.host.activePage()));
    this.auto = false;
    this.minimized = false;
    this.arriveSnap = null; // T6-S6 (a fresh walk never inherits a stale one)
    this.arrivedBack = false;
    this.autoBtn.dataset.auto = "false";
    this.phase = "travel";
    this.expectedPage = def.steps[this.idx].page;
    if (this.host.activePage() !== this.expectedPage) {
      this.host.goToPage(this.expectedPage);
    }
    // U6-LAYOUT-SHIFT / S2B-ANCHOR-1: two body attributes coordinate the
    // fixed tour chrome — data-tour-live (which tour owns the chrome) and
    // data-tour-page (the page the walk is parked on). CSS keys the §7
    // heights to the PAIR: free-play heights on the tilt pages, the dock
    // lift exactly on the swarm page — the ONE sanctioned mid-tour move.
    // Cleared in exit(); idempotent across restarts.
    document.body.dataset.tourLive = def.id;
    document.body.dataset.tourPage = String(this.expectedPage);
    document.addEventListener("keydown", this.onKey, true);
    this.syncBar();
    this.schedule();
  }

  /** Full cleanup — every artifact, every listener. Idempotent. */
  exit(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    document.removeEventListener("keydown", this.onKey, true);
    this.clearSentence();
    this.hoverEl = null;
    this.hoverLook = null;
    this.host.applyLook(null);
    this.overlayOn = false;
    this.overlay.dataset.on = "false";
    this.bar.dataset.on = "false";
    this.bar.dataset.min = "false";
    this.chipBtn.dataset.on = "false";
    this.statusEl.dataset.on = "false";
    this.gateEl.dataset.on = "false";
    this.gateOpen = false;
    this.gateSnap = null;
    this.arriveSnap = null; // T6-S6 (full cleanup — idempotent)
    this.arrivedBack = false;
    this.auto = false;
    this.minimized = false;
    this.def = null;
    this.phase = "idle";
    this.expectedPage = -1;
    this.sentenceEl = null;
    this.dimEl = null;
    delete document.body.dataset.tourLive; // U6-LAYOUT-SHIFT (idempotent)
    delete document.body.dataset.tourPage; // S2B-ANCHOR-1 (idempotent)
  }

  /* ---------------- controller actions ---------------- */

  /**
   * Next: one sentence; past the playlist's end, the closing beat.
   * FIX-4 (no gate traps): while a gate is open Next POLITELY SKIPS it —
   * the gate disarms and the walk moves on. The gate is an invitation,
   * never a trap: only the visitor's own action releases it by itself
   * (and advances), but skipping by hand is always available.
   */
  private nextNow(): void {
    const def = this.def;
    if (!def || this.phase !== "active") return;
    if (this.gateOpen) this.gateOff(); // FIX-4: Next skips the gate
    if (this.idx + 1 >= def.steps.length) {
      this.complete(performance.now());
      return;
    }
    this.gotoStep(this.idx + 1);
  }

  /**
   * Back: one sentence (across a page boundary too — reversed instantly).
   * FIX-4 (no gate traps): Back works DURING AN OPEN GATE — gotoStep
   * disarms the gate on the way out, and the T6 arrival snapshot keeps a
   * gate the visitor already satisfied from re-arming on arrival. Only
   * the playlist head has nothing to reverse to.
   */
  private backNow(): void {
    if (this.phase !== "active") return;
    if (this.idx <= 0) return;
    this.gotoStep(this.idx - 1);
  }

  private toggleAuto(): void {
    this.auto = !this.auto;
    this.autoBtn.dataset.auto = String(this.auto);
    if (this.auto && this.phase === "active" && !this.gateOpen) {
      this.beatAt = performance.now() + this.beatFor(this.def?.steps[this.idx] ?? null);
    }
    this.syncBar();
  }

  private setMinimized(min: boolean): void {
    this.minimized = min;
    this.bar.dataset.min = String(min);
    this.chipBtn.dataset.on = String(min);
    this.chipBtn.textContent = this.def ? `▲ ${this.def.label}` : "▲ tour";
  }

  /** Jump the playlist to `n` (same page → re-mark; new page → travel). */
  private gotoStep(n: number): void {
    const def = this.def;
    if (!def) return;
    // T6-S6: snapshot BEFORE host.goToPage — a backward move's scene entry
    // can wipe state SYNCHRONOUSLY inside goToPage→enterStep→setScene (the
    // fog game resets on every fog-a/fog-b entry), so a post-navigation
    // snapshot would already see the reset board and could never tell that
    // the gate was satisfied before the move.
    const back = n < this.idx;
    this.arriveSnap = back ? this.host.snapshot() : null;
    this.arrivedBack = back;
    this.idx = n;
    this.gateOpen = false;
    this.gateEl.dataset.on = "false";
    this.gateSnap = null;
    this.clearSentence(); // re-marked at activation
    // U3 secondary (TOURUX-S6 arrow residue): drop the leader overlay while
    // travelling — the gate-release travel window (the §6 reveal's ghost
    // race runs ~7s) used to keep the previous step's arrow frozen over its
    // departing anchor the whole way. activate() re-anchors (and re-shows)
    // on arrival; free-play hover cannot own the overlay mid-tour (main.ts
    // suspends hover while a tour runs), so nothing else regresses.
    this.overlayOn = false;
    this.overlay.dataset.on = "false";
    this.phase = "travel";
    this.expectedPage = def.steps[n].page;
    document.body.dataset.tourPage = String(this.expectedPage); // S2B-ANCHOR-1
    if (this.host.activePage() !== this.expectedPage) {
      this.host.goToPage(this.expectedPage);
    }
    this.syncBar();
  }

  private gateOff(): void {
    this.gateOpen = false;
    this.gateSnap = null;
    this.gateEl.dataset.on = "false";
  }

  /* ---------------- per-frame choreography ---------------- */

  private schedule(): void {
    if (!this.raf) this.raf = requestAnimationFrame(this.frame);
  }

  private readonly frame = (now: number): void => {
    this.raf = 0;
    if (this.phase === "idle") {
      // Idle-only: keep the free-play hover's leader anchored.
      if (this.hoverEl && this.hoverLook) {
        this.anchorOverlay(this.hoverEl, this.hoverLook);
        this.schedule();
      }
      return;
    }
    const def = this.def;
    if (!def) return;
    if (this.phase === "closing") {
      if (now - this.closingAt >= DONE_MS) {
        this.exit();
        return;
      }
    } else {
      // The visitor navigated on their own (wheel, rail, deep link): the
      // reader stays master. Within the section the controller SYNCs to the
      // parked page's first registered sentence; past the section's last
      // page the tour exits cleanly.
      const ap = this.host.activePage();
      if (ap !== this.expectedPage) {
        const at = def.steps.findIndex((s) => s.page === ap);
        if (!def.pages.includes(ap) || at < 0) {
          this.exit();
          return;
        }
        this.idx = at;
        this.gateOff();
        this.clearSentence();
        this.arriveSnap = null; // T6-S6 (the reader moved itself — stale)
        this.arrivedBack = false;
        this.expectedPage = ap;
        document.body.dataset.tourPage = String(ap); // S2B-ANCHOR-1
        this.phase = "travel";
        this.syncBar();
      }
      if (this.phase === "travel") {
        if (this.host.atRest()) this.activate(now);
      } else if (this.phase === "active") {
        // Idempotent re-assert: scene rebuilds and stray events clear the
        // spotlight through setLook(null); the tour's sentence owns it.
        this.host.applyLook(def.steps[this.idx].look);
        this.anchorOverlay(this.sentenceEl, def.steps[this.idx].look);
        if (this.gateOpen) {
          if (now - this.lastPoll >= GATE_POLL_MS) {
            this.lastPoll = now;
            const cur = this.host.snapshot();
            const snap = this.gateSnap;
            const kind = def.steps[this.idx].gate?.kind;
            if (snap && kind && this.host.gateSatisfied(kind, snap, cur)) {
              // The action IS the way through a gate: release + advance.
              this.gateOff();
              if (this.idx + 1 >= def.steps.length) this.complete(now);
              else this.gotoStep(this.idx + 1);
            }
          }
        } else if (this.auto && now >= this.beatAt) {
          if (this.idx + 1 >= def.steps.length) this.complete(now);
          else this.gotoStep(this.idx + 1);
        }
      }
    }
    this.schedule();
  };

  /** The page is at rest: light the sentence, the spotlight and the beat. */
  private activate(now: number): void {
    const def = this.def;
    if (!def || this.host.activePage() !== this.expectedPage) return;
    const s = def.steps[this.idx];
    // T6-S6: consume the backward-arrival flags no matter the outcome below —
    // a stale snapshot must never leak into a later activation.
    const back = this.arrivedBack;
    const arriveSnap = this.arriveSnap;
    this.arrivedBack = false;
    this.arriveSnap = null;
    this.markSentence(s);
    this.host.applyLook(s.look);
    if (
      s.gate &&
      back &&
      arriveSnap !== null &&
      this.host.gateSatisfied(s.gate.kind, arriveSnap, arriveSnap)
    ) {
      // T6-S6: the gate was ALREADY satisfied before the backward move (the
      // (snap, snap) call asks the predicate "was this satisfied pre-move" —
      // for fogRun the table ignores snap and returns cur.fogDone, so it
      // reads 'was the run already finished'). Do not re-arm it over a state
      // that cannot repeat the action: gate stays off, the sentence and beat
      // behave normally, Next stays available. Gates NOT satisfied before
      // the move keep today's re-arm behavior.
      this.gateOpen = false;
      this.gateEl.dataset.on = "false";
      this.beatAt = now + this.beatFor(s);
    } else if (s.gate) {
      this.gateOpen = true;
      this.gateSnap = this.host.snapshot();
      this.gateEl.textContent = `try it: ${s.gate.label} — Next skips, Back goes back`;
      this.gateEl.dataset.on = "true";
    } else {
      this.gateOpen = false;
      this.gateEl.dataset.on = "false";
      this.beatAt = now + this.beatFor(s);
    }
    this.statusEl.dataset.on = "false";
    this.syncBar();
    this.phase = "active";
    this.anchorOverlay(this.sentenceEl, s.look);
  }

  /**
   * Auto-advance dwell: an explicit beatMs, else the marked SENTENCE's
   * reading load (≈300ms/word ≈ 200wpm plus a small gaze base, floored at
   * the default so short sentences keep a readable pace). Only consulted
   * while Auto is ON — the v2 default is manual advance.
   */
  private beatFor(s: TourStepDef | null): number {
    if (!s) return DEFAULT_BEAT_MS;
    if (s.beatMs != null) return s.beatMs;
    const words = (this.sentenceEl?.textContent ?? "")
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;
    return Math.max(DEFAULT_BEAT_MS, BEAT_BASE_MS + BEAT_MS_PER_WORD * words);
  }

  /** Complete: drop the artifacts, breathe the closing pill, then exit. */
  private complete(now: number): void {
    const def = this.def;
    if (!def) return;
    this.gateOff();
    this.clearSentence();
    this.host.applyLook(null);
    this.overlayOn = false;
    this.overlay.dataset.on = "false";
    this.statusEl.textContent = `✓ tour complete — ${def.label}`;
    this.statusEl.dataset.on = "true";
    this.closingAt = now;
    this.phase = "closing";
    this.syncBar();
  }

  /* ---------------- sentence highlight ---------------- */

  private markSentence(s: TourStepDef): void {
    this.clearSentence();
    const stepEl = this.host.stepEl(this.host.activePage());
    const el = resolveSentence(stepEl, s.para, s.sent, s.altPara, s.altPara2);
    if (!el) {
      // Never dim a page for a target that resolves to nothing visible —
      // degrade to "no highlight" instead of dimming around a ghost
      // (the empty-reveal dimmed-page bug, kept from the pilot).
      return;
    }
    const body = stepEl?.querySelector(".step__body");
    if (body instanceof HTMLElement) {
      this.dimEl = body;
      body.dataset.tourDim = "true";
      const para = el.closest("p");
      if (para) para.classList.add("tour-keep");
    }
    el.setAttribute("data-tour-active", "true");
    this.sentenceEl = el;
  }

  private clearSentence(): void {
    if (this.sentenceEl) this.sentenceEl.removeAttribute("data-tour-active");
    this.sentenceEl = null;
    if (this.dimEl) {
      this.dimEl.removeAttribute("data-tour-dim");
      for (const p of Array.from(this.dimEl.querySelectorAll("p.tour-keep"))) {
        p.classList.remove("tour-keep");
      }
      this.dimEl = null;
    }
  }

  /* ---------------- free-play sentence hover (graduation) ---------------- */

  /**
   * Hover-to-look, graduated to sentences (v2): hovering a registered
   * sentence highlights it and spotlights its target through the same
   * pointing overlay — without a running tour. Null/null clears. The tour
   * (when running) owns the overlay; hover is suspended by main.ts then.
   */
  hoverPoint(el: Element | null, look: string | null): void {
    const elH = el instanceof HTMLElement ? el : null;
    const lookK = elH ? look : null;
    const same = this.hoverEl === elH && this.hoverLook === lookK;
    this.hoverEl = elH;
    this.hoverLook = lookK;
    if (elH && lookK) {
      if (!same) this.host.applyLook(lookK);
      this.overlayOn = true;
      this.overlay.dataset.on = "true";
      this.schedule();
      return;
    }
    if (!this.running) {
      this.host.applyLook(null);
      this.overlayOn = false;
      this.overlay.dataset.on = "false";
    }
  }

  /* ---------------- pointing overlay ---------------- */

  /**
   * Re-anchors the leader line: reader-left-edge → sentence height →
   * projected target (clamped on screen). Hidden whenever the target
   * no-ops (the registry spotlight no-ops with it — never invents a point).
   */
  private anchorOverlay(anchorEl: Element | null, look: string | null): void {
    if (!anchorEl || !look) {
      if (this.overlayOn) {
        this.overlayOn = false;
        this.overlay.dataset.on = "false";
      }
      return;
    }
    const target = this.host.lookScreenPoint(look);
    if (!target) {
      if (this.overlayOn) {
        this.overlayOn = false;
        this.overlay.dataset.on = "false";
      }
      return;
    }
    const w = window.innerWidth;
    const h = window.innerHeight;
    const tx = Math.min(Math.max(target.x, 12), w - 12);
    const ty = Math.min(Math.max(target.y, 12), h - 12);
    const r = anchorEl.getBoundingClientRect();
    const ax = this.host.readerLeft();
    const ay = r ? Math.min(Math.max(r.top + r.height / 2, 40), h - 40) : h / 2;
    const dx = Math.max(56, ax - tx);
    // Leave the reader horizontally at the sentence's height, arrive at
    // the target horizontally from its side — the classic leader-line arc.
    const c1x = ax - dx * 0.38;
    const c2x = tx + dx * 0.38;
    this.lead.setAttribute("d", `M ${ax} ${ay} C ${c1x} ${ay}, ${c2x} ${ty}, ${tx} ${ty}`);
    // Arrowhead along the curve's end tangent (c2y = ty → horizontal).
    const theta = Math.atan2(0, tx - c2x);
    const L = 13;
    const W = 5.5;
    const bx = tx - L * Math.cos(theta);
    const by = ty - L * Math.sin(theta);
    const nx = -Math.sin(theta);
    const ny = Math.cos(theta);
    this.head.setAttribute(
      "points",
      `${tx},${ty} ${bx + nx * W},${by + ny * W} ${bx - nx * W},${by - ny * W}`,
    );
    for (const c of [this.dot, this.pulse]) {
      c.setAttribute("cx", String(tx));
      c.setAttribute("cy", String(ty));
    }
    if (!this.overlayOn) {
      this.overlayOn = true;
      this.overlay.dataset.on = "true";
    }
  }

  /* ---------------- controller bar sync ---------------- */

  private syncBar(): void {
    if (!this.def) return;
    this.barLabel.textContent = this.def.label;
    this.barCount.textContent = `${this.idx + 1} / ${this.def.steps.length}`;
    this.backBtn.dataset.disabled = String(this.idx === 0);
    this.nextBtn.textContent =
      this.idx + 1 >= this.def.steps.length ? "Finish ▶" : "Next ▶";
    this.bar.dataset.on = "true";
    if (this.minimized) this.setMinimized(true); // refresh the chip's label
  }

/* ---------------- input capture (keyboard only — never clicks) ----------
   Capture phase on document: the tour's handler runs before the reader's
   own window handler, and stopPropagation keeps the stepper from
   double-firing. Space/ArrowDown = Next, ArrowUp = Back, Esc = Exit —
   tour-local while running. FIX-4: Back and Next (and their keys) work
   DURING a gate — Back reverses + disarms, Next politely skips — so a
   waiting gate can never trap the reader. Controls keep their native keys
   (a focused range slider is keyboard-tunable mid-gate; the bar's own
   buttons keep Space so a focused Next cannot double-fire). There is NO
   click handler: plain clicks advance nothing (WP1). */

  private readonly onKey = (e: KeyboardEvent): void => {
    if (this.phase === "idle") return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      this.exit();
      return;
    }
    const t = e.target instanceof Element ? e.target : null;
    if (t) {
      // The controller's own buttons keep native Space activation — but the
      // event must NOT also reach the reader's window handler, or a focused
      // Next/Exit button would advance the READER on the same press (the
      // tour's key capture exists precisely to keep the two apart).
      if (t.closest("#tour-bar")) {
        // Space/ArrowDown keep the focused button's native activation (and
        // must not also fire the reader's window handler). ArrowUp has no
        // native button meaning — FIX-4c: route it to Back, so the walk can
        // always reverse even with the controller focused (a Next/Back
        // click leaves focus on the bar; the old blanket swallow made the
        // keyboard Back dead exactly after using the controller).
        if (e.key === " " || e.code === "Space" || e.key === "ArrowDown") {
          e.stopPropagation();
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          e.stopPropagation();
          if (e.repeat) return;
          this.backNow();
          return;
        }
        return;
      }
      // FOCUSED CONTROLS (TOUR-INT-1-SPACE-SLIDER-LEAK): arrows keep native
      // control tuning (KW-1 — a focused range stays keyboard-tunable
      // mid-gate). Space early-returns ONLY for the TYPES_SPACE class
      // (text-typed inputs / select / textarea / contenteditable — the same
      // distinction main.ts's own Space policy draws; nothing in the app
      // matches today, so nothing native is lost). A mouse-focused
      // RANGE/CHECKBOX's Space used to leak through the old blanket
      // early-return WITHOUT stopPropagation and reach main.ts's window
      // handler, whose stray-focus policy blurred the control and ADVANCED
      // THE READER mid-tour (the frame watch then sync-jumped the playlist,
      // dropping the gate, or exited past the section). Falling through to
      // the tour's own Space branch below shield it with
      // preventDefault+stopPropagation: swallowed at a gate, Next otherwise.
      const CONTROL = "input, select, textarea, [contenteditable]:not([contenteditable='false'])";
      const TYPES_SPACE =
        "input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=reset]):not([type=range]), select, textarea, [contenteditable]:not([contenteditable='false'])";
      if (t.closest(CONTROL)) {
        if (e.key.startsWith("Arrow")) return; // a focused range keeps arrows
        if (t.matches(TYPES_SPACE)) return; // typed input keeps Space natively
        // range/checkbox/radio Space: fall through to the tour's Space branch.
      }
    }
    if (e.key === " " || e.code === "Space" || e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return; // one sentence per physical press (KW2 pattern)
      if (this.phase === "travel") this.host.skipAnimation(); // Skip the entry
      else if (this.phase === "active") this.nextNow();
      // During a gate this SKIPS the gate (FIX-4 — nextNow disarms and
      // advances); the performed action releases it on its own instead.
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      this.backNow();
    }
    // Everything else (wheel, WASD tilt keys, Tab) keeps its reader meaning:
    // navigating away trips the frame-loop watch and syncs or exits cleanly.
  };
}
