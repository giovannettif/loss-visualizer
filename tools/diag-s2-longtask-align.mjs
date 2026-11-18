// diag-s2-longtask-align.mjs — correlates long tasks (start/duration) with
// landed §5 rebuilds (rebuildMs sampled at 25ms cadence + slider position),
// so the fix targets the right layer (JS rebuild vs driver/render stall).
// Usage: node tools/diag-s2-longtask-align.mjs [base]
import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";

const base = process.argv[2] ?? "http://localhost:4185";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await launchGL(chromium);
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
await ctx.addInitScript(() => {
  const P = (window.__perf = { lt: [], samples: [], t0: 0, on: false });
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        if (P.on) P.lt.push({ s: e.startTime - P.t0, d: e.duration });
      }
    }).observe({ type: "longtask", buffered: false });
  } catch {}
  window.__startPerf = () => {
    P.t0 = performance.now();
    P.lt.length = 0;
    P.samples.length = 0;
    P.on = true;
    (async () => {
      while (P.on) {
        const st = window.__wp1.lab();
        P.samples.push({
          t: performance.now() - P.t0,
          ms: st.rebuildMs,
          E: Math.round(st.E * 10) / 10,
        });
        await new Promise((r) => setTimeout(r, 25));
      }
    })();
  };
  window.__stopPerf = () => {
    P.on = false;
    return { lt: P.lt, samples: P.samples };
  };
});
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

await page.goto(`${base}/?step=13`, { waitUntil: "load" });
await page.waitForFunction(() => !!window.__wp1, null, { timeout: 20000 });
const t0 = Date.now();
while (Date.now() - t0 < 20000) {
  const a = await page.evaluate(() => ({
    l: window.__wp1?.locked?.() ?? true,
    a: window.__wp1?.animating?.() ?? true,
  }));
  if (!a.l && !a.a) break;
  await sleep(200);
}
await sleep(500);

await page.evaluate(() => window.__startPerf());
const box = await page.locator("#elong-slider").boundingBox();
const sy = box.y + box.height / 2;
const val = await page.$eval(
  "#elong-slider",
  (e) => (Number(e.value) - Number(e.min)) / (Number(e.max) - Number(e.min)),
);
const xAt = (t) => box.x + 8 + (box.width - 16) * t;
await page.mouse.move(xAt(val), sy);
await page.mouse.down();
let cur = val;
for (let p = 0; p < 2; p++) {
  const target = cur > 0.5 ? 0 : 1;
  for (let i = 1; i <= 120; i++) {
    await page.mouse.move(xAt(cur + (target - cur) * (i / 120)), sy);
    await sleep(16);
  }
  cur = target;
}
await page.mouse.up();
await sleep(1200); // include the trailing idle rebuild in the window
const { lt, samples } = await page.evaluate(() => window.__stopPerf());

console.log("long tasks:", JSON.stringify(lt));
// Collapse rebuildMs samples into events (value changes = a rebuild landed).
const ev = [];
for (const s of samples) {
  if (s.ms > 0 && (ev.length === 0 || ev[ev.length - 1].ms !== s.ms)) ev.push(s);
}
console.log("rebuild events (t, rebuildMs, E):");
for (const e of ev) console.log(`  t=${e.t.toFixed(0).padStart(5)}ms rebuild=${e.ms.toFixed(1).padStart(5)}ms E=${e.E}`);
await browser.close();
