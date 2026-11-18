/**
 * diag-s1-hud-residual.mjs — residual paths for S1-BALL-UNDER-HUD after Fix A/B.
 *
 * 1. ORBIT: at 900x700 ?step=3, right-drag orbits (left is pan/ball). Swing
 *    azimuth several ways, settle after each, check whether the ball ends
 *    under a HUD panel with no nudge recompute (hudNudgeDirty is only set on
 *    scene change / resize, never on user orbit).
 * 2. DRAG-UNDER-PANEL: at 1440x900, grab the ball and drag it left into the
 *    #fit-panel rect, release; then try to grab it again at its center.
 *
 * Read-only against src/ — serves dist/ on 4286.
 */

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, extname, resolve } from "node:path";

const DIST = join(process.cwd(), "dist");
const PORT = 4286;
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

const OUT = resolve("shots/_diag_s1_hud");
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readState(page) {
  return page.evaluate(() => {
    const ball = window.__wp1.ballScreen();
    const under = ball
      ? (() => {
          const el = document.elementFromPoint(ball.x, ball.y);
          if (!el) return "none";
          const panel = el.closest(".hud.panel, #hud-left");
          return panel ? panel.id ?? panel.className : el.id || el.tagName;
        })()
      : "no-ball";
    const f = window.__wp1.fit();
    return {
      ball: ball ? { x: +ball.x.toFixed(1), y: +ball.y.toFixed(1) } : null,
      under,
      fit: { w: +f.w.toFixed(3), b: +f.b.toFixed(3) },
      locked: window.__wp1.locked(),
      animating: window.__wp1.animating(),
    };
  });
}

async function settle(page, cap = 15000) {
  const t0 = Date.now();
  for (;;) {
    await sleep(250);
    const st = await page.evaluate(() => ({
      locked: window.__wp1.locked(),
      animating: window.__wp1.animating(),
      gesturing: document.querySelector(".lv-canvas")?.dataset.gesturing === "true",
    }));
    if (!st.locked && !st.animating) {
      const a = await readState(page);
      await sleep(700);
      const b = await readState(page);
      if (a.ball && b.ball && Math.hypot(a.ball.x - b.ball.x, a.ball.y - b.ball.y) < 0.5) return b;
    }
    if (Date.now() - t0 > cap) return readState(page);
  }
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto(`http://localhost:${PORT}/?step=3`, { waitUntil: "load" });
const st0 = await settle(page);
console.log(`base: ball=(${st0.ball?.x},${st0.ball?.y}) under="${st0.under}" fit=(${st0.fit.w},${st0.fit.b})`);

const cv = await page.evaluate(() => {
  const r = document.querySelector(".lv-canvas").getBoundingClientRect();
  return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
});

/* ---- 1. orbit swings (right-drag) ---- */
const swings = [
  [-260, 0, "azim-left"],
  [260, 0, "azim-right"],
  [-200, -120, "azim-up"],
  [0, -160, "vert-up"],
  [-160, 60, "diag"],
];
for (const [dx, dy, tag] of swings) {
  await page.mouse.move(cv.cx, cv.cy, { button: "right" });
  await page.mouse.down({ button: "right" });
  // drag in chunks so pointermove events fire
  for (let s = 1; s <= 6; s++) {
    await page.mouse.move(cv.cx + (dx * s) / 6, cv.cy + (dy * s) / 6, { button: "right" });
    await sleep(30);
  }
  await page.mouse.up({ button: "right" });
  const end = await settle(page);
  console.log(`orbit ${tag} (${dx},${dy}): ball=(${end.ball?.x},${end.ball?.y}) under="${end.under}" ` +
    `fit=(${end.fit.w},${end.fit.b})`);
  await page.screenshot({ path: join(OUT, `orbit-${tag}.png`) });
}

/* ---- 2. deliberate drag under the fit panel, release, re-grab ---- */
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(`http://localhost:${PORT}/?step=3`, { waitUntil: "load" });
const st1 = await settle(page);
const fp = await page.evaluate(() => {
  const r = document.querySelector("#fit-panel").getBoundingClientRect();
  return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 };
});
console.log(`drag-under: start ball=(${st1.ball?.x},${st1.ball?.y}) panel center=(${fp.x},${fp.y})`);
await page.mouse.move(st1.ball.x, st1.ball.y);
await page.mouse.down();
for (let s = 1; s <= 8; s++) {
  const gx = st1.ball.x + ((fp.x - st1.ball.x) * s) / 8;
  const gy = st1.ball.y + ((fp.y - st1.ball.y) * s) / 8;
  await page.mouse.move(gx, gy);
  await sleep(30);
}
const during = await readState(page);
await page.mouse.up();
await sleep(400);
const after = await readState(page);
console.log(`drag-under: during ball=(${during.ball?.x},${during.ball?.y}) under="${during.under}" ` +
  `fit=(${during.fit.w},${during.fit.b})`);
console.log(`drag-under: released ball=(${after.ball?.x},${after.ball?.y}) under="${after.under}" ` +
  `fit=(${after.fit.w},${after.fit.b})`);
// try to re-grab at the ball center: does the pointerdown reach the canvas?
const regrab = await page.evaluate(() => {
  const b = window.__wp1.ballScreen();
  if (!b) return { hit: "no-ball" };
  const el = document.elementFromPoint(b.x, b.y);
  return { hit: el?.id || el?.tagName, isCanvas: el?.classList?.contains("lv-canvas") === true };
});
console.log(`drag-under: re-grab probe at ball center -> ${JSON.stringify(regrab)}`);
await page.screenshot({ path: join(OUT, "drag-under-panel.png") });

await browser.close();
srv.close();
console.log("done");
