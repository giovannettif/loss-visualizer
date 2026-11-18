/**
 * gate-fog.mjs — WP-B (§6 fog game) live gate over Playwright/Edge.
 *
 *   1. ?shot=fog-a / fog-b / fog-c render their frozen poses (diagnostics +
 *      screenshots into shots/).
 *   2. Live play, level 1 (?step=15): drag on the compass minimap → the
 *      measurement count increments, the fog mask stamps (destination-out),
 *      the loss readout moves; Finish fires the reveal (fog lifts, marker,
 *      annotation).
 *   3. Live play, level 2 (?step=16): fresh Rosenbrock game; steps work;
 *      Finish on the trap fires the trap annotation; advance to fog-c.
 *   4. fog-c: the four ghosts (player + GD/momentum/Adam) replay from the
 *      player's start, the scorecard has 4 rows, Replay relaunches them.
 *
 * Usage: node tools/gate-fog.mjs [baseUrl]
 */

import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";
import { mkdirSync, statSync } from "node:fs";
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

async function diag() {
  return page.evaluate(() => window.__wp1?.fog?.() ?? null);
}
async function app() {
  return page.evaluate(() => ({
    scene: window.__wp1?.scene?.(),
    step: window.__wp1?.step?.(),
    count: window.__wp1?.count?.(),
    locked: window.__wp1?.locked?.(),
    animating: window.__wp1?.animating?.(),
  }));
}
/** Waits until the reader is unlocked and the director idle. */
async function waitIdle(maxMs = 20000) {
  const t0 = Date.now();
  for (;;) {
    const a = await app();
    if (!a.locked && !a.animating) return true;
    if (Date.now() - t0 > maxMs) return false;
    await sleep(200);
  }
}
/** Drags an arrow on the compass minimap: from an offset to another. */
async function dragMinimap(dx0, dy0, dx1, dy1) {
  const box = await page.locator("#minimap-canvas").boundingBox();
  if (!box) throw new Error("minimap canvas missing");
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx + dx0, cy + dy0);
  await page.mouse.down();
  await page.mouse.move(cx + dx1, cy + dy1, { steps: 8 });
  await page.mouse.up();
}

/* ---------------- 1. frozen shots ---------------- */

await page.goto(`${base}/?shot=fog-a`, { waitUntil: "load" });
await sleep(1400);
{
  const d = await diag();
  check("shot fog-a boots the LS level", d?.level === "ls", JSON.stringify(d));
  check("shot fog-a is fresh + fogged", d?.used === 0 && d?.maskReady === true && d?.reveal === 0);
  await page.screenshot({ path: resolve(outDir, "16-fog-a.png") });
}

await page.goto(`${base}/?shot=fog-b`, { waitUntil: "load" });
await sleep(1400);
{
  const d = await diag();
  check("shot fog-b is the curated mid-game", d?.level === "rb" && d?.used === 3 && d?.pathLen === 4, JSON.stringify(d));
  check("shot fog-b painted the walk", d?.stamps > 10, `stamps=${d?.stamps}`);
  check("shot fog-b not revealed yet", d?.done === false && d?.reveal === 0);
  await page.screenshot({ path: resolve(outDir, "17-fog-b.png") });
}

await page.goto(`${base}/?shot=fog-c`, { waitUntil: "load" });
await sleep(1400);
{
  const d = await diag();
  check("shot fog-c reveals fully", d?.reveal === 1 && d?.done === true, JSON.stringify(d));
  check("shot fog-c ended on the Rosenbrock trap", d?.trapFinish === true);
  check("shot fog-c has all four ghosts", d?.ghosts === 4, `ghosts=${d?.ghosts}`);
  check("shot fog-c runs the machines", Array.isArray(d?.machines) && d.machines.length === 3);
  const rows = await page.locator("#fog-scorecard-body tr").count();
  check("shot fog-c scorecard has 4 rows", rows === 4, `rows=${rows}`);
  const note = await page.locator("#fog-reveal-note").getAttribute("data-visible");
  check("shot fog-c annotation visible", note === "true", `note=${note}`);
  const noteText = await page.locator("#fog-reveal-note").textContent();
  // Copy was revised after the Oct-28 QA round (director.spawnFogMarker);
  // the gate follows the shipped annotation, not the archived QA strings.
  check("shot fog-c trap annotation", noteText === "the global minimum lay across this unvisited ridge", noteText ?? "");
  await page.screenshot({ path: resolve(outDir, "18-fog-c.png") });
}

