/**
 * cdp-interact-wp3.mjs — §3/§4 (momentum + Adam) interaction gate over CDP:
 *
 *   1. ?shot poses: mom-a glide, mom-b overshoot+apexes, adam-a baseline,
 *      adam-b steepness maxed with the ×38 vs ×1.0 step-length proof.
 *   2. Live β slider (?step=9): sweeps zigzag → glide → overshoot with the
 *      label following.
 *   3. Live steepness slider (?step=12): the inspector angle and step
 *      lengths update live with λ1 (the acceptance criterion).
 *   4. §1/§2 regression suites re-run afterwards.
 *
 * Usage: node tools/cdp-interact-wp3.mjs <baseUrl>
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const base = process.argv[2] ?? "http://localhost:4173";

const profile = mkdtempSync(join(tmpdir(), "cdp-wp3-"));
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

/* ---- 1. shot poses ---------------------------------------------------- */
await send("Page.navigate", { url: `${base}/?shot=mom-a` });
await sleep(6000);
const ma = JSON.parse(await evalJson(`JSON.stringify(window.__wp1.mom())`));
check("shot mom-a: glide at β=0.45 with both trails", ma.beta === 0.45 && ma.regime === "glide" && ma.gdSteps > 50 && ma.momSteps > 50, JSON.stringify(ma));

await send("Page.navigate", { url: `${base}/?shot=mom-b` });
await sleep(6000);
const mb = JSON.parse(await evalJson(`JSON.stringify(window.__wp1.mom())`));
check("shot mom-b: overshoot at β=0.97 with apex markers", mb.beta === 0.97 && mb.regime === "overshoot" && mb.apexes >= 6, JSON.stringify(mb));

await send("Page.navigate", { url: `${base}/?shot=adam-a` });
await sleep(6000);
const aa = JSON.parse(await evalJson(`JSON.stringify(window.__wp1.adam())`));
check("shot adam-a: baseline inspector (s=1, angle≈12°)", aa !== null && aa.steepness === 1 && Math.abs(aa.angleDeg - 12.1) < 1 && Math.abs(aa.gdStepLen - 0.27) < 0.03, JSON.stringify(aa));

await send("Page.navigate", { url: `${base}/?shot=adam-b` });
await sleep(6000);
const ab = JSON.parse(await evalJson(`JSON.stringify(window.__wp1.adam())`));
check(
  "shot adam-b: steepness maxed — GD ×38 while Adam ×1.0",
  ab !== null && ab.steepness === 50 && ab.gdStepLen > 8 && ab.adamStepLen < 0.2 && Math.abs(aa.adamStepLen - ab.adamStepLen) / aa.adamStepLen < 0.05,
  JSON.stringify(ab),
);

/* ---- 2. live β slider (?step=8 = mom-a) ------------------------------- */
await send("Page.navigate", { url: `${base}/?step=8` });
await sleep(5000);
const s8 = await evalJson(`window.__wp1.scene()`);
check("?step=8 lands on mom-a", s8 === "mom-a", `scene=${s8}`);

async function slideBetaTo(raw) {
  await evalJson(`(() => {
    const s = document.querySelector('#beta-slider');
    s.value = String(${raw});
    s.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(150);
  return JSON.parse(await evalJson(`JSON.stringify({
    gd: window.__wp1.mom(),
    label: document.querySelector('#beta-regime').textContent,
    value: document.querySelector('#beta-value').textContent,
  })`));
}

const bZig = await slideBetaTo(0);
check("β=0.00 -> zigzag (the GD-regime label)", bZig.label === "zigzag" && bZig.gd.regime === "zigzag" && bZig.gd.momSteps > 50, `label=${bZig.label} mom=${bZig.gd.momSteps} gd=${bZig.gd.gdSteps}`);
const bGlide = await slideBetaTo(450);
check("β=0.45 -> glide", bGlide.label === "glide", `label=${bGlide.label}`);
const bOver = await slideBetaTo(970);
check("β=0.97 -> overshoot", bOver.label === "overshoot" && bOver.gd.apexes >= 6, `label=${bOver.label} apexes=${bOver.gd.apexes}`);

/* ---- 3. live steepness slider (?step=12 = adam-b) ---------------------- */
await send("Page.navigate", { url: `${base}/?step=12` });
await sleep(5000);
const s12 = await evalJson(`window.__wp1.scene()`);
check("?step=12 lands on adam-b", s12 === "adam-b", `scene=${s12}`);
const st50 = JSON.parse(await evalJson(`JSON.stringify(window.__wp1.adam())`));
check("adam-b live sits at ×50", st50.steepness === 50, JSON.stringify({ s: st50.steepness, gd: st50.gdStepLen }));

async function slideSteepTo(raw) {
  await evalJson(`(() => {
    const s = document.querySelector('#steep-slider');
    s.value = String(${raw});
    s.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(200);
  return JSON.parse(await evalJson(`JSON.stringify(window.__wp1.adam())`));
}
const st1 = await slideSteepTo(0);
check("steep slider back to ×1 updates the inspector live", st1.steepness === 1 && Math.abs(st1.gdStepLen - 0.27) < 0.03 && Math.abs(st1.angleDeg - 12.1) < 1, `s=${st1.steepness} gdLen=${st1.gdStepLen} angle=${st1.angleDeg}`);
const stMid = await slideSteepTo(1000);
check("steep slider re-maxed: angle returns to the ×50 value", Math.abs(stMid.angleDeg - 14.7) < 1 && stMid.gdStepLen > 8, `angle=${stMid.angleDeg} gdLen=${stMid.gdStepLen}`);
const adamDrift = Math.abs(st1.adamStepLen - stMid.adamStepLen) / stMid.adamStepLen;
check("adam step length ~invariant across steepness (<10% drift)", adamDrift < 0.1, `drift=${(adamDrift * 100).toFixed(1)}%`);
const gdGrowth = stMid.gdStepLen / st1.gdStepLen;
check("GD step length scales with steepness (>10× across the sweep)", gdGrowth > 10, `growth=${gdGrowth.toFixed(1)}×`);
const panelVisible = await evalJson(`document.querySelector('#adam-panel').dataset.visible`);
check("adam inspector panel visible in §4", panelVisible === "true");

/* ---- 4. §1/§2 regression ---------------------------------------------- */
ws.close();
proc.kill();
try {
  rmSync(profile, { recursive: true, force: true });
} catch {}
console.log("§2+§1 regression suite follows (cdp-interact-gd.mjs):");
let status = 0;
{
  const { execFileSync } = await import("node:child_process");
  try {
    const out = execFileSync(process.execPath, ["tools/cdp-interact-gd.mjs", base], {
      encoding: "utf8",
      timeout: 420000,
    });
    process.stdout.write(out);
  } catch (e) {
    process.stdout.write(String(e.stdout ?? e.message));
    status = 1;
  }
}
process.exit(failures === 0 && status === 0 ? 0 : 1);
