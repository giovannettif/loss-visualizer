/**
 * diag-s2a-narrow-live.mjs — S2A-NARROW-FRAMING-CLIPS-ARROW live re-check on
 * the CURRENT tree (round 2).
 *
 * The finding (Nov 9 evidence, qa/sweep2-s2-arrow): at viewport widths
 * ≤1100px the gd-b framing put the white ball flush against the pane's left
 * edge and cropped the bowl's west side, so a west-bound drawn arrow's head
 * left the pane. The in-tree fit now divides by min(1, paneAspect()) with
 * pane = canvas − docked reader (LandscapeView fitAtCurrentAttitude), and
 * main.ts feeds the docked reader width via setPaneInsetRight.
 *
 * This script reruns the finding's EXACT repro at 5 widths on the built dist:
 *   1. land on ?step=5 (gd-b), settle, screenshot the frame;
 *   2. read ballScreen, gdState.point, frameX, reader/canvas/minimap rects;
 *   3. drag on the compass from the white point (−11, 9.5) to (−15, 4),
 *      release, settle, screenshot (the west arrow);
 *   4. scan the pane strip pixels: terrain left edge, leftmost white arrow
 *      pixel in a band around the ball (the arrowhead's tip x), and the
 *      arrowhead's clearance from the pane's left edge.
 *
 * Read-only against src/ — serves dist/ on 4186.
 * Evidence: qa/S2A-NARROW-FRAMING-CLIPS-ARROW-r2/
 */

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, extname, resolve } from "node:path";

const DIST = join(process.cwd(), "dist");
const PORT = 4186;
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

const OUT = resolve("qa/S2A-NARROW-FRAMING-CLIPS-ARROW-r2");
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VIEWPORTS = [
  [1600, 900], // finding: fine
  [1280, 720], // finding: fine (lower bound of "fine")
  [1100, 800], // finding: broken (primary repro)
  [1000, 700], // finding: broken
  [900, 700],  // r1 sweep extra
];

async function settleIdle(page) {
  for (let i = 0; i < 60; i++) {
    const a = await page.evaluate(() => ({
      locked: window.__wp1.locked(),
      animating: window.__wp1.animating(),
    }));
    if (!a.locked && !a.animating) break;
    await sleep(250);
  }
}

/** Compass px mapping — identical to qa/sweep2-s2-arrow/p8.mjs. */
function compassMapper(mm) {
  const PAD = 18, PADB = 27, E = 15;
  const iw = mm.w - PAD - 8, ih = mm.h - PAD - PADB;
  const s = Math.min(iw / 30, ih / 30);
  const x0 = PAD + (iw - 30 * s) / 2, y0 = PAD + (ih - 30 * s) / 2;
  return (p) => ({ x: mm.x + x0 + (p.x + E) * s, y: mm.y + y0 + (E - p.y) * s });
}

/** In-page pixel scans over a screenshot of the visible pane strip. */
async function scanPane(page, readerLeft, ball, bandHalf = 90) {
  const vh = page.viewportSize().height;
  const shot = await page.screenshot({ clip: { x: 0, y: 0, width: Math.round(readerLeft), height: vh } });
  return page.evaluate(async ({ b64, vw, vh, ball, bandHalf }) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "data:image/png;base64," + b64; });
    const c = document.createElement("canvas"); c.width = vw; c.height = vh;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, vw, vh);
    const d = ctx.getImageData(0, 0, vw, vh).data;
    // terrain edge: saturated non-background pixels in a HUD-free band
    let terrMinX = Infinity;
    const yA = Math.round(vh * 0.22), yB = Math.round(vh * 0.62);
    for (let y = yA; y < yB; y++) for (let x = 0; x < vw; x++) {
      const i = (y * vw + x) * 4;
      const mx = Math.max(d[i], d[i + 1], d[i + 2]);
      if (mx > 60) { if (x < terrMinX) terrMinX = x; break; }
    }
    // arrowhead: white pixels around the ball's y band, left of the ball,
    // excluding the ball disc itself
    let arrowMinX = Infinity, arrowMinAt = -1;
    const y0 = Math.max(0, Math.round(ball.y - bandHalf));
    const y1 = Math.min(vh - 1, Math.round(ball.y + bandHalf));
    const bx = Math.round(ball.x), by = Math.round(ball.y);
    for (let y = y0; y <= y1; y++) for (let x = 0; x < Math.min(vw, bx + 30); x++) {
      const dx = x - bx, dy = y - by;
      if (dx * dx + dy * dy < 22 * 22) continue; // skip the ball itself
      const i = (y * vw + x) * 4;
      if (d[i] > 210 && d[i + 1] > 210 && d[i + 2] > 210) {
        if (x < arrowMinX) { arrowMinX = x; arrowMinAt = y; }
        break;
      }
    }
    return {
      terrainLeftX: terrMinX === Infinity ? null : terrMinX,
      arrowMinX: arrowMinX === Infinity ? null : arrowMinX,
      arrowMinAt,
    };
  }, { b64: shot.toString("base64"), vw: Math.round(readerLeft), vh, ball, bandHalf });
}

