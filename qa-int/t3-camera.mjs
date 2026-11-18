/**
 * qa-int/t3-camera.mjs — camera policy regression (interaction lens):
 * left-drag pan / right-drag orbit / wheel zoom over the CANVAS only,
 * elevation clamps, zoom clamps, double-click reset to the scene's standard
 * pose, Isometric / Map view presets, intro zoom muting, HUD pan clamp.
 * REAL mouse/wheel input only; state via __wp1 (read-only).
 */
import { chromium } from "playwright";
import { launchGL } from "../tools/gl-launch.mjs";
import {
  check, finish, sleep, appState, waitIdle, waitFor, shot, stageBox, wheelFling,
} from "./h.mjs";

const BASE = process.argv[2] ?? "http://localhost:4184";
const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

const st = () => appState(page);
const cam = () => page.evaluate(() => {
  const d = window.__wp1.debug();
  return { att: d.viewAttitude, pan: { px: d.viewPan.px, fp: d.viewPan.footprintVisible } };
});

await page.goto(BASE + "/?step=4", { waitUntil: "load" }); // gd-a
await page.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
await waitIdle(page);
const sb = await stageBox(page);
const cx = sb.x + sb.width * 0.5;
const cy = sb.y + sb.height * 0.5;
let a = await st();
check("gd-a boots parked on step 4", a?.step === 4 && !a.locked, `step=${a?.step}`);

const pose0 = await cam();

/* ---------- left-drag pans ---------- */
// Convention note: panInfo.px is the camera's shift — dragging right moves
// the camera right (content left), so px.x = -drag.x; px.y = +drag.y.
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.move(cx + 120, cy + 60, { steps: 10 });
await page.mouse.up();
await sleep(250);
let c = await cam();
check("left-drag PANS the camera (px follows the drag, attitude unchanged)",
  Math.abs(c.pan.px.x - (pose0.pan.px.x - 120)) < 30 && Math.abs(c.pan.px.y - (pose0.pan.px.y + 60)) < 30 &&
  Math.abs(c.att.azimuthDeg - pose0.att.azimuthDeg) < 0.5 &&
  Math.abs(c.att.elevationDeg - pose0.att.elevationDeg) < 0.5,
  `pan ${JSON.stringify(pose0.pan.px)} -> ${JSON.stringify(c.pan.px)} azim ${pose0.att.azimuthDeg.toFixed(1)}->${c.att.azimuthDeg.toFixed(1)}`);

/* ---------- right-drag orbits ---------- */
// pan.px is a WORLD-space projection: it legitimately re-projects when the
// attitude changes, so only the attitude terms assert here. Drag convention
// on this rig: up = camera DOWN (elevation decreases, cf. the clamp test).
await page.mouse.move(cx, cy);
await page.mouse.down({ button: "right" });
await page.mouse.move(cx + 150, cy - 40, { steps: 10 });
await page.mouse.up({ button: "right" });
await sleep(250);
c = await cam();
check("right-drag ORBITS (azimuth swings, elevation drops toward the floor)",
  Math.abs(c.att.azimuthDeg - pose0.att.azimuthDeg) > 5 &&
  c.att.elevationDeg <= pose0.att.elevationDeg + 0.5 && c.att.elevationDeg >= 14.9,
  `azim ${pose0.att.azimuthDeg.toFixed(1)}->${c.att.azimuthDeg.toFixed(1)} elev ${pose0.att.elevationDeg.toFixed(1)}->${c.att.elevationDeg.toFixed(1)}`);

