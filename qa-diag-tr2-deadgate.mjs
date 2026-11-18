/**
 * qa-diag-tr2-deadgate.mjs — diagnose TOUR-TR-2:
 * the §7 tour step 1/7 tiltSteered gate vs a FINISHED tilt run.
 *
 * Repro: ?step=18 → start the s7 tour (gate opens) → click #tilt-finish.
 * Observed (expect): run done=true, counters frozen, gate stays open with
 * no self-release; W presses change nothing; Space/Next swallowed.
 * Recovery (expect): a level pill re-inits a live run; steering releases.
 *
 * Usage: node qa-diag-tr2-deadgate.mjs [baseUrl]  (default :4193, serving dist)
 */
import { chromium } from "playwright";
import { launchGL } from "./tools/gl-launch.mjs";

const base = process.argv[2] ?? "http://localhost:4193";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

const tourState = () => page.evaluate(() => window.__wp1?.tour?.() ?? null);
const tiltState = () => page.evaluate(() => window.__wp1?.tilt?.() ?? null);

async function waitTour(pred, maxMs = 30000, label = "tour state") {
  const t0 = Date.now();
  let s = null;
  while (Date.now() - t0 < maxMs) {
    s = await tourState();
    if (s && pred(s)) return s;
    await sleep(120);
  }
  return s;
}
async function waitIdle(maxMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const ok = await page.evaluate(() => {
      const w = window.__wp1;
      return !w.locked() && !w.animating() && w.scroll().parked;
    });
    if (ok) return true;
    await sleep(150);
  }
  return false;
}

/* 1. boot on §7 page 18 */
await page.goto(`${base}/?step=18`, { waitUntil: "load" });
await sleep(1600);
check("§7 entry unlocks", await waitIdle());

/* 2. start the s7 tour → step 0 gate */
await page.locator('.rstep[data-active="true"] .tour-launch').click();
const s0 = await waitTour((s) => s.phase === "active" && s.stepIndex === 0, 15000, "§7 start");
check(
  "s7 tour opens on the tiltSteered gate (step 1/7)",
  s0?.id === "s7" && s0?.gate === true && s0?.gateKind === "tiltSteered",
  JSON.stringify(s0),
);
const before = await tiltState();
check("run live before Finish", before?.done === false, JSON.stringify({ done: before?.done, cells: before?.cells, steps: before?.steps, pos: before?.pos }));

const hud = () =>
  page.evaluate(() => ({
    chip: document.querySelector("#tour-gate-chip")?.textContent ?? null,
    chipOn: document.querySelector("#tour-gate-chip")?.dataset.on ?? null,
    keysMsg: document.querySelector("#tilt-keys-message")?.innerHTML ?? null,
    finishHidden: document.querySelector("#tilt-finish")?.hidden ?? null,
    restartHidden: document.querySelector("#tilt-restart")?.hidden ?? null,
  }));
console.log("BEFORE FINISH:", JSON.stringify(await hud(), null, 1));

/* 3. press Finish while the gate is open */
await page.locator("#tilt-finish").click();
await sleep(400);
console.log("AFTER FINISH:", JSON.stringify(await hud(), null, 1));
const fin = await tiltState();
check("Finish ends the run", fin?.done === true, JSON.stringify({ done: fin?.done, pos: fin?.pos, cells: fin?.cells, steps: fin?.steps }));

/* 4. observe 12s at 1s cadence, tapping W — does the gate self-release? */
let stuck = true;
const trace = [];
for (let i = 0; i < 12; i++) {
  await page.keyboard.down("w");
  await sleep(150);
  await page.keyboard.up("w");
  await sleep(850);
  const s = await tourState();
  const t = await tiltState();
  trace.push({ i, gate: s?.gate, idx: s?.stepIndex, done: t?.done, cells: t?.cells, steps: t?.steps, pos: t?.pos });
  if (!(s?.gate === true) || s?.stepIndex !== 0) { stuck = false; break; }
}
console.log("TRACE (per-second):", JSON.stringify(trace));
check(
  "DEAD-END CONFIRMED: gate still open on step 0 after 12s + W taps",
  stuck,
  stuck ? "gate never self-released" : "gate released — could NOT reproduce",
);
const frozen = trace[trace.length - 1] ?? {};
check(
  "W steers nothing on a done run (counters + pos frozen at level start)",
  frozen.done === true && frozen.cells === fin?.cells && frozen.steps === fin?.steps &&
    Math.abs((frozen.pos?.x ?? 0) - (fin?.pos?.x ?? 0)) < 1e-9,
  JSON.stringify({ after: frozen, atFinish: fin }),
);

/* 5. Space swallowed by the gate */
const bs = await tourState();
await page.keyboard.press(" ");
await sleep(600);
const as_ = await tourState();
check(
  "Space swallowed while gate open (stepIndex unchanged)",
  bs?.stepIndex === as_?.stepIndex && as_?.gate === true,
  JSON.stringify({ before: bs?.stepIndex, after: as_?.stepIndex, gate: as_?.gate }),
);
await page.screenshot({ path: "qa-diag-tr2-deadgate.png" });

/* 6. undocumented recovery: a level pill re-arms + steering releases */
await page.locator('#tilt-levels button[data-level="rosen"]').click();
await sleep(600);
const rearmed = await tiltState();
check(
  "level pill re-arms a live run (the undocumented way back)",
  rearmed?.done === false && rearmed?.level === "rosen",
  JSON.stringify({ level: rearmed?.level, done: rearmed?.done, cells: rearmed?.cells }),
);
await page.keyboard.down("w");
await sleep(400);
await page.keyboard.up("w");
const rel = await waitTour((s) => s.gate === false && s.stepIndex > 0, 12000, "recovery release");
check("steering the re-armed run releases the gate", (rel?.stepIndex ?? 0) > 0, JSON.stringify(rel));

console.log(failures === 0 ? "ALL CHECKS RAN (see PASS/FAIL lines)" : `FAILURES: ${failures}`);
await browser.close();
process.exit(0);
