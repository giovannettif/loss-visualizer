/**
 * diag-fogc-skip-fixsim.mjs — validates the S2-SKIP-FOGC-RACE-NOT-SKIPPED fix
 * mechanism WITHOUT touching source: on a deferred fog-c entry (race still
 * null at skip time), fires finishTransitionsNow twice in the same tick.
 *
 * The FIRST call is today's buggy path (race not present at line 1856; built
 * live by refreshGdVisuals at line 1892). The SECOND call executes exactly
 * the lines the proposed fix adds after refreshGdVisuals — the
 * `if (this.fogGhosts) this.finishFogGhostsNow()` guard, now with the race
 * present. If unlock lands in ~350 ms of the pair, the one-line fix is
 * proven end-to-end.
 *
 * Usage: node tools/diag-fogc-skip-fixsim.mjs [baseUrl]
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
      locked: window.__wp1?.locked?.(),
      animating: window.__wp1?.animating?.(),
      ghosts: f ? f.ghosts : null,
      ghostsPlaying: f ? f.ghostsPlaying : null,
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
/** Fires skip twice in one tick (fix simulation) and times the unlock. */
async function fixSim(label) {
  const pre = await app();
  const t0 = Date.now();
  await page.evaluate(() => {
    window.__wp1.skip(); // today's path: builds the deferred race live
    window.__wp1.skip(); // the fix's added call: finishFogGhostsNow on it
  });
  let unlockedAt = null;
  for (let t = 0; t < 20000; t += 25) {
    await sleep(25);
    const a = await app();
    if (!a.locked && !a.animating) {
      unlockedAt = Date.now() - t0;
      break;
    }
  }
  const post = await app();
  console.log(
    `${label}: ${unlockedAt === null ? "STILL LOCKED after 20 s" : `unlocked after ${unlockedAt} ms`}  (pre: ghosts=${pre.ghosts} locked=${pre.locked})  (post: ghosts=${post.ghosts} playing=${post.ghostsPlaying})`,
  );
  await waitIdle();
  await sleep(300);
  return unlockedAt;
}

// A — rail jump from ?step=10 to fog-c, skip pair at +200 ms (crossfade 'out').
// A — rail jump from ?step=10 to fog-c, skip pair at +200 ms (crossfade 'out').
await page.goto(base + "/?step=10", { waitUntil: "load" });
await sleep(1200);
await waitIdle();
await sleep(300);
await page.evaluate(() => document.querySelectorAll("#rail button")[17].click());
await sleep(200);
await fixSim("A rail-jump pair-skip@200ms");
// A2 — same, at +800 ms ('in' stage).
await page.goto(base + "/?step=10", { waitUntil: "load" });
await sleep(1200);
await waitIdle();
await sleep(300);
await page.evaluate(() => document.querySelectorAll("#rail button")[17].click());
await sleep(800);
await fixSim("A2 rail-jump pair-skip@800ms");

// B — reader path: fog-a → fog-b (Space) → idle → fog-c, pair at +140 ms.
await page.goto(base + "/?step=15", { waitUntil: "load" });
await sleep(1200);
await waitIdle();
await sleep(300);
await page.keyboard.press("ArrowDown");
await sleep(140);
await page.keyboard.press(" ");
await waitIdle();
await sleep(300);
await page.keyboard.press("ArrowDown");
await sleep(140);
await fixSim("B reader pair-skip@140ms");

// Frozen control — ?shot=fog-c boot (main.ts:1049 calls finishTransitionsNow
// with a frozen race present): the added call must not disturb the pose.
await page.goto(base + "/?shot=fog-c", { waitUntil: "load" });
await sleep(1500);
await waitIdle();
const frozen = await app();
console.log(
  `FROZEN ?shot=fog-c: scene=${frozen.scene} locked=${frozen.locked} animating=${frozen.animating} ghosts=${frozen.ghosts} playing=${frozen.ghostsPlaying} (expect unlocked, ghosts=4, playing=false)`,
);

await browser.close();
process.exit(0);
