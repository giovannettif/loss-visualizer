/**
 * lookRegistry — the hover-to-look registry (flagship interaction).
 *
 * Declarative and single-source: every `.look` span in the reader carries a
 * `data-look="<key>"` attribute, and THIS table is the only place that maps
 * keys to scene targets. Wiring more spans later means adding spans in
 * index.html and (when a new kind of target is needed) one row here — no
 * new interaction code.
 *
 * Target kinds (resolved by the director against the live scene):
 *   panel      — a HUD instrument panel (the spotlight glows it, the scene dims)
 *   needle     — the gradient needle on the compass minimap
 *   ball       — the learner ball on the 3D surface
 *   ensemble   — the §7 swarm's hundred-ball instanced mesh
 *   trail      — optimizer trail(s) currently on stage (gd / mom / adam / all)
 *   gdStep     — GD's actual step tip in gd-b (the red arrow's landing point)
 *   arrows     — the §4 inspector's two tangent arrows at the inspected point
 *   momApex    — the §3 gold overshoot-and-counter-swing markers
 *   marker     — the gold global-minimum marker (fog-c reveal / epi-a formula)
 *   lattice    — the §9 parameter lattice
 *   tiltLevels — the §7 tilt level-pill row inside the tilt panel
 *   control    — a reader-side DOM control by element id (e.g. #eta-slider):
 *                the pointing overlay anchors its rect center and the glow
 *                lands on the control itself — the tour can demand an action
 *                whose affordance lives in the reader panel
 *
 * A span whose target is not present in the current scene resolves to a
 * no-op: no dim, no spotlight — hover-to-look never invents a target. New
 * targets extend THIS table one row at a time (plus, only when a genuinely
 * new kind of anchor is needed, one LookTarget variant + one director case).
 */

export type PanelId =
  | "fit"
  | "loss"
  | "minimap"
  | "adam"
  | "curves"
  | "fog"
  | "tilt"
  | "rule"
  | "swarmDock"
  | "funcCard";

export type LookTarget =
  /** A HUD panel; `sub` narrows ONLY the leader anchor to a descendant of
   *  the panel (the spotlight stays panel-level) — TOUR-POINT-S8-PILLS-CLIP. */
  | { kind: "panel"; panel: PanelId; sub?: string }
  /** The union of a panel's matched children anchors the leader (the
   *  spotlight stays panel-level) — TOUR-POINT-S4-BARS-READOUT. */
  | { kind: "panelChild"; panel: PanelId; selector: string }
  /** One descendant of a panel anchors the leader at the panel's fixed
   *  ratio on the PART's rect — TOUR-POINT-S7-SCRUBBER-SCORECARD. */
  | { kind: "panelPart"; panel: PanelId; selector: string }
  | { kind: "needle" }
  | { kind: "ball" }
  | { kind: "ensemble" }
  | { kind: "trail"; which: "gd" | "mom" | "adam" | "all" }
  | { kind: "gdStep" }
  | { kind: "arrows" }
  | { kind: "momApex" }
  | { kind: "marker"; which: "fog" | "epi" }
  | { kind: "lattice" }
  /** A reader-side DOM control by element id (U1-POINT-ETA): anchors its
   *  rect center; hidden/non-active controls (getClientRects empty — the
   *  resolveSentence guard) no-op, never inventing a target. */
  | { kind: "control"; el: string }
  | { kind: "tiltLevels" };

export interface LookEntry {
  /** Human label (diagnostics + future a11y copy). */
  label: string;
  target: LookTarget;
}

