/**
 * gate-tilt.mjs — WP-C (§7 tilt game + swarm) live gate over Playwright.
 *
 *   1. ?shot=tilt-a renders the frozen mid-run valley pose (curated ride cut
 *      at 45%: trail, measurement stamps, minimap path, live panel).
 *   2. ?shot=tilt-b renders the scorecard + replay UI (4 rows, ghost trail,
 *      three machine trails, scrubber parked at 35%).
 *   3. ?shot=swarm renders the swarm mid-flight BLIND BY DEFAULT (user
 *      feedback 2026-11-13) with the visualizer dock visible: picker pills,
 *      "run blind / show map" toggle (checked), replay + scrub transport.
 *   4. Live play (?step=18): holding D moves the ball; releasing lets it
 *      coast (inertia); the damping slider is live; level buttons swap the
 *      terrain; Finish ends the run and lights the scorecard; the scrubber
 *      moves the ghost on tilt-b.
 *   4b. Live swarm replay + time scrub (park / resume / restart / backward
 *       re-paint of the blind map).
 *   4c. Live swarm landscape picker (multi-well / multi-well large /
 *       himmelblau): full rebuild + flight restart, per-country cluster
 *       stories at the end of each flight.
 *   5. Live blind round-trip on the dock: untick → visible re-run; tick →
 *      rewind dark, then the ensemble paints while flying blind.
 *   6. §7 fog of war (run-scoped): the board arms dark per fresh run
 *      (shot + live), paints in along the ball's path, Restart/level swap
 *      re-arms from scratch, Finish lifts the map, tilt-b tears it down,
 *      the blind swarm keeps owning the fog, and nothing leaks into §8.
 *
 * Usage: node tools/gate-tilt.mjs [baseUrl]
 */

import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const base = process.argv[2] ?? "http://localhost:4173";
const outDir = resolve("shots");
mkdirSync(outDir, { recursive: true });

const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(file) {
  const path = resolve(outDir, file);
  await page.screenshot({ path });
  const kb = statSync(path).size / 1024;
  return kb;
}

/* ---------------- 1–3: the three deterministic shots ---------------- */

for (const [scene, file, fn] of [
  ["tilt-a", "19-tilt-a.png", async () => window.__wp1.tilt()],
  ["tilt-b", "20-tilt-b.png", async () => window.__wp1.tilt()],
  ["swarm", "21-swarm.png", async () => window.__wp1.swarm()],
]) {
  await page.goto(`${base}/?shot=${scene}`, { waitUntil: "load" });
  await page.waitForTimeout(1500);
  const state = await page.evaluate(fn);
  if (scene === "tilt-a") {
    check("tilt-a: scene booted", (await page.evaluate(() => window.__wp1.scene())) === "tilt-a");
    check("tilt-a: mid-run (not done)", state && state.hasRun && !state.done, JSON.stringify(state?.pos));
    check("tilt-a: on the valley level", state?.level === "valley");
    check("tilt-a: measurements stamped", state?.cells > 3 && state?.stamps > 3, `cells=${state?.cells} stamps=${state?.stamps}`);
    check("tilt-a: recorded ghost exists", state?.steps > 0 && state?.scrub >= 0, `steps=${state?.steps}`);
    // Fog of war (run-scoped): the frozen poster is a MID-RUN pose, so its
    // board arms dark (fog on, reveal 0) with the curated ride's visited
    // cells already painted in.
    check("tilt-a: fog of war arms on the mid-run board", state?.fogOn === true && state?.fogLift === 0, `fogOn=${state?.fogOn} fogLift=${state?.fogLift}`);
    check("tilt-a: fog painted the curated ride's cells", state?.fogStamps > 1, `fogStamps=${state?.fogStamps}`);
    const kb = await shot(file);
    check("tilt-a: screenshot captured", kb > 30, `${kb.toFixed(1)} KB`);
  }
  if (scene === "tilt-b") {
    check("tilt-b: on the Rosenbrock level", state?.level === "rosen");
    check("tilt-b: run finished", state?.done === true, `settled=${state?.settled}`);
    check("tilt-b: ghost on stage", state?.ghost === true);
    // The reveal page is §7's post-reveal state: the run-scoped fog is torn
    // down and the machine race reads against the whole terrain.
    check("tilt-b: fog torn down (reveal reads whole)", state?.fogOn === false, `fogOn=${state?.fogOn}`);
    check("tilt-b: scorecard has 3 machine runs (+ you = 4 DOM rows)", state?.machines?.length === 3, JSON.stringify(state?.machines?.map((m) => m.label)));
    // FIX (user bug — the reveal raced LINES only): the player ghost AND
    // the three machines roll BALLS along their replayed paths (§6's
    // ghost-ball approach — identity colors + contact shadows).
    check(
      "tilt-b: the reveal races BALLS (player + 3 machines on stage)",
      state?.revealBalls === 4 && (state?.revealBallPos?.length ?? 0) === 4,
      `balls=${state?.revealBalls} pos=${JSON.stringify(state?.revealBallPos)}`,
    );
    check("tilt-b: scrubber parked at 35%", Math.abs(state?.scrub - 0.35) < 0.02, `scrub=${state?.scrub}`);
    const rows = await page.locator("#tilt-scorecard-body tr").count();
    check("tilt-b: scorecard DOM rows = 4", rows === 4, `rows=${rows}`);
    const kb = await shot(file);
    check("tilt-b: screenshot captured", kb > 30, `${kb.toFixed(1)} KB`);
  }
  if (scene === "swarm") {
    check("swarm: 100 balls simulated", state?.balls === 100, `balls=${state?.balls}`);
    check("swarm: settled most balls", state?.settled >= 90, `settled=${state?.settled}`);
    check("swarm: ≥5 distinct basins occupied", state?.clusters?.length >= 5, JSON.stringify(state?.clusters?.map((c) => c.name)));
    const cs = state?.clusters ?? [];
    const g = cs.find((c) => c.global);
    const spread = cs.length ? Math.max(...cs.map((c) => c.meanLoss)) - Math.min(...cs.map((c) => c.meanLoss)) : 0;
    check("swarm: the global canyon cluster ends lowest", g !== undefined && g.meanLoss < -4, `globalMean=${g?.meanLoss?.toFixed(2)}`);
    check("swarm: cluster outcomes UNEQUAL (loss spread > 2.5)", spread > 2.5, `spread=${spread.toFixed(2)}`);
    // User feedback 2026-11-13: the swarm now enters FOGGED — blind is the
    // default, and the toggle lives on the visualizer's dock, not the reader.
    check("swarm: BLIND by default", state?.blind === true, `blind=${state?.blind}`);
    check("swarm: blind toggle starts checked on the dock", await page.isChecked("#swarm-blind"));
    check("swarm: dock visible on the canvas pane", (await page.locator('#swarm-dock[data-visible="true"]').count()) === 1);
    check("swarm: picker pill multi-well is lit", (await page.locator('#swarm-maps button[data-map="multi-well"][data-on="true"]').count()) === 1);
    const kb = await shot(file);
    check("swarm: screenshot captured", kb > 30, `${kb.toFixed(1)} KB`);
  }
}

