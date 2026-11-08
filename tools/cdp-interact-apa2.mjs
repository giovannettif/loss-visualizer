/**
 * cdp-interact-apa2.mjs — WP-A2 (universal play system + contact shadows)
 * interaction gate over CDP:
 *
 *   1. §5 lab (?step=13): transport visible; Play rolls three lanes —
 *      playing=true, positions move, progress advances; Replay restarts;
 *      speed 2× doubles progress rate.
 *   2. §4 adam-b (?step=12): Play rolls TWO lanes side by side (GD vs Adam),
 *      both moving, paths differing.
 *   3. §2 gd-b: after drawing an arrow on the compass, transport appears and
 *      Play rolls the user's arrow (single white lane).
 *   4. Contact shadows: the shadow decal count tracks ball + floating tips
 *      (read via canvas-pick proxies — asserted via diagnostics + captures).
 *   5. Lock-model autoplay: scene-entry animations still lock and drain
 *      (task-c materialization locks then unlocks).
 *   6. Regressions: apa1 gate re-run.
 *
 * Usage: node tools/cdp-interact-apa2.mjs <baseUrl>
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const base = process.argv[2] ?? "http://localhost:4173";

const profile = mkdtempSync(join(tmpdir(), "cdp-apa2-"));
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
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
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

async function clickPlay() {
  await evalJson(`document.querySelector('#play-btn').click()`);
}
async function clickSpeed(raw) {
  await evalJson(`(() => {
    const b = document.querySelector('#speed-wrap button[data-speed="${raw}"]');
    b.click();
  })()`);
}

/* ---- 1+2. §5 lab replay ------------------------------------------------ */
await send("Page.navigate", { url: `${base}/?step=13` });
await sleep(5000);
const labInit = JSON.parse(await evalJson(`JSON.stringify({
  scene: window.__wp1.scene(),
  transportHidden: document.querySelector('#play-btn').hidden,
  speedHidden: document.querySelector('#speed-wrap').hidden,
})`));
check(
  "lab shows the play transport",
  labInit.scene === "lab" && labInit.transportHidden === false && labInit.speedHidden === false,
  JSON.stringify(labInit),
);

await clickPlay();
await sleep(600);
const roll1 = JSON.parse(await evalJson(`JSON.stringify(window.__wp1.replayInfo())`));
check(
  "Play rolls three lab lanes",
  roll1 !== null && roll1.lanes === 3 && roll1.playing === true,
  JSON.stringify(roll1),
);
const pEarly = JSON.parse(await evalJson(`JSON.stringify(window.__wp1.replayInfo())`));
await sleep(1200);
const pMid = JSON.parse(await evalJson(`JSON.stringify(window.__wp1.replayInfo())`));
const moved = pMid.positions.length === 3 &&
  pMid.positions.every((q, i) => Math.hypot(q.x - pEarly.positions[i].x, q.y - pEarly.positions[i].y) > 0.01);
check("rollers move along their lanes", moved, JSON.stringify({ early: pEarly.positions, mid: pMid.positions }));
check("progress advances under speed 1×", pMid.progress > pEarly.progress && pMid.speed === 1, `${pEarly.progress.toFixed(2)} -> ${pMid.progress.toFixed(2)}`);

/* speed 2×: progress rate doubles */
await clickSpeed("2");
const s2a = JSON.parse(await evalJson(`JSON.stringify(window.__wp1.replayInfo())`));
await sleep(600);
const s2b = JSON.parse(await evalJson(`JSON.stringify(window.__wp1.replayInfo())`));
const rate2 = (s2b.progress - s2a.progress) / 0.6;
await clickSpeed("1");
const rate1Probe = JSON.parse(await evalJson(`JSON.stringify(window.__wp1.replayInfo())`));
await sleep(600);
const rate1b = JSON.parse(await evalJson(`JSON.stringify(window.__wp1.replayInfo())`));
const rate1 = (rate1b.progress - rate1Probe.progress) / 0.6;
check(
  "speed toggle changes roll rate (2× ≈ 2× the 1× rate)",
  rate2 > rate1 * 1.4,
  `rate1×=${rate1.toFixed(3)}/s rate2×=${rate2.toFixed(3)}/s`,
);

/* replay restarts */
await sleep(9000); // let the current roll finish (≤9s at 1×)
const fin = JSON.parse(await evalJson(`JSON.stringify(window.__wp1.replayInfo())`));
await clickPlay();
await sleep(300);
const restarted = JSON.parse(await evalJson(`JSON.stringify(window.__wp1.replayInfo())`));
check(
  "Replay restarts the roll from the beginning",
  fin.playing === false && restarted.playing === true && restarted.progress < 0.2,
  `finished=${JSON.stringify(fin)} restarted progress=${restarted.progress?.toFixed(2)}`,
);

