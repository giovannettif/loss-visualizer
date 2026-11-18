/**
 * qa-int/t4-transports.mjs — transport regression (interaction lens):
 * the universal footer transport (▶/❚❚, ↻ Replay, scrubber, speed switch)
 * on §2 gd-c and §5 lab, the §7 tilt ghost transport + scrubber, and the
 * §7 swarm dock transport (▶/❚❚, ↻, flight scrubber, blind toggle).
 * REAL clicks/drag/keys only; state via __wp1 (read-only).
 */
import { chromium } from "playwright";
import { launchGL } from "../tools/gl-launch.mjs";
import {
  check, finish, sleep, appState, waitIdle, waitFor, shot, readerBox,
} from "./h.mjs";

const BASE = process.argv[2] ?? "http://localhost:4184";
const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
const st = () => appState(page);
const rep = () => page.evaluate(() => window.__wp1.replayInfo());

/* ============ §2 gd-c: the universal footer transport (?step=6) ============ */
await page.goto(BASE + "/?step=6", { waitUntil: "load" });
await page.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
await waitIdle(page);
let a = await st();
check("gd-c boots parked on step 6 with the transport visible",
  a?.step === 6, `step=${a?.step} hidden=${await page.evaluate(() => document.querySelector("#play-btn")?.hidden)}`);

// ▶ Play rolls the ball along the current trail
await page.click("#play-btn");
const r1 = await waitFor(page, async () => ((await rep()).playing ? await rep() : null),
  { label: "gd-c play starts" });
const pA = r1?.progress ?? 0;
await sleep(700);
const r2 = await rep();
check("▶ Play starts the roll and progress advances",
  !!r1 && r2.playing === true && r2.progress > pA,
  `progress ${pA.toFixed(3)} -> ${r2.progress.toFixed(3)} lanes=${r2.lanes}`);
const btnLabel1 = await page.evaluate(() => document.querySelector("#play-btn")?.textContent?.trim());
check("▶ flips to ❚❚ while playing", /❚❚|Pause/i.test(btnLabel1 ?? ""), `label="${btnLabel1}"`);

// speed switch: measure the progress rate over a SHORT window right after a
// restart at each speed (a long window can run the roll to its end).
const prog = (r) => (r.playing ? r.progress : Math.min(1, r.progress || 1));
await page.click('#speed-wrap button[data-speed="2"]');
await page.click("#replay-btn"); // restart at 2×
await sleep(120);
const f1 = await rep();
await sleep(380);
const f2 = await rep();
const rateFast = (prog(f2) - prog(f1)) / 0.38;
await page.click('#speed-wrap button[data-speed="0.5"]');
await page.click("#replay-btn"); // restart at 0.5×
await sleep(120);
const h1 = await rep();
await sleep(380);
const h2 = await rep();
const rateSlow = (prog(h2) - prog(h1)) / 0.38;
check("speed switch changes the roll rate (2× > 0.5×)",
  rateFast > rateSlow * 1.5, `2× rate ${rateFast.toFixed(3)}/s vs 0.5× rate ${rateSlow.toFixed(3)}/s (speed=${(await rep()).speed})`);

// ❚❚ pause freezes the progress
await page.click('#speed-wrap button[data-speed="1"]');
await page.click("#play-btn");
await sleep(250);
const r3 = await rep();
await sleep(500);
const r4 = await rep();
check("❚❚ pause freezes the progress",
  r3.playing === false && Math.abs(r4.progress - r3.progress) < 0.01,
  `paused at ${r3.progress.toFixed(3)}; 500ms later ${r4.progress.toFixed(3)}`);

// scrubber drags the ball along the trail
{
  const box = await page.locator("#replay-scrub").boundingBox();
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
}
await sleep(200);
const r5 = await rep();
check("dragging the scrubber parks the roll at the dragged fraction",
  r5.progress > 0.6 && r5.progress < 0.9, `progress=${r5.progress.toFixed(3)}`);

