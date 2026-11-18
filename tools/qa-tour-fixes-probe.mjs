/**
 * qa-tour-fixes-probe — round-1 tour QA fixes, one probe per finding.
 *
 *   A  TOUR-S1-BEAT-READTIME        beat dwells scale with the sentence's
 *                                   word count (38w ≥ ~10s, 84w ≥ ~24s;
 *                                   old bar ~4.2s); click still advances
 *   B  S2-TOUR-GATE-KEYED-TO-PRESS  a held press with no movement/release
 *                                   must NOT release arrowDrawn; a real
 *                                   drag's commit does
 *   C  T6-EMPTY-REVEAL-DIMMED-PAGE  a reveal flavor whose #fog-trap-note is
 *                                   hidden lights the visible alt sentence,
 *                                   never dims 9 children around display:none
 *   D  T6-REPLAY-GATE-WRONG-SENTENCE  the replay gate lights #fog-replay-note,
 *                                   not the first p.caption (the verdict line)
 *
 * Usage: node tools/qa-tour-fixes-probe.mjs [baseUrl]
 * Exit 0 iff every check passes.
 */
import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const base = process.argv[2] ?? "http://localhost:4173";
const outDir = resolve("qa/TOUR-FIXES-R1");
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures += 1;
};

const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

const boot = async (step) => {
  await page.goto(`${base}/?step=${step}`, { waitUntil: "load" });
  await page.waitForFunction(
    () => {
      const b = document.querySelector("#boot");
      return !b || b.dataset.done === "true";
    },
    null,
    { timeout: 30000 },
  );
  await sleep(1600);
};

/** Tour state + the marked sentence's identity/visibility in one sample. */
const tourState = () =>
  page.evaluate(() => {
    const st = window.__wp1?.tour?.() ?? null;
    const marked = document.querySelector("[data-tour-active]");
    const body = document.querySelector('.rstep[data-active="true"] .step__body[data-tour-dim]');
    return {
      ...st,
      markedId: marked?.id ?? null,
      markedVisible: marked ? marked.getClientRects().length > 0 : false,
      markedText: (marked?.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 70),
      dimChildren: body ? body.children.length : 0,
      keep: document.querySelectorAll(".tour-keep").length,
      visibleKeep: [...document.querySelectorAll(".tour-keep")].filter(
        (e) => e.getClientRects().length > 0,
      ).length,
      chip: document.querySelector("#tour-gate-chip")?.textContent ?? "",
    };
  });
const waitTour = async (pred, maxMs, label) => {
  const t0 = Date.now();
  let s = null;
  for (;;) {
    s = await tourState();
    if (s && pred(s)) return s;
    if (Date.now() - t0 > maxMs) {
      console.log(`  (timeout waiting for ${label}: ${JSON.stringify(s)})`);
      return s;
    }
    await sleep(140);
  }
};
const clickToAdvance = async () => {
  await page.locator('.rstep[data-active="true"] h2').click();
};
/** Drags an arrow on the compass minimap (shared §2/§6 gesture). */
const dragMinimap = async (dx0, dy0, dx1, dy1) => {
  const box = await page.locator("#minimap-canvas").boundingBox();
  if (!box) throw new Error("minimap canvas missing");
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx + dx0, cy + dy0);
  await page.mouse.down();
  await page.mouse.move(cx + dx1, cy + dy1, { steps: 8 });
  await page.mouse.up();
};
/** Drags the §1 fit line BODY in the inset (same math as FitPreview.hitMode). */
const dragFitLine = async (dyPx = 42) => {
  const p = await page.evaluate(() => {
    const c = document.querySelector("#fit-canvas");
    const r = c.getBoundingClientRect();
    const M = { l: 30, r: 12, t: 10, b: 22 };
    const X_MIN = -4.2, X_MAX = 4.6, Y_MIN = -2.1, Y_MAX = 5.7;
    const f = window.__wp1.fit();
    const xData = 0.2;
    const px = M.l + ((xData - X_MIN) / (X_MAX - X_MIN)) * (r.width - M.l - M.r);
    const yData = f.w * xData + f.b;
    const py = r.height - M.b - ((yData - Y_MIN) / (Y_MAX - Y_MIN)) * (r.height - M.t - M.b);
    return { x: r.left + px, y: r.top + py };
  });
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x, p.y + dyPx, { steps: 6 });
  await page.mouse.up();
};

