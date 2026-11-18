/**
 * qa-diag-tourtr1-repro.mjs — TOUR-TR-1 repro: §6 tour step 2/6, page-15
 * fogStride gate + PREMATURE "Finish run · reveal".
 *
 * Mirrors tools/gate-tour.mjs 5b flow-2, but the Finish is pressed on the
 * LEVEL-1 stride gate (stepIndex 1, page 15) instead of the level-2 fogRun
 * gate (stepIndex 3, page 16). The claim: after a premature Finish the
 * fogStride gate can never release — the run-over compass is read-only
 * (director fogCommitStep refuses st.done) so fogUsed is frozen, and
 * main.ts's fogStride release term (`cur.fogUsed > snap.fogUsed`) is
 * unsatisfiable. Next/Space are swallowed; the only exits abandon the step.
 *
 * Usage: node qa-diag-tourtr1-repro.mjs [baseUrl]
 */

import { chromium } from "playwright";
import { launchGL } from "./tools/gl-launch.mjs";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const base = process.argv[2] ?? "http://localhost:4193";
mkdirSync(resolve("qa/tour-transitions"), { recursive: true });

const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tourState = () => page.evaluate(() => window.__wp1?.tour?.() ?? null);
const fogState = () => page.evaluate(() => window.__wp1?.fog?.() ?? null);

async function waitIdle(maxMs = 25000) {
  const t0 = Date.now();
  for (;;) {
    const a = await page.evaluate(() => ({
      locked: window.__wp1?.locked?.(),
      animating: window.__wp1?.animating?.(),
    }));
    if (!a.locked && !a.animating) return true;
    if (Date.now() - t0 > maxMs) return false;
    await sleep(200);
  }
}
async function waitTour(pred, maxMs, label) {
  const t0 = Date.now();
  let s = null;
  for (;;) {
    s = await tourState();
    if (s && pred(s)) return s;
    if (Date.now() - t0 > maxMs) {
      console.log(`(timeout waiting for ${label}: ${JSON.stringify(s)})`);
      return s;
    }
    await sleep(120);
  }
}
async function dragMinimap(dx0, dy0, dx1, dy1) {
  const box = await page.locator("#minimap-canvas").boundingBox();
  if (!box) throw new Error("minimap canvas missing");
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx + dx0, cy + dy0);
  await page.mouse.down();
  await page.mouse.move(cx + dx1, cy + dy1, { steps: 8 });
  await page.mouse.up();
}

const out = {};
try {
  await page.goto(`${base}/?step=15`, { waitUntil: "load" });
  await sleep(1500);
  out.entryUnlocked = await waitIdle();

  await page.locator('.rstep[data-active="true"] .tour-launch').click();
  out.tourStart = await waitTour((s) => s.running && s.phase === "active", 12000, "tour start");

  await page.keyboard.press("Space"); // → the level-1 fogStride gate (stepIndex 1)
  out.gateArmed = await waitTour(
    (s) => s.phase === "active" && s.gateKind === "fogStride",
    12000,
    "fogStride gate",
  );
  out.fogBefore = await fogState(); // fresh level: used 0, done false

  // PREMATURE FINISH — zero strides spent.
  await page.click("#fog-finish");
  await sleep(1200);
  out.fogAfterFinish = await fogState();
  out.tourAfterFinish = await tourState();
  out.uiAfterFinish = await page.evaluate(() => ({
    finishHidden: document.querySelector("#fog-finish")?.hidden ?? null,
    caption: document.querySelector("#fog-caption")?.textContent ?? null,
    gateChipOn: document.querySelector("#tour-gate-chip")?.dataset.on ?? null,
    gateChipText: document.querySelector("#tour-gate-chip")?.textContent ?? null,
    controllerCount: document.querySelector("#tour-count")?.textContent ?? null,
  }));

  // Two REAL compass drags — the action the gate demands.
  await dragMinimap(10, 40, 62, 80);
  await sleep(900);
  out.fogAfterDrag1 = await fogState();
  out.tourAfterDrag1 = await tourState();
  await dragMinimap(10, 40, -30, 20);
  await sleep(900);
  out.fogAfterDrag2 = await fogState();
  out.tourAfterDrag2 = await tourState();

  // Space during the gate — must be swallowed.
  await page.keyboard.press("Space");
  await sleep(700);
  out.tourAfterSpace = await tourState();

  await page.screenshot({ path: "qa/tour-transitions/tourtr1-dead-gate.png" });

  // Esc — the only on-page exit.
  await page.keyboard.press("Escape");
  out.tourAfterEsc = await waitTour((s) => !s.running, 5000, "esc exit");
} catch (e) {
  out.error = String(e);
}

