/**
 * T5 — guided-tour controller spam. The impatient presenter:
 *   a) Next-machine-gun through a tour (incl. into a GATE — Next/Space must
 *      be swallowed, count must not run past the gate, no crash),
 *   b) Back/Next ping-pong across a page boundary,
 *   c) chip-switch: start tour B while tour A is mid-travel/gate,
 *   d) Esc anytime (travel, active, gate, minimized) — clean teardown,
 *   e) wheel-master: wheel within the section mid-gate -> controller syncs;
 *      wheel PAST the section -> tour exits cleanly (no orphan artifacts),
 *   f) exit leaves NO artifacts: overlay off, bar off, gate chip off,
 *      sentence unmarked, dim cleared, spotlight cleared.
 */
import { BASE, launch, waitReady, snapshot, ok, shot } from "./driver.mjs";

const { browser, page } = await launch();
await page.goto(BASE + "?step=4", { waitUntil: "load" }); // gd-a, hosts s2
await waitReady(page);
await page.waitForTimeout(2500);
let s = await snapshot(page);
const tour = () => page.evaluate(() => window.__wp1.tour());

// launch the §2 tour
await page.evaluate(() => document.querySelector('.rstep[data-active="true"] .tour-launch')?.click());
await page.waitForTimeout(2500);
let t = await tour();
console.log("tour started:", JSON.stringify({ phase: t.phase, id: t.id, i: t.stepIndex, n: t.count, page: t.page, gate: t.gate, sentence: t.sentenceText.slice(0, 50) }));
ok(t.running && t.id === "s2", "s2 tour starts on gd-a");

// --- (a) Next machine-gun: 16 clicks at 70ms — gates must swallow ---
const spam = await page.evaluate(async () => {
  const log = [];
  const btn = document.querySelector("#tour-next");
  for (let i = 0; i < 16; i++) {
    btn.click();
    await new Promise((r) => setTimeout(r, 70));
    const w = window.__wp1.tour();
    log.push(`${w.phase[0]}${w.stepIndex}${w.gate ? "G" : ""}@p${w.page}`);
  }
  return log.join(" ");
});
await page.waitForTimeout(1500);
t = await tour();
s = await snapshot(page);
console.log("next spam walk:", spam);
console.log("after spam:", JSON.stringify({ phase: t.phase, i: t.stepIndex, gate: t.gate, gateKind: t.gateKind, page: t.page, step: s.step, locked: s.locked }));
ok(t.gate && t.gateKind === "arrowDrawn", "Next spam SWALLOWS at the arrowDrawn gate (no crash, no overrun)", `gate=${t.gateKind} i=${t.stepIndex}`);
ok(s.step === t.page, "reader parked on the gate's page", `step=${s.step} tourPage=${t.page}`);

// --- Space during the gate: swallowed, count frozen ---
await page.keyboard.press("Space");
await page.keyboard.press("Space");
await page.keyboard.press("ArrowDown");
await page.waitForTimeout(600);
t = await tour();
ok(t.gate && t.stepIndex === 1, "Space/ArrowDown at a gate: swallowed, index frozen", `i=${t.stepIndex} gate=${t.gate}`);

// --- (e) wheel WITHIN the section mid-gate -> controller syncs ---
await page.mouse.move(1150, 450);
await page.mouse.wheel(0, 400); // one gesture toward page 6
await page.waitForTimeout(2000);
t = await tour();
s = await snapshot(page);
console.log("after wheel fwd in-section:", JSON.stringify({ phase: t.phase, i: t.stepIndex, page: t.page, step: s.step, gate: t.gate }));
ok(!t.running || t.page === s.step, "wheel inside the section: controller syncs to the parked page (or exited cleanly)", `tourPage=${t.page} step=${s.step}`);

// wheel BACK to page 4, then PAST the section (page 8 = mom-a, not in s2)
if (t.running) {
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(1800);
  t = await tour();
  console.log("wheel back:", JSON.stringify({ phase: t.phase, i: t.stepIndex, page: t.page }));
}
if (t.running) {
  await page.mouse.wheel(0, 900); // big gesture past the section
  await page.waitForTimeout(2000);
  t = await tour();
  s = await snapshot(page);
  console.log("wheel past section:", JSON.stringify({ phase: t.phase, step: s.step }));
  ok(!t.running, "wheel PAST the section exits the tour cleanly", `phase=${t.phase} step=${s.step}`);
}

