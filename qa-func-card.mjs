/**
 * qa-func-card.mjs — independent verification for the FUNCTION CARD
 * (the docked formula chip on the canvas pane), run through run-gate.sh:
 *   bash tools/run-gate.sh qa-func-card.mjs
 *
 * Checks (each with its own screenshot where the ask demands pixels):
 *   1. §5 lab (?step=13): card visible at TWO SLIDER POSITIONS — default
 *      ×50/30°, then the elongation slider dragged to ×1: the values line
 *      must change live (λ₁ 7.07 → 1.00), then the rotation slider moved.
 *   2. §2 gd-c (?step=5): the bowl card with λmax = 2.00 (the copy's
 *      threshold constant).
 *   3. §4 adam-a (?step=11): steepness drag updates λ₁ live; adam-b
 *      (?step=12, frozen ×50) shows λ₁ = 50.00.
 *   4. §6 fog-a (?step=15): card HIDDEN pre-reveal; fog-c (?step=17):
 *      card visible at the reveal with the Rosenbrock formula (show-after).
 *   5. §7 tilt-a (?step=18, fresh run): hidden; ?shot=tilt-b (scorecard
 *      beat): visible with the level-2 Rosenbrock card.
 *   6. §7 swarm (?shot=swarm): hidden while blind; un-ticking "run blind"
 *      reveals it (the map lift is the reveal).
 *   7. §8 labrule (?step=22): card swaps with the pills (Rosenbrock →
 *      valley → least squares .sum formula).
 *   8. Hover-to-look: hovering a data-look="func-card" sentence spotlights
 *      the card (look.spotPanels includes "func-card").
 */

import { chromium } from "playwright";
import { launchGL } from "./tools/gl-launch.mjs";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const base = process.argv[2] ?? "http://localhost:4173";
const outDir = resolve("qa-func-card-shots");
mkdirSync(outDir, { recursive: true });

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await launchGL(chromium);

async function newState(page) {
  return page.evaluate(() => window.__wp1?.look?.() ?? null);
}
async function appState(page) {
  return page.evaluate(() => ({
    scene: window.__wp1?.scene?.(),
    locked: window.__wp1?.locked?.(),
    animating: window.__wp1?.animating?.(),
  }));
}
async function waitIdle(page, maxMs = 30000) {
  const t0 = Date.now();
  for (;;) {
    const a = await appState(page);
    if (!a.locked && !a.animating) return true;
    if (Date.now() - t0 > maxMs) return false;
    await sleep(200);
  }
}
/** The card's rendered state (or null when the element is missing). The
 *  values line uses nbsp inside each "key = value" pair (wraps only at the
 *  "·" separators) — normalized to plain spaces for the assertions. */
async function cardState(page) {
  return page.evaluate(() => {
    const norm = (s) => (s ?? "").replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
    const el = document.querySelector("#func-card");
    if (!el) return null;
    return {
      visible: el.dataset.visible === "true",
      title: norm(document.querySelector("#func-card-title")?.textContent),
      math: norm(document.querySelector("#func-card-math")?.textContent),
      htmlHasSum: !!document.querySelector("#func-card-math .sum"),
      values: norm(document.querySelector("#func-card-vals")?.textContent),
    };
  });
}
async function goto(page, url, label) {
  await page.goto(`${base}${url}`, { waitUntil: "load" });
  await waitIdle(page);
  await sleep(400); // the HUD fade (~700ms) — let data-visible settle visually
}
async function shot(page, name) {
  const p = resolve(outDir, name);
  await page.screenshot({ path: p });
  return p;
}
/** Fires a real `input` event on a slider (the wiring listens on input). */
async function setSlider(page, sel, knob) {
  await page.evaluate(
    ([sel, knob]) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error(`missing ${sel}`);
      el.value = String(knob);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    [sel, knob],
  );
}

const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

/* ---------------- 1. §5 lab — two slider positions ---------------- */
{
  await goto(page, "/?step=13");
  const a = await cardState(page);
  check("lab: card visible at park", a?.visible === true, JSON.stringify(a));
  check(
    "lab pos A: ×50 / 30° values",
    a?.values.includes("λ₁ = 7.07") && a?.values.includes("λ₂ = 0.14") && a?.values.includes("φ = 30°"),
    a?.values,
  );
  await shot(page, "1-lab-posA-x50.png");

  await setSlider(page, "#elong-slider", 0); // ×1 — the round bowl
  await sleep(600); // the coalesced rebuild + card write
  const b = await cardState(page);
  check(
    "lab pos B: ×1 round-bowl values (live)",
    b?.values.includes("λ₁ = 1.00") && b?.values.includes("λ₂ = 1.00"),
    b?.values,
  );
  check("lab pos B: values CHANGED from pos A", a?.values !== b?.values, `${a?.values} → ${b?.values}`);
  await shot(page, "2-lab-posB-x1.png");

  await setSlider(page, "#rot-slider", 777); // φ = 0.777·90 ≈ 70°
  await sleep(600);
  const c = await cardState(page);
  check("lab pos C: φ tracks the rotation slider (live)", c?.values.includes("φ = 70°"), c?.values);
  await shot(page, "3-lab-posC-rot70.png");
  // restore the curated state for the next scenes
  await setSlider(page, "#elong-slider", 1000);
  await setSlider(page, "#rot-slider", 333);
}

/* ---------------- 2. §2 gd-c — the bowl card ---------------- */
{
  await goto(page, "/?step=5");
  const a = await cardState(page);
  check(
    "gd-c: card visible with the bowl formula + λmax = 2.00",
    a?.visible === true &&
      a?.math.includes("λ₁u² + λ₂v²") &&
      a?.values.includes("φ = 30°") &&
      a?.values.includes("λmax = 2λ₁ = 2.00"),
    JSON.stringify(a),
  );
  await shot(page, "4-gdc-bowl-card.png");
}