// VERDICTS
const v = [];
const ok = (name, cond, detail) =>
  v.push(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
const f = (x) => JSON.stringify(x);

ok("entry unlocks", out.entryUnlocked === true);
ok(
  "§6 tour starts at 1/6 (needle sentence)",
  out.tourStart?.id === "s6" && out.tourStart?.stepIndex === 0 && out.tourStart?.count === 6,
  f(out.tourStart),
);
ok(
  "fogStride gate armed at 2/6",
  out.gateArmed?.stepIndex === 1 && out.gateArmed?.gate === true && out.gateArmed?.gateKind === "fogStride",
  f(out.gateArmed),
);
ok(
  "fresh level before finish (used 0, done false)",
  out.fogBefore?.used === 0 && out.fogBefore?.done === false,
  f(out.fogBefore),
);
ok(
  "premature Finish ends the run (done true, used still 0)",
  out.fogAfterFinish?.done === true && out.fogAfterFinish?.used === 0,
  f(out.fogAfterFinish),
);
ok(
  "GATE STAYS OPEN after premature Finish (the bug)",
  out.tourAfterFinish?.stepIndex === 1 && out.tourAfterFinish?.gate === true,
  f(out.tourAfterFinish),
);
ok(
  "Finish button hides (no on-page recovery control)",
  out.uiAfterFinish?.finishHidden === true,
  `hidden=${f(out.uiAfterFinish?.finishHidden)}`,
);
ok(
  "panel caption reads the read-only fact",
  out.uiAfterFinish?.caption === "run finished · compass is read-only",
  f(out.uiAfterFinish?.caption),
);
ok(
  "gate chip still instructs the impossible stride",
  out.uiAfterFinish?.gateChipOn === "true" &&
    (out.uiAfterFinish?.gateChipText ?? "").includes("drag a stride on the compass"),
  `${f(out.uiAfterFinish?.gateChipOn)} ${f(out.uiAfterFinish?.gateChipText)}`,
);
ok(
  "controller frozen at 2/6",
  out.uiAfterFinish?.controllerCount === "2 / 6",
  f(out.uiAfterFinish?.controllerCount),
);
ok(
  "real drag 1 spends nothing (fogUsed frozen at 0)",
  out.fogAfterDrag1?.used === 0 && out.fogAfterDrag1?.done === true,
  f(out.fogAfterDrag1),
);
ok(
  "drag 1 does not release the gate",
  out.tourAfterDrag1?.stepIndex === 1 && out.tourAfterDrag1?.gate === true,
  f(out.tourAfterDrag1),
);
ok(
  "real drag 2 spends nothing either",
  out.fogAfterDrag2?.used === 0,
  f(out.fogAfterDrag2),
);
ok(
  "drag 2 does not release the gate",
  out.tourAfterDrag2?.stepIndex === 1 && out.tourAfterDrag2?.gate === true,
  f(out.tourAfterDrag2),
);
ok(
  "Space swallowed during the dead gate",
  out.tourAfterSpace?.stepIndex === 1 && out.tourAfterSpace?.gate === true,
  f(out.tourAfterSpace),
);
ok("Esc is the only exit (works)", out.tourAfterEsc?.running === false, f(out.tourAfterEsc));

console.log(v.join("\n"));
console.log("---RAW---");
console.log(f(out));
await browser.close();
process.exit(v.some((l) => l.startsWith("FAIL")) ? 1 : 0);
