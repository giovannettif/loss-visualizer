/**
 * cdp-interact-apa1.mjs — reader model v4 (continuous scroll) gate over CDP:
 *
 *   1. no document scrollbar (body overflow hidden).
 *   2. wheel over the reader SCROLLS the document — the next step's text
 *      slides in from below (partial scroll after a small gesture, not a
 *      discrete swap).
 *   3. snap-to-step: when the scroll reaches the incoming step it snaps into
 *      place (scrollTop settles on the step's park offset) and enters it.
 *   4. lock-while-animating: the forward entry locks the reader — extra
 *      wheels are dropped (step and scroll target frozen) until the scene
 *      animation drains; then the lock releases (unlock-on-complete).
 *   5. reverse-on-scroll-up: wheeling up past the boundary re-enters the
 *      previous step with the scene state stepped back instantly — no
 *      re-lock, scrollTop settles on the previous park.
 *   5b. the full-bleed intro park: a fresh boot rests BELOW zero on the
 *       intro park (reader slid off, camera zoom muted), and wheeling down
 *       past the intro boundary docks the reader on step 0 — the intro is
 *       a park, not a step (indices, rail, deep links keep their meaning).
 *   6. wheel over the canvas zooms the camera and never advances.
 *   7. Skip (Space) completes the animation instantly + unlocks.
 *   8. keyboard matches: ArrowDown advances (scroll+snap+lock), ArrowUp
 *      reverses instantly (no re-lock).
 *   9. rail ticks track the active step and jump anywhere (lock respected).
 *  10. ?step=N and ?shot=… still land deterministically (document parked).
 *  11. §1–§3 regression suites re-run afterwards.
 *  12. stepper-lock regressions, one per Sweep finding: KW-8 fling across a
 *      lock, fast wheel through unlocked same-scene steps, spin through a
 *      rail-jump lock, rail jumps lock, wheel over rail/chip (F16/KW-6),
 *      Ctrl+wheel (KW-7), line-mode wheel (F16-DELTAMODE), paced notches.
 *  13. interaction v5 regressions (user feedback 2026-11-13 + cycle B): click-on-text
 *      does not advance (selection still works; the hint still advances), a
 *      held ArrowDown and a held ArrowUp each advance exactly one step per
 *      burst (IMP-1), forward entry into the no-animation steps 14/19/23
 *      locks then auto-unlocks, the last step parks and stays.
 *  14. tour v2 regressions: a tour started mid-section works, a plain click
 *      during the tour advances nothing (tour + reader), Space/ArrowUp walk
 *      sentences tour-locally, the wheel stays master (sync + clean exit
 *      past the section), and the reader is free after the exit.
 *
 * Usage: node tools/cdp-interact-apa1.mjs <baseUrl>
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const base = process.argv[2] ?? "http://localhost:4173";

const profile = mkdtempSync(join(tmpdir(), "cdp-apa1-"));
const proc = spawn(
  EDGE,
  [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--window-size=1600,900",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);

const browserWs = await new Promise((resolve, reject) => {
  let buf = "";
  const timer = setTimeout(() => reject(new Error("no devtools ws url")), 15000);
  proc.stderr.on("data", (c) => {
    buf += c.toString();
    const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
    if (m) {
      clearTimeout(timer);
      resolve(m[1]);
    }
  });
});
const httpPort = browserWs.match(/ws:\/\/127\.0\.0\.1:(\d+)\//)?.[1];
let pageWs = null;
for (let i = 0; i < 40 && !pageWs; i++) {
  await new Promise((r) => setTimeout(r, 250));
  const list = await (await fetch(`http://127.0.0.1:${httpPort}/json/list`)).json();
  const page = list.find((t) => t.type === "page");
  if (page) pageWs = page.webSocketDebuggerUrl;
}

const ws = new WebSocket(pageWs);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});
let seq = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(String(ev.data));
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message));
    else resolve(msg.result);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evalJson = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
};

let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: 1600,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
});

/* ---- load the app ------------------------------------------------------ */
await send("Page.navigate", { url: `${base}/` });
await sleep(5000);

/* ---- 1. no document scrollbar ------------------------------------------ */
const shell = JSON.parse(await evalJson(`JSON.stringify({
  bodyOverflow: getComputedStyle(document.body).overflow,
  htmlScrollH: document.documentElement.scrollHeight,
  innerH: window.innerHeight,
  docScrollT: document.documentElement.scrollTop,
  docScrollable: document.documentElement.scrollHeight > window.innerHeight,
})`));
check(
  "no document scrolling (overflow hidden, page fits viewport)",
  shell.bodyOverflow === "hidden" && shell.docScrollable === false,
  JSON.stringify(shell),
);

const READER_X = 1600 - 290; // inside the reader panel
const CANVAS_X = 420; // inside the canvas pane
const Y = 450;

async function wheel(x, y, deltaY) {
  await send("Input.dispatchMouseEvent", {
    type: "mouseWheel", x, y, deltaX: 0, deltaY, pointerType: "mouse",
  });
}
/** A burst of `n` wheel notches, 40ms apart (one gesture, no idle snap). */
async function wheelBurst(x, y, n, deltaY) {
  for (let i = 0; i < n; i++) {
    await wheel(x, y, deltaY);
    await sleep(40);
  }
}

const state = () => evalJson(`JSON.stringify({
  scene: window.__wp1.scene(), step: window.__wp1.step(),
  locked: window.__wp1.locked(), animating: window.__wp1.animating(),
  zoom: window.__wp1.debug().viewAttitude.zoomRadius,
})`);
const scrollState = () => evalJson(`JSON.stringify(window.__wp1.scroll())`);
/** Wheel notches needed to cross the boundary leaving step k (½ page). */
async function notchesToCross(k) {
  const s = JSON.parse(await scrollState());
  const half = (s.tops[k + 1] - s.tops[k]) / 2;
  return Math.max(1, Math.ceil(half / 120));
}

/* ---- 5b. the full-bleed intro park (fresh boot) -------------------------- */
// A fresh boot (no ?step/?shot) rests on the INTRO PARK: the document sits
// BELOW zero (introPark deep), the reader panel is slid off-screen and the
// camera's wheel zoom is muted for the duration. Wheeling down past the
// intro boundary docks the reader on step 0 — the intro is a park, not a
// step, so every index below keeps its meaning (src/main.ts intro section).
const bootScroll = JSON.parse(await scrollState());
check(
  "fresh boot rests on the full-bleed intro park (document below zero)",
  bootScroll.intro === true &&
    Math.abs(bootScroll.y + bootScroll.introPark) <= 2 &&
    Math.abs(bootScroll.target + bootScroll.introPark) <= 2,
  JSON.stringify(bootScroll),
);

