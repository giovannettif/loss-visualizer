/**
 * diag-tiltball-panel.mjs — S7-BALL-UNDER-PANEL reproduction + fix-geometry sweep.
 *
 * 1. REPRO (the finding's exact repro): built dist at ?step=18, click each
 *    level pill, read window.__wp1.ballScreen() against the #tilt-panel rect,
 *    at 1280x800 / 1366x768 / 1440x900.
 * 2. FIX SWEEP: simulate the proposed fix (frameXTarget that re-centres the
 *    scene in the strip RIGHT of the panel) by driving the production code
 *    path — frameXTarget === readerHalf() for tilt scenes (no inspector
 *    nudge), so shrinking the reader element to (readerW - panelRight) px and
 *    dispatching resize produces exactly the frameX the fix would compute.
 *    Re-read ballScreen + panel rect per level, and screenshot both poses.
 * 3. TERRAIN EXTENT: with HUD overlays hidden, scan the visible canvas for
 *    scene-content pixels to measure where the terrain's edges land at both
 *    poses (what hides under the tilt panel / under the reader).
 *
 * Read-only against src/ — serves dist/ on 4186.
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

const OUT = resolve("shots/_diag_tiltball");
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LEVELS = ["valley", "rosen", "rastr"];
const VIEWPORTS = [
  [1280, 800],
  [1366, 768],
  [1440, 900],
  [1600, 900], // currently clear per the finding — must stay clear after the fix
  [1920, 1080],
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

async function readState(page) {
  return page.evaluate(() => {
    const panel = document.querySelector("#tilt-panel").getBoundingClientRect();
    const reader = document.querySelector("#reader").getBoundingClientRect();
    const ball = window.__wp1.ballScreen();
    const inside = (b, r, m = 0) =>
      b !== null && b.x >= r.left - m && b.x <= r.right + m && b.y >= r.top - m && b.y <= r.bottom + m;
    return {
      scene: window.__wp1.scene(),
      frameX: window.__wp1.layout().frameX,
      ball,
      panel: { left: +panel.left.toFixed(1), top: +panel.top.toFixed(1), right: +panel.right.toFixed(1), bottom: +panel.bottom.toFixed(1) },
      readerW: +reader.width.toFixed(1),
      panelVisible: document.querySelector("#tilt-panel").dataset.visible,
      insideStrict: ball !== null && inside(ball, panel),
      insideMargin8: ball !== null && inside(ball, panel, 8),
    };
  });
}

/** Terrain screen extent: hide HUDs, screenshot, scan the canvas strip LEFT
 *  of the reader (clip x < vw − readerW) for scene-content pixels (diff vs
 *  modal background). The terrain is symmetric about the content centre
 *  (vw/2 − frameX), so the visible left edge + centre give the true right
 *  edge and therefore how much tucks under the reader. */