/* ---------------- 3b: ?shot=fogswarm — blind swarm, partially painted ---- */

await page.goto(`${base}/?shot=fogswarm`, { waitUntil: "load" });
await page.waitForTimeout(1500);
const fogswarm = await page.evaluate(() => window.__wp1.swarm());
check("fogswarm: scene booted", (await page.evaluate(() => window.__wp1.scene())) === "swarm");
check("fogswarm: blind mode on", fogswarm?.blind === true, `blind=${fogswarm?.blind}`);
check("fogswarm: mid-flight pose", Math.abs(fogswarm?.time ?? 1) < 1e-9, `time=${fogswarm?.time}`);
check(
  "fogswarm: terrain partially painted (QA S7-SWARM-3)",
  fogswarm?.painted >= 15 && fogswarm?.painted < fogswarm?.paintedTotal,
  `painted=${fogswarm?.painted} stamps=${fogswarm?.stamps} total=${fogswarm?.paintedTotal}`,
);
check("fogswarm: painted is a PARTIAL map", fogswarm?.painted < fogswarm?.paintedTotal, `painted=${fogswarm?.painted} total=${fogswarm?.paintedTotal}`);
check("fogswarm: ensemble ledger is large", fogswarm?.paintedTotal >= 40, `total=${fogswarm?.paintedTotal}`);
{
  const kb = await shot("25-fogswarm.png");
  check("fogswarm: screenshot captured", kb > 30, `${kb.toFixed(1)} KB`);
}

/* ---------------- 4: live play ---------------- */

await page.goto(`${base}/?step=18`, { waitUntil: "load" });
await page.waitForTimeout(800);
// The lock may hold during scene entry; wait for idle.
for (let i = 0; i < 40; i++) {
  const a = await page.evaluate(() => ({
    locked: window.__wp1.locked(),
    animating: window.__wp1.animating(),
  }));
  if (!a.locked && !a.animating) break;
  await sleep(250);
}
check("live: scene is tilt-a", (await page.evaluate(() => window.__wp1.scene())) === "tilt-a");

// Fog of war, per run: the fresh attempt arms DARK (start patch only), the
// ball's first ride paints terrain in, and Restart re-arms from scratch.
{
  const fog0 = await page.evaluate(() => window.__wp1.tilt());
  check(
    "live: fresh run arms fog (dark board + start patch)",
    fog0.fogOn === true && fog0.fogLift === 0 && fog0.fogStamps === 1,
    `fogOn=${fog0.fogOn} fogLift=${fog0.fogLift} fogStamps=${fog0.fogStamps}`,
  );
  await page.keyboard.down("d");
  await sleep(400);
  await page.keyboard.up("d");
  const fogRide = await page.evaluate(() => window.__wp1.tilt());
  check(
    "live: fog paints in as the ball rolls",
    fogRide.fogStamps > 1 && fogRide.fogLift === 0,
    `fogStamps=${fogRide.fogStamps} (was ${fog0.fogStamps}) fogLift=${fogRide.fogLift}`,
  );
  await page.click("#tilt-restart");
  await sleep(400);
  const fogRe = await page.evaluate(() => window.__wp1.tilt());
  check(
    "live: Restart re-arms fog (reset per restart)",
    fogRe.done === false && fogRe.fogOn === true && fogRe.fogLift === 0 && fogRe.fogStamps === 1,
    `done=${fogRe.done} fogOn=${fogRe.fogOn} fogLift=${fogRe.fogLift} fogStamps=${fogRe.fogStamps}`,
  );
}