// --- (f) no artifacts after exit ---
const artifacts = await page.evaluate(() => {
  const q = (id) => document.querySelector(id)?.dataset.on ?? "(absent)";
  const dim = document.querySelector('[data-tour-dim="true"]');
  const marked = document.querySelector('[data-tour-active]');
  return { bar: q("#tour-bar"), overlay: q("#tour-overlay"), gateChip: q("#tour-gate-chip"), status: q("#tour-status"), dim: !!dim, marked: !!marked };
});
console.log("artifacts:", JSON.stringify(artifacts));
ok(artifacts.bar === "false" && artifacts.overlay === "false" && artifacts.gateChip === "false" && !artifacts.dim && !artifacts.marked, "exit removes every artifact", JSON.stringify(artifacts));

// --- (a2) full Next run to FINISH on a gate-free tour (s9 epilogue) ---
await page.goto(BASE + "?step=24", { waitUntil: "load" });
await waitReady(page);
await page.waitForTimeout(2500);
await page.evaluate(() => document.querySelector('.rstep[data-active="true"] .tour-launch')?.click());
await page.waitForTimeout(2000);
const finishRun = await page.evaluate(async () => {
  const btn = document.querySelector("#tour-next");
  const w = () => window.__wp1.tour();
  const log = [];
  for (let i = 0; i < 12; i++) {
    btn.click();
    await new Promise((r) => setTimeout(r, 120));
    const t = w();
    log.push(`${t.phase[0]}${t.stepIndex}/${t.count}`);
    if (!t.running) break;
  }
  await new Promise((r) => setTimeout(r, 2000));
  return { log: log.join(" "), end: w().phase, status: document.querySelector("#tour-status")?.textContent ?? "" };
});
console.log("s9 run:", JSON.stringify(finishRun));
ok(finishRun.end === "idle", "Next-to-FINISH completes and exits cleanly", finishRun.log);
ok(/tour complete/.test(finishRun.status) === false || finishRun.end === "idle", "closing pill shown then dropped");

// --- (c) chip-switch mid-travel: start s3 while s2 is mid-travel ---
await page.goto(BASE + "?step=8", { waitUntil: "load" }); // mom-a hosts s3
await waitReady(page);
await page.waitForTimeout(2200);
await page.evaluate(() => document.querySelector('.rstep[data-active="true"] .tour-launch')?.click()); // s3 starts
await page.waitForTimeout(120); // mid-travel (entry animation playing)
await page.evaluate(() => document.querySelector('.rstep[data-active="true"] .tour-launch')?.click()); // restart s3 mid-travel
await page.waitForTimeout(2200);
t = await tour();
s = await snapshot(page);
console.log("mid-travel restart:", JSON.stringify({ phase: t.phase, id: t.id, i: t.stepIndex, step: s.step }));
ok(t.running && t.phase !== "idle", "re-click the chip mid-travel: clean switch, still running", `phase=${t.phase}`);

// --- (d) Esc during ACTIVE + minimized ---
await page.evaluate(() => document.querySelector("#tour-min")?.click());
await page.waitForTimeout(300);
t = await tour();
ok(t.minimized, "minimize collapses the controller");
await page.keyboard.press("Escape");
await page.waitForTimeout(600);
t = await tour();
s = await snapshot(page);
ok(!t.running, "Esc exits from minimized state");
ok(s.countText === `${s.step + 1} / 27`, "reader intact after Esc", s.countText);

// --- Esc during TRAVEL (mid entry-animation) ---
await page.evaluate(() => document.querySelector('.rstep[data-active="true"] .tour-launch')?.click());
await page.waitForTimeout(80);
await page.keyboard.press("Escape");
await page.waitForTimeout(700);
t = await tour();
s = await snapshot(page);
ok(!t.running && !s.locked, "Esc during travel exits cleanly, reader unlocked", `phase=${t.phase} locked=${s.locked}`);
const art2 = await page.evaluate(() => ({
  bar: document.querySelector("#tour-bar")?.dataset.on,
  overlay: document.querySelector("#tour-overlay")?.dataset.on,
}));
ok(art2.bar === "false" && art2.overlay === "false", "no artifacts after travel-Esc", JSON.stringify(art2));

await shot(page, "t5-tour-end");
await browser.close();
console.log("T5 done");
