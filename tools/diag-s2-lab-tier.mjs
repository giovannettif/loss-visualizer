// diag-s2-lab-tier.mjs — PERF25-S2-LAB-REBUILD-LONGTASKS acceptance probe:
// setLab arms the software-GL motion tier while a slider drag streams (pixel
// ratio drops to 0.35), re-arms it on every live rebuild, and releases it
// ~250ms after the last input. Observed via the WebGL canvas drawing-buffer
// vs CSS size ratio (hardware GL: tier is a no-op — this probe REQUIRES the
// SwiftShader launch, run with LP_SOFT_GL=1).
// Usage: LP_SOFT_GL=1 node tools/diag-s2-lab-tier.mjs [base]
import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";

const base = process.argv[2] ?? "http://localhost:4185";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

await page.goto(`${base}/?step=13`, { waitUntil: "load" });
await page.waitForFunction(
  () => {
    const b = document.querySelector("#boot");
    return !b || b.dataset.done === "true";
  },
  null,
  { timeout: 20000 },
).catch(() => {});
for (let i = 0; i < 80; i++) {
  const a = await page.evaluate(() => ({
    locked: window.__wp1?.locked?.() ?? true,
    animating: window.__wp1?.animating?.() ?? true,
  }));
  if (!a.locked && !a.animating) break;
  await sleep(150);
}
await sleep(600);

const glInfo = await page.evaluate(() => {
  const c = document.querySelector("canvas");
  const gl = c?.getContext("webgl2") ?? c?.getContext("webgl");
  return gl ? gl.getParameter(gl.RENDERER) : "no-gl";
});
console.log("GL:", glInfo);

/** Drawing-buffer ratio of the WebGL canvas (tier ON ≈ 0.35 at dpr 1). */
const bufferRatio = () =>
  page.evaluate(() => {
    const c = document.querySelector("#gl-canvas") ?? document.querySelector("canvas");
    return c ? Math.round((c.width / c.clientWidth) * 100) / 100 : null;
  });

const restRatio = await bufferRatio();

// Stream a 1.6s drag; sample mid-drag (tier must be armed), then after the
// ~250ms release window (tier must be off again).
const r = await page.locator("#elong-slider").boundingBox();
const y = r.y + r.height / 2;
await page.mouse.move(r.x + r.width * 0.1, y);
await page.mouse.down();
let liveRatio = -1;
for (let i = 1; i <= 64; i++) {
  await page.mouse.move(r.x + r.width * (0.1 + 0.8 * (i / 64)), y);
  await sleep(25);
  if (i === 48) liveRatio = await bufferRatio(); // ~1.2s in, drag held
}
await page.mouse.up();
await sleep(800); // past the 250ms release window
const afterRatio = await bufferRatio();

console.log(`bufferRatio at rest = ${restRatio}`);
console.log(`bufferRatio mid-drag = ${liveRatio}`);
console.log(`bufferRatio after release = ${afterRatio}`);

let bad = 0;
const check = (id, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  [${id}] ${detail}`);
  if (!ok) bad++;
};
check("tier-armed", liveRatio > 0 && liveRatio < restRatio * 0.6,
  `mid-drag ratio ${liveRatio} < 60% of rest ${restRatio} (motion tier armed during streaming input)`);
check("tier-released", Math.abs(afterRatio - restRatio) <= restRatio * 0.05,
  `after ratio ${afterRatio} ≈ rest ${restRatio} (tier released ~250ms after last input)`);

await browser.close();
process.exit(bad ? 1 : 0);
