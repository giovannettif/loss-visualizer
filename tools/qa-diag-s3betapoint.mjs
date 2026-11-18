/**
 * qa-diag-s3betapoint.mjs — repro drive for TOUR-POINT-S3-BETA-GATE-STAGE.
 *
 * §3 tour step 3/5 (page 8 / mom-a, betaMoved gate) demands "slide the
 * momentum β" while its look is `trail-mom` (a STAGE target): the leader
 * dot + spotlight anchor the blue trail tip ~592px away from the demanded
 * reader-panel slider #beta-slider. Same bug class as U1-POINT-ETA (§2's
 * η gate), which was fixed by pointing the step at the `control` target
 * "eta-slider". This drive measures BOTH steps on the live build:
 *
 *   A. ?step=8 → tour s3 → Next×2 → the β gate step:
 *      dot position, gate label, lookKey, #beta-slider rect, distance.
 *   B. ?step=6 → tour s2 → Next×3 → the η gate step (the U1 precedent):
 *      dot position, gate label, lookKey, #eta-slider rect, distance.
 *
 * Usage: node tools/qa-diag-s3betapoint.mjs [baseUrl]
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const base = process.argv[2] ?? "http://localhost:4195";

const profile = mkdtempSync(join(tmpdir(), "cdp-s3beta-"));
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

const tourState = () => evalJson(`JSON.stringify(window.__wp1.tour())`).then(JSON.parse);

/** Trusted-mouse drag (raw CDP), used to satisfy the §2 arrowDrawn gate. */
async function cdpDrag(x0, y0, x1, y1) {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x0, y: y0 });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: x0, y: y0, button: "left", clickCount: 1 });
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: x0 + ((x1 - x0) * i) / steps,
      y: y0 + ((y1 - y0) * i) / steps,
      button: "left",
    });
  }
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: x1, y: y1, button: "left", clickCount: 1 });
}

/** Drag on the compass minimap like gate-tour.mjs's dragMinimap. */
async function dragMinimap(dx0, dy0, dx1, dy1) {
  const box = await evalJson(`JSON.stringify((() => {
    const r = document.getElementById('minimap-canvas').getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  })())`).then(JSON.parse);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  await cdpDrag(cx + dx0, cy + dy0, cx + dx1, cy + dy1);
}
const dotPos = () =>
  evalJson(`JSON.stringify((() => {
    const d = document.getElementById('tour-dot');
    const o = document.getElementById('tour-overlay');
    const r = d ? d.getBoundingClientRect() : null;
    return { x: r ? r.left + r.width / 2 : null, y: r ? r.top + r.height / 2 : null, on: o ? o.dataset.on : null };
  })())`).then(JSON.parse);

/** Drive one section's gate step and measure dot-vs-demanded-control. */
async function measureGate({ stepParam, tourId, nextClicks, controlSel, gateKind, tag, satisfiers = {} }) {
  await send("Page.navigate", { url: `${base}/?step=${stepParam}` });
  await sleep(4500);
  const locked = await evalJson(`window.__wp1.locked()`);
  if (locked) {
    await evalJson(`window.__wp1.skip()`);
    await sleep(600);
  }
  await evalJson(`document.querySelector('.rstep[data-active="true"] .tour-launch').click()`);
  let st = null;
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    st = await tourState();
    if (st.running && st.phase === "active" && st.stepIndex === 0) break;
  }
  check(`${tag}: tour starts at head`, st?.id === tourId && st?.stepIndex === 0, JSON.stringify(st));
  // One Next per ACTIVATION: page-boundary travels run the entry animation
  // (phase "travel" swallows Next), so wait for the new step to go active.
  // An intermediate gate PAUSES the walk (Next swallowed): its satisfier in
  // `satisfiers` (gateKind → action) releases it, like a visitor would.
  for (let c = 0; c < nextClicks; c++) {
    const before = (await tourState()).stepIndex;
    await evalJson(`document.getElementById('tour-next').click()`);
    for (let i = 0; i < 60; i++) {
      await sleep(250);
      st = await tourState();
      if (st.phase === "active" && (st.stepIndex > before || st.gate)) break;
    }
    if (st.phase === "active" && st.gate && satisfiers[st.gateKind]) {
      await satisfiers[st.gateKind]();
      for (let i = 0; i < 60; i++) {
        await sleep(250);
        st = await tourState();
        if (st.phase === "active" && !st.gate && st.stepIndex > before) break;
      }
    }
    if (!(st.phase === "active" && st.stepIndex > before)) break;
  }
  st = await tourState();
  const dot = await dotPos();
  const meas = await evalJson(`JSON.stringify((() => {
    const el = document.querySelector('${controlSel}');
    const r = el ? el.getBoundingClientRect() : null;
    const stage = document.getElementById('stage');
    const reader = document.getElementById('reader');
    const sr = stage ? stage.getBoundingClientRect() : null;
    const rr = reader ? reader.getBoundingClientRect() : null;
    return {
      rect: r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height } : null,
      stageRect: sr ? { left: sr.left, right: sr.right } : null,
      readerLeft: rr ? rr.left : null,
      sentence: (document.querySelector('.sent[data-tour-active="true"]')?.textContent ?? '').trim().replace(/\\s+/g, ' '),
      spotOn: el ? el.dataset.spot ?? null : null,
    };
  })())`).then(JSON.parse);
  const dotOn = dot.on === "true";
  const dist = dot.x != null && meas.rect
    ? Math.hypot(dot.x - (meas.rect.left + meas.rect.w / 2), dot.y - (meas.rect.top + meas.rect.h / 2))
    : null;
  console.log(`\n== ${tag} ==`);
  console.log(`tour:  idx=${st.stepIndex}/${st.count} gate=${st.gate} gateKind=${st.gateKind} gateLabel=${JSON.stringify(st.gateLabel)} lookKey=${st.lookKey}`);
  console.log(`sentence: ${JSON.stringify(meas.sentence)}`);
  console.log(`dot: (${dot.x?.toFixed(1)}, ${dot.y?.toFixed(1)}) overlay=${dot.on}`);
  console.log(`${controlSel} rect:`, JSON.stringify(meas.rect));
  console.log(`distance dot→control center: ${dist?.toFixed(1)}px  control data-spot=${meas.spotOn}`);
  console.log(`stage pane x-range: [${meas.stageRect?.left?.toFixed(0)}, ${meas.stageRect?.right?.toFixed(0)}]  reader left: ${meas.readerLeft?.toFixed(0)}`);
  return { st, dot, meas, dist, dotOn };
}

