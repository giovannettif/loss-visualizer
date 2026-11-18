/**
 * diag-intro-ctrlwheel.mjs — reproduces finding S2-INTRO-CTRLWHEEL: in the
 * full-bleed intro, Ctrl+wheel (browser page zoom / trackpad pinch) must go
 * to the browser — never preventDefault'd, never scrolled, never docking the
 * reader (same policy as the docked reader's KW-7 fix, main.ts onReaderWheel).
 *
 *   1. Boot / at 1600x900, wait for the intro to park (intro=true, target=-introPark).
 *   2. Inject a passive window wheel listener that records {ctrl, defaultPrevented}.
 *   3. Hold Control, send 4 wheel notches of +100 at (800,600) (CDP modifiers=2).
 *   4. Pinch-like burst: 40 ctrl notches of +8 (trackpad pinch reports small deltas).
 *   5. Control: one PLAIN notch of +100 — the handler must still own plain
 *      wheels (defaultPrevented=true, target moves ~+100).
 *
 * Expected (fixed): steps 3–4 log ctrl=true dp=false, intro stays true, the
 * target never leaves -introPark. Buggy: dp=true and/or the page docks
 * (intro=false) or the target creeps.
 *
 * Usage: node tools/diag-intro-ctrlwheel.mjs [baseUrl]
 */

import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";

const base = process.argv[2] ?? "http://localhost:4173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

await page.goto(`${base}/`, { waitUntil: "load" });
for (let i = 0; i < 80; i++) {
  const ok = await page.evaluate(() =>
    window.__wp1 && !window.__wp1.locked() && !window.__wp1.animating());
  if (ok) break;
  await sleep(250);
}
await sleep(600);

// Passive window listener: sees every wheel after the app's handlers ran, so
// dp reflects whether ANY of them called preventDefault (finding's probe).
await page.evaluate(() => {
  window.__wl = [];
  window.addEventListener("wheel", (e) => {
    window.__wl.push({ ctrl: e.ctrlKey, dp: e.defaultPrevented, dy: e.deltaY });
  }, { passive: true });
});

const cdp = await page.context().newCDPSession(page);
const wheel = (dy, mods) => cdp.send("Input.dispatchMouseEvent", {
  type: "mouseWheel", x: 800, y: 600, deltaX: 0, deltaY: dy, modifiers: mods, pointerType: "mouse",
});
const state = () => page.evaluate(() => {
  const s = window.__wp1.scroll();
  return { intro: s.intro, y: s.y, target: s.target, introPark: s.introPark };
});

const s0 = await state();
console.log("start:", JSON.stringify(s0));
if (!s0.intro) { console.log("FAIL  boot did not open on the intro"); await browser.close(); process.exit(1); }

/* --- 3: ctrl+wheel, 4 notches of +100 (the finding's repro) --- */
for (let i = 0; i < 4; i++) { await wheel(100, 2); await sleep(80); }
await sleep(400);
const log1 = await page.evaluate(() => window.__wl.splice(0));
const s1 = await state();
console.log("4x ctrl+100:", JSON.stringify(s1));
console.log("  events:", JSON.stringify(log1));

/* --- 4: pinch-like burst, 40 ctrl notches of +8 --- */
for (let i = 0; i < 40; i++) { await wheel(8, 2); await sleep(15); }
await sleep(400);
const log2 = await page.evaluate(() => window.__wl.splice(0));
const s2 = await state();
console.log("40x ctrl+8 (pinch):", JSON.stringify(s2));
console.log("  events (first 5, last 5):", JSON.stringify(log2.slice(0, 5)), "...", JSON.stringify(log2.slice(-5)));

/* --- 5: control — one plain notch must still scroll the intro --- */
await wheel(100, 0);
await sleep(400);
const log3 = await page.evaluate(() => window.__wl.splice(0));
const s3 = await state();
console.log("1x plain+100:", JSON.stringify(s3));
console.log("  events:", JSON.stringify(log3));

/* --- verdict --- */
const allNotPrevented = (log) => log.length > 0 && log.every((e) => e.ctrl && !e.dp);
const f1 = allNotPrevented(log1) && s1.intro && Math.abs(s1.target - s0.target) < 1;
const f2 = allNotPrevented(log2) && s2.intro && Math.abs(s2.target - s0.target) < 1;
const f3 = log3.length === 1 && log3[0].dp && !log3[0].ctrl &&
  s3.target > s2.target + 50; // plain wheel still owns the intro scroll
console.log(`${f1 ? "PASS" : "FAIL"}  ctrl notches: none preventDefaulted, no scroll, no dock`);
console.log(`${f2 ? "PASS" : "FAIL"}  pinch burst: none preventDefaulted, no scroll, no dock`);
console.log(`${f3 ? "PASS" : "FAIL"}  plain notch: still owned by the intro handler (dp=true, target advanced)`);

await browser.close();
process.exit(f1 && f2 && f3 ? 0 : 1);
