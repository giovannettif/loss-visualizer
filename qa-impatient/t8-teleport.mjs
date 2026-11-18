/**
 * T8 — teleport state integrity: the impatient user rail-jumps straight
 * into the middle of every game section and back. Each landing must carry a
 * coherent scene state (no half-built runs, no leaked counters), and rapid
 * ping-pong must corrupt nothing.
 */
import { BASE, launch, waitReady, snapshot, ok, shot } from "./driver.mjs";

const { browser, page } = await launch();
await page.goto(BASE + "?step=4", { waitUntil: "load" });
await waitReady(page);
await page.waitForTimeout(2500);

const clickRail = (k) => page.evaluate((i) => document.querySelectorAll("#rail button")[i].click(), k);
const settle = async (ms = 4000) => { await page.waitForTimeout(ms); };

// --- 1. straight into fog-b (16) ---
await clickRail(16);
await settle(5000);
let s = await snapshot(page);
let fog = await page.evaluate(() => window.__wp1.fog());
console.log("land 16:", JSON.stringify({ step: s.step, scene: s.scene, locked: s.locked, fog: { level: fog.level, used: fog.used, budget: fog.budget, done: fog.done } }));
ok(s.step === 16 && !s.locked, "direct jump into fog-b lands unlocked");
ok(fog && fog.level === "rb" && fog.used === 0 && fog.done === false && fog.budget === 10, "fog-b run fresh and coherent (budget 10, no strides)", JSON.stringify(fog));

// --- 2. straight into labrule (22) ---
await clickRail(22);
await settle(15000); // the labrule entry runs the benchmark (slow on software GL)
s = await snapshot(page);
let rule = await page.evaluate(() => window.__wp1.rule());
console.log("land 22:", JSON.stringify({ step: s.step, scene: s.scene, locked: s.locked, rule: { level: rule.level, built: rule.built, runs: rule.runs ? rule.runs.length : null } }));
ok(s.step === 22 && !s.locked, "direct jump into labrule lands unlocked", `locked=${s.locked}`);
ok(rule.runs !== null && rule.runs.length === 4, "rule benchmark ran (4 rows: custom + 3 machines)", JSON.stringify(rule.runs?.map((r) => r.label)));

// --- 3. back into fog-b: state preserved? ---
await clickRail(16);
await settle(5000);
fog = await page.evaluate(() => window.__wp1.fog());
s = await snapshot(page);
console.log("back 16:", JSON.stringify({ step: s.step, fog: { level: fog.level, used: fog.used, done: fog.done } }));
ok(fog && fog.level === "rb" && fog.used === 0 && fog.done === false, "fog-b fresh run preserved after leaving and returning", JSON.stringify(fog));

// --- 4. rapid ping-pong 16 <-> 22 (mid-lock drops), then settle ---
for (let i = 0; i < 6; i++) { await clickRail(i % 2 ? 22 : 16); await page.waitForTimeout(200); }
await settle(16000);
s = await snapshot(page);
console.log("after ping-pong:", JSON.stringify({ step: s.step, scene: s.scene, locked: s.locked, rail: s.railCurrent, count: s.countText }));
ok(s.step === 22 || s.step === 16, "ping-pong settles on one landing", `step=${s.step}`);
ok(s.railCurrent === s.step && s.activeInert && s.countText === `${s.step + 1} / 27`, "landing fully consistent", `rail=${s.railCurrent} count=${s.countText}`);
ok(!s.locked, "unlocked after ping-pong");
if (s.step === 16) {
  fog = await page.evaluate(() => window.__wp1.fog());
  ok(fog && fog.level === "rb" && fog.used === 0 && !fog.done, "fog state still coherent after ping-pong", JSON.stringify(fog));
} else {
  rule = await page.evaluate(() => window.__wp1.rule());
  ok(rule.runs !== null, "rule benchmark state still coherent after ping-pong", `runs=${rule.runs?.length}`);
}

// --- 5. jump into swarm (21) mid-everything, then tilt (18) ---
await clickRail(21);
await settle(4000);
s = await snapshot(page);
const swarm = await page.evaluate(() => window.__wp1.swarm());
console.log("land 21:", JSON.stringify({ step: s.step, swarm: { balls: swarm.balls, settled: swarm.settled, playing: swarm.playing, blind: swarm.blind, time: Math.round(swarm.time * 10) / 10, total: swarm.total } }));
ok(swarm.balls === 100 && swarm.total > 0, "swarm flight coherent on direct jump", JSON.stringify({ balls: swarm.balls, total: swarm.total }));
await clickRail(18);
await settle(4000);
s = await snapshot(page);
const tilt = await page.evaluate(() => window.__wp1.tilt());
console.log("land 18:", JSON.stringify({ step: s.step, tilt: { cells: tilt.cells, steps: tilt.steps, done: tilt.done, steered: tilt.steered } }));
ok(tilt.steps === 0 && tilt.cells <= 1 && !tilt.done && !tilt.steered, "tilt run fresh on direct jump (no swarm leakage)", JSON.stringify(tilt));

// --- 6. scrub/transport sanity while jumping: swarm replay pinned then leave ---
await clickRail(21);
await settle(3000);
await page.evaluate(() => document.querySelector("#swarm-replay-restart")?.click());
await page.waitForTimeout(500);
await clickRail(8); // leave mid-flight
await settle(4000);
s = await snapshot(page);
ok(s.step === 8 && !s.locked, "leaving mid-swarm-flight lands clean", `step=${s.step}`);
await clickRail(21); // return
await settle(4000);
s = await snapshot(page);
const swarm2 = await page.evaluate(() => window.__wp1.swarm());
console.log("re-land 21:", JSON.stringify({ step: s.step, swarm: { balls: swarm2.balls, playing: swarm2.playing, time: Math.round(swarm2.time * 10) / 10 } }));
ok(swarm2.balls === 100, "swarm re-entry coherent", JSON.stringify({ balls: swarm2.balls, playing: swarm2.playing }));

await shot(page, "t8-end");
await browser.close();
console.log("T8 done");
