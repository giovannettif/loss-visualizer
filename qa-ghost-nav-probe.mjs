/**
 * qa-ghost-nav-probe.mjs — reproduce regression 1 (ghost button advances the
 * reader) against the CURRENT dist, both ways the user could hit it:
 *
 *   A. Tour playing (the reported repro): ?step=18, start the s7 tour,
 *      release the steering gate, Next×2 to the tilt-b ghost step
 *      (gate ghostReplay armed), click #tilt-replay-play, then compare the
 *      reader step + tour state before/after.
 *
 *   B. Free play: ?step=20 (no tour), click #tilt-replay-play, compare the
 *      reader step before/after.
 *
 * PASS (post-fix): in A the reader step must stay 20 and the tour must stay
 * on stepIndex 3 after the click; in B the reader step must stay 20.
 */

import { chromium } from "playwright";
import { launchGL } from "./tools/gl-launch.mjs";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";

const DIST = join(process.cwd(), "dist");
const PORT = 4213;
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

async function state() {
  return page.evaluate(() => ({
    scene: window.__wp1?.scene?.(),
    step: window.__wp1?.step?.(),
    locked: window.__wp1?.locked?.(),
    animating: window.__wp1?.animating?.(),
    tour: window.__wp1?.tour?.(),
  }));
}
async function waitIdle(maxMs = 25000) {
  const t0 = Date.now();
  for (;;) {
    const a = await state();
    if (!a.locked && !a.animating) return true;
    if (Date.now() - t0 > maxMs) return false;
    await sleep(200);
  }
}
async function waitTour(pred, maxMs = 30000, label = "tour") {
  const t0 = Date.now();
  for (;;) {
    const a = await state();
    if (a.tour && pred(a.tour)) return a;
    if (Date.now() - t0 > maxMs) {
      console.log(`  (timeout waiting for ${label}: ${JSON.stringify(a.tour)})`);
      return a;
    }
    await sleep(120);
  }
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

/* ---------------- A. the tour repro ---------------- */

await page.goto(`http://localhost:${PORT}/?step=18`, { waitUntil: "load" });
await sleep(1600);
await waitIdle();
await page.locator('.rstep[data-active="true"] .tour-launch').click();
await waitTour((s) => s.phase === "active" && s.stepIndex === 0, 12000, "s7 start");
// Release the steering gate with a real WASD press.
await page.keyboard.down("a");
await sleep(300);
await page.keyboard.up("a");
await waitTour((s) => s.phase === "active" && s.stepIndex === 1, 12000, "steer release");
await page.locator("#tour-next").click(); // → Rosenbrock beat (page 19)
await waitTour((s) => s.phase === "active" && s.stepIndex === 2, 15000, "next 1");
await page.locator("#tour-next").click(); // → the ghost sentence (page 20 — no gate since REG-1-GHOST-NO-GATE)
const atGate = await waitTour((s) => s.phase === "active" && s.stepIndex === 3, 15000, "ghost sentence");
check("A: arrived at the ghost sentence on tilt-b (step 20, no gate)", atGate?.step === 20 && atGate?.tour.stepIndex === 3 && atGate?.tour.gate === false, JSON.stringify(atGate));

const before = await state();
await page.click("#tilt-replay-play");
await sleep(800); // one gate poll is 140ms; 800ms is ≥5 polls
const after = await state();
console.log("A before:", JSON.stringify({ step: before.step, tour: { idx: before.tour.stepIndex, gate: before.tour.gate, page: before.tour.page } }));
console.log("A after: ", JSON.stringify({ step: after.step, tour: { idx: after.tour.stepIndex, gate: after.tour.gate, page: after.tour.page } }));
check(
  "A (tour): ghost click keeps the reader on tilt-b (step 20)",
  after.step === 20,
  `before=${before.step} after=${after.step}`,
);
check(
  "A (tour): ghost click leaves the tour state untouched (still stepIndex 3, sentence still marked, no gate)",
  after.tour.stepIndex === 3 && after.tour.running && after.tour.sentenceActive === true && after.tour.gate === false && after.tour.gateKind === null,
  JSON.stringify(after.tour),
);
const ghostState = await page.evaluate(() => window.__wp1?.tilt?.());
check("A (tour): the ghost ride itself STARTED (scrubPlaying)", ghostState?.scrubPlaying === true, JSON.stringify({ scrubPlaying: ghostState?.scrubPlaying }));
await page.keyboard.press("Escape");
await sleep(400);

/* ---------------- B. free play ---------------- */

await page.goto(`http://localhost:${PORT}/?step=20`, { waitUntil: "load" });
await sleep(1600);
await waitIdle();
const bBefore = await state();
const replayVisible = await page.locator("#tilt-replay").isVisible();
console.log("B: #tilt-replay visible =", replayVisible);
if (replayVisible) {
  await page.click("#tilt-replay-play");
  await sleep(600);
  const bAfter = await state();
  console.log("B before:", JSON.stringify({ step: bBefore.step }), "after:", JSON.stringify({ step: bAfter.step }));
  check("B (free play): ghost click keeps the reader on tilt-b (step 20)", bAfter.step === 20, `before=${bBefore.step} after=${bAfter.step}`);
} else {
  console.log("B: ghost row hidden at boot (no run yet) — reader-step invariance vacuously holds");
}

await browser.close();
srv.close();
console.log(failures === 0 ? "PROBE_PASS (no navigation)" : `PROBE_REPRO/FAILURES: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
