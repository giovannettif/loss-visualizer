/**
 * cdp-interact-cam.mjs — CDP gate for the damped-inertial camera rig, run
 * against the deterministic debug page (readouts in #ro-*, probe hook
 * window.__view = the LandscapeView). Binding under test (user scheme,
 * 2026-11-09): LEFT-drag PANS, RIGHT-drag ORBITS, wheel/pinch zoom.
 *
 *   1. RIGHT-drag orbits, OrbitControls sign convention intact;
 *   2. a right-drag flick keeps carrying after release (inertia) and decays;
 *   3. wheel zoom EASES: zoomRadius moves over several frames then settles;
 *   4. zoom-scaled sensitivity: the same right-drag rotates less zoomed in;
 *   5. LEFT-drag PANS: attitude untouched, the terrain follows the cursor
 *      1:1 in screen space (pan readout + projected terrain box);
 *   6. pan clamp: huge drags in all four directions never push the landscape
 *      out of the pane — zoomed in the pane centre stays over the terrain
 *      footprint, at the fit zoom the whole terrain box stays in frame;
 *   7. pan in MAP VIEW: works (top-down stays exactly 90°) and is clamped;
 *   8. a preset click re-centres the pan;
 *   9. double-click resets attitude AND pan, leaving the user's zoom alone;
 *  10. the canvas suppresses the context menu (right-drag is free), and the
 *      release of a right-drag that ends OFF the canvas is swallowed too;
 *  11. two-pointer pinch still zooms;
 *  12. a right-drag flick clamps at 90° pitch and stops (no NaN, no overshoot).
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
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
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

const BTN = { left: { name: "left", mask: 1 }, right: { name: "right", mask: 2 } };
const mouse = (type, x, y, btn = BTN.left) =>
  send("Input.dispatchMouseEvent", {
    type, x: Math.round(x), y: Math.round(y),
    button: btn.name, buttons: type === "mouseReleased" ? 0 : btn.mask,
    clickCount: 1, pointerType: "mouse",
  });
/** Drag by (dx, dy) with `btn`; if `hold` is true the button stays DOWN. */
async function drag(dx, dy, steps = 12, stepMs = 16, hold = false, btn = BTN.right, x0 = CX, y0 = CY) {
  await mouse("mousePressed", x0, y0, btn);
  for (let i = 1; i <= steps; i++) {
    await mouse("mouseMoved", x0 + (dx * i) / steps, y0 + (dy * i) / steps, btn);
    await sleep(stepMs);
  }
  if (!hold) await mouse("mouseReleased", x0 + dx, y0 + dy, btn);
}
const readout = async () =>
  JSON.parse(await evalJson(`JSON.stringify({
    azim: parseFloat(document.querySelector("#ro-azim").textContent),
    elev: parseFloat(document.querySelector("#ro-elev").textContent),
    zoom: parseFloat(document.querySelector("#ro-zoom").textContent),
  })`));
/** Live pan clamp state straight from the view (world + px + projected box). */
const pan = async () => JSON.parse(await evalJson(`JSON.stringify(window.__view.panInfo)`));
/** Right-drag (orbit), read the PRE-release attitude, release. */
const dragOnly = async (dx, dy) => {
  await drag(dx, dy, 12, 16, true, BTN.right);
  await sleep(140); // let the readout frame catch the post-drag state
  const a = await readout();
  await mouse("mouseReleased", CX, CY, BTN.right);
  return a;
};
/** Left-drag (pan) and release; returns nothing (read pan() after). */
const panDrag = (dx, dy, steps = 12) => drag(dx, dy, steps, 16, false, BTN.left);
const settle = () => sleep(1100);
const near = (a, b, tol) => Math.abs(a - b) <= tol;
/** Terrain box ∩ pane overlap in px (x, y). */
const overlap = (p) => ({
  x: Math.min(p.box.maxX, p.pane.right) - Math.max(p.box.minX, p.pane.left),
  y: Math.min(p.box.maxY, p.pane.bottom) - Math.max(p.box.minY, p.pane.top),
});
/** The clamp contract, per axis: a box that FITS the pane stays fully inside
 *  it; a box LARGER than the pane keeps the pane inside it (and then the
 *  pane centre must sit over the terrain footprint). */
