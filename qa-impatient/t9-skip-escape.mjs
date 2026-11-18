/** T9 — the impatient user's out: hammer Skip during the slow labrule
 * entry lock (t5c showed ~13s passive wait). Skip should cut it to ~0. */
import { BASE, launch, waitReady, snapshot, ok } from "./driver.mjs";
const { browser, page } = await launch();
await page.goto(BASE + "?step=15", { waitUntil: "load" });
await waitReady(page);
await page.waitForTimeout(2500);
// open the s6 tour, park on a gate, then rail-jump far (mid-gate)
await page.evaluate(() => document.querySelector('.rstep[data-active="true"] .tour-launch')?.click());
await page.waitForTimeout(2000);
await page.evaluate(() => document.querySelectorAll("#rail button")[22].click());
await page.waitForTimeout(400);
const t0 = Date.now();
let s = await snapshot(page);
console.log("t+0.4s:", JSON.stringify({ step: s.step, locked: s.locked, skipHidden: s.skipHidden }));
// hammer Skip as fast as the button allows
for (let i = 0; i < 30 && s.locked; i++) {
  await page.evaluate(() => { const b = document.querySelector("#skip-btn"); if (!b.hidden) b.click(); });
  await page.waitForTimeout(120);
  s = await snapshot(page);
}
const dt = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`after Skip hammer (~${dt}s):`, JSON.stringify({ step: s.step, locked: s.locked, animating: s.animating }));
ok(!s.locked, `Skip hammer drains the labrule entry lock fast (${dt}s incl. hammer loop)`, `locked=${s.locked}`);
ok(s.step === 22 && s.railCurrent === 22, "landing consistent", `step=${s.step} rail=${s.railCurrent}`);
await browser.close();
console.log("T9 done");
