// Diagnostic (sweep-2) for QA S2-ADAM-1: §4 adam-b (steepness ×50) Play
// transport — the divergent GD lane must stop ON the terrain rim, not paint
// across the void. Repro from the finding: ?step=12 → ▶ Play → ~6s; the raw
// lane's last point was (−42.118, −14.049), 2.8× beyond the ±15 extent.
// PASS = replayInfo.positions[0] (the GD lane's displayed point) stays inside
// the ±15.75 clamp bound (extent × 1.05) at every sample, and the GD ball
// parks at the rim instead of leaving the frame.
import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";
const base = process.argv[2] ?? "http://localhost:4181/";
const step = process.argv[3] ?? "12";
const out = `qa/diag-adam1/s${step}/`;
const browser = await launchGL(chromium, {});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
page.on("console", (m) => { if (m.type() === "error") errs.push(m.type() + ": " + m.text()); });
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const info = () => page.evaluate(() => {
  const ri = window.__wp1.replayInfo();
  return {
    scene: window.__wp1.scene(), lanes: ri.lanes, playing: ri.playing,
    progress: Math.round((ri.progress ?? 0) * 1000) / 1000,
    pos: ri.positions.map((p) => [Math.round(p.x * 1000) / 1000, Math.round(p.y * 1000) / 1000]),
  };
});
let fail = 0;
const check = (tag, pos) => {
  const gd = pos[0];
  const bad = Math.abs(gd[0]) > 15.75 || Math.abs(gd[1]) > 15.75;
  if (bad) fail++;
  console.log(`${bad ? "FAIL" : "ok  "} ${tag} gd=[${gd[0]}, ${gd[1]}] adam=[${pos[1]?.[0]}, ${pos[1]?.[1]}]`);
};

await page.goto(base + "?step=" + step);
await page.waitForFunction(() => window.__wp1 && !document.getElementById("boot"), null, { timeout: 30000 });
await sleep(3000);
console.log("pre-play", JSON.stringify(await info()));
await page.click("#play-btn");
await sleep(500);
const early = await info();
check("early(+0.5s)", early.pos);
await page.screenshot({ path: out + "b-early.png" });
await sleep(1500);
const mid = await info();
check("mid(+2.0s)", mid.pos);
await page.screenshot({ path: out + "b-mid.png" });
await sleep(1500);
const mid2 = await info();
check("mid2(+3.5s)", mid2.pos);
await sleep(3000);
const post = await info();
check("post(+6.5s)", post.pos);
await page.screenshot({ path: out + "b-post.png" });
// Parked point of the GD ball after the ride: must be inside the extent box.
console.log(fail === 0 ? "PASS: GD lane stayed in-bounds at every sample" : `FAIL: ${fail} sample(s) out of bounds`);
console.log("errs", JSON.stringify(errs));
await browser.close();
process.exit(fail === 0 && errs.length === 0 ? 0 : 1);
