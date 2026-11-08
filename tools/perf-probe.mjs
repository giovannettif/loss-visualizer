/**
 * perf-probe.mjs — measures rAF frame gaps during ▶ Play playback AND grabs a
 * CDP CPU profile of the same window, so the hot functions are named, not
 * guessed. QA LP-1/LP-2 evidence probe.
 *
 * Usage: node tools/perf-probe.mjs <url> <outPrefix> [clickPlay]
 */

import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

const url = process.argv[2] ?? "http://localhost:4185/?step=13";
const prefix = process.argv[3] ?? "perf";
const doClick = process.argv[4] !== "noclick";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

await page.goto(url, { waitUntil: "load" });
// Wait for the reader to unlock (entry animation).
for (let i = 0; i < 60; i++) {
  const a = await page.evaluate(() => ({
    locked: window.__wp1?.locked?.() ?? false,
    animating: window.__wp1?.animating?.() ?? false,
  }));
  if (!a.locked && !a.animating) break;
  await page.waitForTimeout(250);
}
await page.waitForTimeout(500);

const cdp = await page.context().newCDPSession(page);
await cdp.send("Profiler.enable");
await cdp.send("Profiler.start");

// In-page rAF gap recorder, running while we click Play.
await page.evaluate(() => {
  window.__gaps = [];
  window.__t0 = performance.now();
  const rec = (now) => {
    if (window.__last != null) window.__gaps.push(now - window.__last);
    window.__last = now;
    if (performance.now() - window.__t0 < 20000) requestAnimationFrame(rec);
  };
  requestAnimationFrame(rec);
});

if (doClick) {
  const btn = page.locator("#play-btn");
  if (await btn.count()) {
    await btn.click();
    console.log("clicked #play-btn");
  } else {
    console.log("NO #play-btn FOUND");
  }
}

// Wait for playback to finish (scrub >= 0.999) or timeout.
await page.waitForFunction(
  () => Number(document.querySelector("#replay-scrub")?.value ?? 0) >= 999,
  null,
  { timeout: 45000 },
).catch(() => console.log("playback did not reach 999 in 45s"));

const profile = (await cdp.send("Profiler.stop")).profile;
const gaps = await page.evaluate(() => window.__gaps);

const sorted = [...gaps].sort((a, b) => a - b);
const p = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
const stats = {
  frames: gaps.length,
  p50: +p(0.5).toFixed(1),
  p95: +p(0.95).toFixed(1),
  max: +Math.max(...gaps).toFixed(1),
  over32: gaps.filter((g) => g > 32).length,
  over50: gaps.filter((g) => g > 50).length,
};
console.log("frame gaps:", JSON.stringify(stats));

// Sum self time per function; print the top offenders.
const self = new Map();
const total = (nodes) => {
  for (const n of nodes) {
    const cf = n.callFrame;
    const key = `${cf.functionName || "(anon)"} @ ${(cf.url || "").split("/").slice(-1)[0]}:${cf.lineNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + (n.hitCount ?? 0));
  }
};
total(profile.nodes);
const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
console.log("top self-time hits (samples):");
for (const [k, v] of top) console.log(`  ${String(v).padStart(6)}  ${k}`);

mkdirSync(dirname(resolve(`qa/perf-fix/${prefix}-profile.json`)), { recursive: true });
writeFileSync(`qa/perf-fix/${prefix}-results.json`, JSON.stringify(stats, null, 1));
writeFileSync(`qa/perf-fix/${prefix}-profile.json`, JSON.stringify(top));

await browser.close();
