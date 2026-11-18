/**
 * cdp-arrow-precision.mjs — minimap draw-your-arrow PRECISION probe over CDP.
 *
 * Verifies the pixel-to-parameter mapping END-TO-END: a trusted CDP drag on
 * the compass minimap from a known pixel must store an arrow endpoint that
 * maps back to that exact pixel, within a tight (sub-pixel) tolerance.
 *
 *   1. §2 gd-b: drag across known pixels — stored userTip equals the
 *      pixel→parameter mapping to < 0.5 px equivalent (both a mid-plane
 *      target and an extent-border clamp);
 *   2. enlarged grab radius: a press on the PANEL (padding/caption, outside
 *      the canvas) must still start the draw and commit the released tip;
 *   3. live length/angle readout: while the drag is held, the panel shows a
 *      length+angle readout matching the held tip; it hides on release;
 *   4. §6 fog-a: committed stride endpoints snap to cell centers of the fog
 *      grid (stored path end == snapped point, tight tolerance).
 *
 * The expected mapping is recomputed here from the same constants the
 * CompassMinimap uses (PAD=18, PAD_BOTTOM=27, extent, canvas CSS rect), so a
 * dpr / CSS-size mismatch in either direction fails the tolerance.
 *
 * Usage: node tools/cdp-arrow-precision.mjs <baseUrl>
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const base = process.argv[2] ?? "http://localhost:4173";

/* ---- minimap plane constants (mirror CompassMinimap) -------------------- */
const PAD = 18;
const PAD_BOTTOM = 27;

/** The minimap's pixel→parameter mapping, recomputed from the live rect. */
const mapper = (rect, extent) => {
  const w = rect.width;
  const h = rect.height;
  const iw = w - PAD - 8;
  const ih = h - PAD - PAD_BOTTOM;
  const sx = Math.min(iw / (extent.xMax - extent.xMin), ih / (extent.yMax - extent.yMin));
  const x0 = PAD + (iw - (extent.xMax - extent.xMin) * sx) / 2;
  const y0 = PAD + (ih - (extent.yMax - extent.yMin) * sx) / 2;
  return {
    /** viewport px (canvas-local) → parameter point, extent-clamped exactly
     *  like CompassMinimap.pointerToParam */
    toParam: (vx, vy) => {
      const raw = {
        x: extent.xMin + ((vx - x0) / ((extent.xMax - extent.xMin) * sx)) * (extent.xMax - extent.xMin),
        y: extent.yMax - ((vy - y0) / ((extent.yMax - extent.yMin) * sx)) * (extent.yMax - extent.yMin),
      };
      return {
        x: Math.min(extent.xMax, Math.max(extent.xMin, raw.x)),
        y: Math.min(extent.yMax, Math.max(extent.yMin, raw.y)),
      };
    },
    pxPerUnit: sx,

    /** parameter point → canvas-local px (inverse of toParam) */
    toPx: (p) => ({
      vx: x0 + (p.x - extent.xMin) * sx,
      vy: y0 + (extent.yMax - p.y) * sx,
    }),
  };
};

/** Fog grid (mirror of fogGame.fogSnapToCell / fogCellGrid). */
const fogCellSnap = (extent, p) => {
  const spanX = extent.xMax - extent.xMin;
  const spanY = extent.yMax - extent.yMin;
  const diag = Math.hypot(spanX, spanY);
  const cell = diag / 10;
  const nx = Math.max(1, Math.round(spanX / cell));
  const ny = Math.max(1, Math.round(spanY / cell));
  const cw = spanX / nx;
  const ch = spanY / ny;
  const ix = Math.min(nx - 1, Math.max(0, Math.floor((p.x - extent.xMin) / cw)));
  const iy = Math.min(ny - 1, Math.max(0, Math.floor((p.y - extent.yMin) / ch)));
  return {
    x: extent.xMin + (ix + 0.5) * cw,
    y: extent.yMin + (iy + 0.5) * ch,
  };
};

const profile = mkdtempSync(join(tmpdir(), "cdp-arrow-"));
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
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.text + " " +
      (r.exceptionDetails.exception?.description ?? ""));
  }
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

