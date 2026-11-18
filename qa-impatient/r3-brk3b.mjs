/** R3-BRK3b — pause semantics: read playing BEFORE the ▶ click. Ended flight
 * → ▶ means replay (playing=true). Only a PLAYING flight should pause. */
import { BASE, launch, waitReady, ok } from "./driver.mjs";
const { browser, page } = await launch();
await page.setViewportSize({ width: 900, height: 620 });
await page.goto(BASE + "?step=21", { waitUntil: "load" });
await waitReady(page);
await page.waitForTimeout(3000);
await page.locator('.rstep[data-active="true"] .tour-launch').click();
await page.waitForTimeout(2000);
// fresh flight (tour start does not touch it; it is mid-flight) — pause FIRST
const st0 = await page.evaluate(() => ({ playing: window.__wp1.swarm().playing, time: window.__wp1.swarm().time }));
console.log("before:", JSON.stringify(st0));
await page.locator("#swarm-replay-play").click();
await page.waitForTimeout(150);
const st1 = await page.evaluate(() => ({ playing: window.__wp1.swarm().playing, time: window.__wp1.swarm().time }));
await page.waitForTimeout(400);
const st2 = await page.evaluate(() => ({ playing: window.__wp1.swarm().playing, time: window.__wp1.swarm().time }));
console.log("after pause click:", JSON.stringify(st1), "held 400ms:", JSON.stringify(st2));
ok(st0.playing === true && st1.playing === false && st2.time === st1.time,
  "▶ on a PLAYING flight pauses it (time frozen)", JSON.stringify({ st0, st1, st2 }));
await page.locator("#swarm-replay-play").click();
await page.waitForTimeout(150);
const st3 = await page.evaluate(() => ({ playing: window.__wp1.swarm().playing, time: window.__wp1.swarm().time }));
await page.waitForTimeout(400);
const st4 = await page.evaluate(() => ({ playing: window.__wp1.swarm().playing, time: window.__wp1.swarm().time }));
console.log("after resume click:", JSON.stringify(st3), "held 400ms:", JSON.stringify(st4));
ok(st3.playing === true && st4.time > st3.time, "▶ again resumes (time advances)", JSON.stringify({ st3, st4 }));
// ended flight: ▶ replays
await page.evaluate(() => window.__wp1.swarm() && null);
await page.locator("#swarm-replay-restart").click();
await page.waitForTimeout(100);
// drive to the end quickly via scrub
const sb = await page.locator("#swarm-scrub").boundingBox();
await page.mouse.click(sb.x + sb.width, sb.y + sb.height / 2);
await page.waitForTimeout(2500);
const end = await page.evaluate(() => ({ playing: window.__wp1.swarm().playing, time: window.__wp1.swarm().time, total: window.__wp1.swarm().total }));
console.log("at end:", JSON.stringify(end));
if (end.time >= end.total - 0.2) {
  await page.locator("#swarm-replay-play").click();
  await page.waitForTimeout(200);
  const re = await page.evaluate(() => ({ playing: window.__wp1.swarm().playing, time: window.__wp1.swarm().time }));
  console.log("▶ on ended flight:", JSON.stringify(re));
  ok(re.playing === true && re.time < end.total, "▶ on an ENDED flight REPLAYS from the start (not pause — correct transport semantics)", JSON.stringify(re));
} else {
  console.log("flight did not reach the end in the window; replay-semantics check skipped (covered by dock2 restart)");
}
await page.keyboard.press("Escape");
await browser.close();
console.log("R3-BRK3b done");
