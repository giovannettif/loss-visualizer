/**
 * perf-discrim.mjs — isolates WHY playback frames cost more than orbit frames
 * on the same scene (QA LP-1). Measures rAF gap percentiles in three states:
 *   B  orbit drag before any play (trail Line2s not yet built)
 *   C  orbit drag after a full playback (trails visible at progress 1)
 *   D  playback itself
 * If C ≈ D, visible trail geometry dominates the render; if C ≈ B, the
 * playback path itself adds the cost.
 */

import { chromium } from "playwright";

const url = process.argv[2] ?? "http://localhost:4185/?step=13";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
await page.goto(url, { waitUntil: "load" });
for (let i = 0; i < 60; i++) {
  const a = await page.evaluate(() => ({
    locked: window.__wp1?.locked?.() ?? false,
    animating: window.__wp1?.animating?.() ?? false,
  }));
  if (!a.locked && !a.animating) break;
  await page.waitForTimeout(250);
}
await page.waitForTimeout(400);

await page.evaluate(() => {
  window.__gaps = [];
  window.__last = null;
  const rec = (now) => {
    if (window.__last != null) window.__gaps.push(now - window.__last);
    window.__last = now;
    requestAnimationFrame(rec);
  };
  requestAnimationFrame(rec);
});
const reset = () =>
  page.evaluate(() => {
    window.__gaps = [];
    window.__last = null;
  });
const stat = async (label) => {
  const gaps = await page.evaluate(() => window.__gaps);
  const s = [...gaps].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  console.log(
    `${label}: n=${gaps.length} p50=${q(0.5)?.toFixed(1)} p95=${q(0.95)?.toFixed(1)} over32=${gaps.filter((g) => g > 32).length}`,
  );
};

const canvas = page.locator("#stage canvas").first();
const box = await canvas.boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;

const orbit = async () => {
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 0; i < 40; i++) {
    await page.mouse.move(cx + 150 * Math.sin(i / 6), cy + 40 * Math.cos(i / 6), { steps: 3 });
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
};

await reset();
await orbit();
await stat("B orbit drag pre-play (no trails)");

await page.locator("#play-btn").click();
await page.waitForFunction(
  () => Number(document.querySelector("#replay-scrub")?.value ?? 0) >= 999,
  null,
  { timeout: 60000 },
).catch(() => console.log("playback timeout"));
await page.waitForTimeout(400);
await reset();
await orbit();
await stat("C orbit drag post-play (trails visible)");

await page.locator("#play-btn").click(); // finished → replays from top
await page.waitForTimeout(400);
await reset();
await page.waitForTimeout(3000);
await stat("D playback (trails drawing)");

await browser.close();
