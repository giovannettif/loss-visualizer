/**
 * diag-s2b26-retired-remove.mjs — verification probe for QA
 * S2B26-RETIRED-REMOVE-CUTS.
 *
 * The finding: on a landscape crossfade the OUTGOING scene's exit dispose
 * calls view.removeOverlayObject(...), and the pre-fix version detached the
 * object from retiredGroup immediately — so the overlay vanished in the
 * first fade frame while the terrain was still opaque.
 *
 * The fix (src/view/LandscapeView.ts removeOverlayObject): walk the parent
 * chain; if the object lives under retiredGroup, leave it in place —
 * flushRetired() disposes it at rebuildNow (opacity 0).
 *
 * Observable via window.__wp1.debug(): `retired` (retiredGroup child count),
 * `overlayFade`, `swap` ("out" | "in" | null). Under the fix, each crossfade
 * must show retired > 0 while swap === "out" (the fade is running), and
 * retired === 0 again once idle (flushed at rebuildNow). Under the bug,
 * retired would drop to ~0 within the first samples after the click.
 *
 * Usage: node tools/diag-s2b26-retired-remove.mjs [baseUrl]
 */

import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";

const base = process.argv[2] ?? "http://localhost:4173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await launchGL(chromium, {});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
page.on("console", (m) => {
  if (m.type() === "error") console.log("CONSOLE-ERROR:", m.text());
});

async function waitIdle() {
  for (let i = 0; i < 120; i++) {
    const a = await page.evaluate(() => ({
      locked: window.__wp1?.locked?.() ?? false,
      animating: window.__wp1?.animating?.() ?? false,
    }));
    if (!a.locked && !a.animating) return true;
    await sleep(250);
  }
  return false;
}

/**
 * Drives one transition and samples the retired/fade state through it.
 * Returns { samples, keptDuringFade, maxRetired, flushedIdle }.
 */
async function probeTransition(fromStep, label) {
  await page.goto(`${base}/?step=${fromStep}`, { waitUntil: "load" });
  const idle0 = await waitIdle();
  await sleep(1200); // let the entry settle fully
  const before = await page.evaluate(() => {
    const d = window.__wp1.debug();
    return { retired: d.retired, fade: d.overlayFade, swap: d.swap };
  });

  // Click "continue ↓" (fall back to the rail button for that step).
  const samples = [];
  let advanced = false;
  try {
    await page.click("#continue-hint", { force: true, timeout: 3000 });
    advanced = true;
  } catch {
    await page.click(`#rail button:nth-child(${fromStep + 2})`, { force: true });
    advanced = true;
  }
  // Sample fast through the whole fade (~0.55 s out + ~1.2 s in).
  for (let i = 0; i < 60; i++) {
    const d = await page.evaluate(() => {
      const s = window.__wp1.debug();
      return {
        t: Math.round(performance.now()),
        retired: s.retired,
        fade: Math.round(s.overlayFade * 1000) / 1000,
        swap: s.swap,
        scene: s.scene,
      };
    });
    samples.push(d);
    if (d.swap === null && i > 8) break; // fade finished early
    await sleep(40);
  }
  await waitIdle();
  await sleep(800);
  const after = await page.evaluate(() => {
    const d = window.__wp1.debug();
    return { retired: d.retired, fade: d.overlayFade, swap: d.swap, scene: d.scene };
  });

  const outSamples = samples.filter((s) => s.swap === "out");
  const maxRetiredOut = outSamples.reduce((m, s) => Math.max(m, s.retired), 0);
  const keptDuringFade = maxRetiredOut > 0;
  const flushedIdle = after.retired === 0;
  const firstOut = outSamples[0] ?? null;
  console.log(
    `\n[${label}] step ${fromStep} → ${after.scene}  (continue-click=${advanced}, idle-in=${idle0})`,
  );
  console.log(
    `  before: retired=${before.retired} fade=${before.fade} swap=${before.swap}`,
  );
  console.log(
    `  out-stage samples=${outSamples.length} maxRetired=${maxRetiredOut}` +
      (firstOut ? ` first={retired=${firstOut.retired}, fade=${firstOut.fade}}` : ""),
  );
  console.log(
    `  after:  retired=${after.retired} fade=${after.fade} swap=${after.swap}`,
  );
  console.log(
    `  VERDICT: keptDuringFade=${keptDuringFade} flushedIdle=${flushedIdle}` +
      (keptDuringFade && flushedIdle ? "  PASS" : "  <-- FAIL"),
  );
  return { keptDuringFade, flushedIdle };
}

const cases = [
  [7, "gd-d → mom-a: red step arrows (repro 1)"],
  [12, "adam-b → lab: Adam arrows (repro 2)"],
  [17, "fog-c → tilt-a: ghost balls/trails/gold marker (repro 3)"],
  [20, "tilt-b → swarm: ghost ball/trail/stamps (repro 4)"],
  [21, "swarm → labrule: all swarm balls (repro 5)"],
];

let pass = 0;
for (const [step, label] of cases) {
  const r = await probeTransition(step, label);
  if (r.keptDuringFade && r.flushedIdle) pass++;
}

console.log(`\nRESULT ${pass}/${cases.length} transitions kept retired overlays through the fade and flushed them at 0.`);
await browser.close();
process.exit(pass === cases.length ? 0 : 1);
