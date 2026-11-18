// Region crop: qa-axis-crop.mjs <in.png> <out.png> <x> <y> <w> <h> [scale]
import { chromium } from "playwright";
import { launchGL } from "./tools/gl-launch.mjs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [inp, outp, x, y, w, h, scale] = process.argv.slice(2);
const s = Number(scale ?? 2);
const browser = await launchGL(chromium);
const page = await browser.newPage({
  viewport: { width: Math.ceil(Number(w) * s), height: Math.ceil(Number(h) * s) },
});
await page.goto(pathToFileURL(resolve(inp)).href);
await page.evaluate(({ sc, tx, ty }) => {
  const img = document.querySelector("img");
  img.style.transformOrigin = "0 0";
  img.style.transform = `translate(${tx}px, ${ty}px) scale(${sc})`;
  img.style.imageRendering = "pixelated";
}, { sc: s, tx: -Number(x), ty: -Number(y) });
await page.waitForTimeout(400);
await page.screenshot({
  path: resolve(outp),
  clip: { x: 0, y: 0, width: Number(w) * s, height: Number(h) * s },
});
await browser.close();
console.log(`cropped ${resolve(outp)}`);
