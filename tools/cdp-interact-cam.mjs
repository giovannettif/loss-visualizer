/**
 * cdp-interact-cam.mjs — CDP gate for the damped-inertial camera rig, run
 * against the deterministic debug page (readouts in #ro-*):
 *
 *   1. drag orbits, OrbitControls sign convention intact;
 *   2. a flick keeps carrying after release (inertia) and decays to rest;
 *   3. wheel zoom EASES: zoomRadius moves over several frames then settles;
 *   4. zoom-scaled sensitivity: the same drag rotates less when zoomed in;
 *   5. double-click resets the attitude to the step default (Isometric)
 *      while leaving the user's zoom alone;
 *   6. a downward flick clamps at 90° pitch and stops (no NaN, no overshoot).
 *
 * Drags and wheels go through CDP Input (trusted events, valid pointers) —
 * same harness style as cdp-interact.mjs.
 *
 * Usage: node tools/cdp-interact-cam.mjs <baseUrl>   (e.g. http://localhost:4173)
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const base = process.argv[2] ?? "http://localhost:4173";

const profile = mkdtempSync(join(tmpdir(), "cdp-interact-cam-"));
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
    ws.send(JSON.stringify({ id: id, method: method, params: params }));
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evalJson = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
  return r.result.value;
};
const wheel = (x, y, deltaY) =>
  send("Input.dispatchMouseEvent", {
    type: "mouseWheel", x: Math.round(x), y: Math.round(y),
    deltaX: 0, deltaY, pointerType: "mouse",
  });

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

await send("Page.navigate", { url: `${base}/debug.html?fn=bowl&cam=iso` });
await sleep(4500);

// Canvas center for gestures.
const rect = JSON.parse(await evalJson(
  `JSON.stringify(document.querySelector("#stage canvas").getBoundingClientRect())`,
));
const CX = rect.left + 700;
const CY = rect.top + 450;

const mouse = (type, x, y) =>
  send("Input.dispatchMouseEvent", {
    type, x: Math.round(x), y: Math.round(y),
    button: "left", buttons: type === "mouseReleased" ? 0 : 1,
    clickCount: 1, pointerType: "mouse",
  });
/** Drag by (dx, dy); if `hold` is true the button stays DOWN (no release). */
async function drag(dx, dy, steps = 12, stepMs = 16, hold = false) {
  await mouse("mousePressed", CX, CY);
  for (let i = 1; i <= steps; i++) {
    await mouse("mouseMoved", CX + (dx * i) / steps, CY + (dy * i) / steps);
    await sleep(stepMs);
  }
  if (!hold) await mouse("mouseReleased", CX + dx, CY + dy);
}
const readout = async () =>
  JSON.parse(await evalJson(`JSON.stringify({
    azim: parseFloat(document.querySelector("#ro-azim").textContent),
    elev: parseFloat(document.querySelector("#ro-elev").textContent),
    zoom: parseFloat(document.querySelector("#ro-zoom").textContent),
  })`));
/** Drag, read the PRE-release attitude, release. No inertia in the reading. */
const dragOnly = async (dx, dy) => {
  await drag(dx, dy, 12, 16, true);
  await sleep(140); // let the readout frame catch the post-drag state
  const a = await readout();
  await mouse("mouseReleased", CX, CY);
  return a;
};
const settle = () => sleep(1100);

/* ---- 1+2. drag orbits; flick carries and decays ------------------------ */
const a0 = await readout();
const a1 = await dragOnly(120, 40); // drag right+down: azimuth falls, pitch rises
check(
  "drag orbits (right drag decreases azimuth, down raises pitch)",
  a1.azim < a0.azim - 5 && a1.elev > a0.elev + 3,
  `azim ${a0.azim} -> ${a1.azim}, elev ${a0.elev} -> ${a1.elev}`,
);

