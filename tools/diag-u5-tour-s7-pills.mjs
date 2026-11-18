/**
 * diag-u5-tour-s7-pills.mjs — U5-POINT-LEVELS reproduction.
 *
 * The finding: in the §7 tour, the sentence "Level 2 is Rosenbrock …
 * Level 3 is Rastrigin …" (page 19, para 1, sent 0) — whose pointing
 * target is the tilt LEVEL PILLS — is pointed by look key "tilt-panel",
 * the WHOLE panel (generic anchor at rect.left + 0.42·w, mid-height).
 * No pill-level look target exists in LOOK_TARGETS.
 *
 * This harness measures, against the BUILT dist:
 *   - the tour step state on that sentence (lookKey, overlayOn);
 *   - the leader overlay's anchor point (#tour-dot cx/cy);
 *   - the #tilt-panel, #tilt-levels and per-pill rects;
 *   - whether the anchor lands inside the pills (it should NOT, per the
 *     finding) and where it actually lands inside the panel.
 * Also measures the free-play sentence hover on the same sentence.
 * Read-only against src/ — serves the prebuilt dist/ on :4197.
 */

import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";
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
await new Promise((r, rej) => {
  srv.once("error", rej);
  srv.listen(PORT, () => r());
});
console.log(`serving dist on :${PORT}`);

const outDir = resolve("shots");
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

async function tourState() {
  return page.evaluate(() => window.__wp1?.tour?.() ?? null);
}
async function waitTour(pred, maxMs = 20000, label = "tour state") {
  const t0 = Date.now();
  let s = null;
  for (;;) {
    s = await tourState();
    if (s && pred(s)) return s;
    if (Date.now() - t0 > maxMs) {
      console.log(`  (timeout waiting for ${label}: ${JSON.stringify(s)})`);
      return s;
    }
    await sleep(120);
  }
}
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

/** Geometry probe: overlay anchor vs tilt panel / level pills. */
const geom = () =>
  page.evaluate(() => {
    const dot = document.querySelector("#tour-dot");
    const rect = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const panel = rect("#tilt-panel");
    const levels = rect("#tilt-levels");
    const pills = [...document.querySelectorAll("#tilt-levels .btn")].map((b) => {
      const r = b.getBoundingClientRect();
      return { label: b.textContent.trim(), left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    });
    const ax = dot ? Number(dot.getAttribute("cx")) : null;
    const ay = dot ? Number(dot.getAttribute("cy")) : null;
    const inRect = (x, y, r) => r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    return {
      anchor: { x: ax, y: ay },
      overlayOn: document.querySelector("#tour-overlay")?.dataset.on,
      panelVisible: document.querySelector("#tilt-panel")?.dataset.visible,
      panel, levels, pills,
      anchorInPanel: inRect(ax, ay, panel),
      anchorInLevels: inRect(ax, ay, levels),
      anchorInAnyPill: pills.some((r) => inRect(ax, ay, r)),
      anchorOffsetInPanel: panel && ax !== null
        ? { fx: +((ax - panel.left) / panel.width).toFixed(3), fy: +((ay - panel.top) / panel.height).toFixed(3) }
        : null,
      levelsCenter: levels
        ? { x: Math.round((levels.left + levels.right) / 2), y: Math.round((levels.top + levels.bottom) / 2) }
        : null,
      dToLevelsCenter: levels && ax !== null
        ? Math.round(Math.hypot(ax - (levels.left + levels.right) / 2, ay - (levels.top + levels.bottom) / 2))
        : null,
      sentence: (document.querySelector("[data-tour-active]")?.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 90),
    };
  });

/* ---- main repro: ?step=19, tour chip → stepIndex 2 (the level sentence) -- */

await page.goto(`http://localhost:${PORT}/?step=19`, { waitUntil: "load" });
await sleep(1600);
if (!(await waitIdle())) console.log("WARN: still locked after entry");
{
  const scene = await page.evaluate(() => window.__wp1.scene());
  const step = await page.evaluate(() => window.__wp1.step());
  console.log(`boot: scene=${scene} step=${step}`);

  await page.locator('.rstep[data-active="true"] .tour-launch').click();
  const s = await waitTour((x) => x.phase === "active" && x.stepIndex === 2, 15000, "s7 level sentence");
  console.log("tour:", JSON.stringify(s));
  await sleep(800); // fades settle

  const g = await geom();
  console.log("GEOMETRY (tour active, sentence = level sentence):");
  console.log(JSON.stringify(g, null, 2));
  const look = await page.evaluate(() => window.__wp1.look());
  console.log("look:", JSON.stringify(look));
  await page.screenshot({ path: resolve(outDir, "u5-tour-s7-level-sentence.png") });

  /* ---- free-play: exit the tour, hover the same sentence span ---- */
  await page.keyboard.press("Escape");
  await sleep(600);
  const hoverable = await page.locator('.rstep[data-active="true"] .sent[data-slook="tilt-panel"]').count();
  console.log(`free-play: sentences with data-slook="tilt-panel" on the parked page: ${hoverable}`);
  if (hoverable > 0) {
    await page.hover('.rstep[data-active="true"] .sent[data-slook="tilt-panel"]');
    await sleep(600);
    const hg = await geom();
    console.log("GEOMETRY (free-play hover of the sentence):");
    console.log(JSON.stringify(
      {
        anchor: hg.anchor, overlayOn: hg.overlayOn,
        anchorInPanel: hg.anchorInPanel, anchorInLevels: hg.anchorInLevels,
        anchorInAnyPill: hg.anchorInAnyPill, anchorOffsetInPanel: hg.anchorOffsetInPanel,
        dToLevelsCenter: hg.dToLevelsCenter,
      }, null, 2));
    await page.mouse.move(10, 10);
    await sleep(300);
  }
}

await browser.close();
srv.close();
console.log("DONE");