const rects = async () =>
  JSON.parse(await evalJson(`JSON.stringify({
    canvas: document.querySelector("#minimap-canvas").getBoundingClientRect(),
    panel: document.querySelector("#minimap-panel").getBoundingClientRect(),
  })`));

const waitIdle = async (label, timeoutMs = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const locked = await evalJson(`__wp1.locked()`);
    const animating = await evalJson(`__wp1.animating()`);
    if (!locked && !animating) return;
    await sleep(150);
  }
  console.log(`WARN  ${label}: still locked/animating after ${timeoutMs}ms`);
};

/** Trusted drag on the minimap from viewport point A to B (with held pause). */
async function minimapDrag(ax, ay, bx, by, steps = 8) {
  const mouse = (type, x, y) =>
    send("Input.dispatchMouseEvent", {
      type, x: Math.round(x), y: Math.round(y),
      button: "left", buttons: type === "mouseReleased" ? 0 : 1,
      clickCount: 1, pointerType: "mouse",
    });
  await mouse("mousePressed", ax, ay);
  for (let i = 1; i <= steps; i++) {
    await mouse("mouseMoved", ax + ((bx - ax) * i) / steps, ay + ((by - ay) * i) / steps);
    await sleep(16);
  }
  await sleep(120); // held: live readout must be up NOW
  const held = await evalJson(`(function(){
    const el = document.querySelector("#minimap-panel .mm-readout");
    return el ? { text: el.textContent, visible: el.dataset.visible === "true" } : null;
  })()`);
  await mouse("mouseReleased", bx, by);
  await sleep(150);
  const released = await evalJson(`(function(){
    const el = document.querySelector("#minimap-panel .mm-readout");
    return el ? { visible: el.dataset.visible === "true" } : null;
  })()`);
  return { held, released };
}

/* =================== §2 gd-b: mapping precision ========================= */

await send("Page.navigate", { url: `${base}/?step=5` }); // gd-b
await sleep(4000);
await waitIdle("gd-b boot");
check("gd-b booted", (await evalJson(`__wp1.scene()`)) === "gd-b");

// defaultBowl = makeBowl(1, 0.02, π/6): half = min(15, 3/√0.02) = 15.
const extent = { xMin: -15, xMax: 15, yMin: -15, yMax: 15 };
const r0 = await rects();
const m = mapper(r0.canvas, extent);

// Drag 1: plane interior — press at a known pixel, release at another.
{
  const a = { vx: 60, vy: 70 };
  const b = { vx: 92, vy: 78 };
  const expTip = m.toParam(b.vx, b.vy);
  const res = await minimapDrag(
    r0.canvas.left + a.vx, r0.canvas.top + a.vy,
    r0.canvas.left + b.vx, r0.canvas.top + b.vy,
  );
  const tip = await evalJson(`__wp1.gd().userTip`);
  const tol = 0.5 / m.pxPerUnit; // half a CSS pixel in parameter units
  const err = tip
    ? Math.max(Math.abs(tip.x - expTip.x), Math.abs(tip.y - expTip.y))
    : Infinity;
  check(
    "1a. stored userTip equals the pixel→param mapping (<0.5 px)",
    tip !== null && err <= tol,
    `tip ${tip ? `(${tip.x.toFixed(4)}, ${tip.y.toFixed(4)})` : "null"} vs expected (${expTip.x.toFixed(4)}, ${expTip.y.toFixed(4)}), err ${(err * m.pxPerUnit).toFixed(3)} px`,
  );
  check(
    "1b. live length/angle readout while the drag is held",
    res.held !== null && res.held.visible && /\d/.test(res.held.text) && /°/.test(res.held.text),
    res.held ? `readout "${res.held.text.trim()}"` : "no .mm-readout element",
  );
  check(
    "1c. readout hides on release",
    res.released !== null && res.released.visible === false,
    res.released ? `visible=${res.released.visible}` : "no .mm-readout element",
  );
}

