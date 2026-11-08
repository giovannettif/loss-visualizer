/**
 * cdp-interact.mjs — drives the page's core §1 interactions over CDP and
 * reports pass/fail for each. Exercises what screenshots cannot:
 *
 *   1. surface drag (raycast puppet-drag of the learner ball on the 3D
 *      surface) must move (w, b) and the loss readout;
 *   2. fit-inset handle drag must do the same;
 *   3. ?step=N (non-shot mode) must land the step machine on the right scene
 *      with tweens settled.
 *
 * Usage: node tools/cdp-interact.mjs <baseUrl>   (e.g. http://localhost:4173)
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const base = process.argv[2] ?? "http://localhost:4173";

const profile = mkdtempSync(join(tmpdir(), "cdp-interact-"));
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
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
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

/* ---- 1. surface drag on ?shot=task-c -------------------------------- */
await send("Page.navigate", { url: `${base}/?shot=task-c` });
await sleep(6000);

const before = await evalJson(`JSON.stringify(window.__wp1.fit())`);
const ball = await evalJson(`JSON.stringify(window.__wp1.ballScreen())`);
check("ball has a screen position in task-c", ball !== "null" && ball !== null, ball);

const p0 = JSON.parse(ball);
// Press on the ball, drag across the surface, release.
await send("Input.dispatchMouseEvent", {
  type: "mousePressed", x: Math.round(p0.x), y: Math.round(p0.y),
  button: "left", buttons: 1, clickCount: 1, pointerType: "mouse",
});
const steps = 14;
for (let i = 1; i <= steps; i++) {
  await send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: Math.round(p0.x + (140 * i) / steps),
    y: Math.round(p0.y + (70 * i) / steps),
    button: "left", buttons: 1, pointerType: "mouse",
  });
  await sleep(16);
}
await send("Input.dispatchMouseEvent", {
  type: "mouseReleased", x: Math.round(p0.x + 140), y: Math.round(p0.y + 70),
  button: "left", buttons: 0, clickCount: 1, pointerType: "mouse",
});
await sleep(300);

const afterSurface = JSON.parse(await evalJson(`JSON.stringify(window.__wp1.fit())`));
const fb = JSON.parse(before);
const moved = Math.hypot(afterSurface.w - fb.w, afterSurface.b - fb.b);
check("surface drag moves (w, b)", moved > 0.05, `fit ${fb.w.toFixed(2)},${fb.b.toFixed(2)} -> ${afterSurface.w.toFixed(2)},${afterSurface.b.toFixed(2)}`);
const lossTxt = await evalJson(`document.querySelector('#loss-value').textContent`);
check("loss readout follows the drag", !Number.isNaN(Number(lossTxt)) && Number(lossTxt) > 1.5, `loss=${lossTxt}`);
const roW = await evalJson(`document.querySelector('#ro-w').textContent`);
check("w readout follows the drag", Math.abs(Number(roW) - afterSurface.w) < 0.005, `ro-w=${roW}`);

/* ---- 2. fit-inset handle drag --------------------------------------- */
const fitRect = await evalJson(`JSON.stringify(document.querySelector('#fit-canvas').getBoundingClientRect())`);
const fr = JSON.parse(fitRect);
// Grab the RIGHT handle: line end at data x=4.1 -> pixel position.
const hx = fr.left + ((4.1 - -4.2) / (4.6 - -4.2)) * (fr.width - 30 - 12) + 30;
const hy = fr.top + fr.height - 22 - ((afterSurface.w * 4.1 + afterSurface.b - -2.1) / (5.7 - -2.1)) * (fr.height - 10 - 22);
await send("Input.dispatchMouseEvent", {
  type: "mousePressed", x: Math.round(hx), y: Math.round(hy),
  button: "left", buttons: 1, clickCount: 1, pointerType: "mouse",
});
for (let i = 1; i <= 10; i++) {
  await send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: Math.round(hx), y: Math.round(hy - (60 * i) / 10),
    button: "left", buttons: 1, pointerType: "mouse",
  });
  await sleep(16);
}
await send("Input.dispatchMouseEvent", {
  type: "mouseReleased", x: Math.round(hx), y: Math.round(hy - 60),
  button: "left", buttons: 0, clickCount: 1, pointerType: "mouse",
});
await sleep(300);
const afterInset = JSON.parse(await evalJson(`JSON.stringify(window.__wp1.fit())`));
check("inset handle drag changes the fit", Math.abs(afterInset.b - afterSurface.b) > 0.05 || Math.abs(afterInset.w - afterSurface.w) > 0.05, `fit -> ${afterInset.w.toFixed(2)},${afterInset.b.toFixed(2)}`);

/* ---- 3. ?step=2 (animated, non-shot) -------------------------------- */
await send("Page.navigate", { url: `${base}/?step=2` });
await sleep(4500); // boot + instant scroll + ~1s of scene tweens
const stepProbe = await evalJson(`JSON.stringify({
  scene: window.__wp1.scene(),
  step: window.__wp1.step(),
  fit: window.__wp1.fit(),
  minimap: document.querySelector('#minimap-panel').dataset.visible,
  hero: document.querySelector('#hero-overlay').dataset.visible,
})`);
const sp = JSON.parse(stepProbe);
check("?step=2 lands on task-b", sp.scene === "task-b" && sp.step === 2, stepProbe);
check("?step=2 fit eased to the task-b target", Math.abs(sp.fit.w - -0.35) < 0.02 && Math.abs(sp.fit.b - 0.8) < 0.02, `fit ${sp.fit.w}, ${sp.fit.b}`);
check("?step=2 shows minimap, hides hero", sp.minimap === "true" && sp.hero === "false", stepProbe);

ws.close();
proc.kill();
try {
  rmSync(profile, { recursive: true, force: true });
} catch {
  // temp profile may still be locked; harmless
}
process.exit(failures === 0 ? 0 : 1);
