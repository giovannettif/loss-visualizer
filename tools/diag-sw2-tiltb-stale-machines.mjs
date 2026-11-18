/**
 * diag-sw2-tiltb-stale-machines.mjs — SW2-TILTB-STALE-MACHINE-TRAILS repro:
 * coming back to tilt-b from swarm swaps in the curated Rosenbrock run but
 * must NOT keep the cached valley-level machine race.
 *
 * Repro (per the finding):
 *   1. Open ?step=19 (tilt-a, valley level), mouse over the reader.
 *   2. Wheel down once → tilt-b: no steered run exists, so the empty valley
 *      run is finished and graded — level "valley", machines = valley values.
 *      This FILLS the machine cache at the valley level.
 *   3. Wheel down once → swarm: tiltRun is dropped; (baseline) the machine
 *      cache survives.
 *   4. Wheel up once → tilt-b: curated Rosenbrock fallback fires —
 *      EXPECTED: level "rosen", curated, and machines recomputed on
 *      Rosenbrock (reference: a fresh ?step=21 → wheel up, where the cache
 *      was never filled — GD 3.59, momentum 1.53e-4, Adam 0.00894).
 *      BASELINE BUG: machines still hold the valley values and their trails
 *      are drawn on the Rosenbrock terrain, running off the board.
 *
 * Read-only against src/ — serves the prebuilt dist/ on a private port.
 */

import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, extname } from "node:path";

const DIST = join(process.cwd(), "dist");
const PORT = 4243;
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
    const rows = [...document.querySelectorAll("#tilt-scorecard-body tr")].map(
      (r) => r.textContent.replace(/\s+/g, " ").trim(),
    );
    return {
      step: window.__wp1.step(),
      scene: window.__wp1.scene(),
      level: t.level, hasRun: t.hasRun, done: t.done, steered: t.steered,
      curated: t.curated, steps: t.steps, ghost: t.ghost,
      machines: t.machines,
      tiltLevelLabel: document.querySelector("#tilt-level")?.textContent?.trim() ?? null,
      rows,
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

/**
 * One wheel gesture over the reader (mouse parked over #reader, per the
 * finding). The delta is sized to the distance to the adjacent step's park
 * offset (+15% margin) so one gesture crosses EXACTLY one boundary — an
 * oversized delta can be split by the browser into two gestures and skip a
 * step (observed with a blind 900px: 19→21). Refuses to continue if a
 * gesture lands anywhere but the adjacent step.
 */
async function wheelStep(dir, label) {
  const box = await page.locator("#reader").boundingBox();
  if (!box) throw new Error("no #reader box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const before = await page.evaluate(() => window.__wp1.step());
  const sc = await page.evaluate(() => window.__wp1.scroll());
  const from = sc.tops[before] ?? sc.y;
  const to = sc.tops[before + dir];
  if (to === undefined) throw new Error(`no step ${before + dir}`);
  const delta = Math.round(Math.abs(to - from) * 1.15) + 40;
  await sleep(400);
  await page.mouse.wheel(0, dir * delta);
  await sleep(400);
  // wait for the glide to settle on the parked offset
  for (let i = 0; i < 30; i++) {
    const s = await page.evaluate(() => window.__wp1.scroll());
    if (Math.abs(s.y - s.target) < 2 && s.atSnap) break;
    await sleep(200);
  }
  await waitIdle();
  await sleep(300);
  const after = await page.evaluate(() => window.__wp1.step());
  if (after !== before + dir) {
    throw new Error(
      `${label}: wheel gesture advanced ${before}→${after} (wanted ${before + dir}) — delta ${delta}px`,
    );
  }
  return after;
}

const machBrief = (m) =>
  m ? m.map((x) => `${x.label}:${x.steps}st,${x.finalLoss.toExponential(2)},r=${x.reached ? 1 : 0}`) : null;

/* ---- pass A: the finding's walk (cache gets filled at valley) ---- */
await page.goto(`http://localhost:${PORT}/?step=19`, { waitUntil: "load" });
await page.waitForTimeout(800);
if (!(await waitIdle())) console.log("WARN: step 19 never went idle");
const s19 = await st();
console.log("1) fresh ?step=19:", JSON.stringify({
  step: s19.step, scene: s19.scene, level: s19.level,
  machines: machBrief(s19.machines),
}));

const d1 = await wheelStep(+1, "19→tilt-b");
const firstB = await st();
console.log(`2) wheel↓ → step ${d1}:`, JSON.stringify({
  scene: firstB.scene, level: firstB.level, curated: firstB.curated,
  steered: firstB.steered, done: firstB.done,
  machines: machBrief(firstB.machines),
  levelLabel: firstB.tiltLevelLabel,
}));
const valleyCached =
  firstB.scene === "tilt-b" && firstB.level === "valley" && firstB.machines !== null;

const d2 = await wheelStep(+1, "tilt-b→swarm");
const atSwarm = await st();
console.log(`3) wheel↓ → step ${d2} (${atSwarm.scene}) hasRun=${atSwarm.hasRun} machines=${atSwarm.machines ? "kept" : "null"}`);

const d3 = await wheelStep(-1, "swarm→tilt-b");
const backB = await st();
console.log(`4) wheel↑ → step ${d3}:`, JSON.stringify({
  scene: backB.scene, level: backB.level, curated: backB.curated,
  ghost: backB.ghost, levelLabel: backB.tiltLevelLabel,
  machines: machBrief(backB.machines),
  rows: backB.rows,
}));
await page.screenshot({ path: join(QA_DIR, "SW2-TILTB-back-from-swarm.png") });

/* ---- pass B: reference walk (cache never filled before tilt-b) ---- */
await page.goto(`http://localhost:${PORT}/?step=21`, { waitUntil: "load" });
await page.waitForTimeout(800);
if (!(await waitIdle())) console.log("WARN: step 21 never went idle");
const refStep = await wheelStep(-1, "21→tilt-b (reference)");
const refB = await st();
console.log(`5) reference: fresh ?step=21 wheel↑ → step ${refStep}:`, JSON.stringify({
  scene: refB.scene, level: refB.level, curated: refB.curated, ghost: refB.ghost,
  machines: machBrief(refB.machines),
  rows: refB.rows,
}));
await page.screenshot({ path: join(QA_DIR, "SW2-TILTB-reference-fresh.png") });

/* ---- verdict ---- */
const sameMach =
  JSON.stringify(backB.machines) === JSON.stringify(refB.machines);
const levelOK =
  backB.scene === "tilt-b" && backB.level === "rosen" && backB.curated === true;
const check = levelOK && sameMach;
console.log("=== VERDICT ===");
console.log(JSON.stringify({
  firstTiltBValleyCacheFilled: valleyCached,
  backLevelRosenCurated: levelOK,
  backMachinesMatchFreshReference: sameMach,
  backMachines: backB.machines && backB.machines.map((m) => ({ label: m.label, steps: m.steps, finalLoss: m.finalLoss })),
  refMachines: refB.machines && refB.machines.map((m) => ({ label: m.label, steps: m.steps, finalLoss: m.finalLoss })),
}, null, 2));
console.log(check
  ? "RESULT: PASS — tilt-b after swarm shows Rosenbrock machines"
  : "RESULT: FAIL — stale valley machine cache survived the swarm");

await browser.close();
srv.close();
