// Diagnose S2-HERO-RACE-CLIPPED-NARROW: boot at narrow viewports (intro,
// full-bleed), press Space to dock, then dump the hero framing diagnostics:
// viewPan.box.minX (terrain box vs canvas left edge), pane bounds, camera
// attitude (zoomRadius), reader width, frameX. Repeats at 1024x768,
// 900x700, 800x600 and 1280x720 (the finding's claimed numbers).
import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";

const base = process.argv[2] ?? "http://localhost:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const dump = () =>
  page.evaluate(() => {
    const d = window.__wp1.debug();
    const l = window.__wp1.layout();
    return {
      scene: d.scene,
      intro: l.intro,
      frameX: l.frameX,
      viewAttitude: d.viewAttitude,
      viewPan: d.viewPan,
      readerW: document.querySelector(".reader, #reader")?.getBoundingClientRect().width ?? null,
      inner: { w: innerWidth, h: innerHeight },
    };
  });

const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });

for (const [w, h] of [[1024, 768], [900, 700], [800, 600], [1280, 720]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto(`${base}/`, { waitUntil: "load" });
  // Wait out the boot/entry animation.
  for (let i = 0; i < 80; i++) {
    const busy = await page.evaluate(() => window.__wp1.animating());
    if (!busy) break;
    await sleep(250);
  }
  await sleep(400);
  const pre = await dump();
  await page.keyboard.press("Space");
  // Wait out the reader slide + frameX ease (~1s) and any scene re-entry.
  await sleep(2500);
  for (let i = 0; i < 20; i++) {
    const busy = await page.evaluate(() => window.__wp1.animating());
    if (!busy) break;
    await sleep(250);
  }
  await sleep(500);
  const post = await dump();
  console.log(`\n=== ${w}x${h} ===`);
  console.log("pre-dock :", JSON.stringify({
    intro: pre.intro, frameX: pre.frameX, zoom: pre.viewAttitude.zoomRadius,
    minX: pre.viewPan?.box?.minX, pane: pre.viewPan?.pane, fpv: pre.viewPan?.footprintVisible,
  }));
  console.log("docked   :", JSON.stringify({
    intro: post.intro, frameX: post.frameX, zoom: post.viewAttitude.zoomRadius,
    azim: Math.round(post.viewAttitude.azimuthDeg), readerW: Math.round(post.readerW),
    minX: post.viewPan?.box?.minX, maxX: post.viewPan?.box?.maxX,
    pane: post.viewPan?.pane, fpv: post.viewPan?.footprintVisible,
  }));
}
await browser.close();