// S2-INTRO-CTRLWHEEL: Ctrl+wheel / trackpad pinch on the landing page is the
// browser's page zoom — it must neither scroll nor dock the intro, and the
// page must not swallow it (no defaultPrevented).
{
  await evalJson(`(() => { window.__ctrlWheelPrevented = 0; window.addEventListener("wheel", (e) => { if (e.ctrlKey) setTimeout(() => { if (e.defaultPrevented) window.__ctrlWheelPrevented += 1; }, 0); }, { passive: true }); return true; })()`);
  for (let i = 0; i < 6; i++) {
    await send("Input.dispatchMouseEvent", {
      type: "mouseWheel", x: CANVAS_X, y: Y, deltaX: 0, deltaY: 110, modifiers: 2, pointerType: "mouse",
    });
    await sleep(40);
  }
  await sleep(350);
  const cs = JSON.parse(await scrollState());
  const prevented = await evalJson(`window.__ctrlWheelPrevented`);
  check(
    "S2-INTRO-CTRLWHEEL: Ctrl+wheel on the intro neither scrolls, docks nor is swallowed",
    cs.intro === true && Math.abs(cs.target + cs.introPark) <= 2 && prevented === 0,
    `intro=${cs.intro} target=${cs.target} introPark=${cs.introPark} prevented=${prevented}`,
  );
}

await wheelBurst(CANVAS_X, Y, 3, 120); // 360px > introPark/2: crosses the boundary
await sleep(1400); // dock ease (document + camera re-centering) settles
const docked = JSON.parse(await state());
const dockedScroll = JSON.parse(await scrollState());
check(
  "wheeling down from the intro docks the reader on step 0 (intro is a park, not a step)",
  dockedScroll.intro === false && docked.step === 0 && docked.scene === "hero" &&
    dockedScroll.parked === true && Math.abs(dockedScroll.y - dockedScroll.tops[0]) <= 2,
  `state=${JSON.stringify(docked)} scroll=${JSON.stringify(dockedScroll)}`,
);

/* ---- 6. wheel over canvas zooms, never advances ------------------------- */
const beforeZoom = JSON.parse(await state());
await wheel(CANVAS_X, Y, -240);
await sleep(400);
await wheel(CANVAS_X, Y, -240);
await sleep(600);
const afterZoom = JSON.parse(await state());
check(
  "wheel over the canvas zooms the camera",
  afterZoom.zoom !== beforeZoom.zoom,
  `zoom ${beforeZoom.zoom?.toFixed(2)} -> ${afterZoom.zoom?.toFixed(2)}`,
);
check(
  "wheel over the canvas never advances the step (nor scrolls the reader)",
  afterZoom.step === 0 && afterZoom.scene === "hero",
  JSON.stringify(afterZoom),
);

/* ---- 2. wheel over the reader: scroll-linked text movement --------------- */
// One small gesture: the document GLIDES — the next step's text slides in
// from below as part of the scroll (partial offset, not a discrete swap).
await wheel(READER_X, Y, 120);
await sleep(60);
const glide = JSON.parse(await scrollState());
check(
  "wheel over the reader scrolls the document continuously (text slides in from below)",
  glide.y > 1 && glide.y < 119 && glide.target === 120 && glide.tops[1] > 120,
  JSON.stringify(glide),
);
check(
  "a partial gesture does not enter the next step (snap waits for the boundary)",
  (await evalJson(`window.__wp1.step()`)) === 0,
  `step=${await evalJson(`window.__wp1.step()`)}`,
);

/* ---- 3+4. cross the boundary: snap + lock + unlock ----------------------- */
const n0 = await notchesToCross(0);
await wheelBurst(READER_X, Y, n0, 120);
await sleep(140);
const duringLock = JSON.parse(await state());
const snapTarget = JSON.parse(await scrollState());
check(
  "crossing the boundary snaps the incoming step into place and enters it",
  duringLock.step === 1 && duringLock.scene === "task-a" && snapTarget.atSnap === true,
  `state=${JSON.stringify(duringLock)} scroll=${JSON.stringify(snapTarget)}`,
);
check(
  "progression LOCKS while the step animates",
  duringLock.locked === true,
  JSON.stringify(duringLock),
);

// Extra wheels while locked are dropped: the scroll target stays parked.
await wheel(READER_X, Y, 120);
await wheel(READER_X, Y, 120);
const frozenScroll = JSON.parse(await scrollState());
check(
  "wheel during the lock is dropped (scroll target frozen on the new step)",
  frozenScroll.target === snapTarget.target && frozenScroll.atSnap === true,
  `pre=${JSON.stringify(snapTarget)} post=${JSON.stringify(frozenScroll)}`,
);
await sleep(2400);
const afterLock = JSON.parse(await state());
const parkedScroll = JSON.parse(await scrollState());
check(
  "the document settles parked exactly on the snapped step (unlock-on-complete)",
  afterLock.locked === false && afterLock.step === 1 &&
    parkedScroll.parked === true && Math.abs(parkedScroll.y - parkedScroll.tops[1]) <= 2,
  `state=${JSON.stringify(afterLock)} scroll=${JSON.stringify(parkedScroll)}`,
);

