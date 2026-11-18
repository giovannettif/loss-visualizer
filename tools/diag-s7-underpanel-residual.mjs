/**
 * diag-s7-underpanel-residual.mjs — S7-BALL-UNDER-PANEL residual edges.
 *
 * The main repro (diag-tiltball-panel.mjs) shows the finding's named
 * viewports (1280x800 / 1366x768 / 1440x900 / 1600x900 / 1920x1080) all
 * CLEAR on the current tree. This probe covers the edges the repro left
 * open:
 *  A. SHORTER/NARROWER laptop-class viewports (1280x720, 1366x640,
 *     1024x768, 1280x600): tiltFrameDropPx caps at 120px — does each
 *     level's start still clear #tilt-panel?
 *  B. AFTER-FINISH scorecard expansion (1280x800, 1366x768): the finding
 *     notes the panel grows to ~y770 once the scorecard opens — where do
 *     the ball and the panel land then?
 *
 * Read-only against src/ — serves dist/ on 4187.
 */

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, extname, resolve } from "node:path";

const DIST = join(process.cwd(), "dist");
const PORT = 4197;
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

const OUT = resolve("shots/_diag_s7_residual");
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LEVELS = ["valley", "rosen", "rastr"];
const SHORT_VPS = [
  [1280, 800], // finding's worst case — re-verify with the settled read
  [1366, 768], // finding's second case — re-verify with the settled read
  [1440, 900], // finding's marginal case — re-verify with the settled read
  [1280, 720],
  [1366, 640], // 1366x768 laptop minus browser chrome
  [1024, 768],
  [1280, 600],
];

async function settleIdle(page) {
  for (let i = 0; i < 40; i++) {
    const a = await page.evaluate(() => ({
      locked: window.__wp1.locked(),
      animating: window.__wp1.animating(),
    }));
    if (!a.locked && !a.animating) break;
    await sleep(250);
  }
}

/** Wait out the level-pick camera tween (0.9s; `animating` covers it) so the
 *  hudClear nudge has recomputed (it only runs when settled), then let the
 *  nudge ease land (~0.6s) before reading. */
async function settleAfterPill(page) {
  for (let i = 0; i < 24; i++) {
    if (!(await page.evaluate(() => window.__wp1.animating()))) break;
    await sleep(250);
  }
  await sleep(650);
}

async function readState(page) {
  return page.evaluate(() => {
    const panel = document.querySelector("#tilt-panel").getBoundingClientRect();
    const ball = window.__wp1.ballScreen();
    const inside = (b, r, m = 0) =>
      b !== null && b.x >= r.left - m && b.x <= r.right + m && b.y >= r.top - m && b.y <= r.bottom + m;
    const tilt = window.__wp1.tilt();
    return {
      scene: window.__wp1.scene(),
      frameX: window.__wp1.layout().frameX,
      ball,
      panel: { left: +panel.left.toFixed(1), top: +panel.top.toFixed(1), right: +panel.right.toFixed(1), bottom: +panel.bottom.toFixed(1) },
      insideStrict: ball !== null && inside(ball, panel),
      insideMargin8: ball !== null && inside(ball, panel, 8),
      tiltDone: tilt ? !!tilt.done : null,
      scoreHidden: document.querySelector("#tilt-score")?.hidden ?? null,
    };
  });
}

const browser = await chromium.launch();
const report = {};

/* ---- A: short/narrow viewports, per-level start vs panel ---- */
for (const [W, H] of SHORT_VPS) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  await page.goto(`http://localhost:${PORT}/?step=18`, { waitUntil: "load" });
  await settleIdle(page);
  await sleep(400);
  const st = {};
  for (const lv of LEVELS) {
    await page.click(`#tilt-levels button[data-level="${lv}"]`);
    await settleAfterPill(page);
    st[lv] = await readState(page);
    const b = st[lv].ball;
    console.log(`A ${W}x${H} ${lv.padEnd(7)} ball=(${b ? b.x.toFixed(0) : "null"},${b ? b.y.toFixed(0) : ""}) panelBottom=${st[lv].panel.bottom} insideStrict=${st[lv].insideStrict} insideMargin8=${st[lv].insideMargin8}`);
  }
  report[`short_${W}x${H}`] = st;
  await page.screenshot({ path: join(OUT, `short-valley-${W}x${H}.png`) });
  await page.close();
}

/* ---- B: after-finish scorecard expansion ---- */
for (const [W, H] of [[1280, 800], [1366, 768]]) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  await page.goto(`http://localhost:${PORT}/?step=18`, { waitUntil: "load" });
  await settleIdle(page);
  await sleep(400);
  await page.click('#tilt-levels button[data-level="valley"]');
  await sleep(500);
  // start + steer: hold Right ~1.4s (run goes live), then release and let
  // the near-still cue accumulate (TILT_CUE_AFTER_SEC = 3s) → Finish pulses.
  await page.keyboard.down("ArrowRight");
  await sleep(1400);
  await page.keyboard.up("ArrowRight");
  await sleep(3800);
  const finishVisible = await page.evaluate(() => {
    const b = document.querySelector("#tilt-finish");
    return !b.hidden && b.dataset.cue === "pulse";
  });
  if (finishVisible) await page.click("#tilt-finish");
  await sleep(900); // scorecard + scorecard-flip transition
  const st = await readState(page);
  report[`afterFinish_${W}x${H}`] = { finishVisible, ...st };
  const b = st.ball;
  console.log(`B ${W}x${H} afterFinish finishVisible=${finishVisible} tiltDone=${st.tiltDone} scoreHidden=${st.scoreHidden} ball=(${b ? b.x.toFixed(0) : "null"},${b ? b.y.toFixed(0) : ""}) panelBottom=${st.panel.bottom} insideStrict=${st.insideStrict}`);
  await page.screenshot({ path: join(OUT, `afterfinish-valley-${W}x${H}.png`) });
  await page.close();
}

await browser.close();
srv.close();
console.log("\nREPORT " + JSON.stringify(report, null, 1));