const browser = await chromium.launch();
const report = {};

for (const [W, H] of VIEWPORTS) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  await page.goto(`http://localhost:${PORT}/?step=5`, { waitUntil: "load" });
  await settleIdle(page);
  await sleep(600);

  const st = await page.evaluate(() => {
    const rr = document.querySelector("#reader").getBoundingClientRect();
    const cr = document.querySelector("#stage canvas").getBoundingClientRect();
    const mm = document.querySelector("#minimap-canvas").getBoundingClientRect();
    return {
      scene: window.__wp1.scene(),
      gd: window.__wp1.gd(),
      ball: window.__wp1.ballScreen(),
      frameX: window.__wp1.layout().frameX,
      reader: { x: rr.x, w: rr.width },
      canvas: { x: cr.x, w: cr.width, h: cr.height },
      minimap: { x: mm.x, y: mm.y, w: mm.width, h: mm.height },
      cam: window.__wp1.debug().viewAttitude,
    };
  });
  if (st.scene !== "gd-b") { console.log(`${W}x${H}: scene=${st.scene} — SKIP`); await page.close(); continue; }
  await page.screenshot({ path: join(OUT, `frame-${W}x${H}.png`) });

  const toPx = compassMapper(st.minimap);
  const sp = toPx({ x: -11, y: 9.5 }); // the white point (gdState.point confirms)
  const t = toPx({ x: -15, y: 4 });
  await page.mouse.move(sp.x, sp.y);
  await page.mouse.down();
  await page.mouse.move(t.x, t.y, { steps: 5 });
  await page.mouse.up();
  await settleIdle(page);
  await sleep(600);

  const gdAfter = await page.evaluate(() => window.__wp1.gd());
  const ballAfter = await page.evaluate(() => window.__wp1.ballScreen());
  await page.screenshot({ path: join(OUT, `west-${W}x${H}.png`) });
  const scan = await scanPane(page, W - st.reader.w, ballAfter);

  const paneLeft = 0;
  const row = {
    scene: st.scene,
    point: st.gd.point,
    userTip: gdAfter.userTip,
    ballFrame: st.ball,
    ballWest: ballAfter,
    frameX: st.frameX,
    readerW: st.reader.w,
    paneW: W - st.reader.w,
    paneAspect: +((W - st.reader.w) / st.canvas.h).toFixed(3),
    cam: st.cam,
    terrainLeftX: scan.terrainLeftX,
    arrowMinX: scan.arrowMinX,
    arrowMinY: scan.arrowMinAt,
    headClearancePx: scan.arrowMinX === null ? null : +(scan.arrowMinX - paneLeft).toFixed(0),
    ballClearancePx: ballAfter ? +(ballAfter.x - paneLeft).toFixed(0) : null,
  };
  report[`${W}x${H}`] = row;
  console.log(`\n== ${W}x${H} ==\n` + JSON.stringify(row, null, 1));
  await page.close();
}

await browser.close();
srv.close();
console.log("\nDONE");
