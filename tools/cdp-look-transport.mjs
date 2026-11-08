/**
 * cdp-look-transport.mjs — live CDP verification for the two P4 features:
 *
 *   1. HOVER-TO-LOOK: hovering (and keyboard-focusing) a wired data-look span
 *      spotlights its scene target — the director's look state flips on, the
 *      scene dims, the target panel/ring lights, and non-target layers dim.
 *      Leaving the span clears everything. It must never lock or advance.
 *   2. TRANSPORT: ▶/❚❚ toggle, ↻ Replay, scrub bar with live progress,
 *      0.5×/1×/2× speeds — and Space keeps its reader semantics.
 *
 * Usage: node tools/cdp-look-transport.mjs [baseUrl]
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const base = process.argv[2] ?? "http://localhost:4173";

const profile = mkdtempSync(join(tmpdir(), "cdp-look-"));
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
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
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

/** Navigate to ?step=N and wait until the entry animation fully drains. */
async function gotoStep(n, settle = 9000) {
  await send("Page.navigate", { url: `${base}/?step=${n}` });
  await sleep(3500);
  const t0 = Date.now();
  for (;;) {
    const locked = await evalJson(`window.__wp1.locked()`);
    if (!locked) break;
    if (Date.now() - t0 > settle) break;
    await sleep(300);
  }
  await sleep(400);
}

/** Real pointer hover over the ACTIVE step's span for a look key. Spans
 *  wrap, so the rect center can fall in inter-line whitespace: probe a grid
 *  of points and pick one the hit-test resolves to the span itself. */
async function hover(key) {
  const keyJson = JSON.stringify(key);
  const pt = await evalJson(`(() => {
      const el = document.querySelector('.rstep[data-active="true"] [data-look="' + ${keyJson} + '"]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const pts = [];
      for (const fy of [0.15, 0.35, 0.55, 0.75, 0.95]) {
        for (const fx of [0.08, 0.3, 0.5, 0.7, 0.92]) {
          pts.push([r.left + r.width * fx, r.top + r.height * fy]);
        }
      }
      for (const [x, y] of pts) {
        const hit = document.elementFromPoint(x, y);
        if (hit && (hit === el || el.contains(hit))) return { x, y };
      }
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, miss: true };
    })()`);
  if (!pt) throw new Error(`hover target not found: ${key}`);
  const x = Math.round(pt.x);
  const y = Math.round(pt.y);
  await send("Input.dispatchMouseEvent", {
    type: "mouseMoved", x: 400, y: 450, pointerType: "mouse",
  });
  await sleep(120);
  await send("Input.dispatchMouseEvent", {
    type: "mouseMoved", x, y, pointerType: "mouse",
  });
  await sleep(1000); // the 0.7s dim transition
  return { x, y, miss: pt.miss === true };
}

async function unhover() {
  await send("Input.dispatchMouseEvent", {
    type: "mouseMoved", x: 8, y: 8, pointerType: "mouse",
  });
  await sleep(1000);
}

const opacity = (sel) =>
  evalJson(`Number(getComputedStyle(document.querySelector(${JSON.stringify(sel)})).opacity)`);

/* ==================== 1. hover-to-look: §1 fit inset ==================== */

await gotoStep(1); // task-a: fit inset + loss panel + minimap all visible
let st = await evalJson(`JSON.stringify(window.__wp1.look())`);
check("baseline: no look active", JSON.parse(st).id === null && !JSON.parse(st).sceneDim, st);

const hov = await hover("fit-inset");
st = JSON.parse(await evalJson(`JSON.stringify(window.__wp1.look())`));
check("hover fit-inset: look id set", st.id === "fit-inset", st);
check("hover fit-inset: scene dims", st.sceneDim === true, st);
check("hover fit-inset: fit panel spotted", st.spotPanels.includes("fit-panel"), st);

const fitOp = await opacity("#fit-panel");
const mapOp = await opacity("#minimap-panel");
const lossOp = await opacity("#loss-panel");
check("hover fit-inset: target panel full opacity", fitOp > 0.9, `fit-panel=${fitOp}`);
check("hover fit-inset: NON-target panels dim", mapOp < 0.5 && lossOp < 0.5, `minimap=${mapOp} loss=${lossOp}`);

const locked = await evalJson(`window.__wp1.locked()`);
const stepIdx = await evalJson(`window.__wp1.step()`);
check("hover never fights the step lock", locked === false && stepIdx === 1, `locked=${locked} step=${stepIdx}`);

