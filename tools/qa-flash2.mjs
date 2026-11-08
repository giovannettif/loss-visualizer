// Throwaway: deterministic flash verification via __wp1.flashStrideReject().
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto("http://localhost:4173/?step=15", { waitUntil: "load" });
await page.waitForTimeout(1000);

async function redCount() {
  return page.evaluate(() => {
    const cv = document.querySelector("#minimap-canvas");
    const dpr = cv.width / cv.clientWidth;
    const c = document.createElement("canvas");
    c.width = cv.width; c.height = cv.height;
    c.getContext("2d").drawImage(cv, 0, 0);
    const d = c.getContext("2d").getImageData(0, 0, cv.width, cv.height);
    let red = 0;
    for (let y = 0; y < cv.height; y++)
      for (let x = 0; x < cv.width; x++) {
        const k = (y * cv.width + x) * 4;
        const r = d.data[k], g = d.data[k + 1], b = d.data[k + 2];
        if (r > 170 && r - g > 55 && r - b > 40) red++;
      }
    return red;
  });
}

const before = await redCount();
await page.evaluate(() => window.__wp1.flashStrideReject());
await page.waitForTimeout(150); // inside the ~600ms flash
const during = await redCount();
const clip = await page.screenshot({
  clip: { x: 0, y: 560, width: 220, height: 340 },
});
writeFileSync("shots/_r8_flash2.png", clip);
await page.waitForTimeout(900); // flash expired
const after = await redCount();
const budget = await page.evaluate(() => window.__wp1.fog().used);
console.log(JSON.stringify({ redBefore: before, redDuringFlash: during, redAfterExpire: after, used: budget }, null, 1));
await browser.close();