/* ---- 7. skip via Space --------------------------------------------------- */
const n1 = await notchesToCross(1);
await wheelBurst(READER_X, Y, n1, 120); // task-a -> task-b (locks: fit tween)
await sleep(140);
const preSkip = JSON.parse(await state());
await send(`Input.dispatchKeyEvent`, { type: "keyDown", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
await sleep(300);
const postSkip = JSON.parse(await state());
check(
  "Space during an animation SKIPS it and unlocks",
  preSkip.locked === true && postSkip.locked === false && postSkip.animating === false && postSkip.step === preSkip.step,
  `pre=${JSON.stringify(preSkip)} post=${JSON.stringify(postSkip)}`,
);

/* ---- 5. reverse: wheel back up re-enters the previous step --------------- */
const nUp = await notchesToCross(1); // same half-page distance upward
await wheelBurst(READER_X, Y, nUp, -120);
await sleep(120);
const reversed = JSON.parse(await state());
const reversedScroll = JSON.parse(await scrollState());
check(
  "wheeling up past the boundary re-enters the previous step",
  reversed.step === 1 && reversed.scene === "task-a",
  `state=${JSON.stringify(reversed)}`,
);
check(
  "reverse does NOT re-lock (scene state steps back instantly)",
  reversed.locked === false && reversed.animating === false,
  JSON.stringify(reversed),
);
await sleep(1200);
const reversedParked = JSON.parse(await scrollState());
check(
  "reverse settles parked on the previous step's offset",
  reversedParked.parked === true && Math.abs(reversedParked.y - reversedParked.tops[1]) <= 2,
  JSON.stringify(reversedParked),
);

/* ---- 8. keyboard: ArrowDown advance, ArrowUp instant back ---------------- */
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 });
await sleep(140);
const kd = JSON.parse(await state());
check("ArrowDown advances (and locks while the entry animates)", kd.step === 2 && kd.locked === true, JSON.stringify(kd));
await sleep(2200);
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 });
await sleep(120);
const ku = JSON.parse(await state());
check(
  "ArrowUp re-enters the previous step instantly (no re-lock)",
  ku.step === 1 && ku.locked === false && ku.animating === false,
  JSON.stringify(ku),
);
await sleep(1200);

/* ---- 9. rail jump (lock respected) --------------------------------------- */
await evalJson(`(() => {
  const ticks = document.querySelectorAll('#rail button');
  ticks[8].click(); // mom-a
})()`);
await sleep(150);
const railDuring = JSON.parse(await state());
await evalJson(`window.__wp1.skip()`);
await sleep(400);
const railAfter = JSON.parse(await state());
const railScroll = JSON.parse(await scrollState());
check(
  "rail ticks jump steps (ignored while locked)",
  railDuring.step === 8 && railAfter.step === 8 && railAfter.scene === "mom-a",
  `during=${JSON.stringify(railDuring)} after=${JSON.stringify(railAfter)}`,
);
check(
  "a far rail jump teleports the document onto the target park",
  Math.abs(railScroll.y - railScroll.tops[8]) <= 2 && railScroll.parked === true,
  JSON.stringify(railScroll),
);

/* ---- 9b. FIX-RAIL: between-tick clicks land on the nearest step ----------
 * The user complaint: clicking BETWEEN ticks did nothing (dead gaps) or
 * missed the small 3px targets. The rebuilt rail gives every tick an
 * equal, contiguous flex cell in a strip spanning ~3/4 of the panel and
 * routes surface clicks/hovers through nearest-tick math. Pins, from a
 * fresh ?step=10 park:
 *   • the strip spans ~3/4 of the (full-height) panel — 0.72..0.78 of vh;
 *   • tick cells are contiguous (no gaps) and ≥14px tall (generous hits);
 *   • a click at 30% between ticks 11|12 lands on the closer step (11);
 *   • a click at 70% lands on 12;
 *   • a click at the EXACT midpoint still lands on one of the two (no
 *     dead zone — never nothing);
 *   • hovering a midpoint transiently highlights the nearest tick
 *     ([data-near]), cleared on leave.
 */
{
  await land("?step=10");
  const momC = JSON.parse(await state());
  check("9b: parked on mom-c (?step=10)", momC.step === 10 && momC.locked === false, JSON.stringify(momC));
  const rail = JSON.parse(await evalJson(`JSON.stringify((() => {
    const railR = document.querySelector('#rail').getBoundingClientRect();
    const ticks = [...document.querySelectorAll('#rail button')].map((b) => {
      const r = b.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, h: r.height, cx: r.left + r.width / 2 };
    });
    return { railH: railR.height, vh: window.innerHeight, ticks };
  })())`));
  const frac = rail.railH / rail.vh;
  check(
    "9b: the rail spans ~3/4 of the reader panel height (0.72–0.78 of the viewport)",
    frac >= 0.72 && frac <= 0.78,
    `railH=${rail.railH} vh=${rail.vh} frac=${frac.toFixed(3)}`,
  );
  const contiguous = rail.ticks.every((t, i) =>
    t.h >= 14 && (i === 0 || Math.abs(t.top - rail.ticks[i - 1].bottom) <= 1),
  );
  check(
    "9b: tick cells are contiguous (no dead gaps) and ≥14px tall",
    contiguous === true,
    `first=${JSON.stringify(rail.ticks[0])} last=${JSON.stringify(rail.ticks[rail.ticks.length - 1])}`,
  );

  // Real CDP clicks at fractions of the span between tick centers 11|12.
  const a = rail.ticks[11];
  const b = rail.ticks[12];
  // Fractions run between the DASH CENTERS (the visual ticks), not the
  // cell rect tops — nearest-dash semantics is what the reader feels.
  const cA = a.top + a.h / 2;
  const cB = b.top + b.h / 2;
  const clickY = (f) => cA + (cB - cA) * f;
  const clickX = a.cx;
  const railClick = async (f) => {
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: clickX, y: clickY(f), button: "left", buttons: 1, clickCount: 1, pointerType: "mouse" });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: clickX, y: clickY(f), button: "left", buttons: 0, clickCount: 1, pointerType: "mouse" });
    await sleep(150);
    const during = JSON.parse(await state());
    await evalJson(`window.__wp1.skip()`);
    await sleep(600);
    const after = JSON.parse(await state());
    return { during, after };
  };
  const r30 = await railClick(0.3);
  check(
    "9b: a click at 30% between ticks 11|12 lands on the closer step (11)",
    r30.after.step === 11 && r30.during.step === 11,
    `during=${r30.during.step} after=${r30.after.step}`,
  );
  const r70 = await railClick(0.7);
  check(
    "9b: a click at 70% between ticks 11|12 lands on the closer step (12)",
    r70.after.step === 12 && r70.during.step === 12,
    `during=${r70.during.step} after=${r70.after.step}`,
  );
  const r50 = await railClick(0.5);
  check(
    "9b: a click at the EXACT midpoint between two ticks still lands on a step (11 or 12)",
    r50.after.step === 11 || r50.after.step === 12,
    `after=${r50.after.step}`,
  );
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: clickX, y: clickY(0.5), buttons: 0, pointerType: "mouse" });
  await sleep(120);
  const near = await evalJson(`JSON.stringify([...document.querySelectorAll('#rail button')].map((b, i) => b.hasAttribute('data-near') ? i : -1).filter((i) => i >= 0))`);
  check(
    "9b: hovering between ticks transiently highlights the nearest tick ([data-near])",
    near === "[11]" || near === "[12]",
    `near=${near}`,
  );
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 100, y: 100, buttons: 0, pointerType: "mouse" });
  await sleep(120);
  const nearLeft = await evalJson(`JSON.stringify([...document.querySelectorAll('#rail button')].filter((b) => b.hasAttribute('data-near')).length)`);
  check("9b: leaving the rail clears the transient highlight", nearLeft === "0", `near=${nearLeft}`);
  await waitUnlocked();
}
/* ---- 10. ?step / ?shot still deterministic -------------------------------- */
await send("Page.navigate", { url: `${base}/?step=5` });
await sleep(4500);
const st5 = JSON.parse(await evalJson(`JSON.stringify({
  scene: window.__wp1.scene(), step: window.__wp1.step(),
  scroll: window.__wp1.scroll(),
})`));
check(
  "?step=5 lands on gd-b with the document parked on its page",
  st5.scene === "gd-b" && st5.step === 5 && st5.scroll.parked === true &&
    Math.abs(st5.scroll.y - st5.scroll.tops[5]) <= 2,
  JSON.stringify(st5),
);

