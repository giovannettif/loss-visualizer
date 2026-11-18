/**
 * diag-s2-bootskip.mjs — Run B of finding S2-SKIP-CROSSFADE-BLANK (rebuilds the
 * lost bootskip.mjs — the real-Skip-click path; qa/S2-SKIP-CROSSFADE-BLANK-r1/
 * keeps the original screenshots, e.g. bootwalk-skip-13-D100.png).
 *
 * Fresh boot (full-bleed intro), wheel down normally to reader step 3
 * (task-c), wait idle, wheel once more into gd-a (step 4 — cross-landscape
 * bowl→ls... actually ls→bowl crossfade), and CLICK the real "Skip animation"
 * button ~150 ms after entry (mid-'out' of the 0.55 s fade). Settle, read
 * __wp1.debug(). Then keep wheel-walking to mom-a (step 8, skip @100 ms) and
 * lab (step 13, skip @100 ms); gd-a is repeated 2×.
 *
 * Bug signature (pre-fix): settled rise 0.000 / opac 0.000 — terrain gone,
 * ball/trails float on black. Expected with the fix: gd-a/mom-a/lab all land
 * rise 1 / opac 1 (their SCENES spec presentation).
 *
 * Usage: node tools/diag-s2-bootskip.mjs [baseUrl]
 */

import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const base = process.argv[2] ?? "http://localhost:4183";
const OUT = join(process.cwd(), "qa", "S2-SKIP-CROSSFADE-BLANK-r2");
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

async function appState() {
  return page.evaluate(() => {
    const d = window.__wp1?.debug?.() ?? null;
    return {
      scene: window.__wp1?.scene?.(),
      step: window.__wp1?.step?.(),
      locked: window.__wp1?.locked?.(),
      animating: window.__wp1?.animating?.(),
      rise: d ? Math.round(d.rise * 1000) / 1000 : null,
      opac: d ? Math.round(d.opac * 1000) / 1000 : null,
      swap: d ? d.swap : null,
      built: d ? d.built : null,
    };
  });
}
async function waitIdle(maxMs = 25000) {
  const t0 = Date.now();
  for (;;) {
    const a = await appState();
    if (!a.locked && !a.animating) return true;
    if (Date.now() - t0 > maxMs) return false;
    await sleep(80);
  }
}
/** One wheel gesture; returns the state after it. In the intro the reader is
 *  translated off-screen, so wheel at viewport center (the intro's window
 *  handler owns any in-viewport wheel); docked, wheel over the reader panel
 *  (the reader-level handler scrolls the document; the canvas would zoom). */
async function wheelOnce() {
  const at = await page.evaluate(() => {
    const intro = window.__wp1.scroll().intro;
    if (intro) return { x: Math.round(innerWidth / 2), y: Math.round(innerHeight / 2) };
    const r = document.querySelector("#reader-body").getBoundingClientRect();
    return { x: r.left + 80, y: Math.min(r.top + r.height / 2, 700) };
  });
  await page.mouse.move(at.x, at.y);
  await page.mouse.wheel(0, 300);
  await sleep(360); // just clear DOCK_GESTURE_IDLE_MS (300, main.ts:374)
  return appState();
}
/** Wheel until reader step == target (intro's first wheel docks on step 0). */
async function wheelToStep(target) {
  for (let i = 0; i < 20; i++) {
    const s = await appState();
    if (s.step === target && !s.locked && !s.animating) return s;
    if (s.step !== target) {
      await wheelOnce();
    } else {
      await waitIdle();
    }
  }
  throw new Error(`wheel walk never reached step ${target}`);
}
/**
 * From an idle parked state, wheel INTO nextStep (the cross-landscape entry)
 * and click the real "Skip animation" button delayMs after the step flips
 * (mid-'out' of the 0.55 s fade). Wheel gestures go over the reader column
 * (the skip button's footer is not a wheel target); after the flip the pointer
 * moves onto the button and the click is two raw pointer events — page.click's
 * actionability checks cost 150-300 ms and pushed clicks into the 'in' stage.
 */
