/**
 * qa-diag-space-leak-probe.mjs — TOUR-INT-1-SPACE-SLIDER-LEAK probe, POST-FIX
 * state (the leak assertions of the pre-fix repro are inverted per the fix
 * spec: the focused-control Space must now be shielded by the tour's own
 * Space branch — preventDefault+stopPropagation — so the reader NEVER moves
 * and the gate NEVER drops).
 *
 * Claims under test (post-fix):
 *   A. §7 (?step=18): s7 tour gate open (tiltSteered) → click #tilt-friction
 *      (gate stays open) → Space → READER STAYS 18, playlist idx stays 0,
 *      gate STAYS OPEN, run still unsteered (the demanded action provably
 *      did not happen).
 *   B. §8 (?step=22): s8 tour at the final ruleLevelMoved gate (page 23) →
 *      click #rule-eta → Space → reader STAYS 23, tour STILL RUNNING at
 *      idx 4 with the gate open.
 *   C. §2 (?step=4): s2 tour walked to the etaMoved gate on gd-c (post-U4
 *      the chip starts at the playlist head, so the gate is reached by the
 *      real walk: Space → compass draw → Space) → click #eta-slider →
 *      Space → reader STAYS 6, idx STAYS 3, gate STAYS OPEN.
 * Controls: Space with focus NOT on a slider is tour-owned (swallowed at a
 * gate / Next otherwise) — unchanged.
 *
 * Usage: node qa-diag-space-leak-probe.mjs [baseUrl]
 */

