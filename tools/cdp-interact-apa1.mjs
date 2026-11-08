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
