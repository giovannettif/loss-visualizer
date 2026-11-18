/**
 * qa-s2mm-b.mjs — QA probe B (scope: the #tour-entry chip).
 *
 * Claims under test:
 *  1. ONE fixed chip, bottom-center of the CANVAS pane: position:fixed,
 *     bottom:16px, centerX == (100vw - readerW)/2 — at 1600×900, 1280×800,
 *     1024×720; never overlapping the reader panel.
 *  2. Fixed while the reader moves: the chip's rect is identical across a
 *     wheel-driven step transition.
 *  3. Hidden exactly where it must be: hero (?step=0), the intro park
 *     (plain boot), while a tour runs, and in ?shot mode (html.shot).
 *  4. WORKS FROM ANY SCROLL POSITION: one mid-section parked page per
 *     section (s1 p3, s2 p6, s3 p9, s4 p12, s5 p14, s6 p16, s7 p19, s8 p23,
 *     s9 p25 + s2 p5 + s7 p21 swarm): a real-mouse click on the chip starts
 *     THAT section's tour AT THE PARKED STEP (first curated step on/after
 *     the parked page), never advancing/scrolling the reader.
 *  5. §7 swarm lift: data-lift=true → bottom 166px while the swarm dock owns
 *     bottom-center; restored to 16px after Esc.
 *  6. Golden rule: the chip click itself NEVER advances the reader.
 *
 * Usage: node qa-s2mm-b.mjs http://localhost:4181
 * Evidence: qa/qa-s2mm-shots/
 */

import { chromium } from "playwright";
import { launchGL } from "./tools/gl-launch.mjs";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const base = process.argv[2] ?? "http://localhost:4181";
const outDir = resolve("qa/qa-s2mm-shots");
mkdirSync(outDir, { recursive: true });

const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

let failures = 0;
let n = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
  n++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitIdle(maxMs = 25000) {
  const t0 = Date.now();
  for (;;) {
    const a = await page.evaluate(() => ({
      locked: window.__wp1?.locked?.() ?? true,
      animating: window.__wp1?.animating?.() ?? true,
    }));
    if (!a.locked && !a.animating) return true;
    if (Date.now() - t0 > maxMs) return false;
    await sleep(200);
  }
}
async function appState() {
  return page.evaluate(() => ({
    step: window.__wp1?.step?.(),
    scene: window.__wp1?.scene?.(),
    scroll: window.__wp1?.scroll?.(),
    tour: window.__wp1?.tour?.(),
  }));
}

/** Chip geometry + reader overlap, evaluated in-page. */
async function chipGeom() {
  return page.evaluate(() => {
    const chip = document.querySelector("#tour-entry");
    if (!chip) return { present: false };
    const cs = getComputedStyle(chip);
    const r = chip.getBoundingClientRect();
    const reader = document.querySelector("#reader")?.getBoundingClientRect() ?? null;
    const readerW = getComputedStyle(document.documentElement).getPropertyValue("--reader-w").trim();
    // The canvas pane spans [0, reader.left]: its center is reader.left/2.
    const paneCenter = reader ? reader.left / 2 : null;
    return {
      present: true,
      hidden: chip.hidden,
      position: cs.position,
      bottom: Math.round(r.bottom),
      rectBottom: Math.round(window.innerHeight - r.bottom),
      centerX: Math.round((r.left + r.right) / 2),
      paneCenter: Math.round(paneCenter),
      readerW: readerW,
      overlapsReader: reader ? r.right > reader.left + 1 : null,
      dataLift: chip.dataset.lift ?? null,
      label: chip.textContent?.trim() ?? "",
      dataTour: chip.dataset.tour ?? null,
    };
  });
}

async function waitChipVisible(maxMs = 10000) {
  const t0 = Date.now();
  for (;;) {
    const g = await chipGeom();
    if (g.present && !g.hidden) return g;
    if (Date.now() - t0 > maxMs) return null;
    await sleep(150);
  }
}

/* ---------------- B1. hero + intro park: chip hidden ---------------- */
await page.goto(`${base}/`, { waitUntil: "load" });
await sleep(2000);
{
  const g = await chipGeom();
  check("B1 plain boot (intro park): chip hidden", g.present && g.hidden === true, JSON.stringify(g));
  const s0 = await page.goto(`${base}/?step=0`, { waitUntil: "load" }).then(() => sleep(1700));
  const g0 = await chipGeom();
  check("B1 hero ?step=0: chip hidden", g0.present && g0.hidden === true, JSON.stringify(g0));
}

