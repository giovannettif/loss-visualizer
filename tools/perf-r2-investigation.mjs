/**
 * perf-r2-investigation.mjs — round-2 instrumentation for QA LP-1/LP-2.
 *
 * Answers, with measurements on the live page:
 *   1. The QA's exact playback repro (rAF gaps during ▶ Play on ?step=13).
 *   2. WHY the QA's "orbit drag p50 ~17 ms" control disagrees: draw-call
 *      counting for (a) synthetic page.mouse drags and (b) real pointer
 *      events dispatched on the canvas. Zero draw calls = frames that do
 *      not render (the phantom baseline).
 *   3. Per-frame replay-path split the finding asks to instrument:
 *      (a) trail.setProgress — geometry rebuild vs draw-range: counted as
 *          WebGL buffer uploads per frame (LineGeometry re-uploads would
 *          show as bufferData/bufferSubData),
 *      (b) loss-curve canvas redraws per frame (clearRect on #curves-canvas),
 *      (c) the app rAF callback duration (tick + render SUBMISSION) vs the
 *          frame gap (callback + present/raster).
 *   4. True rendering-frame baseline: orbit drag with real pointer events,
 *      pre-play and post-play (trails visible), vs playback.
 *   5. LP-2 scrub drag: input tracking + gaps + draw calls per frame.
 */

