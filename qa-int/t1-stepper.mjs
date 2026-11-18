/**
 * qa-int/t1-stepper.mjs — stepper regression (interaction lens):
 * intro dock, wheel/Space/↓/↑ advance, click-on-text inert, locks engage,
 * fast-fling single crossing, rail advance/teleport, skip, continue hint,
 * last-step park, back-to-intro.
 * Drives http://localhost:4184/ with REAL mouse/keyboard/wheel input.
 * State reads go through the page's own __wp1 diagnostics (read-only).
 */
import { chromium } from "playwright";
import { launchGL } from "../tools/gl-launch.mjs";
import {
  check, finish, sleep, appState, waitIdle, waitFor, shot,
  wheelReader, wheelFling, railClick, stageBox, readerBox,
} from "./h.mjs";

const BASE = process.argv[2] ?? "http://localhost:4184";
const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

const st = () => appState(page);

async function readerUi() {
  return page.evaluate(() => ({
    skipHidden: document.querySelector("#skip-btn")?.hidden ?? null,
    hintHidden: document.querySelector("#continue-hint")?.hidden ?? null,
    fill: document.querySelector("#edge-fill")?.style.height ?? null,
    counter: document.querySelector("#reader-count")?.textContent ?? null,
  }));
}

/* ---------- A. fresh boot: full-bleed intro park ---------- */
await page.goto(BASE + "/", { waitUntil: "load" });
await page.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
let a = await waitIdle(page);
check("boot lands in the intro park (full-bleed, step 0, unlocked)",
  !!a && a.intro === true && a.step === 0 && !a.locked && !a.animating,
  JSON.stringify(a));
await shot(page, "t1-A-intro.png");

/* ---------- B. intro: canvas wheel docks the reader; guard eats the gesture ---------- */
const sb = await stageBox(page);
await page.mouse.move(sb.x + sb.width * 0.5, sb.y + sb.height * 0.5);
await page.mouse.wheel(0, 160);
await sleep(150);
a = await st();
check("intro: a notch below the boundary accumulates WITHOUT docking (no idle snap-back)",
  !!a && a.intro === true && a.step === 0 && a.scroll.target > a.scroll.y - 1 && a.scroll.target < 0,
  `intro=${a?.intro} y=${a?.scroll.y} target=${a?.scroll.target}`);
const zoomPre = await page.evaluate(() => window.__wp1.debug().viewAttitude.zoomRadius);
await page.mouse.wheel(0, 160); // crosses the intro boundary -> docks + arms the guard
await sleep(120);
a = await st();
check("intro: crossing the boundary docks the reader on step 0 (target re-parks on 0)",
  !!a && a.intro === false && a.step === 0 && a.scroll.target === 0,
  `intro=${a?.intro} step=${a?.step} target=${a?.scroll.target}`);
const zoomAtDock = await page.evaluate(() => window.__wp1.debug().viewAttitude.zoomRadius);
await page.mouse.wheel(0, 160); // leftover of the docking gesture — must be swallowed
await sleep(80);
a = await st();
const zoomPost = await page.evaluate(() => window.__wp1.debug().viewAttitude.zoomRadius);
check("dock-gesture guard: the leftover notch neither scrolls nor leaks into a canvas zoom",
  !!a && a.step === 0 && a.scroll.target === 0 && Math.abs(zoomPost - zoomAtDock) < 1e-6,
  `target stays 0; zoom ${zoomAtDock.toFixed(2)} -> ${zoomPost.toFixed(2)} (was ${zoomPre.toFixed(2)})`);

/* ---------- C. reader wheel: partial notch, then a fling crosses ONE boundary ---------- */
await sleep(450); // let the dock-guard idle out (300ms)
await wheelReader(page, 160);
await sleep(150);
a = await st();
check("one hesitant notch over the reader accumulates but does not enter step 1 yet",
  !!a && a.step === 0 && a.scroll.target > 0,
  `step=${a?.step} target=${a?.scroll.target}`);
await wheelFling(page, { dy: 400, n: 6, gapMs: 20 });
const lockSample = await st(); // sampled synchronously after the crossing
check("forward wheel entry into step 1 LOCKS (skip visible, hint hidden)",
  !!lockSample && lockSample.step === 1 && lockSample.locked === true,
  JSON.stringify({ step: lockSample?.step, locked: lockSample?.locked }));
await shot(page, "t1-C-step1-locked.png");
const ui1 = await readerUi();
check("locked UI: Skip animation shown, continue ↓ hidden, counter 2/27",
  ui1.skipHidden === false && ui1.hintHidden === true && ui1.counter === "2 / 27",
  JSON.stringify(ui1));
