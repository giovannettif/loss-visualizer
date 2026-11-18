/**
 * Diagnostic (S1-ADVANCE-SNAP): after hand-fitting in task-a, advancing to
 * task-b must TWEEN from the user's fit to BAD_FIT — not snap back to the
 * stale values-map entry (START_FIT) first.
 *
 * Repro: ?step=1 at 1440x900 → drag the 3D ball (+120, -60 px) → ArrowDown →
 * sample __wp1.fit() every rAF for ~1.8s. Under the bug the first samples sit
 * at (0.150, 0.200); fixed, they start at the hand fit and glide to
 * (-0.35, 0.80).
 *
 * Usage: node tools/diag-s1-advance-snap.mjs [baseUrl]
 */
import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";

const base = process.argv[2] ?? "http://localhost:4285";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${base}/?step=1`, { waitUntil: "load" });

// Settle: intro/lock/animation quiesce (same wait discipline as diag-s2-fogdrag).
for (let i = 0; i < 60; i++) {
  const a = await page.evaluate(() => window.__wp1.locked() || window.__wp1.animating());
  if (!a) break;
  await sleep(250);
}
await sleep(500);

const scene0 = await page.evaluate(() => window.__wp1.scene());
const fit0 = await page.evaluate(() => window.__wp1.fit());
const ball = await page.evaluate(() => window.__wp1.ballScreen());
console.log("scene:", scene0, "start fit:", JSON.stringify(fit0), "ball:", JSON.stringify(ball));
if (scene0 !== "task-a") throw new Error(`expected task-a, got ${scene0}`);
if (!ball) throw new Error("ball not on screen");

// Drag the ball +120/-60 px like the finding's repro (real pointer events on
// the stage → onDragStart/pickAt → setFitUser).
await page.mouse.move(ball.x, ball.y);
await page.mouse.down();
await page.mouse.move(ball.x + 120, ball.y - 60, { steps: 12 });
await page.mouse.up();
await sleep(400);
const fitUser = await page.evaluate(() => window.__wp1.fit());
console.log("hand fit after drag:", JSON.stringify(fitUser));
const moved =
  Math.abs(fitUser.w - fit0.w) > 0.4 && Math.abs(fitUser.b - fit0.b) > 0.1;
if (!moved) throw new Error(`drag did not take (fit still ${JSON.stringify(fitUser)})`);

// Per-rAF sampler across the advance.
await page.evaluate(() => {
  window.__samples = [];
  let t0 = null;
  const tick = (t) => {
    if (window.__samples.length >= 500) return;
    const f = window.__wp1.fit();
    window.__samples.push({
      t: t0 === null ? 0 : t - t0,
      scene: window.__wp1.scene(),
      w: Math.round(f.w * 1000) / 1000,
      b: Math.round(f.b * 1000) / 1000,
    });
    if (t0 === null) t0 = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
await page.keyboard.press("ArrowDown");
await sleep(1800);
const samples = await page.evaluate(() => window.__samples.slice());
await browser.close();

const inB = samples.filter((s) => s.scene === "task-b");
console.log(`samples: ${samples.length} total, ${inB.length} in task-b`);
if (inB.length < 20) throw new Error("advance to task-b did not happen");

// Bug signature: samples pinned at START_FIT (both coords ~0.15/0.20) — the
// stale-value teleport. (A monotonic hand→BAD tween crosses w=0.15 and b=0.20
// at different times, so both-pinned can only be the snap-back.)
const snap = inB.filter((s) => Math.abs(s.w - 0.15) < 0.012 && Math.abs(s.b - 0.2) < 0.012);
console.log("samples pinned at START_FIT:", snap.length,
  snap.length ? JSON.stringify(snap.slice(0, 5)) : "");

const first = inB[0];
const last = inB[inB.length - 1];
console.log("first task-b sample:", JSON.stringify(first));
console.log("last  task-b sample:", JSON.stringify(last));

// Continuity: no consecutive jump bigger than 35% of the w-span.
let maxJump = 0;
for (let i = 1; i < inB.length; i++) maxJump = Math.max(maxJump, Math.abs(inB[i].w - inB[i - 1].w));

const ok =
  snap.length === 0 &&
  Math.abs(first.w - fitUser.w) < 0.06 &&
  Math.abs(first.b - fitUser.b) < 0.06 &&
  Math.abs(last.w - -0.35) < 0.03 &&
  Math.abs(last.b - 0.8) < 0.03;
console.log(`max per-frame w jump: ${maxJump.toFixed(3)}`);
console.log(ok ? "PASS — tween starts at the hand fit, glides to BAD_FIT, no START_FIT teleport"
  : "FAIL — stale-value snap still present");
process.exit(ok ? 0 : 1);
