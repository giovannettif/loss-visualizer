/**
 * diag-s2-gl-leak-crossfade.mjs — reproduction counter for QA
 * PERF25-S2-GL-LEAK-CROSSFADE.
 *
 * The finding's repro: open ?step=21 (§7 swarm finale, tilt→rule landscape
 * family), rail-click step 23 (§8), rail-click back to 22, repeat 20 cycles.
 * Live GL object counts (create/delete patch, double-delete safe) must stay
 * flat per cycle; the finding measured +1,205 buffers / +100 VAOs per cycle
 * on the pre-fix build.
 *
 * Usage: node tools/diag-s2-gl-leak-crossfade.mjs [baseUrl] [cycles]
 */

import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";

const base = process.argv[2] ?? "http://localhost:4184";
const CYCLES = Number(process.argv[3] ?? 20);
const MODE = process.argv[4] ?? "cycle"; // "cycle" | "walk"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await launchGL(chromium, {
  args: ["--js-flags=--expose-gc"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
page.on("console", (m) => {
  if (m.type() === "error") console.log("CONSOLE-ERROR:", m.text());
});

// The create/delete counter, installed BEFORE any app code touches WebGL.
// Shared by every page this tool opens (string form: addInitScript per page).
const COUNTER_INIT = `(() => {
  const state = { buffers: 0, vaos: 0, textures: 0, programs: 0 };
  const live = new Set();
  const mark = (obj) => {
    if (!obj) return;
    live.add(obj);
  };
  const unmark = (obj) => {
    if (!obj) return false;
    return live.delete(obj);
  };
  const wrap = (proto) => {
    if (!proto) return;
    const orig = {
      createBuffer: proto.createBuffer,
      deleteBuffer: proto.deleteBuffer,
      createVertexArray: proto.createVertexArray,
      deleteVertexArray: proto.deleteVertexArray,
      createTexture: proto.createTexture,
      deleteTexture: proto.deleteTexture,
      createProgram: proto.createProgram,
      deleteProgram: proto.deleteProgram,
    };
    proto.createBuffer = function (...a) {
      const b = orig.createBuffer.apply(this, a);
      state.buffers++;
      mark(b);
      return b;
    };
    proto.deleteBuffer = function (...a) {
      if (unmark(a[0])) state.buffers--;
      return orig.deleteBuffer.apply(this, a);
    };
    proto.createVertexArray = function (...a) {
      const v = orig.createVertexArray.apply(this, a);
      state.vaos++;
      mark(v);
      return v;
    };
    proto.deleteVertexArray = function (...a) {
      if (unmark(a[0])) state.vaos--;
      return orig.deleteVertexArray.apply(this, a);
    };
    proto.createTexture = function (...a) {
      const t = orig.createTexture.apply(this, a);
      state.textures++;
      mark(t);
      return t;
    };
    proto.deleteTexture = function (...a) {
      if (unmark(a[0])) state.textures--;
      return orig.deleteTexture.apply(this, a);
    };
    proto.createProgram = function (...a) {
      const p = orig.createProgram.apply(this, a);
      state.programs++;
      mark(p);
      return p;
    };
    proto.deleteProgram = function (...a) {
      if (unmark(a[0])) state.programs--;
      return orig.deleteProgram.apply(this, a);
    };
  };
  wrap(WebGL2RenderingContext?.prototype);
  wrap(WebGLRenderingContext?.prototype);
  window.__glCounts = () => {
    const mem = performance.memory;
    return {
      buffers: state.buffers,
      vaos: state.vaos,
      textures: state.textures,
      programs: state.programs,
      heapMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : null,
      retired: window.__wp1?.debug?.()?.retired ?? null,
      scene: window.__wp1?.scene?.() ?? null,
      step: window.__wp1?.step?.() ?? null,
    };
  };
})();`;
page.addInitScript(COUNTER_INIT);

async function waitIdle(page) {
  // The app exposes __wp1 only after boot; before that the optional-chain
  // fallbacks would report "idle" and sample a half-built page.
  for (let i = 0; i < 40 && !(await page.evaluate(() => !!window.__wp1)); i++) {
    await sleep(250);
  }
  for (let i = 0; i < 120; i++) {
    const a = await page.evaluate(() => ({
      locked: window.__wp1?.locked?.() ?? false,
      animating: window.__wp1?.animating?.() ?? false,
    }));
    if (!a.locked && !a.animating) return true;
    await sleep(250);
  }
  return false;
}

/** Rail buttons are 0-indexed by step: button k = nth-child(k+1). */
async function railTo(page, step) {
  await page.click(`#rail button:nth-child(${step + 1})`, { force: true });
}

if (MODE === "walk") {
  // The finding's second scale: a single top-to-bottom read leaked ~220
  // buffers. On a clean build the walk's end state must match a fresh
  // direct boot at the SAME step (each scene's own buffers differ, so the
  // honest zero is fresh-at-final, not the walk's start).
  const LAST = 26;
  await page.goto(`${base}/?step=0`, { waitUntil: "load" });
  await waitIdle(page);
  await sleep(1000);
  let prev = await page.evaluate(() => window.__glCounts());
  console.log(
    `WALK-START step=0/${prev.scene} buffers=${prev.buffers} vaos=${prev.vaos}`,
  );
  for (let k = 1; k <= LAST; k++) {
    await railTo(page, k);
    await waitIdle(page);
    await sleep(900);
    const s = await page.evaluate(() => window.__glCounts());
    const d = s.buffers - prev.buffers;
    console.log(
      `step ${String(k).padStart(2)} ${String(s.scene).padEnd(8)} buf=${String(s.buffers).padStart(5)} Δ=${d >= 0 ? "+" : ""}${d} retired=${s.retired}`,
    );
    prev = s;
  }
  await page.evaluate(() => window.gc?.());
  await sleep(400);
  const walkedEnd = await page.evaluate(() => window.__glCounts());
  // Fresh direct boot at the final step = the honest baseline.
  const page2 = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page2.addInitScript(COUNTER_INIT); // counter patch must predate the app
  page2.on("pageerror", (e) => console.log("PAGE2-ERROR:", e.message));
  page2.on("console", (m) => {
    if (m.type() === "error") console.log("PAGE2-CONSOLE:", m.text());
  });
  await page2.goto(`${base}/?step=${LAST}`, { waitUntil: "load" });
  const idleF = await waitIdle(page2);
  // ?step=N deep links play the full entry animation under the lock model;
  // idle alone can pass between phases — require the landed step + a buffer
  // count that says the landscape is actually built (terrain alone ≈ 40+).
  for (let i = 0; i < 120; i++) {
    const s = await page2.evaluate(() => ({
      ...window.__glCounts(),
    }));
    if (s.step === LAST && s.buffers > 100 && !(await page2.evaluate(() => window.__wp1.animating() || window.__wp1.locked()))) {
      break;
    }
    await sleep(250);
  }
  await sleep(1200);
  console.log(
    "PAGE2 state:",
    JSON.stringify(
      await page2.evaluate(() => ({
        hasWp1: !!window.__wp1,
        scene: window.__wp1?.scene?.() ?? null,
        step: window.__wp1?.step?.() ?? null,
        debug: window.__wp1?.debug?.() ?? null,
        bootOverlay: document.querySelector("#boot")?.textContent?.slice(0, 120) ?? null,
        canvas: !!document.querySelector("canvas"),
      })),
    ),
  );
  const freshEnd = await page2.evaluate(() => window.__glCounts());
  console.log(
    `\nWALK-END  buffers=${walkedEnd.buffers} vaos=${walkedEnd.vaos} heap=${walkedEnd.heapMB}MB (post-GC)` +
      `\nFRESH@${LAST} idle=${idleF} buffers=${freshEnd.buffers} vaos=${freshEnd.vaos}` +
      `\nWALK-ACCUMULATED vs fresh: Δbuf=${walkedEnd.buffers - freshEnd.buffers >= 0 ? "+" : ""}${walkedEnd.buffers - freshEnd.buffers}, Δvao=${walkedEnd.vaos - freshEnd.vaos >= 0 ? "+" : ""}${walkedEnd.vaos - freshEnd.vaos}`,
  );
  await browser.close();
  process.exit(0);
}

await page.goto(`${base}/?step=21`, { waitUntil: "load" });
const idle0 = await waitIdle(page);
await sleep(1500); // let the post-render deferred-material flush drain
const fresh = await page.evaluate(() => window.__glCounts());
console.log(
  `FRESH  (idle=${idle0}, step=${fresh.step}/${fresh.scene})  ` +
    `buffers=${fresh.buffers} vaos=${fresh.vaos} textures=${fresh.textures} programs=${fresh.programs} heap=${fresh.heapMB}MB`,
);

let prev = fresh;
let failures = 0;
for (let c = 1; c <= CYCLES; c++) {
  // 21 → 23 (crossfade tilt→rule, swarm retires) → 22 (same-family).
  await railTo(page, 23);
  const idleA = await waitIdle(page);
  await sleep(1000);
  const mid = await page.evaluate(() => window.__glCounts());
  await railTo(page, 22);
  const idleB = await waitIdle(page);
  await sleep(1000);
  const end = await page.evaluate(() => window.__glCounts());
  const dBuf = end.buffers - prev.buffers;
  const dVao = end.vaos - prev.vaos;
  const flag = Math.abs(dBuf) > 60 || Math.abs(dVao) > 10 ? "  <-- GROWING" : "";
  console.log(
    `cycle ${String(c).padStart(2)}  →23 idle=${idleA} buf=${mid.buffers} retired=${mid.retired}` +
      `  →22 idle=${idleB} buf=${end.buffers} vaos=${end.vaos} retired=${end.retired}` +
      `  Δbuf=${dBuf >= 0 ? "+" : ""}${dBuf} Δvao=${dVao >= 0 ? "+" : ""}${dVao}` +
      ` heap=${end.heapMB}MB${flag}`,
  );
  if (c === 1 || c === 5 || c === 10 || c === 20) {
    // Periodic GC'd sample: heap growth that survives GC = real leak.
    await page.evaluate(() => window.gc?.());
    await sleep(300);
    const g = await page.evaluate(() => window.__glCounts());
    console.log(
      `   after GC: buffers=${g.buffers} vaos=${g.vaos} heap=${g.heapMB}MB`,
    );
  }
  prev = end;
}

const final = prev;
console.log(
  `\nRESULT  fresh buffers=${fresh.buffers} vaos=${fresh.vaos}  →  after ${CYCLES} cycles buffers=${final.buffers} vaos=${final.vaos}` +
    `  (Δbuf=${final.buffers - fresh.buffers >= 0 ? "+" : ""}${final.buffers - fresh.buffers}, Δvao=${final.vaos - fresh.vaos >= 0 ? "+" : ""}${final.vaos - fresh.vaos})`,
);
const perCycle = (final.buffers - fresh.buffers) / CYCLES;
console.log(
  perCycle > 50
    ? `LEAK: +${perCycle.toFixed(0)} buffers/cycle sustained`
    : `NO SUSTAINED LEAK: ${perCycle.toFixed(1)} buffers/cycle`,
);

await browser.close();