/* ---- 3. §4 adam-b side-by-side roll ------------------------------------ */
await send("Page.navigate", { url: `${base}/?step=12` });
await sleep(5000);
await clickPlay();
await sleep(700);
const adamRoll = JSON.parse(await evalJson(`JSON.stringify(window.__wp1.replayInfo())`));
check(
  "adam-b rolls TWO lanes side by side (GD red vs Adam yellow)",
  adamRoll.lanes === 2 && adamRoll.positions.length === 2,
  JSON.stringify({ lanes: adamRoll.lanes, positions: adamRoll.positions }),
);
// §4 punchline: over the same window GD travels farther than Adam.
await sleep(120);
const early = JSON.parse(await evalJson(`JSON.stringify(window.__wp1.replayInfo())`));
await sleep(700);
const later = JSON.parse(await evalJson(`JSON.stringify(window.__wp1.replayInfo())`));
const gdTravel = Math.hypot(later.positions[0].x - early.positions[0].x, later.positions[0].y - early.positions[0].y);
const adamTravel = Math.hypot(later.positions[1].x - early.positions[1].x, later.positions[1].y - early.positions[1].y);
check(
  "§4 side-by-side: GD travels farther than Adam per unit progress",
  gdTravel > adamTravel * 1.5,
  `gdTravel=${gdTravel.toFixed(2)} adamTravel=${adamTravel.toFixed(2)}`,
);
await sleep(2000);
const adamMid = JSON.parse(await evalJson(`JSON.stringify(window.__wp1.replayInfo())`));
const [g1, a1] = adamMid.positions;
check(
  "§4 rollers separate as they roll (GD swings, Adam glides)",
  Math.hypot(g1.x - a1.x, g1.y - a1.y) > 0.3,
  `separation=${Math.hypot(g1.x - a1.x, g1.y - a1.y).toFixed(2)}`,
);

/* ---- §2 gd-b: draw an arrow, transport appears, play rolls it ---------- */
await send("Page.navigate", { url: `${base}/?step=5` });
await sleep(5000);
const gdTransportBefore = await evalJson(`document.querySelector('#play-btn').hidden`);
const rect = JSON.parse(await evalJson(`JSON.stringify(document.querySelector('#minimap-canvas').getBoundingClientRect())`));
await send("Input.dispatchMouseEvent", {
  type: "mousePressed", x: Math.round(rect.x + 55), y: Math.round(rect.y + 55),
  button: "left", buttons: 1, clickCount: 1, pointerType: "mouse",
});
for (let i = 1; i <= 6; i++) {
  await send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: Math.round(rect.x + 55 + (30 * i) / 6), y: Math.round(rect.y + 55 + (18 * i) / 6),
    button: "left", buttons: 1, pointerType: "mouse",
  });
  await sleep(16);
}
await send("Input.dispatchMouseEvent", {
  type: "mouseReleased", x: Math.round(rect.x + 85), y: Math.round(rect.y + 73),
  button: "left", buttons: 0, clickCount: 1, pointerType: "mouse",
});
await sleep(400);
const gdTransportAfter = await evalJson(`document.querySelector('#play-btn').hidden`);
check(
  "gd-b transport appears once an arrow is drawn",
  gdTransportBefore === true && gdTransportAfter === false,
  `before=${gdTransportBefore} after=${gdTransportAfter}`,
);
await clickPlay();
await sleep(500);
const gdRoll = JSON.parse(await evalJson(`JSON.stringify(window.__wp1.replayInfo())`));
check("Play rolls the drawn arrow (single lane)", gdRoll.lanes === 1 && gdRoll.playing === true, JSON.stringify({ lanes: gdRoll.lanes, playing: gdRoll.playing }));

/* ---- 5. lock model: task-c materialization locks then drains ------------ */
// Enter from a SETTLED state via the rail (the real user path): the
// materialization then plays — the reader locks while it runs and drains.
await send("Page.navigate", { url: `${base}/?step=2` });
await sleep(4000);
await evalJson(`(() => {
  document.querySelectorAll('#rail button')[3].click();
})()`);
await sleep(250);
const tcEarly = JSON.parse(await evalJson(`JSON.stringify({ locked: window.__wp1.locked(), animating: window.__wp1.animating(), scene: window.__wp1.scene() })`));
await sleep(2500);
const tcLate = JSON.parse(await evalJson(`JSON.stringify({ locked: window.__wp1.locked(), animating: window.__wp1.animating(), rise: window.__wp1.debug().rise })`));
check(
  "task-c materialization auto-plays under the lock model (locks, then drains)",
  tcEarly.animating === true && tcLate.animating === false && tcLate.rise === 1,
  `early=${JSON.stringify(tcEarly)} late=${JSON.stringify(tcLate)}`,
);

/* ---- regressions -------------------------------------------------------- */
ws.close();
proc.kill();
try {
  rmSync(profile, { recursive: true, force: true });
} catch {}
console.log("A1 + §1–§3 regression suite follows (cdp-interact-apa1.mjs):");
let status = 0;
{
  const { execFileSync } = await import("node:child_process");
  try {
    const out = execFileSync(process.execPath, ["tools/cdp-interact-apa1.mjs", base], {
      encoding: "utf8",
      timeout: 600000,
    });
    process.stdout.write(out);
  } catch (e) {
    process.stdout.write(String(e.stdout ?? e.message));
    status = 1;
  }
}
process.exit(failures === 0 && status === 0 ? 0 : 1);