/* ---- A. §3 β gate step (the finding) ------------------------------------ */
const s3 = await measureGate({
  stepParam: 8,
  tourId: "s3",
  nextClicks: 2,
  controlSel: "#beta-slider",
  gateKind: "betaMoved",
  tag: "A · §3 β gate (page 8, mom-a)",
});
check("A: paused on the betaMoved gate", s3.st.gate === true && s3.st.gateKind === "betaMoved", `gateKind=${s3.st.gateKind}`);
check("A: step lookKey is the STAGE trail (the bug)", s3.st.lookKey === "trail-mom", `lookKey=${s3.st.lookKey}`);
check("A: gate chip demands the β slider", (s3.st.gateLabel ?? "").includes("momentum β"), s3.st.gateLabel);
check(
  "A: BUG — dot is far from #beta-slider (>300px)",
  s3.dist != null && s3.dist > 300,
  `dist=${s3.dist?.toFixed(1)}px`,
);
check(
  "A: BUG — dot sits on the STAGE pane, not the reader control",
  s3.dot.x != null && s3.meas.stageRect && s3.dot.x < s3.meas.readerLeft && s3.meas.rect && s3.meas.rect.left >= s3.meas.readerLeft,
  `dot.x=${s3.dot.x?.toFixed(0)} reader.left=${s3.meas.readerLeft?.toFixed(0)} slider.left=${s3.meas.rect?.left?.toFixed(0)}`,
);
check("A: no glow on #beta-slider (control not spotted)", s3.meas.spotOn !== "true", `data-spot=${s3.meas.spotOn}`);
await send("Page.captureScreenshot", { format: "png" }).then((r) => {
  writeFileSync("qa-diag-s3beta-gate.png", Buffer.from(r.data, "base64"));
});

/* ---- B. §2 η gate step (the shipped U1-POINT-ETA precedent) ------------- */
const s2 = await measureGate({
  stepParam: 6,
  tourId: "s2",
  nextClicks: 3,
  controlSel: "#eta-slider",
  gateKind: "etaMoved",
  tag: "B · §2 η gate (page 6, gd-c — U1 precedent)",
  // The arrowDrawn gate (idx 1, page 5) pauses the walk — satisfy it with a
  // real compass drag, exactly as a visitor must (gate-tour.mjs recipe).
  satisfiers: { arrowDrawn: () => dragMinimap(10, 40, 62, 80) },
});
check("B: paused on the etaMoved gate", s2.st.gate === true && s2.st.gateKind === "etaMoved", `gateKind=${s2.st.gateKind}`);
check("B: step lookKey is the CONTROL target", s2.st.lookKey === "eta-slider", `lookKey=${s2.st.lookKey}`);
check(
  "B: precedent — dot anchors #eta-slider (<80px)",
  s2.dist != null && s2.dist < 80,
  `dist=${s2.dist?.toFixed(1)}px`,
);
check("B: precedent — #eta-slider glows (data-spot)", s2.meas.spotOn === "true", `data-spot=${s2.meas.spotOn}`);

console.log(`\n${failures === 0 ? "ALL CHECKS RAN" : `${failures} FAILURES`}`);
await sleep(800); // let the browser shut down before removing its profile
proc.kill();
try {
  rmSync(profile, { recursive: true, force: true });
} catch {
  /* profile dir may still be briefly locked on Windows — harmless */
}
process.exit(failures === 0 ? 0 : 1);