/* ---------------- 2. live play, level 1 ---------------- */

await page.goto(`${base}/?step=15`, { waitUntil: "load" });
check("boot: 27 reader steps", (await app()).count === 27, JSON.stringify(await app()));
check("boot: landed on fog-a", (await app()).scene === "fog-a");
check("boot: locked while the fog level materializes", (await app()).locked === true);
if (!(await waitIdle())) check("reader unlocks after entry", false, "still locked");

{
  let d = await diag();
  check("live fog-a fresh game", d?.level === "ls" && d?.used === 0 && d?.done === false, JSON.stringify(d));
  const loss0 = d.loss;
  await dragMinimap(10, 40, 62, 80); // any drag commits a step within reach
  // The walk takes ~0.7 s.
  await sleep(1300);
  d = await diag();
  check("live fog-a drag increments measurements", d?.used === 1, `used=${d?.used}`);
  check("live fog-a fog painted", d?.stamps > 3, `stamps=${d?.stamps}`);
  check("live fog-a loss moved", Math.abs(d.loss - loss0) > 1e-9, `${loss0} -> ${d?.loss}`);
  const panel = await page.locator("#fog-panel").getAttribute("data-visible");
  check("live fog-a fog panel visible", panel === "true");
  const meas = await page.locator("#fog-meas").textContent();
  check("live fog-a panel shows 1 / 10", meas?.trim() === "1 / 10", meas ?? "none");

  // Spend the rest of the budget — varied directions (the compass is only
  // 140×220 CSS px, so offsets stay inside it) so the ball never converges
  // onto the drag point and trips the mis-drag guard.
  const dirs = [
    [45, 60], [-50, 55], [-30, -75], [52, -40], [8, -78],
    [-60, -15], [-40, 58], [55, 18], [-10, 75],
  ];
  for (const [dx, dy] of dirs) {
    await dragMinimap(dx * 0.3, dy * 0.3, dx, dy);
    await sleep(1150);
  }
  d = await diag();
  check("live fog-a budget drains to the reveal", d?.used === 10 && d?.done === true, `used=${d?.used} done=${d?.done}`);
  const t0 = Date.now();
  for (;;) {
    d = await diag();
    if (d?.reveal === 1 || Date.now() - t0 > 4000) break;
    await sleep(150);
  }
  check("live fog-a reveal lifts the fog", d?.reveal === 1, `reveal=${d?.reveal}`);
  const note = await page.locator("#fog-reveal-note").getAttribute("data-visible");
  check("live fog-a annotation shows", note === "true");
  const noteText = await page.locator("#fog-reveal-note").textContent();
  // Copy revised after the Oct-28 QA round (director.spawnFogMarker).
  check("live fog-a annotation is the LS line", noteText === "the true global minimum", noteText ?? "");
  await page.screenshot({ path: resolve(outDir, "19-fog-a-revealed.png") });
}

/* ---------------- 3. live play, level 2 (Rosenbrock) ---------------- */

