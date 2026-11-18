// diag-s2-drag-orbit-combo.mjs — WP4 accept criterion probe: "smooth while
// dragging sliders and orbiting simultaneously". Real Playwright left-drag
// drives the elong slider; a synthetic pointer (pointerId 7, button 2 =
// right-drag orbit) streams pointermove events on the WebGL canvas from inside
// the page. Orbit verification = real page screenshots before/mid (the canvas
// has no preserveDrawingBuffer, so drawImage hashing is always blank).
// Baselines: orbit-only and drag-only in the same session.
// Usage: node tools/diag-s2-drag-orbit-combo.mjs [base]
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
    window.__orbitMoves = 0;
  });

const stats = async (label) => {
  const out = await page.evaluate(() => {
    const g = [...window.__perf.gaps].sort((a, b) => a - b);
    const q = (x) => g[Math.min(g.length - 1, Math.floor(x * g.length))];
    const lt = window.__perf.lt;
    return {
      frames: g.length,
      p50: +q(0.5).toFixed(1),
      p95: +q(0.95).toFixed(1),
      max: +(g[g.length - 1] ?? 0).toFixed(1),
      over32: g.filter((x) => x > 32).length,
      over50: g.filter((x) => x > 50).length,
      ltN: lt.length,
      ltSum: +lt.reduce((a, b) => a + b, 0).toFixed(0),
      orbitMoves: window.__orbitMoves ?? 0,
    };
  });
  console.log(label, JSON.stringify(out));
};

// Synthetic orbit stream control (page-side).
const orbitStart = () =>
  page.evaluate(() => {
    const cv = document.querySelector("canvas");
    const r = cv.getBoundingClientRect();
    const mk = (type, x, y, buttons) =>
      cv.dispatchEvent(
        new PointerEvent(type, {
          pointerId: 7,
          pointerType: "mouse",
          isPrimary: false,
          button: 2,
          buttons,
          clientX: x,
          clientY: y,
          bubbles: true,
        }),
      );
    let x = r.x + r.width * 0.5;
    const y = r.y + r.height * 0.5;
    mk("pointerdown", x, y, 2);
    window.__orbitStop = false;
    window.__orbitMoves = 0;
    const orbit = () => {
      if (window.__orbitStop) return;
      x += 1.5;
      window.__orbitMoves++;
      mk("pointermove", x, y, 2);
      setTimeout(orbit, 16);
    };
    orbit();
  });
const orbitStop = () =>
  page.evaluate(() => {
    window.__orbitStop = true;
    const cv = document.querySelector("canvas");
    const r = cv.getBoundingClientRect();
    cv.dispatchEvent(
      new PointerEvent("pointerup", {
        pointerId: 7,
        pointerType: "mouse",
        isPrimary: false,
        button: 2,
        buttons: 0,
        clientX: r.x + r.width * 0.5,
        clientY: r.y + r.height * 0.5,
        bubbles: true,
      }),
    );
  });

// Real slider drag, 2 passes ≈ 4s.
async function dragElong(passes = 2) {
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
  for (let p = 0; p < passes; p++) {
    const target = cur > 0.5 ? 0 : 1;
    for (let i = 1; i <= 120; i++) {
      await page.mouse.move(xAt(cur + (target - cur) * (i / 120)), sy);
      await sleep(16);
    }
    cur = target;
  }
  await page.mouse.up();
}

/* ---- baseline 1: orbit only ---- */
await reset();
await orbitStart();
await sleep(4200);
await orbitStop();
await sleep(400);
await stats("ORBIT-only      :");
await page.screenshot({ path: "qa/reverify-sec5-rebuild-cost/orbit-after.png" });

/* ---- baseline 2: drag only ---- */
await reset();
await dragElong();
await sleep(600);
await stats("DRAG-only       :");

/* ---- combo: drag + orbit simultaneously ---- */
await reset();
await orbitStart();
await dragElong();
await orbitStop();
await sleep(600);
await stats("DRAG+ORBIT combo:");

const lab = await page.evaluate(() => window.__wp1.lab());
console.log("lab:", JSON.stringify({ E: lab.E, rot: lab.rot, rebuildMs: lab.rebuildMs }));
await page.screenshot({ path: "qa/reverify-sec5-rebuild-cost/combo-after.png" });
await browser.close();
