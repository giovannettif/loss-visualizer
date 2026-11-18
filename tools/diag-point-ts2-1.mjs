/**
 * diag-point-ts2-1.mjs — POINT-TS2-1 reproduction.
 *
 * The finding: §7 tour step 2/7 (page 18, para 2, sent 0 — "The c slider is
 * the damping coefficient…") uses look key "tilt-panel", the WHOLE panel
 * (generic anchor at rect.left + 0.42·w, mid-height). The named control is
 * the c-slider row (#tilt-panel .eta-control .eta-row), but the panel's
 * vertical MIDPOINT falls in the gap between the .eta-control block and
 * #tilt-levels — and once the tour's step-1 tiltSteered gate makes the run
 * live (+#tilt-finish shows BELOW the pills, director.ts:4925), the panel
 * grows downward and the midpoint lands ON/below the pills' top edge.
 *
 * This harness measures, against the BUILT dist:
 *   - hover flavor first (un-steered run, ?step=18 free play): dot vs
 *     #tilt-panel / .eta-control / .eta-row / #tilt-friction / #tilt-levels;
 *   - then the tour: chip → gate step 1/7 → steer (WASD) → auto-release to
 *     2/7 → same geometry;
 *   - what the proposed panelPart fix WOULD anchor ('#tilt-panel
 *     .eta-control .eta-row' center and #tilt-friction center).
 * Read-only against src/ — serves the prebuilt dist/ on :4231.
 */

import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, extname, resolve } from "node:path";

const DIST = join(process.cwd(), "dist");
const PORT = 4231;
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

const outDir = resolve("qa", "point-ts2");
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

/** Geometry probe: overlay dot vs panel / c-row / friction slider / pills. */
const geom = () =>
  page.evaluate(() => {
    const dot = document.querySelector("#tour-dot");
    const rect = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        left: Math.round(r.left), top: Math.round(r.top),
        right: Math.round(r.right), bottom: Math.round(r.bottom),
        w: Math.round(r.width), h: Math.round(r.height),
      };
    };
    const ax = dot ? Number(dot.getAttribute("cx")) : null;
    const ay = dot ? Number(dot.getAttribute("cy")) : null;
    const cRow = rect("#tilt-panel .eta-control .eta-row");
    const friction = rect("#tilt-friction");
    const inRect = (x, y, r) => r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    // Every direct child of the panel, top→bottom, so a height delta between
    // flavors can be attributed to a specific row.
    const children = [...document.querySelectorAll("#tilt-panel > *")].map((el) => {
      const r = el.getBoundingClientRect();
      return {
        sel: el.id ? `#${el.id}` : `.${[...el.classList].join(".")}`,
        top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height),
        hidden: el.hidden || getComputedStyle(el).display === "none",
      };
    });
    return {
      anchor: { x: ax, y: ay },
      overlayOn: document.querySelector("#tour-overlay")?.dataset.on,
      panel: rect("#tilt-panel"),
      panelChildren: children,
      etaControl: rect("#tilt-panel .eta-control"),
      cRow,
      friction,
      levels: rect("#tilt-levels"),
      finish: rect("#tilt-finish"),
      finishHidden: document.querySelector("#tilt-finish")?.hidden,
      anchorInCRow: inRect(ax, ay, cRow),
      anchorInFriction: inRect(ax, ay, friction),
      anchorInLevels: inRect(ax, ay, rect("#tilt-levels")),
      // What a panelPart('.eta-control .eta-row') anchor WOULD be:
      fixAnchorRow: cRow
        ? { x: Math.round(cRow.left + cRow.w * 0.42), y: Math.round(cRow.top + cRow.h / 2) }
        : null,
      // What a panelPart('#tilt-friction') anchor WOULD be:
      fixAnchorSlider: friction
        ? { x: Math.round(friction.left + friction.w * 0.42), y: Math.round(friction.top + friction.h / 2) }
        : null,
      sentence: (document.querySelector("[data-tour-active]")?.textContent ??
        document.querySelector("[data-slook-hover]")?.textContent ?? "")
        .trim().replace(/\s+/g, " ").slice(0, 80),
    };
  });

await page.goto(`http://localhost:${PORT}/?step=18`, { waitUntil: "load" });
await sleep(1600);
if (!(await waitIdle())) console.log("WARN: still locked after entry");
{
  const scene = await page.evaluate(() => window.__wp1.scene());
  const step = await page.evaluate(() => window.__wp1.step());
  console.log(`boot: scene=${scene} step=${step}`);
}

/* ---- flavor A: free-play hover, run NOT steered (fresh boot) ---- */
{
  const n = await page.locator('.rstep[data-active="true"] .sent[data-slook="tilt-panel"]').count();
  console.log(`hover: sentences with data-slook="tilt-panel" on the parked page: ${n}`);
  if (n > 0) {
    await page.hover('.rstep[data-active="true"] .sent[data-slook="tilt-panel"]');
    await sleep(700);
    const g = await geom();
    console.log("GEOMETRY (hover flavor, run NOT started):");
    console.log(JSON.stringify(g, null, 2));
    await page.screenshot({ path: resolve(outDir, "hover-18-tilt-panel.png") });
    await page.mouse.move(10, 10);
    await sleep(400);
  }
}

/* ---- flavor B: the guided tour, gate released by steering ---- */
await page.locator('.rstep[data-active="true"] .tour-launch').click();
const s0 = await waitTour((x) => x.phase === "active" && x.stepIndex === 0, 15000, "s7 gate step");
console.log("tour step 1/7:", JSON.stringify(s0));
await sleep(600);
// Steer once — HOLD the key across several frames: the physics ticks only
// observe the input on a rAF, so an instant down+up is never seen (the
// attract pose stays frozen and the tiltSteered gate never releases).
await page.keyboard.down("a");
await sleep(600);
await page.keyboard.up("a");
const s1 = await waitTour((x) => x.phase === "active" && x.stepIndex === 1 && x.gate === false, 20000, "s7 c-slider step");
console.log("tour step 2/7:", JSON.stringify(s1));
await sleep(800);

const g = await geom();
console.log("GEOMETRY (tour flavor, run steered → #tilt-finish visible):");
console.log(JSON.stringify(g, null, 2));
const look = await page.evaluate(() => window.__wp1.look());
console.log("look:", JSON.stringify(look));
await page.screenshot({ path: resolve(outDir, "tour-s7-2.png") });

await browser.close();
srv.close();
console.log("DONE");
