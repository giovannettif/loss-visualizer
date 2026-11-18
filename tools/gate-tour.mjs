/**
 * gate-tour.mjs — the guided-tour v2 gate (all nine sections) over Playwright.
 *
 * The tour engine (src/view/tourEngine.ts) v2 presentation model:
 * sentence-precision addressing + a central controller + wheel-stays-master.
 * This gate proves the choreography end to end:
 *
 *   0. The shell: the Overview step names tours for EVERY section; all nine
 *      ONE fixed "▶ Tour section N" entry chip injects per section
 *      (s1..s9; hidden on the hero step and in the intro park);
 *      the reader segmented into sentence spans; the controller bar exists
 *      and is hidden.
 *   1. tourCheck: every step of every tour resolves to a visible sentence
 *      containing its `expect` substring (the authoring guard).
 *   2. §1 (?step=1): chip click starts the tour; the controller bar is live;
 *      ONE sentence span is marked (bright + underline) with siblings dimmed
 *      to 0.35; the fit-inset gate PAUSES — and Next/Space are swallowed
 *      while it waits; a plain reader click does NOTHING; the inset drag
 *      releases; Next walks the page's last sentence → advances the STEP
 *      (task-b, lock + entry); Back reverses across the page boundary
 *      instantly; minimize ↔ restore; the ball-drag gate completes the tour
 *      → clean exit; hover-to-look resumes.
 *   3. Wheel sync (?step=1): wheel forward inside §1 → the controller syncs
 *      to the parked page's first registered sentence; wheeling past the
 *      section's last page exits the tour cleanly (the reader stays master).
 *   4. §2 (?step=4): Space walks the needle beat; the compass draw gate
 *      waits (no auto-advance); Next POLITELY SKIPS the gate and Back
 *      reverses into it (re-arming); ArrowUp works during the η gate too;
 *      the visitor's own actions release; Finish completes → clean exit.
 *   5. §3 (?step=8): Auto (OFF by default) toggled ON advances sentences by
 *      the beat; OFF; Esc exits clean.
 *   5b. §6 (?step=15): the level-2 fogRun gate (TOURUX-S6) — a bare Finish
 *      with zero strides on the fresh level still releases (no soft-lock:
 *      round 1's refusal stranded premature finishers on a read-only
 *      compass) and lands the no-run reveal with its softened copy; the
 *      guided stride+Finish order still releases and grades a real run
 *      (no "no run" row). Flows 3+4: the LEVEL-1 fogStride gate releases
 *      on a finished run too (U3-FOGFINISH-STUCK — bare Finish at the
 *      gate, and strides+Finish before it arms).
 *   5c. FIX-4b (?step=16/17): a chip click from a mid-section page starts
 *      AT THE PARKED STEP ("4 / 6" / "5 / 6") and never scrolls upward;
 *      5d. the §2 compass scan (gd-b, before/after a draw): ZERO pixels of
 *      the §8 custom-rule purple #9A72AC — the needle draws lavender now.
 *   6. §7 (?step=18): the tilt-steering gate pauses; WASD steering releases
 *      it; the walk reaches the tilt-b ghost sentence — REG-1: the ▶ ghost
 *      button replays the ghost AND NOTHING ELSE (no gate since
 *      REG-1-GHOST-NO-GATE: the old ghostReplay gate released on the press
 *      and gotoStep jumped the reader to the swarm section) — then Next
 *      walks to the swarm sentence, whose ENSEMBLE look is live (ring +
 *      leader overlay — TOURUX-S7); Esc exits clean.
 *   7. §4/§5/§8/§9 smoke: each tour starts (sentence marked, controller on)
 *      and Esc exits clean.
 *   8. REG-2 anchor audit: EVERY registered hover sentence (data-slook,
 *      §1-5 strict; §6-9 where the target is present at boot) hovers in
 *      free play and its drawn arrowhead must land within ~1px of the
 *      registry anchor (lookScreenPoint), the anchor must sit un-clamped
 *      inside the viewport, DOM-named targets must contain it, and the
 *      needle sentences must anchor ON the compass's live needle dot
 *      (REG-2-NEEDLE-ANCHOR — the old fixed panel-fraction anchor sat
 *      34–102px off the halo).
 *   9. No stray tour attributes anywhere.
 *
 * Usage: node tools/gate-tour.mjs [baseUrl]
 */

import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";
import { mkdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const base = process.argv[2] ?? "http://localhost:4173";
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
// C3-CAP-TIMING: tour captures must wait out the chrome fades before the
// PNG — waitTour resolves on the tour's phase flip, the exact instant the
// 0.35s overlay/controller and 0.45s sentence-dim CSS fades BEGIN. 700ms
// clears the longest fade plus the cubic-bezier ease tail (the gate's own
// established idiom: the §1 capture already sleeps 450+650 before shooting).
const FADE_SETTLE_MS = 700;

async function tourState() {
  return page.evaluate(() => window.__wp1?.tour?.() ?? null);
}
async function lookState() {
  return page.evaluate(() => window.__wp1?.look?.() ?? null);
}
async function appState() {
  return page.evaluate(() => ({
    scene: window.__wp1?.scene?.(),
    step: window.__wp1?.step?.(),
    count: window.__wp1?.count?.(),
    locked: window.__wp1?.locked?.(),
    animating: window.__wp1?.animating?.(),
  }));
}
/** Waits until the reader is unlocked and the director idle. */
async function waitIdle(maxMs = 25000) {
  const t0 = Date.now();
  for (;;) {
    const a = await appState();
    if (!a.locked && !a.animating) return true;
    if (Date.now() - t0 > maxMs) return false;
    await sleep(200);
  }
}
/** Waits for a tour predicate; returns the last state or null on timeout. */
async function waitTour(pred, maxMs = 30000, label = "tour state") {
  const t0 = Date.now();
  let s = null;
  for (;;) {
    s = await tourState();
    if (s && pred(s)) return s;
    if (Date.now() - t0 > maxMs) {
      console.log(`  (timeout waiting for ${label}: ${JSON.stringify(s)})`);
      return s;
    }
    await sleep(120);
  }
}
async function waitEval(fn, maxMs = 30000, label = "condition") {
  const t0 = Date.now();
  for (;;) {
    if (await page.evaluate(fn)) return true;
    if (Date.now() - t0 > maxMs) {
      console.log(`  (timeout waiting for ${label})`);
      return false;
    }
    await sleep(140);
  }
}

/** The controller bar's visible state (v2). */
async function barState() {
  return page.evaluate(() => {
    const bar = document.querySelector("#tour-bar");
    const cs = getComputedStyle(bar);
    return {
      on: bar?.dataset.on,
      min: bar?.dataset.min,
      label: document.querySelector("#tour-bar-label")?.textContent ?? "",
      count: document.querySelector("#tour-count")?.textContent ?? "",
      backDisabled: document.querySelector("#tour-back")?.dataset.disabled,
      auto: document.querySelector("#tour-auto")?.dataset.auto,
      // The bar hides via container opacity; "visible" = on + un-minimized
      // + actually painted (opacity > 0.5 once the 0.35s fade settles).
      visible:
        bar?.dataset.on === "true" &&
        bar?.dataset.min === "false" &&
        Number(cs.opacity) > 0.5,
    };
  });
}
/** The marked sentence + its page's dim state (v2 sentence precision). */
async function markedSentence() {
  return page.evaluate(() => {
    const actives = [...document.querySelectorAll("[data-tour-active]")];
    const dimBody = document.querySelector('.step__body[data-tour-dim="true"]');
    let sibOpacity = null;
    if (dimBody) {
      const sib = [...dimBody.children].find(
        (el) => !el.classList.contains("tour-keep") && getComputedStyle(el).opacity !== "",
      );
      if (sib) sibOpacity = Number(getComputedStyle(sib).opacity);
      const kept = dimBody.querySelector(".tour-keep .sent:not([data-tour-active])");
      if (kept) sibOpacity = Math.max(sibOpacity ?? 0, Number(getComputedStyle(kept).opacity));
    }
    const raw = (actives[0]?.textContent ?? "").trim();
    return {
      count: actives.length,
      isSentenceSpan: actives.length === 1 && actives[0].tagName === "SPAN" && actives[0].classList.contains("sent"),
      text: raw.replace(/\s+/g, " "),
      dim: dimBody !== null,
      sibOpacity,
      underline: actives.length === 1 ? getComputedStyle(actives[0]).textDecorationLine.includes("underline") : false,
    };
  });
}

/** Drags an arrow on the compass minimap (the shared §2/§6 gesture). */
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

/** Drags the §1 fit line BODY in the inset (same math as FitPreview.hitMode). */
async function dragFitLine(dyPx = 42) {
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
}

/** Drags the learner ball on the 3D surface (§1 task-c gate). */
async function dragBall(dx = 42, dy = 12) {
  const p = await page.evaluate(() => window.__wp1?.ballScreen?.() ?? null);
  if (!p) throw new Error("ball screen position unavailable");
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + dx, p.y + dy, { steps: 6 });
  await page.mouse.up();
}

/** A plain click on the active step's heading TEXT (not a control). */
async function plainClickOnText() {
  await page.locator('.rstep[data-active="true"] h2').click();
}

/** Wheel bursts over the docked reader (the v4 master input). */
const READER_X = 1600 - 290;
async function wheelReader(notches, dy = 120) {
  await page.mouse.move(READER_X, 450);
  for (let i = 0; i < notches; i++) {
    await page.mouse.wheel(0, dy);
    await sleep(50);
  }
}
async function notchesToCross(k) {
  const tops = await page.evaluate(() => window.__wp1.scroll().tops);
  const half = (tops[k + 1] - tops[k]) / 2;
  return Math.max(1, Math.ceil(half / 120) + 1);
}

