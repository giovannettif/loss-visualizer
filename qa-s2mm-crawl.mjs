/** qa-s2mm-crawl.mjs — why is gdRed 0 in the crawling regime? Read the GD
 * path state + scan the minimap at several crawling η values. */
import { chromium } from "playwright";
import { launchGL } from "./tools/gl-launch.mjs";

const base = process.argv[2] ?? "http://localhost:4181";
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
async function scan() {
  return page.evaluate(() => {
    const cv = document.querySelector("#minimap-canvas");
    const g = cv.getContext("2d");
    const img = g.getImageData(0, 0, cv.width, cv.height).data;
    let red = 0, anyAlpha = 0;
    for (let k = 0; k < img.length; k += 4) {
      if (img[k + 3] > 60) anyAlpha++;
      if (img[k] >= 240 && img[k + 1] >= 86 && img[k + 1] <= 110 && img[k + 2] >= 73 && img[k + 2] <= 97 && img[k + 3] > 60) red++;
    }
    return { red, anyAlpha };
  });
}
await page.goto(`${base}/?step=6`, { waitUntil: "load" });
await sleep(1700);
await waitIdle();
const box = await page.locator("#eta-slider").boundingBox();
for (const t of [40, 100, 160, 300, 566]) {
  await page.mouse.click(box.x + (box.width * t) / 1000, box.y + box.height / 2);
  await sleep(400);
  await waitIdle();
  const gd = await page.evaluate(() => window.__wp1?.gd?.());
  const s = await scan();
  console.log(`t=${String(t).padStart(3)} eta=${gd.eta.toFixed(4)} regime=${gd.regime} pathSteps=${gd.pathSteps} pathEnd=(${gd.pathEnd.x.toFixed(3)},${gd.pathEnd.y.toFixed(3)}) redPx=${s.red}`);
}
await browser.close();