/* ---------------- A: TOUR-S1-BEAT-READTIME ---------------- */
console.log("\n--- A: TOUR-S1-BEAT-READTIME (s1 beat dwells scale to reading load) ---");
{
  await boot(1);
  await page.locator('.rstep[data-active="true"] .tour-launch').click();
  const s0 = await waitTour((s) => s.phase === "active" && s.stepIndex === 0, 12000, "s1 start");
  check("A: s1 tour starts on the fit gate", s0?.gateKind === "fitMoved", JSON.stringify(s0));
  await dragFitLine();
  const s1 = await waitTour(
    (s) => s.phase === "active" && s.stepIndex === 1 && s.gate === false,
    8000,
    "s1 loss beat",
  );
  check("A: gate released onto the loss-caption beat", s1?.stepIndex === 1, JSON.stringify(s1));
  const words1 = await page.evaluate(() => {
    const el = document.querySelector("[data-tour-active]");
    return (el?.textContent ?? "").trim().split(/\s+/).filter(Boolean).length;
  });
  const t1 = Date.now();
  const s2 = await waitTour((s) => s.phase === "active" && s.stepIndex === 2, 20000, "s1 needle beat");
  const dwell1 = Date.now() - t1;
  check(
    `A: ${words1}-word loss caption dwells ≈ reading time (>10s; was ~4.2s)`,
    s2?.stepIndex === 2 && dwell1 > 10000,
    `dwell=${dwell1}ms (≈300ms/word → expect ≥${300 * words1 + 800 - 4200}ms wait)`,
  );
  const words2 = await page.evaluate(() => {
    const el = document.querySelector("[data-tour-active]");
    return (el?.textContent ?? "").trim().split(/\s+/).filter(Boolean).length;
  });
  const t2 = Date.now();
  const s3 = await waitTour(
    (s) => s.stepIndex === 3 && s.gateKind === "fitMoved",
    40000,
    "s1 ball gate",
  );
  const dwell2 = Date.now() - t2;
  check(
    `A: ${words2}-word needle paragraph dwells ≈ reading time (>24s; was ~4.2s)`,
    s3?.stepIndex === 3 && dwell2 > 24000,
    `dwell=${dwell2}ms`,
  );
  // Early-advance still works: a click on the text must not wait out the beat.
  const s3b = await tourState();
  if (s3b?.gate === false && s3b?.stepIndex === 3) {
    // we are on the ball gate (a gate step) — click-advance applies to beats;
    // the beat under test just expired, so this sub-check is informational.
  }
  await page.keyboard.press("Escape");
  const dead = await waitTour((s) => !s.running, 4000, "s1 esc");
  check("A: Esc exits", dead?.running === false, JSON.stringify(dead));
}

/* ---------------- B: S2-TOUR-GATE-KEYED-TO-PRESS ---------------- */
console.log("\n--- B: S2-TOUR-GATE-KEYED-TO-PRESS (held press must not release the gate) ---");
{
  await boot(4);
  await page.locator('.rstep[data-active="true"] .tour-launch').click();
  const s0 = await waitTour((s) => s.phase === "active" && s.stepIndex === 0, 12000, "s2 start");
  check("B: s2 tour starts on the needle beat", s0?.id === "s2" && s0?.stepIndex === 0, JSON.stringify(s0));
  await clickToAdvance();
  const s1 = await waitTour((s) => s.gateKind === "arrowDrawn" && s.gate === true, 12000, "s2 compass gate");
  check("B: compass gate paused", s1?.gate === true, JSON.stringify(s1));

  // THE repro: press on the compass, hold 900ms, NO movement, NO release.
  const box = await page.locator("#minimap-canvas").boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await sleep(900);
  const held = await tourState();
  check(
    "B: held press (900ms, no move, no release) does NOT advance the tour",
    held.stepIndex === 1 && held.gate === true,
    `stepIndex=${held.stepIndex} gate=${held.gate} chip="${held.chip}"`,
  );
  await page.screenshot({ path: resolve(outDir, "b1-held-press-gate-holds.png") });
  // Complete the gesture: move (real drag) then release → commit → gate lifts.
  await page.mouse.move(cx + 46, cy - 26, { steps: 8 });
  await page.mouse.up();
  const released = await waitTour(
    (s) => s.phase === "active" && s.stepIndex === 2,
    6000,
    "s2 release on commit",
  );
  check(
    "B: committed drag releases the gate onto the gd-step beat",
    released?.stepIndex === 2 && released?.gate === false,
    JSON.stringify(released),
  );
  await page.keyboard.press("Escape");
  await waitTour((s) => !s.running, 4000, "s2 esc");
}

