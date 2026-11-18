/**
 * diag-s8-race-arrival — live repro for QA S8SW2-RACE-SIMULTANEOUS-ARRIVAL.
 *
 * Finding: the §8 ▶ Play race normalized every lane to its own arc length on
 * one shared clock, so a 14-step rule and Adam-at-164 arrived together,
 * contradicting the steps-to-converge scoreboard beside the race.
 *
 * Repro: /?step=23 (§8 labrule) → click ▶ Play → poll __wp1.replayInfo()
 * (positions are replayLanePose — the live ball pose) at ~60ms until the
 * race drains. For each lane report WHEN its ball first reaches its final
 * position (wall ms + transport progress).
 *
 *   NEW (expected): lane with S of M maxSteps arrives at progress ≈ S/M and
 *                   then RESTS there (finished balls hold their end point).
 *   OLD (the bug):  every lane arrives at progress ≈ 1 together.
 *
 * Runs twice: Rosenbrock (default level) and 'least squares' (data-level
 * click on #rule-levels [data-level=ls], like drive8 did).
 * Screenshots go to qa/S8SW2-RACE-SIMULTANEOUS-ARRIVAL/.
 */
import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";
import { mkdirSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:4199";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const laneStepsOf = (runs) => runs.map((r) => r.steps);

const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
mkdirSync("qa/S8SW2-RACE-SIMULTANEOUS-ARRIVAL", { recursive: true });

await page.goto(`${base}/?step=23`, { waitUntil: "load" });
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
check("scene at ?step=23 is labrule", scene === "labrule", scene);

/** Polls the live race and returns per-lane arrival analysis. */
async function measureRace(label) {
  await page.click("#play-btn");
  await sleep(150);

  const samples = [];
  const t0 = performance.now();
  for (;;) {
    const info = await page.evaluate(() => window.__wp1.replayInfo());
    samples.push({ t: performance.now() - t0, progress: info.progress, positions: info.positions });
    if (!info.playing && info.progress >= 1) break;
    if (performance.now() - t0 > 20000) break; // safety
    await sleep(60);
  }

  const lanes = samples[0].positions.length;
  const finals = samples[samples.length - 1].positions;
  // Self-calibrating jitter bound: the largest progress delta between
  // consecutive polls (60ms sleep + evaluate round-trip latency).
  let pollGap = 0;
  for (let k = 1; k < samples.length; k++) {
    pollGap = Math.max(pollGap, samples[k].progress - samples[k - 1].progress);
  }
  const report = [];
  for (let lane = 0; lane < lanes; lane++) {
    let arriveIdx = samples.length - 1;
    for (let k = 0; k < samples.length; k++) {
      if (dist(samples[k].positions[lane], finals[lane]) < 1e-6) { arriveIdx = k; break; }
    }
    report.push({
      lane,
      arriveMs: Math.round(samples[arriveIdx].t),
      arriveProgress: Math.round(samples[arriveIdx].progress * 1000) / 1000,
      final: finals[lane],
    });
  }
  const raceMs = Math.round(samples[samples.length - 1].t);
  console.log(`\n== ${label}: race drains in ${raceMs}ms, ${lanes} lanes ==`);
  for (const r of report) {
    console.log(`  lane ${r.lane}: arrived ${r.arriveMs}ms (progress ${r.arriveProgress}) final=(${r.final.x.toFixed(4)}, ${r.final.y.toFixed(4)})`);
  }
  return { report, raceMs, lanes, pollGap };
}

/** PASS iff lanes arrive at staggered times tracking steps/maxSteps. */
async function expectStaggered(label, stepsByLane, levelNote) {
  const { report, raceMs, pollGap } = await measureRace(label);
  const steps = await page.evaluate(() =>
    window.__wp1.rule().runs.map((r) => ({ key: r.key, steps: r.steps })));
  console.log(`  scoreboard steps: ${steps.map((s) => `${s.key}=${s.steps}`).join(", ")} (${levelNote})`);

  // 1) Simultaneous-arrival bug signature: all lanes within one poll (~60ms).
  const times = report.map((r) => r.arriveMs);
  const spread = Math.max(...times) - Math.min(...times);
  check(`${label}: arrivals are STAGGERED (not one shared finish)`,
    spread > 400, `arrival spread=${spread}ms across lanes [${times.join(", ")}]`);

  // 2) Arrival order matches convergence order (fewest steps first), over
  //    the lanes that HAVE a convergence step. A DNF lane (steps=null) rides
  //    its full ≤400-step display run, so it correctly finishes LAST.
  const order = [...report]
    .filter((r) => laneStepsOf(steps)[r.lane] !== null)
    .sort((a, b) => a.arriveMs - b.arriveMs)
    .map((r) => r.lane);
  const stepOrder = steps
    .filter((s) => s.steps !== null)
    .sort((a, b) => a.steps - b.steps)
    .map((s) => steps.findIndex((x) => x.key === s.key));
  check(`${label}: arrival order = convergence order`,
    JSON.stringify(order) === JSON.stringify(stepOrder),
    `arrival order=[${order}] step order=[${stepOrder}] (DNF lanes excluded)`);

  // 3) Shared STEP clock: on the transport's own progress scale, an unclipped
  //    converged lane (display path = steps+1 points) reaches its end at
  //    p = steps/M, where M = the longest DISPLAY lane's steps (a DNF lane's
  //    full ≤400-step run). Estimate M from lanes whose arrivals are long
  //    enough that the 60ms poll granularity is negligible, then require
  //    every converged lane's measured arrival progress to sit within one
  //    poll of steps/M̂. (Immune to the click→first-poll wall-clock offset.)
  const laneSteps = steps.map((s) => s.steps);
  const converged = report.filter((r) => laneSteps[r.lane] !== null);
  const mHats = converged
    .filter((r) => laneSteps[r.lane] >= 50)
    .map((r) => laneSteps[r.lane] / r.arriveProgress);
  const mHat = mHats.length > 0
    ? mHats.reduce((x, y) => x + y, 0) / mHats.length
    : Math.max(...laneSteps.filter((s) => s !== null));
  console.log(`  display clock estimate M̂=${mHat.toFixed(1)} steps`);
  for (const r of converged) {
    const s = laneSteps[r.lane];
    const expectP = s / mHat;
    // tolerance = the observed poll jitter: arrival is detected at the FIRST
    // sample where the ball has reached its path end, so the true crossing
    // lies up to one poll gap earlier.
    const tol = Math.max(0.005, pollGap);
    check(`${label}: lane ${r.lane} (${s} steps) arrives at progress ≈ ${expectP.toFixed(3)}`,
      Math.abs(r.arriveProgress - expectP) < tol,
      `got progress ${r.arriveProgress} (Δ=${(r.arriveProgress - expectP).toFixed(4)}, tol=${tol.toFixed(4)})`);
  }

  // 4) Finished balls REST at their end point: freeze-frame mid-race via the
  //    scrub bar just past the shortest converged lane's arrival, then sample.
  const shortest = Math.min(...laneSteps.filter((s) => s !== null));
  const f = Math.min(0.95, (shortest / mHat) * 1.4);
  await page.evaluate((frac) => {
    const el = document.querySelector("#replay-scrub");
    el.value = String(Math.round(frac * 1000));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, f);
  await sleep(300);
  const parked = await page.evaluate(() => window.__wp1.replayInfo());
  const parkedReport = report.map((r, lane) => ({
    lane, atEnd: dist(parked.positions[lane], r.final) < 1e-6,
  }));
  const doneLanes = parkedReport.filter((r) => laneSteps[r.lane] !== null && laneSteps[r.lane] <= shortest);
  check(`${label}: at f=${f.toFixed(2)} finished lane(s) [${doneLanes.map((d) => d.lane).join(",")}] rest at their end point`,
    doneLanes.every((d) => d.atEnd),
    `positions=${JSON.stringify(parked.positions.map((p) => [p.x, p.y].map((v) => Math.round(v * 10000) / 10000)))}`);
  await page.screenshot({
    path: `qa/S8SW2-RACE-SIMULTANEOUS-ARRIVAL/${label}-f${Math.round(f * 100)}.png`,
    clip: { x: 0, y: 0, width: 960, height: 900 },
  });
  void raceMs;
}

// Run 1 — Rosenbrock (the default level, like drive2).
await expectStaggered("rosen", null, "default level");

// Run 2 — least squares (like drive8): click the level pill, let the
// benchmark rebuild, then race again.
await page.click('#rule-levels [data-level="ls"]');
await sleep(1200); // coalesced rebuild + scorecard rewrite
const level = await page.evaluate(() => window.__wp1.rule().level);
check("level pill switched to least squares", level === "ls", level);
await expectStaggered("ls", null, "after pill click");

await browser.close();
console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
