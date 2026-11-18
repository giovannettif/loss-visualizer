/**
 * T2c — focused re-probe: after an ArrowUp synthetic-repeat sail into the
 * intro, does a rail teleport to step 4 land cleanly and do keys work again?
 * Dense state dumps around every action.
 */
import { BASE, launch, waitReady, snapshot, ok } from "./driver.mjs";

const { browser, page } = await launch();
await page.goto(BASE + "?step=12", { waitUntil: "load" });
await waitReady(page);
await page.waitForTimeout(2500);
let s = await snapshot(page);
console.log("start:", s.step, "locked:", s.locked, "intro:", s.scroll.intro);

const sail = await page.evaluate(async () => {
  const log = [];
  const fire = () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", code: "ArrowUp", repeat: true, bubbles: true, cancelable: true }));
  for (let n = 0; n < 25; n++) {
    fire();
    log.push(`${window.__wp1.step()}${window.__wp1.scroll().intro ? "i" : ""}`);
    await new Promise((r) => setTimeout(r, 33));
  }
  await new Promise((r) => setTimeout(r, 1500));
  const w = window.__wp1;
  return { walk: log.join(","), end: w.step(), intro: w.scroll().intro, locked: w.locked(), y: w.scroll().y, target: w.scroll().target, parked: w.scroll().parked };
});
console.log("sail walk:", sail.walk);
console.log("sail end:", JSON.stringify(sail));

// rail teleport to 4 from wherever the sail left us
await page.evaluate(() => { document.querySelectorAll("#rail button")[4].click(); });
await page.waitForTimeout(300);
const rightAfter = await snapshot(page);
console.log("after rail[4] click (+300ms):", JSON.stringify({ step: rightAfter.step, locked: rightAfter.locked, animating: rightAfter.animating, intro: rightAfter.scroll.intro, y: rightAfter.scroll.y, target: rightAfter.scroll.target }));
await page.waitForTimeout(2200);
s = await snapshot(page);
console.log("after rail[4] +2.5s:", JSON.stringify({ step: s.step, locked: s.locked, animating: s.animating, parked: s.scroll.parked, intro: s.scroll.intro }));

// do keys work again?
await page.keyboard.press("ArrowDown");
await page.waitForTimeout(1800);
s = await snapshot(page);
console.log("after one ArrowDown:", JSON.stringify({ step: s.step, locked: s.locked, animating: s.animating, parked: s.scroll.parked }));
ok(s.step === 5, "keys work again after the sail + rail teleport", `step=${s.step}`);
await browser.close();
console.log("T2c done");
