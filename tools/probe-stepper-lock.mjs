/**
 * probe-stepper-lock.mjs — reproduces the sweep findings on the reader stepper
 * lock (KW-8 fling across a lock, fast wheel through unlocked steps, wheel
 * over the rail/chip (F16-RAIL-CHIP-WHEEL-DEAD / KW-6), Ctrl+wheel (KW-7),
 * rail-jump lock engagement). Prints raw state; asserts nothing.
 *
 * Usage: node tools/probe-stepper-lock.mjs <baseUrl>
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const base = process.argv[2] ?? "http://localhost:4173";

const profile = mkdtempSync(join(tmpdir(), "probe-stepper-"));
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


const READER_X = 1600 - 290, Y = 450;
const st = () => evalJson(`JSON.stringify({step: __wp1.step(), scene: __wp1.scene(), locked: __wp1.locked(), animating: __wp1.animating(), y: __wp1.scroll().y, target: __wp1.scroll().target})`).then(JSON.parse);
const wheel = (x, y, dy, mods = 0) => send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY: dy, modifiers: mods, pointerType: "mouse" });
async function idle(ms = 15000) { const t = Date.now(); while (Date.now() - t < ms) { const s = await st(); if (!s.locked && !s.animating) return s; await sleep(120); } return st(); }
await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
const go = async (q) => { await send("Page.navigate", { url: base + "/" + q }); await sleep(4000); return idle(); };
// P1 fling across a lock (KW-8)
await go("?step=4"); await sleep(400);
let t0 = Date.now(); const trace = [];
for (let i = 0; i < 70; i++) { await wheel(READER_X, Y, 120); await sleep(50); if (i % 5 === 4) trace.push((await st()).step + (await st()).locked ? "L" : ""); }
await sleep(300);
console.log("P1 fling from 4 (70 notches/50ms):", JSON.stringify(await st()), "elapsed", Date.now() - t0);
// P2 fast wheel through same-scene unlocked step 13->14
await go("?step=13"); await sleep(400);
for (let i = 0; i < 30; i++) { await wheel(READER_X, Y, 120); await sleep(40); }
await sleep(200);
console.log("P2 fast wheel from 13:", JSON.stringify(await st()));
await go("?step=18"); await sleep(400);
for (let i = 0; i < 30; i++) { await wheel(READER_X, Y, 120); await sleep(40); }
await sleep(200);
console.log("P2b fast wheel from 18:", JSON.stringify(await st()));
// P3 rail / chip wheel
await go("?step=2"); await sleep(400);
const railR = await evalJson(`JSON.stringify(document.querySelector("#rail").getBoundingClientRect())`).then(JSON.parse);
const chipR = await evalJson(`JSON.stringify(document.querySelector("#reader-chip").getBoundingClientRect())`).then(JSON.parse);
for (let i = 0; i < 6; i++) { await wheel(Math.round(railR.left + railR.width / 2), Math.round(railR.top + railR.height / 2), 120); await sleep(40); }
await sleep(300); console.log("P3 rail wheel from 2:", JSON.stringify(await st()), JSON.stringify(railR));
await idle();
for (let i = 0; i < 6; i++) { await wheel(Math.round(chipR.left + chipR.width / 2), Math.round(chipR.top + chipR.height / 2), 120); await sleep(40); }
await sleep(300); console.log("P3b chip wheel:", JSON.stringify(await st()));
// P4 ctrl+wheel
await go("?step=4"); await sleep(400);
for (let i = 0; i < 6; i++) { await wheel(READER_X, Y, 120, 2); await sleep(40); }
await sleep(300); console.log("P4 ctrl+wheel from 4:", JSON.stringify(await st()));
// P5 rail far jumps forward: lock engages whenever the scene animates?
await go("?step=0"); await sleep(400);
const res = [];
for (const k of [3, 6, 9, 12, 15, 17, 20, 21, 24, 26]) {
  await evalJson(`document.querySelectorAll("#rail button")[${k}].click()`);
  await sleep(60);
  const s = await st(); res.push([k, s.step, s.locked, s.animating]);
  await idle(); await sleep(200);
}
console.log("P5 rail forward jumps [k, step, locked, animating]:", JSON.stringify(res));
// P6 wheel during a rail-jump lock (over rail and reader)
await go("?step=0"); await sleep(400);
await evalJson(`document.querySelectorAll("#rail button")[8].click()`); await sleep(80);
const pre = await st();
for (let i = 0; i < 8; i++) { await wheel(READER_X, Y, 120); await sleep(40); }
const mid = await st();
for (let i = 0; i < 30; i++) { await wheel(READER_X, Y, 120); await sleep(60); }
await sleep(300);
console.log("P6 wheel during rail-jump lock:", JSON.stringify(pre), JSON.stringify(mid), JSON.stringify(await st()));
ws.close(); proc.kill(); try { rmSync(profile, { recursive: true, force: true }); } catch {}
process.exit(0);
