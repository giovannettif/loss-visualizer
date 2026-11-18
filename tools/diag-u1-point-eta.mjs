/**
 * diag-u1-point-eta.mjs — U1-POINT-ETA repro probe.
 *
 * Finding: the §2 tour's learning-rate sentence (page 6 / gd-c, para 1,
 * sent 1 — "Slide η across three orders of magnitude; GD restarts from the
 * same white point each time.") pauses on the etaMoved gate ("try it: slide
 * the learning rate η") while its pointing overlay + spotlight target the
 * BALL (look: "ball" in TOURS s2 step 4) instead of the #eta-slider control
 * the gate demands.
 *
 * Measures, at that step, in viewport px:
 *   - the overlay dot (#tour-dot) position vs the ball's projected screen
 *     position (window.__wp1.ballScreen()) and vs the #eta-slider rect.
 * Bug reproduced when the overlay is ON, the look key is "ball", the dot
 * sits ON the ball, and the dot is far OUTSIDE the slider rect — while the
 * gate chip demands sliding η.
 *
 * Usage: node tools/diag-u1-point-eta.mjs [baseUrl]
 */

import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const base = process.argv[2] ?? "http://localhost:4173";
const outDir = resolve("shots");
mkdirSync(outDir, { recursive: true });

const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tourState() {
  return page.evaluate(() => window.__wp1?.tour?.() ?? null);
}
async function lookState() {
  return page.evaluate(() => window.__wp1?.look?.() ?? null);
}
async function appState() {
  return page.evaluate(() => ({
    scene: window.__wp1?.scene?.(),
    step: window.__wp1?.step?.(),
    locked: window.__wp1?.locked?.(),
    animating: window.__wp1?.animating?.(),
  }));
}
async function waitIdle(maxMs = 25000) {
  const t0 = Date.now();
  for (;;) {
    const a = await appState();
    if (!a.locked && !a.animating) return true;
    if (Date.now() - t0 > maxMs) return false;
    await sleep(200);
  }
}
async function waitTour(pred, maxMs = 30000, label = "tour state") {
  const t0 = Date.now();
  let s = null;
  for (;;) {
    s = await tourState();
    if (s && pred(s)) return s;
    if (Date.now() - t0 > maxMs) {
      console.log(`  (timeout waiting for ${label}: ${JSON.stringify(s)})`);
      return s;
    }
    await sleep(120);
  }
}

async function dragMinimap(dx0, dy0, dx1, dy1) {
  const box = await page.locator("#minimap-canvas").boundingBox();
  if (!box) throw new Error("minimap canvas missing");
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx + dx0, cy + dy0);
  await page.mouse.down();
  await page.mouse.move(cx + dx1, cy + dy1, { steps: 8 });
  await page.mouse.up();
}

/* Walk the §2 tour to the learning-rate sentence (stepIndex 3, gd-c). */

await page.goto(`${base}/?step=4`, { waitUntil: "load" });
await sleep(1400);
if (!(await waitIdle())) check("§2 entry unlocks", false, "still locked");

await page.locator('.rstep[data-active="true"] .tour-launch').click();
const s0 = await waitTour((s) => s.phase === "active" && s.stepIndex === 0, 12000, "§2 start");
check("s2 tour started", s0?.id === "s2" && s0?.stepIndex === 0, JSON.stringify(s0));

await page.keyboard.press("Space");
const s1 = await waitTour((s) => s.phase === "active" && s.stepIndex === 1, 12000, "§2 space");
check("arrowDrawn gate armed on gd-b", s1?.gateKind === "arrowDrawn", JSON.stringify(s1));
await dragMinimap(10, 40, 62, 80);
await sleep(1300);
const s2 = await waitTour((s) => s.phase === "active" && s.stepIndex === 2, 8000, "§2 stride release");
check("stride released → gd-step sentence", s2?.stepIndex === 2, JSON.stringify(s2));

await page.locator("#tour-next").click();
const s3 = await waitTour(
  (s) => s.phase === "active" && s.stepIndex === 3 && s.gate === true,
  15000,
  "§2 eta gate",
);
check(
  "etaMoved gate armed on gd-c",
  s3?.stepIndex === 3 && s3?.gateKind === "etaMoved" && s3?.page === 6,
  JSON.stringify(s3),
);
await sleep(700); // let the overlay + fades settle before measuring

