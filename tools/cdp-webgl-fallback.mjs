/**
 * cdp-webgl-fallback.mjs — WebGL-failure boot state check.
 *
 * Launches headless Edge with 3D APIs disabled (no WebGL context possible),
 * loads the page, and asserts the boot overlay surfaces the graceful "WebGL
 * is unavailable" message instead of a blank page or a stuck progress line.
 *
 * Usage: node tools/cdp-webgl-fallback.mjs <baseUrl>
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const base = process.argv[2] ?? "http://localhost:4173";

const profile = mkdtempSync(join(tmpdir(), "cdp-webgl-"));
const proc = spawn(
  EDGE,
  [
    "--headless=new",
    "--disable-gpu",
    "--disable-3d-apis", // no WebGL context can be created
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: 1600, height: 900, deviceScaleFactor: 1, mobile: false,
});
await send("Page.navigate", { url: `${base}/` });
await sleep(4500);

const r = await send("Runtime.evaluate", {
  expression: `(function(){
    const b = document.getElementById("boot");
    const msg = document.getElementById("boot-msg");
    return {
      overlayUp: !!b,
      errorFlag: b ? b.dataset.error === "true" : false,
      msgShown: !!msg && msg.hidden === false,
      msgText: msg ? msg.textContent : "",
      noCanvas: !document.querySelector("#stage canvas"),
    };
  })()`,
  returnByValue: true,
});
const s = r.result?.value ?? {};
check(
  "WebGL failure surfaces a graceful message on the boot overlay",
  s.overlayUp && s.errorFlag && s.msgShown &&
    /WebGL/i.test(s.msgText) && s.noCanvas,
  JSON.stringify(s),
);

console.log(`\n${failures === 0 ? "1/1" : "0/1"} checks passed`);
ws.close();
proc.kill();
try {
  rmSync(profile, { recursive: true, force: true });
} catch {
  // temp profile may still be locked; harmless
}
process.exit(failures === 0 ? 0 : 1);