/** Shared cleanliness assertions after Esc / completion / wheel-out. */
async function checkCleanExit(label) {
  const t = await tourState();
  const l = await lookState();
  check(`${label}: tour not running`, t?.running === false, JSON.stringify(t));
  check(`${label}: spotlight released`, l?.active === false && l?.sceneDim === false, JSON.stringify(l));
  const strayHighlight = await page.evaluate(() => document.querySelectorAll("[data-tour-active]").length);
  check(`${label}: no stray sentence highlight`, strayHighlight === 0, `count=${strayHighlight}`);
  const overlayOff = await page.evaluate(
    () => document.querySelector("#tour-overlay")?.dataset.on === "false",
  );
  check(`${label}: leader overlay off`, overlayOff === true);
  const bar = await barState();
  check(
    `${label}: controller hidden (not minimized)`,
    bar.on === "false" && bar.min === "false" && bar.visible === false,
    JSON.stringify(bar),
  );
  const gateHidden = await page.locator("#tour-gate-chip").isHidden();
  check(`${label}: gate chip gone`, gateHidden === true);
  const a = await appState();
  check(`${label}: no lock left behind`, a.locked === false, JSON.stringify(a));
  // FIX-4a: the fixed entry chip takes the bottom-center slot back.
  const entry = await page.evaluate(() => {
    const el = document.querySelector("#tour-entry");
    return el
      ? { exists: true, hidden: el.hidden, label: (el.textContent ?? "").trim() }
      : { exists: false, hidden: true, label: "" };
  });
  check(
    `${label}: tour entry chip back (fixed bottom-center)`,
    entry.exists === true && entry.hidden === false &&
      entry.label.startsWith("\u25b6 Tour section "),
    JSON.stringify(entry),
  );
}

/* ---------------- 0. the shell: overview note + chips + segmentation ----- */

await page.goto(`${base}/?step=0`, { waitUntil: "load" });
await sleep(1600);
{
  const note = await page.locator('.rstep[data-scene="hero"] .step__body').textContent();
  check(
    // COPY-PLAN rewrite: the caption no longer inventories the controller
    // (Auto/Back/Next) and the R5 cut removed "plain clicks never advance" —
    // the assert now pins what the new copy actually documents.
    "overview names tours for EVERY section + the chip + Esc",
    (note ?? "").includes("Every section") &&
      (note ?? "").includes("Tour section") &&
      (note ?? "").includes("something to try") &&
      (note ?? "").includes("Esc"),
    (note ?? "").slice(0, 80),
  );
  // FIX-4: ONE fixed entry chip instead of per-step chips — on the hero
  // step (the intro is not a section) it must be absent or hidden.
  const heroEntry = await page.evaluate(() => {
    const el = document.querySelector("#tour-entry");
    return el
      ? { exists: true, hidden: el.hidden, label: (el.textContent ?? "").trim() }
      : { exists: false, hidden: true, label: "" };
  });
  check(
    "hero step: the tour entry is absent/hidden (the intro is not a section)",
    !heroEntry.exists || heroEntry.hidden === true,
    JSON.stringify(heroEntry),
  );
  // Sentence segmentation ran: every page's non-empty paragraphs carry
  // sentence spans. (The §8/§6 verdict paragraphs are EMPTY at boot — the
  // benchmark writes them later; the late-fill observer is asserted on the
  // labrule smoke below.)
  const seg = await page.evaluate(() => {
    const pages = [...document.querySelectorAll("#reader-body .rstep")];
    const total = document.querySelectorAll("#reader-body .rstep span.sent").length;
    const bad = [];
    for (const [k, step] of pages.entries()) {
      const ps = [...step.querySelectorAll(".step__body > p")];
      if (
        ps.length > 0 &&
        ps.some((p) => (p.textContent ?? "").trim() !== "" && p.querySelectorAll("span.sent").length === 0)
      ) {
        bad.push(k);
      }
    }
    return { pages: pages.length, total, bad };
  });
  check(
    "every non-empty paragraph segmented into sentence spans (27 pages, >150 sentences)",
    seg.pages === 27 && seg.total > 150 && seg.bad.length === 0,
    JSON.stringify(seg),
  );
  const barHidden = await barState();
  check("controller bar exists and is hidden at rest", barHidden.on === "false", JSON.stringify(barHidden));
}

/* ---------------- 0b. FIX-4a: the fixed bottom-center entry, per section --
 *
 * FIX-4 moved the tour entry OUT of the step prose into ONE fixed chip
 * pinned to the bottom-center of the canvas pane (the controller bar's
 * slot). Sweep every section step (1..26 — the hero is not a section) and
 * demand: visible, per-section label "▶ Tour section N" (N = tour order),
 * data-tour = the section's tour id, position:fixed, horizontally centered
 * on the canvas pane, near the viewport bottom — lifted to the sanctioned
 * 166px exactly on the §7 swarm page (BRK-3 twin, dock transport below).
 * The bare intro park ("/") hides it.
 */
{
  const SEC_OF_STEP = {
    1: "s1", 2: "s1", 3: "s1",
    4: "s2", 5: "s2", 6: "s2", 7: "s2",
    8: "s3", 9: "s3", 10: "s3",
    11: "s4", 12: "s4",
    13: "s5", 14: "s5",
    15: "s6", 16: "s6", 17: "s6",
    18: "s7", 19: "s7", 20: "s7", 21: "s7",
    22: "s8", 23: "s8",
    24: "s9", 25: "s9", 26: "s9",
  };
  const entryState = () =>
    page.evaluate(() => {
      const el = document.querySelector("#tour-entry");
      if (!el) return { exists: false };
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const reader = document.querySelector("#reader")?.getBoundingClientRect();
      const paneCx = reader ? (window.innerWidth - reader.width) / 2 : window.innerWidth / 2;
      return {
        exists: true,
        hidden: el.hidden,
        label: (el.textContent ?? "").trim(),
        tour: el.dataset.tour ?? null,
        pos: cs.position,
        cx: r.left + r.width / 2,
        paneCx,
        bottomGap: Math.round(window.innerHeight - r.bottom),
        dockLift:
          document.querySelector("#swarm-dock")?.dataset.visible === "true",
      };
    });

  await page.goto(`${base}/`, { waitUntil: "load" });
  await sleep(1600);
  const intro = await entryState();
  check(
    "FIX-4a: the intro park hides the entry",
    !intro.exists || intro.hidden === true,
    JSON.stringify(intro),
  );

  let swept = 0;
  for (let k = 1; k <= 26; k++) {
    await page.goto(`${base}/?step=${k}`, { waitUntil: "load" });
    await sleep(1100);
    if (!(await waitIdle())) check(`FIX-4a: ?step=${k} entry unlocks`, false, "still locked");
    const e = await entryState();
    const id = SEC_OF_STEP[k];
    const n = Number(id.slice(1));
    const wantGap = e.dockLift ? 166 : 16;
    const problems = [];
    if (!e.exists || e.hidden) problems.push("entry missing/hidden");
    if (e.tour !== id) problems.push(`data-tour=${e.tour} want ${id}`);
    if (e.label !== `▶ Tour section ${n}`) problems.push(`label=${JSON.stringify(e.label)}`);
    if (e.pos !== "fixed") problems.push(`position=${e.pos}`);
    if (Math.abs(e.cx - e.paneCx) > 12) {
      problems.push(`cx ${(e.cx - e.paneCx).toFixed(0)}px off pane center`);
    }
    if (Math.abs(e.bottomGap - wantGap) > 24) {
      problems.push(`bottomGap=${e.bottomGap} want ~${wantGap}`);
    }
    check(`FIX-4a: ?step=${k} → ${id} chip fixed bottom-center, "Tour section ${n}"`, problems.length === 0, problems.join("; "));
    if (problems.length === 0) swept += 1;
  }
  check("FIX-4a: sweep exercised all 26 section steps", swept === 26, `swept=${swept}`);
}

/* ---------------- 1. tourCheck: all nine tours resolve ---------------- */

{
  const checks = await page.evaluate(() => window.__wp1.tourCheck());
  check("nine tours present", checks.length === 9, checks.map((c) => c.id).join(","));
  const bad = [];
  for (const def of checks) {
    for (const st of def.steps) {
      if (!st.ok) bad.push(`${def.id}(p${st.page},${st.para},${st.sent})`);
    }
  }
  const total = checks.reduce((n, c) => n + c.steps.length, 0);
  check(
    `every tour sentence resolves + matches expect (${total} steps)`,
    bad.length === 0,
    bad.length ? bad.join(" ") : "all ok",
  );
}

/* ---------------- 2. §1 — sentence walk, gates, controller ---------------- */

