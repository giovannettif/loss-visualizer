/**
 * diag-s1-dragtween — S1-DRAG-VS-TWEEN repro (finding S1-DRAG-VS-TWEEN).
 *
 * Task-b → task-c entry creates rise (1.15s) / opac (0.7s) / fw-fb (0.95s)
 * tweens. 300ms in, grab the fit inset line body at data x=-2 and drag UP
 * 60px over ~0.5s while sampling __wp1.fit().b.
 *
 *   mode "wait": let everything settle → the dragged fit must persist.
 *   mode "skip": call __wp1.skip() (finishTransitionsNow) right after the
 *                drag → the dragged fit must persist (S1-ADVANCE-SNAP).
 *
 * Pre-fix signature: b frozen mid-tween during the drag, final snapped back
 * to a stale value. Fixed signature: b follows the drag every sample and the
 * final fit is the dragged one.
 *
 * Usage: node tools/diag-s1-dragtween.mjs [baseUrl] [mode]
 */
import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";

const base = process.argv[2] ?? "http://127.0.0.1:4285";
const mode = process.argv[3] ?? "wait";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

await page.goto(`${base}/?step=2`, { waitUntil: "load" });
for (let i = 0; i < 40; i++) {
  if (!(await page.evaluate(() => window.__wp1.animating()))) break;
  await sleep(250);
}
await sleep(3000); // the repro's "wait 3s" at task-b
console.log("pre-arrow", JSON.stringify(await page.evaluate(() => ({
  scene: window.__wp1.scene(), step: window.__wp1.step(),
  fit: window.__wp1.fit(), anim: window.__wp1.animating(),
}))));

await page.keyboard.press("ArrowDown"); // task-b → task-c
await sleep(300); // the repro's 300ms delay — tweens still in flight

// Compute the grab point (line body at data x=-2) with the inset's own
// mapping (FitPreview.ts constants X_MIN..Y_MAX, margins M), from the LIVE
// rect and the live fit, then drag up 60px over ~0.5s sampling every move.
const grab = await page.evaluate(() => {
  const cv = document.querySelector("#fit-canvas");
  const r = cv.getBoundingClientRect();
  const M = { l: 30, r: 12, t: 10, b: 22 };
  const X_MIN = -4.2, X_MAX = 4.6, Y_MIN = -2.1, Y_MAX = 5.7;
  const px = (x) => M.l + ((x - X_MIN) / (X_MAX - X_MIN)) * (r.width - M.l - M.r);
  const py = (y) => r.height - M.b - ((y - Y_MIN) / (Y_MAX - Y_MIN)) * (r.height - M.t - M.b);
  const f = window.__wp1.fit();
  return { x: r.x + px(-2), y: r.y + py(f.w * -2 + f.b), h: r.height, fit0: f };
});
console.log("grab-at", JSON.stringify(grab));

const dataYPerPx = (5.7 - -2.1) / (grab.h - 10 - 22); // dataY(-60px)
const expectDB = 60 * dataYPerPx;

await page.mouse.move(grab.x, grab.y);
// Read the fit NOW (the fw/fb tweens are still running, so the line moved
// since the grab-point computation ~60ms ago; onDown will capture whatever
// the fit is at the actual pointerdown and the body drag preserves its w).
const pd = await page.evaluate(() => window.__wp1.fit());
await page.mouse.down();
const samples = [];
const N = 12; // 12 × 5px moves ≈ 0.5s of drag
for (let i = 1; i <= N; i++) {
  await page.mouse.move(grab.x, grab.y - 5 * i);
  samples.push(await page.evaluate(() => ({
    fit: window.__wp1.fit(), anim: window.__wp1.animating(),
    scene: window.__wp1.scene(),
  })));
  await sleep(40);
}
await page.mouse.up();
console.log("drag-samples", JSON.stringify(samples.map((s) => +s.fit.b.toFixed(3))));
console.log("drag-anim", JSON.stringify(samples.map((s) => s.anim)));
const moved = Math.max(...samples.map((s) => Math.abs(s.fit.b - pd.b)));
const expectedB = Math.min(5, Math.max(-3, pd.b + expectDB));

if (mode === "skip") {
  await page.evaluate(() => window.__wp1.skip()); // finishTransitionsNow mid-tween
}
await sleep(2500); // settle
const fin = await page.evaluate(() => ({
  fit: window.__wp1.fit(), loss: window.__wp1.loss(),
  scene: window.__wp1.scene(), anim: window.__wp1.animating(),
}));
console.log("final", JSON.stringify({ ...fin, expectedB: +expectedB.toFixed(3), pd }));

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
check("drag-during-tween-moves-b", moved > 1.0, `max|Δb|=${moved.toFixed(3)} (frozen would be ~0)`);
check("final-scene-task-c", fin.scene === "task-c", fin.scene);
check("final-b-is-dragged", Math.abs(fin.fit.b - expectedB) < 0.1,
  `b=${fin.fit.b.toFixed(3)} expected≈${expectedB.toFixed(3)}`);
check("final-w-preserved", Math.abs(fin.fit.w - pd.w) < 0.15,
  // 0.15 ≫ the ≤60ms tween-advance gap between the pd read and the
  // pointerdown dispatch, yet ≪ the +0.83 the live fw tween would add
  // if it were still driving w (it targets ARGMIN w≈0.91).
  `w=${fin.fit.w.toFixed(3)} pointerdown w=${pd.w.toFixed(3)}`);
check("settled", fin.anim === false, `animating=${fin.anim}`);

await browser.close();
process.exit(failures ? 1 : 0);
