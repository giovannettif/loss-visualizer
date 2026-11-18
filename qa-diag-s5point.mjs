// TOUR-POINT-S5-LAB-GATE-STAGE repro: §5 tour step 1/4 (page 13, lab) — the
// sentence names the lab sliders and the gate (labMoved) demands reshaping
// with them, but the look target is "trails-all" (stage). Measure the live
// dot vs the named controls. Drive mirrors tools/gate-tour.mjs (§7 smoke).
import { chromium } from "playwright";
import { launchGL } from "./tools/gl-launch.mjs";

const base = process.argv[2] ?? "http://localhost:4195";
const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(`${base}/?step=13`, { waitUntil: "load" });
await sleep(1400);
for (let i = 0; i < 60; i++) {
  const a = await page.evaluate(() => ({
    locked: window.__wp1?.locked?.(),
    animating: window.__wp1?.animating?.(),
  }));
  if (!a.locked && !a.animating) break;
  await sleep(200);
}

await page.locator('.rstep[data-active="true"] .tour-launch').click();
// Wait for step 0 active with the labMoved gate armed.
let s = null;
for (let i = 0; i < 100; i++) {
  s = await page.evaluate(() => window.__wp1?.tour?.() ?? null);
  if (s && s.phase === "active" && s.stepIndex === 0 && s.gate) break;
  await sleep(120);
}
console.log("TOUR:", JSON.stringify(s));
await sleep(700); // clear the 0.35s overlay/dim fades (gate-tour idiom)

const m = await page.evaluate(() => {
  const dot = document.querySelector("#tour-dot");
  const lead = document.querySelector("#tour-lead");
  const elong = document.querySelector("#elong-slider");
  const rot = document.querySelector("#rot-slider");
  const wrap = elong?.closest(".eta-control");
  const rect = (el) => {
    const r = el?.getBoundingClientRect();
    return r
      ? { x: +r.left.toFixed(1), y: +r.top.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) }
      : null;
  };
  const sent = document.querySelector('.rstep[data-active="true"] span.sent[data-tour-active="true"]');
  const gate = document.querySelector("#tour-gate-chip");
  return {
    dot: dot ? { x: +dot.getAttribute("cx"), y: +dot.getAttribute("cy") } : null,
    overlayOn: document.querySelector("#tour-overlay")?.dataset.on,
    leadD: lead?.getAttribute("d")?.slice(0, 60) ?? null,
    elong: rect(elong),
    rot: rect(rot),
    etaControlWrap: rect(wrap),
    sentence: sent?.textContent ?? null,
    gateChip: gate?.dataset.on === "true" ? gate.textContent : null,
    lookKey: window.__wp1?.tour?.()?.lookKey ?? null,
    spotGlowOnWrap: wrap?.dataset.spot ?? null,
  };
});
const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
const dc = { x: m.elong.x + m.elong.w / 2, y: m.elong.y + m.elong.h / 2 };
const rc = { x: m.rot.x + m.rot.w / 2, y: m.rot.y + m.rot.h / 2 };
console.log("MEASURED:", JSON.stringify(m, null, 2));
console.log("dot→#elong-slider center:", dist(m.dot, dc).toFixed(1), "px");
console.log("dot→#rot-slider center:", dist(m.dot, rc).toFixed(1), "px");
console.log("dot x < reader? (stage-side):", m.dot.x < 1100);
await page.screenshot({ path: "shots/_diag_s5point_before.png" });
await browser.close();
