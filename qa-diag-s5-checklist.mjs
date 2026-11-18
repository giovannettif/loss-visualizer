// TOUR-POINT-S5-CHECKLIST-LOOK repro probe: ?step=13 → start the s5 tour via
// the chip → release the labMoved gate (step 1/4) by nudging #elong-slider →
// arrive at step 2/4 ("The checklist lights each claim…", look "trails-all").
// Measures the pointing-overlay dot vs the #lab-checklist rect the sentence
// names, plus the sentence address via __wp1.tourCheck().
import { chromium } from "playwright";
import { launchGL } from "./tools/gl-launch.mjs";

const base = "http://localhost:4195";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

await page.goto(`${base}/?step=13`, { waitUntil: "load" });
await sleep(1400);

// Wait for the v4 entry to unlock (lock+skip semantics).
let unlocked = false;
for (let i = 0; i < 60; i++) {
  if (!(await page.evaluate(() => window.__wp1.locked()))) { unlocked = true; break; }
  await sleep(250);
}
console.log("UNLOCKED:", unlocked);

// Start the tour from the section's own chip.
await page.locator('.rstep[data-active="true"] .tour-launch').click();
let s0 = null;
for (let i = 0; i < 48; i++) {
  s0 = await page.evaluate(() => window.__wp1.tour());
  if (s0.running && s0.phase === "active") break;
  await sleep(250);
}
console.log("TOUR-START:", JSON.stringify(s0));

// Sentence address check for the s5 steps (the authoring guard's data).
const tc = await page.evaluate(() =>
  window.__wp1.tourCheck().find((t) => t.id === "s5"),
);
console.log("S5-TOURCHECK:", JSON.stringify(tc?.steps, null, 0));

// Release the labMoved gate: nudge the elongation slider with a real input
// event (the director + gate table both listen to lab state, main.ts:1531).
await page.evaluate(() => {
  const el = document.getElementById("elong-slider");
  el.value = String(Math.max(0, Number(el.value) - 120));
  el.dispatchEvent(new Event("input", { bubbles: true }));
});
let s1 = null;
for (let i = 0; i < 48; i++) {
  s1 = await page.evaluate(() => window.__wp1.tour());
  if (s1.phase === "active" && s1.stepIndex === 1) break;
  await sleep(250);
}
await sleep(700); // let the overlay/spotlight settle
console.log("TOUR-STEP2:", JSON.stringify(s1));

const obs = await page.evaluate(() => {
  const dot = document.getElementById("tour-dot");
  const cx = Number(dot?.getAttribute("cx"));
  const cy = Number(dot?.getAttribute("cy"));
  const cl = document.getElementById("lab-checklist");
  const r = cl?.getBoundingClientRect();
  const ctr = r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
  const dist = ctr ? Math.hypot(cx - ctr.x, cy - ctr.y) : null;
  const sentEl = document.querySelector('[data-tour-active="true"]');
  const sentRect = sentEl?.getBoundingClientRect();
  return {
    overlayOn: document.getElementById("tour-overlay")?.dataset.on ?? null,
    lookKey: window.__wp1.tour().lookKey,
    sentenceText: window.__wp1.tour().sentenceText,
    dot: { x: cx, y: cy },
    checklistRect: r
      ? { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom) }
      : null,
    checklistSpot: cl?.dataset.spot ?? null,
    checklistCenter: ctr ? { x: Math.round(ctr.x), y: Math.round(ctr.y) } : null,
    dotToChecklistCenterPx: dist === null ? null : Math.round(dist),
    sentenceRect: sentRect
      ? { left: Math.round(sentRect.left), top: Math.round(sentRect.top), right: Math.round(sentRect.right), bottom: Math.round(sentRect.bottom) }
      : null,
  };
});
console.log("OBS:", JSON.stringify(obs, null, 1));

await page.screenshot({ path: "qa-diag-s5-checklist.png" });
await browser.close();
