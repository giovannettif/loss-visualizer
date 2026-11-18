/**
 * r2-overlap.mjs — RF-6 reproduction + fix verification: pairwise overlap of
 * every visible canvas-pane HUD instrument (.hud.panel[data-visible=true],
 * excluding the reader-covered right side) across the lens sizes, on the lab
 * pages (13/14). Run: node qa-fix1/r2-overlap.mjs [base] [tag]
 */
import { chromium } from "playwright";
import { launchGL } from "../tools/gl-launch.mjs";
import { sleep, waitIdle, check, finish, shot, OUT_DIR } from "./h.mjs";
import { resolve } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:4190";
const tag = process.argv[3] ?? "r2";
const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

const SIZES = [
  { w: 900, h: 700 },
  { w: 900, h: 900 },
  { w: 1280, h: 800 },
  { w: 1440, h: 900 },
];

for (const step of [13, 14]) {
  for (const size of SIZES) {
    await page.setViewportSize({ width: size.w, height: size.h });
    await page.goto(`${BASE}/?step=${step}`, { waitUntil: "load" });
    await page.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
    await waitIdle(page);
    await sleep(400);
    const r = await page.evaluate(() => {
      const stage = document.querySelector("#stage-wrap").getBoundingClientRect();
      const reader = document.querySelector("#reader").getBoundingClientRect();
      const panels = [];
      for (const el of document.querySelectorAll('.hud.panel[data-visible="true"]')) {
        const b = el.getBoundingClientRect();
        if (b.width <= 0 || b.height <= 0) continue;
        if (b.left >= reader.left) continue; // under/over the reader: outside the pane
        panels.push({ id: el.id, x: Math.round(b.left), y: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) });
      }
      const overlaps = [];
      for (let i = 0; i < panels.length; i++) {
        for (let j = i + 1; j < panels.length; j++) {
          const a = panels[i], c = panels[j];
          const ox = Math.min(a.r, c.r) - Math.max(a.x, c.x);
          const oy = Math.min(a.b, c.b) - Math.max(a.y, c.y);
          if (ox > 0 && oy > 0) overlaps.push(`${a.id} × ${c.id} = ${Math.round(ox * oy)}px²`);
        }
      }
      return { paneW: Math.round(reader.left), panels, overlaps };
    });
    const label = `lab step ${step} @${size.w}x${size.h}`;
    check(`${label}: no HUD instrument overlap`, r.overlaps.length === 0, JSON.stringify({ paneW: r.paneW, panels: r.panels, overlaps: r.overlaps }));
    if (size.w === 900) {
      await shot(page, `${tag}-lab-${step}-${size.w}x${size.h}.png`);
    }
  }
}

await browser.close();
finish(`r2-overlap [${tag}]`);