await send("Page.navigate", { url: `${base}/?shot=lab` });
await sleep(6500);
const shotLab = JSON.parse(await evalJson(`JSON.stringify({
  scene: window.__wp1.scene(),
  step: window.__wp1.step(),
  E: window.__wp1.lab().E,
  lit: [...document.querySelectorAll('#lab-checklist li')].map((li) => li.dataset.lit).join(","),
  scroll: window.__wp1.scroll(),
})`));
check(
  "?shot=lab renders deterministically under the v4 reader (document parked)",
  shotLab.scene === "lab" && shotLab.E === 50 && shotLab.lit === "true,true,true" &&
    shotLab.scroll.parked === true,
  JSON.stringify(shotLab),
);

/* ---- 12. stepper-lock regressions (Sweep & Clear findings) ----------------
 * One check per reported case: KW-8 (a fling outlasting the lock carried on
 * into further steps), the same fast wheel blowing straight through the
 * unlocked same-scene steps (14, 19), a spin held through a RAIL-JUMP lock,
 * F16-RAIL-CHIP-WHEEL-DEAD / KW-6 (wheel over the rail / counter chip did
 * nothing), KW-7 (Ctrl+wheel advanced steps), F16-DELTAMODE-DEAD (line-mode
 * wheels were dropped), plus rail jumps engaging the lock and paced notches
 * still accumulating (the guard must not stall normal scrolling). Pre-fix
 * numbers from tools/probe-stepper-lock.mjs: fling 4→11, fast wheel 13→16
 * and 18→21, rail-lock spin 8→11, rail/chip wheel inert, Ctrl+wheel 4→5. */
async function land(q) {
  await send("Page.navigate", { url: `${base}/${q}` });
  await sleep(4000);
  const t0 = Date.now();
  while (Date.now() - t0 < 15000) {
    const s = JSON.parse(await state());
    if (!s.locked && !s.animating) break;
    await sleep(150);
  }
  await sleep(400); // a fresh gesture: nothing armed from the boot
}
async function waitUnlocked(ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const s = JSON.parse(await state());
    if (!s.locked && !s.animating) return s;
    await sleep(120);
  }
  return JSON.parse(await state());
}
const centerOf = async (sel) => {
  const r = JSON.parse(await evalJson(`JSON.stringify(document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect())`));
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
};

// 12a. KW-8: one long fling across a lock enters exactly ONE step.
await land("?step=4");
{
  let sawLock = false;
  for (let i = 0; i < 70; i++) {
    await wheel(READER_X, Y, 120);
    await sleep(50);
    if (i % 7 === 6 && JSON.parse(await state()).locked) sawLock = true;
  }
  await sleep(300);
  const s = JSON.parse(await state());
  check(
    "KW-8: a fling outlasting the entry lock enters ONE step (no carry-over after unlock)",
    s.step === 5 && sawLock,
    `final ${JSON.stringify(s)} (pre-fix: 4→11); locked during fling=${sawLock}`,
  );
  // The guard is gesture-scoped: after an idle pause a new gesture advances.
  await waitUnlocked();
  await sleep(300);
  await wheelBurst(READER_X, Y, await notchesToCross(5), 120);
  await sleep(140);
  const s2 = JSON.parse(await state());
  check(
    "after the fling, a NEW gesture (idle pause) advances normally",
    s2.step === 6,
    JSON.stringify(s2),
  );
}

// 12b. Fast wheel through the unlocked same-scene steps stops on them.
for (const [from, to] of [[13, 14], [18, 19]]) {
  await land(`?step=${from}`);
  for (let i = 0; i < 30; i++) {
    await wheel(READER_X, Y, 120);
    await sleep(40);
  }
  await sleep(250);
  const s = JSON.parse(await state());
  const sc = JSON.parse(await scrollState());
  check(
    `fast wheel from step ${from} stops on the unlocked same-scene step ${to} (one boundary per gesture)`,
    s.step === to && sc.parked === true && Math.abs(sc.y - sc.tops[to]) <= 2,
    `state=${JSON.stringify(s)} (pre-fix: ${from}→${from + 3})`,
  );
}

// 12c. A spin held through a RAIL-JUMP lock does not resume after it.
await land("?step=0");
{
  await evalJson(`document.querySelectorAll('#rail button')[8].click()`);
  await sleep(80);
  const during = JSON.parse(await state());
  for (let i = 0; i < 40; i++) {
    await wheel(READER_X, Y, 120);
    await sleep(60);
  }
  await sleep(300);
  const s = JSON.parse(await state());
  check(
    "rail jump: the jump locks, and a spin held through that lock does not carry on after it",
    during.step === 8 && during.locked === true && s.step === 8,
    `during=${JSON.stringify(during)} final=${JSON.stringify(s)} (pre-fix: 8→11)`,
  );
}