await page.goto(`${base}/?step=16`, { waitUntil: "load" });
if (!(await waitIdle())) check("fog-b unlocks after entry", false, "still locked");
{
  let d = await diag();
  check("live fog-b is a fresh Rosenbrock game", d?.level === "rb" && d?.used === 0, JSON.stringify(d));

  // Walk down the banana toward the trap: three varied strides toward
  // (+x, −y) in parameter space = down-right on the compass canvas.
  const moves = [
    [12, 25, 55, 70],
    [10, 30, 52, 78],
    [14, 28, 58, 74],
  ];
  for (const [a, b, c, dd] of moves) {
    await dragMinimap(a, b, c, dd);
    await sleep(1200);
  }
  d = await diag();
  check("live fog-b three measurements spent", d?.used === 3, `used=${d?.used}`);

  // Finish early via the button (mid-budget, on purpose).
  await page.locator("#fog-finish").click();
  const t0 = Date.now();
  for (;;) {
    d = await diag();
    if (d?.reveal === 1 || Date.now() - t0 > 4000) break;
    await sleep(150);
  }
  check("live fog-b Finish fires the reveal", d?.done === true && d?.reveal === 1, JSON.stringify(d));
  const finishHidden = await page.locator("#fog-finish").isHidden();
  check("live fog-b Finish button hides when done", finishHidden === true);
}

/* ---------- 3b. taps / jitters never spend the budget (QA SEC6-F1) -------- */
// A fresh game: a no-travel tap on the ball's pixel, ten ~3px jitters and a
// tap on the caption below the canvas must each leave `used` at 0 (the cell
// snap used to turn any of them into a whole stride). A real drag still
// commits afterwards.

await page.goto(`${base}/?step=16`, { waitUntil: "load" });
if (!(await waitIdle())) check("fog-b (tap block) unlocks after entry", false, "still locked");
{
  let d = await diag();
  check("tap block: fresh Rosenbrock game", d?.level === "rb" && d?.used === 0, JSON.stringify(d));
  const box = await page.locator("#minimap-canvas").boundingBox();
  const ballPx = await page.evaluate(() => {
    // The learner point is drawn at the minimap's mapped fog point; find it
    // through the param extent the minimap draws (same plane as the canvas).
    const c = document.querySelector("#minimap-canvas").getBoundingClientRect();
    return { x: c.left + c.width / 2, y: c.top + c.height / 2 };
  });
  // 1. a tap with no movement (on the canvas)
  await page.mouse.move(ballPx.x, ballPx.y);
  await page.mouse.down();
  await page.mouse.up();
  await sleep(900);
  d = await diag();
  check("tap block: a no-travel tap spends nothing", d?.used === 0, `used=${d?.used}`);
  // 2. ten ~3px jitters
  for (let i = 0; i < 10; i++) {
    const jx = ballPx.x + (i % 2 ? 3 : -3);
    const jy = ballPx.y + (i % 3 ? 3 : -3);
    await page.mouse.move(jx, jy);
    await page.mouse.down();
    await page.mouse.move(jx + 2, jy + 2, { steps: 2 });
    await page.mouse.up();
    await sleep(80);
  }
  await sleep(900);
  d = await diag();
  check("tap block: ten 3px jitters spend nothing", d?.used === 0, `used=${d?.used}`);
  // 3. a tap on the caption below the canvas (the panel is the grab surface)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height + 14);
  await page.mouse.down();
  await page.mouse.up();
  await sleep(900);
  d = await diag();
  check("tap block: a caption tap spends nothing", d?.used === 0, `used=${d?.used}`);
  // A real drag still commits.
  await dragMinimap(12, 25, 55, 70);
  await sleep(1300);
  d = await diag();
  check("tap block: a real drag still commits one stride", d?.used === 1, `used=${d?.used}`);
}

/* ---------------- 4. the reveal screen ---------------- */

