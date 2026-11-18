/**
 * diag-tour-v2-wheel — why does a wheel burst not cross a boundary while
 * the v2 tour is running on task-b? Replays the apa1 §14 sequence and dumps
 * scroll()/tour()/locked after each step.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const base = process.argv[2] ?? "http://localhost:4173";
const profile = mkdtempSync(join(tmpdir(), "diag-tourv2-"));
const proc = spawn(EDGE, [
  "--headless=new", "--disable-gpu", "--hide-scrollbars", "--window-size=1600,900",
  "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });
const wsUrl = await new Promise((resolve, reject) => {
  let buf = "";
  const t = setTimeout(() => reject(new Error("no ws")), 15000);
  proc.stderr.on("data", (c) => {
    buf += c.toString();
    const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
    if (m) { clearTimeout(t); resolve(m[1]); }
  });
});
const port = wsUrl.match(/ws:\/\/127\.0\.0\.1:(\d+)\//)?.[1];
let pageWs = null;
for (let i = 0; i < 40 && !pageWs; i++) {
  await new Promise((r) => setTimeout(r, 250));
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const p = list.find((t) => t.type === "page");
  if (p) pageWs = p.webSocketDebuggerUrl;
}
const ws = new WebSocket(pageWs);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(String(ev.data));
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  }
};
const send = (m, p = {}) => new Promise((res, rej) => {
  const id = ++seq;
  pending.set(id, { resolve: res, reject: rej });
  ws.send(JSON.stringify({ id, method: m, params: p }));
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
};
await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: `${base}/?step=2` });
await sleep(4500);
for (let i = 0; i < 30; i++) {
  const s = JSON.parse(await ev(`JSON.stringify({l:window.__wp1.locked(),a:window.__wp1.animating()})`));
  if (!s.l && !s.a) break;
  await sleep(150);
}
await sleep(400);
const wheel = (x, y, dy) => send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY: dy, pointerType: "mouse" });
const dump = async (tag) => {
  const s = JSON.parse(await ev(`JSON.stringify(window.__wp1.scroll())`));
  const t = JSON.parse(await ev(`JSON.stringify(window.__wp1.tour())`));
  console.log(tag, "step=", s.y, "target=", s.target, "tops[2,3]=", s.tops[2], s.tops[3],
    "intro=", s.intro, "| tour idx=", t.stepIndex, "phase=", t.phase, "page=", t.page, "gate=", t.gate);
};
await ev(`document.querySelector('.rstep[data-active="true"] .tour-launch').click()`);
await sleep(800);
await dump("after start    ");
await ev(`
  window.addEventListener('wheel', (e) => { (window.__wheelLog = window.__wheelLog || []).push({ y: e.deltaY, prevented: e.defaultPrevented, x: e.clientX }); }, { passive: true, capture: true });
  true`);
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 });
await sleep(600);
await dump("after ArrowUp  ");
await send("Input.dispatchKeyEvent", { type: "keyDown", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
await sleep(1200);
await dump("after Space    ");
for (let i = 0; i < 6; i++) {
  await wheel(1310, 450, 120);
  await sleep(60);
}
await sleep(600);
await dump("after 6 wheels ");
console.log("wheelLog:", JSON.stringify(await ev(`window.__wheelLog || []`)));
console.log("elementAt(1310,450):", await ev(`(() => { const el = document.elementFromPoint(1310, 450); return el ? el.tagName + "." + el.className + "#" + (el.closest('.rstep')?.dataset.scene ?? "") : "none"; })()`));
ws.close();
proc.kill();
try { rmSync(profile, { recursive: true, force: true }); } catch {}