// Drag 2: cursor pulled ABOVE the plane and OUT of the canvas — the stored
// tip must clamp to the extent border exactly (arrow lands where the cursor
// maps to, and no further).
{
  const r = await rects();
  const releaseVX = 40, releaseVY = -30; // canvas-local: above the plane top
  const expTip = m.toParam(releaseVX, releaseVY); // mapper clamps → (…, yMax)
  const res = await minimapDrag(
    r.canvas.left + 60, r.canvas.top + 70,
    r.canvas.left + releaseVX, r.canvas.top + releaseVY,
  );
  const tip = await evalJson(`__wp1.gd().userTip`);
  const tol = 0.5 / m.pxPerUnit;
  const err = tip
    ? Math.max(Math.abs(tip.x - expTip.x), Math.abs(tip.y - expTip.y))
    : Infinity;
  check(
    "1d. off-canvas cursor clamps the tip to the extent border exactly",
    tip !== null && err <= tol,
    `tip ${tip ? `(${tip.x.toFixed(4)}, ${tip.y.toFixed(4)})` : "null"} vs expected (${expTip.x.toFixed(4)}, ${expTip.y.toFixed(4)})`,
  );
}

/* ============ 2. enlarged grab radius: press on the PANEL ================ */
{
  const r = await rects();
  // Press 6 px inside the panel's left padding — OUTSIDE the canvas (the
  // canvas starts at panel.left + 16). Pre-fix nothing starts; post-fix the
  // whole panel is the grab surface and the released tip must commit.
  const pressX = r.panel.left + 6;
  const pressY = r.canvas.top + 110;
  const releaseVX = 60, releaseVY = 80; // canvas-local
  const expTip = m.toParam(releaseVX, releaseVY);
  const res = await minimapDrag(pressX, pressY,
    r.canvas.left + releaseVX, r.canvas.top + releaseVY);
  const tip = await evalJson(`__wp1.gd().userTip`);
  const tol = 0.75 / m.pxPerUnit; // the press was outside: allow 0.75 px
  const err = tip
    ? Math.max(Math.abs(tip.x - expTip.x), Math.abs(tip.y - expTip.y))
    : Infinity;
  check(
    "2. grab radius covers the panel (press on padding still draws)",
    tip !== null && err <= tol,
    `tip ${tip ? `(${tip.x.toFixed(4)}, ${tip.y.toFixed(4)})` : "null"} vs expected (${expTip.x.toFixed(4)}, ${expTip.y.toFixed(4)}), err ${(err * m.pxPerUnit).toFixed(2)} px`,
  );
}

/* =================== §6 fog-a: cell-center snapping ====================== */

await send("Page.navigate", { url: `${base}/?step=15` }); // fog-a
await sleep(4000);
await waitIdle("fog-a boot");
check("fog-a booted", (await evalJson(`__wp1.scene()`)) === "fog-a");

const lsExtent = { xMin: -1, xMax: 3, yMin: -3, yMax: 5 }; // leastSquares
const rf = await rects();
const mf = mapper(rf.canvas, lsExtent);
const diag = Math.hypot(4, 8);
const reach = diag * 0.16; // FOG_LS reachFrac
const start = { x: 0.2, y: 0.5 }; // FOG_LS start

// Target well inside the stride ring, NOT on a cell center: expected commit
// = reach-clamped cell center of the cursor pixel.
{
  const startPx = mf.toPx(start);
  const targetParam = { x: 0.7, y: 1.2 };
  const targetPx = mf.toPx(targetParam);
  const dist = Math.hypot(targetParam.x - start.x, targetParam.y - start.y);
  const snapped = fogCellSnap(lsExtent, targetParam);
  const res = await minimapDrag(
    rf.canvas.left + startPx.vx, rf.canvas.top + startPx.vy,
    rf.canvas.left + targetPx.vx, rf.canvas.top + targetPx.vy,
  );
  const fog = await evalJson(`__wp1.fog()`);
  const last = fog && fog.path && fog.path.length >= 2 ? fog.path[fog.path.length - 1] : null;
  const tol = 1e-6;
  const ok = last !== null &&
    Math.abs(last.x - snapped.x) <= tol && Math.abs(last.y - snapped.y) <= tol;
  check(
    "3. fog stride commits to the cursor's CELL CENTER (snap)",
    ok,
    `stored ${last ? `(${last.x.toFixed(6)}, ${last.y.toFixed(6)})` : "null"} vs cell center (${snapped.x.toFixed(6)}, ${snapped.y.toFixed(6)}); cursor-dist ${dist.toFixed(2)} < reach ${reach.toFixed(2)}; held readout ${res.held ? `"${res.held.text.trim()}"` : "none"}`,
  );
  check(
    "3b. the measurement was spent once (budget accounting)",
    fog && fog.used === 1,
    `used=${fog ? fog.used : "n/a"}`,
  );
}

