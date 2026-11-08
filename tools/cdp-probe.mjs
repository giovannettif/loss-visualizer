/**
 * cdp-probe.mjs — diagnostic + screenshot driver for the WP gates.
 *
 * Launches headless Edge with a remote-debugging port, navigates to a URL,
 * waits, evaluates a layout-probe expression, and captures a screenshot —
 * all over the DevTools protocol (Node's built-in WebSocket, no deps).
 *
 * Usage: node tools/cdp-probe.mjs <url> <out.png> [waitMs]
 * Prints the layout probe JSON to stdout.
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync } from "node:fs";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const url = process.argv[2];
const out = process.argv[3];
const waitMs = Number(process.argv[4] ?? 6000);
const winW = Number(process.argv[5] ?? 1600);
const winH = Number(process.argv[6] ?? 900);

if (!url || !out) {
  console.error("usage: node tools/cdp-probe.mjs <url> <out.png> [waitMs] [w] [h]");
  process.exit(1);
}

const profile = mkdtempSync(join(tmpdir(), "cdp-probe-"));

const proc = spawn(
  EDGE,
  [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    `--window-size=${winW},${winH}`,
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);

const browserWs = await new Promise((resolve, reject) => {
  let buf = "";
  const timer = setTimeout(() => reject(new Error("no devtools ws url (15s)")), 15000);
  proc.stderr.on("data", (chunk) => {
    buf += chunk.toString();
    const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
    if (m) {
      clearTimeout(timer);
      resolve(m[1]);
    }
  });
});

// The stderr ws:// URL is the browser endpoint; find the page target.
const httpPort = browserWs.match(/ws:\/\/127\.0\.0\.1:(\d+)\//)?.[1];
if (!httpPort) throw new Error("cannot parse devtools port");
let pageWs = null;
for (let i = 0; i < 40 && !pageWs; i++) {
  await new Promise((r) => setTimeout(r, 250));
  const list = await (await fetch(`http://127.0.0.1:${httpPort}/json/list`)).json();
  const page = list.find((t) => t.type === "page");
  if (page) pageWs = page.webSocketDebuggerUrl;
}
if (!pageWs) throw new Error("no page target found");
const wsUrl = pageWs;

const ws = new WebSocket(wsUrl);
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
function send(method, params = {}) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: winW,
  height: winH,
  deviceScaleFactor: 1,
  mobile: false,
});
await send("Page.navigate", { url });
await new Promise((r) => setTimeout(r, waitMs));

const probe = await send("Runtime.evaluate", {
  expression: `JSON.stringify({
    scrollY: window.scrollY,
    innerWH: [window.innerWidth, window.innerHeight],
    stickVar: getComputedStyle(document.documentElement).getPropertyValue('--stick'),
    stageWrap: (() => { const el = document.querySelector('#stage-wrap');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, height: r.height, position: getComputedStyle(el).position }; })(),
    app: (() => { const el = document.querySelector('#app');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, height: r.height }; })(),
    steps: [...document.querySelectorAll('#text-col .step')].map((el) => {
      const r = el.getBoundingClientRect();
      return { scene: el.dataset.scene, active: el.dataset.active, top: Math.round(r.top), h: Math.round(r.height) };
    }),
    hud: Object.fromEntries(['#hero-overlay','#fit-panel','#loss-panel','#minimap-panel','#scroll-hint'].map((s) => {
      const el = document.querySelector(s);
      return [s, el ? el.dataset.visible : 'MISSING'];
    })),
    webgl: (() => { const c = document.querySelector('#stage canvas');
      return c ? [c.width, c.height] : null; })(),
  })`,
  returnByValue: true,
});
console.log(probe.result.value);

const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(out, Buffer.from(shot.data, "base64"));

ws.close();
proc.kill();
try {
  rmSync(profile, { recursive: true, force: true });
} catch {
  // Edge may still hold locks for a moment — the temp profile is harmless.
}
process.exit(0);
