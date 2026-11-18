/**
 * diag-s2b26-orphan-shadows.mjs — verification probe for QA
 * S2B26-ORPHAN-SHADOWS.
 *
 * The finding: on the tilt-b → swarm and swarm → labrule crossfades the
 * outgoing balls were cut while their cloned contact-shadow decals (retired by
 * retireOverlays) kept fading alone — dark orphan spots on still-bright
 * terrain for ~0.5 s. Expected: ball and shadow fade TOGETHER (same
 * uOverlayFade), and nothing dark outlives its ball.
 *
 * Method:
 *  1. State pass: click continue ↓, sample {swap, overlayFade, retired, opac}
 *     at high cadence. Corroboration: retired > 0 through the whole out stage
 *     (the ball is kept there by the S2B26-RETIRED-REMOVE-CUTS fix), flushed
 *     at rebuildNow (retired back to 0 when idle).
 *  2. Frame pass: re-run the transition, screenshot ~14 frames across the
 *     fade, saved to qa-orphan-shadows-s2b26/ for visual inspection.
 *  3. Ball-ROI pass: for tilt-b, locate the white ghost ball in the before
 *     frame, then per fade frame count white pixels in that ROI (ball present)
 *     and measure the local darkening ring (shadow present). Orphan = shadow
 *     ring dark while ball pixels are gone in the same frame.
 *
 * Usage: node tools/diag-s2b26-orphan-shadows.mjs [baseUrl]
 */

import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";
import { mkdirSync, writeFileSync } from "node:fs";

const base = process.argv[2] ?? "http://127.0.0.1:4199";
const OUT = "qa-orphan-shadows-s2b26";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

const browser = await launchGL(chromium, {});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
page.on("console", (m) => {
  if (m.type() === "error") console.log("CONSOLE-ERROR:", m.text());
});

async function waitIdle() {
  for (let i = 0; i < 160; i++) {
    const a = await page.evaluate(() => ({
      locked: window.__wp1?.locked?.() ?? false,
      animating: window.__wp1?.animating?.() ?? false,
    }));
    if (!a.locked && !a.animating) return true;
    await sleep(250);
  }
  return false;
}

async function clickContinue(step) {
  try {
    await page.click("#continue-hint", { force: true, timeout: 3000 });
    return "continue-hint";
  } catch {
    await page.click(`#rail button:nth-child(${step + 2})`, { force: true });
    return "rail";
  }
}

/** Samples {swap,fade,retired,opac,scene} through the out stage + settle. */
async function statePass(step, tag) {
  await page.goto(`${base}/?step=${step}`, { waitUntil: "load" });
  await waitIdle();
  await sleep(2000);
  const how = await clickContinue(step);
  const samples = [];
  for (let i = 0; i < 80; i++) {
    const s = await page.evaluate(() => {
      const d = window.__wp1.debug();
      return {
        t: Math.round(performance.now()),
        swap: d.swap,
        fade: Math.round(d.overlayFade * 1000) / 1000,
        retired: d.retired,
        opac: Math.round(d.opac * 1000) / 1000,
        scene: d.scene,
      };
    });
    samples.push(s);
    if (!s.swap && i > 10) break;
    await sleep(30);
  }
  await waitIdle();
  await sleep(600);
  const after = await page.evaluate(() => {
    const d = window.__wp1.debug();
    return { retired: d.retired, swap: d.swap, scene: d.scene };
  });
  const out = samples.filter((s) => s.swap === "out");
  const maxRetiredOut = out.reduce((m, s) => Math.max(m, s.retired), 0);
  const minRetiredOut = out.length ? out.reduce((m, s) => Math.min(m, s.retired), 1e9) : -1;
  const lastOut = out[out.length - 1] ?? null;
  console.log(`\n[${tag}] step ${step} via ${how}: out-stage samples=${out.length} retired max=${maxRetiredOut} min=${minRetiredOut} last={fade=${lastOut?.fade} retired=${lastOut?.retired}}  after: retired=${after.retired} scene=${after.scene}`);
  console.log(`  fade trace: ${samples.slice(0, 24).map((s) => `f${s.fade}/r${s.retired}/${s.swap ?? "idle"}`).join(" ")}`);
  return { out: out.length, maxRetiredOut, flushed: after.retired === 0 };
}

/** Frame pass: screenshots across the fade for visual inspection. */
async function framePass(step, tag) {
  await page.goto(`${base}/?step=${step}`, { waitUntil: "load" });
  await waitIdle();
  await sleep(2000);
  await page.screenshot({ path: `${OUT}/${tag}-000-before.png` });
  const how = await clickContinue(step);
  let n = 0;
  for (let i = 0; i < 14; i++) {
    const s = await page.evaluate(() => {
      const d = window.__wp1.debug();
      return { fade: d.overlayFade, swap: d.swap, retired: d.retired };
    });
    const name = `${OUT}/${tag}-${String(++n).padStart(3, "0")}-fade${s.fade.toFixed(2)}-${s.swap ?? "idle"}.png`;
    await page.screenshot({ path: name });
    if (i >= 9) await sleep(120);
  }
  await waitIdle();
  await sleep(700);
  await page.screenshot({ path: `${OUT}/${tag}-999-after.png` });
  console.log(`[${tag}] captured ${n + 2} frames via ${how}`);
}