/* ---------------- B2. into §1: chip appears, click starts s1 at the parked step ---------------- */
{
  // Advance hero → task-a → task-b. From the intro park the window owns the
  // wheel (intro choreography); the hero copy sanctions Space/arrows, so the
  // free-scroll arrival is driven by real key presses, then one wheel over
  // the reader pane for the task-a → task-b hop (wheel = the reader's own
  // progression once docked).
  await waitIdle();
  for (const target of [1, 2]) {
    for (let tries = 0; tries < 14; tries++) {
      const a0 = await appState();
      if (a0.step === target) break;
      if (target === 1 || (await appState()).step < 1) {
        await page.keyboard.press("ArrowDown");
      } else {
        const reader = await page.locator("#reader").boundingBox();
        await page.mouse.move(reader.x + reader.width / 2, reader.y + reader.height / 2);
        await page.mouse.wheel(0, 240);
      }
      await sleep(900);
    }
    await waitIdle();
  }
  const a = await appState();
  check("B2 wheel parked on task-b (page 2)", a.step === 2, JSON.stringify({ step: a.step, scene: a.scene }));
  const g = await waitChipVisible();
  check(
    "B2 chip visible after free-scroll arrival, labeled '▶ Tour section 1'",
    g && g.label === "▶ Tour section 1" && g.dataTour === "s1",
    JSON.stringify(g),
  );
  const before = await appState();
  const box = await page.locator("#tour-entry").boundingBox();
  check("B2 chip has a hit target", !!box, JSON.stringify(box));
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await sleep(1200);
  const t = (await appState()).tour;
  const after = await appState();
  check(
    "B2 chip click starts s1 AT page 2's step (seed 3/4), reader NOT advanced",
    t?.running === true && t?.id === "s1" && t?.stepIndex === 2 && t?.count === 4 && t?.page === 2 &&
      after.step === before.step && after.scroll.parked === true,
    JSON.stringify({ before: before.step, after: after.step, tour: t }),
  );
  const gRun = await chipGeom();
  check("B2 chip hidden while the tour owns bottom-center", gRun.present && gRun.hidden === true, JSON.stringify(gRun));
  await page.keyboard.press("Escape");
  await sleep(700);
  const gExit = await waitChipVisible();
  check("B2 chip back after Esc", gExit && !gExit.hidden, JSON.stringify(gExit));
}

/* ---------------- B3/B2b. geometry at three viewports (?step=5) ---------------- */
for (const vp of [{ width: 1600, height: 900 }, { width: 1280, height: 800 }, { width: 1024, height: 720 }]) {
  await page.setViewportSize(vp);
  await page.goto(`${base}/?step=5`, { waitUntil: "load" });
  await sleep(1700);
  await waitIdle();
  const g = await waitChipVisible();
  check(
    `B3 ${vp.width}×${vp.height}: chip visible, fixed, bottom 16px, centered on the canvas pane`,
    g && g.position === "fixed" && g.rectBottom === 16 && Math.abs(g.centerX - g.paneCenter) <= 2 && g.overlapsReader === false,
    JSON.stringify(g),
  );
  if (vp.width === 1600) {
    // Fixed while the reader moves: wheel forward gd-b → gd-c with the chip up.
    // The pointer must sit over the READER pane — over the canvas a wheel is
    // a camera zoom (the interaction model), which would advance nothing.
    const r0 = await page.locator("#tour-entry").boundingBox();
    const reader = await page.locator("#reader").boundingBox();
    await page.mouse.move(reader.x + reader.width / 2, reader.y + reader.height / 2);
    for (let tries = 0; tries < 14; tries++) {
      await page.mouse.wheel(0, 240);
      await sleep(650);
      if ((await appState()).step === 6) break;
    }
    await waitIdle();
    const r1 = await page.locator("#tour-entry").boundingBox();
    const a = await appState();
    check(
      "B3 chip rect IDENTICAL across a reader step transition (fixed, not re-flowed)",
      Math.abs(r0.x - r1.x) < 0.5 && Math.abs(r0.y - r1.y) < 0.5 && a.step === 6,
      JSON.stringify({ before: r0, after: r1, step: a.step }),
    );
    await page.screenshot({ path: resolve(outDir, "b3-chip-1600.png") });
  }
}

