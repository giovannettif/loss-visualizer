/**
 * diag-sw2-taskc-wheelflow.mjs — the finding's SECOND repro path for
 * SW2-LW24-TASKC-POINT-UNDER-LOSSPANEL-1280: reach task-c by REAL wheel
 * input over the reader (start ?step=2 = task-b, wheel forward), then probe
 * ball-vs-#loss-panel and draggability at 1280x800. Mirrors
 * qa/sweep2-layout-wide-24/flow.mjs. Serves freshly built dist/ on 4292.
 */

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname, resolve } from "node:path";

const DIST = join(process.cwd(), "dist");
const PORT = 4292;
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

const [W, H] = [1280, 800];
const browser = await chromium.launch();
const page = await browser.newPage();
page.setViewportSize({ width: W, height: H });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

await page.goto(`http://localhost:${PORT}/?step=2`, { waitUntil: "load" });
await page.waitForFunction(() => !!window.__wp1, null, { timeout: 20000 });
await sleep(900);
// Drain any lock on task-b.
for (let i = 0; i < 6; i++) {
  const l = await page.evaluate(() => window.__wp1.locked() || window.__wp1.animating());
  if (!l) break;
  await page.locator("#skip-btn:visible").click({ timeout: 1500 }).catch(() => {});
  await sleep(700);
}
console.log("at step", await page.evaluate(() => window.__wp1.step()), "scene", await page.evaluate(() => window.__wp1.scene()));

// REAL wheel over the reader -> advance to step 3 (task-c).
await page.mouse.move(W - 300, H / 2);
await sleep(300);
for (let i = 0; i < 12; i++) {
  const s = await page.evaluate(() => window.__wp1.step());
  if (s >= 3) break;
  await page.mouse.wheel(0, 240);
  await sleep(450);
  // Skip the incoming step's lock like the finding's flow does.
  const l = await page.evaluate(() => window.__wp1.locked() || window.__wp1.animating());
  if (l) { await page.locator("#skip-btn:visible").click({ timeout: 1200 }).catch(() => {}); await sleep(600); }
}
// __wp1Locked isn't a thing; re-read plainly.
const stepNow = await page.evaluate(() => ({ step: window.__wp1.step(), scene: window.__wp1.scene(), locked: window.__wp1.locked(), animating: window.__wp1.animating() }));
console.log("after wheel:", JSON.stringify(stepNow));
for (let i = 0; i < 6; i++) {
  const l = await page.evaluate(() => window.__wp1.locked() || window.__wp1.animating());
  if (!l) break;
  await page.locator("#skip-btn:visible").click({ timeout: 1500 }).catch(() => {});
  await sleep(700);
}
await page.mouse.move(W / 3, H - 5); // park the cursor off the reader
await sleep(1500);

const r = await page.evaluate(() => {
  const ball = window.__wp1.ballScreen();
  const panels = [];
  for (const el of document.querySelectorAll(".hud.panel")) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) < 0.05) continue;
    const b = el.getBoundingClientRect();
    if (b.width < 2) continue;
    panels.push({ id: el.id, l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom) });
  }
  const underEl = ball ? document.elementFromPoint(ball.x, ball.y) : null;
  const f = window.__wp1.fit();
  return {
    step: window.__wp1.step(),
    scene: window.__wp1.scene(),
    ball: ball ? [Math.round(ball.x), Math.round(ball.y)] : null,
    under: !ball ? "no-ball" : underEl ? (underEl.closest(".hud.panel")?.id ?? underEl.id ?? underEl.tagName) : "none",
    panels,
    fit: { w: +f.w.toFixed(3), b: +f.b.toFixed(3) },
    loss: +window.__wp1.loss().toFixed(3),
  };
});
console.log("wheel-flow result:", JSON.stringify(r));
const inside = r.ball && r.panels.some((p) => r.ball[0] > p.l && r.ball[0] < p.r && r.ball[1] > p.t && r.ball[1] < p.b);
console.log("ball inside a visible panel:", inside);

// Drag probe from wherever the ball is.
if (r.ball) {
  const before = r.fit;
  await page.mouse.move(r.ball[0], r.ball[1]);
  await page.mouse.down();
  await page.mouse.move(r.ball[0] + 60, r.ball[1] + 30, { steps: 20 });
  await sleep(80);
  await page.mouse.up();
  await sleep(400);
  const f = await page.evaluate(() => { const q = window.__wp1.fit(); return { w: +q.w.toFixed(3), b: +q.b.toFixed(3) }; });
  console.log(`drag: ${before.w},${before.b} -> ${f.w},${f.b} moved=${Math.abs(f.w - before.w) + Math.abs(f.b - before.b) > 0.02}`);
}
await page.screenshot({ path: resolve("shots/_diag_sw2_taskc/wheelflow-1280-task-c.png") });
await browser.close();
srv.close();
console.log("done");
