/**
 * diag-fogc-skip-race.mjs — reproduces S2-SKIP-FOGC-RACE-NOT-SKIPPED.
 *
 * On a DEFERRED fog-c entry (crossfade/rise still in flight when Skip fires,
 * so the ghost race does not exist yet), Skip must land the race at its end
 * the moment it is built — not let it play in full (~6.6 s) with the lock
 * held. Three paths:
 *
 *   A  rail jump: ?step=10 → idle → rail tick fog-c → +200 ms → #skip-btn.
 *   A2 same, Skip at +800 ms (the 'in' stage of the crossfade).
 *   B  reader: ?step=15 → ArrowDown (fog-a→fog-b) → Space → idle →
 *      ArrowDown (fog-b→fog-c) → Space at +140 ms.
 *   C  control (works today): ?step=16 → idle → ArrowDown into fog-c →
 *      +140 ms → Space (race built synchronously at entry).
 *
 * Expected post-fix: unlock within ~350 ms of the skip on every path.
 *
 * Usage: node tools/diag-fogc-skip-race.mjs [baseUrl]
 */

import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";

const base = process.argv[2] ?? "http://localhost:4183";
const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function app() {
  return page.evaluate(() => {
    const f = window.__wp1?.fog?.();
    return {
      scene: window.__wp1?.scene?.(),
      step: window.__wp1?.step?.(),
      locked: window.__wp1?.locked?.(),
      animating: window.__wp1?.animating?.(),
      ghosts: f ? f.ghosts : null,
      ghostsPlaying: f ? f.ghostsPlaying : null,
      fogLevel: f ? f.level : null,
    };
  });
}
async function waitIdle(maxMs = 20000) {
  const t0 = Date.now();
  for (;;) {
    const a = await app();
    if (!a.locked && !a.animating) return true;
    if (Date.now() - t0 > maxMs) return false;
    await sleep(60);
  }
}
/** Time from `fire` until the reader is unlocked and idle. */
async function measureUnlock(fire, label) {
  const pre = await app();
  const t0 = Date.now();
  await fire();
  let unlockedAt = null;
  for (let t = 0; t < 20000; t += 25) {
    await sleep(25);
    const a = await app();
    if (!a.locked && !a.animating) {
      unlockedAt = Date.now() - t0;
      console.log(
        `${label}: unlocked after ${unlockedAt} ms  (pre: scene=${pre.scene} ghosts=${pre.ghosts} playing=${pre.ghostsPlaying} locked=${pre.locked})  (post: ghosts=${a.ghosts} playing=${a.ghostsPlaying})`,
      );
      return { unlockedAt, pre, post: a };
    }
  }
  console.log(`${label}: STILL LOCKED after 20 s  (pre: ${JSON.stringify(pre)})`);
  return { unlockedAt: null, pre, post: await app() };
}
async function gotoStep(q) {
  await page.goto(base + "/" + q, { waitUntil: "load" });
  await sleep(1200);
  await waitIdle();
  await sleep(300);
}
const clickRail = (k) =>
  page.evaluate((idx) => document.querySelectorAll("#rail button")[idx].click(), k);
const clickSkip = () => page.evaluate(() => document.querySelector("#skip-btn").click());
const key = (k) => page.keyboard.press(k);

const results = {};
async function run(name, times, fn) {
  results[name] = [];
  for (let i = 0; i < times; i++) {
    const r = await fn(i);
    results[name].push(r.unlockedAt);
  }
}

// A — rail jump from ?step=10 to fog-c (rail tick 17), Skip at +200 ms.
await run("A rail-jump skip@200ms", 3, async () => {
  await gotoStep("?step=10");
  await clickRail(17);
  await sleep(200);
  const r = await measureUnlock(clickSkip, `A run: skip@200ms`);
  await waitIdle();
  return r;
});

// A2 — rail jump, Skip at +800 ms (crossfade 'in' stage).
await run("A2 rail-jump skip@800ms", 1, async () => {
  await gotoStep("?step=10");
  await clickRail(17);
  await sleep(800);
  const r = await measureUnlock(clickSkip, `A2 run: skip@800ms`);
  await waitIdle();
  return r;
});

// B — reader path: fog-a → fog-b (Space skips its entry) → fog-c, Space +140 ms.
await run("B reader fog-b→fog-c skip@140ms", 3, async () => {
  await gotoStep("?step=15");
  await key("ArrowDown");
  await sleep(140);
  await measureUnlock(() => key(" "), "B chain: fog-b skip@140ms");
  await waitIdle();
  await sleep(300);
  await key("ArrowDown");
  await sleep(140);
  const r = await measureUnlock(() => key(" "), "B run: fog-c skip@140ms");
  await waitIdle();
  return r;
});

// C — control: synchronous-race entry (?step=16 → ArrowDown), Space +140 ms.
await run("C control step16->fog-c skip@140ms", 3, async () => {
  await gotoStep("?step=16");
  await key("ArrowDown");
  await sleep(140);
  const r = await measureUnlock(() => key(" "), "C run: skip@140ms");
  await waitIdle();
  return r;
});

console.log("\nSUMMARY (unlock delay ms; null = still locked at 20 s)");
for (const [k, v] of Object.entries(results)) console.log(`  ${k}: ${JSON.stringify(v)}`);
await browser.close();
process.exit(0);