/* ---------------- B4. shot mode: chip hidden ---------------- */
await page.setViewportSize({ width: 1600, height: 900 });
await page.goto(`${base}/?shot=gd-b`, { waitUntil: "load" });
await sleep(2200);
{
  const g = await chipGeom();
  const display = await page.evaluate(() => getComputedStyle(document.querySelector("#tour-entry")).display);
  check("B4 ?shot mode: chip display:none (html.shot rule)", g.present && display === "none", JSON.stringify({ hidden: g.hidden, display }));
}

/* ---------------- B5. the from-any-scroll sweep (all nine sections) ---------------- */
const SWEEP = [
  { tour: "s1", n: 1, page: 3, seed: 3, count: 4, label: "▶ Tour section 1" },
  { tour: "s2", n: 2, page: 6, seed: 3, count: 5, label: "▶ Tour section 2" },
  { tour: "s2", n: 2, page: 5, seed: 1, count: 5, label: "▶ Tour section 2" },
  { tour: "s3", n: 3, page: 9, seed: 3, count: 5, label: "▶ Tour section 3" },
  { tour: "s4", n: 4, page: 12, seed: 2, count: 3, label: "▶ Tour section 4" },
  { tour: "s5", n: 5, page: 14, seed: 2, count: 4, label: "▶ Tour section 5" },
  { tour: "s6", n: 6, page: 16, seed: 3, count: 6, label: "▶ Tour section 6" },
  { tour: "s6", n: 6, page: 17, seed: 4, count: 6, label: "▶ Tour section 6" },
  { tour: "s7", n: 7, page: 19, seed: 2, count: 7, label: "▶ Tour section 7" },
  { tour: "s7", n: 7, page: 21, seed: 4, count: 7, label: "▶ Tour section 7", swarm: true },
  { tour: "s8", n: 8, page: 23, seed: 3, count: 5, label: "▶ Tour section 8" },
  { tour: "s9", n: 9, page: 25, seed: 3, count: 6, label: "▶ Tour section 9" },
];
for (const s of SWEEP) {
  await page.goto(`${base}/?step=${s.page}`, { waitUntil: "load" });
  await sleep(1700);
  await waitIdle();
  const g = await waitChipVisible();
  check(
    `B5 ?step=${s.page} (${s.tour}): chip '${s.label}' visible`,
    g && g.label === s.label && g.dataTour === s.tour && !g.hidden,
    JSON.stringify(g),
  );
  if (s.swarm) {
    check(
      `B5 ?step=${s.page}: data-lift=true (swarm dock owns bottom-center)`,
      g.dataLift === "true",
      JSON.stringify({ lift: g.dataLift, rectBottom: g.rectBottom }),
    );
  } else {
    check(
      `B5 ?step=${s.page}: data-lift=false, bottom 16px`,
      g.dataLift === "false" && g.rectBottom === 16,
      JSON.stringify({ lift: g.dataLift, rectBottom: g.rectBottom }),
    );
  }
  const before = await appState();
  const box = await page.locator("#tour-entry").boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  // Poll until the tour is active at the seed (or timeout).
  const t0 = Date.now();
  let t = null;
  for (;;) {
    t = (await appState()).tour;
    if (t?.running && t?.stepIndex === s.seed && (t?.phase === "active" || t?.phase === "travel")) break;
    if (Date.now() - t0 > 15000) break;
    await sleep(150);
  }
  await sleep(600); // any illicit reader advance would land here
  const after = await appState();
  check(
    `B5 ?step=${s.page}: tour ${s.tour} seeded at ${s.seed + 1}/${s.count} parked on page ${s.page}, reader untouched`,
    t?.running === true && t?.id === s.tour && t?.stepIndex === s.seed && t?.count === s.count && t?.page === s.page &&
      after.step === before.step && after.scroll.parked === true,
    JSON.stringify({ beforeStep: before.step, afterStep: after.step, tour: t }),
  );
  if (s.swarm) {
    const gRun = await chipGeom();
    check("B5 swarm tour running: chip hidden, controller owns the slot", gRun.present && gRun.hidden === true, JSON.stringify({ hidden: gRun.hidden }));
  }
  await page.keyboard.press("Escape");
  await sleep(600);
  const g2 = await waitChipVisible();
  check(`B5 ?step=${s.page}: chip restored after Esc`, g2 && !g2.hidden, JSON.stringify({ hidden: g2?.hidden }));
}

await page.screenshot({ path: resolve(outDir, "b5-final-chip.png") });
await browser.close();
console.log(`\nQA-S2MM-B ${failures === 0 ? "ALL_PASS" : "FAILED"} (${n} checks, ${failures} failures)`);
process.exit(failures === 0 ? 0 : 1);