// ↻ Replay restarts from the trail head
await page.click("#replay-btn");
const r6 = await waitFor(page, async () => ((await rep()).playing ? await rep() : null),
  { label: "gd-c replay restart" });
await sleep(150);
const r7 = await rep();
check("↻ Replay restarts the roll from the trail head",
  !!r6 && r7.playing === true && r7.progress < r5.progress,
  `progress ${r5.progress.toFixed(3)} -> ${r7.progress.toFixed(3)}`);
await page.click("#play-btn"); // pause for a clean exit
await shot(page, "t4-gdc-transport.png");

/* ============ Space stays a READER key during a replay ============ */
await waitIdle(page);
const stepBefore = (await st()).step;
await page.click("#play-btn"); // start the roll again
await sleep(200);
await page.keyboard.press("Space"); // must SKIP/advance the reader, not pause the roll
await waitIdle(page);
{
  const r = await rep();
  const s = await st();
  check("Space during a replay stays a reader key (step changed, roll not toggled off)",
    s.step === stepBefore + 1, `step ${stepBefore} -> ${s.step}; playing=${r.playing}`);
}

/* ============ §5 lab: 3-lane race transport (?step=13) ============ */
await page.goto(BASE + "/?step=13", { waitUntil: "load" });
await page.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
await waitIdle(page);
await page.click("#play-btn");
const lab1 = await waitFor(page, async () => ((await rep()).playing ? await rep() : null),
  { label: "lab play starts" });
await sleep(400);
const lab2 = await rep();
check("§5 lab transport: 3-lane race rolls and advances",
  !!lab1 && lab2.playing === true && lab2.lanes === 3 && lab2.progress > (lab1.progress ?? 0),
  `lanes=${lab2.lanes} progress ${(lab1.progress ?? 0).toFixed(3)} -> ${lab2.progress.toFixed(3)}`);
await page.click("#play-btn"); // pause

/* ============ §7 tilt-b: ghost transport + scrubber (?step=20) ============ */
await page.goto(BASE + "/?step=20", { waitUntil: "load" });
await page.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
await waitIdle(page);
a = await st();
{
  const t = await page.evaluate(() => {
    const s = window.__wp1.tilt();
    return { level: s.level, hasRun: s.hasRun, done: s.done, scrubPlaying: s.scrubPlaying, ghost: s.ghost };
  });
  check("§7 tilt-b boots on the replay page", a?.step === 20, JSON.stringify({ step: a?.step, ...t }));
}
// the ghost ▶ (panel transport)
await page.click("#tilt-replay-play");
const tp1 = await waitFor(page, async () => {
  const s = await page.evaluate(() => window.__wp1.tilt());
  return s.scrubPlaying ? s : null;
}, { label: "tilt ghost plays", maxMs: 8000 });
check("§7 ghost ▶ starts the ghost replay (scrubPlaying)",
  !!tp1, `scrubPlaying=${tp1?.scrubPlaying}`);
