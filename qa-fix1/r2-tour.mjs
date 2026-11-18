/**
 * r2-tour.mjs — RF-6 adjacent guard: during the s5 lab tour at 900×700 the
 * compass must stay in its collision-free bottom-right corner (the lab tier
 * outranks the tour tiers by specificity) and no HUD instrument may overlap.
 */
import { chromium } from "playwright";
import { launchGL } from "../tools/gl-launch.mjs";
import { sleep, waitIdle, check, finish, shot, OUT_DIR } from "./h.mjs";
import { resolve } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:4190";
const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

await page.setViewportSize({ width: 900, height: 700 });
await page.goto(`${BASE}/?step=13`, { waitUntil: "load" });
await page.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
await waitIdle(page);
await sleep(300);
await page.click(".rstep[data-active=\"true\"] .tour-launch");
await sleep(1500);
const r = await page.evaluate(() => {
  const reader = document.querySelector("#reader").getBoundingClientRect();
  const panels = [];
  for (const el of document.querySelectorAll('.hud.panel[data-visible="true"]')) {
    const b = el.getBoundingClientRect();
    if (b.width <= 0 || b.height <= 0) continue;
    if (b.left >= reader.left) continue;
    panels.push({ id: el.id, x: Math.round(b.left), y: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom) });
  }
  const bar = document.querySelector("#tour-bar")?.getBoundingClientRect();
  const overlaps = [];
  for (let i = 0; i < panels.length; i++) {
    for (let j = i + 1; j < panels.length; j++) {
      const a = panels[i], c = panels[j];
      const ox = Math.min(a.r, c.r) - Math.max(a.x, c.x);
      const oy = Math.min(a.b, c.b) - Math.max(a.y, c.y);
      if (ox > 0 && oy > 0) overlaps.push(`${a.id} × ${c.id} = ${Math.round(ox * oy)}px²`);
    }
  }
  // bar vs panels
  let barOverlaps = [];
  if (bar) {
    for (const p of panels) {
      const ox = Math.min(bar.right, p.r) - Math.max(bar.left, p.x);
      const oy = Math.min(bar.bottom, p.b) - Math.max(bar.top, p.y);
      if (ox > 0 && oy > 0) barOverlaps.push(`bar × ${p.id} = ${Math.round(ox * oy)}px²`);
    }
  }
  const mm = panels.find((p) => p.id === "minimap-panel");
  return { tourRunning: document.body.dataset.tourLive, panels, mm, overlaps, barOverlaps, bar: bar ? { x: Math.round(bar.left), y: Math.round(bar.top), b: Math.round(bar.bottom) } : null };
});
check("s5 tour @900x700: tour is live", r.tourRunning === "s5", `tourLive=${r.tourRunning}`);
check("s5 tour @900x700: compass stays bottom-right (y > 400)", r.mm && r.mm.y > 400, JSON.stringify(r.mm));
check("s5 tour @900x700: no HUD instrument overlap", r.overlaps.length === 0, JSON.stringify(r.overlaps));
check("s5 tour @900x700: tour bar clears every instrument", r.barOverlaps.length === 0, JSON.stringify({ bar: r.bar, barOverlaps: r.barOverlaps }));
await shot(page, "r2-tour-s5-900x700.png");
await page.keyboard.press("Escape");
await browser.close();
finish("r2-tour");
