import { chromium } from "playwright";
import { launchGL } from "../tools/gl-launch.mjs";
import { sleep, waitIdle } from "./h.mjs";
import { resolve } from "node:path";
const BASE = process.argv[2] ?? "http://localhost:4184";
const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(BASE + "/?step=18", { waitUntil: "load" });
await page.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
await waitIdle(page);
const sb = await page.locator("#stage-wrap").boundingBox();
const clip = { x: Math.round(sb.x + sb.width * 0.42), y: Math.round(sb.y + sb.height * 0.16), width: Math.round(sb.width * 0.46), height: Math.round(sb.height * 0.44) };
console.log("clip:", JSON.stringify(clip));
await page.screenshot({ path: resolve("qa-int/shots/diag-dark-crop.png"), clip });
// also a luminance histogram of the crop
const b64 = (await page.screenshot({ clip, type: "png" })).toString("base64");
const hist = await page.evaluate(async ({ b64 }) => {
  const img = new Image();
  img.src = "data:image/png;base64," + b64;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const buckets = new Array(8).fill(0);
  for (let i = 0; i < c.width * c.height; i++) {
    const lum = 0.2126 * d[i*4] + 0.7152 * d[i*4+1] + 0.0722 * d[i*4+2];
    buckets[Math.min(7, Math.floor(lum / 32))]++;
  }
  return buckets.map((b, i) => `${i*32}-${i*32+31}: ${(b / (c.width*c.height) * 100).toFixed(2)}%`).join("\n");
}, { b64 });
console.log("luminance histogram:\n" + hist);
await browser.close();