async function wheelIntoAndSkip(nextStep, delayMs, tag) {
  await waitIdle();
  await sleep(300);
  // wheel until the step flips, tight-polling so t0 is within ~30ms of it.
  let s = await appState();
  while (s.step !== nextStep) {
    await page.mouse.wheel(0, 300);
    const t0poll = Date.now();
    for (;;) {
      s = await appState();
      if (s.step === nextStep || Date.now() - t0poll > 2000) break;
      await sleep(30);
    }
    if (s.step === nextStep) break;
    await sleep(300); // this gesture did not cross — re-arm and go again
  }
  const t0 = Date.now();
  const btn = await page.evaluate(() => {
    const r = document.querySelector("#skip-btn").getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.move(btn.x, btn.y);
  const wait = Math.max(0, delayMs - (Date.now() - t0));
  await sleep(wait);
  await page.mouse.down();
  const pre = await appState();
  await page.mouse.up(); // the click lands here — real hit-test at button coords
  const clickDone = Date.now() - t0;
  if (!(await waitIdle())) console.log(`  [${tag}] never idled after Skip click`);
  await sleep(400);
  const post = await appState();
  await page.screenshot({ path: join(OUT, `bootwalk-skip-${tag}.png`) });
  console.log(
    `${tag}: entered step=${nextStep}, clicked Skip +${clickDone}ms ` +
      `(pre: swap=${pre.swap} locked=${pre.locked} rise=${pre.rise} opac=${pre.opac}) → ` +
      `settled rise=${post.rise} opac=${post.opac} scene=${post.scene}`,
  );
  return { pre, post, clickDone };
}

/* ---- gd-a @150 ms, twice (the finding's 2/2) ---- */
await page.goto(base + "/", { waitUntil: "load" });
await sleep(1500);
if (!(await waitIdle())) console.log("intro never idled (hero race loops — not part of animating; unexpected)");
const docked = await wheelToStep(3); // task-c
console.log(`boot walk parked: step=${docked.step} scene=${docked.scene}`);

const SPEC = { 4: { name: "gd-a", rise: 1, opac: 1 }, 8: { name: "mom-a", rise: 1, opac: 1 }, 13: { name: "lab", rise: 1, opac: 1 } };
let fails = 0;

for (const [target, delay, tag] of [[4, 150, "4-D150"], [4, 150, "4-D150-repeat"]]) {
  if (tag === "4-D150-repeat") {
    // re-park on task-c for the repeat (fresh entry each time, like the finding)
    await page.goto(base + "/", { waitUntil: "load" });
    await sleep(1500);
    await waitIdle();
    await wheelToStep(3);
  }
  const r = await wheelIntoAndSkip(target, delay, tag);
  const spec = SPEC[target];
  const ok =
    Math.abs(r.post.rise - spec.rise) <= 0.02 &&
    Math.abs(r.post.opac - spec.opac) <= 0.02 &&
    r.post.scene === spec.name;
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${tag}: settled rise=${r.post.rise} opac=${r.post.opac} (spec ${spec.rise}/${spec.opac})`);
}

/* ---- wheel-walk on to mom-a (8) @100 ms, then lab (13) @100 ms ---- */
await wheelToStep(7);
const rMom = await wheelIntoAndSkip(8, 100, "bootwalk-skip-8-D100");
const okMom =
  Math.abs(rMom.post.rise - 1) <= 0.02 && Math.abs(rMom.post.opac - 1) <= 0.02 && rMom.post.scene === "mom-a";
if (!okMom) fails++;
console.log(`${okMom ? "PASS" : "FAIL"}  mom-a@100ms: settled rise=${rMom.post.rise} opac=${rMom.post.opac}`);

await wheelToStep(12);
const rLab = await wheelIntoAndSkip(13, 100, "bootwalk-skip-13-D100");
const okLab =
  Math.abs(rLab.post.rise - 1) <= 0.02 && Math.abs(rLab.post.opac - 1) <= 0.02 && rLab.post.scene === "lab";
if (!okLab) fails++;
console.log(`${okLab ? "PASS" : "FAIL"}  lab@100ms: settled rise=${rLab.post.rise} opac=${rLab.post.opac}`);

await browser.close();
console.log(`\n${fails === 0 ? "ALL PASS" : fails + " FAILURES"}`);
process.exit(fails === 0 ? 0 : 1);
