/**
 * T5b — the three T5 segments that need realistic pacing:
 *   e) wheel PAST the section (real multi-gesture wheel) exits the tour;
 *      also rail-jump-out exits mid-gate;
 *   f) artifact teardown asserted AFTER confirmed exit;
 *   a2) s9 Next-to-FINISH at a humane pace (travel clicks skip the entry).
 */
import { BASE, launch, waitReady, snapshot, ok, shot } from "./driver.mjs";

const { browser, page } = await launch();
const tour = (p) => p.evaluate(() => window.__wp1.tour());

// ============ e) wheel out of the section, from a mid-gate state ============
await page.goto(BASE + "?step=5", { waitUntil: "load" }); // gd-b, hosts s2, gate page
await waitReady(page);
await page.waitForTimeout(2500);
await page.evaluate(() => document.querySelector('.rstep[data-active="true"] .tour-launch')?.click());
await page.waitForTimeout(2500);
let t = await tour(page);
console.log("start:", JSON.stringify({ id: t.id, phase: t.phase, i: t.stepIndex, gate: t.gate, page: t.page }));
ok(t.id === "s2" && t.gate, "s2 tour running on its gate step");

// advance to the NEXT page (6) by wheel: two full gestures with settle time
await page.mouse.move(1150, 450);
for (const dy of [500, 500]) {
  await page.mouse.wheel(0, dy);
  await page.waitForTimeout(190); // gesture boundary (180ms idle)
}
await page.waitForTimeout(2500);
t = await tour(page);
let s = await snapshot(page);
console.log("after wheel to 6:", JSON.stringify({ phase: t.phase, i: t.stepIndex, page: t.page, step: s.step }));
ok(t.running && t.page === 6 && s.step === 6, "wheel to page 6: controller SYNCED to page 6", `tourPage=${t.page} step=${s.step}`);

// now wheel PAST the section (page 8+): two more gestures
for (const dy of [500, 500]) {
  await page.mouse.wheel(0, dy);
  await page.waitForTimeout(190);
}
await page.waitForTimeout(2500);
t = await tour(page);
s = await snapshot(page);
console.log("after wheel past section:", JSON.stringify({ phase: t.phase, step: s.step }));
ok(!t.running, "wheel PAST the last tour page exits the tour cleanly", `phase=${t.phase} step=${s.step}`);

// teardown assertions AFTER confirmed exit
const art = await page.evaluate(() => {
  const q = (id) => document.querySelector(id)?.dataset.on ?? "(absent)";
  return {
    bar: q("#tour-bar"), overlay: q("#tour-overlay"), gateChip: q("#tour-gate-chip"),
    dim: !!document.querySelector('[data-tour-dim="true"]'),
    marked: !!document.querySelector("[data-tour-active]"),
    look: window.__wp1.look()?.id ?? null,
  };
});
console.log("artifacts:", JSON.stringify(art));
ok(art.bar === "false" && art.overlay === "false" && art.gateChip === "false" && !art.dim && !art.marked, "no artifacts after wheel-exit", JSON.stringify(art));

// ============ e2) rail-jump out MID-GATE (far exit) ============
await page.goto(BASE + "?step=15", { waitUntil: "load" }); // fog-a hosts s6
await waitReady(page);
await page.waitForTimeout(2500);
await page.evaluate(() => document.querySelector('.rstep[data-active="true"] .tour-launch')?.click());
await page.waitForTimeout(2500);
t = await tour(page);
// get to the fogRun gate (step idx 4: page 16) by Next
for (let i = 0; i < 5; i++) {
  await page.evaluate(() => document.querySelector("#tour-next")?.click());
  await page.waitForTimeout(900);
}
t = await tour(page);
console.log("s6 state:", JSON.stringify({ phase: t.phase, i: t.stepIndex, gate: t.gate, gateKind: t.gateKind, page: t.page }));
// machine-gun Next while gated, then rail-jump FAR outside s6
await page.evaluate(async () => {
  const b = document.querySelector("#tour-next");
  for (let i = 0; i < 10; i++) { b.click(); await new Promise((r) => setTimeout(r, 60)); }
});
await page.evaluate(() => document.querySelectorAll("#rail button")[22].click()); // labrule, outside s6
await page.waitForTimeout(3000);
t = await tour(page);
s = await snapshot(page);
console.log("after gate-spam + rail-out:", JSON.stringify({ phase: t.phase, step: s.step, locked: s.locked }));
ok(!t.running, "rail-jump out MID-GATE exits the tour (gate does not trap)", `phase=${t.phase}`);
ok(s.step === 22 && !s.locked, "reader landed on labrule, unlocked", `step=${s.step}`);
const art2 = await page.evaluate(() => ({
  bar: document.querySelector("#tour-bar")?.dataset.on,
  overlay: document.querySelector("#tour-overlay")?.dataset.on,
  gateChip: document.querySelector("#tour-gate-chip")?.dataset.on,
}));
ok(art2.bar === "false" && art2.overlay === "false" && art2.gateChip === "false", "gate chip torn down on exit", JSON.stringify(art2));

// ============ a2) s9 finish run, humane pace ============
await page.goto(BASE + "?step=24", { waitUntil: "load" });
await waitReady(page);
await page.waitForTimeout(2500);
await page.evaluate(() => document.querySelector('.rstep[data-active="true"] .tour-launch')?.click());
await page.waitForTimeout(2200);
const finishRun = await page.evaluate(async () => {
  const btn = document.querySelector("#tour-next");
  const w = () => window.__wp1.tour();
  const log = [];
  for (let i = 0; i < 40; i++) {
    btn.click(); // travel clicks skip the entry; active clicks advance
    await new Promise((r) => setTimeout(r, 450));
    const t = w();
    log.push(`${t.phase[0]}${t.stepIndex}/${t.count}${t.gate ? "G" : ""}`);
    if (!t.running) break;
  }
  await new Promise((r) => setTimeout(r, 2200));
  return { log: log.join(" "), end: w().phase, bar: document.querySelector("#tour-bar")?.dataset.on };
});
console.log("s9 run:", JSON.stringify(finishRun, null, 1).slice(0, 600));
ok(finishRun.end === "idle", "Next-to-FINISH completes and self-exits", `end=${finishRun.end}`);
ok(finishRun.bar === "false", "controller bar gone after completion");
await shot(page, "t5b-end");
await browser.close();
console.log("T5b done");
