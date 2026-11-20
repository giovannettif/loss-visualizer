# You Can't See the Loss

An interactive 3D explorable teaching **adaptive gradient optimizers** (plain
gradient descent, momentum, Adam) for NJIT CS375. The through-line: an
optimizer is **blind** — it only ever measures the loss and its gradient at
the point where it stands. Every section, scene, and game in the page is
built to make that single idea tangible.

Plain TypeScript + Vite + three.js + d3-scale/d3-contour. No framework.

## Run it

```bash
npm install        # once
npm run dev        # development server → http://localhost:5173
npm run build      # typecheck + production build into dist/
npm run preview    # serve the production build
npm run test       # vitest unit suite (pure-math and scene-core tests)
```

Any recent Node works. (`tools/node/` holds a portable Node used by the QA
gates on this machine; a fresh clone can use its system Node — see
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).)

`debug.html` is a dev-only entry that mounts individual visualizer
components for manual inspection; it is built alongside `index.html` but is
not linked from the page.

## Verifying a clone

The QA pipeline that gates every change ships with the repo (small text
scripts under `tools/`):

```bash
bash tools/run-build.sh                          # typecheck + production build
bash tools/run-tests.sh                          # unit suite
bash tools/run-gate.sh tools/gate-tour.mjs       # browser gate: tours
bash tools/run-gate.sh tools/gate-tilt.mjs       # browser gate: tilt game
bash tools/run-gate.sh tools/gate-fog.mjs        # browser gate: fog game
bash tools/run-gate.sh tools/gate-hover.mjs      # browser gate: hover-to-look
bash tools/run-gate.sh tools/gate-labrule-epi.mjs# browser gate: workbench + epilogue
node tools/shots.mjs                             # canonical screenshots → shots/
```

Browser gates drive a real Chrome via Playwright against the production
build on `localhost:4173`.

## Repository layout

| Path | What it is |
|---|---|
| `index.html` | the page itself (all sections' markup + reader copy) |
| `debug.html` | dev-only component playground entry |
| `src/core/` | pure math: landscapes + optimizers (no DOM, no rendering) |
| `src/scenes/` | per-section scene logic: director + game cores |
| `src/view/` | rendering + reader interactions: LandscapeView, tour engine, minimap, … |
| `docs/ARCHITECTURE.md` | **how the code works** — start here to modify anything |
| `tools/` | build/test/gate pipeline scripts (see above) |
| `public/fonts/` | static assets |

Everything else that lives in a working copy of this repo — QA evidence
(`evidence/`, `shots/`), planning and status documents (`docs/PLAN.md`,
`docs/STATUS.md`, …), archived probes (`tools/archive/`, `archive/`) — is
**intentionally untracked** (see `.gitignore`): a clone needs only the
website and the pipeline that verifies it.
