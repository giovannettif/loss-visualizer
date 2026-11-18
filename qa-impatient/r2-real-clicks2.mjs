/** R2-REAL2 — Back from a NON-gate sentence (the previous probe clicked Back
 * while parked on the arrowDrawn gate, which by design swallows Back). */
import { BASE, launch, waitReady, ok } from "./driver.mjs";
const { browser, page } = await launch();
await page.goto(BASE + "?step=7", { waitUntil: "load" }); // gd-d hosts s2; tour starts at idx 4 (free)
await waitReady(page);
await page.waitForTimeout(2500);
await page.locator('.rstep[data-active="true"] .tour-launch').click();
await page.waitForTimeout(2500);
let t = await page.evaluate(() => window.__wp1.tour());
console.log("start:", JSON.stringify({ id: t.id, i: t.stepIndex, gate: t.gate, phase: t.phase }));
ok(t.running && t.stepIndex === 4 && !t.gate, "tour starts at last free sentence", JSON.stringify({ i: t.stepIndex, gate: t.gate }));
const bb = await page.locator("#tour-back").boundingBox();
await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
await page.waitForTimeout(2500);
t = await page.evaluate(() => window.__wp1.tour());
console.log("after real Back click:", JSON.stringify({ i: t.stepIndex, gate: t.gate, phase: t.phase, page: t.page }));
ok(t.stepIndex === 3, "real click on Back goes back one (from a non-gate sentence)", `i=${t.stepIndex}`);
// and Back at a gate: swallowed (design)
await page.waitForTimeout(1500);
t = await page.evaluate(() => window.__wp1.tour());
const gateOpen = t.gate;
await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
await page.waitForTimeout(800);
t = await page.evaluate(() => window.__wp1.tour());
ok(gateOpen && t.stepIndex === 3, "Back at an open gate stays swallowed (design)", `gateWas=${gateOpen} i=${t.stepIndex}`);
await page.keyboard.press("Escape");
await browser.close();
console.log("R2-REAL2 done");
