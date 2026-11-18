/**
 * diag-s2-trail-ball — live verification for QA SEC5-S2-REPLAY-TRAIL-LEAD.
 *
 * Repro: /?step=13 (§5 lab) → click Play → pause via scrub at f=0.1 and f=0.5.
 * For each lane, compares the page's live ball position (window.__wp1
 * .replayInfo().positions, parameter space) against the fixture computed with
 * the REAL production model (tools/diag-s2-trail-ball-fixture.json):
 *   NEW (expected): ball = samplePathAtStep(path, min(f·220, steps)); trail
 *                   tip = path[floor(s)] — never ahead of the ball.
 *   OLD (bug):      ball = samplePath(path, f) (arc length) while the trail
 *                   drew round(f·segments) index-wise — tip led by ~100 steps.
 * Screenshots go to qa/SEC5-S2-REPLAY-TRAIL-LEAD/.
 */
import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";
import { readFileSync, mkdirSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:4182";
const fixture = JSON.parse(
  readFileSync(new URL("./diag-s2-trail-ball-fixture.json", import.meta.url), "utf8"),
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
mkdirSync("qa/SEC5-S2-REPLAY-TRAIL-LEAD", { recursive: true });

await page.goto(`${base}/?step=13`, { waitUntil: "load" });
for (let i = 0; i < 60; i++) {
  const a = await page.evaluate(() => ({
    locked: window.__wp1.locked(),
    animating: window.__wp1.animating(),
  }));
  if (!a.locked && !a.animating) break;
  await sleep(250);
}
await sleep(500);

const scene = await page.evaluate(() => window.__wp1.scene());
check("scene at ?step=13 is lab", scene === "lab", scene);

// Start the replay (the transport's ▶ Play), then park it via the scrub bar
// (setReplayScrub pauses and owns the pose).
await page.click("#play-btn");
await sleep(400);
const midPlay = await page.evaluate(() => window.__wp1.replayInfo());
check("replay started with 3 lab lanes", midPlay.lanes === 3 && midPlay.playing,
  `lanes=${midPlay.lanes} playing=${midPlay.playing}`);

for (const f of [0.1, 0.5]) {
  await page.evaluate((frac) => {
    const el = document.querySelector("#replay-scrub");
    el.value = String(Math.round(frac * 1000));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, f);
  await sleep(300); // let the frame apply the pose
  const info = await page.evaluate(() => window.__wp1.replayInfo());
  check(`scrub parked at ${f} (paused, progress tracked)`,
    info.paused === true && Math.abs(info.progress - f) < 0.011,
    `paused=${info.paused} progress=${Math.round(info.progress * 1000) / 1000}`);

  const fx = fixture.samples.filter((s) => Math.abs(s.f - f) < 1e-9);
  for (let lane = 0; lane < fx.length; lane++) {
    const exp = fx[lane];
    const got = info.positions[lane];
    const dNew = dist(got, exp.new_ball);
    const dOld = dist(got, exp.old_ball);
    check(
      `f=${f} ${exp.name}: ball on the STEP clock (samplePathAtStep s=${exp.new_s})`,
      dNew < 1e-4,
      `Δnew=${Math.round(dNew * 1e6) / 1e6} (old-model Δ=${Math.round(dOld * 1e4) / 1e4})`,
    );
    if (lane === 0) {
      check(
        `f=${f} ${exp.name}: ball NOT on the old ARC-LENGTH clock (the bug)`,
        dOld > 0.1,
        `Δold=${Math.round(dOld * 1e4) / 1e4}`,
      );
    }
  }
  await page.screenshot({
    path: `qa/SEC5-S2-REPLAY-TRAIL-LEAD/scrub${Math.round(f * 100)}-viewport.png`,
    clip: { x: 0, y: 0, width: 960, height: 900 },
  });
}

// Arrival pacing on the shared step clock: with the current lab defaults all
// three lanes run 220 steps, so all arrive at f=1 (matching the loss curves,
// which all span the same 220-step x-axis). Confirm the balls rest.
await page.evaluate(() => {
  const el = document.querySelector("#replay-scrub");
  el.value = "999";
  el.dispatchEvent(new Event("input", { bubbles: true }));
});
await sleep(300);
const end = await page.evaluate(() => window.__wp1.replayInfo());
const fixtureEnd = fixture.arcConcentration.map((l) => l.steps);
check("all lab lanes are 220 steps (equal-length step clock)",
  fixtureEnd.every((s) => s === 220),
  `steps=${fixtureEnd.join(",")}`);
check("near f=1 all balls rest at their path ends (arrival simultaneous, curve-consistent)",
  end.progress > 0.98 && end.positions.every((p) => Math.hypot(p.x, p.y) < 1e-1),
  `progress=${Math.round(end.progress * 1000) / 1000} positions=${JSON.stringify(end.positions.map((p) => [Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100]))}`);

await browser.close();
console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
