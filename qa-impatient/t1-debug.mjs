import { BASE, launch, waitReady } from "./driver.mjs";
const { browser, page } = await launch();
await page.goto(BASE, { waitUntil: "load" });
await waitReady(page);
const info = await page.evaluate(() => {
  const r = document.querySelector("#reader").getBoundingClientRect();
  const chip = document.querySelector("#reader-chip")?.getBoundingClientRect();
  return {
    reader: { x: r.x, y: r.y, w: r.width, h: r.height },
    chip: chip ? { x: chip.x, y: chip.y, w: chip.width, h: chip.height } : null,
    vw: innerWidth, vh: innerHeight,
    intro: window.__wp1.scroll().intro,
    transform: getComputedStyle(document.querySelector("#reader")).transform,
  };
});
console.log(JSON.stringify(info, null, 1));
// count wheel events that reach window, on a normal page point
await page.evaluate(() => {
  window.__wheelCount = 0;
  window.addEventListener("wheel", () => { window.__wheelCount++; }, { passive: true });
});
const cx = info.vw / 2, cy = info.vh / 2;
console.log("moving to", cx, cy, "element:", await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.id || document.elementFromPoint(x, y)?.tagName, [cx, cy]));
await page.mouse.move(cx, cy);
await page.mouse.wheel(0, 400);
await page.waitForTimeout(600);
console.log("wheelCount:", await page.evaluate(() => window.__wheelCount));
console.log("after wheel:", JSON.stringify(await page.evaluate(() => window.__wp1.scroll())));
await page.screenshot({ path: "qa-impatient/t1-debug-intro.png" });
await browser.close();
