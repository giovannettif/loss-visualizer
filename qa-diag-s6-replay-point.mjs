/**
 * qa-diag-s6-replay-point.mjs — diagnose TOUR-POINT-S6-FOOTER-REPLAY-STAGE:
 * the §6 tour's FINAL step (6/6, page 17 fog-c) demands "press Replay in the
 * footer" (gate ghostReplay) but its look target is "ball" — the white ball
 * on the 3D stage, not the footer's #replay-btn the sentence + chip demand.
 *
 * Repro: ?step=15 → start the s6 tour → release the level-1 fogStride gate
 * (premature Finish — sanctioned by the fogRun gate comments in main.ts) →
 * Next → release the level-2 fogRun gate (Finish) → wait out the reveal's
 * ghost race → Next to the final step.
 *
 * Measured (expect): gate chip "try it: press Replay in the footer", overlay
 * dot at ballScreen() on the stage, #replay-btn rect far away (the gap), the
 * sentence's data-slook = "ball".
 *
 * Usage: node qa-diag-s6-replay-point.mjs [baseUrl]  (default :4195, dist)
 */
import { chromium } from "playwright";
import { launchGL } from "./tools/gl-launch.mjs";

const base = process.argv[2] ?? "http://localhost:4195";
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
const fogState = () => page.evaluate(() => window.__wp1?.fog?.() ?? null);

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

/* 1. boot on §6 page 15 (fog-a) */
await page.goto(`${base}/?step=15`, { waitUntil: "load" });
await sleep(1600);
check("§6 entry unlocks", await waitIdle());

/* 2. start the s6 tour → step 0 (needle sentence, no gate) */
await page.locator('.rstep[data-active="true"] .tour-launch').click();
const s0 = await waitTour((s) => s.phase === "active" && s.id === "s6" && s.stepIndex === 0);
check("s6 tour opens (step 1/6)", s0?.id === "s6" && s0?.stepIndex === 0 && s0?.count === 6, JSON.stringify(s0));

/* 3. Next → step 1: the fogStride gate on the compass */
await page.keyboard.press(" ");
const s1 = await waitTour((s) => s.stepIndex === 1 && s.phase === "active");
check("step 2/6 arms the fogStride gate", s1?.gate === true && s1?.gateKind === "fogStride", JSON.stringify({ idx: s1?.stepIndex, gate: s1?.gate, kind: s1?.gateKind }));

/* 4. release via premature Finish (sanctioned: fogDone releases fogStride) */
const fin1Hidden = await page.evaluate(() => document.querySelector("#fog-finish")?.hidden ?? null);
console.log("level-1 #fog-finish hidden:", fin1Hidden);
await page.locator("#fog-finish").click();
const s2 = await waitTour((s) => s.stepIndex === 2 && s.phase === "active");
check("Finish releases level-1 gate → step 3/6 (ball)", s2?.stepIndex === 2 && s2?.gate === false, JSON.stringify({ idx: s2?.stepIndex, gate: s2?.gate }));

/* 5. Next → step 3: the fogRun gate on page 16 (level 2 resets fogDone) */
await page.keyboard.press(" ");
const s3 = await waitTour((s) => s.stepIndex === 3 && s.phase === "active");
await waitIdle();
const fog2 = await fogState();
check("step 4/6 arms the fogRun gate (fresh level-2 run)", s3?.gate === true && s3?.gateKind === "fogRun" && fog2?.done === false, JSON.stringify({ idx: s3?.stepIndex, gate: s3?.gate, kind: s3?.gateKind, fogDone: fog2?.done }));

/* 6. Finish level 2 → release → step 4 travels to the reveal (page 17) */
await page.locator("#fog-finish").click();
const s4 = await waitTour((s) => s.stepIndex === 4 && s.phase === "active", 40000);
check("Finish releases level-2 gate → step 5/6 (gold marker, reveal)", s4?.stepIndex === 4, JSON.stringify({ idx: s4?.stepIndex, gate: s4?.gate }));

