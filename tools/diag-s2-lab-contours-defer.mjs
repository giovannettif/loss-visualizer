// diag-s2-lab-contours-defer.mjs — PERF25-S2-REBUILD-COST-JANK acceptance
// probe: during a streamed §5 slider drag the LIVE rebuilds build the light
// 48-grid and skip the minimap's d3-contour ghost (setLandscape contours:
// false); the guaranteed trailing idle rebuild must restore the full 64-grid
// + contours. Reads #minimap-canvas pixels directly — contours stroke at
// "rgba(255,255,255,0.10)" (canvas alpha ≈ 26), while every other minimap
// mark (frame 0.14, needle, labels) is alpha ≥ 36 or non-white.
// Usage: node tools/diag-s2-lab-contours-defer.mjs [base]
import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";

const base = process.argv[2] ?? "http://localhost:4185";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

await page.goto(`${base}/?step=13`, { waitUntil: "load" });
await page.waitForFunction(
  () => {
    const b = document.querySelector("#boot");
    return !b || b.dataset.done === "true";
  },
  null,
  { timeout: 20000 },
).catch(() => {});
for (let i = 0; i < 80; i++) {
  const a = await page.evaluate(() => ({
    locked: window.__wp1?.locked?.() ?? true,
    animating: window.__wp1?.animating?.() ?? true,
  }));
  if (!a.locked && !a.animating) break;
  await sleep(150);
}
await sleep(600);

/**
 * Contour-pixel count: white pixels at the contour-only alpha band.
 * `region` restricts to the right third of the canvas, which the optimizer
 * trails never reach — trail overlap elsewhere varies with the race loop's
 * phase and would drown the signal (whole-canvas counts still work for the
 * live-deferred check, where the residue is tiny).
 */
const contourPx = (region) =>
  page.evaluate((region) => {
    const c = document.querySelector("#minimap-canvas");
    const ctx = c.getContext("2d");
    const x0 = region ? Math.round(c.width * 0.62) : 0;
    const x1 = region ? c.width - 8 : c.width;
    const img = ctx.getImageData(x0, 8, x1 - x0, c.height - 16).data;
    let n = 0;
    for (let i = 0; i < img.length; i += 4) {
      const a = img[i + 3];
      if (a >= 14 && a <= 32 && img[i] > 200 && img[i + 1] > 200 && img[i + 2] > 200) n++;
    }
    return n;
  }, region);

const baseline = await contourPx(false);
const baselineRegion = await contourPx(true);

// Stream a 1.6s elongation drag; sample mid-drag (well past the first live
// rebuild at ~34ms cadence), then let the trailing idle rebuild land.
const r = await page.locator("#elong-slider").boundingBox();
const y = r.y + r.height / 2;
await page.mouse.move(r.x + r.width * 0.1, y);
await page.mouse.down();
let live = -1;
let liveRegion = -1;
const steps = 64;
for (let i = 1; i <= steps; i++) {
  await page.mouse.move(r.x + r.width * (0.1 + 0.8 * (i / steps)), y);
  await sleep(25);
  if (i === 48) {
    live = await contourPx(false); // ~1.2s in, drag still held
    liveRegion = await contourPx(true);
  }
}
await page.mouse.up();
// Pin the final value (the trailing idle rebuild must land it exactly) and
// let the idle rebuild fire (180ms debounce) + margin.
await page.evaluate(() => {
  const s = document.querySelector("#elong-slider");
  s.value = "1000";
  s.dispatchEvent(new Event("input", { bubbles: true }));
});
await sleep(900);
const after = await contourPx(false);
const afterRegion = await contourPx(true);
const e = await page.evaluate(() => window.__wp1.lab().E);

console.log(`contourPx baseline(idle) = ${baseline} (trail-free region ${baselineRegion})`);
console.log(`contourPx live(1.2s into drag) = ${live}`);
console.log(`contourPx after-idle = ${after} (region ${afterRegion}); landed E = ${e.toFixed(1)}`);

let bad = 0;
const check = (id, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  [${id}] ${detail}`);
  if (!ok) bad++;
};
check("meaningful", baselineRegion > 200, `baseline region contour pixels ${baselineRegion} > 200`);
check("live-deferred", live >= 0 && live < baseline * 0.25,
  `live ${live} < 25% of baseline ${baseline} (d3-contour ghost skipped mid-drag)`);
// Region A/B: needle/ball fringe pixels vary ~25% with the race loop phase,
// the contour signal itself is 3-5x — compare same-state region counts.
check("idle-restored", afterRegion > Math.max(200, liveRegion * 3),
  `after-idle region ${afterRegion} ≥ 3× live region ${liveRegion} (idle rebuild restores contours)`);
check("value-landed", Math.abs(e - 50) < 0.5, `landed E ${e.toFixed(1)} ≈ 50 (trailing rebuild exact)`);

await browser.close();
process.exit(bad ? 1 : 0);
