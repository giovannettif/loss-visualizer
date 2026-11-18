/** T7b — micro-probe: parked docked step 0, one up-wheel over the reader
 * must re-expand the full-bleed intro (nudgeScroll introBound branch). */
import { BASE, launch, waitReady, ok } from "./driver.mjs";
const { browser, page } = await launch();
await page.goto(BASE + "?step=0", { waitUntil: "load" });
await waitReady(page);
await page.waitForTimeout(3000);
let s = await page.evaluate(() => ({ step: window.__wp1.step(), intro: window.__wp1.scroll().intro, locked: window.__wp1.locked(), parked: window.__wp1.scroll().parked }));
console.log("park:", JSON.stringify(s));
ok(!s.intro && s.step === 0 && !s.locked && s.parked, "parked unlocked on step 0", JSON.stringify(s));
await page.mouse.move(1150, 450);
await page.mouse.wheel(0, -600);
await page.waitForTimeout(1200);
s = await page.evaluate(() => ({ step: window.__wp1.step(), intro: window.__wp1.scroll().intro, y: window.__wp1.scroll().y, target: window.__wp1.scroll().target, introPark: window.__wp1.scroll().introPark }));
console.log("after up-wheel:", JSON.stringify(s));
ok(s.intro && Math.abs(s.y + s.introPark) < 3, "wheel-up from parked step 0 re-enters the intro and re-parks", JSON.stringify(s));
// and back down again (fresh gesture after 300ms dock-guard idle)
await page.waitForTimeout(400);
await page.mouse.wheel(0, 600);
await page.waitForTimeout(1200);
s = await page.evaluate(() => ({ step: window.__wp1.step(), intro: window.__wp1.scroll().intro, y: window.__wp1.scroll().y }));
ok(!s.intro && s.step === 0, "wheel-down re-docks on step 0", JSON.stringify(s));
await browser.close();
console.log("T7b done");
