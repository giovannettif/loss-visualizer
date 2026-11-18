/**
 * diag-s4-steep-gate-point.mjs — TOUR-POINT-S4-STEEP-GATE-STAGE repro probe.
 *
 * Finding: the §4 tour's steepness sentence (page 12 / adam-b, para 1,
 * sent 2 — "Adam's barely moves: √v̂ absorbs exactly the scale GD stepped
 * into.") pauses on the steepMoved gate ("try it: slide the steepness λ₁")
 * while its pointing overlay + spotlight target the §4 inspector ARROWS on
 * the 3D stage (look: "adam-arrows" in TOURS s4 step 3) instead of the
 * #steep-slider control in the reader panel that the gate demands (the
 * U1-POINT-ETA class of bug; the U1 fix added the "eta-slider" control look).
 *
 * Measures, at that step, in viewport px:
 *   - the overlay dot (#tour-dot) position vs the #steep-slider rect
 *     (the demanded control) while the gate chip demands sliding λ₁.
 * Bug reproduced when the overlay is ON, the look key is "adam-arrows",
 * the gate is steepMoved, and the dot is far OUTSIDE the slider rect.
 *
 * Usage: node tools/diag-s4-steep-gate-point.mjs [baseUrl]
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

/* Walk the §4 tour to the steepness sentence (stepIndex 2, adam-b). */

await page.goto(`${base}/?step=11`, { waitUntil: "load" });
await sleep(1400);
if (!(await waitIdle())) check("§4 entry unlocks", false, "still locked");

await page.locator('.rstep[data-active="true"] .tour-launch').click();
const s0 = await waitTour((s) => s.phase === "active" && s.stepIndex === 0, 12000, "§4 start");
check("s4 tour started", s0?.id === "s4" && s0?.stepIndex === 0, JSON.stringify(s0));

await page.locator("#tour-next").click();
const s1 = await waitTour((s) => s.phase === "active" && s.stepIndex === 1, 12000, "§4 step 2");
check("step 2: inspector-arrows sentence on page 11", s1?.stepIndex === 1 && s1?.page === 11, JSON.stringify(s1));

await page.locator("#tour-next").click();
const s2 = await waitTour(
  (s) => s.phase === "active" && s.stepIndex === 2 && s.gate === true,
  25000,
  "§4 steep gate",
);
check(
  "steepMoved gate armed on adam-b (page 12)",
  s2?.stepIndex === 2 && s2?.gateKind === "steepMoved" && s2?.page === 12,
  JSON.stringify(s2),
);
await sleep(700); // let the overlay + fades settle before measuring

/* Measure: where does the overlay point, vs the #steep-slider control? */

const m = await page.evaluate(() => {
  const dot = document.querySelector("#tour-dot");
  const slider = document.querySelector("#steep-slider");
  const chip = document.querySelector("#tour-gate-chip");
  const sr = slider?.getBoundingClientRect() ?? null;
  const dx = dot ? Number(dot.getAttribute("cx")) : null;
  const dy = dot ? Number(dot.getAttribute("cy")) : null;
  const distToRect = (p, r) => {
    const ex = Math.max(r.left - p.x, 0, p.x - r.right);
    const ey = Math.max(r.top - p.y, 0, p.y - r.bottom);
    return Math.hypot(ex, ey);
  };
  return {
    overlayOn: document.querySelector("#tour-overlay")?.dataset.on,
    dot: dx !== null ? { x: dx, y: dy } : null,
    sliderRect: sr
      ? { left: sr.left, top: sr.top, right: sr.right, bottom: sr.bottom, w: sr.width, h: sr.height }
      : null,
    sliderVisible: slider ? slider.getClientRects().length > 0 : false,
    sliderDist: dx !== null && sr ? distToRect({ x: dx, y: dy }, sr) : null,
    chipText: (chip?.textContent ?? "").trim(),
    chipOn: chip?.dataset.on,
    sentence: (document.querySelector("[data-tour-active]")?.textContent ?? "").trim().replace(/\s+/g, " "),
  };
});

const tour = s2;
const look = await lookState();
check(
  "step look key is 'adam-arrows' (the finding's claim)",
  tour?.lookKey === "adam-arrows" && look?.id === "adam-arrows",
  `tour.lookKey=${tour?.lookKey} look.id=${look?.id} look.label=${look?.label}`,
);
check("overlay is ON", m.overlayOn === "true", `overlay=${m.overlayOn}`);
check(
  "gate chip demands sliding the steepness",
  m.chipOn === "true" && m.chipText.includes("slide the steepness"),
  `chip="${m.chipText}"`,
);
check(
  "sentence is the steepness sentence",
  (m.sentence ?? "").includes("barely moves") && m.sentence.includes("absorbs exactly"),
  `"${m.sentence}"`,
);
check(
  "#steep-slider is visible on the parked page (the control-kind guard would pass)",
  m.sliderVisible === true,
  JSON.stringify(m.sliderRect),
);

const d = m.dot;
check("overlay dot resolved", d !== null, JSON.stringify(m.dot));
if (d && m.sliderRect) {
  const inSlider =
    d.x >= m.sliderRect.left && d.x <= m.sliderRect.right &&
    d.y >= m.sliderRect.top && d.y <= m.sliderRect.bottom;
  check(
    "BUG SIGNATURE: dot is far OUTSIDE the #steep-slider rect (> 60 px)",
    !inSlider && m.sliderDist > 60,
    `dot=(${d.x.toFixed(1)},${d.y.toFixed(1)}) sliderRect=${JSON.stringify(m.sliderRect)} dist=${m.sliderDist?.toFixed(1)}px`,
  );
} else {
  check("slider rect available", false, JSON.stringify(m.sliderRect));
}

await page.screenshot({ path: resolve(outDir, "diag-s4-steep-gate-point.png") });
console.log(`\nscene=${(await appState()).scene} sentence="${m.sentence}"`);
console.log(`look=${JSON.stringify(look)}`);

await browser.close();
console.log(failures === 0 ? "BUG_REPRODUCED_ALL_CHECKS_PASS" : "PROBE_HAD_FAILURES");
process.exit(failures === 0 ? 0 : 1);
