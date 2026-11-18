/**
 * diag-s2-swarmblind-entry-c.mjs — focused probe of the backward (labrule →
 * swarm) blind entry: samples scene/swarm state every 150ms for 2.5s after
 * ArrowUp, to pin down when refreshSwarmVisuals builds the flight relative
 * to the crossfade, and whether the terrain stays fogged throughout.
 * Run: node tools/diag-s2-swarmblind-entry-c.mjs http://localhost:4191
 */
import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";
import { mkdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const base = process.argv[2] ?? "http://localhost:4191";
const outDir = resolve("qa/S2-SWARM-BLIND-ENTRY-UNFOGGED-r2");
mkdirSync(outDir, { recursive: true });

const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const swarm = () => page.evaluate(() => window.__wp1?.swarm?.() ?? null);
const scene = () => page.evaluate(() => window.__wp1?.scene?.() ?? null);
const line = () => page.evaluate(() => document.querySelector("#tilt-swarm-line")?.textContent ?? null);
async function shotKB(f) {
  const p = resolve(outDir, f);
  await page.screenshot({ path: p });
  return Math.round(statSync(p).size / 102.4) / 10;
}
async function waitIdle(maxMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const a = await page.evaluate(() => ({
      locked: window.__wp1?.locked?.() ?? false,
      animating: window.__wp1?.animating?.() ?? false,
    }));
    if (!a.locked && !a.animating) return true;
    await sleep(150);
  }
  return false;
}

await page.goto(`${base}/?step=21`, { waitUntil: "load" });
await page.waitForFunction(() => window.__wp1 && window.__wp1.scene(), null, { timeout: 30000 });
await waitIdle();
await page.click("#swarm-blind");
await sleep(900);
await page.keyboard.press("ArrowDown"); // swarm -> labrule
await sleep(2500);
await waitIdle();
console.log("on labrule:", await scene());
await page.keyboard.press("ArrowUp"); // labrule -> swarm
const t0 = Date.now();
for (let i = 0; i <= 16; i++) {
  const ms = i * 150;
  const wait = ms - (Date.now() - t0);
  if (wait > 0) await sleep(wait);
  const s = await swarm();
  const kb = i % 2 === 0 ? await shotKB(`probe-${String(ms).padStart(4, "0")}.png`) : null;
  console.log(
    `+${String(ms).padStart(4)}ms scene=${await scene()} ` +
      `swarm=${s ? `t=${s.time.toFixed(2)} playing=${s.playing} painted=${s.painted} blind=${s.blind}` : "null"} ` +
      (kb !== null ? `${kb}KB` : ""),
  );
}
await browser.close();
process.exit(0);