/* ---------- elevation clamp ---------- */
// drag DOWN = camera up (toward 90° top-down); drag UP = camera down (toward 15°).
await page.mouse.move(cx, cy);
await page.mouse.down({ button: "right" });
await page.mouse.move(cx, cy + 800, { steps: 12 });
await page.mouse.up({ button: "right" });
await sleep(250);
c = await cam();
const elevHigh = c.att.elevationDeg;
await page.mouse.move(cx, cy);
await page.mouse.down({ button: "right" });
await page.mouse.move(cx, cy - 900, { steps: 12 });
await page.mouse.up({ button: "right" });
await sleep(250);
c = await cam();
check("elevation clamps to [15°, 90°] under hard drags",
  elevHigh >= 89.9 && elevHigh <= 90.1 && c.att.elevationDeg >= 14.9 && c.att.elevationDeg <= 15.1,
  `down-drag ceiling ${elevHigh.toFixed(2)}°, up-drag floor ${c.att.elevationDeg.toFixed(2)}°`);
await shot(page, "t3-orbit-topdown.png");

/* ---------- double-click restores the scene's standard pose ---------- */
await page.mouse.dblclick(cx, cy);
await waitFor(page, async () => {
  const cc = await cam();
  return Math.abs(cc.pan.px.x) < 1 && Math.abs(cc.pan.px.y) < 1;
}, { label: "dblclick re-centres", maxMs: 4000 });
await sleep(250);
c = await cam();
check("double-click restores the standard pose: pan re-centred, attitude+distance back to the boot pose",
  Math.abs(c.pan.px.x) < 1 && Math.abs(c.pan.px.y) < 1 &&
  Math.abs(c.att.azimuthDeg - pose0.att.azimuthDeg) < 0.6 &&
  Math.abs(c.att.elevationDeg - pose0.att.elevationDeg) < 0.6 &&
  Math.abs(c.att.zoomRadius - pose0.att.zoomRadius) / pose0.att.zoomRadius < 0.05,
  `pan ${JSON.stringify(c.pan.px)} att (${c.att.azimuthDeg.toFixed(1)},${c.att.elevationDeg.toFixed(1)},${c.att.zoomRadius.toFixed(1)}) vs boot (${pose0.att.azimuthDeg.toFixed(1)},${pose0.att.elevationDeg.toFixed(1)},${pose0.att.zoomRadius.toFixed(1)})`);

/* ---------- presets ---------- */
await page.click('.lv-btn[data-preset="map"]');
await sleep(300);
c = await cam();
check("Map view preset: exact top-down (azim 0, elev 90), button marked active",
  Math.abs(c.att.azimuthDeg) < 0.1 && Math.abs(c.att.elevationDeg - 90) < 0.1,
  `att (${c.att.azimuthDeg.toFixed(2)},${c.att.elevationDeg.toFixed(2)})`);
const mapBtnActive = await page.evaluate(() => document.querySelector('.lv-btn[data-preset="map"]')?.dataset.active);
await page.click('.lv-btn[data-preset="iso"]');
await sleep(300);
c = await cam();
check("Isometric preset: matplotlib default (azim -60, elev 35)",
  Math.abs(c.att.azimuthDeg + 60) < 0.1 && Math.abs(c.att.elevationDeg - 35) < 0.1 &&
  mapBtnActive === "true",
  `att (${c.att.azimuthDeg.toFixed(2)},${c.att.elevationDeg.toFixed(2)}); map was marked ${mapBtnActive}`);
await shot(page, "t3-iso-preset.png");

/* ---------- wheel zoom over the canvas only; clamped ---------- */
a = await st();
const zoom0 = (await cam()).att.zoomRadius;
await wheelFling(page, { dy: -160, n: 5, gapMs: 60, over: "canvas" });
await sleep(250);
let zoomIn = (await cam()).att.zoomRadius;
a = await st();
check("wheel over the canvas zooms IN and never advances the reader",
  zoomIn < zoom0 * 0.9 && a?.step === 4 && a.parked, `${zoom0.toFixed(1)} -> ${zoomIn.toFixed(1)} step=${a?.step}`);
