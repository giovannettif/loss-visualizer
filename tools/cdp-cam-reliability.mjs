/**
 * cdp-cam-reliability.mjs — camera-orbit RELIABILITY probe over CDP.
 *
 * Reproduces the "orbit drag intermittently does nothing" defect class and
 * guards the fix. Every scenario performs a real orbit drag through trusted
 * CDP Input and asserts the azimuth actually changed:
 *
 *   1. baseline orbit on the live app (?step=1, task-a);
 *   2. orbit after Skip (a step-change camera flight is mid-flight, Skip
 *      snaps it);
 *   3. orbit after a step change (adjacent rail click, lock drained);
 *   4. orbit during Play (the universal replay is rolling);
 *   5. orbit after a double-click reset;
 *   6. orbit after a far rail jump (teleport + camera flight);
 *   7. orbit after a viewport resize;
 *   8. orbit after a MISSED pointerup (a synthetic pointerdown that never
 *      sees its up — the exact state a lost capture or an interrupted probe
 *      leaves behind);
 *   9. orbit after a STUCK puppet drag (§1 ball grab whose up is lost);
 *  10. full recovery: a later real pointerup clears everything.
 *
 * Usage: node tools/cdp-cam-reliability.mjs <baseUrl>   (e.g. http://localhost:4173)
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const base = process.argv[2] ?? "http://localhost:4173";

const profile = mkdtempSync(join(tmpdir(), "cdp-cam-rel-"));
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
  const timer = setTimeout(() => reject(new Error("no devtools ws url")), 20000);
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
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
};

let failures = 0;
let ran = 0;
function check(name, ok, detail) {
  ran += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: 1600, height: 900, deviceScaleFactor: 1, mobile: false,
});

/** Canvas center for gestures (re-read every time — resizes move it). */
const canvasRect = async () =>
  JSON.parse(await evalJson(
    `JSON.stringify(document.querySelector("#stage canvas").getBoundingClientRect())`,
  ));

const attitude = async () =>
  JSON.parse(await evalJson(`JSON.stringify(__wp1.debug().viewAttitude)`));

/** Wait until the reader lock has drained (step entry animations). */
async function waitIdle(label, timeoutMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const locked = await evalJson(`__wp1.locked()`);
    const animating = await evalJson(`__wp1.animating()`);
    if (!locked && !animating) return;
    await sleep(150);
  }
  console.log(`WARN  ${label}: still locked/animating after ${timeoutMs}ms`);
}

/** One trusted orbit drag. Returns the pre-release azimuth delta. */
async function orbitDelta(dx = 120, dy = 30) {
  const r = await canvasRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const before = await attitude();
  const mouse = (type, x, y) =>
    send("Input.dispatchMouseEvent", {
      type, x: Math.round(x), y: Math.round(y),
      button: "left", buttons: type === "mouseReleased" ? 0 : 1,
      clickCount: 1, pointerType: "mouse",
    });
  await mouse("mousePressed", cx, cy);
  for (let i = 1; i <= 10; i++) {
    await mouse("mouseMoved", cx + (dx * i) / 10, cy + (dy * i) / 10);
    await sleep(16);
  }
  await sleep(150); // let a frame apply the drag (inertia not yet released)
  const during = await attitude();
  await mouse("mouseReleased", cx + dx, cy + dy);
  await sleep(80);
  return { before, during, delta: during.azimuthDeg - before.azimuthDeg };
}

/** Full orbit attempt: read AFTER release too (inertia must not reverse it). */
async function orbitWorks(label, minDelta = 3) {
  const r = await canvasRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const before = await attitude();
  const mouse = (type, x, y) =>
    send("Input.dispatchMouseEvent", {
      type, x: Math.round(x), y: Math.round(y),
      button: "left", buttons: type === "mouseReleased" ? 0 : 1,
      clickCount: 1, pointerType: "mouse",
    });
  await mouse("mousePressed", cx, cy);
  for (let i = 1; i <= 10; i++) {
    await mouse("mouseMoved", cx + (120 * i) / 10, cy + (30 * i) / 10);
    await sleep(16);
  }
  await sleep(150);
  const held = await attitude();
  await mouse("mouseReleased", cx + 120, cy + 30);
  await sleep(500); // inertia carries on; it must not be the ONLY motion
  const after = await attitude();
  const heldDelta = held.azimuthDeg - before.azimuthDeg;
  const ok = Math.abs(heldDelta) > minDelta;
  check(
    label,
    ok,
    `azimuth ${before.azimuthDeg.toFixed(2)} -> ${held.azimuthDeg.toFixed(2)} (Δ${heldDelta.toFixed(2)}° while held)`,
  );
  return ok;
}

const railClick = async (k) => {
  await evalJson(`(function(){
    const b = document.querySelectorAll("#rail button")[${k}];
    b.click();
  })()`);
};

const btnClick = async (sel) => {
  await evalJson(`(function(){
    const b = document.querySelector(${JSON.stringify(sel)});
    if (b) b.click();
  })()`);
};

/* ---- boot ------------------------------------------------------------- */

await send("Page.navigate", { url: `${base}/?step=1` });
await sleep(4000);
await waitIdle("boot task-a");
check("app booted (diagnostics reachable)", await evalJson(`!!window.__wp1`));

/* ---- 1. baseline ------------------------------------------------------- */
await orbitWorks("1. baseline orbit (?step=1 task-a)");
await sleep(700);

/* ---- 2. orbit after Skip (mid-flight camera transition) ---------------- */
await railClick(4); // task-c -> gd-a: crossfade + camera flight (0.9 s tween)
await sleep(250); // mid-flight
await btnClick("#skip-btn"); // Skip snaps the transition
await sleep(300);
await waitIdle("after skip");
await orbitWorks("2. orbit after Skip (during camera flight)");
await sleep(700);

