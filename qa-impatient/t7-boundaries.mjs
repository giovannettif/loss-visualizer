/**
 * T7 — boundary spam:
 *  a) intro <-> step-0 oscillation: rapid wheel down/up/down/up — the dock
 *     gesture guard and the intro re-park must never wedge or desync;
 *  b) deep link ?step=16: wheel/Space spam DURING the boot entry lock must
 *     be swallowed (no early advance), then work normally after the drain;
 *  c) deep-link state sanity for the fog scene (fresh run, budget full).
 */
import { BASE, launch, waitReady, snapshot, ok, shot } from "./driver.mjs";

const { browser, page } = await launch();

// ---------- a) intro oscillation ----------
await page.goto(BASE, { waitUntil: "load" });
await waitReady(page);
const st = () => page.evaluate(() => {
  const s = window.__wp1.scroll();
  const w = window.__wp1;
  return { step: w.step(), intro: s.intro, y: s.y, target: s.target, locked: w.locked(), introPark: s.introPark, zoomMuted: null };
});
console.log("start:", JSON.stringify(await st()));

// oscillate: down / up / down / up ... 350ms gaps (past both guards). The
// cursor stays at x=1150: in INTRO that point is the canvas (window handler
// owns it), docked it is the READER (wheel = scroll). Wheeling at x=600 when
// docked would zoom the camera instead (correct policy) — never scroll.
const trace = [];
for (let i = 0; i < 8; i++) {
  await page.mouse.move(1150, 450);
  await page.mouse.wheel(0, i % 2 ? -600 : 600);
  await page.waitForTimeout(350);
  trace.push(await st());
}
console.log("osc trace:", trace.map((t) => `${t.intro ? "I" : "d"}${t.step}@${t.y}`).join(" "));
const last = trace[trace.length - 1];
const consistent =
  (last.intro && last.step === 0 && Math.abs(last.y + last.introPark) < 2) ||
  (!last.intro && last.step === 0 && Math.abs(last.y - last.target) < 2);
ok(consistent, "oscillation ends in a consistent state (intro parked or step 0 parked)", JSON.stringify(last));
const sawIntro = trace.some((t) => t.intro);
const sawDocked = trace.some((t) => !t.intro);
ok(sawIntro && sawDocked, "oscillation actually toggled BOTH ways (intro and docked)", `intro seen=${sawIntro} docked seen=${sawDocked}`);

// settle to docked step 0: ensure we are docked first, then one down gesture
await page.mouse.move(1150, 450);
if ((await st()).intro) {
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(600);
}
let s = await snapshot(page);
ok(!s.scroll.intro && s.step === 0, "final downward gesture docks on step 0", JSON.stringify({ intro: s.scroll.intro, step: s.step }));
// a fresh gesture (after 300ms dock-guard idle) must reach the canvas zoom OR the reader — assert no wedge: reader still navigates
await page.mouse.move(1150, 450);
await page.mouse.wheel(0, 500);
await page.waitForTimeout(220);
await page.mouse.wheel(0, 500);
await page.waitForTimeout(2200);
s = await snapshot(page);
console.log("post-dock navigation:", JSON.stringify({ step: s.step, locked: s.locked, parked: s.scroll.parked }));
ok(s.step === 1 || s.step === 0, "docked reader navigates normally after the dock guard", `step=${s.step}`);

// ---------- b) deep-link boot lock spam ----------
await page.goto(BASE + "?step=16", { waitUntil: "load" });
// hammer IMMEDIATELY (boot entry lock should be live)
const bootSpam = await page.evaluate(async () => {
  const seen = [];
  const t0 = performance.now();
  while (performance.now() - t0 < 1500) {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true, cancelable: true }));
    window.dispatchEvent(new KeyboardEvent("keyup", { key: " ", code: "Space", bubbles: true, cancelable: true }));
    seen.push(`${window.__wp1.step()}${window.__wp1.locked() ? "L" : ""}`);
    await new Promise((r) => setTimeout(r, 50));
  }
  return seen.join(",");
});
console.log("boot spam trace:", bootSpam.slice(0, 120), "...");
const bootStart = bootSpam.split(",")[0];
ok(bootStart.includes("L"), "deep-link boot is LOCKED on arrival (spam swallowed while landing)", bootStart);
const fogDeep = await page.evaluate(() => ({ step: window.__wp1.step(), f: window.__wp1.fog() ? { level: window.__wp1.fog().level, used: window.__wp1.fog().used, budget: window.__wp1.fog().budget, done: window.__wp1.fog().done } : null }));
console.log("deep-link fog state:", JSON.stringify(fogDeep));
ok(fogDeep.f && fogDeep.f.used === 0 && fogDeep.f.budget === 10,
  "deep-linked fog: no phantom measurements (used=0, budget intact)",
  JSON.stringify(fogDeep));
ok(fogDeep.step === 16 ? fogDeep.f.done === false : fogDeep.f.done === true,
  "done flag coherent with the landed page (16 fresh run / 17 reveal auto-finishes by design, director.ts:6765-6768)",
  `step=${fogDeep.step} done=${fogDeep.f.done}`);

// after the boot drain, one clean Space must advance exactly once
await page.waitForTimeout(3500);
let s2 = await snapshot(page);
const pre = s2.step;
await page.keyboard.press("Space");
await page.waitForTimeout(1800);
s2 = await snapshot(page);
ok(s2.step === pre + 1, "after the boot drain, keys work normally (exactly one advance)", `pre=${pre} post=${s2.step}`);
ok(s2.railCurrent === s2.step && s2.activeInert, "consistent after boot spam", `rail=${s2.railCurrent}`);

await shot(page, "t7-end");
await browser.close();
console.log("T7 done");