await page.goto(`${base}/?step=1`, { waitUntil: "load" });
await sleep(1400);
if (!(await waitIdle())) check("§1 entry unlocks", false, "still locked");
{
  const a = await appState();
  check("boot: landed on task-a", a.scene === "task-a" && a.count === 27, JSON.stringify(a));

  // Tour starts on the chip; the controller bar is live (the 0.35s fade
  // must settle before the opacity-based visibility reads true).
  await page.locator('#tour-entry').click();
  const s0 = await waitTour((s) => s.running && s.phase === "active", 12000, "§1 start");
  check("§1 tour starts on chip click", s0?.running === true && s0?.id === "s1", JSON.stringify(s0));
  check("§1 first sentence is the inset gate", s0?.gate === true && s0?.gateKind === "fitMoved" && s0?.stepIndex === 0, JSON.stringify(s0));
  await sleep(450);
  const bar0 = await barState();
  check(
    "§1 controller visible: label + i/n + Auto off + Back disabled",
    bar0.on === "true" && bar0.label.startsWith("§1") && bar0.count === "1 / 4" &&
      bar0.auto === "false" && bar0.backDisabled === "true" && bar0.visible === true,
    JSON.stringify(bar0),
  );

  // SENTENCE PRECISION: one span.sent marked, underlined; siblings dim 0.35.
  await sleep(650); // the 0.45s dim fade must settle before reading opacity
  const m0 = await markedSentence();
  check(
    "§1 exactly one SENTENCE span marked (bright + underline)",
    m0.count === 1 && m0.isSentenceSpan && m0.underline && m0.text.includes("Drag the line"),
    JSON.stringify(m0),
  );
  check(
    "§1 page dimmed to 0.35 around the active sentence",
    m0.dim === true && m0.sibOpacity !== null && Math.abs(m0.sibOpacity - 0.35) < 0.02,
    `sibOpacity=${m0.sibOpacity}`,
  );
  const l0 = await lookState();
  check("§1 spotlight on the fit inset", l0?.active === true && l0?.spotPanels.includes("fit-panel") && l0?.sceneDim === true, JSON.stringify(l0));
  const ov0 = await page.evaluate(() => ({
    on: document.querySelector("#tour-overlay")?.dataset.on,
    d: document.querySelector("#tour-lead")?.getAttribute("d") ?? "",
  }));
  check("§1 leader overlay draws", ov0.on === "true" && ov0.d.startsWith("M"), JSON.stringify(ov0).slice(0, 120));
  await page.screenshot({ path: resolve(outDir, "30-tour-s1-gate.png") });

  // The gate WAITS: no auto-advance while Auto is off — and FIX-4 says a
  // waiting gate can never trap. The matrix: Back no-ops only at the
  // playlist head; Next (and Space) POLITELY SKIP — disarm + advance;
  // Back reverses INTO the gate sentence and the gate RE-ARMS; the
  // visitor's own action releases it on its own.
  await sleep(1200);
  const sHold = await tourState();
  check(
    "§1 gate waits (no auto-advance while Auto is off)",
    sHold?.stepIndex === 0 && sHold?.gate === true,
    JSON.stringify(sHold),
  );

  // Back at the playlist head is DISABLED (bar0.backDisabled above — the
  // engine gives Back no target at idx 0), so the walk cannot go back
  // from here and cannot be trapped: the gate holds and Next skips next.
  const sHead = await tourState();
  check(
    "§1 Back at the playlist head is disabled (gate still armed, no trap)",
    sHead?.stepIndex === 0 && sHead?.gate === true,
    JSON.stringify(sHead),
  );

  // FIX-4c: Next politely SKIPS the gate.
  await page.locator("#tour-next").click();
  const sSkip = await waitTour(
    (s) => s.phase === "active" && s.stepIndex === 1 && s.gate === false,
    6000,
    "§1 Next skips the gate",
  );
  check(
    "§1 Next during a gate SKIPS it (disarm + advance)",
    sSkip?.stepIndex === 1 && sSkip?.gate === false,
    JSON.stringify(sSkip),
  );

  // Back reverses into the gate sentence; arriving fresh, the gate re-arms.
  await page.locator("#tour-back").click();
  const sBack = await waitTour(
    (s) => s.phase === "active" && s.stepIndex === 0 && s.gate === true,
    6000,
    "§1 back into the gate",
  );
  check(
    "§1 Back reverses into the gate sentence and re-arms it",
    sBack?.stepIndex === 0 && sBack?.gate === true,
    JSON.stringify(sBack),
  );

  // v2 CLICK DOES NOTHING: a plain click on reader text advances neither
  // the tour nor the reader (parked on the re-armed gate sentence).
  await plainClickOnText();
  await sleep(400);
  const s0d = await tourState();
  const a0d = await appState();
  check(
    "§1 plain click does nothing (no tour advance, no reader advance, no lock)",
    s0d?.stepIndex === 0 && a0d.step === 1 && a0d.locked === false,
    `tour=${JSON.stringify(s0d)} app=${JSON.stringify(a0d)}`,
  );

  // The visitor's action (inset drag) releases the gate.
  await dragFitLine();
  const s1 = await waitTour((s) => s.phase === "active" && s.stepIndex === 1, 6000, "§1 gate release");
  check("§1 inset drag releases the gate", s1?.stepIndex === 1 && s1?.gate === false, JSON.stringify(s1));
  const m1 = await markedSentence();
  check(
    "§1 highlight MOVED to the loss sentence",
    m1.text.includes("loss is one number"),
    JSON.stringify(m1),
  );
  const l1 = await lookState();
  check("§1 next sentence spotlights the loss readout", l1?.id === "loss-readout" && l1?.spotPanels.includes("loss-panel"), JSON.stringify(l1));

  // Minimize ↔ restore while the tour runs.
  await page.locator("#tour-min").click();
  await sleep(200);
  const barMin = await barState();
  check(
    "§1 minimize collapses the bar to the chip",
    barMin.min === "true" && barMin.visible === false,
    JSON.stringify(barMin),
  );
  await page.locator("#tour-bar-chip").click();
  await sleep(200);
  const barBack = await barState();
  check(
    "§1 the chip restores the controller",
    barBack.min === "false" && barBack.visible === true,
    JSON.stringify(barBack),
  );

  // Next at the page's last registered sentence advances the STEP (its
  // entry animation plays under the v4 lock; the tour waits for rest).
  await page.locator("#tour-next").click();
  const s2 = await waitTour((s) => s.phase === "active" && s.stepIndex === 2, 15000, "§1 step advance");
  const a2 = await appState();
  check(
    "§1 Next at the page's last sentence advanced the STEP (→ task-b)",
    s2?.stepIndex === 2 && a2.scene === "task-b",
    `tour=${JSON.stringify(s2)} app=${JSON.stringify(a2)}`,
  );
  const m2 = await markedSentence();
  check("§1 needle sentence marked on task-b", m2.text.includes("purple needle"), JSON.stringify(m2));
  const l2 = await lookState();
  check("§1 needle spotlight (minimap + needle)", l2?.minimapSpot === true && l2?.spotPanels.includes("minimap-panel"), JSON.stringify(l2));

  // BACK reverses one sentence — across the page boundary, instantly.
  await page.locator("#tour-back").click();
  const s2b = await waitTour((s) => s.phase === "active" && s.stepIndex === 1, 8000, "§1 back");
  const a2b = await appState();
  check(
    "§1 Back reversed across the page boundary (→ task-a, no lock)",
    s2b?.stepIndex === 1 && a2b.scene === "task-a" && a2b.locked === false,
    `tour=${JSON.stringify(s2b)} app=${JSON.stringify(a2b)}`,
  );

  // Forward again (two sentences: task-a's loss sentence → task-b's needle
  // sentence), then complete via the ball gate.
  await page.locator("#tour-next").click();
  await waitTour((s) => s.phase === "active" && s.stepIndex === 2, 15000, "§1 forward a");
  await page.locator("#tour-next").click();
  const s3 = await waitTour((s) => s.phase === "active" && s.stepIndex === 3, 15000, "§1 forward b");
  check("§1 back on the ball gate", s3?.stepIndex === 3 && s3?.gateKind === "fitMoved", JSON.stringify(s3));

  // FIX-4c regression (the trap the user hit): Back DURING an open gate
  // must always work — reverse to the previous sentence and disarm the
  // gate (no reader lock left behind).
  await page.locator("#tour-back").click();
  const sBackGate = await waitTour(
    (s) => s.phase === "active" && s.stepIndex === 2 && s.gate === false,
    8000,
    "§1 Back during the gate",
  );
  const aBackGate = await appState();
  check(
    "FIX-4c: Back during an open gate reverses + disarms it (→ task-b, no lock)",
    sBackGate?.stepIndex === 2 && sBackGate?.gate === false &&
      aBackGate.scene === "task-b" && aBackGate.locked === false,
    `tour=${JSON.stringify(sBackGate)} app=${JSON.stringify(aBackGate)}`,
  );

  // Forward again: the gate re-arms on fresh arrival, and the ball drag
  // (the visitor's action) releases it into the tour's completion.
  await page.locator("#tour-next").click();
  const s3b = await waitTour(
    (s) => s.phase === "active" && s.stepIndex === 3 && s.gate === true,
    15000,
    "§1 gate re-arm",
  );
  check("§1 the ball gate re-arms on fresh arrival", s3b?.stepIndex === 3 && s3b?.gate === true, JSON.stringify(s3b));
  const l3 = await lookState();
  check("§1 ball spotlight (ring on the surface)", l3?.ring === true && l3?.sceneDim === true, JSON.stringify(l3));
  await sleep(800);
  await dragBall();
  const done = await waitTour((s) => !s.running, 8000, "§1 completion");
  check("§1 ball drag completes + exits the tour", done?.running === false, JSON.stringify(done));
  await checkCleanExit("§1 end");

  // Free play intact: hover-to-look works again right after the tour.
  await page.hover('.rstep[data-active="true"] [data-look]');
  await sleep(400);
  const lFree = await lookState();
  check("§1 hover-to-look live again after the tour", lFree?.active === true, JSON.stringify(lFree));
  await page.mouse.move(10, 10);
  await sleep(400);
}

/* ---------------- 2b. sentence hover graduation (free play) ---------------- */

