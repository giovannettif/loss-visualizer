/**
 * cdp-live-check.mjs — verifies the LIVE (non-shot) hero actually animates:
 * loads /, waits, captures two frames 2.5 s apart, and PASSes only if they
 * differ (race loop + camera drift must be ticking). Writes the second frame
 * to .shots/wp1-live-hero.png.
 *
 * Usage: node tools/cdp-live-check.mjs [baseUrl]
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const base = process.argv[2] ?? "http://localhost:4173";

const profile = mkdtempSync(join(tmpdir(), "cdp-live-"));
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
await send("Emulation.setDeviceMetricsOverride", {
  width: 1600,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
});
await send("Page.navigate", { url: `${base}/` });
await new Promise((r) => setTimeout(r, 5000));

const a = (await send("Page.captureScreenshot", { format: "png" })).data;
await new Promise((r) => setTimeout(r, 2500));
const b = (await send("Page.captureScreenshot", { format: "png" })).data;

const ha = createHash("sha256").update(a).digest("hex").slice(0, 12);
const hb = createHash("sha256").update(b).digest("hex").slice(0, 12);
console.log("frameA", ha);
console.log("frameB", hb);
console.log(
  ha !== hb
    ? "PASS  live hero animates (frames differ over 2.5s)"
    : "FAIL  static frames — loop/drift not running",
);
writeFileSync(".shots/wp1-live-hero.png", Buffer.from(b, "base64"));

ws.close();
proc.kill();
try {
  rmSync(profile, { recursive: true, force: true });
} catch {}
process.exit(ha !== hb ? 0 : 1);