async function terrainExtent(page, tag, readerLeft) {
  await page.evaluate(() => {
    document.documentElement.dataset.diagHud = "off";
    const st = document.createElement("style");
    st.id = "diag-hide-hud";
    st.textContent = "#stage-wrap .hud { visibility: hidden !important; }";
    document.head.appendChild(st);
  });
  await sleep(120);
  const shot = await page.screenshot({ clip: { x: 0, y: 0, width: readerLeft, height: page.viewportSize().height } });
  const vw = Math.round(readerLeft), vh = page.viewportSize().height;
  const extent = await page.evaluate(async ({ b64, vw, vh }) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "data:image/png;base64," + b64; });
    const c = document.createElement("canvas"); c.width = vw; c.height = vh;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, vw, vh);
    const d = ctx.getImageData(0, 0, vw, vh).data;
    // modal colour of the scan region = page background behind the canvas
    const counts = new Map();
    for (let y = 0; y < vh; y += 4) for (let x = 0; x < vw; x += 4) {
      const i = (y * vw + x) * 4;
      const k = `${d[i] >> 3},${d[i + 1] >> 3},${d[i + 2] >> 3}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const bg = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0].split(",").map((v) => (v << 3) + 4);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, n = 0;
    for (let y = 0; y < vh; y++) for (let x = 0; x < vw; x++) {
      const i = (y * vw + x) * 4;
      if (Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > 60) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y; n++;
      }
    }
    return n > 500 ? { minX, maxX, minY, maxY, n } : null;
  }, { b64: shot.toString("base64"), vw, vh });
  await page.evaluate(() => {
    document.getElementById("diag-hide-hud")?.remove();
    delete document.documentElement.dataset.diagHud;
  });
  await sleep(120);
  console.log(`  terrain-extent[${tag}]: ${JSON.stringify(extent)}`);
  return extent;
}

const browser = await chromium.launch();
const report = {};

for (const [W, H] of VIEWPORTS) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  await page.goto(`http://localhost:${PORT}/?step=18`, { waitUntil: "load" });
  await settleIdle(page);
  await sleep(400);

  const base = {};
  for (const lv of LEVELS) {
    await page.click(`#tilt-levels button[data-level="${lv}"]`);
    await sleep(500); // fresh run at the new level's start; read promptly
    base[lv] = await readState(page);
  }
  report[`base_${W}x${H}`] = base;
  console.log(`\n== ${W}x${H} baseline (frameX=${base.valley.frameX}, readerW=${base.valley.readerW}, panel=${JSON.stringify(base.valley.panel)})`);
  for (const lv of LEVELS) {
    const b = base[lv].ball;
    console.log(`  ${lv.padEnd(7)} ball=(${b ? b.x.toFixed(0) : "null"},${b ? b.y.toFixed(0) : ""}) insideStrict=${base[lv].insideStrict} insideMargin8=${base[lv].insideMargin8}`);
  }
  await page.screenshot({ path: join(OUT, `base-valley-${W}x${H}.png`) });

  // Fix simulation: target frameX = (readerW - panelRight)/2  ⇔ shrink the
  // reader to (readerW - panelRight) px and let the resize handler snap it.
  const simReaderW = Math.max(2, Math.round(base.valley.readerW - base.valley.panel.right));
  await page.evaluate((w) => {
    document.querySelector("#reader").style.width = `${w}px`;
    window.dispatchEvent(new Event("resize"));
  }, simReaderW);
  await sleep(400);

  const sim = {};
  for (const lv of LEVELS) {
    await page.click(`#tilt-levels button[data-level="${lv}"]`);
    await sleep(500);
    sim[lv] = await readState(page);
  }
  report[`sim_${W}x${H}`] = { simReaderW, ...sim };
  console.log(`== ${W}x${H} sim (reader→${simReaderW}px ⇒ frameX=${sim.valley.frameX})`);
  for (const lv of LEVELS) {
    const b = sim[lv].ball;
    const clear = b ? (b.x - sim[lv].panel.right).toFixed(0) : "null";
    console.log(`  ${lv.padEnd(7)} ball=(${b ? b.x.toFixed(0) : "null"},${b ? b.y.toFixed(0) : ""}) insideStrict=${sim[lv].insideStrict} clearOfPanelRight=${clear}px`);
  }
  await page.screenshot({ path: join(OUT, `sim-valley-${W}x${H}.png`) });

  // Terrain extent at 1280x800 only (valley): baseline vs sim.
  if (W === 1280) {
    await page.click('#tilt-levels button[data-level="valley"]');
    await sleep(500);
    await terrainExtent(page, `base-${W}x${H}`, W - base.valley.readerW);
    await page.evaluate((w) => {
      document.querySelector("#reader").style.width = `${w}px`;
      window.dispatchEvent(new Event("resize"));
    }, base.valley.readerW);
    await sleep(400);
    await terrainExtent(page, `sim-${W}x${H}`, W - simReaderW);
  }

  await page.close();
}

await browser.close();
srv.close();
console.log("\nREPORT " + JSON.stringify(report, null, 1));