await page.goto(`${base}/?step=1`, { waitUntil: "load" });
await sleep(1400);
if (!(await waitIdle())) check("§1 entry unlocks (hover)", false, "still locked");
{
  // A REGISTERED sentence: hovering it lights the sentence AND spotlights
  // its target through the pointing overlay (no tour running).
  await page.hover('.rstep[data-active="true"] .sent[data-slook="fit-inset"]');
  await sleep(450);
  const h1 = await page.evaluate(() => ({
    hover: document.querySelectorAll(".sent[data-slook-hover]").length,
  }));
  const lh = await lookState();
  const oh = await page.evaluate(() => document.querySelector("#tour-overlay")?.dataset.on);
  check(
    "hover graduation: a registered sentence lights + spotlights its target",
    h1.hover === 1 && lh?.active === true && lh?.spotPanels.includes("fit-panel"),
    JSON.stringify({ h1, lh }),
  );
  check("hover graduation: the pointing overlay shows for the sentence hover", oh === "true", `overlay=${oh}`);
  await page.mouse.move(10, 10);
  await sleep(450);
  const h2 = await page.evaluate(() => document.querySelectorAll(".sent[data-slook-hover]").length);
  const lh2 = await lookState();
  check(
    "hover graduation: leaving clears the sentence hover + spotlight",
    h2 === 0 && lh2?.active === false,
    `hover=${h2} look=${JSON.stringify(lh2)}`,
  );

  // An UNREGISTERED sentence falls back to the per-span .look behavior:
  // hovering its look span spotlights the span's target, but the sentence
  // itself never lights.
  await page.goto(`${base}/?step=2`, { waitUntil: "load" });
  await sleep(1400);
  if (!(await waitIdle())) check("§1 task-b entry unlocks (hover)", false, "still locked");
  await page.hover('.rstep[data-active="true"] .step__body > p:nth-of-type(2) .look');
  await sleep(450);
  const fb = await page.evaluate(() => ({
    hover: document.querySelectorAll(".sent[data-slook-hover]").length,
    spanLit: document.querySelector(".rstep[data-active='true'] .look:hover") !== null,
  }));
  const lf = await lookState();
  check(
    "hover graduation: an unregistered sentence falls back to span-to-look",
    fb.hover === 0 && lf?.active === true && lf?.id === "loss-readout",
    JSON.stringify({ fb, lf }),
  );
  await page.mouse.move(10, 10);
  await sleep(300);
}

/* ---------------- 2c. REG-2: hover-arrow anchor audit ----------------
 *
 * Every registered hover sentence (data-slook) is hovered in free play and
 * its drawn leader arrowhead must land ON its registry target:
 *   • the arrowhead apex + focal dot sit within ~1px of the CLAMPED
 *     lookScreenPoint (the overlay re-anchors every frame — drift means a
 *     broken anchor path);
 *   • the raw anchor sits INSIDE the viewport (an edge-pinned anchor is the
 *     "arrow pointing at nothing" shape);
 *   • DOM-named targets (panels, controls, pill rows) CONTAIN the anchor —
 *     the arrow points at the named instrument, never at a scene point or
 *     a panel gap;
 *   • needle sentences anchor ON the compass's live needle dot (the white
 *     learner point the needle + spotlight halo are drawn on) — found by a
 *     near-white pixel-cluster scan of #minimap-canvas. This pins
 *     REG-2-NEEDLE-ANCHOR: the old fixed panel-fraction anchor sat 102px
 *     off the halo on task-b and swung 34–101px on gd-a's drift.
 *
 * §1-5 rows are STRICT (the audited scope: anchor must exist and pass).
 * §6-9 rows skip cleanly when the target legitimately no-ops at that
 * page's boot flavor (the registry's documented never-invents-a-target
 * rule) but must pass wherever the anchor exists.
 */

{
  // domSel: element(s) the anchor must land inside (null = scene point;
  // "needle-dot" = the compass's live needle dot).
  const ROWS = [
    // §1-5 — strict (the audit scope).
    { page: 1, key: "fit-inset", domSel: "#fit-panel", strict: true },
    { page: 1, key: "loss-readout", domSel: "#loss-panel", strict: true },
    { page: 2, key: "needle", domSel: "needle-dot", strict: true },
    { page: 3, key: "ball", domSel: null, strict: true },
    { page: 4, key: "needle", domSel: "needle-dot", strict: true },
    { page: 5, key: "compass", domSel: "#minimap-canvas", strict: true },
    { page: 5, key: "gd-step", domSel: null, strict: true, drawArrow: true },
    { page: 6, key: "eta-slider", domSel: "#eta-slider", strict: true },
    { page: 7, key: "trail-gd", domSel: null, strict: true },
    { page: 8, key: "trail-gd", domSel: null, strict: true },
    { page: 8, key: "trail-mom", domSel: null, strict: true },
    { page: 8, key: "beta-slider", domSel: "#beta-slider", strict: true },
    { page: 9, key: "mom-apexes", domSel: null, strict: true },
    { page: 10, key: "trail-mom", domSel: null, strict: true },
    { page: 11, key: "adam-bars", domSel: "#adam-panel .bar-row", strict: true },
    { page: 11, key: "adam-arrows", domSel: null, strict: true },
    { page: 12, key: "steep-slider", domSel: "#steep-slider", strict: true },
    { page: 13, key: "lab-sliders", domSel: "#lab-sliders", strict: true },
    { page: 13, key: "lab-checklist", domSel: "#lab-checklist", strict: true },
    { page: 14, key: "trail-gd", domSel: null, strict: true },
    { page: 14, key: "trail-adam", domSel: null, strict: true },
    // §6-9 — same machinery; target-absent no-ops skip.
    { page: 15, key: "needle", domSel: null, strict: false },
    { page: 15, key: "compass", domSel: "#minimap-canvas", strict: false },
    { page: 15, key: "ball", domSel: null, strict: false },
    { page: 16, key: "fog-panel", domSel: "#fog-panel", strict: false },
    { page: 17, key: "gold-marker", domSel: null, strict: false },
    { page: 17, key: "replay-btn", domSel: "#replay-btn", strict: false },
    { page: 18, key: "ball", domSel: null, strict: false },
    // POINT-TS2-1: the damping sentence is keyed "tilt-damp" (the named
    // #tilt-friction control) — the old "tilt-panel" row would match no
    // sentence span on page 18 and silently skip.
    { page: 18, key: "tilt-damp", domSel: "#tilt-friction", strict: false },
    { page: 19, key: "tilt-levels", domSel: "#tilt-levels", strict: false },
    { page: 20, key: "tilt-replay", domSel: "#tilt-replay-play", strict: false },
    { page: 21, key: "swarm-ensemble", domSel: null, strict: false },
    { page: 21, key: "tilt-panel", domSel: "#tilt-panel", strict: false },
    { page: 21, key: "swarm-dock", domSel: "#swarm-dock", strict: false },
    { page: 22, key: "rule-panel", domSel: "#rule-panel", strict: false },
    { page: 22, key: "rule-levels", domSel: "#rule-levels", strict: false },
    { page: 23, key: "rule-panel", domSel: "#rule-panel", strict: false },
    { page: 23, key: "rule-levels", domSel: "#rule-levels", strict: false },
    { page: 24, key: "epi-marker", domSel: null, strict: false },
    { page: 25, key: "epi-lattice", domSel: null, strict: false },
    { page: 26, key: "epi-lattice", domSel: null, strict: false },
  ];

  const hypot = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  let auditRows = 0;
  let auditSkips = 0;
  let lastPage = -1;
  for (const row of ROWS) {
    if (row.page !== lastPage) {
      await page.goto(`${base}/?step=${row.page}`, { waitUntil: "load" });
      await sleep(1500);
      if (!(await waitIdle())) check(`REG-2: ?step=${row.page} entry unlocks`, false, "still locked");
      lastPage = row.page;
    }
    if (row.drawArrow) {
      // §2 gd-b: the red-step target exists only after a committed draw.
      const box = await page.locator("#minimap-canvas").boundingBox();
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      await page.mouse.move(cx + 10, cy + 40);
      await page.mouse.down();
      await page.mouse.move(cx + 62, cy + 80, { steps: 8 });
      await page.mouse.up();
      await sleep(1300);
      await waitIdle();
    }
    const sel = `.rstep[data-active="true"] .sent[data-slook="${row.key}"]`;
    const spanCount = await page.locator(sel).count();
    // Flavor swaps (§6/§7 reveals) hide whole paragraphs wholesale: hover
    // the first VISIBLE registered span; a sentence present-but-hidden is
    // the same legitimate no-op as an absent one.
    let hoverTarget = null;
    for (let i = 0; i < spanCount; i++) {
      const loc = page.locator(sel).nth(i);
      if (await loc.isVisible()) { hoverTarget = loc; break; }
    }
    if (!hoverTarget) {
      if (row.strict) {
        check(`REG-2 p${row.page} ${row.key}: registered sentence present + visible`, false, sel);
      } else {
        auditSkips += 1;
        console.log(`SKIP  REG-2 p${row.page} ${row.key} — sentence absent/hidden on this boot flavor`);
      }
      continue;
    }
    await hoverTarget.hover({ timeout: 5000 });
    await sleep(500); // the 150ms motion gate + a re-anchor frame
    const m = await page.evaluate((key) => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const raw = window.__wp1?.lookPoint?.(key) ?? null;
      const pts = (document.querySelector("#tour-arrow")?.getAttribute("points") ?? "").trim().split(/\s+/)[0] ?? "";
      const [tx, ty] = pts.split(",").map(Number);
      const dot = document.querySelector("#tour-dot");
      // Near-white 5×5 cluster scan: the compass's learner dot (radius-2.8
      // #ffffff core) — tick/axis labels are ~154-178 gray, well under the
      // 240/channel floor, and the translucent contour ghost is RGB-255 at
      // alpha ~26, so the alpha ≥200 floor is what isolates the opaque dot.
      let dotPix = null;
      const cv = document.querySelector("#minimap-canvas");
      if (cv) {
        const r = cv.getBoundingClientRect();
        const g = cv.getContext("2d");
        const W = cv.width;
        const H = cv.height;
        if (W > 0 && H > 0) {
          const img = g.getImageData(0, 0, W, H).data;
          const nw = (k) =>
            img[k] >= 240 && img[k + 1] >= 240 && img[k + 2] >= 240 && img[k + 3] >= 200;
          let best = -1;
          let bx = -1;
          let by = -1;
          for (let y = 2; y < H - 2; y++) {
            for (let x = 2; x < W - 2; x++) {
              const k = (y * W + x) * 4;
              if (!nw(k)) continue;
              let n = 0;
              for (let dy = -2; dy <= 2; dy++) {
                for (let dx = -2; dx <= 2; dx++) {
                  if (nw(((y + dy) * W + (x + dx)) * 4)) n++;
                }
              }
              if (n > best) { best = n; bx = x; by = y; }
            }
          }
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          dotPix = best >= 10 ? { x: r.left + bx / dpr, y: r.top + by / dpr } : null;
        }
      }
      return { w, h, raw, overlayOn: document.querySelector("#tour-overlay")?.dataset.on, tip: Number.isFinite(tx) ? { x: tx, y: ty } : null, dotCenter: { x: Number(dot?.getAttribute("cx")), y: Number(dot?.getAttribute("cy")) }, dotPix };
    }, row.key);
    await page.mouse.move(10, 10);
    await sleep(250);

    const label = `REG-2 p${row.page} ${row.key}`;
    if (!m.raw || m.overlayOn !== "true") {
      if (row.strict) {
        check(`${label}: anchor + overlay live`, false, `raw=${JSON.stringify(m.raw)} overlay=${m.overlayOn}`);
      } else {
        auditSkips += 1;
        console.log(`SKIP  ${label} — target absent at this flavor (registry no-op)`);
      }
      continue;
    }
    auditRows += 1;
    const clamp = {
      x: Math.min(Math.max(m.raw.x, 12), m.w - 12),
      y: Math.min(Math.max(m.raw.y, 12), m.h - 12),
    };
    const tipDist = m.tip ? hypot(m.tip.x, m.tip.y, clamp.x, clamp.y) : -1;
    const dotDist = hypot(m.dotCenter.x, m.dotCenter.y, clamp.x, clamp.y);
    const offscreen = m.raw.x < 0 || m.raw.y < 0 || m.raw.x > m.w || m.raw.y > m.h;
    const clamped = Math.abs(m.raw.x - clamp.x) > 0.5 || Math.abs(m.raw.y - clamp.y) > 0.5;
    const problems = [];
    if (!m.tip || tipDist > 1) problems.push(`arrowhead off anchor by ${tipDist < 0 ? "∞(none)" : `${tipDist.toFixed(1)}px`}`);
    if (dotDist > 1) problems.push(`focal dot off anchor by ${dotDist.toFixed(1)}px`);
    if (offscreen) problems.push(`anchor offscreen (${m.raw.x.toFixed(0)},${m.raw.y.toFixed(0)})`);
    else if (clamped) problems.push(`anchor edge-clamped (raw ${m.raw.x.toFixed(0)},${m.raw.y.toFixed(0)})`);
    if (row.domSel === "needle-dot") {
      // REG-2-NEEDLE-ANCHOR: the anchor must BE the compass needle dot.
      if (!m.dotPix) problems.push("needle dot not found on the compass canvas");
      else {
        const d = hypot(m.raw.x, m.raw.y, m.dotPix.x, m.dotPix.y);
        if (d > 4) problems.push(`anchor ${d.toFixed(0)}px off the needle dot (${m.dotPix.x.toFixed(0)},${m.dotPix.y.toFixed(0)})`);
      }
    } else if (row.domSel) {
      const inside = await page.evaluate((sel2) => {
        const els = [...document.querySelectorAll(sel2)];
        const rs = els.map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
        if (rs.length === 0) return null;
        const l = Math.min(...rs.map((r) => r.left));
        const r = Math.max(...rs.map((r) => r.right));
        const t = Math.min(...rs.map((r) => r.top));
        const b = Math.max(...rs.map((r) => r.bottom));
        return { l, r, t, b };
      }, row.domSel);
      if (inside === null) problems.push(`dom target ${row.domSel} not laid out`);
      else {
        const M = 2;
        const out =
          m.raw.x < inside.l - M || m.raw.x > inside.r + M ||
          m.raw.y < inside.t - M || m.raw.y > inside.b + M;
        if (out) problems.push(`anchor outside ${row.domSel} rect`);
      }
    }
    check(`${label}: arrow lands on its target`, problems.length === 0, problems.join("; "));
  }
  check(
    `REG-2 audit exercised real targets (${auditRows} rows, ${auditSkips} flavor skips)`,
    auditRows >= 25,
    `rows=${auditRows} skips=${auditSkips}`,
  );
}