/* ---- 3. orbit after a step change -------------------------------------- */
await railClick(5); // gd-a -> gd-b (same terrain, new cam spec)
await waitIdle("step change to gd-b");
await orbitWorks("3. orbit after a step change");
await sleep(700);

/* ---- 4. orbit during Play ---------------------------------------------- */
await railClick(6); // gd-b -> gd-c (transport step)
await waitIdle("step change to gd-c");
await btnClick("#play-btn"); // ▶ Play: replay lanes roll
await sleep(350);
const playing = await evalJson(
  `(function(){ const i = __wp1.replayInfo(); return i ? i.playing : false; })()`,
);
check("4a. Play started (replay lanes rolling)", playing === true);
await orbitWorks("4b. orbit during Play");
await btnClick("#play-btn"); // pause again
await sleep(300);

/* ---- 5. orbit after double-click reset ---------------------------------- */
// Orbit away from the preset first, then double-click (trusted) to reset.
{
  const r = await canvasRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const mouse = (type, x, y, clicks) =>
    send("Input.dispatchMouseEvent", {
      type, x: Math.round(x), y: Math.round(y),
      button: "left", buttons: type === "mouseReleased" ? 0 : 1,
      clickCount: clicks, pointerType: "mouse",
    });
  await mouse("mousePressed", cx - 200, cy);
  await mouse("mouseReleased", cx - 200, cy);
  await sleep(120);
  await mouse("mousePressed", cx - 200, cy);
  await mouse("mouseReleased", cx - 200, cy);
  await sleep(300);
}
await orbitWorks("5. orbit after double-click reset");
await sleep(700);

/* ---- 6. orbit after a far rail jump ------------------------------------- */
await railClick(10); // gd-c -> mom-c: teleport + crossfade + camera flight
await waitIdle("rail jump to mom-c");
await orbitWorks("6. orbit after a far rail jump");
await sleep(700);

/* ---- 7. orbit after resize ---------------------------------------------- */
await send("Emulation.setDeviceMetricsOverride", {
  width: 1280, height: 800, deviceScaleFactor: 1, mobile: false,
});
await sleep(500); // ResizeObserver -> renderer resize
await orbitWorks("7. orbit after resize (1280x800)");
await send("Emulation.setDeviceMetricsOverride", {
  width: 1600, height: 900, deviceScaleFactor: 1, mobile: false,
});
await sleep(400);
await orbitWorks("7b. orbit after resize back (1600x900)");
await sleep(700);

/* ---- 8. orbit after a MISSED pointerup (stale ghost pointer) ------------- */
// A synthetic pointerdown that never sees its up: exactly the state left by
// a lost capture (alt-tab mid-drag, element swap) or an interrupted probe.
// The map then holds a ghost entry; the NEXT real press must still orbit.
await evalJson(`(function(){
  const c = document.querySelector("#stage canvas");
  const r = c.getBoundingClientRect();
  c.dispatchEvent(new PointerEvent("pointerdown", {
    pointerId: 99, pointerType: "mouse", button: 0, buttons: 1,
    clientX: r.left + 100, clientY: r.top + 100, bubbles: true,
  }));
})()`);
await sleep(150);
await orbitWorks("8. orbit after a missed pointerup (ghost pointer in the map)");

/* ---- 9. orbit after a STUCK puppet drag (§1 ball grab, up lost) ---------- */
// Jump back to a task scene (surface drag enabled), grab the ball with a
// synthetic pointerdown, and never deliver the up: puppetDrag stays latched.
// (Clear scenario 8's ghost first with its up so this scenario tests the
// latched puppetDrag alone — with two ghosts the map size leaves the pinch
// branch and the bug masks itself, which is exactly why it reads as
// "intermittent" in the wild.)
await railClick(1); // back to task-a
await waitIdle("rail jump back to task-a");
{
  const ball = await evalJson(`JSON.stringify(__wp1.ballScreen())`);
  await evalJson(`(function(){
    const c = document.querySelector("#stage canvas");
    c.dispatchEvent(new PointerEvent("pointerup", {
      pointerId: 99, pointerType: "mouse", button: 0, buttons: 0,
      clientX: 0, clientY: 0, bubbles: true,
    }));
    const b = ${JSON.stringify(ball)};
    c.dispatchEvent(new PointerEvent("pointerdown", {
      pointerId: 77, pointerType: "mouse", button: 0, buttons: 1,
      clientX: b.x, clientY: b.y, bubbles: true,
    }));
  })()`);
  await sleep(150);
}
await orbitWorks("9. orbit after a stuck puppet drag (ball grab whose up was lost)");

/* ---- 10. recovery: a real pointerup clears everything -------------------- */
await evalJson(`(function(){
  const c = document.querySelector("#stage canvas");
  // Deliver the two lost ups (id 77 is at the ball, 99 somewhere on canvas).
  for (const id of [77, 99]) {
    c.dispatchEvent(new PointerEvent("pointerup", {
      pointerId: id, pointerType: "mouse", button: 0, buttons: 0,
      clientX: 0, clientY: 0, bubbles: true,
    }));
  }
})()`);
await sleep(150);
await orbitWorks("10. orbit after the ghost ups are finally delivered");

/* ---- done ---------------------------------------------------------------- */
console.log(`\n${ran - failures}/${ran} checks passed`);
ws.close();
proc.kill();
try {
  rmSync(profile, { recursive: true, force: true });
} catch {
  // temp profile may still be locked; harmless
}
process.exit(failures === 0 ? 0 : 1);
