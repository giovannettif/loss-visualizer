# STATUS — "You Can't See the Loss"

Last updated: 2026-11-05 (at the `BackupPlan1` snapshot).

## Section status vs the original plan (P3-proposal.md / PLAN.md)

| § | Section | Status |
|---|---------|--------|
| — | Hero (full-screen intro, looping 3-optimizer race) | ✅ Built, gated |
| §1 | The task — fit y=wx+b, residuals, loss surface materialization | ✅ Built, gated |
| §2 | GD intro — needle, draw-your-arrow, η slider regimes | ✅ Built, gated |
| §3 | Momentum — zigzag vs glide, β slider, overshoot markers | ✅ Built, gated |
| §4 | Adam — update inspector (arrows, angle, m̂/√v̂ bars, steepness) | ✅ Built, gated |
| §5 | Disagreement lab — live elongation/rotation, 3-way race, loss curves, checklist | ✅ Built, gated |
| §6 | Fog game — hidden landscape, measurement painting, reveal, ghost replays | ✅ Built, gated |
| §7 | Tilt game — physics, 3 levels, replay, scorecard, multi-well swarm + blind mode | ✅ Built, gated |
| §8 | Optimizer lab — custom rule from parts, steps-to-converge, no-free-lunch flip | ✅ Built, gated |
| §9 | Epilogue — exact formula reveal, parameter lattice, limitations, credits | ✅ Built, gated |

Interaction shell: reader panel v4 (continuous scroll, snap, lock+skip, reverse, right-edge rail), universal ▶ Play transports (pause/replay/scrub/speed), hover-to-look (34 wired spans), full-screen intro choreography, clean loading state, camera (orbit/zoom/presets — **pan pending, this round**).

**Verification:** build green · 76-test vitest suite · 8 browser automation gates · 37 canonical screenshots (`bash tools/run-gate.sh tools/shots.mjs`).

## ⚠️ Standing reminder
**The guided tour is a PILOT on §1, §2, §6 only.** If you like it, the remaining sections (§3, §4, §5, §7, §8, §9) still need tours built. This is tracked here so it doesn't get lost.

## Parked (explicitly out of scope, from the original plan)
GAN shifting-landscape demo · Manim/ManimGX intro clip · mobile device-tilt · perspective camera mode.

## Known-open findings at snapshot time
The "Final QA report" run (2026-11-04) left 19 persisted findings (5 high: tilt auto-settle never fires, §2 curvature-gloss math error, §6 false "local minimum" sentence, §8 "momentum slowest" contradiction, ~10fps replay path; 14 medium incl. hover-to-look undocumented, continue-↓ overflow at ~900px, HUD overlap at ~900px, fog game skippable-then-graded-empty, tilt drift graded as the player's run, swarm never reaches a finished state) plus user-reported animation artifacts (vanishing circle near the ball, grid/line glitches, lines off-screen, leftover lines) and camera panning missing. The "Sweep & Clear" round addresses these.
