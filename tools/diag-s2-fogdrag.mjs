// Diagnostic (sweep-2): replays verify-cycleb's student-1 three-stride fog-b
// play and logs each stride's outcome (own-cell rejects show as unchanged used).
import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";
const base = process.argv[2] ?? "http://localhost:4185";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(`${base}/?step=16`, { waitUntil: "load" });
for (let i = 0; i < 60; i++) { const a = await page.evaluate(() => window.__wp1.locked() || window.__wp1.animating()); if (!a) break; await sleep(250); }
await sleep(500);
const mm = await page.locator("#minimap-canvas").boundingBox();
const log = async (tag) => console.log(tag, JSON.stringify(await page.evaluate(() => { const f = window.__wp1.fog(); return { used: f.used, point: f.point, anim: window.__wp1.animating() }; })));
await log("start");
for (const [fx, fy, tx, ty] of [[0.12, 0.3, 0.75, 0.62], [0.2, 0.35, 0.72, 0.6], [0.25, 0.4, 0.7, 0.58]]) {
  await page.mouse.move(mm.x + mm.width * fx, mm.y + mm.height * fy);
  await page.mouse.down();
  await page.mouse.move(mm.x + mm.width * tx, mm.y + mm.height * ty, { steps: 8 });
  await log("  held");
  await page.mouse.up();
  await log("  released");
  await sleep(700);
  await log("after");
}
await browser.close();
