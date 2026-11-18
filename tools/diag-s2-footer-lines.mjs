// Follow-up for S2-FOOTER-REFLOW-WRAP: count real line boxes inside
// #skip-btn / #continue-hint via Range.getClientRects() (one fragment per
// rendered line per inline), so a two-line label forced into the fixed
// 31px slot cannot masquerade as one line.
import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await launchGL(chromium);

async function lines(page, sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el || el.hidden) return null;
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0.5);
    const tops = [...new Set(rects.map((r) => Math.round(r.top)))];
    return { rects: rects.length, lines: tops.length, tops };
  }, sel);
}

for (const [w, h, from, when] of [
  [1280, 720, 5, "idle-hint"],
  [1600, 900, 6, "lock-skip"],
  [1280, 720, 6, "idle-hint"],
]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(`http://localhost:4183/?step=${from}`, { waitUntil: "load" });
  for (let i = 0; i < 200; i++) {
    const s = await page.evaluate(() => ({ l: window.__wp1?.locked?.(), a: window.__wp1?.animating?.() }));
    if (!s.l && !s.a) break;
    await sleep(150);
  }
  if (when === "lock-skip") {
    await page.keyboard.press("ArrowDown");
    for (let i = 0; i < 400; i++) {
      if (await page.evaluate(() => window.__wp1?.locked?.())) break;
      await sleep(25);
    }
  }
  await sleep(400);
  const skip = await lines(page, "#skip-btn");
  const hint = await lines(page, "#continue-hint");
  const foot = await page.evaluate(() => {
    const f = document.querySelector("#reader-foot");
    return { h: f.getBoundingClientRect().height, step: window.__wp1.step(), locked: window.__wp1.locked() };
  });
  console.log(`${w}x${h} ?step=${from} ${when}: step=${foot.step} locked=${foot.locked} footH=${foot.h} skip=${JSON.stringify(skip)} hint=${JSON.stringify(hint)}`);
  await page.close();
}
await browser.close();