// Flick: brisk short drag, release mid-glide, sample the decay.
await drag(-96, 0, 8, 16);
await sleep(100);
const f0 = await readout();
await sleep(300);
const f1 = await readout();
await settle();
const f2 = await readout();
check(
  "flick keeps carrying after release (inertia)",
  Math.abs(f1.azim - f0.azim) > 0.4,
  `azim ${f0.azim} @+100ms -> ${f1.azim} @+400ms`,
);
check(
  "inertia decays to rest (exponential damping)",
  Math.abs(f1.azim - f0.azim) > Math.abs(f2.azim - f1.azim) * 2 &&
    Math.abs(f2.azim - f1.azim) < 2,
  `deltas ${Math.abs(f1.azim - f0.azim).toFixed(2)} then ${Math.abs(f2.azim - f1.azim).toFixed(2)} deg (ratio ${(Math.abs(f2.azim - f1.azim) / Math.abs(f1.azim - f0.azim)).toFixed(2)})`,
);

/* ---- 3. wheel zoom eases ------------------------------------------------ */
await wheel(CX, CY, 1200); // back to wide first
await settle();
const zBefore = (await readout()).zoom;
await wheel(CX, CY, -480);
await sleep(60);
const zMid = (await readout()).zoom;
await settle();
const zEnd = (await readout()).zoom;
await sleep(300);
const zStable = (await readout()).zoom;
check(
  "wheel zoom eases (target approached over frames, then settled)",
  zMid > zEnd && zEnd < zBefore && Math.abs(zStable - zEnd) < 0.05,
  `zoom ${zBefore} -> ${zMid.toFixed(2)} @60ms -> ${zEnd.toFixed(2)} settled ${zStable.toFixed(2)}`,
);
// Standardize the zoom for the sensitivity comparison: back to wide.
await wheel(CX, CY, 480);
await settle();

/* ---- 4. zoom-scaled sensitivity ----------------------------------------- */
async function measureDrag(dx) {
  const pre = await readout();
  const post = await dragOnly(dx, 0);
  return Math.abs(post.azim - pre.azim);
}
const dWide = await measureDrag(-100);
for (let i = 0; i < 6; i++) {
  await wheel(CX, CY, -240); // zoom in ~0.75x per notch -> well inside 0.3 factor
  await sleep(120);
}
await settle();
const dNear = await measureDrag(-100);
check(
  "sensitivity scales with zoom (same drag rotates less when zoomed in)",
  dNear < dWide * 0.75 && dWide > 5,
  `delta @wide ${dWide.toFixed(1)}deg vs @zoomed-in ${dNear.toFixed(1)}deg`,
);
// Back to wide for the remaining checks.
await wheel(CX, CY, 900);
await settle();

/* ---- 5. double-click resets to the step default -------------------------- */
// Orbit well away from the preset first.
await dragOnly(-160, 60);
await settle();
const preReset = await readout();
await evalJson(`(() => {
  const c = document.querySelector("#stage canvas");
  c.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
})()`);
await sleep(250);
const post = await readout();
check(
  "double-click resets attitude to the Isometric default",
  Math.abs(post.azim - -60) < 0.5 && Math.abs(post.elev - 35) < 0.5 &&
    !(Math.abs(preReset.azim - post.azim) < 0.5 && Math.abs(preReset.elev - post.elev) < 0.5),
  `${preReset.azim},${preReset.elev} -> ${post.azim},${post.elev}`,
);
const zoomBeforeReset = (await readout()).zoom;
check(
  "double-click reset leaves the user's zoom alone",
  Math.abs(post.zoom - zoomBeforeReset) < 0.1,
  `zoom ${post.zoom}`,
);

/* ---- 6. flick into the pitch clamp -------------------------------------- */
await drag(0, 900, 30, 8); // hard downward drag: pitch rises toward the cap
await settle();
const clamped = await readout();
check(
  "flick clamps at the 90 degree pitch cap and stops cleanly",
  Math.abs(clamped.elev - 90) < 0.2 && Number.isFinite(clamped.azim) && Number.isFinite(clamped.zoom),
  `elev ${clamped.elev}, azim ${clamped.azim}, zoom ${clamped.zoom}`,
);

ws.close();
proc.kill();
try {
  rmSync(profile, { recursive: true, force: true });
} catch {
  // temp profile may still be locked; harmless
}
process.exit(failures === 0 ? 0 : 1);
