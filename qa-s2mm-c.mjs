/**
 * qa-s2mm-c.mjs (v2) — QA probe C (scope: Back works during interaction
 * gates EVERYWHERE). All 14 gate instances across s1–s8 (s9 has no gates),
 * with per-class expectations derived from TOURS + the FIX-3/FIX-4 design:
 *
 *   HEAD (gate is the playlist's step 0 — syncBar marks Back data-disabled,
 *   backNow's idx<=0 guard is the designed no-op):
 *      open → chip advertises escape → Back-click NO-OP (gate STAYS armed,
 *      nothing to reverse to) → Next skips (i:1) → ArrowUp reverses to 0 AND
 *      re-arms → Esc exits clean.
 *   MID: open → Back-click reverses + disarms → Next re-arms → ArrowUp
 *      reverses → Next re-arms → Next POLITELY SKIPS (disarm + advance) →
 *      ArrowUp with the controller FOCUSED still reverses → Esc exits.
 *   LAST (gate is the final step — Next relabels "Finish ▶" and COMPLETES):
 *      open → Back-click reverses + disarms → Next re-arms → ArrowUp
 *      reverses → Next re-arms → #tour-min click (controller focus,
 *      minimized) → ArrowUp STILL reverses (FIX-4c) → chip restores →
 *      Next re-arms → Next COMPLETES the tour (gate off → closing → idle).
 *
 * Usage: node qa-s2mm-c.mjs http://localhost:4181 > qa-s2mm-c.log 2>&1
 * Evidence: qa/qa-s2mm-shots/
 */

import { chromium } from "playwright";
import { launchGL } from "./tools/gl-launch.mjs";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const base = process.argv[2] ?? "http://localhost:4181";
const outDir = resolve("qa/qa-s2mm-shots");
mkdirSync(outDir, { recursive: true });

const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

let failures = 0;
let n = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  n++;
  if (!ok) failures += 1;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const T = () => page.evaluate(() => window.__wp1?.tour?.() ?? null);
const STEP = () => page.evaluate(() => window.__wp1?.step?.() ?? -1);

async function waitIdle(maxMs = 30000) {
  const t0 = Date.now();
  for (;;) {
    const a = await page.evaluate(() => ({
      locked: window.__wp1?.locked?.() ?? true,
      animating: window.__wp1?.animating?.() ?? true,
    }));
    if (!a.locked && !a.animating) return true;
    if (Date.now() - t0 > maxMs) return false;
    await sleep(200);
  }
}
async function waitTour(pred, maxMs = 25000) {
  const t0 = Date.now();
  let s = null;
  for (;;) {
    s = await T();
    if (s && pred(s)) return s;
    if (Date.now() - t0 > maxMs) return s;
    await sleep(180);
  }
}
async function clickBtn(sel) {
  const b = await page.locator(sel).boundingBox();
  if (!b) throw new Error(`${sel} not visible`);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}

/* Corrected gate table (verified against TOURS in src/view/tourEngine.ts). */
const GATES = [
  { tour: "s1", kind: "fitMoved", label: "drag the line in the inset", page: 1, seed: 0, gateIdx: 0, count: 4, cls: "HEAD" },
  { tour: "s1", kind: "fitMoved", label: "drag the white point", page: 3, seed: 3, gateIdx: 3, count: 4, cls: "LAST" },
  { tour: "s2", kind: "arrowDrawn", label: "drag an arrow on the compass", page: 5, seed: 1, gateIdx: 1, count: 5, cls: "MID" },
  { tour: "s2", kind: "etaMoved", label: "slide the learning rate η", page: 6, seed: 3, gateIdx: 3, count: 5, cls: "MID" },
  { tour: "s3", kind: "betaMoved", label: "slide the momentum β", page: 8, seed: 0, gateIdx: 2, count: 5, cls: "MID" },
  { tour: "s4", kind: "steepMoved", label: "slide the steepness λ₁", page: 12, seed: 2, gateIdx: 2, count: 3, cls: "LAST" },
  { tour: "s5", kind: "labMoved", label: "reshape the valley with the sliders", page: 13, seed: 0, gateIdx: 0, count: 4, cls: "HEAD" },
  { tour: "s6", kind: "fogStride", label: "drag a stride on the compass", page: 15, seed: 0, gateIdx: 1, count: 6, cls: "MID" },
  { tour: "s6", kind: "fogRun", label: "take a stride here, then press Finish run", page: 16, seed: 3, gateIdx: 3, count: 6, cls: "MID" },
  { tour: "s6", kind: "ghostReplay", label: "press Replay in the footer", page: 17, seed: 4, gateIdx: 5, count: 6, cls: "LAST" },
  { tour: "s7", kind: "tiltSteered", label: "steer with W A S D (or ← →)", page: 18, seed: 0, gateIdx: 0, count: 7, cls: "HEAD" },
  { tour: "s7", kind: "blindToggled", label: "tick run blind / show map on the dock (bottom-left)", page: 21, seed: 4, gateIdx: 6, count: 7, cls: "LAST" },
  { tour: "s8", kind: "ruleMoved", label: "move a dial (η, β, clip, normalize)", page: 22, seed: 0, gateIdx: 2, count: 5, cls: "MID" },
  { tour: "s8", kind: "ruleLevelMoved", label: "pick another landscape pill", page: 23, seed: 3, gateIdx: 4, count: 5, cls: "LAST" },
];

