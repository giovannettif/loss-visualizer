/** qa-s2mm-crawl2.mjs — visual check: minimap crop at each η regime. */
import { chromium } from "playwright";
import { launchGL } from "./tools/gl-launch.mjs";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const base = process.argv[2] ?? "http://localhost:4181";
const outDir = resolve("qa/qa-s2mm-shots");
mkdirSync(outDir, { recursive: true });
const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitIdle(maxMs = 25000) {
  const t0 = Date.now();
  for (;;) {
    const a = await page.evaluate(() => ({ locked: window.__wp1?.locked?.(), animating: window.__wp1?.animating?.() }));
    if (!a.locked && !a.animating) return true;
    if (Date.now() - t0 > maxMs) return false;
    await sleep(200);
  }
}
await page.goto(`${base}/?step=6`, { waitUntil: "load" });
await sleep(1700);
await waitIdle();
const box = await page.locator("#eta-slider").boundingBox();
for (const t of [100, 160, 300, 566, 848, 968]) {
  await page.mouse.click(box.x + (box.width * t) / 1000, box.y + box.height / 2);
  await sleep(400);
  await waitIdle();
  const gd = await page.evaluate(() => window.__wp1?.gd?.());
  await page.locator("#minimap-panel").screenshot({ path: resolve(outDir, `crawl-mm-t${t}.png`) });
  console.log(`t=${t} eta=${gd.eta.toFixed(4)} ${gd.regime} pathSteps=${gd.pathSteps}`);
}
await browser.close();