/* ---------------- 3. wheel sync: the reader stays master ---------------- */

await page.goto(`${base}/?step=1`, { waitUntil: "load" });
await sleep(1400);
if (!(await waitIdle())) check("§1 entry unlocks (wheel)", false, "still locked");
{
  await page.locator('#tour-entry').click();
  await waitTour((s) => s.phase === "active" && s.stepIndex === 0, 12000, "wheel start");

  // Wheel forward across the task-a → task-b boundary: the controller SYNCs
  // to task-b's first registered sentence (the needle sentence).
  await wheelReader(await notchesToCross(1));
  const sync = await waitTour(
    (s) => s.phase === "active" && s.stepIndex === 2 && s.page === 2,
    15000,
    "wheel sync",
  );
  check(
    "wheel forward inside the section syncs the controller (task-b, needle sentence)",
    sync?.stepIndex === 2 && sync?.page === 2,
    JSON.stringify(sync),
  );
  const aSync = await appState();
  check("wheel really paged the reader (v4 stays master)", aSync.scene === "task-b", JSON.stringify(aSync));

  // Wheel forward again (task-b → task-c): sync + the ball gate opens.
  await waitIdle();
  await wheelReader(await notchesToCross(2));
  const sync2 = await waitTour(
    (s) => s.phase === "active" && s.stepIndex === 3 && s.gate === true,
    15000,
    "wheel sync 2",
  );
  check(
    "wheel to task-c syncs + opens the ball gate",
    sync2?.stepIndex === 3 && sync2?.gateKind === "fitMoved",
    JSON.stringify(sync2),
  );

  // Wheel past the section's last page (task-c → gd-a ∉ s1): clean exit.
  await wheelReader(await notchesToCross(3));
  const dead = await waitTour((s) => !s.running, 15000, "wheel exit");
  check("wheel past the section's last page exits the tour cleanly", dead?.running === false, JSON.stringify(dead));
  await waitIdle(); // the cross-scene entry the wheel triggered must drain
  await checkCleanExit("wheel-out");
}

/* ---------------- 4. §2 — keyboard walk + gates ---------------- */