export const LOOK_TARGETS: Readonly<Record<string, LookEntry>> = {
  /* §1 — the task */
  "fit-inset": {
    label: "the fit-preview inset",
    target: { kind: "panel", panel: "fit" },
  },
  "loss-readout": {
    label: "the loss readout",
    target: { kind: "panel", panel: "loss" },
  },
  "compass": {
    label: "the compass minimap",
    target: { kind: "panel", panel: "minimap" },
  },
  "needle": {
    label: "the gradient needle",
    target: { kind: "needle" },
  },

  /* §1/§2 — the learner ball on the surface */
  "ball": {
    label: "the white point (the learner)",
    target: { kind: "ball" },
  },

  /* §2 — the η slider in the reader panel (U1-POINT-ETA): the gd-c gate
   * sentence demands sliding THIS control, so the pointing overlay and the
   * glow anchor it — not the learner ball ~856px away on the stage. */
  "eta-slider": {
    label: "the learning-rate η slider",
    target: { kind: "control", el: "eta-slider" },
  },

  /* §2 — gradient descent */
  "gd-step": {
    label: "GD's actual step (red)",
    target: { kind: "gdStep" },
  },
  "trail-gd": {
    label: "GD's trajectory (red)",
    target: { kind: "trail", which: "gd" },
  },

  /* §3 — momentum */
  "trail-mom": {
    label: "momentum's trajectory (blue)",
    target: { kind: "trail", which: "mom" },
  },

  /* §3 — the β slider in the reader panel (TOUR-POINT-S3-BETA-GATE-STAGE):
   * the mom-a gate sentence demands sliding THIS control — the old
   * "trail-mom" look anchored the stage trail tip ~590px away from it.
   * Same U1-POINT-ETA "control" precedent as §2's eta-slider. */
  "beta-slider": {
    label: "the momentum β slider",
    target: { kind: "control", el: "beta-slider" },
  },

  "mom-apexes": {
    label: "the gold overshoot markers",
    target: { kind: "momApex" },
  },

  /* §4 — Adam */
  "adam-bars": {
    label: "the m̂/√v̂ bars rows",
    target: { kind: "panelChild", panel: "adam", selector: ".bar-row" },
  },
  "adam-readout": {
    label: "the angle + step-length readout",
    target: { kind: "panelChild", panel: "adam", selector: ".inspector-readout" },
  },
  "adam-arrows": {
    label: "the two inspector arrows",
    target: { kind: "arrows" },
  },

  /* §4 — the steepness λ₁ slider in the reader panel
   * (TOUR-POINT-S4-STEEP-GATE-STAGE): the page-12 gate demands sliding THIS
   * control — "adam-arrows" anchored the stage inspector arrows ~713px away
   * from it. U1-POINT-ETA "control" precedent; the page-11 inspector
   * sentence keeps "adam-arrows". */
  "steep-slider": {
    label: "the steepness λ₁ slider",
    target: { kind: "control", el: "steep-slider" },
  },

  /* §5 — the disagreement lab */
  "trail-adam": {
    label: "Adam's trajectory (yellow)",
    target: { kind: "trail", which: "adam" },
  },
  "trails-all": {
    label: "all three trajectories",
    target: { kind: "trail", which: "all" },
  },

  /* §5 — the lab slider block, docked on the canvas pane (COPY-PLAN §2.10's
   * #lab-dock move — no longer reader-side). (TOUR-POINT-S5-LAB-GATE-STAGE):
   * the labMoved gate demands moving the elongation/rotation sliders —
   * anchored on the BLOCK wrapper so one target covers both named rows
   * (center lands between them). The .eta-control[data-spot] glow rule is
   * the shared class, so the block glows for free. */
  "lab-sliders": {
    label: "the lab sliders (λ₁/λ₂ and φ)",
    target: { kind: "control", el: "lab-sliders" },
  },

  /* §5 — the regime checklist, docked on the canvas pane with the sliders
   * (#lab-dock; COPY-PLAN §2.10). (TOUR-POINT-S5-CHECKLIST-LOOK): the
   * "checklist lights" sentence names THIS list; on the dock it sits on
   * stage, near the trails it grades. */
  "lab-checklist": {
    label: "the regime checklist",
    target: { kind: "control", el: "lab-checklist" },
  },

  "curves-panel": {
    label: "the loss curves panel",
    target: { kind: "panel", panel: "curves" },
  },

  /* §6/§9 — the gold reveal marker */
  "gold-marker": {
    label: "the gold global-minimum marker",
    target: { kind: "marker", which: "fog" },
  },
  "epi-marker": {
    label: "the normal-equations minimum",
    target: { kind: "marker", which: "epi" },
  },

  /* §6 — the fog game panel (the §6 tour's Finish/reveal beat) */
  "fog-panel": {
    label: "the fog game panel",
    target: { kind: "panel", panel: "fog" },
  },

  /* §6 — the footer Replay button (TOUR-POINT-S6-FOOTER-REPLAY-STAGE): the
   * final step's sentence and gate demand THIS reader-footer control; the
   * old "ball" look anchored the stage ball ~900px away. U1 precedent;
   * needs its own data-spot glow rule (the footer is reader DOM). */
  "replay-btn": {
    label: "the footer Replay button",
    target: { kind: "control", el: "replay-btn" },
  },

  /* §7 — the tilt game panel (damping, levels, scorecard, swarm clusters) */
  "tilt-panel": {
    label: "the tilt game panel",
    target: { kind: "panel", panel: "tilt" },
  },

  /* §7 — the damping c slider (POINT-TS2-1): the damping sentence NAMES the
   * c-slider row, but "tilt-panel" anchored the leader at the PANEL's fixed
   * vertical midpoint — ~67px below the named row unsteered, and on the
   * #tilt-levels pills' top edge mid-tour (the tour's steer gate sets
   * run.steered, un-hiding #tilt-restart and growing the panel 31px). The
   * panelPart kind anchors the named control itself (#tilt-friction) while
   * the spotlight stays panel-level — the same S2B-ANCHOR-1 precedent as
   * "tilt-replay"→#tilt-replay-play. The scorecard step keeps "tilt-panel"
   * (U5-POINT-LEVELS). */
  "tilt-damp": {
    label: "the damping c slider",
    target: { kind: "panelPart", panel: "tilt", selector: "#tilt-friction" },
  },

  /* §7 — the ghost replay transport (TOUR-POINT-S7-SCRUBBER-SCORECARD;
   * S2B-ANCHOR-1): the page-20 step's demanded control is the ▶ ghost
   * BUTTON — anchoring the two-line #tilt-replay ROW at its 42%/50% landed
   * the focal dot in the row's line gap (under the bar on the tilt pages).
   * The spotlight stays panel-level. */
  "tilt-replay": {
    label: "the ghost replay transport",
    target: { kind: "panelPart", panel: "tilt", selector: "#tilt-replay-play" },
  },

  /* §7 — the level pills row (U5-POINT-LEVELS): the page-19 level sentence
   * names the pills; the generic whole-panel anchor landed on the damping
   * row ~56px above them. The damping sentence has its own "tilt-damp" part
   * anchor (POINT-TS2-1); the scorecard and ghost steps keep "tilt-panel". */
  "tilt-levels": {
    label: "the tilt level pills",
    target: { kind: "tiltLevels" },
  },

  /* §7 — the swarm dock on the visualizer (TOUR-POINT-S7-BLINDTOGGLE-DOCK):
   * the final step's gate ticks #swarm-blind HERE — a separate bottom-left
   * HUD, not the top-left tilt panel the generic anchor pointed at. */
  "swarm-dock": {
    label: "the swarm dock (landscape pills, run-blind toggle, replay transport)",
    target: { kind: "panel", panel: "swarmDock" },
  },

  /* §7 — the swarm finale's hundred-ball ensemble (the instanced mesh
   * replaces the single learner ball there — `ball` is not on stage) */
  "swarm-ensemble": {
    label: "the hundred-ball ensemble",
    target: { kind: "ensemble" },
  },

  /* §8 — the optimizer workbench panel (the four rule parts + landscape) */
  "rule-panel": {
    label: "the optimizer workbench panel",
    target: { kind: "panel", panel: "rule" },
  },

  /* §8 — the benchmark landscape pills (TOUR-POINT-S8-PILLS-CLIP): two of
   * the five s8 sentences name THIS row; the generic panel midpoint landed
   * on the clip-dial row above it. Spotlight stays panel-level (sub). */
  "rule-levels": {
    label: "the benchmark landscape pills",
    target: { kind: "panel", panel: "rule", sub: "#rule-levels" },
  },

  /* §9 — the parameter lattice (the dimension-honesty stage, epi-b/c) */
  "epi-lattice": {
    label: "the parameter lattice",
    target: { kind: "lattice" },
  },

  /* The function card (FUNC-CARD): the docked formula chip on the canvas
     pane — the current landscape's function with its LIVE parameters.
     Sentences about the function/landscape point at it (§2's "test
     landscapes", gd-c's "λmax = 2", §4's steepness sentence, §5's "rebuild
     the valley", §6/§7's level names, §8's benchmark-landscape sentence).
     Show-after contexts (§6 pre-reveal, §7 pre-scorecard, blind swarm)
     resolve to a no-op by the standard rule — the chip is not on stage,
     and the look never invents a target (that absence IS the spoiler
     policy). */
  "func-card": {
    label: "the function card (the landscape's formula, live)",
    target: { kind: "panel", panel: "funcCard" },
  },
};
