/**
 * T4 — Skip-button spam across every animated entry, with the fog game as
 * the corruption probe: skipping every fog lock must never leave the fog
 * game (or a LATER step) in a corrupted/graded-empty state that then leaks
 * into the reveal or the swarm.
 */
import { BASE, launch, waitReady, snapshot, ok, shot } from "./driver.mjs";

const { browser, page } = await launch();
await page.goto(BASE + "?step=14", { waitUntil: "load" });
await waitReady(page);
await page.waitForTimeout(2500);
let s = await snapshot(page);
console.log("boot fog-a(14):", JSON.stringify({ step: s.step, scene: s.scene, fog: s.fog }));

const skip = () => page.evaluate(() => { const b = document.querySelector("#skip-btn"); if (!b.hidden) b.click(); });
const st = () => page.evaluate(() => {
  const f = window.__wp1.fog();
  return f ? { level: f.level, used: f.used, budget: f.budget, done: f.done, path: f.pathLen, reveal: Math.round(f.reveal * 100) / 100, ghosts: f.ghosts, ghostsPlaying: f.ghostsPlaying, machines: f.machines } : null;
});

// --- advance fog-a -> fog-b -> fog-c with Skip spam on each entry ---
await page.keyboard.press("Space"); // advance 14->15
await page.waitForTimeout(120);
for (let i = 0; i < 6; i++) { await skip(); await page.waitForTimeout(60); }
await page.waitForTimeout(1200);
s = await snapshot(page);
console.log("at 15:", JSON.stringify({ step: s.step, locked: s.locked, fog: await st() }));

await page.keyboard.press("Space"); // advance 15->16 (fog-b run)
await page.waitForTimeout(120);
for (let i = 0; i < 6; i++) { await skip(); await page.waitForTimeout(60); }
await page.waitForTimeout(1200);
s = await snapshot(page);
const fogB = await st();
console.log("at 16:", JSON.stringify({ step: s.step, locked: s.locked, fog: fogB }));
ok(fogB && fogB.used === 0 && !fogB.done, "skipped fog-b run is intact: budget full, run not pre-finished", JSON.stringify(fogB));
ok(fogB && fogB.level === "b", "fog level b is the live game level");

// --- the Finish shortcut (impatient user ends the run immediately) ---
await page.evaluate(() => document.querySelector("#fog-finish")?.click());
await page.waitForTimeout(600);
let fb = await st();
console.log("after immediate Finish:", JSON.stringify(fb));
ok(fb && fb.done === true, "Finish ends the run (done=true) even with zero strides");

// --- advance into fog-c (reveal + ghost race ~7s lock) and spam Skip ---
await page.keyboard.press("Space");
await page.waitForTimeout(150);
s = await snapshot(page);
console.log("entering 16->17... locked:", s.locked);
for (let i = 0; i < 12; i++) { await skip(); await page.waitForTimeout(80); }
await page.waitForTimeout(2500);
s = await snapshot(page);
const fogC = await st();
console.log("at 17:", JSON.stringify({ step: s.step, locked: s.locked, animating: s.animating, fog: fogC }));
ok(s.step === 17 && !s.locked && !s.animating, "fog-c ghost-race lock is fully skippable (no deadlock)", `locked=${s.locked} animating=${s.animating}`);
ok(fogC && fogC.ghostsPlaying === false, "ghost race stopped after skip");

// what does the reveal show for the skipped-empty run?
const revealCopy = await page.evaluate(() => {
  const g = (id) => document.querySelector(id);
  return {
    emptyLead: g("#fog-empty-lead")?.textContent?.trim() ?? null,
    emptyVerdict: g("#fog-empty-verdict-note")?.textContent?.trim() ?? null,
    verdict: g("#fog-verdict")?.textContent?.trim() ?? null,
    scoreRows: [...document.querySelectorAll("#fog-scorecard-body tr")].map((r) => r.textContent.trim().replace(/\s+/g, " ")),
  };
});
console.log("fog-c reveal copy (skipped-empty run):", JSON.stringify(revealCopy, null, 1));

// --- and the swarm after: skipping must not corrupt the NEXT section ---
await page.keyboard.press("Space"); // 17 -> 18 tilt-a
await page.waitForTimeout(2500);
s = await snapshot(page);
console.log("at 18:", JSON.stringify({ step: s.step, scene: s.scene, locked: s.locked, tilt: s.tilt }));
ok(s.step === 18 && !s.locked, "advanced to tilt-a cleanly after the skipped fog game");
ok(s.tilt && s.tilt.cells === 0 && s.tilt.steps === 0, "tilt run starts fresh (no fog leakage)", JSON.stringify(s.tilt));

await page.keyboard.press("Space"); // 18 -> 19 (tilt-a shared scene)
await page.waitForTimeout(2500);
await page.keyboard.press("Space"); // 19 -> 20 tilt-b
await page.waitForTimeout(2500);
await page.keyboard.press("Space"); // 20 -> 21 swarm
await page.waitForTimeout(3000);
s = await snapshot(page);
const swarmState = await page.evaluate(() => window.__wp1.swarm());
console.log("at 21 swarm:", JSON.stringify({ step: s.step, locked: s.locked, animating: s.animating }));
console.log("swarm:", JSON.stringify(swarmState).slice(0, 400));
ok(s.step === 21 && !s.locked, "swarm reached after a fully-skipped fog game");
await shot(page, "t4-swarm-after-skip-fog");

// --- Skip spam on the swarm/labrule entries too ---
for (let k = 22; k <= 26; k++) {
  await page.keyboard.press("Space");
  await page.waitForTimeout(100);
  for (let i = 0; i < 5; i++) { await skip(); await page.waitForTimeout(50); }
  await page.waitForTimeout(1500);
  s = await snapshot(page);
  ok(s.step === k && !s.locked, `step ${k}: entry lock skippable, lands consistent`, `step=${s.step} locked=${s.locked}`);
}
await shot(page, "t4-end");
await browser.close();
console.log("T4 done");