await page.goto(`${base}/?step=4`, { waitUntil: "load" });
await sleep(1400);
if (!(await waitIdle())) check("§2 entry unlocks", false, "still locked");
{
  await page.locator('#tour-entry').click();
  const s0 = await waitTour((s) => s.phase === "active" && s.stepIndex === 0, 12000, "§2 start");
  check("§2 tour starts; needle sentence first", s0?.id === "s2" && s0?.count === 5 && s0?.lookKey === "needle", JSON.stringify(s0));
  check("§2 Auto defaults OFF (no timed advance)", s0?.auto === false, JSON.stringify(s0));
  await sleep(FADE_SETTLE_MS); // C3-CAP-TIMING: let the dim/overlay fades settle
  await page.screenshot({ path: resolve(outDir, "31-tour-s2-needle.png") });

  // Space walks one sentence. The gate sentence lives on gd-b, so the TOUR
  // pages the reader there (its entry plays under the v4 lock) — the
  // reader's new park is the gate's page, by design.
  await sleep(400);
  await page.keyboard.press("Space");
  const s1 = await waitTour((s) => s.phase === "active" && s.stepIndex === 1, 12000, "§2 space");
  const a1 = await appState();
  check(
    "§2 Space advances the sentence (the tour pages to the gate's page, gd-b)",
    s1?.stepIndex === 1 && s1?.gateKind === "arrowDrawn" && a1.scene === "gd-b",
    `tour=${JSON.stringify(s1)} app=${JSON.stringify(a1)}`,
  );

  // The visitor draws an arrow on the compass → the tour releases.
  await dragMinimap(10, 40, 62, 80);
  await sleep(1300); // the arrow commit + GD's step play out
  const s2 = await waitTour((s) => s.phase === "active" && s.stepIndex === 2, 8000, "§2 gd-step");
  check("§2 stride releases; GD's actual step sentence on", s2?.stepIndex === 2 && s2?.lookKey === "gd-step" && s2?.gate === false, JSON.stringify(s2));
  const l2 = await lookState();
  check("§2 red-step spotlight (ring at GD's tip)", l2?.ring === true && l2?.id === "gd-step", JSON.stringify(l2));
  await sleep(FADE_SETTLE_MS); // C3-CAP-TIMING: let the dim/overlay fades settle
  await page.screenshot({ path: resolve(outDir, "32-tour-s2-gdstep.png") });

  // Next crosses into the η gate page (gd-c).
  await page.locator("#tour-next").click();
  const s3 = await waitTour((s) => s.phase === "active" && s.stepIndex === 3, 15000, "§2 eta gate");
  check("§2 Next advances the step → η gate pauses on gd-c", s3?.stepIndex === 3 && s3?.gateKind === "etaMoved" && s3?.gate === true, JSON.stringify(s3));

  // FIX-4c keyboard regression: ArrowUp (Back) works DURING the open gate —
  // it reverses to the previous sentence (gd-b), disarms the gate, and
  // lands instantly with no lock left behind.
  await page.keyboard.press("ArrowUp");
  const sBack2 = await waitTour(
    (s) => s.phase === "active" && s.stepIndex === 2 && s.gate === false,
    8000,
    "§2 ArrowUp during the gate",
  );
  const aBack2 = await appState();
  check(
    "FIX-4c: ArrowUp during an open gate reverses + disarms (→ gd-b sentence)",
    sBack2?.stepIndex === 2 && sBack2?.gate === false && aBack2.scene === "gd-b" && aBack2.locked === false,
    `tour=${JSON.stringify(sBack2)} app=${JSON.stringify(aBack2)}`,
  );

  // Forward again: the gate re-arms on fresh arrival, and the visitor's η
  // slide releases it.
  await page.locator("#tour-next").click();
  const s3b = await waitTour(
    (s) => s.phase === "active" && s.stepIndex === 3 && s.gate === true,
    15000,
    "§2 gate re-arm",
  );
  check("§2 the η gate re-arms on fresh arrival", s3b?.stepIndex === 3 && s3b?.gate === true, JSON.stringify(s3b));

  // The visitor slides η → the tour releases.
  await page.evaluate(() => {
    const s = document.querySelector("#eta-slider");
    s.value = "820";
    s.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await sleep(600);
  const s4 = await waitTour((s) => s.phase === "active" && s.stepIndex === 4, 12000, "§2 trail");
  check("§2 η move releases; trail sentence on gd-d", s4?.stepIndex === 4 && s4?.lookKey === "trail-gd" && s4?.gate === false, JSON.stringify(s4));
  const l4 = await lookState();
  check("§2 trail spotlight (kept trails, scene dim)", l4?.sceneDim === true && (l4?.keptTrails ?? 0) >= 1, JSON.stringify(l4));

  // Finish ▶ completes the tour.
  await page.locator("#tour-next").click();
  const done = await waitTour((s) => !s.running, 8000, "§2 completion");
  check("§2 tour completes + exits", done?.running === false, JSON.stringify(done));
  await checkCleanExit("§2 end");
  await page.screenshot({ path: resolve(outDir, "33-tour-s2-end.png") });
}

/* ---------------- 5. §3 — Auto mode (off by default) ---------------- */

await page.goto(`${base}/?step=8`, { waitUntil: "load" });
await sleep(1400);
if (!(await waitIdle())) check("§3 entry unlocks", false, "still locked");
{
  await page.locator('#tour-entry').click();
  const s0 = await waitTour((s) => s.phase === "active" && s.stepIndex === 0, 12000, "§3 start");
  check("§3 tour starts (momentum)", s0?.id === "s3" && s0?.count === 5, JSON.stringify(s0));

  // Auto OFF: a beat-length wait moves nothing.
  await sleep(2500);
  const sHold = await tourState();
  check("§3 no auto-advance while Auto is off", sHold?.stepIndex === 0 && sHold?.auto === false, JSON.stringify(sHold));

  // Auto ON: the sentence advances by itself (beat ≈ reading load).
  await page.locator("#tour-auto").click();
  const sAuto = await waitTour((s) => s.auto === true && s.stepIndex >= 1, 12000, "§3 auto");
  check("§3 Auto ON advances the sentence by the beat", sAuto?.auto === true && (sAuto?.stepIndex ?? 0) >= 1, JSON.stringify(sAuto));
  const barAuto = await barState();
  check("§3 Auto button lit", barAuto.auto === "true", JSON.stringify(barAuto));
  await page.locator("#tour-auto").click(); // off again
  await sleep(200);

  // Esc exits clean.
  await page.keyboard.press("Escape");
  const dead = await waitTour((s) => !s.running, 4000, "§3 esc");
  check("§3 Esc exits the tour", dead?.running === false, JSON.stringify(dead));
  await checkCleanExit("§3 end");
}

/* ---------------- 5b. §6 — the level-2 fogRun gate (TOURUX-S6) ------------ */

// The guided path: stride on level 1 (fogStride), then the level-2 reveal
// gate. The gate releases when the level-2 run finishes (fogRun, main.ts) —
// round 2 retreated from round 1's stride-since-arrival requirement, which
// soft-locked visitors who pressed Finish first on a level whose run-over
// compass is read-only. What must hold: (a) a bare Finish with zero strides
// still releases, into the no-run reveal whose lead copy states the fact
// without scolding; (b) the guided stride+Finish order releases too and
// grades a REAL run (no "you (no run)" row).
{
  // Flow 2 — the premature finish (TOURUX-S6-FOGRUN-PREMATURE-FINISH):
  // a bare Finish on the fresh level ENDS the run and MUST still release
  // the gate — round 1's refusal soft-locked premature finishers, since the
  // run-over compass is read-only and the Finish button hides (the demanded
  // stride was impossible). The release lands the no-run reveal, whose lead
  // copy states the fact without the scolding.
  await page.goto(`${base}/?step=15`, { waitUntil: "load" });
  await sleep(1500);
  if (!(await waitIdle())) check("§6 entry unlocks", false, "still locked");
  await page.locator('#tour-entry').click();
  const f0 = await waitTour((s) => s.running && s.phase === "active", 12000, "§6 start");
  check("§6 tour starts (needle sentence)", f0?.id === "s6" && f0?.count === 6, JSON.stringify(f0));
  await page.keyboard.press("Space"); // → the level-1 stride gate
  const f1 = await waitTour((s) => s.phase === "active" && s.gateKind === "fogStride", 12000, "§6 stride gate");
  check("§6 level-1 stride gate armed", f1?.stepIndex === 1 && f1?.gate === true, JSON.stringify(f1));
  await dragMinimap(10, 40, 62, 80);
  const f2 = await waitTour((s) => s.phase === "active" && s.stepIndex === 2, 10000, "§6 stride release");
  check("§6 level-1 stride releases", f2?.stepIndex === 2, JSON.stringify(f2));
  await page.keyboard.press("Space"); // → page 16, the fogRun gate (level 2)
  const f3 = await waitTour((s) => s.phase === "active" && s.gateKind === "fogRun", 15000, "§6 fogRun gate");
  check("§6 level-2 fogRun gate armed on page 16", f3?.stepIndex === 3 && f3?.gate === true, JSON.stringify(f3));
  await page.click("#fog-finish"); // a bare Finish: 0 strides on this level
  const f4 = await waitTour((s) => s.phase === "active" && s.stepIndex === 4, 25000, "§6 bare-Finish release");
  check(
    "TOURUX-S6: bare Finish with zero level-2 strides still releases the gate (no soft-lock)",
    f4?.stepIndex === 4 && f4?.gate === false && f4?.lookKey === "gold-marker",
    JSON.stringify(f4),
  );
  const emptyLead = await page.evaluate(() => {
    const el = document.querySelector("#fog-empty-lead");
    return { visible: el !== null && el.hidden === false, text: (el?.textContent ?? "").replace(/\s+/g, " ") };
  });
  check(
    "TOURUX-S6: the empty-run reveal copy states the fact without the scolding",
    emptyLead.visible === true &&
      // COPY-PLAN §2.15: the lead now reads "no measurements spent on this
      // level" (and ships the #fog-goto-l2 jump button instead of the
      // scroll-back instruction).
      emptyLead.text.includes("no measurements spent on this level") &&
      !emptyLead.text.includes("scrolled past"),
    JSON.stringify(emptyLead).slice(0, 200),
  );
  await page.keyboard.press("Escape");
  const fEsc = await waitTour((s) => !s.running, 5000, "§6 esc (guard flow)");
  check("§6 Esc exits the guard flow cleanly", fEsc?.running === false, JSON.stringify(fEsc));
  await checkCleanExit("§6 guard end");
  await waitIdle();

  // Flow 1 — the guided release: stride HERE, then Finish. The reveal must
  // grade a real run (no "you (no run)" scorecard row) and release the gate.
  await page.goto(`${base}/?step=15`, { waitUntil: "load" });
  await sleep(1500);
  if (!(await waitIdle())) check("§6 entry unlocks (flow 1)", false, "still locked");
  await page.locator('#tour-entry').click();
  await waitTour((s) => s.running && s.phase === "active", 12000, "§6 start 2");
  await page.keyboard.press("Space");
  await waitTour((s) => s.phase === "active" && s.gateKind === "fogStride", 12000, "§6 stride gate 2");
  await dragMinimap(10, 40, 62, 80);
  await waitTour((s) => s.phase === "active" && s.stepIndex === 2, 10000, "§6 stride release 2");
  await page.keyboard.press("Space");
  const g3 = await waitTour((s) => s.phase === "active" && s.gateKind === "fogRun", 15000, "§6 fogRun gate 2");
  check("§6 flow-1 gate armed on page 16", g3?.stepIndex === 3 && g3?.gate === true, JSON.stringify(g3));
  await dragMinimap(10, 40, 62, 80); // a level-2 stride
  await sleep(900);
  const gStride = await tourState();
  check(
    "§6 a stride alone does not release either (the run is not finished)",
    gStride?.stepIndex === 3 && gStride?.gate === true,
    JSON.stringify(gStride),
  );
  await page.click("#fog-finish");
  const g4 = await waitTour((s) => s.phase === "active" && s.stepIndex === 4, 20000, "§6 fogRun release");
  check("§6 stride + Finish releases the fogRun gate (→ the reveal sentence)", g4?.stepIndex === 4 && g4?.gate === false, JSON.stringify(g4));
  const scored = await page.evaluate(() =>
    (document.querySelector("#fog-scorecard-body")?.textContent ?? "").replace(/\s+/g, " "),
  );
  check(
    "§6 the guided reveal grades a REAL run (no 'no run' row)",
    scored.includes("you") && !scored.includes("no run"),
    JSON.stringify(scored.slice(0, 140)),
  );
  await page.keyboard.press("Escape");
  const gEsc = await waitTour((s) => !s.running, 5000, "§6 esc (flow 1)");
  check("§6 Esc exits flow 1 cleanly", gEsc?.running === false, JSON.stringify(gEsc));
  await checkCleanExit("§6 flow-1 end");
  await waitIdle();

  // Flow 3 — the LEVEL-1 mirror (U3-FOGFINISH-STUCK / TOURUX-S6-L1-STRIDE-
  // GATE-FINISHED-RUN-LOCK): a bare Finish AT the fogStride gate with zero
  // strides ends the run (done=true — the compass goes read-only and the
  // Finish button hides), so the demanded stride would be impossible and
  // the gate must release on the finished run instead of soft-locking over
  // the revealed landscape.
  await page.goto(`${base}/?step=15`, { waitUntil: "load" });
  await sleep(1500);
  if (!(await waitIdle())) check("§6 entry unlocks (flow 3)", false, "still locked");
  await page.locator('#tour-entry').click();
  await waitTour((s) => s.running && s.phase === "active", 12000, "§6 start 3");
  await page.keyboard.press("Space"); // → the level-1 fogStride gate
  await waitTour((s) => s.phase === "active" && s.gateKind === "fogStride", 12000, "§6 stride gate 3");
  await page.click("#fog-finish"); // bare Finish, zero level-1 strides
  const e2 = await waitTour((s) => s.phase === "active" && s.stepIndex === 2, 12000, "§6 L1 bare-Finish release");
  check(
    "TOURUX-S6-L1: bare Finish at the stride gate releases it (no soft-lock)",
    e2?.stepIndex === 2 && e2?.gate === false,
    JSON.stringify(e2),
  );
  await page.keyboard.press("Escape");
  const eEsc = await waitTour((s) => !s.running, 5000, "§6 esc (flow 3)");
  check("§6 Esc exits flow 3 cleanly", eEsc?.running === false, JSON.stringify(eEsc));
  await checkCleanExit("§6 flow-3 end");
  await waitIdle();

  // Flow 4 — the same fix under the FROZEN-SNAPSHOT shape (variant F):
  // strides drawn at a PRE-gate sentence, then Finish BEFORE the gate arms.
  // The gate's fogUsed snapshot freezes at the already-finished run, so
  // only the fogDone clause can release it.
  await page.goto(`${base}/?step=15`, { waitUntil: "load" });
  await sleep(1500);
  if (!(await waitIdle())) check("§6 entry unlocks (flow 4)", false, "still locked");
  await page.locator('#tour-entry').click();
  await waitTour((s) => s.running && s.phase === "active", 12000, "§6 start 4");
  await dragMinimap(10, 40, 62, 80); // strides at the pre-gate needle sentence
  await sleep(1300);
  await page.click("#fog-finish"); // Finish BEFORE the gate ever arms
  await sleep(2200); // the reveal tween drains so the reader can rest
  await page.keyboard.press("Space"); // → the fogStride gate arms post-finish
  const v4 = await waitTour((s) => s.phase === "active" && s.stepIndex === 2 && s.gate === false, 12000, "§6 L1 frozen-snapshot release");
  check(
    "TOURUX-S6-L1: strides-then-Finish before the gate still releases it (frozen snapshot)",
    v4?.stepIndex === 2 && v4?.gate === false,
    JSON.stringify(v4),
  );
  await page.keyboard.press("Escape");
  const vEsc = await waitTour((s) => !s.running, 5000, "§6 esc (flow 4)");
  check("§6 Esc exits flow 4 cleanly", vEsc?.running === false, JSON.stringify(vEsc));
  await checkCleanExit("§6 flow-4 end");
  await waitIdle();
}

/* ---------------- 5c. FIX-4b: start() begins WHERE YOU ARE ----------------
 *
 * Supersedes the old U4-START-TRAVEL pin (which demanded the playlist head
 * + a backward page travel): FIX-4b seeds the playlist at the FIRST
 * curated step on or after the parked page, so launching from the second
 * half of a section begins THERE and runs forward — the reader NEVER
 * scrolls up. Two pins: ?step=16 (fog-b) starts at "4 / 6" with the
 * fogRun gate armed, ?step=17 (fog-c) starts at "5 / 6" gate-free — both
 * with the scroll target unchanged by the chip click.
 */
{
  const midStart = async (stepIdx, wantIdx, wantGate) => {
    await page.goto(`${base}/?step=${stepIdx}`, { waitUntil: "load" });
    await sleep(1500);
    if (!(await waitIdle())) check(`FIX-4b: ?step=${stepIdx} entry unlocks`, false, "still locked");
    const before = await appState();
    const scrollBefore = await page.evaluate(() => window.__wp1.scroll());
    await page.locator("#tour-entry").click();
    const t = await waitTour(
      (s) => s.running && s.phase === "active" && s.stepIndex === wantIdx,
      15000,
      `FIX-4b start ?step=${stepIdx}`,
    );
    const a = await appState();
    const scrollAfter = await page.evaluate(() => window.__wp1.scroll());
    const problems = [];
    if (t?.id !== "s6" || t?.stepIndex !== wantIdx) problems.push(`tour=${JSON.stringify(t)}`);
    if (a.step !== stepIdx || a.scene !== before.scene) problems.push(`app moved: ${JSON.stringify(a)}`);
    if (t?.page !== stepIdx) problems.push(`tour page=${t?.page}`);
    if (t?.gate !== wantGate) problems.push(`gate=${t?.gate} want ${wantGate}`);
    if (scrollAfter.target !== scrollBefore.target) {
      problems.push(`scroll target moved ${scrollBefore.target} → ${scrollAfter.target}`);
    }
    check(
      `FIX-4b: ?step=${stepIdx} starts the tour AT the parked step (${wantIdx + 1} / 6) with NO upward travel`,
      problems.length === 0,
      problems.join("; "),
    );
    const bar = await barState();
    check(
      `FIX-4b: ?step=${stepIdx} counter reads ${wantIdx + 1} / 6`,
      bar.count === `${wantIdx + 1} / 6`,
      JSON.stringify(bar),
    );
    await page.keyboard.press("Escape");
    const dead = await waitTour((s) => !s.running, 5000, `FIX-4b esc ?step=${stepIdx}`);
    check(`FIX-4b: Esc exits clean (?step=${stepIdx})`, dead?.running === false, JSON.stringify(dead));
    await checkCleanExit(`FIX-4b end ?step=${stepIdx}`);
    await waitIdle();
  };
  await midStart(16, 3, true); // fog-b: the fogRun gate arms on arrival
  await midStart(17, 4, false); // fog-c: the gold-marker sentence, no gate
}

/* ---------------- 5d. FIX-4 round: the §2 compass draws NO custom purple --
 *
 * The user session found a "stray purple arrow" on the gd-b compass. Root
 * cause: the NEEDLE wore exactly the §8 custom-rule purple #9A72AC, so the
 * compass (needle + white user arrow + red GD step) read as having a third
 * arrow nobody placed. FIX-4 recolors the needle lavender (#C9A6DD;
 * spotlight #EBD9F7) — purple stays exclusive to §8's rule. The regression
 * scan counts EXACT-color pixels on #minimap-canvas, before and after a
 * committed draw:
 *   • custom-rule purple #9A72AC ±12 → ZERO pixels, always (was ~40-77);
 *   • needle lavender #C9A6DD ±12 → present before AND after the draw;
 *   • after a committed draw: GD red #FC6255 ±12 and the white arrow are
 *     present — the three-arrow instrument set and nothing else.
 */
{
  await page.goto(`${base}/?step=5`, { waitUntil: "load" });
  await sleep(1600);
  if (!(await waitIdle())) check("FIX-4d: ?step=5 entry unlocks", false, "still locked");

  const scanMinimap = () =>
    page.evaluate(() => {
      const cv = document.querySelector("#minimap-canvas");
      if (!cv) return { error: "no minimap canvas" };
      const g = cv.getContext("2d");
      const W = cv.width;
      const H = cv.height;
      const img = g.getImageData(0, 0, W, H).data;
      const count = (r, gg, b, tol) => {
        let n = 0;
        for (let k = 0; k < W * H * 4; k += 4) {
          if (
            img[k] >= r - tol && img[k] <= r + tol &&
            img[k + 1] >= gg - tol && img[k + 1] <= gg + tol &&
            img[k + 2] >= b - tol && img[k + 2] <= b + tol &&
            img[k + 3] > 60
          ) {
            n += 1;
          }
        }
        return n;
      };
      return {
        W,
        H,
        customPurple: count(154, 114, 172, 12),
        needleLavender: count(201, 166, 221, 12),
        gdRed: count(252, 98, 85, 12),
        whiteArrow: count(250, 250, 250, 10),
      };
    });

  const before = await scanMinimap();
  check(
    "FIX-4d: gd-b compass at rest draws NO custom-rule purple (the needle's old hex)",
    before.customPurple === 0,
    JSON.stringify(before),
  );
  check(
    "FIX-4d: the needle draws in lavender at rest",
    before.needleLavender >= 4,
    JSON.stringify(before),
  );

  // A committed draw (the same gesture the §2 gate teaches).
  const box = await page.locator("#minimap-canvas").boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx + 10, cy + 40);
  await page.mouse.down();
  await page.mouse.move(cx + 62, cy + 80, { steps: 8 });
  await page.mouse.up();
  await sleep(1400); // the GD step grow animation drains
  await waitIdle();

  const after = await scanMinimap();
  check(
    "FIX-4d: after a committed draw the compass STILL draws no custom-rule purple",
    after.customPurple === 0,
    JSON.stringify(after),
  );
  check(
    "FIX-4d: the drawn set is white arrow + red step + lavender needle",
    after.gdRed >= 3 && after.whiteArrow >= 30 && after.needleLavender >= 4,
    JSON.stringify(after),
  );
  await page.screenshot({ path: resolve(outDir, "37-minimap-gdb-arrows.png") });
  await waitIdle();
}

/* ---------------- 6. §7 — the tilt-steering gate ---------------- */

await page.goto(`${base}/?step=18`, { waitUntil: "load" });
await sleep(1600);
if (!(await waitIdle())) check("§7 entry unlocks", false, "still locked");
{
  await page.locator('#tour-entry').click();
  const s0 = await waitTour((s) => s.phase === "active" && s.stepIndex === 0, 12000, "§7 start");
  check("§7 tour starts on the steering gate", s0?.id === "s7" && s0?.count === 7 && s0?.gateKind === "tiltSteered", JSON.stringify(s0));
  const m0 = await markedSentence();
  check("§7 steering sentence marked", m0.text.includes("tilt it"), JSON.stringify(m0));
  await sleep(FADE_SETTLE_MS); // C3-CAP-TIMING: let the dim/overlay fades settle
  await page.screenshot({ path: resolve(outDir, "34-tour-s7-gate.png") });

  // Steer (the tilt keys reach the game — the tour leaves them alone).
  await page.keyboard.down("a");
  await sleep(300);
  await page.keyboard.up("a");
  const s1 = await waitTour((s) => s.phase === "active" && s.stepIndex === 1, 12000, "§7 release");
  check("§7 steering releases the gate", s1?.stepIndex === 1 && s1?.gate === false, JSON.stringify(s1));

  // Walk to the swarm sentence (step 5/7): the tilt-panel beat, the
  // Rosenbrock beat, the ghost sentence (page 20 — NO gate since
  // REG-1-GHOST-NO-GATE), then the swarm page.
  await page.locator("#tour-next").click();
  const s2 = await waitTour((s) => s.phase === "active" && s.stepIndex === 2, 15000, "§7 next 1");
  check("§7 Next → the Rosenbrock beat (points at the level pills — U5-POINT-LEVELS)", s2?.stepIndex === 2 && s2?.lookKey === "tilt-levels", JSON.stringify(s2));
  await page.locator("#tour-next").click();
  const s3 = await waitTour((s) => s.phase === "active" && s.stepIndex === 3, 15000, "§7 ghost sentence");
  check(
    "REG-1: the tilt-b ghost sentence carries NO gate (the ghost press is not an advance trigger)",
    s3?.stepIndex === 3 && s3?.gate === false && s3?.gateKind === null && s3?.lookKey === "tilt-replay" && s3?.page === 20,
    JSON.stringify(s3),
  );

  // REG-1 (user regression): clicking ▶ ghost must replay/scrub the ghost
  // AND NOTHING ELSE — the reader stays parked on tilt-b and the tour state
  // is untouched. (Pre-fix, the ghostReplay gate released on the press and
  // gotoStep teleported the reader to the swarm page mid-sentence.)
  const r1Before = await appState();
  await page.click("#tilt-replay-play");
  await sleep(800); // ≥5 gate polls — any residual release reaction would land here
  const r1After = await appState();
  const r1Tour = await tourState();
  const r1Ghost = await page.evaluate(() => window.__wp1?.tilt?.()?.scrubPlaying ?? null);
  check(
    "REG-1: clicking ▶ ghost keeps the reader parked on tilt-b (step 20)",
    r1Before.step === 20 && r1After.step === 20 && r1After.locked === false,
    `before=${JSON.stringify({ step: r1Before.step, locked: r1Before.locked })} after=${JSON.stringify({ step: r1After.step, locked: r1After.locked, animating: r1After.animating })}`,
  );
  check(
    "REG-1: clicking ▶ ghost leaves the tour state untouched (still 4/7, sentence on)",
    r1Tour?.stepIndex === 3 && r1Tour?.running === true && r1Tour?.gate === false,
    JSON.stringify(r1Tour),
  );
  check("REG-1: the ghost ride itself started (scrubPlaying)", r1Ghost === true, `scrubPlaying=${r1Ghost}`);

  await page.locator("#tour-next").click();
  const s4 = await waitTour((s) => s.phase === "active" && s.stepIndex === 4, 25000, "§7 swarm page");
  check(
    "TOURUX-S7: the swarm sentence points at the ENSEMBLE (not the absent ball)",
    s4?.stepIndex === 4 && s4?.lookKey === "swarm-ensemble" && s4?.page === 21,
    JSON.stringify(s4),
  );
  await sleep(650); // the dim fade settles before reading the look state
  const lSwarm = await lookState();
  check(
    "TOURUX-S7: the ensemble spotlight is LIVE (ring + scene dim, ensemble label)",
    lSwarm?.active === true && lSwarm?.ring === true && lSwarm?.sceneDim === true &&
      lSwarm?.label === "the hundred-ball ensemble",
    JSON.stringify(lSwarm),
  );
  const ovSwarm = await page.evaluate(() => ({
    on: document.querySelector("#tour-overlay")?.dataset.on,
    d: document.querySelector("#tour-lead")?.getAttribute("d") ?? "",
  }));
  check(
    "TOURUX-S7: the leader overlay draws for the swarm sentence (was dark pre-fix)",
    ovSwarm.on === "true" && ovSwarm.d.startsWith("M"),
    JSON.stringify(ovSwarm).slice(0, 120),
  );
  await page.screenshot({ path: resolve(outDir, "35-tour-s7-swarm-look.png") });

  // Back off the swarm page (→ the gate-free ghost sentence), then Esc exits clean.
  await page.locator("#tour-back").click();
  const sBack = await waitTour((s) => s.phase === "active" && s.stepIndex === 3, 15000, "§7 back");
  check("§7 Back leaves the swarm page (the gate-free ghost sentence)", sBack?.stepIndex === 3, JSON.stringify(sBack));
  await page.keyboard.press("Escape");
  const dead = await waitTour((s) => !s.running, 4000, "§7 esc");
  check("§7 Esc exits the tour", dead?.running === false, JSON.stringify(dead));
  await checkCleanExit("§7 end");
  await waitIdle();
}

/* ---------------- 6b. §7 premature Finish at the steering gate (TOUR-TR-2) -- */

// A finished tilt run can never grow the counters the tiltSteered gate
// compares (wantsTiltKeys goes false once done — the physics tick and the
// steering keys freeze), so pressing "Finish run · score" while the gate is
// open used to dead-end it: the gate swallows Next/Space by design and the
// panel said "run finished — the tilt keys are off". The gate now also
// releases on the absolute tiltDone (the fogRun precedent: the gate defers
// to the game).
{
  await page.goto(`${base}/?step=18`, { waitUntil: "load" });
  await sleep(1600);
  if (!(await waitIdle())) check("§7 entry unlocks (TR-2 flow)", false, "still locked");
  await page.locator('#tour-entry').click();
  const t0 = await waitTour((s) => s.phase === "active" && s.gate && s.gateKind === "tiltSteered", 12000, "TR-2 gate");
  check("TR-2: steering gate armed (step 1/7)", t0?.stepIndex === 0 && t0?.gate === true, JSON.stringify(t0));
  await page.click("#tilt-finish"); // premature Finish, zero steering input
  const t1 = await waitTour((s) => s.phase === "active" && s.stepIndex === 1 && s.gate === false, 6000, "TR-2 release");
  check(
    "TOUR-TR-2: premature Finish releases the steering gate (no dead-end)",
    t1?.stepIndex === 1 && t1?.gate === false,
    JSON.stringify(t1),
  );
  await page.keyboard.press("Escape");
  const tEsc = await waitTour((s) => !s.running, 5000, "TR-2 esc");
  check("TR-2: Esc exits clean", tEsc?.running === false, JSON.stringify(tEsc));
  await checkCleanExit("TR-2 end");
  await waitIdle();
}

/* ---------------- 7. §4 / §5 / §8 / §9 smoke: start → Esc ---------------- */

for (const [stepIdx, id, count] of [[11, "s4", 3], [13, "s5", 4], [22, "s8", 5], [24, "s9", 6]]) {
  await page.goto(`${base}/?step=${stepIdx}`, { waitUntil: "load" });
  await sleep(1500);
  if (!(await waitIdle())) check(`§ start unlocks (?step=${stepIdx})`, false, "still locked");
  await page.locator('#tour-entry').click();
  const s = await waitTour((x) => x.running && x.phase === "active", 12000, `${id} start`);
  const m = await markedSentence();
  const bar = await barState();
  check(
    `${id}: tour starts, sentence marked, controller on`,
    s?.id === id && s?.count === count && m.count === 1 && bar.on === "true",
    `tour=${JSON.stringify(s)} marked=${JSON.stringify(m)} bar=${JSON.stringify(bar)}`,
  );
  if (id === "s8") {
    // The labrule verdict paragraphs were EMPTY at boot (the benchmark
    // writes them once it runs): the late-fill observer must have segmented
    // them by now — every paragraph WITH text carries sentence spans.
    const late = await page.evaluate(() => {
      const bad = [];
      for (const [k, step] of [...document.querySelectorAll("#reader-body .rstep")].entries()) {
        if (step.dataset.scene !== "labrule") continue;
        for (const [pi, p] of [...step.querySelectorAll(".step__body > p")].entries()) {
          if ((p.textContent ?? "").trim() !== "" && p.querySelectorAll("span.sent").length === 0) {
            bad.push(`p${k}.${pi}`);
          }
        }
      }
      return bad;
    });
    check("s8: late-filling verdict paragraphs segmented once the benchmark writes them", late.length === 0, JSON.stringify(late));
  }
  await page.keyboard.press("Escape");
  const dead = await waitTour((x) => !x.running, 4000, `${id} esc`);
  check(`${id}: Esc exits clean`, dead?.running === false, JSON.stringify(dead));
  await checkCleanExit(`${id} end`);
  await waitIdle();
}

/* ---------------- 8. cleanliness after every flow ---------------- */

{
  const stray = await page.evaluate(() => ({
    active: document.querySelectorAll("[data-tour-active]").length,
    dim: document.querySelectorAll("[data-tour-dim]").length,
    keep: document.querySelectorAll(".tour-keep").length,
    hover: document.querySelectorAll("[data-slook-hover]").length,
  }));
  check("no stray tour/sentence attributes anywhere", stray.active === 0 && stray.dim === 0 && stray.keep === 0 && stray.hover === 0, JSON.stringify(stray));
}

/* ---------------- screenshot size sanity ---------------- */

for (const f of ["30-tour-s1-gate.png", "32-tour-s2-gdstep.png", "34-tour-s7-gate.png"]) {
  const kb = statSync(resolve(outDir, f)).size / 1024;
  check(`capture ${f}`, kb > 30, `${kb.toFixed(1)} KB`);
}

await browser.close();
console.log(failures === 0 ? "ALL_PASS" : `FAILURES: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
