# COPY-PLAN — the content pass (authoritative)

Scope: every reader step (`.rstep`), every HUD caption, every dynamic (generated) string, the
formula styling, the labeled axis lines, and the fog/hover decisions named in the ask.
Sources this plan was built from: the full reader copy (`index.html:408–1372` + HUD at
`index.html:79–399`), the style analysis and full-copy audit inputs (COPY-1…COPY-9, style
table #1–#8, rules R1–R8), the feasibility report (items 1–2 received in full; items 3+
truncated — see §4 for what was re-derived, and where), and the code cites given inline.
Every quoted "current" line below was verified against `index.html` / `src/` in this session.

Notation for final copy blocks:

- `«look:key»…«/»` = `<span class="look" tabindex="0" data-look="key">…</span>`
- `«gd-red»`, `«mom-blue»`, `«adam-y»` = the existing color spans (`<span class="gd-red">` etc.)
- `«math»…«/m»` = `<span class="math">…</span>`; `«mono»…«/m»` = `<span class="mono">…</span>`
- `«sub:i»`, `«sup:−1»` = `<sub>` / `<sup>`; `«frac:num|den»` and `«sum:n|Σ|i=1»` are defined in §3.
- Ellipses `…` mean "keep the surrounding current text unchanged."

---

## 0. Execution rules (binding for every writer)

**E1 — Self-containment.** No step may instruct the reader to use a control that is not on
the reader's current page. Where an action genuinely lives elsewhere, the step ships an
inline action control (a real `<button class="btn btn-inline">` in the step text) that
performs the jump — §2 specifies each one. This kills COPY-1's class of bug at the root:
`index.html:912–917` instructs dragging sliders that live inside the *previous* step's
full-panel page (`index.html:842–885`), so they are off-screen when the instruction shows.

**E2 — Look-key preservation.** Every rewrite keeps each `data-look` key on a phrase that
still names its target (the registry is `src/view/lookRegistry.ts`; a key whose target is
absent no-ops, never invents — lookRegistry.ts:27–30). Any *new* control that copy names
gets a `control`-kind row in `LOOK_TARGETS` (precedents: `eta-slider` at :103, `beta-slider`
at :128, `steep-slider` at :157, `lab-sliders` at :178). The look-map per rewrite is listed
with that rewrite.

**E3 — Tour re-sync is part of every rewrite.** Sentences are segmented at runtime
(`src/main.ts:1083`, `segmentReader`), and every TOURS step addresses a sentence by
`{page, para, sent}` with an `expect` substring (`src/view/tourEngine.ts:66–121`). Rewriting
a paragraph renumbers its sentences: **after each step rewrite, re-sync the matching TOURS
entries, then run `bash tools/run-gate.sh tools/gate-tour.mjs`** (its `tourCheck` resolves
all nine tours to visible sentences — tools/gate-tour.mjs:315–318). A sentence containing
inline elements stays one segmentation unit (src/view/sentences.ts:106–113), so adding
`«frac»`/`«sum»` spans never splits one.

**E4 — Mid-dot policy.** `&middot;` chains are banned in *prose captions* (they orphan
verbless fragments — R2). *Mono instrument readouts* keep their compact form by convention
(fog counters, swarm line, census headers, scorecard cells): those are gauges, not prose.

**E5 — Strings and tests.** None of the strings this plan changes is asserted verbatim by a
gate or a vitest file (checked this session: the only grep hits for the changed copy in
`tools/*.mjs` / `src/**/*.test.ts` are comments — tools/gate-tour.mjs:682,690;
src/scenes/tiltGame.test.ts:209). Gates that *observe* behavior (tour/tilt/fog/labrule) must
still pass after the re-sync; run them serially per the environment discipline.

**E6 — Captions become sentences.** Every caption this plan rewrites is written as
capitalized full sentences with terminal periods. Captions this plan does *not* touch are
left alone — no drive-by churn.

---

## 1. Style guide (8 rules, from our own text)

**R1 — Front-load nothing; introduce every control at the moment it first matters.**
The hero step currently inventories five controls in one breath (scroll/Space policy, thin
bar, ticks, footer transport, speed switch — `index.html:422–433`). The reference explorable
teaches controls at the playground, not in the foreword.
- Before: "The ticks on the right edge jump to any step, and the footer's *Play* control and
  speed switch replay the current scene's trajectory." (`index.html:431–433`)
- After: cut from the hero; the ticks are introduced at §6 fog-a where returning to a level
  first matters (§2.10), the transport at gd-c where *Play* is first captioned (`index.html:622`).

**R2 — Captions are sentences, not telegraph dispatches.** The page carries 59 `&middot;`s;
in captions they orphan verbless fragments, and when two facts are *in tension* only a
connective can show it.
- Before: "keys are screen-relative · the physics always runs in the parameter plane ·
  finishing a level posts the scorecard" (`index.html:1082–1085`)
- After: "The keys tilt the board relative to your screen, but the physics always runs in
  the parameter plane — with the camera swung around, a key that points 'down' can roll the
  ball to a higher loss. Finishing a level posts the scorecard."
  (The consequence clause is code-grounded: keys are mapped through the camera azimuth into
  parameter space — `tiltScreenToParam(…, attitude.azimuthDeg)`, src/scenes/director.ts:4051–4053 —
  while the physics integrates `−∇L·gravity + input·tiltAccel − c·v` in parameter space,
  src/scenes/tiltGame.ts:441–442.)

