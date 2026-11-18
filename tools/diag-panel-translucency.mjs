// Throwaway diagnostic for JUDGE-PANEL (translucent fit-inset / loss panels):
// captures ?shot=task-c normally, then hides #fit-panel/#loss-panel via CSS
// and captures again; decodes both PNGs in-page and diffs the panel rects.
// If the panels were opaque, the diff inside their rects would be ~0; any
// large diff = terrain bleeding through the translucent fill.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const PORT = process.env.PORT ?? "4197";
mkdirSync("shots/_diag_panel", { recursive: true });

const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(`http://localhost:${PORT}/?shot=task-c`, { waitUntil: "load" });
await page.waitForTimeout(1200); // same settle as tools/shots.mjs

const rects = await page.evaluate(() => {
  const r = {};
  for (const id of ["fit-panel", "loss-panel"]) {
    const el = document.getElementById(id);
    const b = el.getBoundingClientRect();
    r[id] = { x: b.x, y: b.y, w: b.width, h: b.height, visible: el.dataset.visible };
  }
  return r;
});
console.log("RECTS:", JSON.stringify(rects));

const shotA = await page.screenshot();
writeFileSync("shots/_diag_panel/with-panels.png", shotA);

await page.addStyleTag({
  content: "#fit-panel,#loss-panel{visibility:hidden !important}",
});
await page.waitForTimeout(150);
const shotB = await page.screenshot();
writeFileSync("shots/_diag_panel/panels-hidden.png", shotB);

// Diff inside each panel rect, decoded in-page (pattern from diag-fogab-flash).
const report = await page.evaluate(
  async ({ a, b, rects }) => {
    const load = (b64) =>
      new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = rej;
        img.src = "data:image/png;base64," + b64;
      });
    const imgA = await load(a);
    const imgB = await load(b);
    const c = document.createElement("canvas");
    c.width = imgA.width;
    c.height = imgA.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(imgA, 0, 0);
    const da = ctx.getImageData(0, 0, c.width, c.height).data;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(imgB, 0, 0);
    const db = ctx.getImageData(0, 0, c.width, c.height).data;

    const px = (d, x, y) => {
      const i = (y * c.width + x) * 4;
      return [d[i], d[i + 1], d[i + 2]];
    };
    const out = {};
    for (const [id, r] of Object.entries(rects)) {
      const x0 = Math.round(r.x) + 4,
        y0 = Math.round(r.y) + 4;
      const x1 = Math.round(r.x + r.w) - 4,
        y1 = Math.round(r.y + r.h) - 4;
      let n = 0,
        sum = [0, 0, 0],
        maxD = 0,
        maxAt = null,
        gte15 = 0,
        gte30 = 0;
      for (let y = y0; y < y1; y += 2) {
        for (let x = x0; x < x1; x += 2) {
          const pa = px(da, x, y),
            pb = px(db, x, y);
          const d = Math.max(
            Math.abs(pa[0] - pb[0]),
            Math.abs(pa[1] - pb[1]),
            Math.abs(pa[2] - pb[2]),
          );
          if (d > maxD) {
            maxD = d;
            maxAt = [x, y, pa, pb];
          }
          if (d >= 15) gte15++;
          if (d >= 30) gte30++;
          for (let k = 0; k < 3; k++) sum[k] += pa[k];
          n++;
        }
      }
      out[id] = {
        samples: n,
        meanPanelRGB: sum.map((s) => Math.round(s / n)),
        maxChannelDelta: maxD,
        maxAt: maxAt,
        pctDeltaGte15: +((gte15 / n) * 100).toFixed(1),
        pctDeltaGte30: +((gte30 / n) * 100).toFixed(1),
      };
    }
    return out;
  },
  { a: shotA.toString("base64"), b: shotB.toString("base64"), rects },
);
console.log("DIFF:", JSON.stringify(report, null, 1));

// Sample the same terrain-adjacent strip with panels visible, for tint color.
const strip = await page.evaluate(async (b64) => {
  const img = new Image();
  img.src = "data:image/png;base64," + b64;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const px = (x, y) => {
    const i = (y * c.width + x) * 4;
    return [d[i], d[i + 1], d[i + 2]];
  };
  return {
    lossPanelTopRight: px(300, 404),
    lossPanelMid: px(300, 440),
    fitPanelRight: px(330, 350),
    fitPanelTopLeftDark: px(30, 80),
  };
}, shotA.toString("base64"));
console.log("TINT-SAMPLES:", JSON.stringify(strip));

await browser.close();