// 12d. Rail jumps engage the lock wherever the target scene animates in.
await land("?step=0");
{
  const res = [];
  for (const k of [3, 6, 9, 12, 15, 17, 20, 21, 24, 26]) {
    await evalJson(`document.querySelectorAll('#rail button')[${k}].click()`);
    await sleep(60);
    const s = JSON.parse(await state());
    res.push({ k, step: s.step, locked: s.locked, animating: s.animating });
    await waitUnlocked();
    await sleep(150);
  }
  check(
    "rail far jumps forward land on the tick and lock while the entry animates",
    res.every((r) => r.step === r.k && r.locked === r.animating && r.locked === true),
    JSON.stringify(res),
  );
}

// 12e. F16-RAIL-CHIP-WHEEL-DEAD / KW-6: wheel over the rail and the chip.
await land("?step=2");
{
  const railC = await centerOf("#rail");
  await wheelBurst(railC.x, railC.y, await notchesToCross(2), 120);
  await sleep(140);
  const s1 = JSON.parse(await state());
  check(
    "wheel over the progress RAIL scrolls the reader (enters the next step, locks)",
    s1.step === 3 && s1.locked === true,
    `${JSON.stringify(s1)} at ${JSON.stringify(railC)} (pre-fix: inert)`,
  );
  // While locked, rail wheels are dropped like the reader's.
  await wheelBurst(railC.x, railC.y, 3, 120);
  const sLock = JSON.parse(await state());
  check("rail wheel during the lock is dropped", sLock.step === 3, JSON.stringify(sLock));
  await waitUnlocked();
  await sleep(300);
  const chipC = await centerOf("#reader-chip");
  await wheelBurst(chipC.x, chipC.y, await notchesToCross(3), 120);
  await sleep(140);
  const s2 = JSON.parse(await state());
  check(
    "wheel over the counter CHIP scrolls the reader too",
    s2.step === 4,
    `${JSON.stringify(s2)} at ${JSON.stringify(chipC)} (pre-fix: inert)`,
  );
  await waitUnlocked();
}

// 12f. KW-7: Ctrl+wheel never advances the stepper (page zoom is the browser's).
await land("?step=4");
{
  for (let i = 0; i < 8; i++) {
    await send("Input.dispatchMouseEvent", {
      type: "mouseWheel", x: READER_X, y: Y, deltaX: 0, deltaY: 120, modifiers: 2, pointerType: "mouse",
    });
    await sleep(40);
  }
  await sleep(300);
  const s = JSON.parse(await state());
  const sc = JSON.parse(await scrollState());
  check(
    "KW-7: Ctrl+wheel over the reader does not move the reader",
    s.step === 4 && sc.target === sc.tops[4],
    `${JSON.stringify(s)} target=${sc.target} (pre-fix: 4→5)`,
  );
}

// 12g. F16-DELTAMODE-DEAD: line-mode wheels advance like pixel wheels.
{
  const res = await evalJson(`(() => {
    const ev = new WheelEvent("wheel", { deltaY: 20, deltaMode: 1, bubbles: true, cancelable: true });
    document.querySelector("#reader-body").dispatchEvent(ev);
    return ev.defaultPrevented;
  })()`);
  await sleep(160);
  const s = JSON.parse(await state());
  check(
    "line-mode (deltaMode 1) wheel is normalized and advances one step",
    res === true && s.step === 5,
    `prevented=${res} ${JSON.stringify(s)}`,
  );
  await waitUnlocked();
}

// 12h. The guard must not stall paced scrolling: notches 250 ms apart
// accumulate across the boundary (QA IMP-1: no idle snap-back).
await sleep(300);
{
  const n = await notchesToCross(5);
  for (let i = 0; i < n; i++) {
    await wheel(READER_X, Y, 120);
    await sleep(250);
  }
  await sleep(100);
  const s = JSON.parse(await state());
  check(
    "paced notches (250 ms apart) still accumulate into the next step",
    s.step === 6,
    `${n} notches -> ${JSON.stringify(s)}`,
  );
}

/* ---- 13. interaction v5 regressions (user feedback 2026-11-13) -----------
 * 13a. a plain click on reader text does NOT advance (progression is wheel /
 *      Space / ArrowDown / the continue hint / Skip / the rail ticks); text
 *      selection still works; the continue hint (a real button) advances.
 * 13b. a held ArrowDown (OS auto-repeat) advances exactly ONE step per burst.
 * 13c. forward entry into the no-entry-animation same-scene steps 14/19/23
 *      (the 2nd lab / tilt-a / labrule pages) LOCKS while nothing animates,
 *      then auto-unlocks (~350 ms).
 * 13d. the last step (26, epi-c) parks and stays: forward wheel past the
 *      final park is a no-op — no dead scroll zone below the last page —
 *      and wheeling up still re-enters step 25.
 */

// 13a. click-on-text is inert; selection still works; the hint advances.
await land("?step=4");
{
  const p = JSON.parse(await evalJson(`JSON.stringify((() => {
    const el = document.querySelector('.rstep[data-active="true"] p');
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })())`));
  for (const type of ["mousePressed", "mouseReleased"]) {
    await send("Input.dispatchMouseEvent", {
      type, x: p.x, y: p.y, button: "left", clickCount: 1, pointerType: "mouse",
    });
  }
  await sleep(600);
  const s = JSON.parse(await state());
  check(
    "v5-CLICK: a plain click on reader text does not advance (and does not lock)",
    s.step === 4 && s.locked === false,
    `state=${JSON.stringify(s)} click at ${JSON.stringify(p)}`,
  );

  // Text selection still works: drag across the active heading.
  const h = JSON.parse(await evalJson(`JSON.stringify((() => {
    const r = document.querySelector('.rstep[data-active="true"] h2').getBoundingClientRect();
    return { x1: Math.round(r.left + 10), x2: Math.round(r.right - 10), y: Math.round(r.top + r.height / 2) };
  })())`));
  await send("Input.dispatchMouseEvent", {
    type: "mousePressed", x: h.x1, y: h.y, button: "left", clickCount: 1, pointerType: "mouse",
  });
  for (let x = h.x1 + 24; x <= h.x2; x += 24) {
    await send("Input.dispatchMouseEvent", {
      type: "mouseMoved", x, y: h.y, button: "left", buttons: 1, pointerType: "mouse",
    });
    await sleep(12);
  }
  await send("Input.dispatchMouseEvent", {
    type: "mouseReleased", x: h.x2, y: h.y, button: "left", clickCount: 1, pointerType: "mouse",
  });
  const selLen = await evalJson(`window.getSelection().toString().length`);
  check(
    "v5-CLICK: text selection still works",
    selLen > 0,
    `selection length=${selLen}`,
  );
  await evalJson(`(() => { window.getSelection().removeAllRanges(); return true; })()`);

  // The continue hint (a real button) still advances.
  await waitUnlocked();
  await sleep(300);
  const hintC = await centerOf("#continue-hint");
  for (const type of ["mousePressed", "mouseReleased"]) {
    await send("Input.dispatchMouseEvent", {
      type, x: hintC.x, y: hintC.y, button: "left", clickCount: 1, pointerType: "mouse",
    });
  }
  await sleep(150);
  const sHint = JSON.parse(await state());
  check(
    "v5-CLICK: the continue hint (button) still advances",
    sHint.step === 5,
    JSON.stringify(sHint),
  );
  await waitUnlocked();
}

