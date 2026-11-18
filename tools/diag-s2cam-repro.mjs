// Diagnostic for S2CAM-HERO-POSE-LEAKS-INTO-S1: does §1 (task-a/b/c) frame
// isometrically regardless of the arrival path (hero drift, hero orbit)?
// Usage: node tools/diag-s2cam-repro.mjs [base]   (base default :4185)
import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";
const base = process.argv[2] ?? "http://localhost:4185";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) fails += 1;
};
const browser = await launchGL(chromium);
async function open(path, w = 1600, h = 900) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(`${base}/${path}`, { waitUntil: "load" });
  await page.waitForFunction(() => { const b = document.querySelector("#boot"); return !b || b.dataset.done === "true"; }, null, { timeout: 15000 }).catch(() => {});
  await sleep(800);
  return page;
}
async function idle(page, ms = 12000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const a = await page.evaluate(() => window.__wp1.locked() || window.__wp1.animating());
    if (!a) break;
    await sleep(150);
  }
  await sleep(300);
}
const att = (page) => page.evaluate(() => window.__wp1.debug().viewAttitude);
const isoBtn = (page) => page.evaluate(() => document.querySelector('.lv-btn[data-preset="iso"]')?.dataset.active ?? "(missing)");
const norm = (az) => ((az + 540) % 360) - 180; // -> [-180, 180)
const isIso = (a) => Math.abs(norm(a.azimuthDeg) - -60) < 0.5 && Math.abs(a.elevationDeg - 35) < 0.5;
const fmt = (a) => `az ${norm(a.azimuthDeg).toFixed(2)} el ${a.elevationDeg.toFixed(2)}`;

/* Control: deep link straight into §1 */
{
  const page = await open("?step=1");
  await idle(page);
  const a = await att(page);
  check("CONTROL ?step=1: task-a at isometric -60/35", isIso(a), fmt(a));
  console.log(`      iso button data-active=${await isoBtn(page)}`);
  await page.close();
}

/* R1 — the finding's repro: hero → dock → 25 s auto-drift → task-a */
{
  const page = await open("");
  await page.keyboard.press("ArrowDown"); // dock the hero
  await sleep(25000); // hero auto-drift 1.5°/s ≈ 37° of arbitrary attitude
  const hero = await att(page);
  await page.keyboard.press("ArrowDown"); // advance to task-a
  await sleep(2500);
  await idle(page);
  const a = await att(page);
  console.log(`      hero attitude before entering §1: ${fmt(hero)}`);
  check("R1 drift 25s: task-a lands at isometric -60/35", isIso(a), fmt(a));
  console.log(`      iso button data-active=${await isoBtn(page)}`);
  await page.keyboard.press("ArrowDown"); // task-b
  await sleep(2500);
  await idle(page);
  const b = await att(page);
  check("R1 task-b still isometric -60/35", isIso(b), fmt(b));
  await page.keyboard.press("ArrowDown"); // task-c
  await sleep(2500);
  await idle(page);
  const c = await att(page);
  check("R1 task-c still isometric -60/35", isIso(c), fmt(c));
  await page.close();
}

/* R2 — arrival path 2: user RIGHT-drag orbit on the hero (the 2026-11-09
 * scheme: right-drag orbits, LandscapeView.ts onPointerDown), then task-a */
{
  const page = await open("");
  await page.keyboard.press("ArrowDown"); // dock
  await idle(page, 8000);
  const cv = await page.locator("canvas").first().boundingBox();
  const a0 = await att(page);
  await page.mouse.move(cv.x + 450, cv.y + 400);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(cv.x + 450 + 380, cv.y + 400 - 300, { steps: 30 });
  await page.mouse.up({ button: "right" });
  await sleep(500);
  const hero = await att(page);
  check("R2 precheck: right-drag actually moved the hero pose",
    Math.abs(norm(hero.azimuthDeg) - norm(a0.azimuthDeg)) > 10 || Math.abs(hero.elevationDeg - a0.elevationDeg) > 10,
    `${fmt(a0)} -> ${fmt(hero)}`);
  await page.keyboard.press("ArrowDown"); // task-a
  await sleep(2500);
  await idle(page);
  const a = await att(page);
  console.log(`      hero attitude after user orbit: ${fmt(hero)}`);
  check("R2 hero orbit: task-a lands at isometric -60/35", isIso(a), fmt(a));
  console.log(`      iso button data-active=${await isoBtn(page)}`);
  await page.close();
}

await browser.close();
console.log(fails === 0 ? "ALL PASS" : `${fails} FAIL`);
process.exit(fails === 0 ? 0 : 1);