await page.locator("#rail button").nth(17).click();
await sleep(400);
{
  const a = await app();
  check("rail jump lands on fog-c", a.scene === "fog-c", JSON.stringify(a));
  check("fog-c locks during the ghost cinematic", a.locked === true || a.animating === true);
  // Let the cinematic run (reveal 1.6 s + staggered ghosts ~7.5 s).
  await sleep(9000);
  const d = await diag();
  check("fog-c keeps the finished run", d?.done === true && d?.level === "rb", JSON.stringify(d));
  check("fog-c reveal fully lifted", d?.reveal === 1);
  check("fog-c four ghosts built", d?.ghosts === 4);
  check("fog-c ghosts finished playing", d?.ghostsPlaying === false);
  check("fog-c machines reported", d?.machines?.every((m) => m.steps === 60), JSON.stringify(d?.machines));
  const rows = await page.locator("#fog-scorecard-body tr").count();
  check("fog-c scorecard has 4 rows", rows === 4, `rows=${rows}`);
  const verdict = await page.locator("#fog-verdict").textContent();
  check("fog-c verdict written", (verdict ?? "").length > 10, verdict ?? "");
  const note = await page.locator("#fog-reveal-note").getAttribute("data-visible");
  check("fog-c annotation visible", note === "true");
  const replay = await page.locator("#play-btn").isVisible();
  check("fog-c transport visible", replay === true);
  // C2-CAP-TOOLTIP: the virtual pointer is still parked on the rail tick
  // clicked above, holding the rail's own CSS hover pill (.tick-name, a
  // 0.25s opacity fade) fully opaque over the reader copy in the capture.
  // Automation pointer hygiene only — the hover pill is legitimate human
  // UI. (400,450) is an empty, hover-inert spot of the 3D canvas pane.
  await page.mouse.move(400, 450);
  await sleep(400);
  await page.screenshot({ path: resolve(outDir, "20-fog-c-live.png") });

  // Replay relaunches the ghosts.
  await page.locator("#play-btn").click();
  await sleep(700);
  const d2 = await diag();
  check("fog-c Replay relaunches the ghosts", d2?.ghostsPlaying === true, JSON.stringify(d2));
  // Same hygiene before this capture (future-proofing: the pointer would
  // otherwise park on #play-btn — clean today, but not worth re-proving).
  await page.mouse.move(400, 450);
  await sleep(400);
  await page.screenshot({ path: resolve(outDir, "21-fog-c-ghosts-mid.png") });
  await sleep(9000);
  const d3 = await diag();
  check("fog-c replay finishes cleanly", d3?.ghostsPlaying === false);

  // Skip mid-ride (QA fog-reveal-3): the finished race must read '▶ Play'
  // with a full bar, relaunch cleanly, and a later scrub must stay put.
  await page.locator("#play-btn").click();
  await sleep(3000);
  await page.evaluate(() => window.__wp1.skip());
  await sleep(400);
  const d4 = await diag();
  const label = (await page.locator("#play-btn").textContent())?.trim() ?? "";
  const scrubSkip = await page.locator("#replay-scrub").inputValue();
  check("fog-c skip finishes the ghosts", d4?.ghostsPlaying === false, JSON.stringify(d4));
  check("fog-c skipped race reads '▶ Play'", label === "▶ Play", `label="${label}"`);
  check("fog-c skipped race shows a full scrub bar", scrubSkip === "1000", `scrub=${scrubSkip}`);
  await page.locator("#play-btn").click();
  await sleep(700);
  const d5 = await diag();
  check("fog-c '▶ Play' after a skip relaunches", d5?.ghostsPlaying === true, JSON.stringify(d5));
  await page.evaluate(() => window.__wp1.skip());
  await sleep(300);
  await page.evaluate(() => {
    const s = document.querySelector("#replay-scrub");
    s.value = "700";
    s.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await sleep(300);
  const scrub700 = await page.locator("#replay-scrub").inputValue();
  check("fog-c scrub to 700 after a skip stays at 700", scrub700 === "700", `scrub=${scrub700}`);
}

/* ---------------- screenshot size sanity ---------------- */

for (const f of ["16-fog-a.png", "17-fog-b.png", "18-fog-c.png", "20-fog-c-live.png"]) {
  const kb = statSync(resolve(outDir, f)).size / 1024;
  check(`capture ${f}`, kb > 30, `${kb.toFixed(1)} KB`);
}

await browser.close();
console.log(failures === 0 ? "ALL_PASS" : `FAILURES: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
