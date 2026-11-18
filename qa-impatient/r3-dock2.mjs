/** R3-DOCK2 — deterministic restart check: scrub to ~90% (flight time large),
 * then real-click restart, sample quickly (time must collapse to <1s). */
import { BASE, launch, waitReady, ok } from "./driver.mjs";
const { browser, page } = await launch();
await page.setViewportSize({ width: 900, height: 620 });
await page.goto(BASE + "?step=21", { waitUntil: "load" });
await waitReady(page);
await page.waitForTimeout(3500);
// park the flight late via the scrubber (real click)
const sb = await page.locator("#swarm-scrub").boundingBox();
await page.mouse.click(sb.x + sb.width * 0.9, sb.y + sb.height / 2);
await page.waitForTimeout(500);
const before = await page.evaluate(() => ({ time: window.__wp1.swarm().time, total: window.__wp1.swarm().total, scrub: window.__wp1.swarm().scrub }));
console.log("before restart:", JSON.stringify(before));
ok(before.time > before.total * 0.6, "flight parked late via real scrub click", JSON.stringify(before));
await page.locator("#swarm-replay-restart").click();
await page.waitForTimeout(200);
const after = await page.evaluate(() => ({ time: window.__wp1.swarm().time, scrub: window.__wp1.swarm().scrub }));
console.log("after restart (+200ms):", JSON.stringify(after));
ok(after.time < before.time * 0.2, "real click on restart restarts the flight from t≈0", `${before.time.toFixed(2)} -> ${after.time.toFixed(2)}`);
// pause/resume toggle too (the ▶ replay button)
await page.locator("#swarm-replay-play").click();
await page.waitForTimeout(150);
const paused = await page.evaluate(() => window.__wp1.swarm().playing);
await page.waitForTimeout(500);
const tPaused = await page.evaluate(() => window.__wp1.swarm().time);
await page.locator("#swarm-replay-play").click();
await page.waitForTimeout(150);
const resumed = await page.evaluate(() => window.__wp1.swarm().playing);
console.log("pause/resume:", JSON.stringify({ paused, resumed, tPaused }));
ok(paused === false && resumed === true, "play button pauses and resumes the flight", `paused=${paused} resumed=${resumed}`);
await browser.close();
console.log("R3-DOCK2 done");
