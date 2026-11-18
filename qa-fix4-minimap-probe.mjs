/**
 * qa-fix4-minimap-probe — defect 1 root-cause probe (stray purple arrow on gd-b).
 *
 * Boots ?step=5 (gd-b), draws an arrow on the compass minimap, then scans
 * #minimap-canvas pixels and reports every colored cluster (bounding boxes)
 * for: GD red #FC6255, white (user arrow / learner dot), needle purple
 * #9A72AC, spotlight lavender #C9A6DD, and ANY other saturated purple-ish
 * run of pixels. Also dumps director gd state + a screenshot.
 *
 * Usage: node qa-fix4-minimap-probe.mjs [baseUrl]
 */
import { chromium } from "playwright";
import { launchGL } from "./tools/gl-launch.mjs";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const base = process.argv[2] ?? "http://localhost:5173";
mkdirSync("qa-fix4-shots", { recursive: true });

const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitIdle(maxMs = 25000) {
  const t0 = Date.now();
  for (;;) {
    const a = await page.evaluate(() => ({
      locked: window.__wp1?.locked?.(),
      animating: window.__wp1?.animating?.(),
    }));
    if (!a.locked && !a.animating) return true;
    if (Date.now() - t0 > maxMs) return false;
    await sleep(200);
  }
}

/** Connected-component scan of the minimap canvas for a color class. */
const scanColors = (tol) =>
  page.evaluate((tolerance) => {
    const cv = document.querySelector("#minimap-canvas");
    if (!cv) return { error: "no minimap canvas" };
    const g = cv.getContext("2d");
    const W = cv.width;
    const H = cv.height;
    const img = g.getImageData(0, 0, W, H).data;
    const classes = {
      gdRed: { r: 252, g: 98, b: 85 },
      white: { r: 250, g: 250, b: 250 },
      needlePurple: { r: 154, g: 114, b: 172 },
      lavender: { r: 201, g: 166, b: 221 },
    };
    const label = new Int32Array(W * H).fill(-1);
    const out = {};
    for (const [name, c] of Object.entries(classes)) {
      const boxes = [];
      const id = boxes.length;
      // flood fill via simple stack over matching pixels
      const match = (k) => {
        const i = k * 4;
        return (
          img[i] >= c.r - tolerance && img[i] <= c.r + tolerance &&
          img[i + 1] >= c.g - tolerance && img[i + 1] <= c.g + tolerance &&
          img[i + 2] >= c.b - tolerance && img[i + 2] <= c.b + tolerance &&
          img[i + 3] > 60
        );
      };
      const seen = new Uint8Array(W * H);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const k = y * W + x;
          if (seen[k] || !match(k)) continue;
          // BFS
          const stack = [k];
          seen[k] = 1;
          let n = 0;
          let x0 = x, x1 = x, y0 = y, y1 = y;
          while (stack.length) {
            const q = stack.pop();
            const qx = q % W;
            const qy = (q - qx) / W;
            n++;
            if (qx < x0) x0 = qx;
            if (qx > x1) x1 = qx;
            if (qy < y0) y0 = qy;
            if (qy > y1) y1 = qy;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const nx2 = qx + dx;
              const ny2 = qy + dy;
              if (nx2 < 0 || ny2 < 0 || nx2 >= W || ny2 >= H) continue;
              const nk = ny2 * W + nx2;
              if (seen[nk] || !match(nk)) continue;
              seen[nk] = 1;
              stack.push(nk);
            }
          }
          if (n >= 6) {
            boxes.push({ px: n, box: [x0, y0, x1, y1], w: x1 - x0 + 1, h: y1 - y0 + 1 });
          }
        }
      }
      boxes.sort((a, b) => b.px - a.px);
      out[name] = boxes.slice(0, 8);
    }
    return { W, H, dpr: window.devicePixelRatio, ...out };
  }, tol);

console.log("=== boot ?step=5 (gd-b), before any draw ===");
await page.goto(`${base}/?step=5`, { waitUntil: "load" });
await sleep(1800);
await waitIdle();
{
  const st = await page.evaluate(() => ({
    scene: window.__wp1?.scene?.(),
    step: window.__wp1?.step?.(),
    gd: window.__wp1?.gd?.(),
  }));
  console.log("state:", JSON.stringify(st));
  const s0 = await scanColors(30);
  console.log("BEFORE DRAW clusters:", JSON.stringify(s0, null, 1));
  await page.screenshot({ path: resolve("qa-fix4-shots", "gdb-before.png") });
}

console.log("=== draw an arrow on the compass (same gesture as gate-tour) ===");
{
  const box = await page.locator("#minimap-canvas").boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx + 10, cy + 40);
  await page.mouse.down();
  await page.mouse.move(cx + 62, cy + 80, { steps: 8 });
  await page.mouse.up();
  await sleep(1500); // the GD step grow animation drains
  await waitIdle();
  const st = await page.evaluate(() => ({
    gd: window.__wp1?.gd?.(),
    commits: undefined,
  }));
  console.log("gd state after draw:", JSON.stringify(st));
  const s1 = await scanColors(30);
  console.log("AFTER DRAW clusters:", JSON.stringify(s1, null, 1));
  await page.screenshot({ path: resolve("qa-fix4-shots", "gdb-after.png") });
}

// Also a tight-tolerance pass on the AFTER state to separate near-identical colors.
{
  const s2 = await scanColors(10);
  console.log("AFTER DRAW clusters (tol 10):", JSON.stringify(s2, null, 1));
}

await browser.close();
console.log("PROBE_DONE");