/* 7. wait out the reveal's ghost race (~7s) — ghostsPlaying must be FALSE
 * before Next, or the ghostReplay predicate (cur.ghostsPlaying only) would
 * release instantly and never show the chip */
const raced = await waitTour(async () => (await fogState())?.ghostsPlaying === false, 30000, "ghost race over");
await waitIdle();
console.log("ghost race over: ghostsPlaying =", (await fogState())?.ghostsPlaying);

/* 8. Next → step 5 (FINAL): the ghostReplay gate */
await page.keyboard.press(" ");
const s5 = await waitTour((s) => s.stepIndex === 5 && s.phase === "active");
check(
  "FINAL step 6/6 arms the ghostReplay gate",
  s5?.stepIndex === 5 && s5?.count === 6 && s5?.gate === true && s5?.gateKind === "ghostReplay",
  JSON.stringify({ idx: s5?.stepIndex, count: s5?.count, gate: s5?.gate, kind: s5?.gateKind, label: s5?.gateLabel, look: s5?.lookKey, overlay: s5?.overlayOn }),
);

/* 9. MEASURE the pointing overlay vs the demanded control */
const m = await page.evaluate(() => {
  const dot = document.querySelector("#tour-dot");
  const btn = document.querySelector("#replay-btn");
  const sent = document.querySelector('.sent[data-tour-active="true"]');
  const chip = document.querySelector("#tour-gate-chip");
  const r = btn?.getBoundingClientRect();
  const cx = dot ? parseFloat(dot.getAttribute("cx")) : null;
  const cy = dot ? parseFloat(dot.getAttribute("cy")) : null;
  const ball = window.__wp1?.ballScreen?.() ?? null;
  const btnC = r && r.width > 0 ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
  const dist = (a, b) => (a && b ? Math.hypot(a.x - b.x, a.y - b.y) : null);
  return {
    chip: chip?.textContent ?? null,
    chipOn: chip?.dataset.on ?? null,
    overlayOn: document.querySelector("#tour-overlay")?.dataset.on ?? null,
    dot: cx !== null ? { x: cx, y: cy } : null,
    ballScreen: ball,
    dotAtBall: ball && cx !== null ? Math.hypot(cx - ball.x, cy - ball.y) < 2 : null,
    replayBtn: {
      hidden: btn?.hidden ?? null,
      rects: btn ? btn.getClientRects().length : null,
      rect: r ? { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom) } : null,
    },
    sentence: sent ? { slook: sent.dataset.slook ?? null, text: (sent.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 80) } : null,
    gapDotToBtn: dist(cx !== null ? { x: cx, y: cy } : null, btnC),
    gapBallToBtn: dist(ball, btnC),
  };
});
console.log("MEASURED:", JSON.stringify(m, null, 1));
check("gate chip demands the FOOTER Replay", (m.chip ?? "").includes("press Replay in the footer"), m.chip ?? "no chip");
check("overlay dot sits at ballScreen() on the 3D stage", m.dotAtBall === true, `dot=${JSON.stringify(m.dot)} ballScreen=${JSON.stringify(m.ballScreen)}`);
check("#replay-btn is VISIBLE at the final step", m.replayBtn.hidden === false && m.replayBtn.rects > 0, JSON.stringify(m.replayBtn));
check(
  "MISMATCH CONFIRMED: dot is ~750px from the demanded #replay-btn",
  m.gapDotToBtn !== null && m.gapDotToBtn > 600,
  `gap(dot→#replay-btn)=${m.gapDotToBtn?.toFixed(1)}px gap(ball→btn)=${m.gapBallToBtn?.toFixed(1)}px`,
);
check("sentence registry carries look 'ball' (the stale target)", m.sentence?.slook === "ball", JSON.stringify(m.sentence));

await page.screenshot({ path: "qa-diag-s6-replay-point.png" });
console.log(failures === 0 ? "ALL CHECKS RAN (see PASS/FAIL lines)" : `FAILURES: ${failures}`);
await browser.close();
process.exit(0);