const clampInvariant = (p, tol = 2) => {
  const bw = p.box.maxX - p.box.minX, bh = p.box.maxY - p.box.minY;
  const pw = p.pane.right - p.pane.left, ph = p.pane.bottom - p.pane.top;
  const okX = bw <= pw + tol
    ? p.box.minX >= p.pane.left - tol && p.box.maxX <= p.pane.right + tol
    : p.box.minX <= p.pane.left + tol && p.box.maxX >= p.pane.right - tol;
  const okY = bh <= ph + tol
    ? p.box.minY >= p.pane.top - tol && p.box.maxY <= p.pane.bottom + tol
    : p.box.minY <= p.pane.top + tol && p.box.maxY >= p.pane.bottom - tol;
  const larger = bw > pw + tol || bh > ph + tol;
  return okX && okY && (!larger || p.footprintVisible >= 0.2);
};
/** Zoom all the way out (deep zooms make each notch small: zoomSens). */
async function zoomOutFully() {
  for (let i = 0; i < 10; i++) {
    await wheel(CX, CY, 1500);
    await sleep(120);
  }
  await settle();
}
/** Zoom all the way in (to the zoom floor). */
async function zoomInFully() {
  for (let i = 0; i < 14; i++) {
    await wheel(CX, CY, -400);
    await sleep(120);
  }
  await settle();
}
const boxInPane = (p, tol = 2) =>
  p.box.minX >= p.pane.left - tol && p.box.maxX <= p.pane.right + tol &&
  p.box.minY >= p.pane.top - tol && p.box.maxY <= p.pane.bottom + tol;

/* ---- 1+2. RIGHT-drag orbits; flick carries and decays ------------------- */
const a0 = await readout();
const a1 = await dragOnly(120, 40); // right-drag right+down: azimuth falls, pitch rises
check(
  "RIGHT-drag orbits (right drag decreases azimuth, down raises pitch)",
  a1.azim < a0.azim - 5 && a1.elev > a0.elev + 3,
  `azim ${a0.azim} -> ${a1.azim}, elev ${a0.elev} -> ${a1.elev}`,
);
check(
  "an orbit drag never pans",
  (await pan()).px.x === 0 && (await pan()).px.y === 0,
  JSON.stringify((await pan()).px),
);

// Flick: brisk short right-drag, release mid-glide, sample the decay.
await drag(-96, 0, 8, 16, false, BTN.right);
await sleep(100);
const f0 = await readout();
await sleep(300);
const f1 = await readout();
await settle();
const f2 = await readout();
check(
  "right-drag flick keeps carrying after release (inertia)",
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
  "sensitivity scales with zoom (same right-drag rotates less when zoomed in)",
  dNear < dWide * 0.75 && dWide > 5,
  `delta @wide ${dWide.toFixed(1)}deg vs @zoomed-in ${dNear.toFixed(1)}deg`,
);

/* ---- 5. LEFT-drag pans (zoomed in, so the clamp has room) ---------------- */
// Deep zoom first: near the fit the box rule legitimately pins an axis (the
// box exactly fills the pane), so 1:1 tracking is measured with room to move.
await zoomInFully();
const pa0 = await readout();
const pp0 = await pan();
await panDrag(140, 60);
await sleep(200);
const pa1 = await readout();
const pp1 = await pan();
check(
  "LEFT-drag pans: attitude and zoom untouched",
  near(pa1.azim, pa0.azim, 0.05) && near(pa1.elev, pa0.elev, 0.05) && near(pa1.zoom, pa0.zoom, 0.01),
  `${JSON.stringify(pa0)} -> ${JSON.stringify(pa1)}`,
);
check(
  "LEFT-drag pans: the terrain follows the cursor 1:1 in screen space",
  near(pp1.box.minX - pp0.box.minX, 140, 3) && near(pp1.box.minY - pp0.box.minY, 60, 3) &&
    near(pp1.px.x - pp0.px.x, -140, 3) && near(pp1.px.y - pp0.px.y, 60, 3),
  `box Δ(${(pp1.box.minX - pp0.box.minX).toFixed(1)}, ${(pp1.box.minY - pp0.box.minY).toFixed(1)}) pan px ${JSON.stringify(pp1.px)}`,
);
await sleep(400);
const pp1b = await pan();
check(
  "pan rests where it was released (no glide)",
  near(pp1b.px.x, pp1.px.x, 0.5) && near(pp1b.px.y, pp1.px.y, 0.5),
  `${JSON.stringify(pp1.px)} -> ${JSON.stringify(pp1b.px)}`,
);

