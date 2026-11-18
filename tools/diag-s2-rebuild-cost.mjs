// diag-s2-rebuild-cost.mjs — SEC5-S2-REBUILD-COST-JANK repro.
// 3s continuous slider drags on the §5 lab with PerformanceObserver long-task
// capture + rAF gap sampling, on hardware GL (launchGL). Mirrors the t12/t12b
// methodology from the finding. Usage: node tools/diag-s2-rebuild-cost.mjs [base]
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
// Wait for reader unlock + director idle (entry tweens).
for (let i = 0; i < 80; i++) {
  const a = await page.evaluate(() => ({
    locked: window.__wp1?.locked?.() ?? true,
    animating: window.__wp1?.animating?.() ?? true,
  }));
  if (!a.locked && !a.animating) break;
  await sleep(250);
}
await sleep(600);

const scene = await page.evaluate(() => window.__wp1.scene());
console.log("scene:", scene);

// GL backend sanity (is this really hardware GL?)
const glInfo = await page.evaluate(() => {
  const cv = document.querySelector("canvas");
  const gl = cv?.getContext("webgl2") ?? cv?.getContext("webgl");
  if (!gl) return { backend: "none" };
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  return {
    backend: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
  };
});
console.log("GL:", glInfo.backend);

// Instrument: long tasks + rAF gaps + rebuildMs capture.
await page.evaluate(() => {
  window.__perf = { gaps: [], longTasks: [], rebuilds: [], lastRebuildMs: null };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__perf.longTasks.push(e.duration);
    }).observe({ entryTypes: ["longtask"] });
  } catch {}
  let last = performance.now();
  const tick = (t) => {
    window.__perf.gaps.push(t - last);
    last = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  // Poll rebuildMs (updated per landed rebuild by the director throttle).
  const poll = () => {
    const ms = window.__wp1?.lab?.()?.rebuildMs;
    if (typeof ms === "number" && ms > 0 && ms !== window.__perf.lastRebuildMs) {
      window.__perf.lastRebuildMs = ms;
      window.__perf.rebuilds.push(ms);
    }
    if (window.__perf.polling) setTimeout(poll, 30);
  };
  window.__perf.polling = true;
  poll();
});

const stats = (arr) => {
  if (!arr.length) return { n: 0 };
  const s = [...arr].sort((a, b) => a - b);
  const p = (q) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return {
    n: arr.length,
    p50: +p(0.5).toFixed(1),
    p95: +p(0.95).toFixed(1),
    max: +Math.max(...arr).toFixed(1),
    sum: +arr.reduce((a, b) => a + b, 0).toFixed(1),
  };
};

async function dragSlider(id, fromFrac, toFrac, seconds) {
  const r = await page.locator(`#${id}`).boundingBox();
  const y = r.y + r.height / 2;
  await page.mouse.move(r.x + r.width * fromFrac, y);
  await page.mouse.down();
  const steps = 60;
  const dt = (seconds * 1000) / steps;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(
      r.x + r.width * (fromFrac + (toFrac - fromFrac) * (i / steps)),
      y,
    );
    await sleep(dt);
  }
  await page.mouse.up();
}

async function measure(label, id) {
  await page.evaluate(() => {
    window.__perf.gaps.length = 0;
    window.__perf.longTasks.length = 0;
    window.__perf.rebuilds.length = 0;
    window.__perf.lastRebuildMs = null;
  });
  // Round-trip drag: 3s continuous.
  await dragSlider(id, 0.0, 1.0, 1.5);
  await dragSlider(id, 1.0, 0.0, 1.5);
  await sleep(400); // let the trailing idle rebuild land
  const perf = await page.evaluate(() => ({
    gaps: window.__perf.gaps.slice(2),
    longTasks: window.__perf.longTasks,
    rebuilds: window.__perf.rebuilds,
  }));
  const g = stats(perf.gaps);
  const lt = stats(perf.longTasks);
  const rb = stats(perf.rebuilds);
  const fps = 1000 / (g.sum / Math.max(g.n, 1));
  console.log(
    `${label}: rAF gaps n=${g.n} p50=${g.p50}ms p95=${g.p95}ms max=${g.max}ms avg=${(g.sum / Math.max(g.n, 1)).toFixed(1)}ms (~${fps.toFixed(0)}fps) | longTasks n=${lt.n ?? 0} sum=${lt.sum ?? 0}ms max=${lt.max ?? 0}ms | rebuildMs n=${rb.n ?? 0} p50=${rb.p50 ?? "-"}ms max=${rb.max ?? "-"}ms samples=${JSON.stringify(perf.rebuilds)}`,
  );
  return { g, lt, rb };
}

const p = await page.evaluate(() => ({
  locked: window.__wp1.locked(),
  animating: window.__wp1.animating(),
}));
console.log("pre-drag state:", JSON.stringify(p));

await sleep(1500); // idle baseline
const idleGaps = await page.evaluate(() => {
  return new Promise((res) => {
    const gaps = [];
    let last = performance.now();
    let n = 0;
    const tick = (t) => {
      gaps.push(t - last);
      last = t;
      if (++n < 120) requestAnimationFrame(tick);
      else res(gaps.slice(2));
    };
    requestAnimationFrame(tick);
  });
});
console.log("idle rAF gaps:", JSON.stringify(stats(idleGaps)));

const rot = await measure("ROT-DRAG 3s", "rot-slider");
const elong = await measure("ELONG-DRAG 3s", "elong-slider");

// Final landed value exactness (throttle must land the final value).
await page.evaluate(() => {
  const s = document.querySelector("#elong-slider");
  s.value = "1000";
  s.dispatchEvent(new Event("input", { bubbles: true }));
});
await sleep(600);
const finalE = await page.evaluate(() => window.__wp1.lab().E);
console.log("final landed E after idle:", finalE.toFixed(1), "(expected 50)");

await browser.close();
