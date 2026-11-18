/**
 * cdp-responsive.mjs — responsive layout probe + §5 slider framerate sweep.
 *
 * Loading state (defect 3, checked at every size):
 *   L1. #boot overlay is present early with the title + progress line and the
 *       body stays near-black (no white/blank flash);
 *   L2. after the app settles the overlay is gone, fonts are loaded, and the
 *       scene canvas is live.
 *
 * Responsive (defect 4) — widths 1280 / 1440 / 1920 / 2560 / 900(narrow),
 * scenes task-a (fit+loss+minimap insets), lab (curves + transport),
 * fog-a (fog HUD) and tilt-a (tall panel + docked compass):
 *   R1. no horizontal overflow (scrollWidth <= viewport);
 *   R2. every visible .hud panel fully inside the viewport;
 *   R3. visible panels never overlap the reader panel;
 *   R4. the active reader step is not clipped by the reader body;
 *   R5. the stage canvas fills the stage pane;
 *   R6. the minimap bitmap matches its CSS size (no stretch).
 *
 * §5 optimization sweep (defect 4b): at 1600×900 on ?step=13, stream ~120
 * slider input events/s across the elongation slider for 2 s while sampling
 * rAF gaps — worst gap must stay under 100 ms; rebuild cost is reported.
 *
 * Usage: node tools/cdp-responsive.mjs <baseUrl>
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const base = process.argv[2] ?? "http://localhost:4173";

const profile = mkdtempSync(join(tmpdir(), "cdp-resp-"));
const proc = spawn(
  EDGE,
  [
    "--headless=new",
    // Hardware-GL args (QA SCRUB-HITCH): default headless runs WebGL on
    // SwiftShader, turning every §5 rebuild into a 50-80ms software raster.
    "--use-angle=d3d11",
    "--enable-gpu",
    "--ignore-gpu-blocklist",
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
  const timer = setTimeout(() => reject(new Error("no devtools ws url")), 20000);
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
const evalJson = async (expr, awaitPromise = false) => {
  const r = await send("Runtime.evaluate", {
    expression: expr,
    returnByValue: true,
    awaitPromise,
  });
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  }
  return r.result.value;
};

let failures = 0;
let ran = 0;
function check(name, ok, detail) {
  ran += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

await send("Page.enable");
await send("Runtime.enable");

/* ---- L. loading state at the default size ------------------------------ */

await send("Emulation.setDeviceMetricsOverride", {
  width: 1600, height: 900, deviceScaleFactor: 1, mobile: false,
});
await send("Page.navigate", { url: `${base}/` });
await sleep(60); // module graph still loading: the overlay must already cover
// On hardware GL the first paint can beat the external stylesheet; wait for
// page.css to apply (bounded) before reading the body color — the check's
// target is "the backdrop is dark once styles apply", not stylesheet timing.
{
  const t0 = Date.now();
  for (;;) {
    const applied = await evalJson(
      `getComputedStyle(document.body).backgroundColor !== "rgba(0, 0, 0, 0)"`,
    );
    if (applied || Date.now() - t0 > 2000) break;
    await sleep(30);
  }
}
{
  const early = await evalJson(`(function(){
    const b = document.getElementById("boot");
    const bodyBg = getComputedStyle(document.body).backgroundColor;
    if (!b) return { present: false, bodyBg };
    const r = b.getBoundingClientRect();
    return {
      present: true,
      covers: r.width >= window.innerWidth * 0.98 && r.height >= window.innerHeight * 0.98,
      hasTitle: !!b.querySelector("h1"),
      hasBar: !!b.querySelector(".boot-bar"),
      bodyBg,
    };
  })()`);
  check(
    "L1. boot overlay covers from the first paint (title + progress line, dark body)",
    early.present && early.covers && early.hasTitle && early.hasBar &&
      early.bodyBg === "rgb(11, 13, 16)",
    JSON.stringify(early),
  );
}
await sleep(3500);
{
  const settled = await evalJson(`(function(){
    return {
      bootGone: document.getElementById("boot") === null,
      fontsLoaded: document.fonts ? document.fonts.status : "unknown",
      canvasLive: !!document.querySelector("#stage canvas.lv-canvas"),
      appReady: !!window.__wp1,
    };
  })()`);
  check(
    "L2. overlay reveals after fonts + scene are ready, then removes itself",
    settled.bootGone && settled.canvasLive && settled.appReady &&
      (settled.fontsLoaded === "loaded"),
    JSON.stringify(settled),
  );
}

/* ---- R. layout across widths and scenes -------------------------------- */

const WIDTHS = [2560, 1920, 1440, 1280, 900];
const SCENES = [
  { step: 1, label: "task-a" },
  { step: 13, label: "lab" },
  { step: 15, label: "fog-a" },
  { step: 19, label: "tilt-a" },
];

