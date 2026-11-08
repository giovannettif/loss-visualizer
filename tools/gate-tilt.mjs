/**
 * gate-tilt.mjs — WP-C (§7 tilt game + swarm) live gate over Playwright.
 *
 *   1. ?shot=tilt-a renders the frozen mid-run valley pose (curated ride cut
 *      at 45%: trail, measurement stamps, minimap path, live panel).
 *   2. ?shot=tilt-b renders the scorecard + replay UI (4 rows, ghost trail,
 *      three machine trails, scrubber parked at 35%).
 *   3. ?shot=swarm renders the swarm mid-flight (100 instanced balls,
 *      clusters forming — many distinct minima occupied).
 *   4. Live play (?step=18): holding D moves the ball; releasing lets it
 *      coast (inertia); the damping slider is live; level buttons swap the
 *      terrain; Finish ends the run and lights the scorecard; the scrubber
 *      moves the ghost on tilt-b.
 *
 * Usage: node tools/gate-tilt.mjs [baseUrl]
 */

import { chromium } from "playwright";
import { mkdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const base = process.argv[2] ?? "http://localhost:4173";
const outDir = resolve("shots");
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
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
    const kb = await shot(file);
    check("tilt-a: screenshot captured", kb > 30, `${kb.toFixed(1)} KB`);
  }
  if (scene === "tilt-b") {
    check("tilt-b: on the Rosenbrock level", state?.level === "rosen");
    check("tilt-b: run finished", state?.done === true, `settled=${state?.settled}`);
    check("tilt-b: ghost on stage", state?.ghost === true);
    check("tilt-b: scorecard has 3 machine runs (+ you = 4 DOM rows)", state?.machines?.length === 3, JSON.stringify(state?.machines?.map((m) => m.label)));
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
    check("swarm: visible mode by default", state?.blind === false, `blind=${state?.blind}`);
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
check("fogswarm: terrain partially painted", fogswarm?.painted > 40 && fogswarm?.stamps > 40, `painted=${fogswarm?.painted} stamps=${fogswarm?.stamps}`);
check("fogswarm: painted is a PARTIAL map", fogswarm?.painted < fogswarm?.paintedTotal, `painted=${fogswarm?.painted} total=${fogswarm?.paintedTotal}`);
check("fogswarm: ensemble ledger is large", fogswarm?.paintedTotal >= 60, `total=${fogswarm?.paintedTotal}`);
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

const before = await page.evaluate(() => window.__wp1.tilt().pos);
await page.keyboard.down("d");
await sleep(900);
const during = await page.evaluate(() => window.__wp1.tilt());
const moved = Math.hypot(during.pos.x - before.x, during.pos.y - before.y);
check("live: holding D moves the ball (tilt response)", moved > 0.5, `moved=${moved.toFixed(2)} input=${JSON.stringify(during.input)}`);
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
await page.click('#tilt-levels button[data-level="rastr"]');
await sleep(800);
const rastr = await page.evaluate(() => window.__wp1.tilt());
check("live: level 3 swaps terrain + fresh run", rastr.level === "rastr" && rastr.steps < 240 && rastr.cells <= 2, `level=${rastr.level} steps=${rastr.steps} cells=${rastr.cells}`);

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

// And the finale: advance to the swarm, let it fly, count clusters.
await page.evaluate(() => {
  const rail = document.querySelectorAll("#rail button");
  rail[21].click(); // swarm is the 22nd of 27 steps (SCENE_ORDER grew)
});
await sleep(2500);
const swarm = await page.evaluate(() => window.__wp1.swarm());
check("live: swarm flies on the finale scene", swarm !== null && swarm.balls === 100 && swarm.playing, JSON.stringify(swarm));
const kb = await shot("27-tilt-live-end.png");
check("live: final screenshot captured", kb > 30, `${kb.toFixed(1)} KB`);

/* ---------------- 5: live "run it blind" toggle ---------------- */

const toggle = () => page.evaluate(() => {
  const t = document.querySelector("#swarm-blind");
  if (!t) return null;
  t.checked = true;
  t.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
});
check("live: blind toggle exists on the swarm step", (await toggle()) === true);
await sleep(400);
let blindNow = await page.evaluate(() => window.__wp1.swarm());
check("live: blind mode on + run rewound", blindNow?.blind === true && blindNow.time < 1.5, `blind=${blindNow?.blind} time=${blindNow?.time}`);
// Flying blind paints cells fast (the ensemble's whole point).
await sleep(2500);
blindNow = await page.evaluate(() => window.__wp1.swarm());
check("live: swarm paints cells while flying blind", blindNow?.painted > 40 && blindNow?.stamps > 40, `painted=${blindNow?.painted} stamps=${blindNow?.stamps} t=${blindNow?.time?.toFixed(1)}`);
check("live: painted count is live (partial of total)", blindNow?.painted <= blindNow?.paintedTotal, `painted=${blindNow?.painted}/${blindNow?.paintedTotal}`);
{
  const kb = await shot("26-fogswarm-live.png");
  check("live: blind screenshot captured", kb > 30, `${kb.toFixed(1)} KB`);
}
// Flip back: fully visible, clean re-run.
await page.evaluate(() => {
  const t = document.querySelector("#swarm-blind");
  t.checked = false;
  t.dispatchEvent(new Event("change", { bubbles: true }));
});
await sleep(600);
const visibleAgain = await page.evaluate(() => window.__wp1.swarm());
check("live: toggle off restores the visible swarm + re-runs", visibleAgain?.blind === false && visibleAgain.time < 2.5, `blind=${visibleAgain?.blind} time=${visibleAgain?.time}`);
await sleep(2500);
const grown = await page.evaluate(() => window.__wp1.swarm());
check("live: visible swarm still flies after toggling back", grown?.playing === true && grown.time > visibleAgain.time, `t=${grown?.time?.toFixed(1)}`);

await browser.close();
console.log(failures === 0 ? "GATE_TILT_OK" : `GATE_TILT_FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
