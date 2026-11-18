// SCRUB-HITCH on HARDWARE GL (--use-angle=d3d11 --enable-gpu): the
// end-user-browser condition. Playback gaps + paced scrub drag + input cost.
import { chromium } from "playwright";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.addInitScript(() => {
  document.addEventListener("input", (e) => {
    if (e.target && e.target.id === "replay-scrub") window.__inpStart = performance.now();
  }, { capture: true });
});
await page.goto("http://localhost:4193/?step=13", { waitUntil: "load" });
await page.evaluate(() => {
  window.__ticks = [];
  window.__inp = [];
  let last = null;
  const tick = (now) => {
    const gap = last == null ? null : now - last;
    last = now;
    window.__ticks.push(gap == null ? null : +gap.toFixed(2));
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  document.addEventListener("input", (e) => {
    if (e.target && e.target.id === "replay-scrub") {
      window.__inp.push(+(performance.now() - (window.__inpStart ?? 0)).toFixed(2));
    }
  }, { capture: false });
});
for (let i = 0; i < 60; i++) {
  const a = await page.evaluate(() => ({
    locked: window.__wp1?.locked?.() ?? true,
    animating: window.__wp1?.animating?.() ?? true,
  }));
  if (!a.locked && !a.animating) break;
  await sleep(250);
}
await sleep(400);
const backend = await page.evaluate(() => {
  const c = document.createElement("canvas");
  const gl = c.getContext("webgl2");
  const e = gl.getExtension("WEBGL_debug_renderer_info");
  return gl.getParameter(e.UNMASKED_RENDERER_WEBGL);
});
console.log("GL backend:", backend);

const stats = (label) => page.evaluate((lbl) => {
  const gaps = window.__ticks.filter((g) => g != null);
  const sorted = [...gaps].sort((a, b) => a - b);
  const p = (q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : NaN);
  const inp = window.__inp;
  const r = {
    label: lbl,
    frames: gaps.length,
    p50: +p(0.5).toFixed(1),
    p95: +p(0.95).toFixed(1),
    max: +Math.max(...gaps).toFixed(1),
    over32Pct: +((100 * gaps.filter((g) => g > 32).length) / gaps.length).toFixed(1),
    inputEvents: inp.length,
    inpDtP50: inp.length ? [...inp].sort((a, b) => a - b)[Math.floor(inp.length / 2)] : null,
    inpDtP95: inp.length ? [...inp].sort((a, b) => a - b)[Math.floor(inp.length * 0.95)] : null,
  };
  window.__ticks.length = 0;
  window.__inp.length = 0;
  return r;
}, label);

// 1. Idle control
await sleep(2000);
console.log("IDLE:", JSON.stringify(await stats("idle")));

// 2. Playback
await page.click("#play-btn");
await sleep(4500);
console.log("PLAYBACK:", JSON.stringify(await stats("playback")));
await page.waitForFunction(
  () => Number(document.querySelector("#replay-scrub")?.value ?? 0) >= 999,
  null, { timeout: 60000 },
).catch(() => console.log("playback did not finish"));
await sleep(300);

// 3. Paced scrub drag
const box = await page.locator("#replay-scrub").boundingBox();
const y = Math.round(box.y + box.height / 2);
const x0 = Math.round(box.x + box.width * 0.04);
const x1 = Math.round(box.x + box.width * 0.96);
const cdp = await page.context().newCDPSession(page);
const t0 = Date.now();
await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: x0, y, button: "left", clickCount: 1 });
for (let i = 1; i <= 120; i++) {
  const x = Math.round(x0 + (x1 - x0) * (i / 120));
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1 });
  const target = t0 + (i / 120) * 2000;
  const wait = target - Date.now();
  if (wait > 0) await sleep(wait);
}
await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: x1, y, button: "left", clickCount: 1 });
console.log("SCRUB paced:", JSON.stringify(await stats("scrub-paced")), "dragMs:", Date.now() - t0);
await sleep(400);

// 4. Repeat drag for stability
const t1 = Date.now();
await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: x1, y, button: "left", clickCount: 1 });
for (let i = 1; i <= 120; i++) {
  const x = Math.round(x1 + (x0 - x1) * (i / 120));
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1 });
  const target = t1 + (i / 120) * 2000;
  const wait = target - Date.now();
  if (wait > 0) await sleep(wait);
}
await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: x0, y, button: "left", clickCount: 1 });
console.log("SCRUB paced2:", JSON.stringify(await stats("scrub-paced-2")), "dragMs:", Date.now() - t1);

await browser.close();
console.log("DONE");
