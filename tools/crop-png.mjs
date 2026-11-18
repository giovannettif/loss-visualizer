// Crop utility for QA screenshots: renders a PNG in headless Chromium and
// screenshots a zoomed clip. Navigates straight to the file URL (the
// browser's standalone image view renders it at natural size at 0,0).
// Usage: node tools/crop-png.mjs <in.png> <out.png> <x> <y> <w> <h> [scale]
import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [inp, outp, x, y, w, h, scale] = process.argv.slice(2);
const s = Number(scale ?? 2);
const browser = await launchGL(chromium);
const page = await browser.newPage({
  viewport: { width: Math.ceil(Number(w) * s), height: Math.ceil(Number(h) * s) },
});
await page.goto(pathToFileURL(resolve(inp)).href);
// Zoom: scale the <img> the standalone viewer created (it is the only img).
await page.evaluate((sc) => {
  const img = document.querySelector("img");
  img.style.transform = `scale(${sc})`;
  img.style.transformOrigin = "0 0";
  img.style.imageRendering = "pixelated";
}, s);
await page.waitForTimeout(400);
await page.screenshot({
  path: resolve(outp),
  clip: { x: 0, y: 0, width: Number(w) * s, height: Number(h) * s },
});
await browser.close();
console.log(`cropped ${resolve(outp)}`);