// 13b. held ArrowDown (OS auto-repeat) advances exactly ONE step per burst.
await land("?step=4");
{
  // Passive observer: proves the burst's keyDowns actually arrive with
  // repeat=true (CDP autoRepeat -> DOM KeyboardEvent.repeat), so the next
  // check discriminates the guard, not a mis-driven burst.
  await evalJson(`(() => {
    window.__v5rep = { total: 0, lastRepeat: null };
    window.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowDown") return;
      window.__v5rep.total += 1;
      window.__v5rep.lastRepeat = e.repeat;
    });
    return true;
  })()`);
  const arrow = (type, repeat) =>
    send("Input.dispatchKeyEvent", {
      type, key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40,
      autoRepeat: repeat === true,
    });
  await arrow("keyDown", false); // the physical press
  await sleep(140);
  const first = JSON.parse(await state());
  // ~5 s of OS auto-repeat at a ~66 ms cadence (a real held key). Without
  // the guard, every repeat landing in an unlocked window advances again.
  for (let i = 0; i < 75; i++) {
    await arrow("keyDown", true);
    await sleep(66);
  }
  await arrow("keyUp", false);
  const rep = JSON.parse(await evalJson(`JSON.stringify(window.__v5rep)`));
  const settled = await waitUnlocked();
  check(
    "v5-ARROW: the physical ArrowDown press advances one step (and locks)",
    first.step === 5 && first.locked === true,
    JSON.stringify(first),
  );
  check(
    "v5-ARROW: a ~5s held ArrowDown advances exactly ONE step (no repeat carry)",
    rep.total > 10 && rep.lastRepeat === true &&
      settled.step === 5 && settled.locked === false,
    `keyDowns=${rep.total} lastRepeat=${rep.lastRepeat} final=${JSON.stringify(settled)} (unguarded sails past 5)`,
  );
}

// 13c. forward entry into the no-animation same-scene steps 14/19/23 locks.
{
  const res = [];
  for (const from of [13, 18, 22]) {
    await land(`?step=${from}`);
    await wheelBurst(READER_X, Y, await notchesToCross(from), 120);
    // Capture the entry the moment the step flips: the tight sample loop
    // detects it within ~30ms of the crossing, well inside the ~350ms
    // no-animation auto-unlock window.
    let entry = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 3000) {
      const s = JSON.parse(await state());
      if (s.step === from + 1) { entry = s; break; }
      await sleep(12);
    }
    const un = await waitUnlocked();
    res.push({
      from, to: from + 1,
      entered: entry !== null,
      lockedAtEntry: entry?.locked === true,
      animatingAtEntry: entry?.animating ?? null,
      unlocked: un.locked === false && un.animating === false && un.step === from + 1,
    });
    await sleep(250);
  }
  check(
    "v5-LOCK: forward entry into the no-animation steps 14/19/23 locks while nothing animates, then auto-unlocks",
    res.every((r) => r.entered && r.lockedAtEntry && r.animatingAtEntry === false && r.unlocked),
    JSON.stringify(res),
  );
}

// 13d. the last step parks and stays; the park is not a trap.
await land("?step=26");
{
  const before = JSON.parse(await scrollState());
  await wheelBurst(READER_X, Y, 16, 120); // ~1920px of downward wheel on the final park
  await sleep(400);
  const s = JSON.parse(await state());
  const sc = JSON.parse(await scrollState());
  check(
    "v5-LAST: the last step parks and stays — forward wheel past the final park is a no-op",
    s.step === 26 && sc.target === sc.tops[26] && sc.parked === true &&
      Math.abs(sc.y - sc.tops[26]) <= 2,
    `maxScroll=${before.max} lastPark=${before.tops[26]} after=${JSON.stringify(sc)}`,
  );
  await wheelBurst(READER_X, Y, await notchesToCross(25), -120);
  await sleep(200);
  const up = JSON.parse(await state());
  check(
    "v5-LAST: wheeling up from the last park re-enters step 25",
    up.step === 25,
    JSON.stringify(up),
  );
  await waitUnlocked();
  // Second phase at a SHORT viewport: when the final page overflows the
  // pane (epi-c at 650px), maxScroll runs past the last park — the dead
  // zone the overshoot fix removes. The target must still cap on the last
  // park (the probe tools/diag-v5-lastpark-probe.mjs measured the zone at
  // 4px here; pre-fix the target parked on maxScroll past the step).
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1600, height: 650, deviceScaleFactor: 1, mobile: false,
  });
  await land("?step=26"); // fresh boot parked on the last step at 650px
  {
    const b2 = JSON.parse(await scrollState());
    await wheelBurst(READER_X, Y, 16, 120);
    await sleep(400);
    const sc2 = JSON.parse(await scrollState());
    const last = b2.tops.length - 1;
    check(
      "v5-LAST: short viewport (overflowing last page) — the wheel target still caps on the last park",
      sc2.target === sc2.tops[last] && Math.abs(sc2.y - sc2.tops[last]) <= 2,
      `deadZone(maxScroll−lastPark)=${b2.max - b2.tops[last]}px target=${sc2.target} lastPark=${sc2.tops[last]} y=${sc2.y}`,
    );
  }
}

