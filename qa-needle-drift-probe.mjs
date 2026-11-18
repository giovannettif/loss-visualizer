/**
 * qa-needle-drift-probe.mjs — BEFORE-proof for the "needle" anchor bug.
 *
 * The compass's needle spotlight halo is drawn at the LEARNER POINT's live
 * compass position (CompassMinimap.draw, `this.px/this.py`), while the hover
 * arrow anchors at the FIXED panel fraction (42% width, 50% height of
 * #minimap-panel — director.lookScreenPoint case "needle"). The task scenes
 * drift the learner point across the whole plane (DRIFT_PERIOD = 12s), so
 * the arrow and the halo separate whenever the point is not near the panel
 * midpoint.
 *
 * Probe: ?step=2 (task-b), hover the needle sentence, then for ~13s sample
 * every 900ms: (a) the anchor from lookPoint("needle"), (b) the white
 * learner dot's position found by scanning #minimap-canvas pixels for the
 * brightest near-white cluster. Report anchor↔dot distance over time.
 * Wrongness = the distance swinging to tens of px while the dot moves and
 * the anchor never does.
 */

import { chromium } from "playwright";
import { launchGL } from "./tools/gl-launch.mjs";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";

const DIST = join(process.cwd(), "dist");
const PORT = 4219;
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

async function waitIdle(maxMs = 25000) {
  const t0 = Date.now();
  for (;;) {
    const a = await page.evaluate(() => ({
      locked: window.__wp1?.locked?.(),
      animating: window.__wp1?.animating?.(),
    }));
    if (!a.locked && !a.animating) return true;
    if (Date.now() - t0 > maxMs) return false;
    await sleep(200);
  }
}

await page.goto(`http://localhost:${PORT}/?step=2`, { waitUntil: "load" });
await sleep(1500);
await waitIdle();
await page.hover('.rstep[data-active="true"] .sent[data-slook="needle"]');
await sleep(500);

const samples = [];
for (let i = 0; i < 14; i++) {
  const s = await page.evaluate(() => {
    const anchor = window.__wp1?.lookPoint?.("needle");
    const cv = document.querySelector("#minimap-canvas");
    const r = cv.getBoundingClientRect();
    // Scan the canvas for the learner dot: a ≥4px cluster of NEAR-PURE-WHITE
    // pixels (≥240/channel). Tick/axis labels are ~rgba(154,164,178) gray —
    // well under the threshold; the dot core is #ffffff (radius 2.8).
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = cv.width, H = cv.height;
    const g = cv.getContext("2d");
    const img = g.getImageData(0, 0, W, H).data;
    let best = -1, bx = -1, by = -1;
    const nearWhite = (k) =>
      img[k] >= 240 && img[k + 1] >= 240 && img[k + 2] >= 240 && img[k + 3] >= 200; // alpha: contour ghost is RGB-255 at alpha ~26
    for (let y = 2; y < H - 2; y++) {
      for (let x = 2; x < W - 2; x++) {
        const k = (y * W + x) * 4;
        if (!nearWhite(k)) continue;
        // Cluster score: count near-white pixels in a 5×5 neighborhood.
        let n = 0;
        for (let dy2 = -2; dy2 <= 2; dy2++) {
          for (let dx2 = -2; dx2 <= 2; dx2++) {
            if (nearWhite(((y + dy2) * W + (x + dx2)) * 4)) n++;
          }
        }
        if (n > best) { best = n; bx = x; by = y; }
      }
    }
    const dot = best >= 10 ? { x: r.left + bx / dpr, y: r.top + by / dpr } : null;
    return { anchor, dot, fit: window.__wp1.fit() };
  });
  samples.push(s);
  const d = s.anchor && s.dot ? Math.hypot(s.anchor.x - s.dot.x, s.anchor.y - s.dot.y) : NaN;
  console.log(
    `t=${(i * 0.9).toFixed(1)}s anchor=(${s.anchor?.x.toFixed(0)},${s.anchor?.y.toFixed(0)}) dot=(${s.dot?.x.toFixed(0)},${s.dot?.y.toFixed(0)}) dist=${d.toFixed(0)}px fit=(${s.fit.w.toFixed(2)},${s.fit.b.toFixed(2)})`,
  );
  await sleep(900);
}
const dists = samples
  .filter((s) => s.anchor && s.dot)
  .map((s) => Math.hypot(s.anchor.x - s.dot.x, s.anchor.y - s.dot.y));
const moved = Math.max(...dists) - Math.min(...dists);
console.log(`\nanchor↔dot distance: min=${Math.min(...dists).toFixed(0)}px max=${Math.max(...dists).toFixed(0)}px swing=${moved.toFixed(0)}px`);
console.log(moved > 15 ? "MISMATCH_PROVEN (anchor fixed while the needle moves)" : "anchor tracks the needle (ok)");

await browser.close();
srv.close();
process.exit(moved > 15 ? 1 : 0);
