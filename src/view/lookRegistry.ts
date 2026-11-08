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
 *   panel    — a HUD instrument panel (the spotlight glows it, the scene dims)
 *   needle   — the gradient needle on the compass minimap
 *   ball     — the learner ball on the 3D surface
 *   trail    — optimizer trail(s) currently on stage (gd / mom / adam / all)
 *   gdStep   — GD's actual step tip in gd-b (the red arrow's landing point)
 *   arrows   — the §4 inspector's two tangent arrows at the inspected point
 *   momApex  — the §3 gold overshoot-and-counter-swing markers
 *   marker   — the gold global-minimum marker (fog-c reveal / epi-a formula)
 *
 * A span whose target is not present in the current scene resolves to a
 * no-op: no dim, no spotlight — hover-to-look never invents a target.
 */

export type PanelId = "fit" | "loss" | "minimap" | "adam" | "curves";

export type LookTarget =
  | { kind: "panel"; panel: PanelId }
  | { kind: "needle" }
  | { kind: "ball" }
  | { kind: "trail"; which: "gd" | "mom" | "adam" | "all" }
  | { kind: "gdStep" }
  | { kind: "arrows" }
  | { kind: "momApex" }
  | { kind: "marker"; which: "fog" | "epi" };

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
  "mom-apexes": {
    label: "the gold overshoot markers",
    target: { kind: "momApex" },
  },

  /* §4 — Adam */
  "adam-bars": {
    label: "the m̂/√v̂ bars panel",
    target: { kind: "panel", panel: "adam" },
  },
  "adam-arrows": {
    label: "the two inspector arrows",
    target: { kind: "arrows" },
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
};