// 13e. IMP-1-ARROWUP-REPEAT-SAIL: a held ArrowUp backs exactly ONE step.
// The ArrowDown/Space guards swallow auto-repeats; ArrowUp lacked the same
// guard and a ~1s hold sailed 12→0 and re-expanded the intro.
await land("?step=4");
{
  const up = (type, repeat) =>
    send("Input.dispatchKeyEvent", {
      type, key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38,
      autoRepeat: repeat === true,
    });
  await up("keyDown", false); // the physical press
  await sleep(140);
  const first = JSON.parse(await state());
  // ~4 s of OS auto-repeat at a ~66 ms cadence. Unguarded, the repeats walk
  // the reader back to step 0 and re-expand the full-bleed intro.
  for (let i = 0; i < 60; i++) {
    await up("keyDown", true);
    await sleep(66);
  }
  await up("keyUp", false);
  const settled = JSON.parse(await state());
  await sleep(400);
  const after = JSON.parse(await scrollState());
  check(
    "IMP-1: the physical ArrowUp press steps back one (instant, no re-lock)",
    first.step === 3 && first.locked === false,
    JSON.stringify(first),
  );
  check(
    "IMP-1: a ~4s held ArrowUp backs exactly ONE step (no repeat sail)",
    settled.step === 3 && after.intro === false,
    `held ${JSON.stringify(settled)} scroll=${JSON.stringify({ intro: after.intro, target: after.target, top4: after.tops[3] })} (unguarded sails to 0 + intro)`,
  );
}

/* ---- 14. tour v2 regressions (WP1 click inertness + wheel-stays-master) --
 * 14a. starting a tour from a mid-section page seeds the walk at the
 *      playlist HEAD and travels the reader back to the section's first
 *      tour page (U4-START-TRAVEL, tourEngine.start); the head sentence's
 *      gate arms. The controller reports the section playlist.
 * 14b. a plain click on reader text during a tour advances NOTHING (tour
 *      sentence, reader step, lock all unchanged — the WP1 contract holds
 *      with the tour overlay up).
 * 14c. the visitor's action is the way through the head gate (the inset
 *      drag releases it onto task-a's loss sentence); Space walks one
 *      sentence tour-locally (the tour pages the reader to the sentence's
 *      page); ArrowUp backs one across the page boundary, instantly,
 *      no re-lock.
 * 14d. the wheel stays master: wheeling forward pages the reader and the
 *      controller syncs to the new page's first registered sentence; the
 *      wheel past the section's last page exits the tour cleanly.
 * 14e. after the exit the reader still advances (no lock left behind).
 */