// While locked, the wheel is frozen: a notch must not queue.
await sleep(60);
const frozen = (await st())?.scroll.target;
await wheelReader(page, 500);
await sleep(60);
a = await st();
check("lock freezes the wheel (target unchanged while the entry animation drains)",
  a?.scroll.target === frozen,
  `target ${frozen} -> ${a?.scroll.target}`);
a = await waitIdle(page);
const ui2 = await readerUi();
check("after drain: unlocked, parked, at snap, Skip hidden, continue visible",
  !!a && !a.locked && a.step === 1 && a.parked && a.scroll.atSnap &&
  ui2.skipHidden === true && ui2.hintHidden === false && ui2.fill === "0%",
  JSON.stringify({ st: a, ui: ui2 }));

/* ---------- D. Space / ArrowDown advance, ArrowUp back, repeat guards ---------- */
await page.keyboard.press("Space");
await waitFor(page, async () => (await st()).step === 2, { label: "space -> step 2" });
await waitIdle(page);
a = await st();
check("Space advances one step (2)", a?.step === 2, `step=${a?.step}`);
// OS auto-repeat: synthetic repeat=true keydowns must be swallowed.
for (let i = 0; i < 3; i++) {
  await page.evaluate(() =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", repeat: true, cancelable: true })));
  await sleep(30);
}
await sleep(250);
a = await st();
check("held ArrowDown's auto-repeat (e.repeat) does not sail through steps",
  a?.step === 2, `step=${a?.step}`);
for (let i = 0; i < 3; i++) {
  await page.evaluate(() =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", repeat: true, cancelable: true })));
  await sleep(30);
}
await sleep(250);
a = await st();
check("held Space's auto-repeat does not skip/advance through steps",
  a?.step === 2, `step=${a?.step}`);
await page.keyboard.press("ArrowDown");
await waitIdle(page);
a = await st();
check("ArrowDown advances (3)", a?.step === 3, `step=${a?.step}`);
const backStart = Date.now();
await page.keyboard.press("ArrowUp");
a = await st();
check("ArrowUp steps back instantly and never re-locks (2)",
  a?.step === 2 && a.locked === false,
  `step=${a?.step} locked=${a?.locked} (${Date.now() - backStart}ms)`);

/* ---------- E. click-on-text is inert (twice) ---------- */
const rb = await readerBox(page);
const textX = rb.x + rb.width * 0.5;
const textY = rb.y + 180;
await page.mouse.click(textX, textY);
await sleep(600);
a = await st();
check("plain click on reader text advances nothing (1st)",
  a?.step === 2 && !a.intro, `step=${a?.step}`);
await page.mouse.dblclick(textX, textY);
await sleep(600);
a = await st();
const sel = await page.evaluate(() => window.getSelection()?.toString() ?? "");
check("double-click on text selects only — still no advance (2nd)",
  a?.step === 2 && sel.length > 0, `step=${a?.step} selection="${sel.slice(0, 30)}"`);
await shot(page, "t1-E-click-inert.png");

/* ---------- F. rail: far teleport (locks forward), adjacent, backward ---------- */
await railClick(page, 4);
await sleep(120);
a = await st();
const railLock = a?.locked === true;
a = await waitIdle(page);
check("rail far jump forward teleports to step 4 under a lock, then parks",
  railLock && a?.step === 4 && a.parked, `lockedAtArrival=${railLock} step=${a?.step}`);
await railClick(page, 5);
await waitIdle(page);
a = await st();
check("rail adjacent jump advances one page (5)", a?.step === 5, `step=${a?.step}`);
await railClick(page, 1);
a = await st();
check("rail backward jump steps back instantly, no lock (1)",
  a?.step === 1 && a.locked === false, `step=${a?.step} locked=${a?.locked}`);
await waitIdle(page);
// rail + counter chip share the reader wheel policy (wheel over the rail advances)
const railB = await page.locator("#rail").boundingBox();
await page.mouse.move(railB.x + railB.width / 2, railB.y + railB.height / 2);
for (let i = 0; i < 4; i++) {
  await page.mouse.wheel(0, 160);
  await sleep(25);
}
await waitIdle(page);
a = await st();
check("wheel over the rail advances the reader like the panel (2)",
  a?.step === 2, `step=${a?.step}`);

/* ---------- G. fast fling crosses exactly ONE boundary (KW-8) ---------- */
await wheelFling(page, { dy: 300, n: 8, gapMs: 18 });
a = await st();
const g1 = a?.step;
check("8-notch fling advances exactly ONE step (2→3)", g1 === 3, `step=${g1}`);
await waitIdle(page);
await sleep(320); // fresh gesture after the 180ms idle
await wheelFling(page, { dy: 300, n: 8, gapMs: 18 });
await waitIdle(page);
a = await st();
check("a second fling after the idle crosses the next boundary (3→4)",
  a?.step === 4, `step=${a?.step}`);

/* ---------- H. Skip animation ends the lock ---------- */
await railClick(page, 1);
await waitIdle(page);
await railClick(page, 3); // task-c — the surface-materialization entry
await sleep(100);
a = await st();
const wasLocked = a?.locked === true;
const skipVisible = (await readerUi()).skipHidden === false;
await page.click("#skip-btn");
const skipRel = await waitFor(page, async () => {
  const s = await st();
  return !s.locked && !s.animating ? s : null;
}, { label: "skip releases the lock", maxMs: 4000 });
a = skipRel ?? (await st());
const uiH = await readerUi();
check("Skip animation drains the forward-entry lock instantly",
  wasLocked && skipVisible && a?.step === 3 && !a.locked && a.animating === false &&
  uiH.skipHidden === true && uiH.hintHidden === false,
  `lockedOnEntry=${wasLocked} step=${a?.step} locked=${a?.locked} animating=${a?.animating}`);
await waitIdle(page);

/* ---------- I. continue ↓ hint advances ---------- */
await page.click("#continue-hint");
await sleep(100);
a = await st();
const hintLocked = a?.locked === true;
await waitIdle(page);
a = await st();
check("continue ↓ click advances one step under a lock (4)",
  hintLocked && a?.step === 4, `lockedAtClick=${hintLocked} step=${a?.step}`);

/* ---------- J. the last step parks; wheel past it does nothing ---------- */
await railClick(page, 26);
await waitIdle(page);
a = await st();
const lastPark = a?.scroll.tops?.[26];
const uiJ = await readerUi();
check("last step (27/27): parked on its offset, continue hidden",
  a?.step === 26 && a.parked && uiJ.hintHidden === true,
  `step=${a?.step} park=${lastPark} hint=${uiJ.hintHidden}`);
await wheelFling(page, { dy: 400, n: 6, gapMs: 20 });
await sleep(250);
await wheelFling(page, { dy: 400, n: 6, gapMs: 20 });
await waitIdle(page);
a = await st();
check("wheel past the last step refuses: still parked on 27/27 at the same offset",
  a?.step === 26 && a.scroll.target === lastPark && a.parked,
  `step=${a?.step} target=${a?.scroll.target} park=${lastPark}`);
await shot(page, "t1-J-last-step.png");

/* ---------- K. back into the intro from step 0; stage click re-docks ---------- */
await railClick(page, 0);
await waitIdle(page);
await page.keyboard.press("ArrowUp");
await sleep(300);
a = await st();
check("ArrowUp from step 0 re-expands the full-bleed intro",
  a?.intro === true, `intro=${a?.intro}`);
await shot(page, "t1-K-intro-back.png");
await page.mouse.click(sb.x + sb.width * 0.5, sb.y + sb.height * 0.5);
await sleep(300);
a = await st();
check("a plain stage click at the intro docks the reader on step 0",
  a?.intro === false && a.step === 0, `intro=${a?.intro} step=${a?.step}`);

/* ---------- L. canvas wheel zooms, never advances (docked) ---------- */
await railClick(page, 4);
await waitIdle(page);
const before = await page.evaluate(() => window.__wp1.debug().viewAttitude);
const beforeStep = (await st()).step;
await wheelFling(page, { dy: -160, n: 4, gapMs: 60, over: "canvas" });
await sleep(250);
const after = await page.evaluate(() => window.__wp1.debug().viewAttitude);
a = await st();
check("wheel over the CANVAS zooms the camera (radius shrinks) and never advances",
  after.zoomRadius < before.zoomRadius * 0.95 && a?.step === beforeStep && a.parked && !a.intro,
  `zoom ${before.zoomRadius.toFixed(1)} -> ${after.zoomRadius.toFixed(1)} step=${a?.step}`);
await shot(page, "t1-L-zoomedin.png");
const beforeOut = after.zoomRadius;
await wheelFling(page, { dy: 160, n: 4, gapMs: 60, over: "canvas" });
await sleep(250);
const afterOut = await page.evaluate(() => window.__wp1.debug().viewAttitude);
check("wheel the other way zooms back out (radius grows)",
  afterOut.zoomRadius > beforeOut, `${beforeOut.toFixed(1)} -> ${afterOut.zoomRadius.toFixed(1)}`);

/* ---------- M. Ctrl+wheel over the reader is page zoom, not a step (KW-7) ---------- */
await page.keyboard.down("Control");
await wheelReader(page, 240);
await page.keyboard.up("Control");
await sleep(400);
a = await st();
check("Ctrl+wheel over the reader advances nothing",
  a?.step === 4 && !a.intro, `step=${a?.step}`);
// restore zoom level for any later inspection
await page.keyboard.down("Control");
await wheelReader(page, -240);
await page.keyboard.up("Control");
await sleep(300);

await browser.close();
finish("T1-STEPPER");