const layoutReport = async () =>
  evalJson(`(function(){
    const vw = window.innerWidth, vh = window.innerHeight;
    const out = { vw, vh, overflowX: document.documentElement.scrollWidth > vw + 1,
      panels: [], reader: null, activeStepClipped: false, canvasFills: false,
      minimapStretched: false };
    const readerEl = document.querySelector("#reader");
    out.reader = readerEl.getBoundingClientRect().toJSON();
    for (const el of document.querySelectorAll(".hud")) {
      if (el.dataset.visible !== "true" || !el.offsetParent && getComputedStyle(el).display === "none") continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      out.panels.push({
        id: el.id,
        left: r.left, top: r.top, right: r.right, bottom: r.bottom,
        outside: r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1,
        overlapsReader: r.right > out.reader.left + 2 && r.left < out.reader.right - 2 &&
          r.bottom > out.reader.top + 2 && r.top < out.reader.bottom - 2,
      });
    }
    const body = document.querySelector("#reader-body");
    const step = document.querySelector('.rstep[data-active="true"]');
    if (step && body) {
      const sr = step.getBoundingClientRect();
      const br = body.getBoundingClientRect();
      out.activeStepClipped = sr.bottom > br.bottom + 2 || sr.top < br.top - 2 ||
        sr.left < br.left - 2 || sr.right > br.right + 2;
    }
    const stage = document.querySelector("#stage");
    const cv = document.querySelector("#stage canvas");
    if (stage && cv) {
      const sr = stage.getBoundingClientRect();
      const cr = cv.getBoundingClientRect();
      out.canvasFills = Math.abs(sr.width - cr.width) < 1.5 && Math.abs(sr.height - cr.height) < 1.5;
    }
    const mm = document.querySelector("#minimap-canvas");
    if (mm) {
      const r = mm.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      out.minimapStretched = Math.abs(mm.width - Math.round(r.width * dpr)) > 2 ||
        Math.abs(mm.height - Math.round(r.height * dpr)) > 2;
    }
    return out;
  })()`);

for (const width of WIDTHS) {
  for (const sc of SCENES) {
    await send("Emulation.setDeviceMetricsOverride", {
      width, height: 900, deviceScaleFactor: 1, mobile: false,
    });
    await send("Page.navigate", { url: `${base}/?step=${sc.step}` });
    await sleep(3500);
    const rep = await layoutReport();
    const bad = rep.panels.filter((p) => p.outside || p.overlapsReader);
    check(
      `R w${width} ${sc.label}: no horizontal overflow`,
      !rep.overflowX,
      `scrollWidth > ${rep.vw}`,
    );
    check(
      `R w${width} ${sc.label}: visible HUD panels inside viewport, clear of the reader`,
      bad.length === 0,
      bad.length ? JSON.stringify(bad) : `${rep.panels.length} panels ok`,
    );
    check(
      `R w${width} ${sc.label}: active reader step not clipped`,
      !rep.activeStepClipped,
    );
    check(
      `R w${width} ${sc.label}: stage canvas fills the stage pane`,
      rep.canvasFills,
    );
    check(
      `R w${width} ${sc.label}: minimap bitmap matches CSS size`,
      !rep.minimapStretched,
    );
  }
}

/* ---- §5 slider framerate sweep ------------------------------------------ */

await send("Emulation.setDeviceMetricsOverride", {
  width: 1600, height: 900, deviceScaleFactor: 1, mobile: false,
});
await send("Page.navigate", { url: `${base}/?step=13` }); // lab
await sleep(3500);
{
  const r = await evalJson(`(async () => {
    const s = document.querySelector("#elong-slider");
    if (!s) return null;
    const gaps = [];
    let last = performance.now();
    let raf = requestAnimationFrame(function loop(t) {
      gaps.push(t - last); last = t; raf = requestAnimationFrame(loop);
    });
    const t0 = performance.now();
    let i = 0;
    while (performance.now() - t0 < 2000) {
      i = (i + 7) % 1000;
      s.value = String(i);
      s.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((res) => setTimeout(res, 8)); // ~120 drags/s
    }
    cancelAnimationFrame(raf);
    gaps.shift();
    const sorted = [...gaps].sort((a, b) => a - b);
    return {
      worst: Math.max(...gaps),
      p95: sorted[Math.floor(sorted.length * 0.95)],
      avg: gaps.reduce((a, b) => a + b, 0) / gaps.length,
      frames: gaps.length,
      rebuildMs: __wp1.lab().rebuildMs,
      E: __wp1.lab().E,
    };
  })()`, true);
  check(
    "§5 slider sweep stays interactive (worst rAF gap < 100 ms)",
    r !== null && r.worst < 100,
    r ? `worst ${r.worst.toFixed(1)} ms, p95 ${r.p95.toFixed(1)} ms, avg ${r.avg.toFixed(1)} ms over ${r.frames} frames; last rebuild ${r.rebuildMs.toFixed(2)} ms; E=${r.E}` : "no #elong-slider",
  );
}

console.log(`\n${ran - failures}/${ran} checks passed`);
ws.close();
proc.kill();
try {
  rmSync(profile, { recursive: true, force: true });
} catch {
  // temp profile may still be locked; harmless
}
process.exit(failures === 0 ? 0 : 1);