await land("?step=2");
{
  const tour = () => evalJson(`JSON.stringify(window.__wp1.tour())`);
  const waitTourPred = async (pred, maxMs = 15000, label = "tour state") => {
    const t0 = Date.now();
    let t = null;
    for (;;) {
      t = JSON.parse(await tour());
      if (pred(t)) return t;
      if (Date.now() - t0 > maxMs) {
        console.log(`  (timeout waiting for ${label}: ${t})`);
        return t;
      }
      await sleep(150);
    }
  };
  /** Drags the §1 fit line BODY in the inset (the FitPreview.hitMode math:
   *  margins M, plot window X/Y_MIN·MAX; xData 0.2 sits between the handles
   *  −3.7..4.1, and the start point sits ON the line). The head sentence's
   *  fitMoved gate demands exactly this visitor action (main.ts
   *  gateSatisfied: any (w, b) change releases it). */
  const dragFitLine = async (dyPx = 42) => {
    const p = JSON.parse(await evalJson(`JSON.stringify((() => {
      const r = document.querySelector("#fit-canvas").getBoundingClientRect();
      const M = { l: 30, r: 12, t: 10, b: 22 };
      const X_MIN = -4.2, X_MAX = 4.6, Y_MIN = -2.1, Y_MAX = 5.7;
      const f = window.__wp1.fit();
      const xData = 0.2;
      const px = M.l + ((xData - X_MIN) / (X_MAX - X_MIN)) * (r.width - M.l - M.r);
      const py = r.height - M.b - ((f.w * xData + f.b - Y_MIN) / (Y_MAX - Y_MIN)) * (r.height - M.t - M.b);
      return { x: Math.round(r.left + px), y: Math.round(r.top + py) };
    })())`));
    await send("Input.dispatchMouseEvent", {
      type: "mousePressed", x: p.x, y: p.y, button: "left", buttons: 1, clickCount: 1, pointerType: "mouse",
    });
    for (let i = 1; i <= 6; i++) {
      await send("Input.dispatchMouseEvent", {
        type: "mouseMoved", x: p.x, y: p.y + Math.round((dyPx * i) / 6), button: "left", buttons: 1, pointerType: "mouse",
      });
      await sleep(16);
    }
    await send("Input.dispatchMouseEvent", {
      type: "mouseReleased", x: p.x, y: p.y + dyPx, button: "left", buttons: 0, clickCount: 1, pointerType: "mouse",
    });
  };
  await evalJson(`document.querySelector('#tour-entry').click()`);
  const t0 = await waitTourPred((t) => t.running && t.phase === "active", 12000, "tour start");
  const s0 = JSON.parse(await state());
  check(
    "FIX-4b TOUR-V2: a mid-section chip click starts AT the parked step (task-b needle, no travel, no gate)",
    t0.running === true && t0.id === "s1" && t0.stepIndex === 2 && t0.count === 4 &&
      t0.page === 2 && t0.lookKey === "needle" && t0.gate === false &&
      s0.scene === "task-b" && s0.step === 2,
    `tour=${JSON.stringify(t0)} app=${JSON.stringify(s0)}`,
  );

  // 14b. plain click on the active heading: nothing moves.
  const h = JSON.parse(await evalJson(`JSON.stringify((() => {
    const r = document.querySelector('.rstep[data-active="true"] h2').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })())`));
  for (const type of ["mousePressed", "mouseReleased"]) {
    await send("Input.dispatchMouseEvent", {
      type, x: h.x, y: h.y, button: "left", clickCount: 1, pointerType: "mouse",
    });
  }
  await sleep(500);
  const tClick = JSON.parse(await tour());
  const sClick = JSON.parse(await state());
  check(
    "TOUR-V2: a plain click during the tour advances nothing (tour + reader + lock)",
    tClick.stepIndex === 2 && sClick.step === 2 && sClick.locked === false,
    `tour=${JSON.stringify(tClick)} app=${JSON.stringify(sClick)}`,
  );

  // 14c. the head gate holds the walk (Space/ArrowUp are swallowed while it
  // waits — gate-tour §1 pins the swallow); the visitor's inset drag
  // releases it — the action IS the way through, onto the loss sentence.
  // 14c (FIX-4b/c). The parked needle sentence carries no gate; Next
  // pages the reader FORWARD onto the ball gate (task-c), which arms on
  // arrival. ArrowUp (Back) DURING the armed gate reverses + disarms —
  // never swallowed — back to the needle sentence with no lock; Space
  // forward re-arms the gate on the fresh arrival.
  await evalJson(`document.querySelector('#tour-next').click()`);
  const tRel = await waitTourPred((t) => t.phase === "active" && t.stepIndex === 3 && t.gate === true, 15000, "ball gate");
  check(
    "FIX-4b TOUR-V2: Next pages the reader forward onto the ball gate (task-c, gate armed)",
    tRel.stepIndex === 3 && tRel.page === 3 && tRel.gate === true && tRel.lookKey === "ball",
    JSON.stringify(tRel),
  );
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 });
  const tBack = await waitTourPred((t) => t.phase === "active" && t.stepIndex === 2 && t.gate === false, 15000, "ArrowUp during the gate");
  const sBack = JSON.parse(await state());
  check(
    "FIX-4c TOUR-V2: ArrowUp during an armed gate reverses + disarms (task-b needle)",
    tBack.stepIndex === 2 && tBack.gate === false && sBack.scene === "task-b" && sBack.locked === false,
    `tour=${JSON.stringify(tBack)} app=${JSON.stringify(sBack)}`,
  );
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
  const tRe = await waitTourPred((t) => t.phase === "active" && t.stepIndex === 3 && t.gate === true, 15000, "gate re-arm");
  check(
    "FIX-4c TOUR-V2: Space forward re-arms the ball gate on the fresh arrival",
    tRe.stepIndex === 3 && tRe.gate === true,
    JSON.stringify(tRe),
  );

  // Reposition for 14d: ArrowUp backs the walk off the armed gate — the
  // FIX-4c reversal lands on the task-b needle sentence (idx 2, page 2,
  // disarmed, no lock), the park the wheel-sync beat expects upstream of
  // its burst (the post-FIX-4c flow is already ON task-c here; wheeling
  // forward from page 3 would exit the section and strand 14d on gd-a).
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 });
  const tPos = await waitTourPred((t) => t.phase === "active" && t.stepIndex === 2 && t.gate === false, 15000, "back off the gate");
  const sPos = JSON.parse(await state());
  check(
    "FIX-4c TOUR-V2: ArrowUp backs the walk off the armed gate (task-b needle, disarmed)",
    tPos.stepIndex === 2 && tPos.gate === false && sPos.scene === "task-b" && sPos.locked === false,
    `tour=${JSON.stringify(tPos)} app=${JSON.stringify(sPos)}`,
  );

  // 14d. the wheel stays master: forward inside the section → the reader
  // pages and the controller syncs (task-c's ball gate opens on arrival);
  // forward past the section → clean exit.
  await wheelBurst(READER_X, Y, await notchesToCross(2), 120);
  const tSync = await waitTourPred(
    (t) => t.running && t.phase === "active" && t.page === 3 && t.stepIndex === 3 && t.gate === true,
    15000,
    "wheel sync",
  );
  const sSync = JSON.parse(await state());
  check(
    "TOUR-V2: wheel forward pages the reader (task-c) and the controller syncs + opens the gate",
    sSync.step === 3 && tSync.running === true && tSync.page === 3 && tSync.stepIndex === 3 && tSync.gate === true,
    `tour=${JSON.stringify(tSync)} app=${JSON.stringify(sSync)}`,
  );
  // While that gate is open, ArrowUp is swallowed (the action is the way
  // through) — the sentence and the reader stay put.
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 });
  const tGate = await waitTourPred((t) => t.phase === "active" && t.stepIndex === 2 && t.gate === false, 15000, "gate ArrowUp");
  const sGate = JSON.parse(await state()); // sample at the REVERSAL, before the re-arm
  // Space forward: the gate re-arms (the wheel-out beat starts from task-c).
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
  await waitTourPred((t) => t.phase === "active" && t.stepIndex === 3 && t.gate === true, 15000, "gate re-arm 2");
  check(
    "FIX-4c TOUR-V2: ArrowUp during an armed gate reverses + disarms it",
    tGate.stepIndex === 2 && tGate.gate === false && sGate.scene === "task-b" && sGate.locked === false,
    `tour=${JSON.stringify(tGate)} app=${JSON.stringify(sGate)}`,
  );
  await waitUnlocked();
  await sleep(300);
  await wheelBurst(READER_X, Y, await notchesToCross(3), 120);
  await sleep(400);
  const tOut = JSON.parse(await tour());
  const sOut = JSON.parse(await state());
  check(
    "TOUR-V2: wheel past the section's last page exits the tour cleanly (reader on gd-a)",
    tOut.running === false && sOut.step === 4,
    `tour=${JSON.stringify(tOut)} app=${JSON.stringify(sOut)}`,
  );

  // 14e. the reader is free afterwards (no lock left behind).
  await waitUnlocked();
  await sleep(300);
  await wheelBurst(READER_X, Y, await notchesToCross(4), 120);
  await sleep(140);
  const sFree = JSON.parse(await state());
  check(
    "TOUR-V2: the reader still advances after the tour exit (→ gd-b)",
    sFree.step === 5 && sFree.locked === true,
    JSON.stringify(sFree),
  );
  await waitUnlocked();
}

/* ---- 11. regressions ------------------------------------------------------ */
ws.close();
proc.kill();
try {
  rmSync(profile, { recursive: true, force: true });
} catch {}
console.log("§1–§3 regression suite follows (cdp-interact-wp3.mjs):");
let status = 0;
{
  const { execFileSync } = await import("node:child_process");
  try {
    const out = execFileSync(process.execPath, ["tools/cdp-interact-wp3.mjs", base], {
      encoding: "utf8",
      timeout: 600000,
    });
    process.stdout.write(out);
  } catch (e) {
    process.stdout.write(String(e.stdout ?? e.message));
    status = 1;
  }
}
process.exit(failures === 0 && status === 0 ? 0 : 1);
