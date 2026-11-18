// Diagnostic (QA SEC5-S2-REBUILD-RESETS-CAMERA): does a §5 lab slider rebuild
// keep the user's zoom + pan? Finding repro: ?step=13, wheel-zoom to ~6.4,
// LEFT-drag pan, then one ArrowRight on #rot-slider — the rebuild used to
// reframe the camera (zoomRadius back to the fit ~12.4, pan to 0/0), reading
// as the page undoing the user's framing. Also re-checks the map-view variant
// (9.09 -> 12.41) and the elongation edge (extent CHANGES with E: makeBowl's
// half = 3·E^(1/4), functions.ts:61 — carry must preserve zoom RELATIVE to
// the fit there, not the absolute radius).
//
// Usage: node tools/diag-s5-rebuild-cam.mjs [baseUrl]   (default :4173)
import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";

const base = process.argv[2] ?? "http://localhost:4173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(`${base}/?step=13`, { waitUntil: "load" });
await page.waitForFunction(() => !!window.__wp1, null, { timeout: 30000 });
for (let i = 0; i < 60; i++) {
  const busy = await page.evaluate(() => window.__wp1.locked() || window.__wp1.animating());
  if (!busy) break;
  await sleep(250);
}
await sleep(800);

const cam = () =>
  page.evaluate(() => {
    const d = window.__wp1.debug();
    return {
      zoom: d.viewAttitude.zoomRadius,
      fit: d.viewAttitude.fitZoomRadius ?? null,
      az: d.viewAttitude.azimuthDeg,
      el: d.viewAttitude.elevationDeg,
      px: d.viewPan.px.x,
      py: d.viewPan.px.y,
    };
  });

console.log("scene:", await page.evaluate(() => window.__wp1.scene()));
const stage = await page.locator("#stage").boundingBox();
const cx = stage.x + stage.width * 0.4;
const cy = stage.y + stage.height * 0.5;

/** Wheel-zoom in over the stage until zoomRadius <= target. */
async function zoomInTo(target) {
  await page.mouse.move(cx, cy);
  for (let i = 0; i < 60; i++) {
    const z = (await cam()).zoom;
    if (z <= target) break;
    await page.mouse.wheel(0, -240);
    await sleep(50);
  }
  await sleep(1000); // the wheel target EASES; let it settle
}

/** LEFT-drag pan by (dx, dy) screen px, cursor following the terrain. */
async function panBy(dx, dy) {
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx, cy + dy, { steps: 6 });
  await page.mouse.up();
  await sleep(400);
}

async function rotNudge() {
  await page.focus("#rot-slider");
  await page.keyboard.press("ArrowRight");
  await sleep(1600); // lab idle-debounce 180ms + rebuild + ease
}

const near = (a, b, tol) => Math.abs(a - b) <= tol;

/* ---- A. finding repro: iso attitude, rot nudge ------------------------- */
console.log("\n===== A. iso: zoom+pan, then #rot-slider nudge =====");
await zoomInTo(6.6);
await panBy(-93, -26); // drag cursor up-left so the scene follows it
const before = await cam();
console.log("before nudge:", JSON.stringify(before));
if (!(before.zoom < 8)) console.log("WARN  zoom-in did not reach ~6.4 — check sensitivity");
if (!(Math.abs(before.px) > 10 || Math.abs(before.py) > 10)) console.log("WARN  pan did not take");
await rotNudge();
const after = await cam();
console.log("after nudge: ", JSON.stringify(after));
check("A zoom kept across rot nudge", near(after.zoom, before.zoom, 0.05),
  `${before.zoom.toFixed(3)} -> ${after.zoom.toFixed(3)}`);
check("A pan kept across rot nudge", near(after.px, before.px, 1) && near(after.py, before.py, 1),
  `(${before.px.toFixed(1)},${before.py.toFixed(1)}) -> (${after.px.toFixed(1)},${after.py.toFixed(1)})`);
check("A attitude kept", near(after.az, before.az, 0.1) && near(after.el, before.el, 0.1),
  `az ${before.az.toFixed(2)}->${after.az.toFixed(2)}, el ${before.el.toFixed(2)}->${after.el.toFixed(2)}`);

/* ---- B. finding repro: map view, rot nudge ----------------------------- */
console.log("\n===== B. map view: zoom+pan, then #rot-slider nudge =====");
await page.locator('.lv-btn[data-preset="map"]').click();
await sleep(1200);
const mFit = await cam();
console.log("map preset:", JSON.stringify(mFit));
await zoomInTo(mFit.zoom * 0.75);
await panBy(-93, 26); // the map preset re-centres pan; give the check a real pan
const mBefore = await cam();
console.log("before nudge:", JSON.stringify(mBefore));
await rotNudge();
const mAfter = await cam();
console.log("after nudge: ", JSON.stringify(mAfter));
check("B zoom kept across rot nudge (map view)", near(mAfter.zoom, mBefore.zoom, 0.05),
  `${mBefore.zoom.toFixed(3)} -> ${mAfter.zoom.toFixed(3)}`);
check("B pan kept across rot nudge (map view)", near(mAfter.px, mBefore.px, 1) && near(mAfter.py, mBefore.py, 1),
  `(${mBefore.px.toFixed(1)},${mBefore.py.toFixed(1)}) -> (${mAfter.px.toFixed(1)},${mAfter.py.toFixed(1)})`);

/* ---- C. elongation edge: extent CHANGES with E -------------------------- */
// E is at max (×50) by default; Home sweeps it to ×1. The extent shrinks by
// (Ea/Eb)^(1/4) (makeBowl half = 3·E^(1/4), heightWorld ∝ half), and the
// carry must scale zoomRadius by that same factor (zoom RELATIVE to the fit
// preserved), with pan-px unchanged (world pan and zoom scale together).
console.log("\n===== C. iso: zoom+pan, then #elong-slider Home (E 50 -> 1) =====");
await page.locator('.lv-btn[data-preset="iso"]').click();
await sleep(1200);
await zoomInTo(6.6);
await panBy(-93, -26);
const labB = await page.evaluate(() => window.__wp1.lab().E);
const eBefore = await cam();
console.log("before nudge:", JSON.stringify(eBefore), "E:", labB);
await page.focus("#elong-slider");
await page.keyboard.press("Home");
await sleep(1800);
const labA = await page.evaluate(() => window.__wp1.lab().E);
const eAfter = await cam();
console.log("after nudge: ", JSON.stringify(eAfter), "E:", labA);
const k = Math.pow(labA / labB, 0.25); // extent scale, hence fit scale
check("C zoom carried RELATIVE to the new fit", near(eAfter.zoom, eBefore.zoom * k, Math.max(0.15, eBefore.zoom * k * 0.03)),
  `zoom ${eBefore.zoom.toFixed(3)} -> ${eAfter.zoom.toFixed(3)}, expected ~${(eBefore.zoom * k).toFixed(3)} (k=${k.toFixed(3)})`);
check("C pan carried (not re-centred)", Math.abs(eAfter.px) > 10 || Math.abs(eAfter.py) > 10,
  `(${eBefore.px.toFixed(1)},${eBefore.py.toFixed(1)}) -> (${eAfter.px.toFixed(1)},${eAfter.py.toFixed(1)})`);

await browser.close();
console.log(failures ? `\n${failures} check(s) FAILED` : "\nall checks PASSED");
process.exit(failures ? 1 : 0);
