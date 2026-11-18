// Throwaway diagnostic for SCRUB-HITCH:
// ?step=13 (lab scene), play the replay once, then drag #replay-scrub
// continuously while recording:
//   • rAF tick gaps (the finding's metric)
//   • per-tick WebGL draw-call count + draw-call self time (render cost)
//   • long tasks (>50ms) with start/duration
//   • per-'input'-event handler cost (document-capture/bubble bracket)
// Three passes: A = paced ~60Hz drag, B = unpaced burst drag, C = idle control.
// Plus a CDP CPU profile over pass A to name hot functions.
import { chromium } from "playwright";

const PORT = process.env.PORT ?? "4193";
const URL = `http://localhost:${PORT}/?step=13`;

const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

// Pre-load instrumentation: document-level input bracketing (runs before the
// app's own #replay-scrub listener in the capture phase).
await page.addInitScript(() => {
  document.addEventListener("input", (e) => {
    if (e.target && e.target.id === "replay-scrub") window.__inpStart = performance.now();
  }, { capture: true });
});

await page.goto(URL, { waitUntil: "load" });

// Post-load instrumentation: rAF tick monitor + WebGL draw patch + longtasks.
await page.evaluate(() => {
  window.__gl = { calls: 0, ms: 0 };
  for (const proto of [window.WebGLRenderingContext?.prototype, window.WebGL2RenderingContext?.prototype]) {
    if (!proto) continue;
    for (const name of ["drawArrays", "drawElements", "drawArraysInstanced", "drawElementsInstanced"]) {
      const orig = proto[name];
      if (!orig) continue;
      proto[name] = function (...a) {
        const t0 = performance.now();
        const r = orig.apply(this, a);
        window.__gl.calls += 1;
        window.__gl.ms += performance.now() - t0;
        return r;
      };
    }
  }
  window.__ticks = [];
  window.__tasks = [];
  window.__inp = [];
  let last = null;
  const tick = (now) => {
    const gap = last == null ? null : now - last;
    last = now;
    window.__ticks.push({ t: Math.round(now), gap: gap == null ? null : +gap.toFixed(2), gl: window.__gl.calls, glMs: +window.__gl.ms.toFixed(2) });
    window.__gl.calls = 0;
    window.__gl.ms = 0;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      window.__tasks.push({ t: Math.round(e.startTime), dur: +e.duration.toFixed(1) });
    }
  }).observe({ entryTypes: ["longtask"] });
  // Bubble-side bracket (runs after the app's own listener on the element).
  document.addEventListener("input", (e) => {
    if (e.target && e.target.id === "replay-scrub") {
      window.__inp.push({ dt: +(performance.now() - (window.__inpStart ?? 0)).toFixed(2), val: e.target.value });
    }
  }, { capture: false });
});

// Wait for the reader to unlock (entry animation).
for (let i = 0; i < 60; i++) {
  const a = await page.evaluate(() => ({
    locked: window.__wp1?.locked?.() ?? true,
    animating: window.__wp1?.animating?.() ?? true,
  }));
  if (!a.locked && !a.animating) break;
  await page.waitForTimeout(250);
}
await page.waitForTimeout(500);

const pre = await page.evaluate(() => ({
  scene: window.__wp1.scene(),
  replay: window.__wp1.replayInfo(),
}));
console.log("PRE:", JSON.stringify(pre));

// Play once so the replay exists (scrub needs lanes).
await page.click("#play-btn");
await page.waitForFunction(
  () => Number(document.querySelector("#replay-scrub")?.value ?? 0) >= 999,
  null, { timeout: 45000 },
);
await page.waitForTimeout(400);
console.log("AFTER PLAY:", JSON.stringify(await page.evaluate(() => window.__wp1.replayInfo())));

const box = await page.locator("#replay-scrub").boundingBox();
const y = Math.round(box.y + box.height / 2);
const x0 = Math.round(box.x + box.width * 0.04);
const x1 = Math.round(box.x + box.width * 0.96);
console.log(`SCRUB BOX: x=${box.x} y=${box.y} w=${box.width} h=${box.height} -> drag ${x0}..${x1}`);

