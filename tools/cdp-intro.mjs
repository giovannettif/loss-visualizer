/**
 * cdp-intro.mjs — live CDP verification for the intro choreography.
 *
 *   1. Fresh boot is FULL-BLEED: intro park active, reader slid off-screen,
 *      title overlay centered on the whole viewport, camera frame offset 0,
 *      wheel zoom muted (wheeling the canvas scrolls, never zooms).
 *   2. Scrolling past the intro docks the reader (eased) on step 0: reader
 *      transform returns to none, the camera re-centers left of the panel,
 *      wheel zoom restored, the reader wheel advances to step 1.
 *   3. Scrolling back re-expands: step 0 → intro on ArrowUp / wheel up; the
 *      reader slides away; full-bleed restored.
 *   4. Intro exits: wheel down, Space, and a plain canvas click all dock on
 *      step 0; an orbit drag does NOT advance; ArrowUp from step 0 re-enters.
 *   5. Hooks: ?shot=hero and ?shot=intro are the same deterministic
 *      full-bleed pose; ?shot=task-a and ?step=0 boot docked.
 *
 * Usage: node tools/cdp-intro.mjs [baseUrl]
 */

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const base = process.argv[2] ?? "http://localhost:4173";
mkdirSync(resolve("shots"), { recursive: true });

const profile = mkdtempSync(join(tmpdir(), "cdp-intro-"));
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

const layout = () => evalJson(`JSON.stringify(window.__wp1.layout())`);
const scroll = () => evalJson(`JSON.stringify(window.__wp1.scroll())`);
const zoomRadius = () => evalJson(`window.__wp1.debug().viewAttitude.zoomRadius`);

/** One big wheel gesture at (x, y). */
async function wheel(x, y, dy) {
  await send("Input.dispatchMouseEvent", {
    type: "mouseWheel", x, y, deltaX: 0, deltaY: dy, pointerType: "mouse",
  });
  await sleep(1100); // the eased slide / document glide
}

async function key(keyName, code, vk) {
  await send("Input.dispatchKeyEvent", {
    type: "keyDown", key: keyName, code, windowsVirtualKeyCode: vk,
  });
  await send("Input.dispatchKeyEvent", {
    type: "keyUp", key: keyName, code, windowsVirtualKeyCode: vk,
  });
  await sleep(1100);
}

/* ==================== 1. fresh boot: full-bleed ==================== */

await send("Page.navigate", { url: `${base}/` });
await sleep(4000);
let lay = JSON.parse(await layout());
check("fresh boot: intro mode on", lay.intro === true, lay);
check("fresh boot: reader slid off-screen", /matrix/.test(lay.readerTransform) && !/matrix\(1, 0, 0, 1, 0, 0\)/.test(lay.readerTransform), lay.readerTransform);
check("fresh boot: title overlay spans the viewport", lay.overlayRight === "0px", lay.overlayRight);
check("fresh boot: camera un-shifted (frameX 0)", lay.frameX === 0, lay);
let sc = JSON.parse(await scroll());
check("fresh boot: parked in the intro park", sc.intro === true && sc.y === -sc.introPark, `y=${sc.y} park=${sc.introPark}`);
check("fresh boot: step 0 / hero / unlocked", (await evalJson(`window.__wp1.scene()`)) === "hero" && (await evalJson(`window.__wp1.step()`)) === 0 && (await evalJson(`window.__wp1.locked()`)) === false);

/* ==================== 2. intro wheel policy ==================== */

let zBefore = await zoomRadius();
await wheel(400, 450, 120); // over the CANVAS: must scroll, not zoom
sc = JSON.parse(await scroll());
const zAfter = await zoomRadius();
check("intro wheel over canvas: scroll moved", sc.y > -sc.introPark, `y=${sc.y}`);
check("intro wheel over canvas: camera did NOT zoom", Math.abs(zAfter - zBefore) < 1e-4, `${zBefore} -> ${zAfter}`);

/* ==================== 3. scrolling past docks the reader ==================== */

await wheel(400, 450, 1000);
lay = JSON.parse(await layout());
sc = JSON.parse(await scroll());
check("wheel past intro: intro off", lay.intro === false, lay);
check("wheel past intro: parked on step 0", sc.atSnap && sc.y === 0, `y=${sc.y}`);
check("wheel past intro: reader docked (no transform)", /matrix\(1, 0, 0, 1, 0, 0\)/.test(lay.readerTransform) || lay.readerTransform === "none", lay.readerTransform);
check("wheel past intro: camera re-centered", lay.frameX > 200, `frameX=${lay.frameX}`);
check("wheel past intro: overlay re-centered left of reader", lay.overlayRight !== "0px" && lay.overlayRight.length > 2, lay.overlayRight);
check("wheel past intro: step 0 / hero", (await evalJson(`window.__wp1.scene()`)) === "hero" && (await evalJson(`window.__wp1.step()`)) === 0);

// Docked: canvas wheel zooms again.
zBefore = await zoomRadius();
await wheel(400, 450, -240);
const zZoomed = await zoomRadius();
check("docked canvas wheel: zoom restored", zZoomed !== zBefore, `${zBefore} -> ${zZoomed}`);
await wheel(400, 450, 240); // zoom back out for a clean framing