/* ---- 6. pan clamp: the landscape cannot leave the frame ----------------- */
const clampResults = [];
for (const [dx, dy] of [[3000, 0], [-3000, 0], [0, 3000], [0, -3000], [2500, 2500]]) {
  await panDrag(dx, dy, 24);
  await sleep(150);
  const p = await pan();
  const ov = overlap(p);
  clampResults.push({ dx, dy, ov, over: p.centerOverFootprint, vis: +p.footprintVisible.toFixed(3), ok: clampInvariant(p) });
}
check(
  "pan clamp (zoomed in): extreme drags never push the terrain out of the pane",
  clampResults.every((r) => r.ok && r.ov.x > 100 && r.ov.y > 100),
  JSON.stringify(clampResults.map((r) => ({ d: [r.dx, r.dy], ov: [Math.round(r.ov.x), Math.round(r.ov.y)], over: r.over, vis: r.vis }))),
);
// Zoom all the way out: the clamp must pull the whole box back in frame.
await zoomOutFully();
const pOut = await pan();
check(
  "pan clamp (zoomed out): zooming out re-clamps — the whole terrain box stays in the pane",
  boxInPane(pOut),
  `box ${JSON.stringify(pOut.box)} pane ${JSON.stringify(pOut.pane)}`,
);
await panDrag(-3000, -3000, 24);
await sleep(150);
const pOut2 = await pan();
check(
  "pan clamp (zoomed out): an extreme drag still cannot push the box out of frame",
  boxInPane(pOut2),
  `box ${JSON.stringify(pOut2.box)}`,
);
// The hard right-drag orbit while panned must not break the clamp either.
await dragOnly(-400, 0);
await settle();
const pOrb = await pan();
check(
  "pan clamp holds through an orbit (box stays in the pane)",
  boxInPane(pOrb) && clampInvariant(pOrb),
  `box ${JSON.stringify(pOrb.box)}`,
);

/* ---- 8 (first half). preset click re-centres the pan --------------------- */
const clickPreset = (p) => evalJson(`(() => {
  document.querySelector('.lv-btn[data-preset="${p}"]').click();
})()`);

/* ---- 7. pan in MAP VIEW ---------------------------------------------------- */
await clickPreset("map");
await settle();
const m0 = await readout();
const mp0 = await pan();
check(
  "Map view preset is top-down and re-centres any pan",
  near(m0.elev, 90, 0.2) && near(mp0.px.x, 0, 0.5) && near(mp0.px.y, 0, 0.5),
  `elev ${m0.elev} pan ${JSON.stringify(mp0.px)}`,
);
await zoomInFully();
const mz = await pan();
await panDrag(-160, 90);
await sleep(200);
const m1 = await readout();
const mp1 = await pan();
check(
  "Map view: LEFT-drag pans (stays exactly top-down, terrain follows the cursor)",
  near(m1.elev, 90, 0.2) && near(m1.azim, m0.azim, 0.05) &&
    near(mp1.box.minX - mz.box.minX, -160, 3) && near(mp1.box.minY - mz.box.minY, 90, 3),
  `elev ${m1.elev} box Δ(${(mp1.box.minX - mz.box.minX).toFixed(1)}, ${(mp1.box.minY - mz.box.minY).toFixed(1)})`,
);
const mapClamp = [];
for (const [dx, dy] of [[4000, 0], [-4000, 0], [0, 4000], [0, -4000]]) {
  await panDrag(dx, dy, 24);
  await sleep(150);
  const p = await pan();
  mapClamp.push({ d: [dx, dy], ov: overlap(p), over: p.centerOverFootprint, vis: +p.footprintVisible.toFixed(3), ok: clampInvariant(p) });
}
check(
  "Map view: pan is clamped (the terrain never leaves the pane)",
  mapClamp.every((r) => r.ok && r.ov.x > 100 && r.ov.y > 100),
  JSON.stringify(mapClamp.map((r) => ({ d: r.d, ov: [Math.round(r.ov.x), Math.round(r.ov.y)], over: r.over, vis: r.vis }))),
);

/* ---- 8. preset click re-centres the pan ------------------------------------ */
await clickPreset("iso");
await settle();
const isoP = await pan();
const isoA = await readout();
check(
  "Isometric preset restores the standard pose and re-centres the pan",
  near(isoA.azim, -60, 0.5) && near(isoA.elev, 35, 0.5) && near(isoP.px.x, 0, 0.5) && near(isoP.px.y, 0, 0.5),
  `${JSON.stringify(isoA)} pan ${JSON.stringify(isoP.px)}`,
);

