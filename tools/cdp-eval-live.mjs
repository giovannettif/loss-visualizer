/** Quick CDP eval scratch: node tools/cdp-eval-live.mjs <url> <expr> */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const url = process.argv[2] ?? "http://localhost:4173/?step=5";
const expr = process.argv[3] ?? "1+1";

const profile = mkdtempSync(join(tmpdir(), "cdp-eval-live-"));
const proc = spawn(
  EDGE,
  ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--window-size=1600,900",
   "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"],
  { stdio: ["ignore", "ignore", "pipe"] },
);
const browserWs = await new Promise((resolve, reject) => {
  let buf = "";
  const timer = setTimeout(() => reject(new Error("no devtools ws url")), 20000);
  proc.stderr.on("data", (c) => {
    buf += c.toString();
    const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
    if (m) { clearTimeout(timer); resolve(m[1]); }
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
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
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
  new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url });
await sleep(4500);
const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
console.log(JSON.stringify(r.result?.value ?? r, null, 2));
if (r.exceptionDetails) console.log("EXC:", r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
ws.close();
proc.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch {}
process.exit(0);
