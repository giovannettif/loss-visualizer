/**
 * qa-int/v3-rf6.mjs — round-3 verification of RF-6 (the lab narrow-tier
 * compass/curves collision fix) on the fresh build:
 *   - viewport 900x700 AND 900x900 (the ask names both), steps 13 AND 14
 *   - measure pairwise overlap of the visible HUD panels (#curves-panel,
 *     #minimap-panel, #lab-dock) — must be 0
 *   - all three panels must sit inside the visible canvas pane (left of
 *     #reader), fully on-screen
 *   - the dock stays functional at 900x700 (drag elong slider -> lab E moves)
 *   - screenshots for every case
 * Then a quick 1600x900 sanity pass of the same overlap measurement (the
 * wide tier must be unaffected).
 */
import { chromium } from "playwright";
import { launchGL } from "../tools/gl-launch.mjs";
import { check, finish, sleep, appState, waitIdle, waitFor, OUT_DIR } from "./h.mjs";
import { resolve } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:4184";
const browser = await launchGL(chromium);

const PANELS = ["#curves-panel", "#minimap-panel", "#lab-dock"];

async function measurePanels(p) {
  return p.evaluate((ids) => {
    const rects = {};
    for (const id of ids) {
      const el = document.querySelector(id);
      const vis = el && el.dataset.visible === "true";
      rects[id] = { vis, r: el?.getBoundingClientRect() ?? null };
    }
    const area = (a, b) => {
      if (!a || !b) return null;
      const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
      const y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      return Math.round(x * y);
    };
    const overlaps = {};
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = rects[ids[i]], b = rects[ids[j]];
        if (a?.vis && b?.vis) overlaps[`${ids[i]} x ${ids[j]}`] = area(a.r, b.r);
      }
    }
    const reader = document.querySelector("#reader").getBoundingClientRect();
    const onScreen = {};
    for (const id of ids) {
      const { vis, r } = rects[id];
      onScreen[id] =
        vis && r &&
        r.left >= -1 && r.top >= -1 &&
        r.right <= reader.left + 1 && r.bottom <= innerHeight + 1 &&
        r.width > 0 && r.height > 0;
    }
    return {
      rects: Object.fromEntries(Object.entries(rects).map(([k, v]) => [k, {
        vis: v.vis,
        x: v.r ? Math.round(v.r.x) : null,
        y: v.r ? Math.round(v.r.y) : null,
        w: v.r ? Math.round(v.r.width) : null,
        h: v.r ? Math.round(v.r.height) : null,
      }])),
      overlaps,
      onScreen,
      readerLeft: Math.round(reader.left),
      pane: innerWidth - Math.round(reader.left),
    };
  }, PANELS);
}

for (const [w, h] of [[900, 700], [900, 900]]) {
  for (const step of [13, 14]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    page.on("pageerror", (err) => console.log(`PAGEERROR(${w}x${h} s${step}):`, err.message));
    await page.goto(`${BASE}/?step=${step}`, { waitUntil: "load" });
    await page.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
    await waitIdle(page);
    await sleep(400);
    const m = await measurePanels(page);
    const ov = Object.entries(m.overlaps);
    check(`RF-6 @ ${w}x${h} step ${step}: no HUD panel overlaps (curves/minimap/dock)`,
      ov.every(([, a]) => a === 0) && ov.length >= 3,
      JSON.stringify({ overlaps: m.overlaps, pane: m.pane }));
    check(`RF-6 @ ${w}x${h} step ${step}: all three panels visible and inside the canvas pane`,
      Object.values(m.onScreen).every(Boolean),
      JSON.stringify({ onScreen: m.onScreen, rects: m.rects }));
    await page.screenshot({ path: resolve(OUT_DIR, `v3-rf6-${w}x${h}-step${step}.png`) });
    // dock functional at this size (drag elong slider; on lab-2 the copy's target)
    const lab0 = await page.evaluate(() => window.__wp1.lab()?.E ?? null);
    const knob = page.locator("#lab-dock #elong-slider");
    const kb = await knob.boundingBox();
    if (kb) {
      const y = kb.y + kb.height / 2;
      await page.mouse.move(kb.x + kb.width * 0.8, y);
      await page.mouse.down();
      await page.mouse.move(kb.x + kb.width * 0.15, y, { steps: 6 });
      await page.mouse.up();
      await sleep(800);
      const lab1 = await page.evaluate(() => window.__wp1.lab()?.E ?? null);
      check(`RF-6 @ ${w}x${h} step ${step}: the dock's slider is reachable and functional (E moves)`,
        lab0 !== null && lab1 !== null && lab1 !== lab0,
        `E ${lab0?.toFixed(1)} -> ${lab1?.toFixed(1)}`);
    } else {
      check(`RF-6 @ ${w}x${h} step ${step}: dock slider missing`, false, "no #lab-dock #elong-slider box");
    }
    await page.close();
  }
}

/* 1600x900 wide-tier sanity: the lab compass rejoins its top-right slot, no overlap */
{
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on("pageerror", (err) => console.log("PAGEERROR(wide):", err.message));
  await page.goto(BASE + "/?step=13", { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
  await waitIdle(page);
  const m = await measurePanels(page);
  check("RF-6 wide tier (1600x900, step 13): panels visible, no overlaps",
    Object.values(m.onScreen).every(Boolean) &&
    Object.entries(m.overlaps).every(([, a]) => a === 0),
    JSON.stringify({ overlaps: m.overlaps, minimap: m.rects["#minimap-panel"] }));
  await page.close();
}

await browser.close();
finish("V3-RF6");
