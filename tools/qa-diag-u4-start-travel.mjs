/**
 * qa-diag-u4-start-travel.mjs — U4-START-TRAVEL reproduction (diagnosis only).
 *
 * From EVERY chip-bearing reader page, click "▶ Tour this section" and record:
 *   - the reader page before/after the click (did the reader itself move?)
 *   - the tour's seeded stepIndex / counter at activation (1/n vs mid-playlist)
 *   - whether ONE Next press completes the tour (started at the last step?)
 *   - a mid-entry variant: click the chip while the reader is still locked
 *     from the deep-link entry (the "finnicky" window).
 *
 * Usage: node tools/qa-diag-u4-start-travel.mjs [baseUrl]
 */

import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";

const base = process.argv[2] ?? "http://localhost:4319";
const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function appState() {
  return page.evaluate(() => ({
    step: window.__wp1?.step?.(),
    scene: window.__wp1?.scene?.(),
    locked: window.__wp1?.locked?.(),
    animating: window.__wp1?.animating?.(),
  }));
}
async function tourState() {
  return page.evaluate(() => window.__wp1?.tour?.() ?? null);
}
async function counter() {
  return page.evaluate(() => document.querySelector("#tour-count")?.textContent ?? "");
}
async function waitIdle(maxMs = 25000) {
  const t0 = Date.now();
  for (;;) {
    const a = await appState();
    if (!a.locked && !a.animating) return true;
    if (Date.now() - t0 > maxMs) return false;
    await sleep(150);
  }
}
async function waitTour(pred, maxMs = 15000, label = "tour state") {
  const t0 = Date.now();
  let s = null;
  for (;;) {
    s = await tourState();
    if (s && pred(s)) return s;
    if (Date.now() - t0 > maxMs) {
      console.log(`  (timeout waiting for ${label}: ${JSON.stringify(s)})`);
      return s;
    }
    await sleep(100);
  }
}

/** First step index whose page === k, computed from the TOURS table shape. */
// (page→tour-id map read from TOUR_SCENE_HOST; firstStepPage per tour computed
// in-page from window.__wp1.tourCheck() is not needed — we compare counters.)

const PAGES = [
  1, 2, 3, // s1
  4, 5, 6, 7, // s2
  8, 9, 10, // s3
  11, 12, // s4
  13, 14, // s5
  15, 16, 17, // s6
  18, 19, 20, 21, // s7
  22, 23, // s8
  24, 25, 26, // s9
];

console.log("=== A. chip click from every chip-bearing page ===");
for (const k of PAGES) {
  await page.goto(`${base}/?step=${k}`, { waitUntil: "load" });
  await sleep(1200);
  const idle = await waitIdle();
  const before = await appState();
  const chip = page.locator('.rstep[data-active="true"] .tour-launch');
  if ((await chip.count()) === 0) {
    console.log(`page ${k}: NO CHIP on active page`);
    continue;
  }
  await chip.click();
  const s = await waitTour((t) => t.running && t.phase === "active", 15000, `p${k} start`);
  const after = await appState();
  const cnt = await counter();
  const moved = before.step !== after.step ? ` READER MOVED ${before.step}→${after.step}` : "";
  console.log(
    `page ${k} (${before.scene}): idle=${idle} | tour=${s?.id} stepIndex=${s?.stepIndex}/${s?.count} counter="${cnt}" tourPage=${s?.page}${moved}`,
  );
  // B. does ONE Next complete the tour (seeded at the final step)?
  if (s?.running && s?.stepIndex + 1 >= (s?.count ?? 0)) {
    await page.locator("#tour-next").click();
    const done = await waitTour((t) => !t.running, 5000, `p${k} one-next-exit`);
    console.log(`   └ one Next from the seeded position → tour exits: ${done?.running === false}`);
  }
  await page.keyboard.press("Escape");
  await waitTour((t) => !t.running, 5000, `p${k} esc`);
  await waitIdle();
}

console.log("=== C. the finding's exact example: park on the LAST page of §6/§9 ===");
for (const k of [17, 25]) {
  await page.goto(`${base}/?step=${k}`, { waitUntil: "load" });
  await sleep(1400);
  await waitIdle();
  await page.locator('.rstep[data-active="true"] .tour-launch').click();
  const s = await waitTour((t) => t.running && t.phase === "active", 15000, `p${k} start`);
  const cnt = await counter();
  const marked = await page.evaluate(() =>
    (document.querySelector("[data-tour-active]")?.textContent ?? "").trim().replace(/\s+/g, " "),
  );
  console.log(
    `page ${k}: counter="${cnt}" stepIndex=${s?.stepIndex}/${s?.count} marked="${marked.slice(0, 60)}"`,
  );
  await page.keyboard.press("Escape");
  await waitTour((t) => !t.running, 5000);
  await waitIdle();
}

console.log("=== D. finicky window: chip click DURING the deep-link entry lock ===");
for (const k of [15, 17]) {
  await page.goto(`${base}/?step=${k}`, { waitUntil: "load" });
  // click as soon as the page exists, without waiting for idle
  let clicked = false;
  for (let i = 0; i < 40 && !clicked; i++) {
    await sleep(100);
    const chip = page.locator('.rstep[data-active="true"] .tour-launch');
    if ((await chip.count()) > 0 && (await chip.isEnabled())) {
      try {
        await chip.click({ timeout: 500 });
        clicked = true;
      } catch {
        /* not ready yet */
      }
    }
  }
  const during = await appState();
  const s = await waitTour((t) => t.running && t.phase === "active", 20000, `p${k} midlock start`);
  const cnt = await counter();
  const settled = await appState();
  console.log(
    `page ${k}: clicked mid-entry (locked=${during.locked}) → settled step=${settled.step} tour=${s?.id} stepIndex=${s?.stepIndex}/${s?.count} counter="${cnt}" tourPage=${s?.page}`,
  );
  await page.keyboard.press("Escape");
  await waitTour((t) => !t.running, 5000);
  await waitIdle();
}

console.log("=== E. restart after a partial walk (exit mid-tour, chip again) ===");
await page.goto(`${base}/?step=15`, { waitUntil: "load" });
await sleep(1400);
await waitIdle();
await page.locator('.rstep[data-active="true"] .tour-launch').click();
await waitTour((t) => t.running && t.phase === "active", 15000, "E start");
await page.keyboard.press("Space"); // → step 1
await waitTour((t) => t.phase === "active" && t.stepIndex === 1, 12000, "E step1");
await page.keyboard.press("Escape"); // exit mid-tour (reader parked on 15 still)
await waitTour((t) => !t.running, 5000);
await page.locator('.rstep[data-active="true"] .tour-launch').click();
const sE = await waitTour((t) => t.running && t.phase === "active", 15000, "E restart");
console.log(`E: restart from page 15 → stepIndex=${sE?.stepIndex}/${sE?.count} counter="${await counter()}"`);
await page.keyboard.press("Escape");

await browser.close();
console.log("DONE");
