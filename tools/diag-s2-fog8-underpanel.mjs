/**
 * diag-s2-fog8-underpanel.mjs — S2-FOG8-BALL-UNDER-FIT-INSET live re-check.
 *
 * The finding: on fog level 1 (?step=15), dragging the compass toward high b
 * (target corner w=-1, b=5) carries the ball + freshly painted terrain under
 * the opaque #fit-panel; at 1600x900 the finder measured the ball at
 * (313,353) after stride 2 and (242,263) after stride 3, both inside
 * #fit-panel (14..356 x 62..384); at 1280x720 / 1366x768 already from
 * stride 1, at 1920x1080 from stride 3.
 *
 * This script replays the EXACT repro on the current tree (which already
 * carries a `computeFogPlayNudge` play-time framing fix in director.ts):
 *   1. land on ?step=15 (fog-a, LS level), wait for the reader to unlock;
 *   2. three compass drags: press at the ball's minimap pixel, drag through
 *      the (w=-1, b=5) extent corner, release — settle after each stride;
 *   3. per stride: log fog point, ballScreen, #fit-panel rect, all visible
 *      HUD panel rects, containment (center, and center + 24px disc);
 *      screenshot.
 *
 * Read-only against src/ — serves dist/ on :4195.
 * Evidence: qa/S2-FOG8-BALL-UNDER-FIT-INSET/
 */

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, extname, resolve } from "node:path";

const DIST = join(process.cwd(), "dist");
const PORT = 4195;
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

const OUT = resolve("qa/S2-FOG8-BALL-UNDER-FIT-INSET");
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function settleIdle(page) {
  for (let i = 0; i < 80; i++) {
    const a = await page.evaluate(() => ({
      locked: window.__wp1.locked(),
      animating: window.__wp1.animating(),
    }));
    if (!a.locked && !a.animating) break;
    await sleep(250);
  }
}

/**
 * Compass px mapping — the inverse of CompassMinimap.pointerToParam
 * (src/view/CompassMinimap.ts:307): PAD=18, PAD_BOTTOM=27 (AXIS_GAP 5 +
 * 9px ticks + 2 + 11px letter), equal-aspect plane fit, extent from
 * leastSquares = (-1..3, -3..5) (src/core/functions.ts:280).
 */
function compassMapper(mm) {
  const PAD = 18, PADB = 27;
  const iw = mm.w - PAD - 8, ih = mm.h - PAD - PADB;
  const s = Math.min(iw / 4, ih / 8);
  const x0 = PAD + (iw - 4 * s) / 2, y0 = PAD + (ih - 8 * s) / 2;
  return (p) => ({ x: mm.x + x0 + (p.x + 1) * s, y: mm.y + y0 + (5 - p.y) * s });
}

const browser = await chromium.launch();
const TARGET = { x: -1, y: 5 }; // the finder's drag target: the top-left extent corner
const summary = [];

for (const [W, H] of [[1600, 900], [1280, 720], [1366, 768], [1920, 1080]]) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  await page.goto(`http://localhost:${PORT}/?step=15`, { waitUntil: "load" });
  await settleIdle(page);
  await sleep(600);

  const mmBox = await page.locator("#minimap-canvas").boundingBox();
  const mm = { x: mmBox.x, y: mmBox.y, w: mmBox.width, h: mmBox.height };
  const map = compassMapper(mm);
  const tipPx = map(TARGET);

  const snap = async (tag) => {
    const d = await page.evaluate(() => {
      const fit = document.querySelector("#fit-panel").getBoundingClientRect();
      const panels = [...document.querySelectorAll('#stage-wrap .hud.panel[data-visible="true"]')].map(
        (el) => ({ id: el.id, l: Math.round(el.getBoundingClientRect().left), t: Math.round(el.getBoundingClientRect().top), r: Math.round(el.getBoundingClientRect().right), b: Math.round(el.getBoundingClientRect().bottom) }),
      );
      const ball = window.__wp1.ballScreen();
      const f = window.__wp1.fog();
      const inside = ball && ball.x >= fit.left && ball.x <= fit.right && ball.y >= fit.top && ball.y <= fit.bottom;
      // center + a 24px landing-disc margin (computeFogPlayNudge's rPx floor)
      const near = (v, lo, hi, m) => v - m < lo || v + m > hi;
      const discOverlap = ball && !(ball.x + 24 < fit.left || ball.x - 24 > fit.right || ball.y + 24 < fit.top || ball.y - 24 > fit.bottom);
      const readouts = { w: document.querySelector("#ro-w")?.textContent, b: document.querySelector("#ro-b")?.textContent };
      return {
        scene: window.__wp1.scene(),
        fogPoint: f.point,
        used: f.used,
        done: f.done,
        ball,
        fit: { l: Math.round(fit.left), t: Math.round(fit.top), r: Math.round(fit.right), b: Math.round(fit.bottom) },
        insidePanel: !!inside,
        disc24Overlap: !!discOverlap,
        panels,
        readouts,
      };
    });
    console.log(JSON.stringify({ tag, ...d }));
    await page.screenshot({ path: join(OUT, `${W}x${H}-${tag}.png`) });
    return d;
  };

  const s0 = await snap("stride0");
  summary.push({ vp: `${W}x${H}`, s0 });
  for (let i = 1; i <= 3; i++) {
    const st = await page.evaluate(() => window.__wp1.fog().point);
    const fromPx = map(st);
    await page.mouse.move(fromPx.x, fromPx.y);
    await page.mouse.down();
    await page.mouse.move(tipPx.x, tipPx.y, { steps: 8 });
    await page.mouse.up();
    await settleIdle(page);
    await sleep(1200); // the play-nudge tween runs 0.9s after the walk lands
    const d = await snap(`stride${i}`);
    summary.push({ vp: `${W}x${H}`, stride: i, ...d });
  }
  await page.close();
}

await browser.close();
srv.close();

console.log("\n=== SUMMARY (ball hidden by #fit-panel?) ===");
for (const r of summary) {
  const tag = r.s0 ? "entry" : `stride ${r.stride}`;
  console.log(
    `${r.vp} ${tag}: ball=(${r.s0 ? r.s0.ball?.x.toFixed(0) : r.ball?.x.toFixed(0)},${r.s0 ? r.s0.ball?.y.toFixed(0) : r.ball?.y.toFixed(0)})` +
      ` point=(${(r.s0 ? r.s0.fogPoint.x : r.fogPoint.x).toFixed(2)},${(r.s0 ? r.s0.fogPoint.y : r.fogPoint.y).toFixed(2)})` +
      ` inside=${r.s0 ? r.s0.insidePanel : r.insidePanel} disc24=${r.s0 ? r.s0.disc24Overlap : r.disc24Overlap}` +
      ` fit=${JSON.stringify(r.s0 ? r.s0.fit : r.fit)}`,
  );
}
