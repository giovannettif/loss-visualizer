/** T10 — wheel policy edges: Ctrl+wheel (page zoom) must not advance the
 * stepper (QA KW-7); the continue hint double-click must not double-fire. */
import { BASE, launch, waitReady, snapshot, ok } from "./driver.mjs";
const { browser, page } = await launch();
await page.goto(BASE + "?step=8", { waitUntil: "load" });
await waitReady(page);
await page.waitForTimeout(3000);
let s = await snapshot(page);
const start = s.step;

// Ctrl+wheel over the reader: stepper must ignore it
await page.mouse.move(1150, 450);
await page.keyboard.down("Control");
await page.mouse.wheel(0, 600);
await page.mouse.wheel(0, 600);
await page.keyboard.up("Control");
await page.waitForTimeout(1200);
s = await snapshot(page);
ok(s.step === start, "Ctrl+wheel over the reader does NOT advance (KW-7)", `start=${start} step=${s.step}`);
ok(!s.scroll.intro, "ctrl-wheel did not dock/undock anything", `intro=${s.scroll.intro}`);

// plain wheel right after: normal advance (guard released)
await page.mouse.wheel(0, 500);
await page.waitForTimeout(2200);
s = await snapshot(page);
ok(s.step === start + 1, "plain wheel after ctrl-wheel advances normally", `step=${s.step}`);

// continue hint: double-click = two advances (two deliberate gestures), not a crash
await page.waitForTimeout(1000);
s = await snapshot(page);
const hintVisible = !s.hintHidden;
if (hintVisible) {
  await page.evaluate(() => { const h = document.querySelector("#continue-hint"); h.click(); h.click(); });
  await page.waitForTimeout(2500);
  s = await snapshot(page);
  ok(s.step === start + 2 && !s.locked, "hint double-click = two clean advances (second swallowed by lock, then drained)", `step=${s.step}`);
} else {
  console.log("  hint not visible at this step; skipped double-click probe");
}
ok(s.railCurrent === s.step && s.activeInert, "consistent at end", `rail=${s.railCurrent}`);
await browser.close();
console.log("T10 done");