// drag the scrubber: parks the ghost at the fraction
await sleep(300);
{
  const box = await page.locator("#tilt-scrub").boundingBox();
  await page.mouse.move(box.x + box.width * 0.15, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
}
await sleep(250);
{
  const s = await page.evaluate(() => {
    const t = window.__wp1.tilt();
    return { scrub: t.scrub, playing: t.scrubPlaying };
  });
  check("§7 ghost scrubber parks the replay at the dragged fraction",
    s.scrub > 0.65 && s.scrub < 0.95, `scrub=${s.scrub.toFixed(3)} playing=${s.playing}`);
}
// ↻ restart rewinds
await page.click("#tilt-replay-restart");
await sleep(250);
{
  const s = await page.evaluate(() => {
    const t = window.__wp1.tilt();
    return { scrub: t.scrub, playing: t.scrubPlaying };
  });
  check("§7 ghost ↻ rewinds to the run's head",
    s.scrub < 0.1, `scrub=${s.scrub.toFixed(3)}`);
}
await shot(page, "t4-tilt-ghost.png");

/* ============ §7 swarm: the dock transport (?step=21) ============ */
await page.goto(BASE + "/?step=21", { waitUntil: "load" });
await page.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
await waitIdle(page);
{
  const s = await page.evaluate(() => {
    const w = window.__wp1.swarm();
    return { playing: w.playing, blind: w.blind, time: w.time, balls: w.balls, map: w.map };
  });
  check("§7 swarm boots: 100 balls, blind by default, dock visible",
    s.balls === 100 && s.blind === true, JSON.stringify(s));
}
// ▶/❚❚ on the dock transport — the flight AUTO-PLAYS on entry, so the first
// click PAUSES and the second resumes; assert the time follows the toggle.
{
  const p0 = await page.evaluate(() => window.__wp1.swarm().playing);
  await page.click("#swarm-replay-play"); // -> paused
  await sleep(350);
  const sw1 = await page.evaluate(() => {
    const w = window.__wp1.swarm();
    return { playing: w.playing, time: w.time };
  });
  await sleep(450);
  const sw2 = await page.evaluate(() => {
    const w = window.__wp1.swarm();
    return { playing: w.playing, time: w.time };
  });
  check("swarm ❚❚ freezes the auto-playing flight",
    p0 === true && sw1.playing === false && Math.abs(sw2.time - sw1.time) < 1e-6,
    `was playing=${p0}; paused at ${sw1.time.toFixed(2)}; 450ms later ${sw2.time.toFixed(2)}`);
  await page.click("#swarm-replay-play"); // -> resumed
  await sleep(350);
  const sw3 = await page.evaluate(() => {
    const w = window.__wp1.swarm();
    return { playing: w.playing, time: w.time };
  });
  await sleep(450);
  const sw4 = await page.evaluate(() => {
    const w = window.__wp1.swarm();
    return { playing: w.playing, time: w.time };
  });
  check("swarm ▶ resumes the flight (time advances again)",
    sw3.playing === true && sw4.time > sw3.time,
    `time ${sw3.time.toFixed(2)} -> ${sw4.time.toFixed(2)}`);
}
// scrubber parks the flight
{
  const box = await page.locator("#swarm-scrub").boundingBox();
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
}
await sleep(250);
const sw5 = await page.evaluate(() => {
  const w = window.__wp1.swarm();
  return { scrub: w.scrub, time: w.time };
});
check("swarm scrubber parks the flight at the dragged fraction",
  sw5.scrub > 0.6 && sw5.scrub < 0.8, `scrub=${sw5.scrub.toFixed(3)} time=${sw5.time.toFixed(2)}`);
// ↻ rewind
await page.click("#swarm-replay-restart");
await sleep(300);
const sw6 = await page.evaluate(() => {
  const w = window.__wp1.swarm();
  return { scrub: w.scrub, time: w.time };
});
check("swarm ↻ rewinds the flight",
  sw6.scrub < 0.05 || sw6.time < sw5.time, `scrub=${sw6.scrub.toFixed(3)} time=${sw6.time.toFixed(2)}`);
// blind toggle: flips blind mode and re-runs (rewind + repaint)
const blindBefore = await page.evaluate(() => window.__wp1.swarm().blind);
await page.click("#swarm-blind");
await sleep(400);
const blindAfter = await page.evaluate(() => {
  const w = window.__wp1.swarm();
  return { blind: w.blind, scrub: w.scrub };
});
check("the dock's run blind / show map toggle flips the mode and rewinds the flight",
  blindBefore === true && blindAfter.blind === false && blindAfter.scrub < 0.2,
  `blind ${blindBefore} -> ${blindAfter.blind}, scrub rewound to ${blindAfter.scrub.toFixed(3)}`);
await page.click("#swarm-blind"); // back to blind (the default)
await shot(page, "t4-swarm-dock.png");

await browser.close();
finish("T4-TRANSPORTS");