// Docked: reader wheel advances to step 1.
await wheel(1300, 450, 1000);
await sleep(2500); // step-1 entry animation + lock drain
check("reader wheel: advances to task-a", (await evalJson(`window.__wp1.scene()`)) === "task-a" && (await evalJson(`window.__wp1.step()`)) === 1);
lay = JSON.parse(await layout());
check("step 1: stays docked", lay.intro === false, lay);

/* ==================== 4. scrolling back re-expands ==================== */

await wheel(1300, 450, -1000); // back to step 0 (docked)
await sleep(1200);
check("wheel back: step 0 docked", (await evalJson(`window.__wp1.step()`)) === 0 && JSON.parse(await layout()).intro === false);

await key("ArrowUp", "ArrowUp", 38); // step 0 → the intro
lay = JSON.parse(await layout());
sc = JSON.parse(await scroll());
check("ArrowUp from step 0: intro re-expands", lay.intro === true, lay);
check("intro re-expanded: reader off, camera un-shifted", !/matrix\(1, 0, 0, 1, 0, 0\)/.test(lay.readerTransform) && lay.frameX === 0, `frameX=${lay.frameX}`);
check("intro re-expanded: parked at the intro park", sc.y === -sc.introPark, `y=${sc.y}`);

/* ==================== 5. intro exits: wheel / Space / click ==================== */

await key("ArrowDown", "ArrowDown", 40); // intro → step 0 (docked)
lay = JSON.parse(await layout());
check("ArrowDown from intro: docks on step 0", lay.intro === false && (await evalJson(`window.__wp1.step()`)) === 0, lay);

await key("ArrowUp", "ArrowUp", 38); // intro again
await key(" ", "Space", 32); // Space from intro: dock on step 0
lay = JSON.parse(await layout());
check("Space from intro: docks on step 0", lay.intro === false && (await evalJson(`window.__wp1.step()`)) === 0, lay);

// Orbit drag at the intro must NOT advance; a plain click must.
await key("ArrowUp", "ArrowUp", 38); // intro
await send("Input.dispatchMouseEvent", { type: "mousePressed", x: 500, y: 450, button: "left", buttons: 1, clickCount: 1, pointerType: "mouse" });
for (let i = 1; i <= 10; i++) {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 500 + 12 * i, y: 450 + 4 * i, buttons: 1, pointerType: "mouse" });
  await sleep(16);
}
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 620, y: 490, button: "left", buttons: 0, clickCount: 1, pointerType: "mouse" });
await sleep(1100);
lay = JSON.parse(await layout());
check("intro orbit drag: stays full-bleed", lay.intro === true, lay);

await send("Input.dispatchMouseEvent", { type: "mousePressed", x: 500, y: 450, button: "left", buttons: 1, clickCount: 1, pointerType: "mouse" });
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 500, y: 450, button: "left", buttons: 0, clickCount: 1, pointerType: "mouse" });
await sleep(1100);
lay = JSON.parse(await layout());
check("intro plain click: docks on step 0", lay.intro === false && (await evalJson(`window.__wp1.step()`)) === 0, lay);

/* ==================== 6. hooks ==================== */

await send("Page.navigate", { url: `${base}/?shot=hero` });
await sleep(2500);
const heroLay = JSON.parse(await layout());
check("?shot=hero: full-bleed intro pose", heroLay.intro === true && heroLay.frameX === 0, heroLay);
check("?shot=hero: hero scene frozen", (await evalJson(`window.__wp1.scene()`)) === "hero" && (await evalJson(`window.__wp1.debug().frozen`)) === true);

await send("Page.navigate", { url: `${base}/?shot=intro` });
await sleep(2500);
const introLay = JSON.parse(await layout());
check("?shot=intro: identical layout flags", JSON.stringify({ ...introLay, readerTransform: heroLay.readerTransform === introLay.readerTransform ? introLay.readerTransform : "DIFF" }) === JSON.stringify({ ...heroLay, readerTransform: introLay.readerTransform }), `${heroLay.frameX} vs ${introLay.frameX}`);
check("?shot=intro: hero scene frozen", (await evalJson(`window.__wp1.scene()`)) === "hero");

await send("Page.navigate", { url: `${base}/?shot=task-a` });
await sleep(2500);
const taskLay = JSON.parse(await layout());
check("?shot=task-a: boots DOCKED", taskLay.intro === false && taskLay.frameX > 200, taskLay);

await send("Page.navigate", { url: `${base}/?step=0` });
await sleep(2500);
const step0 = JSON.parse(await layout());
check("?step=0: docks on the how-works page", step0.intro === false && (await evalJson(`window.__wp1.step()`)) === 0, step0);

// Visual evidence: the intro pose and the docked step-0 pose.
await send("Page.navigate", { url: `${base}/?shot=intro` });
await sleep(2500);
const introPng = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(resolve("shots", "intro-verify.png"), Buffer.from(introPng.data, "base64"));

ws.close();
proc.kill();
try {
  rmSync(profile, { recursive: true, force: true });
} catch {
  // temp profile may still be locked; harmless
}
process.exit(failures === 0 ? 0 : 1);