/* ---------------- 3. §4 — steepness live ---------------- */
{
  await goto(page, "/?step=11"); // adam-a
  await setSlider(page, "#steep-slider", 1000); // ×50
  await sleep(600);
  const a = await cardState(page);
  check(
    "adam-a: λ₁ live under the steepness slider (×1 → ×50)",
    a?.values.includes("λ₁ = 50.00") && a?.values.includes("λmax = 2λ₁ = 100.00"),
    a?.values,
  );
  await shot(page, "5-adam-steep50.png");

  await goto(page, "/?step=12"); // adam-b (frozen ×50)
  const b = await cardState(page);
  check("adam-b: frozen ×50 card", b?.visible === true && b?.values.includes("λ₁ = 50.00"), b?.values);
}

/* ---------------- 4. §6 fog — show-after ---------------- */
{
  await goto(page, "/?step=15"); // fog-a
  const a = await cardState(page);
  check("fog-a: card HIDDEN pre-reveal (no spoil)", a?.visible === false, JSON.stringify(a));
  await shot(page, "6-foga-hidden.png");

  await goto(page, "/?step=17"); // fog-c — the reveal
  const b = await cardState(page);
  check(
    "fog-c: card visible AT THE REVEAL with the Rosenbrock formula",
    b?.visible === true && b?.math.includes("(1 − x)² + 100·(y − x²)²") && b?.values.includes("global min (1, 1)"),
    JSON.stringify(b),
  );
  await shot(page, "7-fogc-reveal-card.png");
}

/* ---------------- 5. §7 tilt — level-complete only ---------------- */
{
  await goto(page, "/?step=18"); // tilt-a, fresh run
  const a = await cardState(page);
  check("tilt-a: card HIDDEN on a fresh run", a?.visible === false, JSON.stringify(a));

  await goto(page, "/?shot=tilt-b"); // the scorecard/reveal page (done run)
  const b = await cardState(page);
  check(
    "tilt-b: card visible at the scorecard beat (level 2 Rosenbrock)",
    b?.visible === true && b?.title.includes("level 2") && b?.math.includes("(1 − x)²"),
    JSON.stringify(b),
  );
  await shot(page, "8-tiltb-levelcomplete-card.png");
}

/* ---------------- 6. §7 swarm — blind vs show map ---------------- */
{
  await goto(page, "/?shot=swarm");
  const a = await cardState(page);
  check("swarm: card HIDDEN while run blind", a?.visible === false, JSON.stringify(a));
  await shot(page, "9-swarm-blind-hidden.png");

  await page.evaluate(() => {
    const t = document.querySelector("#swarm-blind");
    t.checked = false;
    t.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await sleep(800);
  const b = await cardState(page);
  check(
    "swarm: card appears when the map is shown (multi-well formula + census)",
    b?.visible === true && b?.math.includes("0.05‖p‖²") && b?.values.includes("6 wells"),
    JSON.stringify(b),
  );
  await shot(page, "10-swarm-showmap-card.png");
}

/* ---------------- 7. §8 labrule — the pills swap the card ---------------- */
{
  await goto(page, "/?step=22");
  const a = await cardState(page);
  check(
    "labrule: card visible with the curated Rosenbrock benchmark",
    a?.visible === true && a?.math.includes("(1 − x)²") && a?.values.includes("converge < L 1.0"),
    JSON.stringify(a),
  );
  await page.click('#rule-levels button[data-level="bowl"]');
  await sleep(600);
  const b = await cardState(page);
  check(
    "labrule: valley pill swaps the card (bowl + threshold values)",
    b?.math.includes("λ₁u² + λ₂v²") && b?.values.includes("converge < L 0.5"),
    JSON.stringify(b),
  );
  await page.click('#rule-levels button[data-level="ls"]');
  await sleep(600);
  const c = await cardState(page);
  check(
    "labrule: least-squares pill swaps to the styled Σ form",
    c?.htmlHasSum === true && c?.values.includes("converge < L 1.5"),
    JSON.stringify(c),
  );
  await shot(page, "11-labrule-ls-card.png");
}

/* ---------------- 8. hover-to-look: the card is a target ---------------- */
{
  // gd-a (page 4): the caption's "the surfaces are test landscapes" span
  // sits in an UNREGISTERED sentence (TOURS s2 addresses only para 1), so
  // tier-1 span hover applies. The look machinery demands a TRUSTED pointer
  // move at document rest (pointerHoverAllowed), so this drives the real
  // CDP mouse — the same path gate-tour's REG-2 audit uses.
  await goto(page, "/?step=4");
  const span = page.locator('.rstep[data-active="true"] .look[data-look="func-card"]').first();
  await span.hover();
  await sleep(700);
  const l = await newState(page);
  check(
    "hover: the func-card sentence spotlights the card panel",
    l?.active === true && l?.id === "func-card" && l?.spotPanels.includes("func-card"),
    JSON.stringify({ id: l?.id, spotPanels: l?.spotPanels }),
  );
  await shot(page, "12-hover-func-card.png");
  await page.mouse.move(10, 500); // leave the span — the spotlight clears
  await sleep(400);
  const l2 = await newState(page);
  check("hover: leaving the span clears the spotlight", l2?.active === false, JSON.stringify({ id: l2?.id }));
}

await browser.close();
console.log(failures === 0 ? "FUNC_CARD_ALL_OK" : `FUNC_CARD_FAILURES: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
