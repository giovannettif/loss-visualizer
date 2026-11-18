// Diagnostic — SW2-S8-DIVERGED-TRAIL-PAST-EXTENT, Rosenbrock chord case.
// The finding's s3-rosen artifacts (η≈0.0956 / η≈0.176, parts raw+unclipped):
// with the old +10% margin the last chord buried into the wall (a-iso.png)
// and exited through the far wall into the void when orbited (a-orbit.png).
// Verifies the current margin-0 clip in both iso and an orbited azimuth.
// Usage: bash tools/run-gate.sh tools/diag-sw2-s8-rosen-orbit.mjs [base]
import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";
import { mkdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const base = process.argv[2] ?? "http://localhost:4173";
const outDir = resolve("qa", "SW2-S8-TRAIL-EDGE-REVERIFY");
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
const shot = async (file) => {
  const p = resolve(outDir, file);
  await page.screenshot({ path: p });
  console.log(`SHOT ${file} ${statSync(p).size / 1024 | 0}KB`);
};

async function waitIdle() {
  for (let i = 0; i < 40; i++) {
    const a = await page.evaluate(() => ({
      locked: window.__wp1.locked(),
      animating: window.__wp1.animating(),
    }));
    if (!a.locked && !a.animating) return true;
    await sleep(250);
  }
  return false;
}

await page.goto(`${base}/?step=22`, { waitUntil: "load" });
await waitIdle();
// Parts: normalize OFF, β 0, clip OFF (the finding's raw+unclipped config).
await page.evaluate(() => {
  const norm = document.querySelector("#rule-norm");
  norm.checked = false;
  norm.dispatchEvent(new Event("change", { bubbles: true }));
  const beta = document.querySelector("#rule-beta");
  beta.value = "0";
  beta.dispatchEvent(new Event("input", { bubbles: true }));
  const clip = document.querySelector("#rule-clip");
  clip.value = "0";
  clip.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.click('#rule-levels button[data-level="rosen"]');
await waitIdle();

for (const [tag, knob] of [["e00956", "600"], ["e0176", "680"]]) {
  await page.evaluate((v) => {
    const el = document.querySelector("#rule-eta");
    el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, knob);
  await waitIdle();
  await sleep(600);
  const cfg = await page.evaluate(() => window.__wp1.rule().config);
  console.log(`INFO  ${tag}: η = ${cfg.lr}`);
  await shot(`rosen-${tag}-iso.png`);
  await page.getByRole("button", { name: /map view/i }).first().click();
  await sleep(1200);
  await shot(`rosen-${tag}-map.png`);
  // low orbit via right-drag (the finding's a-orbit repro)
  await page.getByRole("button", { name: /isometric/i }).first().click();
  await sleep(1200);
  await page.mouse.move(520, 450);
  await page.mouse.down({ button: "right" });
  for (let i = 1; i <= 20; i++) {
    await page.mouse.move(520 + i * 12, 450);
    await sleep(30);
  }
  await page.mouse.up({ button: "right" });
  await sleep(1200);
  await shot(`rosen-${tag}-orbit.png`);
  // reset attitude for the next iteration
  await page.mouse.click(520, 450, { clickCount: 2 });
  await sleep(800);
}

await browser.close();
console.log("DONE — screenshots in qa/SW2-S8-TRAIL-EDGE-REVERIFY/");
