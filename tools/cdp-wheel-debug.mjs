/**
 * cdp-wheel-debug.mjs — instrument reader wheel events under CDP dispatch
 * and report what the page sees. Diagnostics for the WP-A1 gate.
 *
 * Usage: node tools/cdp-wheel-debug.mjs <url>
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const url = process.argv[2] ?? "http://localhost:4173/";

const profile = mkdtempSync(join(tmpdir(), "wheeldbg-"));
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
  const timer = setTimeout(() => reject(new Error("ws")), 15000);
  proc.stderr.on("data", (c) => {
    buf += String(c);
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
const consoleCalls = [];
ws.onmessage = (e) => {
  const msg = JSON.parse(String(e.data));
  if (msg.method === "Runtime.consoleAPICalled") {
    consoleCalls.push(
      msg.params.args.map((a) => a.value ?? a.description ?? "").join(" "),
    );
  }
  if (msg.method === "Runtime.exceptionThrown") {
    consoleCalls.push("EXCEPTION: " + JSON.stringify(msg.params.exceptionDetails).slice(0, 300));
  }
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg.result);
    pending.delete(msg.id);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: 1600,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
});
await send("Page.navigate", { url });
await new Promise((r) => setTimeout(r, 5000));

await send(
  "Runtime.evaluate",
  {
    expression:
      'window.__wheelLog = []; document.querySelector("#reader").addEventListener("wheel", (e) => window.__wheelLog.push([e.deltaY, e.deltaMode, e.defaultPrevented, String(e.target.className).slice(0, 24)]), { passive: false });',
  },
);

for (const y of [450, 451, 452]) {
  await send("Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x: 1310,
    y,
    deltaX: 0,
    deltaY: 120,
    pointerType: "mouse",
  });
}
await new Promise((r) => setTimeout(r, 500));

const logs = [];
ws.on ??= null;
// capture console API calls
pending; // noop
const r1 = await send("Runtime.evaluate", {
  expression: 'typeof window.__wp1 === "undefined" ? "NO __wp1" : JSON.stringify({ ok: true })',
  returnByValue: true,
});
console.log("probe:", r1.result.value);
console.log("wp1 type check done separately");
console.log("console:", JSON.stringify(consoleCalls, null, 1));

ws.close();
proc.kill();
try {
  rmSync(profile, { recursive: true, force: true });
} catch {}
process.exit(0);
