/**
 * diag-s2-swarmblind-foglift.mjs — hazard probe: does the swarm blind mode
 * survive a session in which §6's reveal already ran (view fogLift left at
 * 1)? Path: ?step=17 (fog-c reveal, fogrev tweens 0→1), ArrowDown forward
 * through tilt-a/tilt-b to swarm, check #swarm-blind, capture the first
 * seconds. If uFogLift is stale at 1, the opaque mask is fully lifted and
 * the terrain shows bright through "blind" mode.
 * Run: node tools/diag-s2-swarmblind-foglift.mjs http://localhost:4191
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

await page.goto(`${base}/?step=17`, { waitUntil: "load" }); // fog-c: the §6 reveal
await page.waitForFunction(() => window.__wp1 && window.__wp1.scene(), null, { timeout: 30000 });
await sleep(2600); // let the 1.6s reveal tween ride to fogrev=1
console.log("boot scene:", await scene());
for (let k = 0; k < 6 && (await scene()) !== "swarm"; k++) {
  await page.keyboard.press("ArrowDown"); // fog-c(17) -> tilt-a(18,19) -> tilt-b(20) -> swarm(21)
  await sleep(2500);
  await waitIdle();
  console.log(`after ArrowDown #${k + 1}:`, await scene());
}
// The reader's motion chrome intercepts pointer clicks mid-snap; set the
// checkbox programmatically (same pattern as tools/diag-sweep2-c.mjs).
await page.evaluate(() => {
  const t = document.querySelector("#swarm-blind");
  t.checked = true;
  t.dispatchEvent(new Event("change", { bubbles: true }));
});
await sleep(400);
await page.keyboard.press("ArrowUp"); // swarm -> tilt-b (instant)
await sleep(2500);
await waitIdle();
console.log("on:", await scene());
await page.keyboard.press("ArrowDown"); // tilt-b -> swarm (forward crossfade)
const t0 = Date.now();
for (const ms of [800, 1000, 1200]) {
  const wait = ms - (Date.now() - t0);
  if (wait > 0) await sleep(wait);
  const s = await swarm();
  const kb = await shotKB(`foglift-${ms}.png`);
  console.log(`+${ms}ms swarm=${s ? `t=${s.time.toFixed(2)} painted=${s.painted} blind=${s.blind}` : "null"} ${kb}KB line=${JSON.stringify(await line())}`);
}
await browser.close();
process.exit(0);
