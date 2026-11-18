/**
 * T5c — exit-past-section via wheel from page 7 -> 8 (out of s2's pages),
 * and the labrule entry lock drain time after a mid-gate rail-jump.
 */
import { BASE, launch, waitReady, snapshot, ok } from "./driver.mjs";
const { browser, page } = await launch();
const tour = () => page.evaluate(() => window.__wp1.tour());

await page.goto(BASE + "?step=6", { waitUntil: "load" }); // gd-c hosts s2
await waitReady(page);
await page.waitForTimeout(2500);
await page.evaluate(() => document.querySelector('.rstep[data-active="true"] .tour-launch')?.click());
await page.waitForTimeout(2500);
let t = await tour();
console.log("tour:", JSON.stringify({ id: t.id, phase: t.phase, page: t.page }));

// page 6 -> 7 (still in section: syncs), 7 -> 8 (OUT: must exit)
await page.mouse.move(1150, 450);
await page.mouse.wheel(0, 500);
await page.waitForTimeout(2000);
t = await tour();
console.log("at 7:", JSON.stringify({ phase: t.phase, page: t.page, i: t.stepIndex }));
ok(t.running && t.page === 7, "page 7 is INSIDE s2 -> tour stays and syncs", `page=${t.page}`);

await page.mouse.wheel(0, 500);
let exited = false;
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(1000);
  t = await tour();
  if (!t.running) { exited = true; break; }
}
const s = await snapshot(page);
console.log("after wheel 7->8:", JSON.stringify({ phase: t.phase, step: s.step, locked: s.locked }));
ok(exited, "wheel to page 8 (outside s2) EXITS the tour", `phase=${t.phase} step=${s.step}`);
const art = await page.evaluate(() => ({
  bar: document.querySelector("#tour-bar")?.dataset.on,
  overlay: document.querySelector("#tour-overlay")?.dataset.on,
}));
ok(art.bar === "false" && art.overlay === "false", "artifacts torn down after wheel-exit", JSON.stringify(art));

// labrule lock drain after mid-gate rail-jump (generous window)
await page.goto(BASE + "?step=15", { waitUntil: "load" });
await waitReady(page);
await page.waitForTimeout(2500);
await page.evaluate(() => document.querySelector('.rstep[data-active="true"] .tour-launch')?.click());
await page.waitForTimeout(2200);
for (let i = 0; i < 5; i++) { await page.evaluate(() => document.querySelector("#tour-next")?.click()); await page.waitForTimeout(800); }
t = await tour();
console.log("s6 tour:", JSON.stringify({ i: t.stepIndex, gate: t.gate, gateKind: t.gateKind }));
await page.evaluate(() => document.querySelectorAll("#rail button")[22].click());
let unlockedAt = -1;
for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(1000);
  const st = await snapshot(page);
  if (!st.locked) { unlockedAt = i + 1; break; }
}
const s2 = await snapshot(page);
console.log("labrule after rail-jump:", JSON.stringify({ step: s2.step, locked: s2.locked, animating: s2.animating, unlockedAfterSec: unlockedAt }));
ok(!s2.locked, "labrule entry lock drains (no deadlock)", `unlocked after ~${unlockedAt}s`);
ok(s2.railCurrent === 22 && s2.countText === "23 / 27", "landing consistent", `rail=${s2.railCurrent} count=${s2.countText}`);
await browser.close();
console.log("T5c done");
