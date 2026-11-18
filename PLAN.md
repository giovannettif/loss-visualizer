# "You Can't See the Loss" — Full Build Plan

Interactive scrollytelling explorable for CS375 (P3 proposal → P4 build → P5 present) on **adaptive optimizers**.

**Through-line:** *optimizers are blind — they only measure loss and gradient where they stand; GD, momentum, and Adam are three different ways of coping with that blindness.*

Single static web page, fully real-time, no server, no video in the critical path.

## Rendering decision: isometric 3D with camera controls

The landscape is a genuine 3D surface: height field `f(x, y) → loss` with valleys, walls, saddles, minima. **Primary view: isometric 3D terrain with a user-movable camera.**

- **Camera rig:** orthographic (isometric-feel, no perspective distortion), free azimuth orbit via drag, pitch clamped 25°–90° (90° = exact top-down "map view"), wheel/pinch zoom clamped. Presets: "Isometric" (default) and "Map view" (top-down) buttons.
- **Engine:** three.js used *only* inside the landscape viewport component — heightmap mesh, real directional lighting (replaces hand-rolled hillshading), OrbitControls-style rig. All math, state, and UI stay in plain TypeScript; d3-scale still colors vertices (Viridis), d3-contour polylines are lifted onto the surface as contour lines.
- **The compass minimap (design guardrail):** a small always-available 2D top-down inset showing the parameter plane. All *direction-critical* interactions happen there — drawing your arrow (§2, §6), reading the gradient needle, unambiguous angle comparisons — because isometric projection distorts screen-space directions. The main 3D view carries the experience; the minimap carries precise reading. Inspectors always compute angles in parameter space, never screen space.
- **Fog on 3D:** fog mask is a texture in parameter (uv) space — same destination-out stamping as planned, sampled by the material so unexplored terrain renders as dark void and explored terrain appears. Painting cost unchanged.
- **Performance:** camera orbit = GPU re-render (trivial); landscape mesh rebuilt only when sliders change; 100-ball swarm via instanced meshes. The old 60fps-drag risk disappears.
- **Per-section camera defaults:** Hero — free orbit, slow auto-drift; §1–§5 — isometric default, orbit allowed, "map view" one click away; §6 fog game — high pitch default (readability), compass minimap drives arrow-drawing; §7 tilt game — isometric default (marble-valley feel), pitch clamped tighter during play, free orbit between runs and during replays.

## Interaction model v2 (user-approved 2026-10-28 — supersedes the scrollytelling rows above)

**Layout:** the page is a two-pane app, no document scroll. LEFT: the sticky 3D viewport. RIGHT: ONE full-height reader panel (a single continuous surface, not per-step cards/panels) containing all step text; steps swap inside it with a snap transition.

**Input policy:**
- Wheel over CANVAS = camera zoom (kept). Left-drag = orbit. Right-drag/pinch = also zoom. No auto-zoom breathing anywhere; the hero drifts without zooming.
- Wheel over the READER PANEL = hijacked for step progression: advances to the next step; the incoming text snaps into place; the step's core animation plays; scrolling is LOCKED until it completes (Skip button unlocks immediately); then a "continue ↓" affordance shows. Same for keyboard (↓/↑, Space). **Superseded 2026-11-13: click-to-advance is REMOVED** — a plain click on reader text selects text only; progression is wheel / Space / ↓ / ↑ / the continue hint / Skip / the rail (see STATUS.md).
- Steps whose point is an animation auto-play on snap (hero race, materialization).

**Universal ▶ Play system:** every trajectory-bearing state — drawn arrow (§2), η slider (§2), β (§3), steepness (§4), lab sliders (§5), fog-game replays, tilt replays — gets a Play control that animates the ball continuously rolling along the current path (eased per step, trail painting as it rolls), with replay and speed toggle.

**Ball readability:** soft contact shadow / ground-spot decal directly beneath the ball (and floating arrow endpoints), scaling/fading with height so 3D position reads at a glance.

**Carried-in fixes:** m̂/v̂ hat typography (detached carets in §4 — medium, judge-verified); low nits: β slider missing in mom-b beat, grey-vs-green regime labels, hot additive trail knot (mom shot), low-contrast hero eyebrow.

## Status (updated 2026-11-13)
**All work packages WP-A..WP-F are complete** — every section built, gated and QA'd through multiple cycles, with the guided tour on all nine sections and the camera pan/orbit/zoom rig shipped. See **STATUS.md** for the current per-section table, the interaction shell, and the QA record. The stable snapshot is git tag **`BackupPlan1`** (see RESTORE.md).


## Tech stack