const before = await page.evaluate(() => window.__wp1.tilt().pos);
await page.keyboard.down("d");
await sleep(900);
const during = await page.evaluate(() => window.__wp1.tilt());
const moved = Math.hypot(during.pos.x - before.x, during.pos.y - before.y);
check("live: holding D moves the ball (tilt response)", moved > 0.5, `moved=${moved.toFixed(2)} input=${JSON.stringify(during.input)}`);
check("live: stamps track cells during play (QA S7-1)", during.stamps === during.cells && during.cells > 1, `stamps=${during.stamps} cells=${during.cells}`);
await page.keyboard.up("d");
const atRelease = await page.evaluate(() => window.__wp1.tilt().pos);
await sleep(400);
const after = await page.evaluate(() => window.__wp1.tilt().pos);
const coasted = Math.hypot(after.x - atRelease.x, after.y - atRelease.y);
check("live: ball coasts after release (inertia)", coasted > 0.05, `coasted=${coasted.toFixed(3)}`);

// Damping slider is live: crank it up; speed should bleed off quickly.
await page.evaluate(() => {
  const s = document.querySelector("#tilt-friction");
  s.value = "900";
  s.dispatchEvent(new Event("input", { bubbles: true }));
});
await sleep(700);
const damped = await page.evaluate(() => window.__wp1.tilt());
check("live: damping slider live (high c kills speed)", Math.hypot(damped.vel.x, damped.vel.y) < Math.hypot(during.vel.x, during.vel.y), `|v|=${Math.hypot(damped.vel.x, damped.vel.y).toFixed(3)}`);
const regime = await page.evaluate(() => document.querySelector("#tilt-friction-regime").textContent);
check("live: damping regime label updates", regime === "over-damped", regime);
await page.evaluate(() => {
  const s = document.querySelector("#tilt-friction");
  s.value = "250";
  s.dispatchEvent(new Event("input", { bubbles: true }));
});

// Level switch: Rosenbrock terrain, fresh run. (The step clock keeps
// ticking once the level is live — a stationary ball still spends steps —
// so assert "fresh": at the level's start, on a single measurement cell.)
await page.click('#tilt-levels button[data-level="rosen"]');
await sleep(800);
const rosen = await page.evaluate(() => window.__wp1.tilt());
const rosenFresh =
  rosen.level === "rosen" &&
  rosen.steps < 240 &&
  rosen.cells === 1 &&
  Math.hypot(rosen.pos.x - (-1.2), rosen.pos.y - 1.44) < 0.05;
check("live: level 2 swaps terrain + fresh run", rosenFresh, `level=${rosen.level} steps=${rosen.steps} cells=${rosen.cells} pos=${JSON.stringify(rosen.pos)}`);
check(
  "live: level swap re-arms fog (reset per level)",
  rosen.fogOn === true && rosen.fogLift === 0 && rosen.fogStamps === 1,
  `fogOn=${rosen.fogOn} fogLift=${rosen.fogLift} fogStamps=${rosen.fogStamps}`,
);
await page.click('#tilt-levels button[data-level="rastr"]');
await sleep(800);
const rastr = await page.evaluate(() => window.__wp1.tilt());
check("live: level 3 swaps terrain + fresh run", rastr.level === "rastr" && rastr.steps < 240 && rastr.cells <= 2, `level=${rastr.level} steps=${rastr.steps} cells=${rastr.cells}`);
check(
  "live: level 3 fog re-armed too (dark board + start patch)",
  rastr.fogOn === true && rastr.fogLift === 0 && rastr.fogStamps === 1,
  `fogOn=${rastr.fogOn} fogLift=${rastr.fogLift} fogStamps=${rastr.fogStamps}`,
);

// The two wilder maps (2026-11-17): each pill swaps the terrain in place
// and re-arms the fog exactly like levels 1-3. Restored to rastr below so
// the Finish/scrubber beats keep their start.
await page.click('#tilt-levels button[data-level="archi"]');
await sleep(800);
const archiLive = await page.evaluate(() => window.__wp1.tilt());
check(
  "live: level 4 archipelago swaps terrain + fresh run",
  archiLive.level === "archi" && archiLive.steps < 240 && archiLive.cells <= 2 &&
    Math.hypot(archiLive.pos.x - (-7.4), archiLive.pos.y - (-6.4)) < 0.05,
  `level=${archiLive.level} steps=${archiLive.steps} cells=${archiLive.cells} pos=${JSON.stringify(archiLive.pos)}`,
);
check(
  "live: level 4 fog re-armed",
  archiLive.fogOn === true && archiLive.fogLift === 0 && archiLive.fogStamps === 1,
  `fogOn=${archiLive.fogOn} fogStamps=${archiLive.fogStamps}`,
);
check("live: level 4 pill is the lit one", (await page.locator('#tilt-levels button[data-level="archi"][data-on="true"]').count()) === 1);
await page.click('#tilt-levels button[data-level="canyon"]');
await sleep(800);
const canyonLive = await page.evaluate(() => window.__wp1.tilt());
check(
  "live: level 5 canyon peaks swaps terrain + fresh run",
  canyonLive.level === "canyon" && canyonLive.steps < 240 && canyonLive.cells <= 2 &&
    Math.hypot(canyonLive.pos.x - (-2.9), canyonLive.pos.y - 1.1168362202947417) < 0.05,
  `level=${canyonLive.level} steps=${canyonLive.steps} cells=${canyonLive.cells} pos=${JSON.stringify(canyonLive.pos)}`,
);
check(
  "live: level 5 fog re-armed",
  canyonLive.fogOn === true && canyonLive.fogLift === 0 && canyonLive.fogStamps === 1,
  `fogOn=${canyonLive.fogOn} fogStamps=${canyonLive.fogStamps}`,
);
await page.click('#tilt-levels button[data-level="rastr"]');
await sleep(800);
const rastrBack = await page.evaluate(() => window.__wp1.tilt());
check("live: rastr restored for the finish beat", rastrBack.level === "rastr" && rastrBack.cells <= 2, `level=${rastrBack.level} cells=${rastrBack.cells}`);