// zoom OUT hard: the radius must clamp (fit*3.2) and stop growing
for (let k = 0; k < 3; k++) {
  await wheelFling(page, { dy: 160, n: 8, gapMs: 50, over: "canvas" });
  await sleep(200);
}
const zoomOut1 = (await cam()).att.zoomRadius;
await wheelFling(page, { dy: 160, n: 8, gapMs: 50, over: "canvas" });
await sleep(200);
const zoomOut2 = (await cam()).att.zoomRadius;
check("zoom-out clamps: further wheeling stops growing the radius",
  zoomOut2 <= zoomOut1 * 1.02, `${zoomOut1.toFixed(1)} -> ${zoomOut2.toFixed(1)}`);

/* ---------- deep zoom-out + hard pan: HUD pan clamp keeps the terrain visible ---------- */
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.move(cx - 700, cy, { steps: 12 });
await page.mouse.up();
await sleep(250);
c = await cam();
check("pan clamp at deep zoom-out keeps the terrain footprint on the pane (never hides fully under HUD)",
  c.pan.fp > 0.05, `footprintVisible=${c.pan.fp.toFixed(3)} pan=${JSON.stringify(c.pan.px)}`);

/* ---------- double-click rescues the deep zoom (preset restored) ---------- */
await page.mouse.dblclick(cx, cy);
await sleep(300);
c = await cam();
check("double-click after a deep zoom restores the preset distance (rescue)",
  Math.abs(c.att.zoomRadius - pose0.att.zoomRadius) / pose0.att.zoomRadius < 0.05 &&
  Math.abs(c.att.azimuthDeg + 60) < 0.1,
  `zoom ${c.att.zoomRadius.toFixed(1)} vs boot ${pose0.att.zoomRadius.toFixed(1)} azim ${c.att.azimuthDeg.toFixed(1)}`);

/* ---------- intro: canvas wheel NEVER zooms (full-bleed owns the wheel) ---------- */
await page.goto(BASE + "/", { waitUntil: "load" });
await page.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
await waitIdle(page);
const zoomIntro = (await cam()).att.zoomRadius;
await wheelFling(page, { dy: 160, n: 3, gapMs: 60, over: "canvas" }); // docks + guard
await sleep(400);
c = await cam();
a = await st();
check("intro: wheeling over the canvas docks the reader and zooms NOTHING",
  a?.intro === false && Math.abs(c.att.zoomRadius - zoomIntro) < 1e-6,
  `intro=${a?.intro} zoom ${zoomIntro.toFixed(2)} -> ${c.att.zoomRadius.toFixed(2)}`);
await waitIdle(page);

/* ---------- step-change camera tween: a user drag must yield (cancel tweens) ---------- */
// advance into gd-b (a choreographed camera move), grab the canvas mid-tween,
// then compare the frozen attitude against the UNDISTURBED gd-b target (?step=5):
// a tween stomp would re-drive the camera onto the choreographed attitude.
await page.keyboard.press("ArrowDown");
await sleep(120); // the entry + camera tween is starting
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.move(cx + 80, cy + 40, { steps: 6 });
await page.mouse.up();
await sleep(900);
const disturbed = await cam();
await page.goto(BASE + "/?step=5", { waitUntil: "load" });
await page.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
await waitIdle(page);
const undisturbed = await cam();
const dAz = Math.abs(disturbed.att.azimuthDeg - undisturbed.att.azimuthDeg);
const dEl = Math.abs(disturbed.att.elevationDeg - undisturbed.att.elevationDeg);
check("a drag during a step-change camera tween YIELDS to the user (final attitude ≠ the choreographed target)",
  dAz > 1 || dEl > 1,
  `disturbed (${disturbed.att.azimuthDeg.toFixed(2)},${disturbed.att.elevationDeg.toFixed(2)}) vs undisturbed (${undisturbed.att.azimuthDeg.toFixed(2)},${undisturbed.att.elevationDeg.toFixed(2)})`);
await waitIdle(page);

await browser.close();
finish("T3-CAMERA");
