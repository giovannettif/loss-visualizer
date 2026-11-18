/**
 * T3 — rail-jump spam. The impatient user machine-guns the right-edge rail:
 * far jumps back-to-back, clicks DURING an entry lock (must be ignored, not
 * queued), and a final landing that must be consistent everywhere:
 * step == scene == count text == rail highlight == park position == inert.
 */
import { BASE, launch, waitReady, snapshot, ok, shot } from "./driver.mjs";

const { browser, page } = await launch();
await page.goto(BASE + "?step=2", { waitUntil: "load" });
await waitReady(page);
await page.waitForTimeout(2500);
let s = await snapshot(page);
ok(s.step === 2 && !s.locked, "boot on step 2", `step=${s.step}`);

const clickRail = (k) => page.evaluate((i) => document.querySelectorAll("#rail button")[i].click(), k);

// --- spam 1: far jumps back-to-back with NO settle time ---
await clickRail(20);
await page.waitForTimeout(80);
await clickRail(3);
await page.waitForTimeout(80);
await clickRail(16);
await page.waitForTimeout(80);
await clickRail(9);
await page.waitForTimeout(80);
await clickRail(24);
await page.waitForTimeout(80);
await clickRail(6);
await page.waitForTimeout(80);
await clickRail(12);
await page.waitForTimeout(3000); // generous drain
s = await snapshot(page);
console.log("after spam1:", JSON.stringify({ step: s.step, scene: s.scene, locked: s.locked, animating: s.animating }));
// The FIRST click (20) wins: every later click landed mid-lock and the rail
// handler ignores clicks while locked (main.ts rail click guard) — the last
// click can only win when every entry stayed under the ~350ms no-anim lock.
// Either way the landing must be consistent; assert the settled state.
ok(s.step === 20 || s.step === 12, "spam settles on ONE step consistently (first-wins if locks hold)", `step=${s.step}`);
ok(s.scene === (s.step === 20 ? "tilt-b" : "labrule"), "scene matches the landed step", `${s.scene}@${s.step}`);
ok(!s.locked && !s.animating, "lock drained after spam");

// --- spam 2: clicks DURING a live entry lock ---
await clickRail(21); // far jump: entry animation + lock
await page.waitForTimeout(150); // mid-entry
const mid = await snapshot(page);
console.log("mid-entry:", JSON.stringify({ step: mid.step, locked: mid.locked }));
ok(mid.locked, "far jump holds the entry lock (checked mid-entry)");
// machine-gun rail clicks during the lock — each must be IGNORED, none queued
for (const k of [1, 25, 7, 18, 2]) { await clickRail(k); await page.waitForTimeout(30); }
await page.waitForTimeout(4000);
s = await snapshot(page);
console.log("after mid-lock spam:", JSON.stringify({ step: s.step, locked: s.locked, parked: s.scroll.parked }));
ok(s.step === 21, "mid-lock rail clicks are ignored — landing stays step 21", `step=${s.step}`);
ok(!s.locked, "lock eventually drains (no deadlock)");

// --- consistency after the lock: count/rail/scene/inert/park all agree ---
ok(s.countText === `${s.step + 1} / 27`, "count text", s.countText);
ok(s.railCurrent === s.step, "rail highlight", `rail=${s.railCurrent} step=${s.step}`);
ok(s.activeInert, "inert discipline");
ok(s.scene === ["hero","task-a","task-b","task-c","gd-a","gd-b","gd-c","gd-d","mom-a","mom-b","mom-c","adam-a","adam-b","lab","lab","fog-a","fog-b","fog-c","tilt-a","tilt-a","tilt-b","swarm","labrule","labrule","epi-a","epi-b","epi-c"][s.step], "scene matches step", `${s.scene}@${s.step}`);
// scene order: index 20 is labrule, 19 swarm — check via SCENE_ORDER deep link instead
await page.waitForTimeout(500);
s = await snapshot(page);
ok(s.scroll.parked && Math.abs(s.scroll.y - s.scroll.tops[s.step]) < 2, "parked on the landed step's top", `y=${s.scroll.y} top=${s.scroll.tops[s.step]}`);
ok(s.hintHidden === false || s.step === 26, "continue hint visible after drain");
ok(s.skipHidden === true, "skip hidden after drain");

// --- spam 3: adjacent-click ping-pong (6<->7 style) rapid ---
for (let i = 0; i < 10; i++) { await clickRail(i % 2 ? 14 : 13); await page.waitForTimeout(70); }
await page.waitForTimeout(3000);
s = await snapshot(page);
ok(s.step === 13 || s.step === 14, "ping-pong lands on one of the two pages, consistent", `step=${s.step}`);
ok(s.railCurrent === s.step && s.activeInert && !s.locked, "consistent after ping-pong", `rail=${s.railCurrent} locked=${s.locked}`);

// --- spam 4: rail jump from the INTRO (reader slid away) ---
await clickRail(0);
await page.waitForTimeout(800);
s = await snapshot(page);
console.log("at 0:", JSON.stringify({ step: s.step, intro: s.scroll.intro }));
// ArrowUp into the intro, then a far rail jump
await page.keyboard.press("ArrowUp");
await page.waitForTimeout(900);
s = await snapshot(page);
ok(s.scroll.intro, "ArrowUp at step 0 re-enters the intro");
await clickRail(19);
await page.waitForTimeout(3500);
s = await snapshot(page);
console.log("intro->rail19:", JSON.stringify({ step: s.step, scene: s.scene, locked: s.locked, intro: s.scroll.intro, parked: s.scroll.parked }));
ok(s.step === 19 && !s.scroll.intro && !s.locked && s.scroll.parked,
  "far rail jump FROM the intro docks and lands cleanly", `step=${s.step} intro=${s.scroll.intro} parked=${s.scroll.parked}`);

await shot(page, "t3-after-rail-spam");
await browser.close();
console.log("T3 done");