import { chromium } from "playwright";
import { launchGL } from "./tools/gl-launch.mjs";
import { mkdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const base = process.argv[2] ?? "http://localhost:4193";
const outDir = resolve("shots");
mkdirSync(outDir, { recursive: true });

const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(file) {
  const path = resolve(outDir, file);
  await page.screenshot({ path });
  return statSync(path).size / 1024;
}

async function waitRest() {
  for (let i = 0; i < 40; i++) {
    const a = await page.evaluate(() => ({
      locked: window.__wp1.locked(),
      animating: window.__wp1.animating(),
    }));
    if (!a.locked && !a.animating) return true;
    await sleep(250);
  }
  return false;
}

/** Full page+tour snapshot for one moment. */
async function snap(label) {
  const s = await page.evaluate(() => {
    const t = window.__wp1.tour();
    const tilt = window.__wp1.tilt();
    const ae = document.activeElement;
    return {
      readerStep: window.__wp1.step(),
      readerCount: document.querySelector("#reader-count")?.textContent,
      tour: {
        running: t.running,
        phase: t.phase,
        id: t.id,
        idx: t.stepIndex,
        count: t.count,
        gate: t.gate,
        gateKind: t.gateKind,
        page: t.page,
      },
      gateChipOn: document.querySelector("#tour-gate-chip")?.dataset.on,
      tiltSteps: tilt ? tilt.steps : null,
      tiltCells: tilt ? tilt.cells : null,
      focus: ae ? (ae.id || ae.tagName) : null,
    };
  });
  console.log(
    `${label} reader=${s.readerStep} tour=${s.tour.id ?? "-"} idx=${s.tour.idx}(${s.tour.count}) phase=${s.tour.phase} gate=${s.tour.gate}(${s.tour.gateKind}) chip=${s.gateChipOn} tiltSteps=${s.tiltSteps} tiltCells=${s.tiltCells} focus=${s.focus}`,
  );
  return s;
}

/** Start a tour from its launch chip and wait until running. */
async function startTour(id, scope = "") {
  await page.click(`${scope} .tour-launch[data-tour="${id}"]`);
  for (let i = 0; i < 40; i++) {
    const t = await page.evaluate(() => window.__wp1.tour());
    if (t.running && t.phase === "active") return t;
    await sleep(250);
  }
  return null;
}

async function waitGateOpen() {
  for (let i = 0; i < 40; i++) {
    const t = await page.evaluate(() => window.__wp1.tour());
    if (t.running && t.gate) return t;
    await sleep(250);
  }
  return null;
}

/* ---------------- Variant A: §7 gate + #tilt-friction + Space ---------- */

console.log("\n=== VARIANT A: §7 tiltSteered gate, damping slider, Space ===");
await page.goto(`${base}/?step=18`, { waitUntil: "load" });
await waitRest();
check("A: booted on tilt-a (step 18)", (await page.evaluate(() => window.__wp1.scene())) === "tilt-a");

const started = await startTour("s7");
check("A: tour started on idx 0", started && started.stepIndex === 0 && started.count === 7, `idx=${started?.stepIndex}/${started?.count}`);
const gate = await waitGateOpen();
check("A: tiltSteered gate open", gate && gate.gate && gate.gateKind === "tiltSteered", `gate=${gate?.gate}`);

// Control: Space with focus NOT on a slider (the tour chip holds focus after
// the click) must be tour-owned — swallowed during the gate.
const a0 = await snap("A0 gate-open:");
await page.keyboard.press("Space");
await sleep(500);
const a1 = await snap("A1 space-no-slider:");
check(
  "A-CONTROL: Space (focus on chip) is swallowed — reader stays 18, gate stays open",
  a1.readerStep === 18 && a1.tour.gate === true && a1.tour.idx === 0,
  `reader=${a1.readerStep} gate=${a1.tour.gate} idx=${a1.tour.idx}`,
);

// Click the damping slider (real mouse click → focus + focusViaPointer=true).
await page.click("#tilt-friction");
await sleep(300);
const a2 = await snap("A2 slider-clicked:");
check("A: gate still open after slider click (plain clicks advance nothing)", a2.tour.gate === true && a2.readerStep === 18, `gate=${a2.tour.gate} reader=${a2.readerStep}`);
check("A: focus is on #tilt-friction", a2.focus === "tilt-friction", `focus=${a2.focus}`);

// THE FIX under test: press Space (focus on the slider).
await page.keyboard.press("Space");
await sleep(700);
const a3 = await snap("A3 after-space:");
check(
  "A-FIXED: Space does NOT advance the reader (stays 18)",
  a3.readerStep === 18,
  `reader ${a0.readerStep}→${a3.readerStep}`,
);
check(
  "A-FIXED: playlist idx unchanged (0 — no sync-jump past the unvisited sentence)",
  a3.tour.idx === 0 && a3.tour.id === "s7",
  `idx ${a0.tour.idx}→${a3.tour.idx} id=${a3.tour.id}`,
);
check("A-FIXED: gate STILL OPEN (the action is the only way through)", a3.tour.gate === true && a3.gateChipOn === "true", `gate=${a3.tour.gate} chip=${a3.gateChipOn}`);
check(
  "A: demanded action still never performed (run unsteered, 0 steps)",
  a3.tiltSteps === 0,
  `tiltSteps=${a3.tiltSteps}`,
);
await shot("qa-diag-space-A-after.png");

/* ---------------- Variant B: §8 final gate + #rule-eta + Space ---------- */

console.log("\n=== VARIANT B: §8 ruleLevelMoved gate, η dial, Space ===");
await page.goto(`${base}/?step=22`, { waitUntil: "load" });
await waitRest();
check("B: booted on labrule (step 22)", (await page.evaluate(() => window.__wp1.scene())) === "labrule");

const b0 = await startTour("s8");
check("B: tour started on idx 0", b0 && b0.stepIndex === 0 && b0.count === 5, `idx=${b0?.stepIndex}/${b0?.count}`);

// Next → idx1 (no gate). Next → idx2 (ruleMoved gate — Next is swallowed).
await page.click("#tour-next");
await sleep(700);
await page.click("#tour-next");
await sleep(700);
const b1 = await snap("B1 at-idx2-gate:");
check("B: parked on the ruleMoved gate (idx 2)", b1.tour.idx === 2 && b1.tour.gate === true && b1.tour.gateKind === "ruleMoved", `idx=${b1.tour.idx} gate=${b1.tour.gate}(${b1.tour.gateKind})`);

// Release it the sanctioned way: move a dial (the η slider value + input).
await page.evaluate(() => {
  const s = document.querySelector("#rule-eta");
  s.value = String(Number(s.value) * 2 + 0.001);
  s.dispatchEvent(new Event("input", { bubbles: true }));
});
await sleep(700);
const b2 = await snap("B2 gate-released:");
check("B: gate released → advanced to idx 3 (page 23)", b2.tour.idx === 3 && !b2.tour.gate, `idx=${b2.tour.idx} gate=${b2.tour.gate}`);
for (let i = 0; i < 40; i++) {
  const t = await page.evaluate(() => window.__wp1.tour());
  if (t.phase === "active") break;
  await sleep(250);
}
// Next → idx4 (ruleLevelMoved gate, 'pick another landscape pill').
await page.click("#tour-next");
await sleep(700);
const b3 = await snap("B3 final-gate:");
check("B: parked on the FINAL ruleLevelMoved gate (idx 4)", b3.tour.idx === 4 && b3.tour.gate === true && b3.tour.gateKind === "ruleLevelMoved", `idx=${b3.tour.idx} gate=${b3.tour.gate}(${b3.tour.gateKind})`);
await page.waitForTimeout(600);
for (let i = 0; i < 40; i++) {
  const t = await page.evaluate(() => window.__wp1.tour());
  if (t.phase === "active" && t.gate) break;
  await sleep(250);
}

// Click #rule-eta (focus, no value change), then Space.
await page.click("#rule-eta");
await sleep(300);
const b4 = await snap("B4 eta-clicked:");
check("B: gate held through the bare dial click", b4.tour.gate === true && b4.readerStep === 23, `gate=${b4.tour.gate} reader=${b4.readerStep}`);
await page.keyboard.press("Space");
await sleep(700);
const b5 = await snap("B5 after-space:");
check(
  "B-FIXED: Space does NOT move the reader (stays 23, not into §9)",
  b5.readerStep === 23,
  `reader ${b4.readerStep}→${b5.readerStep}`,
);
check(
  "B-FIXED: tour STILL RUNNING at the final gate (idx 4, gate open)",
  b5.tour.running === true && b5.tour.id === "s8" && b5.tour.idx === 4 && b5.tour.gate === true,
  `running=${b5.tour.running} id=${b5.tour.id} idx=${b5.tour.idx} gate=${b5.tour.gate}`,
);
await shot("qa-diag-space-B-after.png");

/* ---------------- Variant C: §2 tour walked to the η-slider gate -------- */

console.log("\n=== VARIANT C: §2 tour at the etaMoved gate on gd-c, Space ===");
// #eta-slider lives in the gd-c READER page (index.html:599, page 6) — the
// s2 tour's etaMoved gate (idx 3). POST-U4 the chip always starts at the
// playlist HEAD (page 4), so the gate is reached the real way: Space →
// compass draw (arrowDrawn gate) → Space → the tour pages the reader to
// gd-c and arms the etaMoved gate. Post-fix expectation: click the slider,
// press Space → reader STAYS 6, idx STAYS 3, gate STAYS OPEN.
await page.setViewportSize({ width: 1600, height: 1200 });
try {
  await page.goto(`${base}/?step=4`, { waitUntil: "load" });
  await waitRest();
  check("C: booted on gd-a (step 4, the s2 head)", (await page.evaluate(() => window.__wp1.scene())) === "gd-a");
  const c0 = await startTour("s2", '.rstep[data-scene="gd-a"]');
  check("C: tour started at the head (idx 0)", c0 && c0.stepIndex === 0 && c0.count === 5, `idx=${c0?.stepIndex}/${c0?.count}`);
  await page.keyboard.press("Space"); // → the compass gate on gd-b
  await waitGateOpen();
  // Release it the sanctioned way: draw an arrow on the compass.
  const mm = await page.locator("#minimap-canvas").boundingBox();
  await page.mouse.move(mm.x + mm.width / 2 + 10, mm.y + mm.height / 2 + 40);
  await page.mouse.down();
  await page.mouse.move(mm.x + mm.width / 2 + 62, mm.y + mm.height / 2 + 80, { steps: 8 });
  await page.mouse.up();
  await sleep(1300); // the commit + GD's step play out
  for (let i = 0; i < 40; i++) {
    const t = await page.evaluate(() => window.__wp1.tour());
    if (t.phase === "active" && t.stepIndex === 2 && !t.gate) break;
    await sleep(250);
  }
  await page.keyboard.press("Space"); // → the etaMoved gate on gd-c
  const cg = await waitGateOpen();
  const cGate = await snap("C0 eta-gate:");
  check("C: walked to the etaMoved gate on gd-c (idx 3)", cg && cg.gate && cg.gateKind === "etaMoved" && cGate.readerStep === 6, `gate=${cg?.gate}(${cg?.gateKind}) reader=${cGate.readerStep}`);
  await page.click("#eta-slider");
  await sleep(300);
  const c1 = await snap("C1 slider-clicked:");
  check("C: focus on #eta-slider, gate held", c1.focus === "eta-slider" && c1.tour.gate === true, `focus=${c1.focus} gate=${c1.tour.gate}`);
  await page.keyboard.press("Space");
  await sleep(700);
  const c2 = await snap("C2 after-space:");
  check(
    "C-FIXED: Space does NOT advance the reader (stays 6)",
    c2.readerStep === 6,
    `reader ${c1.readerStep}→${c2.readerStep}`,
  );
  check(
    "C-FIXED: playlist idx unchanged (3), gate STILL OPEN",
    c2.tour.idx === 3 && c2.tour.gate === true,
    `idx ${c1.tour.idx}→${c2.tour.idx} gate=${c2.tour.gate}`,
  );
} catch (err) {
  check("C: probe completed", false, `error: ${String(err).slice(0, 120)}`);
}

await browser.close();
console.log(failures === 0 ? "\nPROBE_OK (leak fixed — all hold checks green)" : `\nPROBE_FAILED (${failures} check(s) FAILED)`);
process.exit(failures === 0 ? 0 : 1);
