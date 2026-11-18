/**
 * b2-visual.mjs — BASELINE visual probes: tilt fog (minimap ghost + contour
 * leak) and the axis-label findings (FA-1 task-a map, FA-2 epi-a map, FA-3
 * fog-c corner). Screenshots land in qa-fix1/shots; pixel probes print.
 */
import { chromium } from "playwright";
import { launchGL } from "../tools/gl-launch.mjs";
import { sleep, shot, waitIdle, OUT_DIR } from "./h.mjs";
import { resolve } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:4188";
const tag = process.argv[3] ?? "base";
const browser = await launchGL(chromium);

// ---- TILTFOG: dark tilt board + the x-y compass inset
{
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  await page.goto(`${BASE}/?step=18`, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
  await waitIdle(page);
  await sleep(600);
  const st = await page.evaluate(() => {
    const t = window.__wp1.tilt();
    const d = window.__wp1.debug();
    return { tilt: { done: t.done, cells: t.cells }, scene: window.__wp1.scene(), attitude: d.viewAttitude };
  });
  console.log(`[${tag}] TILT dark-board state:`, JSON.stringify(st));
  await shot(page, `${tag}-tilt-dark-full.png`);
  // crop-equivalent: minimap element screenshot + the 3D pane
  const mm = await page.locator("#minimap-panel").boundingBox();
  if (mm) await page.screenshot({ path: resolve(OUT_DIR, `${tag}-tilt-dark-minimap.png`), clip: mm });
  await page.close();
}

// ---- TILTFOG: level 2 (Rosenbrock) dark board
{
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  await page.goto(`${BASE}/?step=18`, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
  await waitIdle(page);
  await page.click('#tilt-levels button[data-level="rosen"]');
  await sleep(1200);
  await shot(page, `${tag}-tilt-rosen-dark-full.png`);
  const mm = await page.locator("#minimap-panel").boundingBox();
  if (mm) await page.screenshot({ path: resolve(OUT_DIR, `${tag}-tilt-rosen-dark-minimap.png`), clip: mm });
  // contour-leak pixel probe: sample the 3D canvas for lit (non-void) pixels
  const probe = await page.evaluate(() => {
    const cv = document.querySelector("#stage canvas");
    if (!cv) return null;
    const w = cv.width, h = cv.height;
    const off = document.createElement("canvas");
    off.width = w; off.height = h;
    const g = off.getContext("2d");
    g.drawImage(cv, 0, 0);
    const img = g.getImageData(0, 0, w, h).data;
    let lit = 0, total = 0;
    // contour-dense mid band of the board (avoid HUD corners)
    for (let y = Math.floor(h * 0.25); y < Math.floor(h * 0.75); y += 2) {
      for (let x = Math.floor(w * 0.15); x < Math.floor(w * 0.45); x += 2) {
        const i = (y * w + x) * 4;
        const lum = 0.2126 * img[i] + 0.7152 * img[i + 1] + 0.0722 * img[i + 2];
        if (lum > 18) lit++;
        total++;
      }
    }
    return { litFracPct: +((lit / total) * 100).toFixed(2) };
  });
  console.log(`[${tag}] TILT contour leak probe (mid-left band litFrac):`, JSON.stringify(probe));
  await page.close();
}

// ---- FA-1: task-a Map view — fit panel occludes b-axis labels
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  await page.goto(`${BASE}/?shot=task-a`, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
  await sleep(800);
  await shot(page, `${tag}-task-a-iso.png`);
  // click the Map view preset (the .lv-controls buttons)
  const mapBtn = page.locator(".lv-controls button", { hasText: "Map view" });
  if (await mapBtn.count()) {
    await mapBtn.first().click();
    await sleep(800);
    await shot(page, `${tag}-task-a-map.png`);
    const geom = await page.evaluate(() => {
      const panel = document.querySelector("#fit-panel")?.getBoundingClientRect();
      const stage = document.querySelector("#stage-wrap")?.getBoundingClientRect();
      return { panel: panel ? { x: Math.round(panel.x), y: Math.round(panel.y), w: Math.round(panel.width), h: Math.round(panel.height) } : null, stage: stage ? { w: Math.round(stage.width), h: Math.round(stage.height) } : null };
    });
    console.log(`[${tag}] FA-1 fit-panel rect:`, JSON.stringify(geom));
  } else {
    console.log(`[${tag}] FA-1: no Map view button found (.lv-controls)`);
  }
  await page.close();
}

// ---- FA-2: epi-a Map view — bottom w-axis labels clipped
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  await page.goto(`${BASE}/?shot=epi-a`, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
  await sleep(800);
  await shot(page, `${tag}-epi-a-iso.png`);
  const mapBtn = page.locator(".lv-controls button", { hasText: "Map view" });
  if (await mapBtn.count()) {
    await mapBtn.first().click();
    await sleep(800);
    await shot(page, `${tag}-epi-a-map.png`);
  }
  await page.close();
}

// ---- FA-3: fog-c reveal corner collision
{
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  await page.goto(`${BASE}/?shot=fog-c`, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
  await sleep(900);
  await shot(page, `${tag}-fog-c-reveal.png`);
  await page.close();
}

await browser.close();
console.log(`[${tag}] visual baselines done — shots in ${OUT_DIR}`);
