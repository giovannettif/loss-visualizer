/**
 * diag-s7-sw2-swarmback.mjs — S7-SW2-SWARM-BACK-LOSES-RUN reproduction:
 * after the player plays tilt-a, stepping forward to the swarm and BACK to
 * the tilt-b scorecard must restore THEIR run, not the curated Rosenbrock
 * demo.
 *
 * Repro (per the finding):
 *   1. Open ?step=18 (tilt-a level 1). Click the canvas, hold S 900 ms,
 *      click Finish — a real steered run.
 *   2. ArrowDown ×3 (18→19 same-scene, 19→20 tilt-b scorecard, 20→21 swarm).
 *      tilt-b first visit must grade the player's run: row "you (tilt)",
 *      verdict "You stopped after N steps…".
 *   3. ArrowUp back to 20: the scorecard must STILL be the player's run —
 *      steered=true, curated=false, same level, same row numbers, same
 *      verdict — never curated=true + "You never tilted the board…".
 *   4. Bonus: a second swarm round-trip (20→21→20) must also restore.
 *
 * Read-only against src/ — serves the prebuilt dist/ on a private port.
 */

import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, extname } from "node:path";

const DIST = join(process.cwd(), "dist");
const PORT = 4231;
const QA_DIR = join(process.cwd(), "qa");
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff",
};

