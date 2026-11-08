/**
 * cdp-interact-gd.mjs — §2 (GD intro) interaction gate, driven over CDP:
 *
 *   1. ?shot=gd-b carries the deterministic pose (user arrow + GD step tip).
 *   2. Live ?step=5 (gd-b): dragging on the minimap canvas previews the user
 *      arrow and, on release, commits it + GD's red step tip.
 *   3. Live ?step=6 (gd-c): the η slider sweeps all FOUR regimes with the
 *      label + readout + trajectory step count following.
 *   4. Live ?step=4 (gd-a): the needle-drift point actually drifts.
 *   5. §1 regression: the earlier cdp-interact.mjs suite still passes.
 *
 * Usage: node tools/cdp-interact-gd.mjs <baseUrl>
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const base = process.argv[2] ?? "http://localhost:4173";

const profile = mkdtempSync(join(tmpdir(), "cdp-gd-"));
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

/* ---- 1. shot pose ---------------------------------------------------- */
await send("Page.navigate", { url: `${base}/?shot=gd-b` });
await sleep(6000);
const shotGd = JSON.parse(await evalJson(`JSON.stringify(window.__wp1.gd())`));
check(
  "shot gd-b has the drawn user arrow + GD step tip",
  shotGd.userTip !== null && shotGd.gdTip !== null,
  JSON.stringify(shotGd),
);

/* ---- 2. minimap drag on live gd-b ------------------------------------ */
await send("Page.navigate", { url: `${base}/?step=5` });
await sleep(5000);
const scene5 = await evalJson(`window.__wp1.scene()`);
check("?step=5 lands on gd-b", scene5 === "gd-b", `scene=${scene5}`);
const beforeDrag = JSON.parse(await evalJson(`JSON.stringify(window.__wp1.gd())`));
check("live gd-b starts with no drawn arrows", beforeDrag.userTip === null && beforeDrag.gdTip === null, JSON.stringify(beforeDrag));

const rect = JSON.parse(await evalJson(
  `JSON.stringify(document.querySelector('#minimap-canvas').getBoundingClientRect())`,
));
const x0 = rect.x + 60;
const y0 = rect.y + 50;
await send("Input.dispatchMouseEvent", {
  type: "mousePressed", x: Math.round(x0), y: Math.round(y0),
  button: "left", buttons: 1, clickCount: 1, pointerType: "mouse",
});
for (let i = 1; i <= 8; i++) {
  await send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: Math.round(x0 + (40 * i) / 8), y: Math.round(y0 - (25 * i) / 8),
    button: "left", buttons: 1, pointerType: "mouse",
  });
  await sleep(16);
}
const duringDrag = JSON.parse(await evalJson(`JSON.stringify(window.__wp1.gd())`));
check("minimap drag previews the user arrow", duringDrag.userTip !== null, JSON.stringify(duringDrag.userTip));
await send("Input.dispatchMouseEvent", {
  type: "mouseReleased", x: Math.round(x0 + 40), y: Math.round(y0 - 25),
  button: "left", buttons: 0, clickCount: 1, pointerType: "mouse",
});
await sleep(900); // the red GD step animates in over ~0.7s
const afterDrag = JSON.parse(await evalJson(`JSON.stringify(window.__wp1.gd())`));
check("commit keeps the user arrow", afterDrag.userTip !== null, JSON.stringify(afterDrag.userTip));
check("commit reveals GD's red step tip", afterDrag.gdTip !== null, JSON.stringify(afterDrag.gdTip));

/* ---- 3. eta slider sweeps all four regimes --------------------------- */
await send("Page.navigate", { url: `${base}/?step=6` });
await sleep(5000);
const c0 = JSON.parse(await evalJson(`JSON.stringify({
  scene: window.__wp1.scene(),
  gd: window.__wp1.gd(),
  label: document.querySelector('#eta-regime').textContent,
  value: document.querySelector('#eta-value').textContent,
})`));
check("?step=6 lands on gd-c descending at mid-slider", c0.scene === "gd-c" && c0.label === "descending" && Math.abs(c0.gd.eta - 0.0632) < 0.01, JSON.stringify(c0));

async function slideTo(pos) {
  await evalJson(`(() => {
    const s = document.querySelector('#eta-slider');
    s.value = String(${pos});
    s.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(120);
  return JSON.parse(await evalJson(`JSON.stringify({
    gd: window.__wp1.gd(),
    label: document.querySelector('#eta-regime').textContent,
    value: document.querySelector('#eta-value').textContent,
  })`));
}

const rCrawl = await slideTo(60);
check("slider far left -> crawling", rCrawl.label === "crawling" && rCrawl.gd.regime === "crawling", `eta=${rCrawl.gd.eta} label=${rCrawl.label} steps=${rCrawl.gd.pathSteps}`);
const rDesc = await slideTo(400);
check("slider low-mid -> descending", rDesc.label === "descending", `eta=${rDesc.gd.eta} label=${rDesc.label}`);
const rOsc = await slideTo(820);
check("slider high-mid -> oscillating", rOsc.label === "oscillating", `eta=${rOsc.gd.eta} label=${rOsc.label} steps=${rOsc.gd.pathSteps}`);
const rDiv = await slideTo(990);
check("slider far right -> diverging", rDiv.label === "diverging", `eta=${rDiv.gd.eta} label=${rDiv.label} steps=${rDiv.gd.pathSteps}`);
check("trajectory re-runs per eta (crawl vs osc end far apart)", (() => {
  const a = rCrawl.gd.pathEnd;
  const b = rOsc.gd.pathEnd;
  if (!a || !b) return false;
  return Math.hypot(a.x - b.x, a.y - b.y) > 2;
})(), `crawlEnd=${JSON.stringify(rCrawl.gd.pathEnd)} oscEnd=${JSON.stringify(rOsc.gd.pathEnd)}`);
// The strongest proof of a live re-run: diverging leaves the extent in 1 step.
check("diverging trajectory collapses to the extent edge", rDiv.gd.pathSteps <= 3, `steps=${rDiv.gd.pathSteps}`);
check("eta readout is monospace-formatted", /^[0-9]+\.[0-9]+$/.test(rDesc.value), `value=${rDesc.value}`);

/* ---- 4. gd-a needle drift (live) ------------------------------------- */
await send("Page.navigate", { url: `${base}/?step=4` });
await sleep(2500);
const driftA = JSON.parse(await evalJson(`JSON.stringify(window.__wp1.gd().point)`));
await sleep(2000);
const driftB = JSON.parse(await evalJson(`JSON.stringify(window.__wp1.gd().point)`));
const moved = Math.hypot(driftB.x - driftA.x, driftB.y - driftA.y);
check("gd-a point drifts so the needle swings", moved > 0.05, `moved=${moved.toFixed(3)}`);

/* ---- 5. §1 regression via the WP1 suite ------------------------------ */
ws.close();
proc.kill();
try {
  rmSync(profile, { recursive: true, force: true });
} catch {}
console.log("§1 regression suite follows:");
const { status } = await (async () => {
  const { execFileSync } = await import("node:child_process");
  try {
    const out = execFileSync(process.execPath, ["tools/cdp-interact.mjs", base], {
      encoding: "utf8",
      timeout: 240000,
    });
    process.stdout.write(out);
    return { status: 0 };
  } catch (e) {
    process.stdout.write(String(e.stdout ?? e.message));
    return { status: 1 };
  }
})();
process.exit(failures === 0 && status === 0 ? 0 : 1);