// Finish: scorecard lights up in the panel.
// QA cycle B (student-2): the attract pose is frozen until steered, so the
// rastr run needs a real stride before finishing — the scrubber check below
// requires a multi-sample recording (the old drift no longer accumulates).
await page.keyboard.down("d");
await sleep(400);
await page.keyboard.up("d");
await sleep(200);
await page.click("#tilt-finish");
await sleep(400);
const done = await page.evaluate(() => window.__wp1.tilt());
check("live: Finish ends the run", done.done === true);
check("live: stamps track cells when done (QA S7-1)", done.stamps === done.cells, `stamps=${done.stamps} cells=${done.cells}`);
// The run's reveal beat: Finish opens the painted map fully (fog stays
// bound until the scene tears it down on tilt-b).
check(
  "live: Finish lifts the fog (the reveal beat)",
  done.fogOn === true && done.fogLift === 1,
  `fogOn=${done.fogOn} fogLift=${done.fogLift}`,
);
const rows = await page.locator("#tilt-scorecard-body tr").count();
check("live: scorecard renders 4 rows", rows === 4, `rows=${rows}`);
const scoreVisible = await page.evaluate(() => !document.querySelector("#tilt-score").hidden);
check("live: scorecard block visible", scoreVisible === true);

// Advance to the reveal scene (tilt-b): ghost + scrubber.
await page.evaluate(() => window.__wp1.skip());
await page.evaluate(() => document.querySelector("#continue-hint:not([hidden])") || window.__wp1.skip());
await page.keyboard.press("ArrowDown").catch(() => {});
await sleep(900);
// Arrow keys are tilt keys while a run is live — the run is done now, so
// ArrowDown should advance the reader instead.
let sceneNow = await page.evaluate(() => window.__wp1.scene());
if (sceneNow !== "tilt-b") {
  // Fall back to the rail: last reader step buttons are DOM buttons.
  await page.evaluate(() => {
    const rail = document.querySelectorAll("#rail button");
    rail[20].click(); // tilt-b is the 21st of 27 steps (SCENE_ORDER grew)
  });
  await sleep(1000);
  sceneNow = await page.evaluate(() => window.__wp1.scene());
}
check("live: advance reaches tilt-b reveal", sceneNow === "tilt-b", `scene=${sceneNow}`);
{
  const tbFog = await page.evaluate(() => window.__wp1.tilt());
  check(
    "live: tilt-b tears the run fog down",
    tbFog.fogOn === false,
    `fogOn=${tbFog.fogOn} fogLift=${tbFog.fogLift}`,
  );
}
// QA S7-TILTB-DEAD-CONTROLS: the reveal panel must drop the play controls —
// there is no live run to damp and no level to switch there.
{
  const dead = await page.evaluate(() => {
    const panel = document.querySelector("#tilt-panel");
    const disp = (sel) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el).display : "missing";
    };
    return {
      mode: panel?.dataset.mode,
      levels: disp("#tilt-levels"),
      damp: disp("#tilt-panel .eta-control"),
    };
  });
  check(
    "live: tilt-b reveal mode hides dead play controls",
    dead.mode === "reveal" && dead.levels === "none" && dead.damp === "none",
    `mode=${dead.mode} #tilt-levels=${dead.levels} .eta-control=${dead.damp}`,
  );
}
const reveal = await page.evaluate(() => window.__wp1.tilt());
check("live: ghost + machines on the reveal", reveal.ghost === true && reveal.machines?.length === 3, `ghost=${reveal.ghost} machines=${reveal.machines?.length}`);
async function scrubGhost(value) {
  await page.evaluate((v) => {
    const s = document.querySelector("#tilt-scrub");
    s.value = String(v);
    s.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
  await sleep(300);
  return page.evaluate(() => window.__wp1.tilt().ghostPos);
}
const g0 = await scrubGhost(0);
const g1 = await scrubGhost(1000);
const gHalf = await scrubGhost(500);
// Endpoint fidelity: scrub 0 sits on the recorded start (the level start),
// scrub 1 on the final position, mid strictly between. (The scripted run
// here is only ~0.003 units long — the bot barely moved — so absolute
// distances are tiny by design.)
const rastrStart = { x: -0.999, y: 1.986 };
const final = await page.evaluate(() => window.__wp1.tilt().pos);
check(
  "live: scrubber spans the recording (0 = start, 1 = end, mid between)",
  g0 !== null && g1 !== null &&
    Math.hypot(g0.x - rastrStart.x, g0.y - rastrStart.y) < 0.005 &&
    Math.hypot(g1.x - final.x, g1.y - final.y) < 0.005 &&
    Math.hypot(gHalf.x - g0.x, gHalf.y - g0.y) > 1e-5,
  `start=${JSON.stringify(g0)} end=${JSON.stringify(g1)} mid=${JSON.stringify(gHalf)}`,
);

  // FIX (user bug — the reveal raced LINES only): the replay renders the
  // player ghost AND the three machines as BALLS (§6's ghost-ball
  // approach — identity colors, contact shadows), and every ball MOVES
  // as the scrub advances.
  const revealBallsAt = async (v) => {
    await page.evaluate((val) => {
      const s = document.querySelector("#tilt-scrub");
      s.value = String(val);
      s.dispatchEvent(new Event("input", { bubbles: true }));
    }, v);
    await sleep(300);
    return page.evaluate(() => {
      const t = window.__wp1.tilt();
      return { n: t.revealBalls, pos: t.revealBallPos };
    });
  };
  const ballsEarly = await revealBallsAt(100);
  const ballsLate = await revealBallsAt(900);
  check(
    "live: the reveal races BALLS (player + 3 machine balls on stage)",
    ballsEarly.n === 4 && ballsEarly.pos.length === 4,
    `n=${ballsEarly.n} pos=${JSON.stringify(ballsEarly.pos)}`,
  );
  const ballsMoved = ballsEarly.pos.every((p, i) => {
    const q = ballsLate.pos[i];
    return q !== undefined && Math.hypot(p.x - q.x, p.y - q.y) > 1e-5;
  });
  check(
    "live: every replayed ball MOVES as the scrub advances (100 → 900)",
    ballsMoved === true,
    `early=${JSON.stringify(ballsEarly.pos)} late=${JSON.stringify(ballsLate.pos)}`,
  );

// And the finale: advance to the swarm, let it fly, count clusters.
await page.evaluate(() => {
  const rail = document.querySelectorAll("#rail button");
  rail[21].click(); // swarm is the 22nd of 27 steps (SCENE_ORDER grew)
});
await sleep(2500);
const swarm = await page.evaluate(() => window.__wp1.swarm());
check("live: swarm flies on the finale scene", swarm !== null && swarm.balls === 100 && swarm.playing, JSON.stringify(swarm));
check("live: swarm boots BLIND (the dock toggle reflects it)", swarm?.blind === true && (await page.isChecked("#swarm-blind")), `blind=${swarm?.blind}`);
// Fog ownership hand-off: the tilt teardown did NOT kill the swarm's blind
// fog — the finale's own applySwarmFogMode owns it here.
{
  const swarmFog = await page.evaluate(() => window.__wp1.tilt().fogOn);
  check("live: the blind swarm owns the fog after the tilt teardown", swarmFog === true, `fogOn=${swarmFog}`);
}
// QA S2-SWARM-SCORECARD-PRECOMPUTED-SPOILER: early in the flight nothing has
// arrived — no cluster rows, no final outcome on screen.
{
  const early = await page.evaluate(() => ({
    arrived: window.__wp1.swarm()?.arrived,
    clusters: window.__wp1.swarm()?.clusters?.length,
    listHidden: document.querySelector("#tilt-swarm-clusters")?.hidden,
  }));
  check("live: early flight shows no spoiler (0 arrived, cluster list hidden)", early.arrived === 0 && early.clusters === 0 && early.listHidden === true, JSON.stringify(early));
}
const kb = await shot("27-tilt-live-end.png");
check("live: final screenshot captured", kb > 30, `${kb.toFixed(1)} KB`);

/* ---------------- 4b: live swarm replay + time scrub ---------------- */

// Scrub forward: parks the flight at 90% — most balls arrived, clusters out.
{
  const setScrub = (v) => page.evaluate((val) => {
    const s = document.querySelector("#swarm-scrub");
    s.value = String(val);
    s.dispatchEvent(new Event("input", { bubbles: true }));
    return window.__wp1.swarm();
  }, v);
  const parked = await setScrub(900);
  check("live: scrub parks the flight at 90%", Math.abs(parked?.scrub - 0.9) < 0.01 && parked?.playing === false, `scrub=${parked?.scrub} playing=${parked?.playing}`);
  check("live: scrubbed-forward flight has arrived balls + cluster rows", parked?.arrived > 50 && (parked?.clusters?.length ?? 0) >= 3, `arrived=${parked?.arrived} rows=${parked?.clusters?.length}`);
  // Scrub BACKWARD: the blind map re-paints from scratch — parked at 0 the
  // ledger is empty again (stamps reset with it).
  const rewound = await setScrub(0);
  check("live: backward scrub rewinds + empties the paint ledger", Math.abs(rewound?.scrub) < 0.01 && rewound?.painted === 0 && rewound?.arrived === 0, `scrub=${rewound?.scrub} painted=${rewound?.painted} arrived=${rewound?.arrived}`);
  // ▶ on the dock: parked → resumes flying from the scrub position.
  await page.click("#swarm-replay-play");
  await sleep(700);
  const resumed = await page.evaluate(() => window.__wp1.swarm());
  check("live: ▶ resumes a parked flight", resumed?.playing === true && resumed?.time > 0, `playing=${resumed?.playing} t=${resumed?.time?.toFixed(2)}`);
  // ❚❚ pauses.
  await page.click("#swarm-replay-play");
  const paused = await page.evaluate(() => window.__wp1.swarm());
  check("live: ❚❚ pauses the flight", paused?.playing === false, `playing=${paused?.playing}`);
  // ↻ restarts from t=0 AND re-arms.
  await page.click("#swarm-replay-restart");
  const restarted = await page.evaluate(() => window.__wp1.swarm());
  check("live: ↻ restarts the flight from t=0", restarted?.playing === true && restarted?.time < 0.5 && restarted?.scrub < 0.05, `t=${restarted?.time?.toFixed(2)} scrub=${restarted?.scrub}`);
  // SWARM-MAPS-BWD-SCRUB-REWINDS-TO-ZERO: from an ENDED flight, a backward
  // blind scrub must PARK at the dragged fraction (the pre-fix rewind branch
  // clobbered sw.time back to 0 — flight home, map wiped, thumb at 0). The
  // old gate only scrubbed back to exactly 0, where reset-to-0 coincides
  // with the requested fraction and hides the bug.
  {
    const t0 = Date.now();
    let ended = null;
    while (Date.now() - t0 < 25000) {
      ended = await page.evaluate(() => window.__wp1.swarm());
      if (ended && ended.playing === false && ended.scrub >= 0.99) break;
      await sleep(500);
    }
    check("live: flight ends on its own (parked at 1.0)", ended?.playing === false && ended?.scrub >= 0.99, `scrub=${ended?.scrub} playing=${ended?.playing}`);
    const backTo90 = await setScrub(900);
    check(
      "live: backward blind scrub parks at the dragged fraction (0.9, not 0)",
      Math.abs(backTo90?.scrub - 0.9) < 0.01 && backTo90?.playing === false && backTo90?.arrived > 50,
      `scrub=${backTo90?.scrub} arrived=${backTo90?.arrived} painted=${backTo90?.painted}`,
    );
    check(
      "live: the parked backward pose re-paints the blind prefix",
      backTo90?.painted > 0,
      `painted=${backTo90?.painted}/${backTo90?.paintedTotal}`,
    );
    // And any non-zero backward target parks too (mid-posed state, not just
    // the end): 0.9 → 0.4 stays parked at the dragged fraction with the
    // paint prefix re-stamped. (Arrival stays 0 here by design — balls are
    // mid-ride at 40% of the timeline; the paint, not arrival, marks the
    // parked pose.)
    const backTo40 = await setScrub(400);
    check(
      "live: backward blind scrub to 0.4 parks mid-flight with a partial paint",
      Math.abs(backTo40?.scrub - 0.4) < 0.01 && backTo40?.playing === false && backTo40?.painted > 0,
      `scrub=${backTo40?.scrub} arrived=${backTo40?.arrived} painted=${backTo40?.painted}`,
    );
  }
}

/* ---------------- 4c: live swarm landscape picker ---------------- */

// Each pill swaps the terrain in place, rebuilds sim + clusters + paint
// ledger, and restarts the flight from t=0.
async function pickMap(id) {
  await page.click(`#swarm-maps button[data-map="${id}"]`);
  await sleep(900);
  return page.evaluate(() => window.__wp1.swarm());
}
// Let each country fly to its end and read its cluster story. Each end-
// state is read BEFORE switching away (the pills restart the flight).
{
  await page.click('#swarm-maps button[data-map="multi-well-large"]');
  await sleep(900);
  const large = await page.evaluate(() => window.__wp1.swarm());
  check("live: pill 2 picks multi-well large + restarts the flight", large?.map === "multi-well-large" && large?.balls === 100 && large?.playing === true && large?.time < 1.5, `map=${large?.map} t=${large?.time?.toFixed(2)} playing=${large?.playing}`);
  check("live: large pill is the lit one", (await page.locator('#swarm-maps button[data-map="multi-well-large"][data-on="true"]').count()) === 1);
  await sleep(9000);
  const largeEnd = await page.evaluate(() => window.__wp1.swarm());
  const rows = largeEnd?.clusters ?? [];
  const spread = rows.length ? Math.max(...rows.map((c) => c.meanLoss)) - Math.min(...rows.map((c) => c.meanLoss)) : 0;
  check("live: large country ends with ≥7 basin rows, unequal losses", largeEnd?.map === "multi-well-large" && largeEnd?.arrived === 100 && rows.length >= 7 && spread > 2.5, `rows=${rows.length} spread=${spread.toFixed(2)} arrived=${largeEnd?.arrived}`);
}
{
  await page.click('#swarm-maps button[data-map="himmelblau"]');
  await sleep(900);
  const himmel = await page.evaluate(() => window.__wp1.swarm());
  check("live: pill 3 picks himmelblau + restarts the flight", himmel?.map === "himmelblau" && himmel?.balls === 100 && himmel?.playing === true && himmel?.time < 1.5, `map=${himmel?.map} t=${himmel?.time?.toFixed(2)}`);
  await sleep(9500);
  const hEnd = await page.evaluate(() => window.__wp1.swarm());
  const rows = hEnd?.clusters ?? [];
  check(
    "live: himmelblau ends with 4 GLOBAL rows at the same floor",
    hEnd?.map === "himmelblau" && hEnd?.arrived === 100 && rows.length === 4 &&
      rows.every((c) => c.global === true) && rows.every((c) => Math.abs(c.meanLoss) < 0.05),
    `rows=${JSON.stringify(rows.map((c) => [c.name, c.global, c.meanLoss]))}`,
  );
}
{
  // 2026-11-17 new-map round: the archipelago joins the picker — 8 ridge-
  // walled island basins, every one occupied, wildly unequal outcomes.
  await page.click('#swarm-maps button[data-map="archipelago"]');
  await sleep(900);
  const archi = await page.evaluate(() => window.__wp1.swarm());
  check("live: pill 4 picks archipelago + restarts the flight", archi?.map === "archipelago" && archi?.balls === 100 && archi?.playing === true && archi?.time < 1.5, `map=${archi?.map} t=${archi?.time?.toFixed(2)}`);
  check("live: archipelago pill is the lit one", (await page.locator('#swarm-maps button[data-map="archipelago"][data-on="true"]').count()) === 1);
  check("live: archipelago census names the ridges", /ridges/.test(await page.evaluate(() => document.querySelector("#tilt-level")?.textContent ?? "")), await page.evaluate(() => document.querySelector("#tilt-level")?.textContent));
  await sleep(9500);
  const aEnd = await page.evaluate(() => window.__wp1.swarm());
  const rows = aEnd?.clusters ?? [];
  const spread = rows.length ? Math.max(...rows.map((c) => c.meanLoss)) - Math.min(...rows.map((c) => c.meanLoss)) : 0;
  const gold = rows.find((c) => c.global);
  check(
    "live: archipelago ends with all 8 island basins occupied",
    aEnd?.map === "archipelago" && aEnd?.arrived === 100 && rows.length === 8,
    `rows=${JSON.stringify(rows.map((c) => [c.name, c.count, c.meanLoss?.toFixed(2)]))}`,
  );
  check(
    "live: archipelago clusters are DISTINCT (loss spread > 5, atoll crowd far below)",
    spread > 5 && gold !== undefined && gold.meanLoss < -7,
    `spread=${spread.toFixed(2)} global=${gold?.name} ${gold?.meanLoss?.toFixed(2)}`,
  );
}
{
  await page.click('#swarm-maps button[data-map="multi-well"]');
  await sleep(900);
  const back = await page.evaluate(() => window.__wp1.swarm());
  check("live: pill 1 returns to multi-well + restarts the flight", back?.map === "multi-well" && back?.playing === true && back?.time < 1.5, `map=${back?.map} t=${back?.time?.toFixed(2)}`);
  await sleep(9500);
  const end = await page.evaluate(() => window.__wp1.swarm());
  const sum = (end?.clusters ?? []).reduce((a, c) => a + c.count, 0);
  check("live: default country restored — flight ends with all 100 in 6 basin rows", end?.map === "multi-well" && end?.playing === false && end?.arrived === 100 && end?.clusters?.length === 6 && sum === 100, `map=${end?.map} playing=${end?.playing} arrived=${end?.arrived} rows=${end?.clusters?.length} sum=${sum}`);
  check("live: minima found = 6 wells (QA S2-SWARM-SEVEN-MINIMA)", end?.minimaFound === 6 && end?.minima === 6, `minimaFound=${end?.minimaFound} minima=${end?.minima}`);
}

/* ---------------- 5: live "run blind / show map" toggle ---------------- */

// The toggle lives ON the swarm dock now (bottom-left of the canvas pane).
// The swarm boots blind; the round-trip below flips it OFF (show map) and
// back ON, asserting the clean rewind each way. The rewind frame is read in
// the SAME evaluate that fires the change: setSwarmBlind runs its first
// instance update synchronously at time 0 (QA S2-SWARM-PAINT-MISSES-
// CROSSED-CELLS: start cells stamp at launch, never before).
const toggleBlind = (on) => page.evaluate((want) => {
  const t = document.querySelector("#swarm-blind");
  if (!t) return null;
  t.checked = want;
  t.dispatchEvent(new Event("change", { bubbles: true }));
  return window.__wp1.swarm();
}, on);
{
  const shown = await toggleBlind(false);
  check("live: untick restores the visible swarm + re-runs", shown?.blind === false && shown?.time < 1.5 && shown?.playing === true, `blind=${shown?.blind} t=${shown?.time?.toFixed(2)}`);
  // V4-F1: the untick must UNBIND the fog at the view level (the old bug:
  // the rewind's fog-mode arm was guarded by swarmBlind, so the off path
  // never ran setFogEnabled(false) and the stale painted mask froze on
  // stage — show-map rendered identical to blind).
  check("live: untick unbinds the fog (tilt().fogOn false)", (await page.evaluate(() => window.__wp1.tilt().fogOn)) === false);
  check("live: dock toggle unchecked after untick", (await page.isChecked("#swarm-blind")) === false);
  await sleep(2000);
  const flying = await page.evaluate(() => window.__wp1.swarm());
  check("live: visible swarm flies after unticking", flying?.blind === false && flying?.playing === true && flying?.time > 1.5, `t=${flying?.time?.toFixed(2)}`);
  // Pixel proof (the state flags above passed pre-fix with NOTHING visible):
  // capture the shown-map frame, then ~0.3s after the re-tick capture the
  // blind frame (flight rewound, almost nothing painted → void black), and
  // require the shown frame's void boxes to BRIGHTEN vs blind. Pre-fix both
  // frames are black-void identical (qa/visual4 measured 11,13,16 in both).
  mkdirSync(resolve(outDir, "..", "qa", "gate-tilt-v4f1"), { recursive: true });
  await page.screenshot({ path: resolve(outDir, "..", "qa", "gate-tilt-v4f1", "shown.png") });
  const v4f1Boxes = [[620, 260, 120, 90], [260, 600, 120, 90], [560, 560, 100, 80]];
  const boxMeans = (file) => page.evaluate(async ({ src, bx }) => {
    const img = new Image();
    img.src = src;
    await new Promise((r, j) => { img.onload = r; img.onerror = j; });
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    return bx.map(([x, y, w, h]) => {
      const d = g.getImageData(x, y, w, h).data;
      let r = 0, gr = 0, bl = 0;
      const n = d.length / 4;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; gr += d[i + 1]; bl += d[i + 2]; }
      return [Math.round(r / n), Math.round(gr / n), Math.round(bl / n)];
    });
  }, { src: `data:image/png;base64,${readFileSync(file).toString("base64")}`, bx: v4f1Boxes });
  const shownMeans = await boxMeans(resolve(outDir, "..", "qa", "gate-tilt-v4f1", "shown.png"));
  const fogged = await toggleBlind(true);
  check("live: tick re-fogs + rewinds dark (no start-cell bulk reveal)", fogged?.blind === true && fogged?.painted === 0 && fogged?.time < 1.5, `blind=${fogged?.blind} painted=${fogged?.painted} t=${fogged?.time?.toFixed(2)}`);
  check("live: tick rebinds the fog (tilt().fogOn true)", (await page.evaluate(() => window.__wp1.tilt().fogOn)) === true);
  await sleep(300);
  await page.screenshot({ path: resolve(outDir, "..", "qa", "gate-tilt-v4f1", "blind.png") });
  const blindMeans = await boxMeans(resolve(outDir, "..", "qa", "gate-tilt-v4f1", "blind.png"));
  const lift = Math.max(...v4f1Boxes.map((_, i) =>
    (shownMeans[i][0] + shownMeans[i][1] + shownMeans[i][2]) - (blindMeans[i][0] + blindMeans[i][1] + blindMeans[i][2])));
  check("live: untick really SHOWS the terrain (void boxes brighten vs blind — V4-F1 pixel proof)", lift > 20, `shown=${JSON.stringify(shownMeans)} blind=${JSON.stringify(blindMeans)} maxLift=${lift}`);
  await sleep(2200);
  const blindNow = await page.evaluate(() => window.__wp1.swarm());
  check("live: swarm paints cells while flying blind", blindNow?.painted > 15 && blindNow?.stamps > 15, `painted=${blindNow?.painted} stamps=${blindNow?.stamps} t=${blindNow?.time?.toFixed(1)}`);
  check("live: painted count is live (partial of total)", blindNow?.painted <= blindNow?.paintedTotal, `painted=${blindNow?.painted}/${blindNow?.paintedTotal}`);
  {
    const line = await page.evaluate(() => document.querySelector("#tilt-swarm-line")?.textContent ?? "");
    check("live: blind line counts painted cells + minima found", /cells painted/.test(line) && /minima found/.test(line), `line=${line}`);
  }
  {
    const kb = await shot("26-fogswarm-live.png");
    check("live: blind screenshot captured", kb > 30, `${kb.toFixed(1)} KB`);
  }
}

/* ---------------- 6: the tilt fog never leaks past §7 ---------------- */

// Rail to §8 (a non-fog scene): the run-scoped fog must be torn down here —
// fogOn is view-global, so any leftover would fog the workbench landscape.
{
  await page.evaluate(() => {
    const rail = document.querySelectorAll("#rail button");
    rail[22].click(); // §8 labrule-1 (page 22 of 27)
  });
  await sleep(1500);
  const away = await page.evaluate(() => ({
    scene: window.__wp1.scene(),
    fogOn: window.__wp1.tilt().fogOn,
    fogLift: window.__wp1.tilt().fogLift,
  }));
  check("live: fog does not leak into a non-fog scene (§8)", away.scene === "labrule" && away.fogOn === false, JSON.stringify(away));
}

await browser.close();
console.log(failures === 0 ? "GATE_TILT_OK" : `GATE_TILT_FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