await unhover();
st = JSON.parse(await evalJson(`JSON.stringify(window.__wp1.look())`));
check("unhover clears the spotlight", st.id === null && st.sceneDim === false && st.spotPanels.length === 0, st);
const mapOpAfter = await opacity("#minimap-panel");
check("unhover restores panel opacity", mapOpAfter > 0.9, `minimap=${mapOpAfter}`);

/* ---------------- keyboard focus path ---------------- */

await evalJson(`document.querySelector('.rstep[data-active="true"] [data-look="fit-inset"]').focus()`);
await sleep(900);
st = JSON.parse(await evalJson(`JSON.stringify(window.__wp1.look())`));
check("keyboard focus lights the spotlight", st.id === "fit-inset" && st.sceneDim === true, st);
await evalJson(`document.activeElement.blur()`);
await sleep(900);
st = JSON.parse(await evalJson(`JSON.stringify(window.__wp1.look())`));
check("blur clears the spotlight", st.id === null && st.sceneDim === false, st);

/* ==================== 2. needle spotlight on the compass ==================== */

await gotoStep(4); // gd-a: the drifting needle
await hover("needle");
st = JSON.parse(await evalJson(`JSON.stringify(window.__wp1.look())`));
check("hover needle: minimap spotlighted", st.id === "needle" && st.spotPanels.includes("minimap-panel"), st);
check("hover needle: minimap needle glow lit", st.minimapSpot === true, st);
check("hover needle: scene dims", st.sceneDim === true, st);
await unhover();

/* ==================== 2b. §1 ball spotlight (task-c) ==================== */

await gotoStep(3); // task-c: "Drag the white point"
await hover("ball");
st = JSON.parse(await evalJson(`JSON.stringify(window.__wp1.look())`));
check("hover ball: ring at the white point", st.id === "ball" && st.ring === true, st);
check("hover ball: scene dims", st.sceneDim === true, st);
await unhover();

/* ==================== 3. ring spotlight on gd-b's red step ==================== */

await gotoStep(5); // gd-b
await hover("gd-step");
st = JSON.parse(await evalJson(`JSON.stringify(window.__wp1.look())`));
check("hover gd-step: spotlight ring ON", st.id === "gd-step" && st.ring === true, st);
check("hover gd-step: scene dims", st.sceneDim === true, st);
await unhover();
st = JSON.parse(await evalJson(`JSON.stringify(window.__wp1.look())`));
check("gd-step unhover: ring off", st.ring === false && st.id === null, st);

/* ==================== 4. trail spotlight in §3 ==================== */

await gotoStep(8); // mom-a: GD red + momentum blue trails
await hover("trail-mom");
st = JSON.parse(await evalJson(`JSON.stringify(window.__wp1.look())`));
check("hover trail-mom: trail kept bright", st.id === "trail-mom" && st.keptTrails === 1, st);
check("hover trail-mom: scene dims", st.sceneDim === true, st);
await unhover();

/* ==================== 5. §4 arrows spotlight ==================== */

await gotoStep(11); // adam-a
await hover("adam-arrows");
st = JSON.parse(await evalJson(`JSON.stringify(window.__wp1.look())`));
check("hover adam-arrows: ring at the inspected point", st.id === "adam-arrows" && st.ring === true, st);
await unhover();

/* ==================== 5b. §5 lab trails spotlight ==================== */

await gotoStep(14); // §5 second lab step: "all three trails coincide"
await hover("trails-all");
st = JSON.parse(await evalJson(`JSON.stringify(window.__wp1.look())`));
check("hover trails-all: three trails kept bright", st.id === "trails-all" && st.keptTrails === 3, st);
check("hover trails-all: scene dims", st.sceneDim === true, st);
await hover("trail-adam");
st = JSON.parse(await evalJson(`JSON.stringify(window.__wp1.look())`));
check("hover trail-adam: only Adam's trail kept", st.id === "trail-adam" && st.keptTrails === 1, st);
await unhover();

/* ==================== 6. transport: ▶/❚❚/↻/scrub/speeds ==================== */

await gotoStep(6); // gd-c: transport scene
const vis = JSON.parse(await evalJson(`JSON.stringify({
  play: !document.querySelector('#play-btn').hidden,
  replay: !document.querySelector('#replay-btn').hidden,
  scrub: !document.querySelector('#replay-scrub').hidden,
  speed: !document.querySelector('#speed-wrap').hidden,
})`));
check("transport: all four controls visible", vis.play && vis.replay && vis.scrub && vis.speed, JSON.stringify(vis));

