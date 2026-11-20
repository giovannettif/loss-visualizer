# Architecture — how the code works

The page teaches one idea: *optimizers are blind — they only measure the
loss and gradient where they stand.* The architecture serves that: the math
is pure and testable, the rendering is one reusable viewport, the reader is
one scroll machine, and every scene is mapped by a single director.

```
index.html ──────────────── the page: section markup + all reader copy
src/main.ts ─────────────── boot + the step machine (scroll, locks, keys, rail)
src/core/ ────────────────── pure math (no DOM, no three, deterministic)
  functions.ts              landscape library: f, ANALYTIC grad, extent
  optimizers.ts             GD / momentum / Adam as pure state machines
src/view/ ────────────────── rendering + reader interactions
  LandscapeView.ts          the reusable three.js viewport (3,900 lines)
  CompassMinimap.ts         always-on 2D parameter-plane inset
  tourEngine.ts             guided-tour engine (sentence-addressed)
  sentences.ts              runtime sentence segmentation of the reader
  lookRegistry.ts           hover-to-look: span key → scene target (single table)
  functionCard.ts / FitPreview.ts / lossCurves.ts / animatedTrail.ts /
  trajectoryPlayer.ts / palette.ts
src/scenes/ ──────────────── per-section scene logic
  director.ts               THE map: named scene → everything on screen (8,500 lines)
  fogGame.ts / tiltGame.ts / ruleLab.ts   pure game cores (§6 / §7 / §8)
  heroRace.ts               the hero's looping optimizer race
```

## Layer 1 — `src/core`: pure math

`functions.ts` defines every landscape as an exact analytic height field:
each exposes an objective `f`, its **analytic** gradient `grad` (never
finite differences at runtime), and the parameter-space `Extent` to draw.
All deterministic — no `Math.random`, no ambient state. The §1 least-squares
surface, the §2/§3 rotated elongated bowl, Rosenbrock, Rastrigin, the §7
archipelago, the §7 swarm's multi-well maps, and the canyon-peaks tilt level
all live here.

`optimizers.ts` implements GD, momentum, and Adam as pure state machines:
`step(state, grad)` returns a **new** state (input never mutated). Same
inputs → same outputs, every time — this is what makes replay scrubbing and
the deterministic browser gates possible.

`math.test.ts` verifies both layers: finite-difference gradient checks and
multi-start descents asserting the minima structure of every landscape.

## Layer 2 — `src/view`: one viewport, one minimap, one tour engine

**LandscapeView** is the single reusable three.js viewport. One instance
owns a heightmap mesh (Viridis vertex colors), lifted d3-contour lines, the
camera rig (left-drag pan, right-drag orbit, wheel zoom, isometric/map
presets), overlay slots (trails, arrows, the learner ball), and a fog-mask
canvas (512² UV-space texture, `destination-out` stamping, sampled by the
terrain shader) used by the fog game, the blind swarm, and tilt fog. The
world mapping is fixed project-wide: `parameter (px,py) → world
(px−cx, f̂·H, −(py−cy))`, with `f̂` normalized to [0,1] and a per-landscape
vertical scale `H`.

**CompassMinimap** is the design guardrail: a small always-available
top-down inset of the parameter plane (same contour convention as the 3D
view). All angles and lengths live in **parameter space**, never screen
space — the gradient needle's fixed length makes its *angle* the message.

**The reader** (`main.ts` + `index.html` markup) is a scroll-driven step
machine: named scenes ↔ park positions, one advance per keypress (held keys
are guarded), forward entries lock briefly so fast input can't skip an
animating scene, backward travel is instant, and the last step parks.
Clicking text never advances anything — text is for reading/selection.

**sentences.ts + tourEngine.ts** power the guided tours. At boot,
`sentences.ts` segments every reader paragraph into sentence spans (walking
text nodes only; decimals and math never split). A tour is pure **data**:
`TOURS` in `tourEngine.ts` lists sentence visits (page + paragraph + sentence
index) each with a `lookRegistry` target and optional interaction gate; a
central controller (back / next / counter / exit) drives them, and Next
politely skips a gate the user doesn't want to play. `lookRegistry.ts` is
the single table mapping `data-look` spans (and tour targets) to scene
targets — hovering a span spotlights its target with a leader arrow.

## Layer 3 — `src/scenes`: the director and the game cores

**director.ts** maps the step machine's named scenes to everything on
screen — per-section HUD panels, sliders, transports, replay/scrub
machinery, camera choreography between steps, and the fog/swarm/tilt state.
It resolves `lookRegistry` targets against the live scene.

**fogGame / tiltGame / ruleLab** are the pure, deterministic cores of the
three games (no DOM, no three.js — same discipline as `src/core`), so their
logic is unit-tested in `*.test.ts` beside them. The director owns their
turn loops and rendering. `heroRace.ts` precomputes the hero's three
optimizer trajectories from `src/core/optimizers` and eases heads along
them on a loop.

## Verification pipeline (`tools/`)

- `run-build.sh` / `run-tests.sh` — typecheck+build and the vitest suite.
- `run-gate.sh <gate.mjs>` — owns port 4173, kills stale listeners, serves
  the fresh production build, runs a browser gate (Playwright-driven real
  Chrome) that asserts user-visible behavior: `gate-tour` (all nine tours),
  `gate-tilt`, `gate-fog`, `gate-hover` (hover-to-look), `gate-labrule-epi`.
- `shots.mjs` — recaptures the canonical screenshot set into `shots/`.

**Portable Node:** `tools/node/node.exe` is this machine's Node (not
needed by clones). npm's cmd-shims resolve `node.exe` next to themselves —
`ensure-node-shim.sh` hardlinks it into `node_modules/.bin` so the gates
run identically from any shell context (the WSL-bash PATH quirk that
motivated this is documented in that script's header).

## Conventions worth keeping

- All math stays pure (`src/core`, game cores); rendering never touches it.
- Every landscape's gradient is analytic; FD is test-only.
- New reader-referenced scene elements get one `lookRegistry` row, not new
  interaction code; new tour content is data entry in `TOURS`.
- Working-copy-only material (QA evidence under `evidence/` and `shots/`,
  planning docs under `docs/` except this file, probes under
  `tools/archive/`) is untracked by `.gitignore` — clones carry just the
  website and its verification pipeline.
