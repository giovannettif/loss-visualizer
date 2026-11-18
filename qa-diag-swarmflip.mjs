/**
 * qa-diag-swarmflip.mjs — one-off probe: does the swarm's blind rewind re-arm
 * on a REAL flip (default true → false → true)? verify-cycleb's "blind rewind
 * re-arms" check sets #swarm-blind checked=true while blind is ALREADY the
 * boot default (true since 2026-11-13), so director.setSwarmBlind early-
 * returns (director.ts:5127 same-value guard) and no rewind happens. This
 * probe flips the checkbox for real, twice, and measures `playing`.
 */
import { chromium } from "playwright";
import { launchGL } from "./tools/gl-launch.mjs";

const base = process.argv[2] ?? "http://localhost:4273";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(`${base}/?step=21`, { waitUntil: "load" });
for (let i = 0; i < 60; i++) {
  const a = await page.evaluate(() => ({ l: window.__wp1?.locked?.(), an: window.__wp1?.animating?.() }));
  if (!a.l && !a.an) break;
  await sleep(250);
}
const boot = await page.evaluate(() => ({
  checked: document.querySelector("#swarm-blind")?.checked ?? null,
  swarm: window.__wp1.swarm(),
}));
console.log("boot:", JSON.stringify({ checked: boot.checked, playing: boot.swarm.playing, time: +boot.swarm.time.toFixed(2) }));
await sleep(11000); // let the flight park (cutoff 8.43s)
const flip = async (v) => {
  await page.evaluate((v) => {
    const t = document.querySelector("#swarm-blind");
    t.checked = v;
    t.dispatchEvent(new Event("change", { bubbles: true }));
  }, v);
  await sleep(700);
  const s = await page.evaluate(() => ({ checked: document.querySelector("#swarm-blind").checked, swarm: window.__wp1.swarm() }));
  console.log(`flip→${v}:`, JSON.stringify({ playing: s.swarm.playing, time: +s.swarm.time.toFixed(2) }));
  return s;
};
await flip(false); // real flip: rewind + re-arm expected (playing=true, time<1.5)
await sleep(3000);
await flip(true); // real flip back: rewind + re-arm expected again
await browser.close();
process.exit(0);
