# Build Plan — "You Can't See the Loss" (CS375 P4)

Through-line: **optimizers are blind — they only measure loss and gradient where they stand; GD, momentum, and Adam are three ways of coping with that blindness.** The blindness has three faces, each explicitly threaded: **spatial** (local vs global minimum — the needle tells you downhill, never where the bottom of the world is), **statistical** (loss = expectation over the data distribution; every measurement is a sample, so map and needle are estimates), **economic** (each step is a measurement, each measurement costs a pass over a batch — why training devours data and compute).

## Tech stack
- Vite + TypeScript, no framework. Static deploy (GitHub Pages).
- Canvas 2D: landscape baked to offscreen ImageData; **d3-scale** (Viridis) + **d3-contour** line overlays; **hillshading** (light · surface normal per pixel) for depth without perspective loss.
- All math hand-written: rotated elongated bowl `A = R·diag(λ₁,λ₂)·Rᵀ` with analytic gradients, parabola, Rosenbrock, Rastrigin, least-squares surface; GD / momentum / Adam (~100 lines total).
- Fog = mask canvas + destination-out stamping along path. Physics hand-rolled: `v += (−∇f·g + tilt − c·v)·dt`.
- Tests (vitest): finite-difference gradient checks; optimizer invariants.

```
src/
  main.ts          — page assembly + scrollytelling step machine (IntersectionObserver)
  core/            — functions.ts, optimizers.ts, renderer.ts, reveal.ts, replay.ts, game.ts
  sections/        — per-chapter canvas step configs
  ui/              — sliders, fit-preview HUD, inspector, scorecard
```

## Website order (top to bottom)

- **Hero.** Title + hook ("You can't see the loss — neither can your optimizer") over a looping three-optimizer race on a hillshaded landscape.
- **§1 The task → the landscape.** Fit `y = wx + b` to ~12 noisy points by dragging w, b; residuals light up; loss = average squared residual (an expectation over the data — different sample ⇒ slightly different map). The (w, b) landscape materializes from the task. Fit-preview inset recurs everywhere.
- **§2 Gradient descent, by hand.** Draw-your-arrow before GD's is revealed (teaches the mechanic early); LR slider: crawl → descend → oscillate → diverge.
- **§3 Momentum.** β slider: zigzag → glide → overshoot oscillation; momentum = selective forgetting.
- **§4 Adam, inspected.** Update inspector: −∇f arrow vs actual update arrow + angle readout; per-coordinate m̂/√v̂ bars; steepness slider showing Adam's step ~invariant to gradient scale.
- **§5 Disagreement lab.** Sliders = data properties: feature scale-difference (elongation), feature correlation (rotation), + Normalize button (heals GD). Three optimizers race from shared start; find where they disagree.
- **§6 Fog game (turn-based).** §1 landscape hidden; draw arrow → step → measure (paint); fit-preview inset + needle only. Scorecard: steps, measurements, **data points touched (steps × batch)**; reveal shows distance-to-true-minimum for player and machines; replay ghosts of GD/momentum/Adam from the player's start.
- **§7 Tilt game (real-time) + levels + swarm.** Pitch/roll board (WASD/joystick), ball inertia = momentum embodied, friction ↔ damping. Levels: elongated valley → Rosenbrock → Rastrigin. Replay scrubber + scorecard. Swarm finale: 100 starts cluster into distinct minima (post-reveal; optional fog-swarm toggle later).
- **§8 Lab: build your own optimizer.** Assemble rule from parts (LR, β, per-coordinate normalize, clip); benchmark steps-to-converge vs the three; **noise toggle** = mini-batch estimates (jittered needles) → momentum/Adam's averages shown as noise smoothers. Beat Adam here, lose elsewhere: no free lunch.
- **§9 Epilogue.** Reveal exact formula of the §1 landscape (least squares, normal equation); then 10⁵–10⁹ dimensions — the map can never be drawn. All stated limitations recapped.

## Build order
1. Scaffold + core: functions, renderer (hillshade/contours), optimizers, gradient-check tests
2. Scrollytelling shell: step machine + sticky layout
3. §1–§5 explainer chapters (states, sliders, inspector)
4. §6 arrow-mode fog game + reveal + replay + measurement/data-touched scorecard
5. §7 tilt mode + levels + scorecard + swarm
6. §8 lab incl. noise toggle (sample-gradient from random subset of points)
7. §9 epilogue + polish
8. Deploy + demo clips

## P3 proposal
- `P3-proposal.md` is the drafted text (all three sub-threads folded in). Figures 1–10 = mockups from the image-generation prompts (caption as "concept mockup"); replace with real screenshots once §1–§2 are built.
- Layout: ≤6 pages, side-by-side text + figures; questions restated as bold openers per section.

## P5 presentation
- Live demo of the page (fog game → reveal → machines race), scorecard money shot, limitations slide mirrors §9.

## Parked (explicitly out of scope)
GAN shifting-landscape demo (future work); Manim/ManimGX intro clip + 3D orbit reveal view (stretch garnish); mobile device-tilt; statistical learning theory beyond "expectation + sampling noise."
