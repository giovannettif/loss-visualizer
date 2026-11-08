/**
 * cdp-a3-check.mjs — WP-A3 layout verification under the v4 reader model:
 *
 *   1. the rail is a fixed right-edge overlay, inside the viewport, that
 *      never overlaps the active step's text;
 *   2. hover names exist for every tick, and the rail's current tick tracks
 *      the active step;
 *   3. the active step fills the panel height;
 *   4. v4 continuous document: every .rstep is a full-panel page stacked in
 *      normal flow (offsetTops strictly increasing, pages adjacent, each at
 *      least one panel tall) — the next step's text really sits below;
 *   5. the document is parked on the active step (scrollTop = its park
 *      offset) once the boot animation drains.
 *
 * Usage: node tools/cdp-a3-check.mjs <url>   (default …/?step=2)
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const url = process.argv[2] ?? "http://localhost:4173/?step=2";

const profile = mkdtempSync(join(tmpdir(), "a3chk-"));
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
ws.onmessage = (e) => {
  const msg = JSON.parse(String(e.data));
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
const evalJson = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
};

let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: 1600,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
});
await send("Page.navigate", { url });
await new Promise((r) => setTimeout(r, 4500));

// Wait for the boot lock to drain before probing the parked layout.
for (let i = 0; i < 40; i++) {
  const idle = await evalJson(`({l: window.__wp1.locked(), a: window.__wp1.animating()})`);
  if (!idle.l && !idle.a) break;
  await sleep(250);
}

const probe = JSON.parse(await evalJson(`JSON.stringify((() => {
  const rail = document.querySelector('#rail').getBoundingClientRect();
  const cs = getComputedStyle(document.querySelector('#rail'));
  const panel = document.querySelector('#reader').getBoundingClientRect();
  const activeBody = document.querySelector('.rstep[data-active="true"] .step__body');
  const body = activeBody.getBoundingClientRect();
  const steps = [...document.querySelectorAll('.rstep')];
  const activeIdx = steps.findIndex((s) => s.dataset.active === "true");
  const tops = steps.map((s) => s.offsetTop);
  const heights = steps.map((s) => s.offsetHeight);
  const flowAdjacent = tops.every((t, k) =>
    k === 0 ? t === 0 : t >= tops[k - 1] + heights[k - 1] - 1);
  const strictlyIncreasing = tops.every((t, k) => k === 0 || t > tops[k - 1]);
  const allPanelTall = heights.every((h) => h >= panel.height - 2);
  const scrollTop = document.querySelector('#reader-body').scrollTop;
  const names = [...document.querySelectorAll('#rail button .tick-name')]
    .map((s) => s.textContent.trim()).filter(Boolean);
  const currentTick = [...document.querySelectorAll('#rail button')]
    .findIndex((b) => b.dataset.current === "true");
  return {
    railLeft: Math.round(rail.left),
    railRight: Math.round(rail.right),
    railTop: Math.round(rail.top),
    railBottom: Math.round(rail.bottom),
    bodyRight: Math.round(body.right),
    noOverlap: rail.left >= body.right - 2,
    inViewport: rail.right <= window.innerWidth && rail.top >= 0 && rail.bottom <= window.innerHeight,
    position: cs.position,
    nameCount: names.length,
    stepCount: steps.length,
    firstName: names[0] || null,
    sampleName: names[7] || null,
    rstepHeight: Math.round(heights[activeIdx]),
    panelHeight: Math.round(panel.height),
    fillsHeight: heights[activeIdx] >= panel.height - 2,
    activeIdx,
    currentTick,
    flowAdjacent,
    strictlyIncreasing,
    allPanelTall,
    scrollTop: Math.round(scrollTop),
    parkTop: tops[activeIdx],
    parked: Math.abs(scrollTop - tops[activeIdx]) <= 2,
  };
})())`));

check(
  "rail is a fixed right-edge overlay inside the viewport",
  probe.position === "fixed" && probe.inViewport,
  `position=${probe.position} rail=${probe.railLeft}..${probe.railRight} x ${probe.railTop}..${probe.railBottom}`,
);
check(
  "rail never overlaps the active step text",
  probe.noOverlap,
  `rail.left=${probe.railLeft} body.right=${probe.bodyRight}`,
);
check(
  "hover names exist for every tick and the current tick tracks the active step",
  probe.nameCount === probe.stepCount && probe.currentTick === probe.activeIdx &&
    Boolean(probe.firstName) && Boolean(probe.sampleName),
  `names=${probe.nameCount}/${probe.stepCount} currentTick=${probe.currentTick} active=${probe.activeIdx}`,
);
check(
  "the active step fills the panel height",
  probe.fillsHeight,
  `rstep=${probe.rstepHeight}px panel=${probe.panelHeight}px`,
);
check(
  "v4 document: steps stack in flow, strictly increasing, pages adjacent",
  probe.strictlyIncreasing && probe.flowAdjacent,
  `tops[0..2]=${JSON.stringify([probe.rstepHeight, probe.scrollTop, probe.parkTop])}`,
);
check(
  "v4 document: every step is at least one panel tall (a full page each)",
  probe.allPanelTall,
  `panel=${probe.panelHeight}px`,
);
check(
  "v4 document: parked on the active step once the boot drains",
  probe.parked,
  `scrollTop=${probe.scrollTop} park=${probe.parkTop}`,
);

ws.close();
proc.kill();
try {
  rmSync(profile, { recursive: true, force: true });
} catch {}
process.exit(failures === 0 ? 0 : 1);
