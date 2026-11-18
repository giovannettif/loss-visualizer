/**
 * T2 — held keys / OS auto-repeat: the impatient user holds ↓, Space, ↑.
 * Contract (QA KW2-SPACE-REPEAT-BYPASSES-LOCK): ONE advance per physical
 * press — a held key must not sail through steps.
 */
import { BASE, launch, waitReady, snapshot, ok, shot } from "./driver.mjs";

const { browser, page } = await launch();

// deep-link to step 4 (gd-a) docked, let the entry drain
await page.goto(BASE + "?step=4", { waitUntil: "load" });
await waitReady(page);
await page.waitForTimeout(2500); // let the boot entry lock drain
await page.mouse.move(1100, 450); // over the reader

let s = await snapshot(page);
console.log("start step:", s.step, "locked:", s.locked);
ok(s.step === 4 && !s.locked, "boot parked on step 4, unlocked", `step=${s.step} locked=${s.locked}`);

// --- hold ArrowDown 1.4s (OS auto-repeat fires ~30/s in Chromium) ---
await page.keyboard.down("ArrowDown");
await page.waitForTimeout(1400);
const midDown = await snapshot(page);
await page.keyboard.up("ArrowDown");
await page.waitForTimeout(1200);
s = await snapshot(page);
console.log("held ArrowDown: mid=", midDown.step, "final=", s.step, "finalLocked=", s.locked);
ok(s.step === 5, "held ArrowDown advances EXACTLY one step", `start=4 final=${s.step}`);
ok(!s.locked && !s.animating, "reader unlocked after the single advance");

// --- hold Space 1.4s ---
await page.keyboard.down("Space");
await page.waitForTimeout(1400);
const midSpace = await snapshot(page);
await page.keyboard.up("Space");
await page.waitForTimeout(1200);
s = await snapshot(page);
console.log("held Space: mid=", midSpace.step, "final=", s.step);
ok(s.step === 6, "held Space advances EXACTLY one step", `start=5 final=${s.step}`);

// --- hold ArrowUp 1.4s — same contract expected ---
await page.keyboard.down("ArrowUp");
await page.waitForTimeout(1400);
const midUp = await snapshot(page);
await page.keyboard.up("ArrowUp");
await page.waitForTimeout(1200);
s = await snapshot(page);
console.log("held ArrowUp: mid=", midUp.step, "final=", s.step);
ok(s.step === 5, "held ArrowUp goes back EXACTLY one step",
  `start=6 mid=${midUp.step} final=${s.step} ${s.step !== 5 ? "<<< HELD ArrowUp SAILS BACKWARD" : ""}`);

// --- ArrowUp sailing probe: how far does a 1.5s hold actually walk? ---
if (s.step !== 5) {
  // measure from a known park: go to 16 first
  await page.evaluate(() => { document.querySelectorAll("#rail button")[16].click(); });
  await page.waitForTimeout(2500);
  s = await snapshot(page);
  const from = s.step;
  await page.keyboard.down("ArrowUp");
  await page.waitForTimeout(1500);
  const mid = await snapshot(page);
  await page.keyboard.up("ArrowUp");
  await page.waitForTimeout(1000);
  s = await snapshot(page);
  console.log("ArrowUp walk:", from, "->", mid.step, "->", s.step);
  ok(s.step === from - 1, "held ArrowUp (probe) walks exactly one step", `${from} -> ${s.step}`);
}

// --- consistency after all the key spam ---
ok(s.countText === `${s.step + 1} / 27`, "count text matches step", s.countText);
ok(s.railCurrent === s.step, "rail matches step");
ok(s.scroll.parked || s.locked, "parked or legitimately locked", `parked=${s.scroll.parked} locked=${s.locked}`);

await shot(page, "t2-after-key-spam");
await browser.close();
console.log("T2 done");
