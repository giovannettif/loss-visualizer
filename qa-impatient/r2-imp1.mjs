/**
 * R2-IMP1 — re-verify IMP-1-ARROWUP-REPEAT-SAIL against the fixed build.
 * The identical probe that sailed 12->0->intro in round 1 must now walk
 * exactly ONE step back and swallow the rest.
 */
import { BASE, launch, waitReady, snapshot, ok } from "./driver.mjs";
const { browser, page } = await launch();
await page.goto(BASE + "?step=12", { waitUntil: "load" });
await waitReady(page);
await page.waitForTimeout(2500);
let s = await snapshot(page);
console.log("start:", s.step);

// --- synthetic OS auto-repeat on ArrowUp (the round-1 repro, unchanged) ---
const sail = await page.evaluate(async () => {
  const log = [];
  const fire = () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", code: "ArrowUp", repeat: true, bubbles: true, cancelable: true }));
  for (let n = 0; n < 25; n++) {
    fire();
    log.push(window.__wp1.step());
    await new Promise((r) => setTimeout(r, 33));
  }
  await new Promise((r) => setTimeout(r, 1500));
  const w = window.__wp1;
  return { walk: log.join(","), end: w.step(), intro: w.scroll().intro, locked: w.locked(), parked: w.scroll().parked };
});
console.log("repeat walk:", sail.walk);
console.log("end:", JSON.stringify(sail));
ok(sail.walk.split(",")[0] === "11", "first repeat... wait — repeats-only never include the initial press");
// With the guard, EVERY repeat:true event is swallowed: the walk must stay at 12.
ok(sail.end === 12 && !sail.intro, "FIXED: held ArrowUp repeats are swallowed (stays at 12, no sail, no intro)",
  `start=12 end=${sail.end} intro=${sail.intro} walk=${sail.walk}`);

// --- and the physical press still pages back exactly once ---
await page.keyboard.press("ArrowUp");
await page.waitForTimeout(1500);
s = await snapshot(page);
ok(s.step === 11, "a fresh ArrowUp press still pages back one step", `step=${s.step}`);

// --- ArrowDown / Space repeat guards still intact (regression) ---
const repDown = await page.evaluate(async () => {
  const fire = (k) => window.dispatchEvent(new KeyboardEvent("keydown", { key: k, code: k === " " ? "Space" : k, repeat: true, bubbles: true, cancelable: true }));
  for (let n = 0; n < 20; n++) { fire("ArrowDown"); await new Promise((r) => setTimeout(r, 33)); }
  return window.__wp1.step();
});
await page.waitForTimeout(800);
const afterDown = (await snapshot(page)).step;
ok(afterDown === 11, "ArrowDown repeat guard intact (repeats-only: no movement)", `after=${afterDown}`);

const repSpace = await page.evaluate(async () => {
  const fire = () => window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", repeat: true, bubbles: true, cancelable: true }));
  for (let n = 0; n < 20; n++) { fire(); await new Promise((r) => setTimeout(r, 33)); }
  return window.__wp1.step();
});
await page.waitForTimeout(800);
const afterSpace = (await snapshot(page)).step;
ok(afterSpace === 11, "Space repeat guard intact (repeats-only: no movement)", `after=${afterSpace}`);

// --- physical ArrowDown/Space still advance one per press ---
await page.keyboard.press("ArrowDown");
await page.waitForTimeout(1800);
s = await snapshot(page);
ok(s.step === 12, "fresh ArrowDown still advances", `step=${s.step}`);
await page.keyboard.press("Space");
await page.waitForTimeout(1800);
s = await snapshot(page);
ok(s.step === 13, "fresh Space still advances", `step=${s.step}`);
await browser.close();
console.log("R2-IMP1 done");
