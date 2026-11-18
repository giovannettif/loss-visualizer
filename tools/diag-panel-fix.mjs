// Fix-verification: inject --panel:#0d1014 override at runtime (no file edit),
// re-capture ?shot=task-c, re-sample the bleed points, expect flat (13,16,20).
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
const PORT = process.env.PORT ?? "4197";
mkdirSync("shots/_diag_panel", { recursive: true });
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(`http://localhost:${PORT}/?shot=task-c`, { waitUntil: "load" });
await page.addStyleTag({ content: ":root{--panel:#0d1014 !important}" });
await page.waitForTimeout(1200);
const shot = await page.screenshot();
writeFileSync("shots/_diag_panel/fixed-opaque.png", shot);
const samples = await page.evaluate(async (b64) => {
  const img = new Image();
  img.src = "data:image/png;base64," + b64;
  await img.decode();
  const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
  const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const px = (x,y) => { const i=(y*c.width+x)*4; return [d[i],d[i+1],d[i+2]]; };
  return {
    lossPanelTopRight: px(300,404), lossPanelMid: px(300,440),
    fitPanelRight: px(330,350), fitPanelTopLeftDark: px(30,80),
  };
}, shot.toString("base64"));
console.log("FIXED-SAMPLES:", JSON.stringify(samples));
await browser.close();