/** Locate the largest white blob in the canvas area (the tilt-b ghost ball). */
async function findBallRoi(pngPath) {
  const buf = await import("node:fs").then((fs) => fs.promises.readFile(pngPath));
  const b64 = buf.toString("base64");
  return page.evaluate(async (data) => {
    const img = new Image();
    img.src = "data:image/png;base64," + data.b64;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const cv = document.querySelector("canvas");
    const rect = cv.getBoundingClientRect();
    const x0 = Math.max(0, Math.floor(rect.left));
    const x1 = Math.floor(rect.right);
    const y0 = Math.max(0, Math.floor(rect.top));
    const y1 = Math.floor(rect.bottom);
    const d = g.getImageData(x0, y0, x1 - x0, y1 - y0).data;
    const isWhite = (i) => {
      const r = d[i], gg = d[i + 1], b = d[i + 2];
      return r >= 246 && gg >= 246 && b >= 246 && Math.abs(r - gg) <= 8 && Math.abs(gg - b) <= 8;
    };
    // coarse grid: 4px cells, count whites per cell, then bbox of the densest 40x40-cell window
    const cols = Math.ceil((x1 - x0) / 4), rows = Math.ceil((y1 - y0) / 4);
    const grid = new Uint32Array(cols * rows);
    for (let y = 0; y < y1 - y0; y += 2) {
      for (let x = 0; x < x1 - x0; x += 2) {
        const i = (y * (x1 - x0) + x) * 4;
        if (isWhite(i)) grid[Math.floor(y / 4) * cols + Math.floor(x / 4)]++;
      }
    }
    const W = 26, H = 26; // ~104px window
    let best = -1, bx = 0, by = 0;
    for (let cy = 0; cy + H <= rows; cy++) {
      for (let cx = 0; cx + W <= cols; cx++) {
        let s = 0;
        for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) s += grid[(cy + yy) * cols + (cx + xx)];
        if (s > best) { best = s; bx = cx; by = cy; }
      }
    }
    if (best <= 0) return null;
    return {
      cx: x0 + (bx + W / 2) * 4,
      cy: y0 + (by + H / 2) * 4,
      whites: best,
      half: 56, // ROI half-size for later frames
    };
  }, { b64 });
}

/** Per-frame ROI metrics: white-pixel count (ball) + dark-ring delta (shadow). */
async function roiMetrics(pngPath, roi) {
  const buf = await import("node:fs").then((fs) => fs.promises.readFile(pngPath));
  const b64 = buf.toString("base64");
  return page.evaluate(async (data) => {
    const img = new Image();
    img.src = "data:image/png;base64," + data.b64;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const { cx, cy, half } = data.roi;
    const box = g.getImageData(cx - half, cy - half, half * 2, half * 2).data;
    const ctl = g.getImageData(cx + half * 3, cy - half, half * 2, half * 2).data;
    const n = box.length / 4;
    let whites = 0, lum = 0, ctlLum = 0;
    for (let i = 0; i < box.length; i += 4) {
      const r = box[i], gg = box[i + 1], b = box[i + 2];
      if (r >= 246 && gg >= 246 && b >= 246 && Math.abs(r - gg) <= 8 && Math.abs(gg - b) <= 8) whites++;
      lum += 0.2126 * r + 0.7152 * gg + 0.0722 * b;
    }
    for (let i = 0; i < ctl.length; i += 4) {
      ctlLum += 0.2126 * ctl[i] + 0.7152 * ctl[i + 1] + 0.0722 * ctl[i + 2];
    }
    return {
      whites,
      roiLum: Math.round(lum / n),
      ctlLum: Math.round(ctlLum / n),
      darkDelta: Math.round(ctlLum / n - lum / n),
    };
  }, { b64, roi });
}

// ---- run ----
console.log("== state pass (S2B26-RETIRED-REMOVE-CUTS corroboration) ==");
for (const [step, tag] of [[20, "state-step20-tiltb"], [21, "state-step21-swarm"]]) {
  await statePass(step, tag);
}

console.log("\n== frame pass (visual evidence) ==");
for (const [step, tag] of [[20, "step20-tiltb"], [21, "step21-swarm"]]) {
  await framePass(step, tag);
}

console.log("\n== ball ROI pass (tilt-b ghost ball vs its shadow) ==");
const roi = await findBallRoi(`${OUT}/step20-tiltb-000-before.png`);
if (!roi) {
  console.log("  no white ball found in the before frame — ROI pass skipped (visual pass decides)");
} else {
  console.log(`  ball ROI center=(${roi.cx},${roi.cy}) whites=${roi.whites}`);
  const files = (await import("node:fs").then((fs) => fs.readdirSync(OUT)))
    .filter((f) => f.startsWith("step20-tiltb-") && f.endsWith(".png") && !f.includes("before") && !f.includes("after"))
    .sort();
  let orphanSuspect = 0, ballFrames = 0;
  for (const f of files) {
    const m = await roiMetrics(`${OUT}/${f}`, roi);
    const orphan = m.darkDelta >= 22 && m.ctlLum >= 80 && m.whites <= 40;
    if (m.whites > 40) ballFrames++;
    if (orphan) orphanSuspect++;
    console.log(`  ${f}  whites=${String(m.whites).padStart(5)} roiLum=${String(m.roiLum).padStart(3)} ctlLum=${String(m.ctlLum).padStart(3)} darkDelta=${String(m.darkDelta).padStart(3)}${orphan ? "  <-- ORPHAN-SHADOW SUSPECT" : ""}`);
  }
  console.log(`  ROI verdict: frames-with-ball=${ballFrames} orphan-suspects=${orphanSuspect}`);
}

writeFileSync(`${OUT}/probe-done.txt`, "done\n");
await browser.close();