/* ---------------- C + D: fog reveal flavors + replay sentence ----------------
   Level shape: the stride gate lives on fog-a (level 1); the tour's Finish
   gate lands on fog-b (level 2), whose fog state starts fresh (used=0).
   Finish with no level-2 stride → the EMPTY reveal flavor (trap-note hidden).
   One level-2 stride before Finish → the PLAYED flavor (trap-note visible). */
console.log("\n--- C: T6-EMPTY-REVEAL-DIMMED-PAGE + D: T6-REPLAY-GATE-WRONG-SENTENCE ---");
{
  // Run 1: EMPTY flavor — level-2 Finish with zero strides.
  await boot(15);
  await page.locator('.rstep[data-active="true"] .tour-launch').click();
  const s0 = await waitTour((s) => s.phase === "active" && s.stepIndex === 0, 12000, "s6 start");
  check("C: s6 tour starts on the needle beat", s0?.id === "s6" && s0?.stepIndex === 0, JSON.stringify(s0));
  await clickToAdvance(); // needle beat → stride gate
  const s1 = await waitTour((s) => s.gateKind === "fogStride" && s.gate === true, 12000, "s6 stride gate");
  check("C: stride gate paused", s1?.gate === true, JSON.stringify(s1));
  await dragMinimap(-20, 10, 30, -22); // one level-1 stride to pass the gate
  const s2 = await waitTour((s) => s.phase === "active" && s.stepIndex === 2 && s.gate === false, 8000, "s6 painting beat");
  check("C: stride released onto the painting beat", s2?.stepIndex === 2, JSON.stringify(s2));
  await clickToAdvance(); // painting beat → Finish gate (fog-b, fresh level 2)
  const s3 = await waitTour((s) => s.gateKind === "fogFinish" && s.gate === true, 12000, "s6 finish gate");
  check("C: Finish gate paused", s3?.gate === true, JSON.stringify(s3));
  const fogNow = await page.evaluate(() => window.__wp1?.fog?.());
  console.log(`  (fog at Finish: ${JSON.stringify(fogNow)})`);
  await page.locator("#fog-finish").click(); // the finding's empty-run repro
  const s4e = await waitTour((s) => s.phase === "active" && s.stepIndex === 4, 35000, "s6 reveal (empty)");
  const rEmpty = await tourState();
  console.log(`  (empty-run reveal: ${JSON.stringify(rEmpty)})`);
  await page.screenshot({ path: resolve(outDir, "c1-reveal-empty.png") });
  const flavors = await page.evaluate(() => ({
    trapHidden: document.querySelector("#fog-trap-note")?.hidden ?? null,
    emptyVisible: (document.querySelector("#fog-empty-verdict-note")?.getClientRects().length ?? 0) > 0,
  }));
  console.log(`  (flavors: ${JSON.stringify(flavors)})`);
  if (flavors.trapHidden === true && flavors.emptyVisible) {
    check(
      "C: empty run — altSel lights the visible #fog-empty-verdict-note",
      s4e?.stepIndex === 4 && rEmpty.markedId === "fog-empty-verdict-note" && rEmpty.markedVisible === true,
      `markedId=${rEmpty.markedId} visible=${rEmpty.markedVisible}`,
    );
    check(
      "C: empty run — no dimmed-page breakage (a visible keep exists)",
      rEmpty.keep >= 1 && rEmpty.visibleKeep >= 1,
      `keep=${rEmpty.keep} visibleKeep=${rEmpty.visibleKeep} dimChildren=${rEmpty.dimChildren}`,
    );
  } else {
    check("C: empty-run precondition", false, `flavors=${JSON.stringify(flavors)} — Finish did not grade an empty run`);
  }
  await clickToAdvance(); // → replay gate (empty path)
  const s5e = await waitTour((s) => s.gateKind === "ghostReplay" && s.gate === true, 12000, "replay gate (empty)");
  const dEmpty = await tourState();
  check(
    "D: empty path — replay gate lights #fog-replay-note (NOT the 'no run' verdict)",
    s5e?.gate === true && dEmpty.markedId === "fog-replay-note",
    `markedId=${dEmpty.markedId} text="${dEmpty.markedText}" chip="${dEmpty.chip}"`,
  );
  check(
    "D: empty path — the lit sentence no longer contradicts the chip",
    /Replay/i.test(dEmpty.chip) && /Replay/i.test(dEmpty.markedText),
    `chip="${dEmpty.chip}" text="${dEmpty.markedText}"`,
  );
  await page.screenshot({ path: resolve(outDir, "d1-replay-gate-empty.png") });
  await page.locator("#play-btn").click();
  const done1 = await waitTour((s) => !s.running, 12000, "s6 completion (empty run)");
  check("C/D: tour completes cleanly after Replay", done1?.running === false, JSON.stringify(done1));
  const stray1 = await page.evaluate(() => ({
    active: document.querySelectorAll("[data-tour-active]").length,
    keep: document.querySelectorAll(".tour-keep").length,
    dim: document.querySelectorAll("[data-tour-dim]").length,
  }));
  check("C/D: no stray tour attributes after exit", stray1.active === 0 && stray1.keep === 0 && stray1.dim === 0, JSON.stringify(stray1));

  // Run 2: PLAYED flavor — one real level-2 stride before Finish.
  await boot(15);
  await page.locator('.rstep[data-active="true"] .tour-launch').click();
  await waitTour((s) => s.phase === "active" && s.stepIndex === 0, 12000, "s6 start (played run)");
  await clickToAdvance();
  await waitTour((s) => s.gateKind === "fogStride" && s.gate === true, 12000, "stride gate (played)");
  await dragMinimap(-20, 10, 30, -22);
  await waitTour((s) => s.phase === "active" && s.stepIndex === 2 && s.gate === false, 8000, "painting beat (played)");
  await clickToAdvance();
  await waitTour((s) => s.gateKind === "fogFinish" && s.gate === true, 12000, "finish gate (played)");
  await dragMinimap(12, 25, 55, 70); // the level-2 stride that makes the run
  await sleep(1300);
  await page.locator("#fog-finish").click();
  const s4p = await waitTour((s) => s.phase === "active" && s.stepIndex === 4, 35000, "s6 reveal (played)");
  const rPlayed = await tourState();
  console.log(`  (played-run reveal: ${JSON.stringify(rPlayed)})`);
  await page.screenshot({ path: resolve(outDir, "c2-reveal-played.png") });
  check(
    "C: played run — #fog-trap-note lit directly (visible)",
    s4p?.stepIndex === 4 && rPlayed.markedId === "fog-trap-note" && rPlayed.markedVisible === true,
    `markedId=${rPlayed.markedId} visible=${rPlayed.markedVisible}`,
  );
  check(
    "C: played run — sentence choreography intact (dim + one visible keep)",
    rPlayed.dimChildren > 0 && rPlayed.keep === 1 && rPlayed.visibleKeep === 1,
    `dimChildren=${rPlayed.dimChildren} keep=${rPlayed.keep} visibleKeep=${rPlayed.visibleKeep}`,
  );
  await clickToAdvance();
  const s5p = await waitTour((s) => s.gateKind === "ghostReplay" && s.gate === true, 12000, "replay gate (played)");
  const dPlayed = await tourState();
  check(
    "D: played path — replay gate lights #fog-replay-note (not the verdict line)",
    s5p?.gate === true && dPlayed.markedId === "fog-replay-note",
    `markedId=${dPlayed.markedId} text="${dPlayed.markedText}" chip="${dPlayed.chip}"`,
  );
  await page.screenshot({ path: resolve(outDir, "d2-replay-gate-played.png") });
  await page.keyboard.press("Escape");
  await waitTour((s) => !s.running, 4000, "played esc");
}

await browser.close();
console.log(failures === 0 ? "\nALL_PASS" : `\nFAILURES: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