const srv = createServer((req, res) => {
  let p = req.url.split("?")[0];
  if (p === "/" || p === "") p = "/index.html";
  const file = join(DIST, p);
  if (!existsSync(file)) { res.writeHead(404).end("no"); return; }
  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => srv.listen(PORT, () => r(srv)));
console.log(`serving dist on :${PORT}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(QA_DIR, { recursive: true });

const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

const st = () =>
  page.evaluate(() => {
    const t = window.__wp1.tilt();
    const row = document.querySelector("#tilt-scorecard-body tr");
    return {
      step: window.__wp1.step(),
      scene: window.__wp1.scene(),
      locked: window.__wp1.locked(),
      animating: window.__wp1.animating(),
      level: t.level, hasRun: t.hasRun, done: t.done, steered: t.steered,
      curated: t.curated, steps: t.steps, cells: t.cells,
      pos: t.pos ? { x: +t.pos.x.toFixed(2), y: +t.pos.y.toFixed(2) } : null,
      machines: t.machines ? t.machines.length : null,
      scoreHidden: document.querySelector("#tilt-score")?.hidden ?? null,
      firstRow: row ? row.textContent.replace(/\s+/g, " ").trim() : null,
      tiltLevelLabel: document.querySelector("#tilt-level")?.textContent?.trim() ?? null,
      verdict: document.querySelector("#tilt-verdict")?.textContent?.trim() ?? null,
    };
  });

async function waitIdle(maxMs = 15000) {
  const t0 = Date.now();
  for (;;) {
    const a = await page.evaluate(() => ({
      locked: window.__wp1.locked(), animating: window.__wp1.animating(),
    }));
    if (!a.locked && !a.animating) return true;
    if (Date.now() - t0 > maxMs) return false;
    await sleep(250);
  }
}

async function stepKey(key) {
  await page.keyboard.press(key);
  await sleep(400);
  const ok = await waitIdle();
  await sleep(300);
  return ok;
}

const snap = async (name) => {
  await page.screenshot({ path: join(QA_DIR, name) });
};

/* ---- 1: play a real run at ?step=18 ---- */
await page.goto(`http://localhost:${PORT}/?step=18`, { waitUntil: "load" });
await page.waitForTimeout(800);
if (!(await waitIdle())) console.log("WARN: step 18 never went idle");
const s18 = await st();
console.log("1) fresh ?step=18:", JSON.stringify(s18));

await page.click("canvas");
await page.keyboard.down("s");
await sleep(900);
await page.keyboard.up("s");
await sleep(400);
const played = await st();
console.log("2) after S 900ms:", JSON.stringify({
  step: played.step, scene: played.scene, steered: played.steered,
  steps: played.steps, cells: played.cells, pos: played.pos,
}));
const steerOK = played.steered === true && played.steps > 0;

await page.click("#tilt-finish");
await sleep(400);
if (!(await waitIdle())) console.log("WARN: post-finish never went idle");
const fin = await st();
console.log("3) after Finish:", JSON.stringify({
  step: fin.step, done: fin.done, steered: fin.steered, steps: fin.steps, cells: fin.cells,
}));
const finOK = fin.done === true && fin.steered === true;

/* ---- 2: ArrowDown one at a time, capturing after each ---- */
const perStep = [];
for (let i = 0; i < 3; i++) {
  await stepKey("ArrowDown");
  const s = await st();
  perStep.push(s);
  console.log(`4${i}) ArrowDown → step ${s.step} (${s.scene}) steered=${s.steered} curated=${s.curated} row=${JSON.stringify(s.firstRow)}`);
}
const first20 = perStep[1]; // step 20 = tilt-b scorecard, first visit
console.log("5) tilt-b FIRST VISIT (step 20):", JSON.stringify(first20));
await snap("S7-SW2-first-visit.png");
const firstOK =
  first20.step === 20 && first20.scene === "tilt-b" &&
  first20.steered === true && first20.curated === false &&
  (first20.firstRow ?? "").startsWith("you (tilt)");

/* ---- 3: into swarm, then BACK to tilt-b ---- */
const swarm = perStep[2]; // step 21 = swarm
console.log("6) swarm (step 21):", JSON.stringify({
  step: swarm.step, scene: swarm.scene, hasRun: swarm.hasRun, level: swarm.level,
}));
const atSwarmOK = swarm.step === 21 && swarm.scene === "swarm";

await stepKey("ArrowUp");
const back1 = await st();
console.log("7) tilt-b AFTER swarm round-trip:", JSON.stringify(back1));
await snap("S7-SW2-back-from-swarm.png");

const sameNumbers =
  back1.steps === first20.steps && back1.cells === first20.cells &&
  JSON.stringify(back1.pos) === JSON.stringify(first20.pos);
const verdictOK =
  (back1.verdict ?? "").startsWith("You stopped after") ||
  (back1.verdict ?? "").includes("You stopped after");
const pass1 =
  back1.step === 20 && back1.scene === "tilt-b" &&
  back1.steered === true && back1.curated === false &&
  (back1.firstRow ?? "").startsWith("you (tilt)") &&
  sameNumbers && verdictOK && back1.level === first20.level;

console.log("8) CHECK return1 = player's run:", JSON.stringify({
  pass: pass1, steered: back1.steered, curated: back1.curated,
  sameNumbers, verdictOK, level: back1.level, firstRow: back1.firstRow,
  verdict: back1.verdict,
}));

/* ---- 4: bonus — a SECOND swarm round-trip ---- */
await stepKey("ArrowDown");
const swarm2 = await st();
await stepKey("ArrowUp");
const back2 = await st();
const pass2 =
  back2.step === 20 && back2.steered === true && back2.curated === false &&
  (back2.firstRow ?? "").startsWith("you (tilt)") &&
  back2.steps === first20.steps;
console.log("9) CHECK return2 (second round-trip):", JSON.stringify({
  pass: pass2, swarmStep: swarm2.step, steered: back2.steered,
  curated: back2.curated, firstRow: back2.firstRow, steps: back2.steps,
}));

console.log("=== VERDICT ===");
console.log("steered run at 18:", steerOK, "| finished:", finOK,
  "| first tilt-b grades player:", firstOK, "| reached swarm:", atSwarmOK,
  "| return1 restored:", pass1, "| return2 restored:", pass2);
console.log(pass1 && pass2 ? "RESULT: PASS — session run survives the swarm" : "RESULT: FAIL — run lost / curated fallback fired");

await browser.close();
srv.close();