**R3 — Plain English first, symbol second; no verbless parentheticals.**
- Before: "past 1/λ_max, where λ_max is the largest curvature of the landscape, each step
  overshoots… past 2/λ_max it diverges (here λ_max = 2: η = 0.5 and η = 1)"
  (`index.html:590–597`) — the one plain-English definition is buried mid-condition; the
  parenthesis has no verb and never says 0.5/1 *are the thresholds* (COPY-5).
- After: "Past 1/λ_max — λ_max is the steepest curvature the landscape has — each step
  overshoots the walls and it oscillates; past 2/λ_max it diverges outright. On this
  landscape λ_max = 2, so the thresholds sit at η = 0.5 and η = 1: slide past them and watch."

**R4 — Retire the handoff formula.** "…is where the story goes next" appears three times
(`index.html:523–524, 920–921, 1174–1176`); a repeated signature is wallpaper. Vary the move
per boundary (task-c, lab-2, swarm — §2.4, §2.12, §2.16).

**R5 — State what is, never what was removed or absent.** Changelog-speak documents rules
the reader never tried.
- Before: "(or press Space — plain clicks never advance)" (`index.html:423–424`)
- After: "Space and the arrow keys work too."
- Keep the apparent counter-example: "The fog lifted after play. In practice it never does"
  (`index.html:1346`) survives because it is a claim about the world, not about the UI.

**R6 — Don't narrate the interface describing itself.**
- Before: "The title overlay states the premise." (`index.html:418–420`) — the reader is
  looking at the premise. Cut.
- Before: "the readout answers as soon as the parameters move" (`index.html:486–487`) —
  After: "the readout updates the instant the parameters move."
- Keepers (personification that names the mechanism): "the needle goes quiet"
  (`index.html:1054`), "the egg crate traps them" as *geometry* (`index.html:1119`).

**R7 — One sentence, one job.** Split any 50+-word list sentence.
- Before: the 70-word terrain-picker sentence (`index.html:1137–1146`)
- After (§2.16): "The pills on the dock (bottom-left) pick the terrain. *Multi-well*: six
  named basins of different depths. *Multi-well large*: nine, over a wider map — …"

**R8 — Second person, contractions, setup-then-payoff.** Peer voice, imperatives for
actions, passive only for what the system does automatically. Our concept sentences are
already reference-grade — "Height is loss." (`index.html:510`), "Selective forgetting."
(`index.html:740`), "Where you stop is your answer." (`index.html:968`) — do not sand them off.
What's broken is interface prose, not teaching prose.

---

## 2. Per-step rewrites (final copy)

