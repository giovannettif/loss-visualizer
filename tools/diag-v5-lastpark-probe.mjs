/* Probe: at which viewport heights does the last park undercut maxScroll
 * (the pre-fix dead zone), and does the v5 clamp hold there? */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const base = process.argv[2] ?? "http://localhost:4173";
const profile = mkdtempSync(join(tmpdir(), "v5probe-"));
const proc = spawn(EDGE, ["--headless=new", "--disable-gpu", "--hide-scrollbars",
  "--window-size=1600,900", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"],
  { stdio: ["ignore", "ignore", "pipe"] });
const ws0 = await new Promise((res, rej) => {
  let b = ""; const t = setTimeout(() => rej(new Error("no ws")), 15000);
  proc.stderr.on("data", (c) => { b += c; const m = b.match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(t); res(m[1]); } });
});
const port = ws0.match(/ws:\/\/127\.0\.0\.1:(\d+)\//)[1];
let pageWs = null;
for (let i = 0; i < 40 && !pageWs; i++) {
  await new Promise((r) => setTimeout(r, 250));
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  pageWs = list.find((t) => t.type === "page")?.webSocketDebuggerUrl;
}
const ws = new WebSocket(pageWs);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let seq = 0; const pend = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(String(ev.data)); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } };
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pend.set(id, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id, method, params })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evalJson = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
await send("Page.enable"); await send("Runtime.enable");
await send("Page.navigate", { url: `${base}/?step=26` });
await sleep(4500);
const READER_X = 1600 - 290, Y = 450;
for (const h of [900, 800, 700, 650]) {
  await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: h, deviceScaleFactor: 1, mobile: false });
  await sleep(1200);
  const s0 = JSON.parse(await evalJson(`JSON.stringify(window.__wp1.scroll())`));
  for (let i = 0; i < 16; i++) { await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: READER_X, y: Y, deltaX: 0, deltaY: 120, pointerType: "mouse" }); await sleep(35); }
  await sleep(500);
  const s1 = JSON.parse(await evalJson(`JSON.stringify(window.__wp1.scroll())`));
  const last = s0.tops.length - 1;
  console.log(`h=${h} maxScroll=${s0.max} lastPark=${s0.tops[last]} deadZone=${s0.max - s0.tops[last]} | after hammer: target=${s1.target} y=${s1.y} step=${await evalJson("window.__wp1.step()")}`);
}
ws.close(); proc.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch {}
