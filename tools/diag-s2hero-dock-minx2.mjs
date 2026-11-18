// Diagnose S2-HERO-RACE-CLIPPED-NARROW round 2:
//  A. mid-glide sampling during the Space dock at 1024x768 (transient clip?)
//  B. docked boot via ?step=0 at 1024x768 (no intro path)
//  C. docked screenshot at 1024x768 for visual confirmation.
import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";

const base = process.argv[2] ?? "http://localhost:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const snap = (page) =>
  page.evaluate(() => {
    const d = window.__wp1.debug();
    const l = window.__wp1.layout();
    return {
      scene: d.scene,
      intro: l.intro,
      frameX: l.frameX,
      zoom: Math.round(d.viewAttitude.zoomRadius * 1000) / 1000,
      minX: Math.round(d.viewPan?.box?.minX * 10) / 10,
      paneR: Math.round(d.viewPan?.pane?.right * 10) / 10,
      fpv: d.viewPan?.footprintVisible,
    };
  });

const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });

// --- A. mid-glide samples during Space dock ---
await page.goto(`${base}/`, { waitUntil: "load" });
for (let i = 0; i < 80; i++) {
  if (!(await page.evaluate(() => window.__wp1.animating()))) break;
  await sleep(250);
}
await sleep(300);
await page.keyboard.press("Space");
console.log("A. mid-glide samples (1024x768, Space dock):");
for (let i = 0; i < 12; i++) {
  console.log(`  t+${(i * 150)}ms`, JSON.stringify(await snap(page)));
  await sleep(150);
}

// --- B. docked boot ?step=0 ---
await page.goto(`${base}/?step=0`, { waitUntil: "load" });
for (let i = 0; i < 80; i++) {
  if (!(await page.evaluate(() => window.__wp1.animating()))) break;
  await sleep(250);
}
await sleep(500);
console.log("B. ?step=0 docked boot:", JSON.stringify(await snap(page)));

// --- C. screenshot docked ---
await page.goto(`${base}/`, { waitUntil: "load" });
for (let i = 0; i < 80; i++) {
  if (!(await page.evaluate(() => window.__wp1.animating()))) break;
  await sleep(250);
}
await sleep(300);
await page.keyboard.press("Space");
await sleep(2500);
console.log("C. docked before shot:", JSON.stringify(await snap(page)));
await page.screenshot({ path: "qa/diag-s2hero-docked-1024x768.png" });
console.log("C. screenshot -> qa/diag-s2hero-docked-1024x768.png");
await browser.close();
