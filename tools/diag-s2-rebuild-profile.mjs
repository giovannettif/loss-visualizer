// diag-s2-rebuild-profile.mjs — SEC5-S2-REBUILD-COST-JANK: (a) CDP CPU profile
// of an elong drag (names the hot functions), (b) WP4 combo check: slider drag
// + orbit simultaneously. Usage: node tools/diag-s2-rebuild-profile.mjs [base]
import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";

const base = process.argv[2] ?? "http://localhost:4185";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await launchGL(chromium);
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
await ctx.addInitScript(() => {
  const P = (window.__perf = { gaps: [], last: null, lt: [] });
  const tick = (now) => {
    if (P.last != null) P.gaps.push(now - P.last);
    P.last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) P.lt.push(e.duration);
    }).observe({ type: "longtask", buffered: true });
  } catch {}
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

const reset = () =>
  page.evaluate(() => {
    window.__perf.gaps.length = 0;
    window.__perf.lt.length = 0;
  });

const gapStats = async (label) => {
  const out = await page.evaluate(() => {
    const g = [...window.__perf.gaps].sort((a, b) => a - b);
    const lt = window.__perf.lt;
    const q = (x) => g[Math.min(g.length - 1, Math.floor(x * g.length))];
    return {
      frames: g.length,
      p50: +q(0.5).toFixed(1),
      p95: +q(0.95).toFixed(1),
      max: +(g.at(-1) ?? 0).toFixed(1),
      over32: g.filter((x) => x > 32).length,
      over50: g.filter((x) => x > 50).length,
      ltN: lt.length,
      ltSum: +lt.reduce((a, b) => a + b, 0).toFixed(0),
      ltMax: lt.length ? +Math.max(...lt).toFixed(0) : 0,
    };
  });
  console.log(label, JSON.stringify(out));
  return out;
};

// 2-pass drag (verbatim cadence from the finding's probe).
async function drag(sel, seconds = 3.0) {
  const box = await page.locator(sel).boundingBox();
  const y = box.y + box.height / 2;
  const val = await page.$eval(
    sel,
    (e) => (Number(e.value) - Number(e.min)) / (Number(e.max) - Number(e.min)),
  );
  const xAt = (t) => box.x + 8 + (box.width - 16) * t;
  await page.mouse.move(xAt(val), y);
  await page.mouse.down();
  let cur = val;
  const steps = Math.round(seconds * 1000 / 16);
  for (let p = 0; p < 2; p++) {
    const target = cur > 0.5 ? 0 : 1;
    for (let i = 1; i <= steps / 2; i++) {
      await page.mouse.move(xAt(cur + (target - cur) * ((i * 2) / steps)), y);
      await sleep(16);
    }
    cur = target;
  }
  await page.mouse.up();
}

/* ---- (a) CDP CPU profile during ELONG drag ---- */
await reset();
const cdp = await page.context().newCDPSession(page);
await cdp.send("Profiler.enable");
await cdp.send("Profiler.start");
await drag("#elong-slider");
await sleep(600);
const { profile } = await cdp.send("Profiler.stop");
await gapStats("ELONG-drag gaps:");

// Sum self time per (functionName,url,lineNumber).
const nodesById = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
for (const id of profile.samples ?? []) {
  self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas?.shift() ?? 1000));
}
const rows = [];
for (const [id, us] of self) {
  const n = nodesById.get(id);
  if (!n) continue;
  const cf = n.callFrame;
  const url = (cf.url || "").replace(/^.*\/(assets|src|node_modules)\//, "$1/");
  rows.push({
    fn: cf.functionName || "(anon)",
    url: `${url}:${cf.lineNumber + 1}`,
    us: Math.round(us / 1000), // ms total
  });
}
rows.sort((a, b) => b.us - a.us);
console.log("--- top self-time (ms, whole drag incl. rAF/render baseline) ---");
for (const r of rows.slice(0, 25)) console.log(`${String(r.us).padStart(6)}ms  ${r.fn}  ${r.url}`);

/* ---- (b) WP4 combo: elong drag + orbit simultaneously ---- */
// Orbit = left-drag on the canvas; drag the slider with a second "pointer" is
// not possible with one mouse, so interleave: hold the slider drag and, each
// 8th move, also nudge the camera with small canvas drags (down-move-up), which
// is exactly the human "drag slider while orbiting" pattern.
await reset();
{
  const box = await page.locator("#elong-slider").boundingBox();
  const y = box.y + box.height / 2;
  const cv = await page.locator("canvas").first().boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, y);
  await page.mouse.down();
  const steps = 180;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    // slider sweeps 0.5 -> 0 -> 1 -> 0.5
    const frac =
      t < 0.25 ? 0.5 * (1 - t / 0.25) : t < 0.75 ? (t - 0.25) / 0.5 : 1 - (t - 0.75) / 0.25;
    await page.mouse.move(box.x + 8 + (box.width - 16) * frac, y);
    await sleep(14);
    if (i % 8 === 0) {
      // a quick orbit nudge on the canvas (separate gesture)
      await page.mouse.move(cv.x + cv.width * 0.5, cv.y + cv.height * 0.5);
      await page.mouse.down();
      await page.mouse.move(cv.x + cv.width * 0.5 + 40, cv.y + cv.height * 0.5 + 8, { steps: 2 });
      await page.mouse.up();
      await page.mouse.move(box.x + 8 + (box.width - 16) * frac, y);
    }
  }
  await page.mouse.up();
}
await sleep(600);
await gapStats("ELONG+ORBIT combo gaps:");
await page.screenshot({ path: "qa/reverify-sec5-rebuild-cost/combo-after.png" });

await browser.close();
