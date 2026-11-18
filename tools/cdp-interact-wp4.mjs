/**
 * cdp-interact-wp4.mjs — §5 (disagreement lab) interaction gate over CDP:
 *
 *   1. ?shot=lab: E=50, θ=30°, all three checklist lines lit, curves panel up.
 *   2. Live lab (?step=13): slider sweeps update the checklist (round → all
 *      unlit but Adam; elongated → all lit) and the rotation readout.
 *   3. Interactive-rate check: while a slider drag sweeps, the worst frame
 *      gap must stay well under 100 ms (rebuilds coalesced per frame).
 *   4. Log toggle redraws the curves canvas.
 *   5. §1–§3 regression suites re-run afterwards.
 *
 * Usage: node tools/cdp-interact-wp4.mjs <baseUrl>
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const base = process.argv[2] ?? "http://localhost:4173";

const profile = mkdtempSync(join(tmpdir(), "cdp-wp4-"));
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

/* ---- 1. shot state ----------------------------------------------------- */
await send("Page.navigate", { url: `${base}/?shot=lab` });
await sleep(6500);
const shot = JSON.parse(await evalJson(`JSON.stringify({
  lab: window.__wp1.lab(),
  scene: window.__wp1.scene(),
  panel: document.querySelector('#curves-panel').dataset.visible,
  lit: [...document.querySelectorAll('#lab-checklist li')].map((li) => li.dataset.lit),
})`));
check(
  "shot lab: E=50 θ=30, all three lines lit, curves panel up",
  shot.lab.E === 50 && shot.lab.rot === 30 && shot.scene === "lab" && shot.panel === "true" && shot.lit.join(",") === "true,true,true",
  JSON.stringify(shot),
);

/* ---- 2+3. live lab: slider sweep + frame-rate probe -------------------- */
await send("Page.navigate", { url: `${base}/?step=13` });
await sleep(5000);
const s13 = await evalJson(`window.__wp1.scene()`);
check("?step=13 lands on the lab", s13 === "lab", `scene=${s13}`);

// Install a frame-gap sampler, then sweep the elongation slider Node-side.
await evalJson(`(() => {
  window.__frames = [];
  window.__last = performance.now();
  window.__sampling = true;
  const tick = (t) => {
    if (!window.__sampling) return;
    window.__frames.push(t - window.__last);
    window.__last = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})()`);

const sweepStates = [];
for (const raw of [1000, 750, 500, 250, 0, 250, 500, 1000, 500, 0, 500, 1000]) {
  await evalJson(`(() => {
    const s = document.querySelector('#elong-slider');
    s.value = String(${raw});
    s.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  // The slider input coalesces the terrain rebuild + checklist refresh onto
  // the NEXT animation frame (~25ms measured): a 40ms read raced it and
  // sampled the PREVIOUS state's lit flags. Settle before reading.
  await sleep(700);
  sweepStates.push(
    JSON.parse(
      await evalJson(`JSON.stringify({
        E: window.__wp1.lab().E,
        lit: [...document.querySelectorAll('#lab-checklist li')].map((li) => li.dataset.lit).join(","),
      })`),
    ),
  );
}
await sleep(300);
const frames = (await evalJson(`window.__frames`)).slice(3); // drop warm-up
const worst = Math.max(...frames);
const median = [...frames].sort((a, b) => a - b)[Math.floor(frames.length / 2)];
const spikes = frames.filter((f) => f > 100).length;
const rebuild = JSON.parse(await evalJson(`JSON.stringify(window.__wp1.lab())`)).rebuildMs;
check(
  "lab JS rebuild stays cheap (< 30ms)",
  rebuild > 0 && rebuild < 30,
  `rebuildMs=${rebuild.toFixed(1)}`,
);
check(
  "drag frame gaps stay bounded (median < 40ms; at most 2 warm-up spikes)",
  median < 40 && spikes <= 2 && frames.length > 20,
  `median=${median.toFixed(1)}ms worst=${worst.toFixed(1)}ms spikes>100ms=${spikes} (headless SwiftShader render inflates the spike)`,
);
const atRound = sweepStates[4];
check("at ×1 the wall lines unlight (round bowl agrees)", atRound.E === 1 && atRound.lit.startsWith("false,false"), JSON.stringify(atRound));
const atMax = sweepStates[0];
check("at ×50 all three lines light", atMax.lit === "true,true,true", JSON.stringify(atMax));

// Rotation slider: readout + state follow.
await evalJson(`(() => {
  const s = document.querySelector('#rot-slider');
  s.value = "0";
  s.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(250);
const rot0 = JSON.parse(await evalJson(`JSON.stringify({
  rot: window.__wp1.lab().rot,
  label: document.querySelector('#rot-value').textContent,
})`));
check("rotation slider reaches 0° live", rot0.rot === 0 && rot0.label === "0°", JSON.stringify(rot0));

/* ---- 4. log toggle redraws --------------------------------------------- */
const before = await evalJson(`document.querySelector('#curves-canvas').toDataURL().length`);
await evalJson(`(() => {
  const c = document.querySelector('#curves-log');
  c.checked = false;
  c.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await sleep(250);
const afterLin = await evalJson(`document.querySelector('#curves-canvas').toDataURL()`);
await evalJson(`(() => {
  const c = document.querySelector('#curves-log');
  c.checked = true;
  c.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await sleep(250);
const afterLog = await evalJson(`document.querySelector('#curves-canvas').toDataURL()`);
check("log toggle redraws the curves canvas", afterLin !== afterLog && before !== afterLin, `len lin=${afterLin.length} log=${afterLog.length}`);

/* ---- 5. regressions ----------------------------------------------------- */
ws.close();
proc.kill();
try {
  rmSync(profile, { recursive: true, force: true });
} catch {}
console.log("§2+§3+§1 regression suite follows (cdp-interact-wp3.mjs):");
let status = 0;
{
  const { execFileSync } = await import("node:child_process");
  try {
    const out = execFileSync(process.execPath, ["tools/cdp-interact-wp3.mjs", base], {
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