- **Vite + TypeScript**, no framework
- **three.js (viewport only)**: heightmap mesh, orthographic isometric camera + orbit rig, directional lighting, instanced swarm, fog mask texture, 3D arrows/trails
- **d3-scale** (Viridis vertex colors) + **d3-contour** (contour polylines lifted onto the surface)
- **HTML/CSS** for all UI: sliders, scorecards, fit-preview inset, compass minimap (2D canvas), inspector readouts
- **Hand-written math**: rotated elongated bowl `A = R·diag(λ₁,λ₂)·Rᵀ` with analytic gradients, parabola, Rosenbrock, Rastrigin, exact least-squares surface; GD/momentum/Adam (~100 lines total)
- **Fog**: mask canvas (uv space) + destination-out stamping along path → used as mesh texture
- **Tilt physics** hand-rolled in parameter space: `v += (−∇f·g + tilt − c·v)·dt`, no physics engine; ball rendered on surface at f(x,y) + offset along normal
- **Scrollytelling**: IntersectionObserver step machine; text column scrolls past sticky viewport; in-scene dim/spotlight focus cues
- **Tests**: vitest — finite-difference gradient checks + optimizer invariants (all math is parameter-space; rendering changes don't touch it)
- **Deploy**: static, GitHub Pages. No Manim in the core; no Plotly.

## The page, top to bottom

| § | Section | Key interaction |
|---|---------|----------------|
| — | **Hero** — title + hook over an orbiting 3D landscape with a looping 3-optimizer race | drag to orbit |
| §1 | **The task** (tie-back anchor): fit y = wx + b to ~12 noisy points; drag w/b, residuals light up, loss = squared residuals; the (w,b) surface *rises into 3D from the task*; fit-preview inset recurs everywhere | drag parameters |
| §2 | **GD intro** (visible, slow): needle on compass minimap; **draw-your-arrow on the minimap** vs GD's real step; LR slider: crawl → descend → oscillate → diverge | draw arrow, slider |
| §3 | **Momentum**: zigzag vs glide draped on the elongated 3D valley; β slider; overshoot/counter-swing | β slider |
| §4 | **Adam**: update inspector — −∇f arrow vs update arrow (3D tangent arrows + parameter-space angle readout); per-coordinate m̂/√v̂ bars; steepness slider showing step ~invariance | sliders, watch |
| §5 | **Disagreement lab** (assignment core): live elongation + rotation sliders reshape the 3D valley; 3-way race; loss curves; regime checklist | reshape landscape live |
| §6 | **Fog game** (turn-based): dark 3D surface — only fit-preview inset + compass needle; draw arrow on minimap → step → explored terrain appears in 3D; reveal → your ghost replay → GD/momentum/Adam ghosts from same start → "global min was elsewhere" | draw arrows blind |
| §7 | **Tilt game** (real-time): pitch/roll the valley; ball with real inertia (momentum embodied); friction ↔ β; levels: valley → Rosenbrock → Rastrigin; replay scrubber + scorecard; swarm finale (post-reveal): 100 balls stream into distinct minima in 3D | tilt board, orbit camera |
| §8 | **Lab**: build your own optimizer from parts (LR, β, normalize, clip); steps-to-converge benchmark; beat Adam here, lose elsewhere | assemble rule |
| §9 | **Epilogue**: exact least-squares formula revealed ("for two parameters, the map was literal truth"), then the ~10⁶-parameter blind spot + stated limitations | read |

## Work packages (build order)

- **WP0 — Scaffold + core engine.** Vite+TS, git init; `core/functions.ts` (landscapes + analytic gradients), `optimizers.ts`, `replay.ts`; `view/LandscapeView.ts` (three.js heightmap mesh, isometric camera rig with orbit/zoom/presets, lighting, Viridis vertices, lifted contour lines, compass minimap component); vitest gradient checks green. *Accept: tests pass; debug page shows bowl/Rosenbrock/Rastrigin in 3D with working orbit, zoom, and map-view toggle.*
- **WP1 — Scrollytelling shell + Hero + §1.** Step machine, sticky layout, focus-cue system, hero loop with free orbit; task panel with draggable w/b, residuals, loss readout, surface-materialization moment, fit-preview inset. *Accept: steps drive scene states; first "looks right" milestone.*
- **WP2 — §2 GD intro.** Minimap needle, draw-arrow (on minimap) vs GD step, LR slider regimes, 3D trajectory. *Accept: all steps animate on scroll; slider sweeps all four regimes.*
- **WP3 — §3 Momentum + §4 Adam.** β behaviors; inspector (tangent arrows, parameter-space angle readout, m̂/√v̂ bars), steepness slider. *Accept: inspector readable at a glance; bars respond live.*
- **WP4 — §5 Disagreement lab.** Live elongation/rotation sliders rebuilding the mesh, 3-way race, loss curves, regime checklist. *Accept: smooth while dragging sliders and orbiting simultaneously.*
- **WP5 — §6 Fog game.** Fog mask texture on mesh, minimap arrow-step loop, reveal sequence, ghost replays (player + 3 optimizers) on the 3D surface. *Accept: full play loop finishable; replay scrubber works.*
- **WP6 — §7 Tilt game + swarm.** Parameter-space physics, tilt input, camera clamps during play, 3 levels, scorecard, replay, instanced 100-ball swarm. *Accept: 60fps playable; swarm shows clear clustering disagreement.*
- **WP7 — §8 Lab.** Rule assembly UI, cross-landscape benchmark. *Accept: custom rule can win on one landscape, lose on another.*
- **WP8 — §9 Epilogue + polish.** Formula reveal, dimension-honesty card, limitations, page-wide polish, credits/prior-art links.
- **WP9 — Deploy.** GitHub Pages, final screenshot suite, demo clips for P5.

**Must-ship core: WP0–WP6.** WP7–WP8 progressively droppable under deadline pressure.

## Phase A — P3 proposal (next deadline, before deep build)

1. Run WP0 + WP1 (+ quick §2) to capture 3–4 real screenshots (isometric + map view).
2. Generate concept mockups for remaining sections using the 11 prompts — **update the style block to:** `isometric low-poly 3D terrain heightmap, vivid viridis colormap (dark blue-purple low, teal-green mid, yellow high), dark charcoal background, glowing neon trails draped on the surface, orthographic camera, subtle orbit-controls UI hint, minimal flat UI panels` — caption "concept mockup"; overlay real labels in post.
3. Write ≤6-page PDF: description + section walkthrough + sketches + the three reflections (below) + prior-art citations.

### Reflections (drafted, mapped to sections)

**Learning obstacle.** Learners know θ ← θ − η∇f and have seen contour+trajectory pictures, yet believe (a) the optimizer sees the whole landscape — the picture exists only because someone with global knowledge drew it; the algorithm's entire information is one loss value and one gradient at one point — and (b) the best step points along −∇f and steeper gradient ⇒ bigger useful progress. Bet posed before any reveal: steep wall vs shallow floor, which step makes more progress? Most bet steep; on the elongated rotated bowl (curvature ratio ~50) that policy zigzags — step length spent crossing the valley gets cancelled, floor progress ∝ η·λmin, and raising η to fix the crawl diverges. Follow-up surprise: learners predict Adam takes ~50× shorter steps on a 50× steeper wall; actually m̂/√v̂ ≈ ±1 per coordinate, so its update does not point along −∇f at all. And in the fog game, a player who followed the needle every turn predicts they found the lowest point; the reveal shows the global minimum across an unvisited ridge. Revision happens against the learner's own committed predictions: draw-arrow (§2) loses the bet; fog (§6) makes blindness visceral; inspector + bars (§4) show the normalization mechanism; elongation/rotation sliders (§5) let them verify the corrected model by prediction (round bowl ⇒ agreement; elongate/rotate ⇒ disagreement returns).

**Interaction.** Draw your step before GD's is revealed (§2) → steps that "feel right" on walls are the zigzag. LR slider (§2) → crawl/descend/oscillate/diverge exposes GD's wall-bounce vs floor-speed dilemma. β slider (§3) → zigzag→glide→overshoot; averaging recent gradients cancels across-valley components and preserves along-valley ones — selective forgetting, not extra force. Adam steepness slider (§4) → GD's step grows 50× while Adam's barely changes; v̂ absorbs the scale. Landscape sliders (§5) → disagreement becomes a parametrized, findable boundary. Fog game (§6–§7) → choose a policy, observe explored terrain, measurement budget, loss vs machine ghosts — local optimality ≠ global. Swarm (§7) → basins of attraction and optimizer-dependent escapes. Lab (§8) → an update rule is a bet about landscape structure. Every misconception is committed to as a prediction before the reveal, then revised on the same screen against a mechanism view.

**Limitation.** (1) 2D-parameter intuitions ≠ 10⁵–10⁹-dim reality, where saddles rather than valleys dominate. (2) Rankings shown are not universal — on real tasks momentum-SGD sometimes generalizes better than Adam; our curated traps are escapeable; "fastest descent = best optimizer" (scoreboard framing) ignores generalization and per-step compute cost. (3) The fog lifts after play — the thing that never happens in practice; may suggest enough measurements recover the landscape, but no low-dim map exists to recover. (4) Deterministic full-batch trajectories overstate how clean real training is. Epilogue states all four explicitly.

### Prior art to cite
Distill "Why Momentum Really Works" (Gabriel Goh; d3-contour heritage) · TensorFlow Playground (TS + D3 pattern) · Emilien Dupont's optimizer visualization (click-to-start, optimizer toggles; no loss curves, no inspector, flat 2D — gaps we fill) · Gradient Golf (ball/landscape game; its fully-visible flat map is exactly the misconception we fix — citable differentiator) · Rolling Ball Optimizer paper (OpenReview 2025, academic ball/landscape precedent).

## Explicitly parked
GAN shifting-landscape demo (future-work line only) · Manim/ManimGX intro clip (P5 garnish only) · mobile device-tilt · fog-swarm toggle (if time allows) · perspective (non-orthographic) camera mode.
