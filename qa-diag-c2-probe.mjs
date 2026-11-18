// C2-CAP-TOOLTIP repro probe: replicate gate-fog.mjs's rail click + parked
// pointer, then capture (a) with the pointer parked on the tick and (b) with
// the pointer moved to a neutral canvas spot. Confirms the .tick-name hover
// pill is the overlay and that pointer hygiene clears it.
import { chromium } from "playwright";
import { launchGL } from "./tools/gl-launch.mjs";

const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

await page.goto("http://localhost:4173/?shot=fog-c", { waitUntil: "load" });
await new Promise((r) => setTimeout(r, 1400));

// Same as gate-fog.mjs:253 — Playwright's click() parks the pointer on the tick.
await page.locator("#rail button").nth(17).click();
await new Promise((r) => setTimeout(r, 9000));

const parked = await page.evaluate(() => {
  const btn = document.querySelectorAll("#rail button")[17];
  const name = btn?.querySelector(".tick-name");
  const cs = name ? getComputedStyle(name) : null;
  const r = name?.getBoundingClientRect();
  return {
    hovered: btn?.matches(":hover") ?? false,
    pillOpacity: cs?.opacity,
    pillRect: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null,
    pillText: name?.textContent ?? null,
    readerRight: document.querySelector("#reader")?.getBoundingClientRect().x ?? null,
  };
});
console.log("PARKED:", JSON.stringify(parked));
await page.screenshot({ path: "shots/_diag_c2_parked.png" });

// The fix: park the pointer on an empty part of the 3D canvas, wait out the
// 0.25s opacity transition (page.css:438-440).
await page.mouse.move(400, 450);
await new Promise((r) => setTimeout(r, 400));
const moved = await page.evaluate(() => {
  const name = document.querySelectorAll("#rail button")[17]?.querySelector(".tick-name");
  return { pillOpacity: name ? getComputedStyle(name).opacity : null };
});
console.log("MOVED:", JSON.stringify(moved));
await page.screenshot({ path: "shots/_diag_c2_moved.png" });

await browser.close();