await evalJson(`document.querySelector('#play-btn').click()`);
await sleep(700);
let ri = JSON.parse(await evalJson(`JSON.stringify(window.__wp1.replayInfo())`));
check("play: replay starts", ri.playing === true && ri.progress > 0, JSON.stringify(ri));
const progA = ri.progress;

const label = await evalJson(`document.querySelector('#play-btn').textContent`);
check("play button reads ❚❚ Pause while playing", /Pause/.test(label), label);

await evalJson(`document.querySelector('#play-btn').click()`);
await sleep(300);
ri = JSON.parse(await evalJson(`JSON.stringify(window.__wp1.replayInfo())`));
const pausedProg = ri.progress;
check("pause: replay freezes", ri.playing === false && ri.paused === true, JSON.stringify(ri));
await sleep(600);
ri = JSON.parse(await evalJson(`JSON.stringify(window.__wp1.replayInfo())`));
check("pause: progress stays frozen", Math.abs(ri.progress - pausedProg) < 0.01, `${pausedProg} -> ${ri.progress}`);

const progVar = await evalJson(`document.querySelector('#transport').style.getPropertyValue('--replay-progress')`);
check("progress var drives the control fill", Number(progVar) > 0.02, `--replay-progress=${progVar}`);

await evalJson(`document.querySelector('#play-btn').click()`);
await sleep(300);
ri = JSON.parse(await evalJson(`JSON.stringify(window.__wp1.replayInfo())`));
check("resume: plays from the parked spot", ri.playing === true && Math.abs(ri.progress - pausedProg) < 0.05, JSON.stringify(ri));

await evalJson(`
  const s = document.querySelector('#replay-scrub');
  s.value = "500";
  s.dispatchEvent(new Event('input', { bubbles: true }));
`);
await sleep(300);
ri = JSON.parse(await evalJson(`JSON.stringify(window.__wp1.replayInfo())`));
check("scrub to 0.5 parks the replay there", Math.abs(ri.progress - 0.5) < 0.02 && ri.paused === true, JSON.stringify(ri));

await evalJson(`document.querySelector('#replay-btn').click()`);
await sleep(500);
ri = JSON.parse(await evalJson(`JSON.stringify(window.__wp1.replayInfo())`));
check("replay: restarts from the top", ri.playing === true && ri.progress < progA, JSON.stringify(ri));

await evalJson(`document.querySelector('#speed-wrap button[data-speed="0.5"]').click()`);
await sleep(200);
ri = JSON.parse(await evalJson(`JSON.stringify(window.__wp1.replayInfo())`));
check("speed switch to 0.5×", ri.speed === 0.5, JSON.stringify(ri));
await evalJson(`document.querySelector('#speed-wrap button[data-speed="1"]').click()`);

/* ==================== 7. Space semantics preserved ==================== */

await gotoStep(2, 3000); // task-b: parked, unlocked
const beforeStep = await evalJson(`window.__wp1.step()`);
await send("Input.dispatchKeyEvent", { type: "keyDown", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
await send("Input.dispatchKeyEvent", { type: "keyUp", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
await sleep(700); // advance lands; the entry lock is still held (~1 s)
let nowStep = await evalJson(`window.__wp1.step()`);
const advanced = nowStep === beforeStep + 1;
check("Space at rest advances the reader", advanced, `step ${beforeStep} -> ${nowStep}`);

// The advance just locked the incoming step's entry animation. Space DURING
// the lock = Skip: it must drain the animation and unlock.
const lockedNow = await evalJson(`window.__wp1.locked()`);
check("the advance is holding its lock", lockedNow === true, `locked=${lockedNow}`);
await send("Input.dispatchKeyEvent", { type: "keyDown", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
await send("Input.dispatchKeyEvent", { type: "keyUp", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
await sleep(600);
const lockedAfterSpace = await evalJson(`window.__wp1.locked()`);
check("Space during a lock skips the animation (unlocks)", lockedAfterSpace === false, `locked=${lockedAfterSpace}`);

ws.close();
proc.kill();
try {
  rmSync(profile, { recursive: true, force: true });
} catch {
  // temp profile may still be locked; harmless
}
process.exit(failures === 0 ? 0 : 1);