/* Measure: where does the overlay point, vs the ball vs the slider? */

const m = await page.evaluate(() => {
  const dot = document.querySelector("#tour-dot");
  const head = document.querySelector("#tour-arrow");
  const slider = document.querySelector("#eta-slider");
  const chip = document.querySelector("#tour-gate-chip");
  const sr = slider?.getBoundingClientRect() ?? null;
  const clampToRect = (x, y, r, pad) =>
    Math.min(Math.max(x, r.left - pad), r.right + pad) === x &&
    Math.min(Math.max(y, r.top - pad), r.bottom + pad) === y;
  const distToRect = (x, y, r) => {
    const dx = Math.max(r.left - x, 0, x - r.right);
    const dy = Math.max(r.top - y, 0, y - r.bottom);
    return Math.hypot(dx, dy);
  };
  const ball = window.__wp1?.ballScreen?.() ?? null;
  const dx = dot ? Number(dot.getAttribute("cx")) : null;
  const dy = dot ? Number(dot.getAttribute("cy")) : null;
  return {
    overlayOn: document.querySelector("#tour-overlay")?.dataset.on,
    dot: dx !== null ? { x: dx, y: dy } : null,
    head: head?.getAttribute("points") ?? null,
    ball,
    sliderRect: sr ? { left: sr.left, top: sr.top, right: sr.right, bottom: sr.bottom, w: sr.width, h: sr.height } : null,
    chipText: (chip?.textContent ?? "").trim(),
    chipOn: chip?.dataset.on,
    sentence: (document.querySelector("[data-tour-active]")?.textContent ?? "").trim().replace(/\s+/g, " "),
  };
});

const tour = s3;
const look = await lookState();
check(
  "step look key is 'ball' (the finding's claim)",
  tour?.lookKey === "ball" && look?.id === "ball",
  `tour.lookKey=${tour?.lookKey} look.id=${look?.id} look.label=${look?.label}`,
);
check("overlay is ON", m.overlayOn === "true", `overlay=${m.overlayOn}`);
check(
  "gate chip demands sliding η while the overlay points",
  m.chipOn === "true" && m.chipText.includes("slide the learning rate"),
  `chip="${m.chipText}"`,
);
check(
  "sentence is the learning-rate sentence",
  (m.sentence ?? "").includes("Slide") && m.sentence.includes("same white point"),
  `"${m.sentence}"`,
);

const d = m.dot;
check("overlay dot resolved", d !== null, JSON.stringify(m.dot));
if (d && m.ball) {
  const distBall = Math.hypot(d.x - m.ball.x, d.y - m.ball.y);
  check(
    "BUG SIGNATURE: dot sits ON the ball (< 30 px)",
    distBall < 30,
    `dot=(${d.x.toFixed(1)},${d.y.toFixed(1)}) ball=(${m.ball.x.toFixed(1)},${m.ball.y.toFixed(1)}) dist=${distBall.toFixed(1)}px`,
  );
} else {
  check("ball screen position available", false, JSON.stringify(m.ball));
}
if (d && m.sliderRect) {
  const inSlider = d.x >= m.sliderRect.left && d.x <= m.sliderRect.right &&
    d.y >= m.sliderRect.top && d.y <= m.sliderRect.bottom;
  const distSlider = distToRectCache(d, m.sliderRect);
  check(
    "BUG SIGNATURE: dot is far OUTSIDE the η slider rect (> 60 px)",
    !inSlider && distSlider > 60,
    `sliderRect=${JSON.stringify(m.sliderRect)} dist=${distSlider.toFixed(1)}px`,
  );
} else {
  check("slider rect available", false, JSON.stringify(m.sliderRect));
}

function distToRectCache(p, r) {
  const dx = Math.max(r.left - p.x, 0, p.x - r.right);
  const dy = Math.max(r.top - p.y, 0, p.y - r.bottom);
  return Math.hypot(dx, dy);
}

await page.screenshot({ path: resolve(outDir, "diag-u1-point-eta.png") });
console.log(`\nscene=${(await appState()).scene} sentence="${m.sentence}"`);
console.log(`look=${JSON.stringify(look)}`);

await browser.close();
console.log(failures === 0 ? "BUG_REPRODUCED_ALL_CHECKS_PASS" : "PROBE_HAD_FAILURES");
process.exit(failures === 0 ? 0 : 1);