// Outside the ring: snap applies FIRST, the stride clamp still caps the tip
// onto the reach circle (never beyond). The clamp is measured from the
// CURRENT point — check 3's committed stride already moved the player.
{
  const fogNow = await evalJson(`__wp1.fog()`);
  const cur = fogNow.point;
  const farParam = { x: 2.6, y: 4.0 }; // far outside the reach ring
  const curPx = mf.toPx(cur);
  const farPx = mf.toPx(farParam);
  const snapped = fogCellSnap(lsExtent, farParam);
  const dx = snapped.x - cur.x;
  const dy = snapped.y - cur.y;
  const d = Math.hypot(dx, dy);
  const expected = d <= reach
    ? snapped
    : { x: cur.x + (dx / d) * reach, y: cur.y + (dy / d) * reach };
  await minimapDrag(
    rf.canvas.left + curPx.vx, rf.canvas.top + curPx.vy,
    rf.canvas.left + farPx.vx, rf.canvas.top + farPx.vy,
  );
  const fog = await evalJson(`__wp1.fog()`);
  const last = fog && fog.path && fog.path.length >= 2 ? fog.path[fog.path.length - 1] : null;
  const ok = last !== null &&
    Math.abs(last.x - expected.x) <= 1e-6 && Math.abs(last.y - expected.y) <= 1e-6;
  check(
    "4. beyond the ring, the snapped tip still clamps onto the reach circle",
    ok,
    `stored ${last ? `(${last.x.toFixed(6)}, ${last.y.toFixed(6)})` : "null"} vs expected (${expected.x.toFixed(6)}, ${expected.y.toFixed(6)}) from point (${cur.x.toFixed(2)}, ${cur.y.toFixed(2)})`,
  );
}

/* ===== F1: a read-only compass shows no readout and draws nothing ========= */
// The director's onArrowPreview return value is the single gate: outside
// gd-b / live fog-a/b (or when frozen / the fog game is done) a drag must
// not start a draw, flash the |Δθ|/∠ readout, or store a tip.

await send("Page.navigate", { url: `${base}/?step=6` }); // gd-c
await sleep(4000);
await waitIdle("gd-c boot");
check("gd-c booted", (await evalJson(`__wp1.scene()`)) === "gd-c");
{
  const r = await rects();
  const res = await minimapDrag(
    r.canvas.left + 60, r.canvas.top + 70,
    r.canvas.left + 90, r.canvas.top + 80,
  );
  const tip = await evalJson(`__wp1.gd().userTip`);
  check(
    "5. gd-c: a compass drag shows no readout and stores no userTip",
    tip === null && (res.held === null || res.held.visible === false),
    `userTip ${tip ? `(${tip.x.toFixed(3)}, ${tip.y.toFixed(3)})` : "null"}; held readout ${res.held ? (res.held.visible ? `visible "${res.held.text.trim()}"` : "hidden") : "absent"}`,
  );
}

await send("Page.navigate", { url: `${base}/?step=17` }); // fog-c
await sleep(4000);
await waitIdle("fog-c boot");
check("fog-c booted", (await evalJson(`__wp1.scene()`)) === "fog-c");
{
  const r = await rects();
  const res = await minimapDrag(
    r.canvas.left + 60, r.canvas.top + 70,
    r.canvas.left + 90, r.canvas.top + 80,
  );
  check(
    "6. fog-c: a compass drag shows no readout",
    res.held === null || res.held.visible === false,
    `held readout ${res.held ? (res.held.visible ? `visible "${res.held.text.trim()}"` : "hidden") : "absent"}`,
  );
}

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