Order = page order. Flags cite the audit (COPY-n), the style table (#n), and rules (Rn).
"Tour" lines name what must re-sync in `src/view/tourEngine.ts`.

### 2.1 Hero — "How this page works." (`index.html:408–452`)
Flags: #1–#4, #7 (COPY-7), R1, R5, R6.

**P1**
> Two panes. *Left:* a live 3D loss surface — the camera, the instruments and the game
> panels — and, for now, a looping race between the three optimizers this page contrasts:
> «gd-red»GD«/», «mom-blue»momentum«/», «adam-y»Adam«/». *Here:* this panel, one step of
> text at a time; the counter above it tracks your position.

(Cut "The title overlay states the premise." — R6.)

**P2**
> Scroll *here* to move on — Space and the arrow keys work too. Each step's animation plays
> on arrival; *Skip animation* ends it early, and *continue ↓* lights up when you're free to
> scroll on. Over the landscape: scroll to zoom, drag to pan, right-drag to orbit,
> double-click to reset; the *Isometric* / *Map view* buttons restore the standard poses.
> From the next step on, watch for dotted phrases — each names something on stage: rest on
> one (or «mono»Tab«/m» to it) and the scene shows you what it names. Scroll all the way
> back to the top and the reader slides away — the landscape takes the whole screen again.

Cuts: "(or press Space — plain clicks never advance)" (R5); the thin-bar sentence (#2, the
*Skip animation* mention already covers the behavior); "(Map view too)" (COPY-7, dangling);
the ticks + footer-transport sentence (#3 → deferred per §2.10 and §2.7).

**Tour caption**
> Every section carries a ▶ *Tour this section* chip: it walks you through the text one
> sentence at a time, spotlighting what each sentence names and pausing wherever there's
> something to try. *Esc* exits anytime.

(Cut "the controller follows you" state-machine narration and the Back·Next·Auto·Exit
inventory — #4.)
Tour: hero TOURS sentences renumber (P1 4→4, P2 7→5, caption 3→2).

### 2.2 task-a — "Fit a line by hand." (`index.html:454–476`)
No prose change. Formula box restyled per §3 (F1). Looks unchanged (`fit-inset`,
`loss-readout`).

### 2.3 task-b — "The loss is defined everywhere." (`index.html:478–505`)
Flags: #5, R7.
**P1**, final clause: "…and the «look:loss-readout»readout updates the instant the
parameters move«/»." (was "answers as soon as").
**P2**: sentences 1–3 unchanged (keep `compass` and `needle` looks verbatim — the tour's
`expect` "purple needle" targets sentence 3). Replace the last two sentences with one:
> The faint contour rings are a gift to you alone — the optimizer receives the needle,
> which says nothing about the rest of the surface.

Tour: P2 loses one sentence (5→4) — renumber.

### 2.4 task-c — "Height is loss." (`index.html:507–527`)
Flags: R4. Handoff caption only:
> §2 · next, the machine follows the needle for you: gradient descent.

### 2.5 gd-a — "One arrow, re-measured at every point." (`index.html:529–558`)
Flags: R2, E6. Caption only:
> From here on, the surfaces are test landscapes: their two coordinates are
> «math»x«/m» and «math»y«/m» — still «math»θ = (x, y)«/m» — and the loss is still
> «math»L«/m». The camera rides low over the bowl floor; the compass shows the whole
> parameter plane, faint contours and all, and the needle — everything GD gets to know —
> marks exactly one direction on it.

### 2.6 gd-b — "Draw your arrow." (`index.html:560–579`)
No change. Looks `compass`, `gd-step` stay.

### 2.7 gd-c — "One setting: the learning rate." (`index.html:581–626`)
Flags: COPY-5, #6, R3, plus the deferred transport intro (#3). Look `trail-gd` stays on the
regime run; `eta-slider` look (registry :103) must move onto the slider sentence below if a
tour demands it — keep the existing tour wiring by pointing the gate sentence at the same
control.

**P1 (final)**
> The step is «math»η«/m» × the arrow: «math»η«/m» is the learning rate — the step size.
> Slide «math»η«/m» across three orders of magnitude; «look:ball»GD restarts from the same
> white point each time«/». «look:trail-gd»Too small and it crawls. Moderate and it
> descends. Past «frac:1|λ«sub:max»», where λ«sub:max» is the steepest curvature the
> landscape has, each step overshoots the walls and it oscillates; past
> «frac:2|λ«sub:max»» it diverges outright«/». On this landscape λ«sub:max» = 2, so the
> thresholds sit at η = 0.5 and η = 1: slide past them and watch.

**Caption (final)** — now introduces the transport, per #3:
> Same landscape, same start, same rule — only «math»η«/m» changes. The *regime* readout
> names the current behavior. *Play* (footer) rolls the ball along the current trail, at
> the speed you pick beside it.

### 2.8 mom-a — "GD zigzags. Momentum glides." (`index.html:650–693`)
Flags: COPY-6. First sentence only (the valley/start differ from §2's — MOM_BOWL is a
fresh rotated bowl, director.ts:243–253):
> One steep valley, one shared start, one «math»η«/m» for both.

Everything else unchanged (`trail-gd`, `trail-mom` looks stay).

### 2.9 mom-b — "Too much memory overshoots." (`index.html:695–735`)
Flags: R6-adjacent nit ("This beat" is production-speak). Caption, first clause:
> The slider arrives at «math»β«/m» = 0.97, where the across-valley oscillation survives
> dozens of steps before damping out. Drag …

(rest of the caption unchanged.)

### 2.10 STRUCTURAL — §5 lab: promote sliders + checklist to a scene dock (COPY-1)
Move `#lab-sliders` (`index.html:842–871`) and `#lab-checklist` (`index.html:872–885`) out
of lab step 1's `.rstep` into a new `#lab-dock` mounted like `#swarm-dock` (visualizer
bottom-left dock; `.hud.panel`; excluded from pan-clamp insets alongside `#minimap-panel`
— the pattern is documented at `index.html:267–276`). Visible on `lab` scenes only. **Keep
both ids** — the registry rows `lab-sliders` / `lab-checklist` (lookRegistry.ts:178–189)
and the tour's labMoved gate drive them by id, so the move is invisible to them; update
the two registry comments ("reader-side" → dock-side).

### 2.11 lab-1 — "Reshape the landscape." (`index.html:827–893`)
Flags: COPY-1 (structural, §2.10), R7.
**P1 (final)**
> Two sliders in the dock (bottom-left) rebuild the valley while the race re-runs:
> «math»λ₁/λ₂«/m» sets the curvature ratio; *rotation* reorients the bowl relative to the
> start point. «look:trails-all»All three optimizers race from the same white point«/»,
> each with its own fixed «math»η«/m» — where the landscape suits them they agree; where
> it does not, they split.

**Caption (final)**
> The «look:curves-panel»loss curves (top left) record every run«/»; toggle log
> «math»L«/m» there. Each claim in the checklist lights up when the race confirms it.
> *Play* (footer) replays the whole race, ball by ball.

(was "The checklist lights each claim as the race confirms it." — R7.)

### 2.12 lab-2 — "When do they disagree?" (`index.html:895–924`)
Flags: COPY-1 (now self-contained — the dock is on stage for every lab page), R4.
**P1** unchanged (looks `trail-gd`, `trail-mom`, `trail-adam` stay).
**P2 (final)**
> That invariance makes Adam steady, not fast: it never zigzags or overshoots, yet at this
> setting it reaches the floor last. The general lesson of this lab: whether an optimizer's
> advantages apply is a property of the *landscape*, not of the optimizer alone.
> «look:trails-all»Drag «math»λ₁/λ₂«/m» down to ×1 — a round bowl«/» — and GD and momentum
> fall onto one straight line while the checklist's first two lights go dark; Adam's trail
> still bends off it, because per-coordinate steps don't follow the bowl's shape in either
> direction.

**Handoff caption**
> §6 · now try it with the surface hidden — navigation with nothing but the needle.

### 2.13 fog-a — "The landscape is hidden." (`index.html:926–952`)
Flags: #7, R2, plus the deferred rail-ticks intro (#1/#3).
**P1 (final)** — last clause:
> …That is the optimizer's entire information state — and for the next two levels, it's
> yours too.

**Caption (final)** — also introduces the ticks, the last deferred hero control:
> The dashed ring on the compass is the maximum stride per step. The needle is still
> «math»−∇L«/m»: local, and the only guidance available. The ticks on the right edge of the
> screen jump between steps — handy when a level deserves a second attempt.

Looks `needle`, `compass`, `ball` stay.

### 2.14 fog-b — "Level 2: a new landscape." (`index.html:954–975`)
No change (the `fog-panel` look and the "Where you stop is your answer." keeper stay).

### 2.15 fog-c — "You against the optimizers." (`index.html:977–1023`)
Flags: COPY-3, E1 (cross-page instruction in `#fog-empty-lead`), R2.
**`#fog-run-lead`**: unchanged (keeper cadence; `fog-you`/color spans stay).
**`#fog-empty-lead` (final)** — plus one new inline control:
> With no measurements spent on this level there is no run of yours to replay — the stage
> runs the three optimizers alone, blind from the shared start. Spend at least one
> measurement there and this reveal will grade your run against theirs.

preceded by: `<button id="fog-goto-l2" type="button" class="btn btn-inline">Take the Level 2 run →</button>`
Behavior: perform the same jump the fog-b rail tick performs (reuse the rail's navigation
entry point in `src/main.ts`). New style `.btn-inline` in `page.css` (small, inline, link-like).
**Scorecard + `#fog-verdict`**: dynamic — see 2.18.
**`#fog-trap-note` (final, COPY-3 — one claim, once):**
> «look:gold-marker»The gold marker is the true global minimum«/». If you stopped on
> Rosenbrock's curved valley floor, you stopped somewhere that felt final — flat
> underfoot, progress crawl-slow — while the global minimum sat a short distance away,
> across an unvisited ridge. A point can read as done and still not be a minimum at all:
> slow progress is not arrival.

**`#fog-empty-verdict-note`**: unchanged. **`#fog-replay-note` (final, R2):**
> *Replay* (footer) «look:ball»re-runs all four ghosts«/». No run ever sees the whole
> surface — not even after the reveal.

### 2.16 swarm — "Basins of attraction — and unequal outcomes." (`index.html:1132–1179`)
Flags: #8/R7, COPY-4, R4, plus two coverage additions (stalled; cluster expander).
**P1 (final)**
> The pills on the dock (bottom-left) pick the terrain. *Multi-well*: six named basins of
> different depths. *Multi-well large*: nine, over a wider map — from a deep rift to a
> barely-there scratch. *Himmelblau*: the classic polynomial whose *four* pits are all
> global minima. One hundred balls are scattered across whichever terrain you picked and
> released; each runs the same physics you just played — no tilt, mid-range damping — and
> settles into the first basin its trajectory enters. A ball that ends on open ground is
> counted as *stalled*, never as settled — the swarm line in the panel reports both.

(Names the swarm line's "stalled" state — director.ts:4915–4920 — which no copy explained.)

**P2 (final)**
> They do not always agree — and they rarely end equal. On the multi-well terrains the
> white streams split into clusters whose final losses differ by whole units — the deep
> basin's crowd bottoms out far below the broad shallow one's — while Himmelblau's four
> clusters all reach the same floor. The panel's scorecard keeps each cluster's count and
> mean final loss; on a tall panel it collapses to the gold global row behind a
> "+N more" expander. The dock under the map carries the finale's controls: the terrain
> pills, the **run blind / show map** toggle — the swarm enters fogged, and until you
> untick it the ensemble paints every cell it crosses, building the map blind — and the
> replay + scrub transport for re-running the flight.

**Caption 1 (final)** — R2 sentences + COPY-4 fix:
> Ensembles cover ground faster: together the hundred balls paint roughly
> «mono»20×«/m» the ground any one of them crosses alone. But no ball ever sees the whole
> map — the ensemble's information exceeds any member's. And where a ball lands is decided
> by the basin it enters, not by anything it did along the way.

**Handoff caption (final, R4)**
> §8 · your turn to build one: assemble an optimizer from these four parts.

Tour: the §7 swarm sentence points at the live `swarm-ensemble` look (STATUS QA record);
whichever sentence the TOURS table addresses must still name the ensemble after the split —
re-sync + re-run gate-tour.

### 2.17 tilt-a-1 — "The update rule, as physics." (`index.html:1025–1058`)
Flags: COPY-2, R2.
**P1 (final)** — every symbol defined in the same breath (physics per tiltGame.ts:441–442):
> The board is the parameter plane and *you* tilt it: «mono»W A S D«/m» (or
> «mono»← →«/m») pitch and roll the valley under the white ball. The physics is the
> optimizer's own update in disguise — gravity pulls the ball down-slope, your keys tilt
> the board, damping bleeds velocity:
> «math»v += (−g·∇L + a·tilt − c·v)·dt«/m» — «math»g«/m» is the board's gravity, «math»a«/m»
> how hard your keys tilt it, «math»c«/m» the damping you dial below. So the ball carries
> *real* momentum: release the keys and it coasts on.

**P2**: unchanged (damping regimes match tiltGame.ts:1026–1032).
**Caption (final, R2):**
> Level 1 is the elongated valley. Tilt *across* it and the ball swings wall to wall —
> momentum's overshoot from §3, not GD's zigzag — and «math»c«/m» sets how fast the swing
> dies. Let the ball come to rest (the needle goes quiet) or press *Finish run* to
> complete the level.

("the needle goes quiet" is a keeper — quiet = flat gradient, the mechanism itself.)

### 2.18 tilt-a-2 — "Two harder valleys." (`index.html:1060–1087`)
Flags: R2, coverage (↻ Restart never explained).
P1–P2 unchanged (the steps/cells unit story is correct and necessary).
**Caption (final):**
> The keys tilt the board relative to your screen, but the physics always runs in the
> parameter plane — with the camera swung around, a key that points "down" can roll the
> ball to a higher loss. Finishing a level posts the scorecard; *↻ Restart run* rewinds
> the current one.

### 2.19 tilt-b — "Replay your run; then the machines run theirs." (`index.html:1089–1130`)
Flags: COPY-4, E1 (both hidden leads instruct scrolling back).
**`#tilt-run-lead`**: unchanged.
**`#tilt-demo-lead` (final):** "You reached the scorecard without playing, so the white
ghost is a *guided demo* ride — a hand-steered route through Rosenbrock's valley, not
yours. Drag the *scrubber* or press *ghost* to watch it." — then the new control:
`<button id="tilt-goto-drive" type="button" class="btn btn-inline">Take the drive →</button>`
(same rail-jump mechanism, targeting the first tilt-a page), followed by: "…and this
scorecard grades your own run."
**`#tilt-empty-lead` (final):** "You haven't taken a drive yet, so there is no run of yours
on the scrubber — nothing there to replay." + the same `#tilt-goto-drive` control +
"…and this scorecard will grade your own run."
**P2 (final, COPY-4):** last clause:
> …on Rastrigin, the blind steppers never leave the pit you all start in. Climb out of it,
> and your score beats theirs.

("the egg-crate pits hold them" survives as geometry; the *unconditional* "you'll beat
them" becomes the honest conditional.)
**Caption**: unchanged except E6 capitalization; the "the ball's inertia *is* momentum"
keeper stays.

### 2.20 labrule-1 — "Assemble an update rule." (`index.html:1181–1231`)
Flags: COPY-4. Last caption, opening clause only:
> To check that, dial «math»η«/m» to a machine's tuned value. On least squares, …

(rest unchanged — the 11-steps / 0.001 facts are audit-verified correct.)

### 2.21 labrule-2 — "Change the landscape; the ranking flips." (`index.html:1233–1265`)
No change (benchmark facts audit-verified; the §9 handoff is fresh).

### 2.22 epi-a — "The exact landscape." (`index.html:1267–1295`)
Flags: formula plan F4 (show the "one line of linear algebra" it keeps mentioning).
**P3 (final):**
> «look:epi-marker»The gold point on the surface is the normal equations' exact answer«/»,
> «mono»w* = 0.9094, b* = 1.3064«/m» — the minimum you were approaching by hand when you
> dragged the line, computed in one line of linear algebra: «formula-wstar» (see §3).
> The overlay reports it, with the loss at that minimum, «mono»L* = 1.4246«/m». For two
> parameters, the map was *literal truth*: height really was loss, and the whole surface
> really was there.

### 2.23 epi-b / epi-c
No change. epi-c's "The fog lifted after play. In practice it never does" is a world-claim
keeper (R5 contrast). Lattice note (epi-b caption) stays.

### 2.24 Dynamic strings (generated copy)

| # | Where | Current | Final |
|---|-------|---------|-------|
| D1 | fog lose-verdict, `src/scenes/director.ts:3585` | "The best optimizer stopped lower (L x) — at the cost of 60 measurements to your 10." (COPY-8) | `The best optimizer stopped lower (L ${loss}) — but it spent ${best.steps} measurements to your ${you.meas}.` |
| D2 | fog win-verdict, director.ts:3584 | "You stopped lower than every optimizer — on 10 measurements, not 60." | unchanged |
| D3 | fog panel caption, director.ts:3632–3636 | "drag on the compass to step — …" / "reveal · scrub the replays with ▶" / "run finished · compass is read-only" | `Drag on the compass to step — each landing measures the loss and the gradient there.` / `Reveal — the footer's Replay and scrubber re-run all four ghosts.` / `Run finished — the compass is read-only.` |
| D4 | fog reveal note, director.ts:3373–3375 | "the true global minimum" / "the global minimum lay across this unvisited ridge" | unchanged (both honest + mechanism-naming) |
| D5 | tilt demo verdict, director.ts:4619–4622 | "…scroll back to the game and take a drive to be graded." | `…not your run. The optimizers raced the same start; take the drive to be graded.` (the jump button now sits directly above) |
| D6 | tilt no-run verdict, director.ts:4626–4627 | "…scroll back and take a drive." | `You never tilted the board — nothing on stage is your run. The optimizers ran the same start blind.` (wayfinding now lives in the button) |
| D7 | tilt Rastrigin slope case, director.ts:4672–4675 | "— GD in a local minimum near (1, 0) (L 0.49), momentum in the global minimum (0, 0) (L 0.00) settled." (COPY-9: verb attaches only to the last item) | pitList verb → `rests in`: `${label} rests in ${pit} (L ${loss})`, joined by ", "; template: `You stopped on a pit wall near ${basin} after ${steps} steps and ${meas} — ${restList}.` |
| D8 | tilt scorecard min-footer, director.ts:4595–4602 | "GD · momentum: the global minimum (0, 0) global" (doubled global/local) | `${labels.join(" · ")}: ${pit}` — drop the trailing word when the pit label already says "global/local minimum"; append ` — global` / ` — local` only when the label is the bare "the minimum" (single-minimum levels). Slope line: `${labels}: no rest — still on a slope` |
| D9 | tilt keys caption, director.ts:4885–4887 | live: "W A S D (or ← →) tilt the board — screen-relative; the physics runs in the parameter plane" / done: "run finished — the tilt keys are off; pick another level to tilt again" | live: `W A S D (or ← →) tilt the board relative to your screen — the physics runs in the parameter plane, so with the camera swung around a "down" key can raise the loss.` done: `Run finished — the tilt keys are off. Pick another level to tilt again.` |
| D10 | swarm line, director.ts:4915–4920; census, tiltGame.ts:251–263 | mono telemetry ("N balls blind · X cells painted · Y minima found", "6 wells · one deep global canyon") | unchanged (E4: instrument readouts stay compact; "stalled" is now defined by §2.16 P1) |
| D11 | tilt damping regimes, tiltGame.ts:1026–1032; pit labels :1058–1063; fog budgets, fogGame.ts:64–86; adam readouts, director.ts:7283–7306; fit caption, director.ts:7677; rule verdicts, ruleLab.ts:371–401 | — | unchanged (audit-verified honest and guarded) |

---

## 3. Formula plan — styled HTML (Option B), no KaTeX

**Decision: hand-styled spans; KaTeX is not adopted.** Grounds: `katex` is absent from
`node_modules` (checked this session: `ls node_modules | grep -i katex` → no matches),
the page has exactly three display formulas plus two inline fragment families, the bundle
and software-GL discipline is strict (STATUS.md), the `.hat`/`.hat-mark` detached-caret
system is the judge-verified precedent (PLAN.md:33), and KaTeX's Computer Modern would
fight the page's serif ramp. Revisit only if formulas ever multiply (matrices/cases).

**New CSS primitives (`src/view/page.css`, ~60–90 lines total):**

```css
.frac { display: inline-flex; flex-direction: column; align-items: center;
        vertical-align: -0.55em; line-height: 1.15; margin: 0 0.18em; }
.frac > .num { font-size: 0.8em; }
.frac > .den { font-size: 0.8em; border-top: 1px solid currentColor; padding: 0 0.25em; }
.sum  { display: inline-flex; flex-direction: column; align-items: center;
        vertical-align: -0.5em; line-height: 1; margin: 0 0.25em; font-style: normal; }
.sum > .sum-n   { font-size: 0.62em; }      /* upper limit */
.sum > .sum-sym { font-size: 1.4em; }       /* ∑ */
.sum > .sum-sub { font-size: 0.62em; }      /* i = 1 */
```

**F1 — §1 loss box** (`index.html:467`) and **F2 — §9 gold reveal** (`index.html:1276–1278`),
same source string (`.formula` box kept):
`L(w, b) = «sum:12|∑|i=1» (w·x«sub:i» + b − y«sub:i»)²` — i.e.
`<span class="sum"><span class="sum-n">12</span><span class="sum-sym">∑</span><span class="sum-sub">i=1</span></span> (w·x<sub>i</sub> + b − y<sub>i</sub>)²`.
(The 12 is real: twelve measurements, `index.html:459`.)

**F3 — gd-c inline thresholds** (`index.html:592–596`, inside §2.7's rewrite):
`1/λ_max` → `<span class="frac"><span class="num">1</span><span class="den">λ<sub>max</sub></span></span>`; likewise `2/λ_max`. Only these two fragments; do **not** convert `m̂/√v̂` (the hat system is the carried-in judge-verified fix — PLAN.md:33 — and reads perfectly).

**F4 — §9 closed form (new, in §2.22):** `<span class="math formula-wstar"><span class="frac"><span class="num">X<sup>T</sup>y</span><span class="den">(X<sup>T</sup>X)<sup>−1</sup></span></span>`… rendered inline as `w* = (XᵀX)⁻¹Xᵀy` with the `.frac` carrying the division: numerator `X<sup>T</sup>y`, denominator `X<sup>T</sup>X`, the `−1` as a `«sup:−1»` on the parenthesized group. Verify against the shipped constants: the normal equations reproduce w* = 0.9094 / b* = 1.3064 / L* = 1.4246 (audit check 2, re-derivable from `leastSquares`, src/core/functions.ts:374–404).

**F5 — #epi-formula HUD** (`index.html:371–378`): keep unicode `Σᵢ` as-is — it is a pinned overlay with a tight height budget, and it is an instrument, not a display box (E4 spirit).

**F6 — tilt equation** (§2.17): prose-embedded, plain `.math` serif, symbols defined in the same sentence; no new classes needed.

Segmentation/layout: `.formula` boxes are block-level paragraphs — runtime segmentation moves them whole (sentences.ts:106–113), and TOURS para indices that count them must be re-synced (E3). `.formula` box heights change → `tools/verify-copy-layout.mjs` and the 37-shot suite will diff; refresh canonical shots after.

---

## 4. Axes + tilt fog + hover precision

**Honesty note:** the feasibility input arrived truncated mid-item-2. Item 1 (axes) and
item 2 (equations) were received in full and are adopted below; the "tilt fog" and "hover
precision" approaches were **re-derived from the code this session** and are labeled as
such — they are consistent with the received items' precedents but were not part of the
received text.

### 4.1 Thin labeled axis lines (adopted: feasibility item 1)
- Build a `buildAxisFrame()` in `terrainGroup`, slotted right after `buildContourLines(heights)`
  in `setLandscape` (`src/view/LandscapeView.ts:635–636`). Geometry: an "L" along the two
  bottom domain edges (`py = yMin` and `px = xMin`), sampled through `surfacePoint` so the
  line follows the edge height profile (Rosenbrock's edge is not flat), plus small
  perpendicular tick notches at ~4 integer values per axis. One `LineSegments`, contour-style
  lift `diag · 0.004` (the contour precedent, LandscapeView.ts:1770, applied at :1802–1817),
  `depthWrite: false`, `polygonOffset` fallback like the tilt stamps (director.ts:4306–4308).
- Labels: canvas-textured `THREE.Sprite`s, one per tick (e.g. `w = −1`), positioned via the
  public `parameterToWorld(p, lift, out)` (LandscapeView.ts:1409–1416), world-sized at
  ~0.03–0.04 · `diag`, **text read from `Landscape.axes`** (`"w"/"b"` on least squares,
  `"x"/"y"` default — src/core/functions.ts:26–29, :396) so the 3D labels can never drift
  from the compass's (`CompassMinimap.ts:192–198`). Cache textures in a `Map<string, CanvasTexture>`
  keyed by label text — §4/§5 slider rebuilds re-enter `setLandscape` many times a second.
- Opacity rides the contour path: recompute multiplicatively in `applyContourOpacity()`
  (LandscapeView.ts:687–692) from `terrainOpacity × contourRevealK × focusContourDim`, so
  hover-dim, the §1 crossfade, and §6 keep working; `applyFocus` only walks
  overlay/shadow groups (:781–782), so terrainGroup children need this uniform update.
- **Fog-leak guard (the decisive one):** gate the whole frame by `contourRevealK` — §6 drives
  it 0→1 at the reveal (director.ts:6878–6887, 3156–3171), so the edge polyline can never
  leak the height profile of a hidden landscape; the swarm's blind mode already sets
  `setContourReveal(0)` (director.ts:5311) and inherits for free.
- Map-view crispness is free: orthographic + exact top-down preset (LandscapeView.ts:86–88).

### 4.2 Tilt fog (re-derived this session — see the note above)
**Decision: §7 tilt boards stay fully visible; the fog machinery is never enabled there.**
Grounds: `setFogEnabled(true)` is called only on fog-scene entry (director.ts:3157) and for
the swarm finale's blind mode (director.ts:5309); the tilt path (`refreshTiltVisuals`,
director.ts:4232) touches no fog state, and scene teardown restores contours
(director.ts:7380). This is also the teaching design: blindness is §6's lesson, and §7's
fog presence is exactly the swarm finale's blind-by-default map-building
(`applySwarmFogMode`, director.ts:5303–5325). Consequence for §4.1: tilt renders with
`contourRevealK = 1`, so the axis frame is simply visible there — no extra gating.
The tilt panel's "measurements · unique cells" readout stays a *score metric* (counted on
the same grid as the machines' paths, `index.html:1073–1077`), not a fog mechanic — no copy
change beyond §2.18's caption.

### 4.3 Hover precision (re-derived this session — see the note above)
**Decision: keep the two-tier system; spend precision work only where the tour already
demands it.**
- Tier 1, free play: per-span `.look[data-look]` — registry-driven, no-ops when the target
  is absent (lookRegistry.ts:27–30), guarded to the parked step and to document-rest +
  real pointer motion (main.ts:958–989). Keep untouched.
- Tier 2, graduation: TOURS-registered sentences (`data-slook`) respond as a whole and
  take precedence over spans; unregistered sentences fall through to tier 1
  (main.ts:1000–1037). Keep the granularity split — making every sentence hoverable would
  coarsen span-level precision for zero tour benefit.
- Precision refinements already exist as registry row *kinds*, and this is the accepted
  pattern for any future mis-aim: `panel`+`sub`, `panelChild`, `panelPart`, and `control`
  (lookRegistry.ts:44–67 and the TOUR-POINT comments at :100–106, :124–131, :152–160 — each
  one fixed a leader anchor landing hundreds of px from the demanded control). New controls
  from this plan (§2.15/§2.19 jump buttons) get `control` rows **only if** a tour sentence
  must point at them; otherwise none.
- What the rewrite owes the system: E2 (keys preserved on naming phrases) and E3 (sentence
  renumbering), both specified per rewrite above. The anchor-precision bug class cannot be
  reintroduced by copy as long as both hold.

---

## 5. Element coverage — every element, its explanation, its action

| Element (`index.html` unless noted) | Explained at (current → after this plan) | Action |
|---|---|---|
| `#boot` overlay (:69–74) | loading state only | none |
| `#hero-overlay` (:79–87) | title + premise on screen | none (R6 cut removes the narration *about* it) |
| `#fit-panel` + caption + w/b readouts (:90–99) | task-a; read-only fog mode via director.ts:7677 ("tracks your current point") | keep both strings |
| `#loss-panel` (:100–105) | task-a caption | keep |
| `#adam-panel`: bars, angle, lengths (:110–130) | adam-a; log-scale caption | caption rewritten: "On the surface the arrows are log-scaled to stay visible; the readouts report the true step lengths." |
| `#curves-panel` + log toggle (:133–142) | lab-1 caption | keep (§2.11 wording) |
| `#minimap-panel` caption (:144–150) | task-b (compass), gd-a (needle) | keep |
| `#fog-panel`: measurements/loss/budget/Finish (:154–171) | fog-a | keep; caption states → D3 |
| `#fog-reveal-note` (:174) | director.ts:3373–3375 | keep (D4) |
| `#tilt-panel` readouts (:182–199) | tilt-a-1 P2 | keep |
| damping slider + regime (:200–219) | tilt-a-1 P2 (matches tiltGame.ts:1026–1032) | keep |
| level pills (:220–224) | tilt-a-2 P1 | keep |
| Finish / ↻ Restart (:225–226) | Finish: tilt-a-1 caption; **Restart: unexplained** | §2.18 caption now covers Restart |
| scorecard + verdict (:227–236) | tilt-a-2 P2 (columns/units), tilt-b (verdict) | verdicts → D5–D8 |
| ghost transport + speed (:237–255) | tilt-b lead (scrubber/ghost); **speed buttons unexplained** | §2.19 lead gains "at the speed you pick beside it" — mirror of gd-c's transport line |
| swarm line + clusters (:256–257) | **stalled state unexplained**; "+N more" expander unexplained | §2.16 P1 (stalled) + P2 (expander) |
| keys caption (:258–264) | tilt-a-2 / D9 | D9 rewrite |
| `#swarm-dock` (:277–301) | swarm P1/P2 | keep |
| `#rule-panel`: knobs, normalize, pills, benchmark caption (:306–367) | labrule-1 (all four parts + pills), panel caption (:362–366) | keep |
| `#epi-formula` (:371–378) | epi-a | keep HUD (F5); copy gains F4 |
| `#epi-lattice-note` (:381–391) | epi-b caption | keep |
| `#rail` ticks (:400) | hero (inventory) → **fog-a caption** | moved per R1/#3 (§2.13) |
| `#reader-chip` counter (:401–404) | hero P1 | keep |
| `#edge-progress` bar (:406) | hero thin-bar sentence | explanation **cut** (#2) — self-evident |
| footer transport: Play/speed (:1377–1395) | gd-c caption | §2.7 (adds speed) |
| footer Replay + scrub | fog-c replay note + D3 reveal string | §2.15 + D3 |
| Skip / continue (:1397–1398) | hero P2 | keep (§2.1 wording) |
| tour chip + controller (main.ts:1241) | hero tour caption | §2.1 rewrite |
| NEW `#fog-goto-l2`, `#tilt-goto-drive` | §2.15 / §2.19 define them at point of use | new `.btn-inline` style in page.css |

---

## 6. Rollout & verification (ordered; gates serial)

1. **Copy pass** — apply §2 to `index.html` (steps, captions, leads) and the dynamic
   strings §2.24 to `director.ts`; add `.btn-inline` + the two jump buttons; restyle
   formulas per §3 (`page.css` primitives + F1–F4 spans).
2. **§5 dock move** — §2.10 (`index.html` + scene spec/`applyHud*` + `page.css`; keep ids).
3. **Axes** — §4.1 in `LandscapeView.ts` (+ a snapshot check that fog-b mid-game shows no
   axis lines: `?shot=fog-b`).
4. **TOURS re-sync** — every rewritten step; then `bash tools/run-gate.sh tools/gate-tour.mjs`.
5. **Build + tests** — `bash tools/run-build.sh`, `bash tools/run-tests.sh` (no vitest file
   asserts the changed strings verbatim — E5 check ran this session).
6. **Browser gates, serial** — `gate-tilt.mjs` (D5–D9 paths), `gate-fog.mjs` (D1/D3,
   empty-run lead + button), `gate-labrule-epi.mjs` (F4/§2.22), `tools/verify-copy-layout.mjs`
   (formula box heights), then refresh the canonical set: `bash tools/run-gate.sh tools/shots.mjs`
   (all 37 shots will diff — copy + axes + formulas are visible changes).
7. Update `STATUS.md`'s "Still open" list: the §8 "momentum slowest" item is already gone
   from the copy (verified again this session: `grep -rn "slowest" src/ index.html` → no
   matches) — mark it resolved when this pass lands.