const cdp = await page.context().newCDPSession(page);
await cdp.send("Profiler.enable");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function drag({ paced, label }) {
  await page.evaluate(() => {
    window.__ticks.length = 0;
    window.__tasks.length = 0;
    window.__inp.length = 0;
  });
  const prof = label.startsWith("A-");
  if (prof) await cdp.send("Profiler.start");
  const t0 = Date.now();
  const N = paced ? 120 : 120; // ~2s when paced, ~0.3s burst otherwise
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: x0, y, button: "left", clickCount: 1 });
  for (let i = 1; i <= N; i++) {
    const x = Math.round(x0 + (x1 - x0) * (i / N));
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1 });
    if (paced) {
      const target = t0 + (i / N) * 2000;
      const wait = target - Date.now();
      if (wait > 0) await sleep(wait);
    }
  }
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: x1, y, button: "left", clickCount: 1 });
  const dragMs = Date.now() - t0;
  await sleep(300); // let trailing renders land
  let profile = null;
  if (prof) profile = (await cdp.send("Profiler.stop")).profile;

  const data = await page.evaluate(() => ({
    ticks: window.__ticks,
    tasks: window.__tasks,
    inp: window.__inp,
  }));

  const gaps = data.ticks.map((t) => t.gap).filter((g) => g != null);
  const sorted = [...gaps].sort((a, b) => a - b);
  const p = (q) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : NaN;
  const glTicks = data.ticks.filter((t) => t.gl > 0);
  const glSorted = glTicks.map((t) => t.glMs).sort((a, b) => a - b);
  const stats = {
    label,
    dragMs,
    frames: gaps.length,
    gapP50: +p(0.5).toFixed(1),
    gapP95: +p(0.95).toFixed(1),
    gapMax: +Math.max(...gaps).toFixed(1),
    over32: gaps.filter((g) => g > 32).length,
    over32Pct: +((100 * gaps.filter((g) => g > 32).length) / gaps.length).toFixed(1),
    inputEvents: data.inp.length,
    inpDtP50: data.inp.length ? [...data.inp.map((i) => i.dt)].sort((a, b) => a - b)[Math.floor(data.inp.length / 2)] : null,
    inpDtP95: data.inp.length ? [...data.inp.map((i) => i.dt)].sort((a, b) => a - b)[Math.floor(data.inp.length * 0.95)] : null,
    renderTicks: glTicks.length,
    renderGlMsP50: glSorted.length ? +glSorted[Math.floor(glSorted.length / 2)].toFixed(1) : null,
    renderGlMsMax: glSorted.length ? +glSorted[glSorted.length - 1].toFixed(1) : null,
    longTasks: data.tasks.length,
    longTaskDurP50: data.tasks.length ? [...data.tasks.map((t) => t.dur)].sort((a, b) => a - b)[Math.floor(data.tasks.length / 2)] : null,
  };
  console.log("STATS:", JSON.stringify(stats));

  // Hitch anatomy: for each gap > 32ms, was there GL work in the landing tick?
  const hitches = [];
  for (let i = 0; i < data.ticks.length; i++) {
    const t = data.ticks[i];
    if (t.gap != null && t.gap > 32) {
      hitches.push({ gap: t.gap, gl: t.gl, glMs: t.glMs });
    }
  }
  const hitchWithGL = hitches.filter((h) => h.gl > 0);
  console.log(`HITCHES >32ms: ${hitches.length}, of which with GL draws: ${hitchWithGL.length}`);
  if (hitches.length) {
    console.log("  sample:", JSON.stringify(hitches.slice(0, 12)));
  }
  // Long tasks vs GL ticks overlap
  console.log("LONGTASKS:", JSON.stringify(data.tasks.slice(0, 12)));

  if (profile) {
    const self = new Map();
    for (const n of profile.nodes) {
      const cf = n.callFrame;
      const key = `${cf.functionName || "(anon)"} @ ${(cf.url || "").split("/").slice(-1)[0]}:${cf.lineNumber + 1}`;
      self.set(key, (self.get(key) ?? 0) + (n.hitCount ?? 0));
    }
    const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
    console.log("TOP SELF-TIME (samples):");
    for (const [k, v] of top) console.log(`  ${String(v).padStart(6)}  ${k}`);
  }
  return stats;
}

await drag({ paced: true, label: "A-paced-60Hz" });
await page.waitForTimeout(500);
await drag({ paced: false, label: "B-burst" });
await page.waitForTimeout(500);
await drag({ paced: true, label: "A2-paced-repeat" });

// Control: idle window, no input at all.
await page.evaluate(() => { window.__ticks.length = 0; });
await sleep(2000);
const ctrl = await page.evaluate(() => {
  const gaps = window.__ticks.map((t) => t.gap).filter((g) => g != null);
  const sorted = [...gaps].sort((a, b) => a - b);
  return {
    frames: gaps.length,
    p50: sorted.length ? +sorted[Math.floor(sorted.length / 2)].toFixed(1) : null,
    p95: sorted.length ? +sorted[Math.floor(sorted.length * 0.95)].toFixed(1) : null,
    over32: gaps.filter((g) => g > 32).length,
  };
});
console.log("CONTROL idle:", JSON.stringify(ctrl));

await browser.close();
console.log("DONE");
