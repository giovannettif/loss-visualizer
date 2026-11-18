// Probe (S2-ADAM-1): which scene does ?step=N land on (adam-a vs adam-b)?
import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";
const browser = await launchGL(chromium, {});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
for (const n of [10, 11, 12, 13]) {
  await page.goto(`http://localhost:4181/?step=${n}`);
  await page.waitForFunction(() => window.__wp1 && !document.getElementById("boot"), null, { timeout: 30000 });
  await new Promise(r => setTimeout(r, 2500));
  const out = await page.evaluate(() => ({
    scene: window.__wp1.scene(),
    adam: window.__wp1.adam ? window.__wp1.adam() : null,
  }));
  console.log(`?step=${n}`, JSON.stringify(out));
}
await browser.close();