/* ---- 9. double-click resets attitude + pan + zoom (the standard pose) ----- */
const preWheel = await readout();
for (let i = 0; i < 4; i++) {
  await wheel(CX, CY, -240);
  await sleep(120);
}
await settle();
await dragOnly(-160, 60); // orbit away
await panDrag(120, -80); // and pan away
await settle();
const preReset = await readout();
const prePan = await pan();
await evalJson(`(() => {
  const c = document.querySelector("#stage canvas");
  c.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
})()`);
await sleep(250);
const post = await readout();
const postPan = await pan();
const fitZoom = await evalJson(`window.__view.fitZoom`);
check(
  "double-click resets attitude to the Isometric default",
  Math.abs(post.azim - -60) < 0.5 && Math.abs(post.elev - 35) < 0.5 &&
    !(Math.abs(preReset.azim - post.azim) < 0.5 && Math.abs(preReset.elev - post.elev) < 0.5),
  `${preReset.azim},${preReset.elev} -> ${post.azim},${post.elev}`,
);
check(
  "double-click reset re-centres the pan",
  (Math.abs(prePan.px.x) > 20 || Math.abs(prePan.px.y) > 20) && near(postPan.px.x, 0, 0.5) && near(postPan.px.y, 0, 0.5),
  `${JSON.stringify(prePan.px)} -> ${JSON.stringify(postPan.px)}`,
);
check(
  "double-click reset restores the scene-default zoom (QA B-3-0: no unrescuable deep zoom)",
  Math.abs(post.zoom - Number(fitZoom)) < 0.5 && Math.abs(post.zoom - preWheel.zoom) < 0.5,
  `zoom ${preReset.zoom} -> ${post.zoom} (fit ${Number(fitZoom).toFixed(2)}, pre-wheel ${preWheel.zoom})`,
);

/* ---- 10. context menu suppressed ------------------------------------------- */
const ctx = await evalJson(`(() => {
  const c = document.querySelector("#stage canvas");
  const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 });
  c.dispatchEvent(ev);
  return ev.defaultPrevented;
})()`);
check("the canvas suppresses the context menu (right-drag is free to orbit)", ctx === true);
// A right-drag that ends OFF the canvas: the release's contextmenu lands on
// another element — it must be swallowed too (right after the orbit only).
await drag(0, 0, 1, 16, true, BTN.right);
await mouse("mouseMoved", CX + 60, CY + 10, BTN.right);
await sleep(30);
await mouse("mouseReleased", CX + 60, CY + 10, BTN.right);
const offCtx = await evalJson(`(() => {
  const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 });
  document.body.dispatchEvent(ev);
  return ev.defaultPrevented;
})()`);
await sleep(600);
const lateCtx = await evalJson(`(() => {
  const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 });
  document.body.dispatchEvent(ev);
  return ev.defaultPrevented;
})()`);
check(
  "a right-drag orbit's off-canvas release menu is swallowed, and only then",
  offCtx === true && lateCtx === false,
  `right after release: prevented=${offCtx}; 600ms later elsewhere: prevented=${lateCtx}`,
);

/* ---- 11. pinch zoom preserved ----------------------------------------------- */
await zoomOutFully(); // wide first: the pinch must not start at the zoom floor
const zPinch0 = (await readout()).zoom;
await evalJson(`(() => {
  const c = document.querySelector("#stage canvas");
  const r = c.getBoundingClientRect();
  const cx = r.left + 700, cy = r.top + 450;
  const ev = (type, id, x) => c.dispatchEvent(new PointerEvent(type, {
    pointerId: id, pointerType: "touch", isPrimary: id === 31, button: 0, buttons: type === "pointerup" ? 0 : 1,
    clientX: x, clientY: cy, bubbles: true, cancelable: true,
  }));
  ev("pointerdown", 31, cx - 40);
  ev("pointerdown", 32, cx + 40);
  for (let i = 1; i <= 8; i++) { ev("pointermove", 31, cx - 40 - i * 15); ev("pointermove", 32, cx + 40 + i * 15); }
  ev("pointerup", 31, cx - 160);
  ev("pointerup", 32, cx + 160);
})()`);
await sleep(300);
const zPinch1 = (await readout()).zoom;
check(
  "two-pointer pinch still zooms (spread = zoom in)",
  zPinch1 < zPinch0 * 0.6,
  `zoom ${zPinch0} -> ${zPinch1}`,
);

/* ---- 12. flick into the pitch clamp ------------------------------------------ */
await drag(0, 900, 30, 8, false, BTN.right); // hard downward right-drag: pitch rises
await settle();
const clamped = await readout();
check(
  "right-drag flick clamps at the 90 degree pitch cap and stops cleanly",
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
console.log(failures === 0 ? "ALL_PASS" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