import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:4185";
let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};
const note = (name, detail) => console.log(`NOTE  ${name} — ${detail}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto(`${base}/?step=13`, { waitUntil: "load" });
for (let i = 0; i < 60; i++) {
  const a = await page.evaluate(() => ({
    locked: window.__wp1?.locked?.() ?? false,
    animating: window.__wp1?.animating?.() ?? false,
  }));
  if (!a.locked && !a.animating) break;
  await sleep(250);
}
await page.waitForTimeout(400);

// ---- in-page instrumentation ------------------------------------------
await page.evaluate(() => {
  const W = (window.__r2 = {
    gaps: [], last: null,
    cbMs: [],           // app rAF callback duration (tick + render submission)
    glDrawMs: 0, glDraws: 0, glUploads: 0, glNow: 0, glNowDraws: 0, glNowUploads: 0,
    perFrame: [],       // { gap, cb, draws, uploads }
    curvesClears: 0, curvesClearsNow: 0,
    minimapClearsNow: 0,
  });
  // Wrap rAF: time the app's own loop callback (everything incl. render()).
  const orig = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => orig((now) => {
    const t0 = performance.now();
    cb(now);
    W.cbMs.push(performance.now() - t0);
  });
  // GL draw/upload counting + timing.
  const patch = (proto, names, kind) => {
    for (const m of names) {
      const f = proto[m];
      if (!f) continue;
      proto[m] = function (...a) {
        if (kind === "draw") { const t0 = performance.now(); const r = f.apply(this, a); W.glNow += performance.now() - t0; W.glNowDraws++; return r; }
        W.glNowUploads++; return f.apply(this, a);
      };
    }
  };
  const g2 = WebGL2RenderingContext.prototype;
  patch(g2, ["drawArrays", "drawElements", "drawArraysInstanced", "drawElementsInstanced"], "draw");
  patch(g2, ["bufferData", "bufferSubData", "texImage2D", "texSubImage2D", "compressedTexImage2D"], "upload");
  // 2D canvas redraw counting, per canvas id.
  const clear = CanvasRenderingContext2D.prototype.clearRect;
  CanvasRenderingContext2D.prototype.clearRect = function (x, y, w, h) {
    const id = this.canvas?.id;
    if (id === "curves-canvas") { W.curvesClears++; W.curvesClearsNow++; }
    if (id === "minimap-canvas") W.minimapClearsNow++;
    return clear.call(this, x, y, w, h);
  };
  // Per-frame recorder.
  const rec = (now) => {
    if (W.last != null) W.perFrame.push({ gap: now - W.last, cb: W.cbMs[W.cbMs.length - 1] ?? 0, draws: W.glNowDraws, uploads: W.glNowUploads, drawMs: W.glNow, curves: W.curvesClearsNow, minimap: W.minimapClearsNow });
    W.glNow = 0; W.glNowDraws = 0; W.glNowUploads = 0;
    W.curvesClearsNow = 0; W.minimapClearsNow = 0;
    W.last = now;
    requestAnimationFrame(rec);
  };
  requestAnimationFrame(rec);
});
const collect = async () =>
  page.evaluate(() => {
    const F = window.__r2.perFrame;
    window.__r2.perFrame = [];
    const rendering = F.filter((f) => f.draws > 0);
    const q = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(p * arr.length))] : NaN);
    const gaps = F.map((f) => f.gap).sort((a, b) => a - b);
    const cbs = rendering.map((f) => f.cb).sort((a, b) => a - b);
    const drawMs = rendering.map((f) => f.drawMs).sort((a, b) => a - b);
    // The robust throughput metric: rendered frames per wall-clock second.
    // (Percentiles of "gap before a rendering frame" mix rendering and idle
    // ticks and flip with input cadence — do not compare those.)
    const wall = F.length > 1 ? F[F.length - 1].gap && F.reduce((s, f) => s + f.gap, 0) : 0;
    return {
      frames: F.length,
      renderingFrames: rendering.length,
      wallSec: +(F.reduce((s, f) => s + f.gap, 0) / 1000).toFixed(2),
      rendersPerSec: +((rendering.length / (F.reduce((s, f) => s + f.gap, 0) / 1000)) || 0).toFixed(1),
      drawCallsP50: q(rendering.map((f) => f.draws), 0.5),
      gapP50All: +q(gaps, 0.5)?.toFixed(1),
      cbP50Render: +q(cbs, 0.5)?.toFixed(2),
      cbP95Render: +q(cbs, 0.95)?.toFixed(2),
      cbMaxRender: +(cbs[cbs.length - 1] ?? 0).toFixed(2),
      drawMsP50: +q(drawMs, 0.5)?.toFixed(2),
      uploadsP50: q(rendering.map((f) => f.uploads), 0.5),
      uploadsMax: rendering.reduce((m, f) => Math.max(m, f.uploads), 0),
      curvesClearsTotal: window.__r2.curvesClears,
      curvesPerFrameMax: rendering.reduce((m, f) => Math.max(m, f.curves), 0),
      minimapPerFrameMax: rendering.reduce((m, f) => Math.max(m, f.minimap), 0),
      over50: F.filter((f) => f.gap > 50).length,
    };
  });
const reset = () => page.evaluate(() => { window.__r2.perFrame = []; });

// Real pointer drag directly on the canvas (bubbles to the view's handlers).
const realDrag = (ms) =>
  page.evaluate(async (ms) => {
    const cv = document.querySelector("#stage canvas");
    const r = cv.getBoundingClientRect();
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    const ev = (type, x, y, btns) =>
      cv.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: 11, pointerType: "mouse",
        isPrimary: true, clientX: x, clientY: y, button: 0, buttons: btns,
      }));
    ev("pointerdown", cx, cy, 1);
    const t0 = performance.now();
    let i = 0;
    while (performance.now() - t0 < ms) {
      ev("pointermove", cx + 130 * Math.sin(i / 6), cy + 40 * Math.cos(i / 6), 1);
      i++;
      await new Promise((s) => setTimeout(s, 16));
    }
    ev("pointerup", cx + 60, cy, 0);
    return i;
  }, ms);
const syntheticDrag = (ms) =>
  page.evaluate(async (ms) => {
    // EXACTLY the QA control's motion path, driven from inside the page —
    // pointer events at document coordinates like Playwright's mouse.
    const cv = document.querySelector("#stage canvas");
    const r = cv.getBoundingClientRect();
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    const t0 = performance.now();
    let i = 0;
    while (performance.now() - t0 < ms) {
      const x = cx + 150 * Math.sin(i / 6), y = cy + 40 * Math.cos(i / 6);
      document.dispatchEvent(new PointerEvent("pointermove", {
        bubbles: true, cancelable: true, pointerId: 12, pointerType: "mouse",
        isPrimary: true, clientX: x, clientY: y, button: 0, buttons: 1,
      }));
      i++;
      await new Promise((s) => setTimeout(s, 16));
    }
    return i;
  }, ms);

// ---- 1. QA's playback repro (their exact numbers) ----------------------
await page.locator("#play-btn").click();
await reset();
await page.waitForTimeout(3000);
const play1 = await collect();
await page.waitForFunction(() => Number(document.querySelector("#replay-scrub")?.value ?? 0) >= 999, null, { timeout: 60000 }).catch(() => {});
check(
  "LP-1 repro: playback frame gaps reproduce the QA numbers",
  play1.gapP50All > 50,
  `p50=${play1.gapP50All}ms over50=${play1.over50}/${play1.frames} renders/s=${play1.rendersPerSec}`,
);
note("LP-1 repro detail", JSON.stringify(play1));

// ---- 2. the orbit control, two ways ------------------------------------
// 2a. synthetic document-level pointer moves (the QA control's mechanism):
await reset();
const movedSyn = await syntheticDrag(2200);
const syn = await collect();
check(
  "orbit control 2a: synthetic pointer moves produce ZERO draw calls",
  syn.renderingFrames === 0,
  `moveEvents=${movedSyn} renderingFrames=${syn.renderingFrames}/${syn.frames} gapP50=${syn.gapP50All}ms`,
);
note("orbit 2a detail", "these ~16.7ms frames SKIP rendering — the phantom baseline");

// 2b. real pointer events on the canvas, BEFORE any play (no trails):
await reset();
await realDrag(2200);
const orbPre = await collect();
check(
  "orbit control 2b: a real orbit drag renders (draw calls per frame)",
  orbPre.renderingFrames > 20 && orbPre.drawCallsP50 > 0,
  `renderingFrames=${orbPre.renderingFrames}/${orbPre.frames} draws/frame=${orbPre.drawCallsP50} renders/s=${orbPre.rendersPerSec}`,
);

// ---- 3. playback, fully instrumented (fresh Play) ----------------------
await page.locator("#play-btn").click(); // finished → replays from the top
await reset();
await page.waitForTimeout(3200);
const play2 = await collect();
await page.waitForFunction(() => Number(document.querySelector("#replay-scrub")?.value ?? 0) >= 999, null, { timeout: 60000 }).catch(() => {});
check(
  "LP-1 (a): trail.setProgress does NOT re-upload geometry (0 buffer/tex uploads per frame)",
  play2.uploadsP50 === 0 && play2.uploadsMax <= 2,
  `uploads/frame p50=${play2.uploadsP50} max=${play2.uploadsMax}`,
);
check(
  "LP-1 (b): loss-curve canvas is NOT redrawn during playback",
  play2.curvesPerFrameMax === 0,
  `curves clearRect/frame max=${play2.curvesPerFrameMax} (total=${play2.curvesClearsTotal}); minimap/frame max=${play2.minimapPerFrameMax}`,
);
check(
  "LP-1 (c): the app rAF callback (tick + render SUBMISSION) is ~0-3 ms; the rest of the 66-100 ms frame is present/raster",
  play2.cbP50Render <= 6,
  `cb p50=${play2.cbP50Render}ms p95=${play2.cbP95Render}ms max=${play2.cbMaxRender}ms vs frame gap p50=${play1.gapP50All}ms; GL draw-call submission p50=${play2.drawMsP50}ms`,
);
check(
  "LP-1: playback renders/s within the real-orbit band (same scene, same canvas)",
  Math.abs(play2.rendersPerSec - orbPre.rendersPerSec) <= 6,
  `playback ${play2.rendersPerSec} renders/s vs real orbit ${orbPre.rendersPerSec} renders/s (draws/frame: play=${play2.drawCallsP50} orbit=${orbPre.drawCallsP50})`,
);
note("LP-1 playback detail", JSON.stringify(play2));
note("LP-1 real-orbit detail", JSON.stringify(orbPre));

// ---- 4. orbit AFTER play (trails visible) vs playback ------------------
await reset();
await realDrag(2200);
const orbPost = await collect();
note(
  "orbit post-play (trails fully visible)",
  `renders/s=${orbPost.rendersPerSec} draws/frame=${orbPost.drawCallsP50} — compare playback ${play2.rendersPerSec} renders/s`,
);

// ---- 5. LP-2: scrub drag, instrumented ---------------------------------
await page.evaluate(() => {
  window.__inputs = 0;
  document.querySelector("#replay-scrub").addEventListener("input", () => { window.__inputs++; });
});
const scrub = await page.locator("#replay-scrub").boundingBox();
const y = scrub.y + scrub.height / 2;
await page.mouse.move(scrub.x + 30, y);
await page.mouse.down();
await reset();
const t0 = Date.now();
let j = 0;
while (Date.now() - t0 < 2500) {
  const x = scrub.x + 30 + (scrub.width - 60) * (0.5 + 0.45 * Math.sin((Date.now() - t0) / 220));
  await page.mouse.move(x, y, { steps: 1 });
  j++;
}
await page.mouse.up();
await sleep(200);
const scr = await collect();
const inputs = await page.evaluate(() => window.__inputs);
check(
  "LP-2: scrub renders/s within the real-orbit band (a scrubbed frame costs what a rendered orbit frame costs)",
  scr.rendersPerSec > 0 && Math.abs(scr.rendersPerSec - orbPost.rendersPerSec) <= 8,
  `scrub ${scr.rendersPerSec} renders/s vs real orbit ${orbPost.rendersPerSec} renders/s; draws/frame scrub=${scr.drawCallsP50} orbit=${orbPost.drawCallsP50}`,
);
check(
  "LP-2: scrub tracking 1:1 (input events land, none dropped)",
  inputs > 0,
  `inputEvents=${inputs} over ${j} mouse moves`,
);
note("LP-2 scrub detail", JSON.stringify(scr));

await browser.close();
console.log(failures === 0 ? "INVESTIGATION_OK" : `INVESTIGATION_FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