let gi = 0;
for (const g of GATES) {
  gi++;
  const tag = `C${gi} ${g.tour}/${g.kind}[${g.cls}] @?step=${g.page}`;
  await page.goto(`${base}/?step=${g.page}`, { waitUntil: "load" });
  await sleep(1700);
  await waitIdle();

  const chip = await page.locator("#tour-entry").boundingBox();
  await page.mouse.click(chip.x + chip.width / 2, chip.y + chip.height / 2);
  let st = await waitTour((s) => s.running && s.stepIndex === g.seed);
  check(`${tag}: tour seeded at ${g.seed}`, st?.running === true && st?.stepIndex === g.seed, JSON.stringify(st && { i: st.stepIndex, ph: st.phase }));

  // Walk forward to the gate where it is not the seeded step.
  let cur = g.seed;
  while (cur < g.gateIdx) {
    await clickBtn("#tour-next");
    await sleep(400);
    st = await waitTour((s) => s.phase === "active" && s.stepIndex === cur + 1, 25000);
    if (!st || st.stepIndex !== cur + 1) break;
    cur++;
  }
  st = await waitTour((s) => s.gate === true, 25000);
  check(
    `${tag}: gate OPEN (${g.label})`,
    st?.gate === true && st?.gateKind === g.kind && st?.stepIndex === g.gateIdx,
    JSON.stringify(st && { i: st.stepIndex, gate: st.gate, kind: st.gateKind }),
  );
  await sleep(500);
  await page.screenshot({ path: resolve(outDir, `c${gi}-gate-open.png`) });

  const gateText = await page.evaluate(() => document.querySelector("#tour-gate-chip")?.textContent ?? "");
  check(`${tag}: gate chip advertises 'Back goes back'`, /Back goes back/.test(gateText), JSON.stringify(gateText));

  if (g.cls === "HEAD") {
    // Back is a designed no-op at the playlist head (idx<=0 guard; the
    // button is marked data-disabled). The gate must STAY armed, no trap.
    await clickBtn("#tour-back");
    await sleep(1200);
    st = await T();
    const backDisabled = await page.evaluate(() => document.querySelector("#tour-back")?.dataset.disabled);
    check(
      `${tag}: Back at the head is a NO-OP, gate stays armed, button marked disabled`,
      st?.stepIndex === 0 && st?.gate === true && st?.running === true && backDisabled === "true",
      JSON.stringify({ st: st && { i: st.stepIndex, gate: st.gate }, backDisabled }),
    );
    await clickBtn("#tour-next"); // skip
    st = await waitTour((s) => s.phase === "active" && s.stepIndex === 1 && s.gate === false, 25000);
    check(`${tag}: Next SKIPS the head gate`, st?.stepIndex === 1 && st?.gate === false, JSON.stringify(st && { i: st.stepIndex, gate: st.gate }));
    await page.keyboard.press("ArrowUp"); // reverse back INTO the gate → re-arms
    st = await waitTour((s) => s.phase === "active" && s.stepIndex === 0 && s.gate === true, 25000);
    check(
      `${tag}: ArrowUp reverses into the head gate and it RE-ARMS`,
      st?.stepIndex === 0 && st?.gate === true,
      JSON.stringify(st && { i: st.stepIndex, gate: st.gate }),
    );
  } else {
    // LAST + MID share the reversal matrix; MID's final Next skips, LAST's
    // completes the tour.
    await clickBtn("#tour-back");
    st = await waitTour((s) => s.phase === "active" && s.stepIndex === g.gateIdx - 1, 25000);
    const stepAfterBack1 = await STEP();
    check(
      `${tag}: Back during gate REVERSES (→ ${g.gateIdx - 1}) + disarms, tour alive`,
      st?.running === true && st?.stepIndex === g.gateIdx - 1 && st?.gate === false && st?.sentenceActive === true,
      JSON.stringify(st && { i: st.stepIndex, gate: st.gate, run: st.running }),
    );
    check(
      `${tag}: reader traveled with the reversal`,
      stepAfterBack1 === st?.page,
      JSON.stringify({ readerStep: stepAfterBack1, tourPage: st?.page }),
    );

    await clickBtn("#tour-next");
    st = await waitTour((s) => s.phase === "active" && s.stepIndex === g.gateIdx && s.gate === true, 25000);
    check(`${tag}: Next re-enters the gate RE-ARMED`, st?.stepIndex === g.gateIdx && st?.gate === true, JSON.stringify(st && { i: st.stepIndex, gate: st.gate }));

    await page.keyboard.press("ArrowUp");
    st = await waitTour((s) => s.phase === "active" && s.stepIndex === g.gateIdx - 1, 25000);
    check(`${tag}: ArrowUp during gate REVERSES`, st?.running === true && st?.stepIndex === g.gateIdx - 1 && st?.gate === false, JSON.stringify(st && { i: st.stepIndex, gate: st.gate }));

    await clickBtn("#tour-next");
    st = await waitTour((s) => s.phase === "active" && s.stepIndex === g.gateIdx && s.gate === true, 25000);
    check(`${tag}: re-armed again`, st?.stepIndex === g.gateIdx && st?.gate === true, JSON.stringify(st && { i: st.stepIndex, gate: st.gate }));

    if (g.cls === "MID") {
      await clickBtn("#tour-next"); // polite skip
      st = await waitTour((s) => s.phase === "active" && s.stepIndex === g.gateIdx + 1 && s.gate === false, 25000);
      check(`${tag}: Next POLITELY SKIPS (disarm + advance)`, st?.stepIndex === g.gateIdx + 1 && st?.gate === false, JSON.stringify(st && { i: st.stepIndex, gate: st.gate }));
      await page.keyboard.press("ArrowUp"); // focus is on #tour-next (FIX-4c)
      st = await waitTour((s) => s.phase === "active" && s.stepIndex === g.gateIdx, 25000);
      check(`${tag}: ArrowUp with the CONTROLLER FOCUSED still reverses`, st?.stepIndex === g.gateIdx, JSON.stringify(st && { i: st.stepIndex }));
    } else {
      // LAST: FIX-4c via the minimize button (harmless focus target while
      // the gate stays armed), then restore, then Next COMPLETES.
      await clickBtn("#tour-min");
      await sleep(500);
      st = await T();
      check(`${tag}: minimized with the gate armed`, st?.minimized === true && st?.gate === true, JSON.stringify(st && { min: st.minimized, gate: st.gate }));
      await page.keyboard.press("ArrowUp");
      st = await waitTour((s) => s.phase === "active" && s.stepIndex === g.gateIdx - 1, 25000);
      check(`${tag}: ArrowUp (controller focused, minimized) still reverses`, st?.stepIndex === g.gateIdx - 1, JSON.stringify(st && { i: st.stepIndex }));
      await clickBtn("#tour-bar-chip"); // restore the bar
      await sleep(400);
      await clickBtn("#tour-next");
      st = await waitTour((s) => s.phase === "active" && s.stepIndex === g.gateIdx && s.gate === true, 25000);
      check(`${tag}: restored + re-armed`, st?.stepIndex === g.gateIdx && st?.gate === true, JSON.stringify(st && { i: st.stepIndex, gate: st.gate }));
      await clickBtn("#tour-next"); // "Finish ▶" → complete
      st = await waitTour((s) => s.running === false && s.phase === "idle", 25000);
      check(
        `${tag}: Next COMPLETES the tour cleanly (gate off → closing → idle)`,
        st?.running === false && st?.phase === "idle" && st?.gate === false,
        JSON.stringify(st && { run: st.running, ph: st.phase }),
      );
    }
  }

  if (g.cls !== "LAST") {
    await page.keyboard.press("Escape");
    await sleep(700);
  }
  st = await T();
  const stepFinal = await STEP();
  check(
    `${tag}: exits clean (idle), reader intact`,
    st?.running === false && st?.phase === "idle" && typeof stepFinal === "number" && stepFinal >= 0,
    JSON.stringify({ run: st?.running, ph: st?.phase, step: stepFinal }),
  );
}

await browser.close();
console.log(`\nQA-S2MM-C ${failures === 0 ? "ALL_PASS" : "FAILED"} (${n} checks, ${failures} failures)`);
process.exit(failures === 0 ? 0 : 1);
