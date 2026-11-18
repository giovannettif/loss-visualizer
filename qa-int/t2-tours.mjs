/**
 * qa-int/t2-tours.mjs — guided-tour regression (interaction lens) on
 * sections 1 (task), 2 (GD), 6 (fog game), driven END-TO-END with REAL input:
 * chip click, Next/Back/Esc clicks, Space keys, real inset/compass/slider
 * drags, real Finish + Replay button presses. State via __wp1 (read-only).
 *
 * Waits: every navigation waits for phase==="active" AT the expected playlist
 * index (the engine flips idx immediately and only marks/activates once the
 * reader travel settles — clicking mid-travel is a Skip, not an advance).
 */
import { chromium } from "playwright";
import { launchGL } from "../tools/gl-launch.mjs";
import {
  check, finish, sleep, appState, waitIdle, waitFor, shot, wheelFling,
} from "./h.mjs";

const BASE = process.argv[2] ?? "http://localhost:4184";
const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE:", m.text()); });

const st = () => appState(page);
const tour = () => page.evaluate(() => window.__wp1?.tour?.() ?? null);
const look = () => page.evaluate(() => window.__wp1?.look?.() ?? null);

async function tourUi() {
  return page.evaluate(() => {
    const bar = document.querySelector("#tour-bar");
    const marked = [...document.querySelectorAll("[data-tour-active]")].map(
      (el) => (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 60),
    );
    return {
      on: bar?.dataset.on ?? null,
      min: bar?.dataset.min ?? null,
      count: document.querySelector("#tour-count")?.textContent ?? null,
      gate: document.querySelector("#tour-gate-chip")?.dataset.on ?? null,
      gateLabel: document.querySelector("#tour-gate-chip")?.textContent?.trim() ?? null,
      markedCount: marked.length,
      marked,
      dimBodies: document.querySelectorAll('[data-tour-dim="true"]').length,
    };
  });
}

/** Waits for the tour to be ACTIVATED (not traveling) at playlist index i. */
async function tourAt(i, maxMs = 20000, label = `playlist i=${i}`) {
  const t = await waitFor(page, async () => {
    const s = await tour();
    return s && s.phase === "active" && s.stepIndex === i ? s : null;
  }, { label, maxMs });
  return t;
}

/** Clicks Next (or presses Space) and waits for activation at i+1. */
async function nextTo(i, { viaSpace = false } = {}) {
  if (viaSpace) await page.keyboard.press("Space");
  else await page.click("#tour-next");
  const t = await tourAt(i, 20000, `advance -> i=${i}`);
  await waitIdle(page);
  return t;
}

async function cleanExit(label, expectedPage) {
  const t = await waitFor(page, async () => ((await tour())?.running === false ? await tour() : null),
    { label: `${label} clean exit`, maxMs: 10000 });
  const ui = await tourUi();
  const a = await st();
  check(`${label}: tour ends CLEAN (no marked sentence, no dim, controller off, no artifacts)`,
    !!t && t.running === false && ui.markedCount === 0 && ui.dimBodies === 0 &&
    ui.on === "false" &&
    (expectedPage === undefined || a?.step === expectedPage),
    JSON.stringify({ running: t?.running, ui: { on: ui.on, marked: ui.markedCount, dim: ui.dimBodies }, step: a?.step }));
}

function activeChip(tourId) {
  return page.locator(`.rstep[data-active="true"] .tour-launch[data-tour="${tourId}"]`);
}

/* ============ §1 · the task (?step=1) ============ */
await page.goto(BASE + "/?step=1", { waitUntil: "load" });
await page.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
await waitIdle(page);
let a = await st();
check("§1 boots parked on page 1 (task-a)", a?.step === 1 && !a.locked, `step=${a?.step}`);

// start the tour by clicking the section's chip (real click)
await activeChip("s1").click();
let t0 = await tourAt(0, 20000, "s1 start");
let ui = await tourUi();
check("§1 chip click starts the tour: controller on, 1/4, gate chip shown (fitMoved)",
  !!t0 && t0.id === "s1" && t0.stepIndex === 0 && t0.count === 4 && t0.gate === true &&
  ui.on === "true" && ui.count === "1 / 4",
  JSON.stringify({ t: { id: t0?.id, i: t0?.stepIndex, n: t0?.count, gate: t0?.gate, kind: t0?.gateKind }, ui: { on: ui.on, count: ui.count, gate: ui.gate, gateLabel: ui.gateLabel } }));
check("§1 sentence precision: exactly ONE sentence bright, siblings dimmed",
  ui.markedCount === 1 && ui.dimBodies === 1 && ui.marked[0].includes("Drag the line"),
  JSON.stringify(ui.marked));
const lk = await look();
check("§1 spotlight on: the look overlay is live for fit-inset (panel spotted)",
  lk?.id === "fit-inset" && lk.active === true,
  JSON.stringify(lk));
await shot(page, "t2-s1-start.png");

// during a gate: Space is swallowed
await page.keyboard.press("Space");
await sleep(300);
{
  const t = await tour();
  check("§1 gate: Space is swallowed (playlist and reader both hold)",
    t?.stepIndex === 0 && t.gate === true && (await st()).step === 1,
    `i=${t?.stepIndex} gate=${t?.gate} step=${(await st()).step}`);
}

// release the gate with a REAL drag of the inset line body (b changes)
{
  const fit = await page.evaluate(() => window.__wp1.fit());
  const box = await page.locator("#fit-canvas").boundingBox();
  const M = { l: 30, r: 12, t: 10, b: 22 };
  const X0 = -4.2, X1 = 4.6, Y0 = -2.1, Y1 = 5.7;
  const px = (x) => box.x + M.l + ((x - X0) / (X1 - X0)) * (box.width - M.l - M.r);
  const py = (y) => box.y + box.height - M.b - ((y - Y0) / (Y1 - Y0)) * (box.height - M.t - M.b);
  const mx = px(0.2);
  const my = py(fit.w * 0.2 + fit.b);
  await page.mouse.move(mx, my);
  await page.mouse.down();
  await page.mouse.move(mx, my + 34, { steps: 6 });
  await page.mouse.up();
}
const t1 = await tourAt(1, 20000, "s1 gate release -> i=1");
check("§1 gate releases on a real inset drag (playlist auto-advances)",
  !!t1 && t1.gate === false, `i=${t1?.stepIndex} gate=${t1?.gate}`);

// Next crosses the page boundary to the needle sentence
const t2 = await nextTo(2);
ui = await tourUi();
check("§1 Next crosses the page boundary: reader parks on page 2, 'purple needle' marked",
  !!t2 && (await st()).step === 2 && ui.marked[0]?.includes("purple needle"),
  `step=${(await st()).step} marked=${JSON.stringify(ui.marked)}`);
// Back reverses across the boundary instantly
await page.click("#tour-back");
const t1b = await tourAt(1, 20000, "s1 back -> i=1");
check("§1 Back reverses one sentence (back across the page boundary)",
  !!t1b && (await st()).step === 1, `i=${t1b?.stepIndex} step=${(await st()).step}`);
// Space walks too — but a bar button holds focus after its click, and the
// engine DELIBERATELY gives bar buttons native Space (TOUR-INT-1): blur first.
await page.evaluate(() => document.activeElement?.blur?.());
const t2b = await nextTo(2, { viaSpace: true });
check("§1 Space = Next for a tour step (walks to the needle sentence again)",
  !!t2b && t2b.stepIndex === 2, `i=${t2b?.stepIndex}`);
const t3 = await nextTo(3);
check("§1 last step pauses on the white-point gate",
  !!t3 && t3.gate === true && t3.gateKind === "fitMoved" && (await st()).step === 3,
  `i=${t3?.stepIndex} gate=${t3?.gate}/${t3?.gateKind} step=${(await st()).step}`);

// release with a REAL drag of the white point on the 3D surface (≤26px grab).
// This gate is the LAST playlist step: the release completes the tour.
{
  const ball = await page.evaluate(() => window.__wp1.ballScreen());
  check("§1 white point is on screen to grab", !!ball, JSON.stringify(ball));
  if (ball) {
    await page.mouse.move(ball.x, ball.y);
    await page.mouse.down();
    await page.mouse.move(ball.x + 60, ball.y - 30, { steps: 8 });
    await page.mouse.up();
  }
}
const fitAfter = await page.evaluate(() => window.__wp1.fit());
check("§1 the white-point drag actually moved the fit",
  fitAfter.w !== 0.15, `fit=${JSON.stringify(fitAfter)}`);
await cleanExit("§1", 3);

// wheel stays master: restart on page 3, then wheel back into the section and out of it
await activeChip("s1").click();
const tr = await tourAt(0, 20000, "s1 restart from page 3");
a = await st();
check("§1 restart from a mid-section page travels the reader to the playlist head",
  !!tr && tr.stepIndex === 0 && a?.step === 1, `i=${tr?.stepIndex} step=${a?.step}`);
await wheelFling(page, { dy: 400, n: 6, gapMs: 20 }); // page 1 -> 2
await waitIdle(page);
{
  const t = await waitFor(page, async () => {
    const s = await tour();
    return s && s.phase === "active" && s.stepIndex === 2 ? s : null;
  }, { label: "s1 wheel-sync to page 2", maxMs: 10000 });
  a = await st();
  check("§1 wheel forward: the controller syncs to page 2's registered sentence",
    !!t && a?.step === 2, `i=${t?.stepIndex} step=${a?.step}`);
}
await wheelFling(page, { dy: 400, n: 6, gapMs: 20 }); // page 2 -> 3
await waitIdle(page);
{
  const t = await waitFor(page, async () => {
    const s = await tour();
    return s && s.phase === "active" && s.stepIndex === 3 ? s : null;
  }, { label: "s1 wheel-sync to page 3", maxMs: 10000 });
  check("§1 wheel forward again: syncs to page 3's sentence (still in-section)",
    !!t, `i=${t?.stepIndex}`);
}
await wheelFling(page, { dy: 400, n: 6, gapMs: 20 }); // page 3 -> 4 = past the section
await waitIdle(page);
{
  const t = await waitFor(page, async () => ((await tour())?.running === false ? await tour() : null),
    { label: "s1 wheel exit", maxMs: 10000 });
  a = await st();
  check("§1 wheeling past the section's last page EXITS the tour (reader stays master)",
    !!t && a?.step === 4, `running=${t?.running} step=${a?.step}`);
}
ui = await tourUi();
check("§1 no stray tour attributes after the wheel exit",
  ui.markedCount === 0 && ui.dimBodies === 0 && ui.on === "false", JSON.stringify({ on: ui.on }));

// Esc exits locally, reader unchanged
await page.locator("#rail button").nth(1).click();
await waitIdle(page);
await activeChip("s1").click();
await tourAt(0, 20000, "s1 esc start");
await page.keyboard.press("Escape");
{
  const t = await waitFor(page, async () => ((await tour())?.running === false ? await tour() : null),
    { label: "s1 esc exit", maxMs: 8000 });
  a = await st();
  check("§1 Esc exits the tour locally, the reader page unchanged",
    !!t && a?.step === 1, `step=${a?.step}`);
}

// minimize <-> restore
await activeChip("s1").click();
await tourAt(0, 20000, "s1 min start");
await page.click("#tour-min");
await sleep(250);
ui = await tourUi();
check("§1 minimize collapses the controller to the chip", ui.min === "true", `min=${ui.min}`);
await page.click("#tour-bar-chip");
await sleep(250);
ui = await tourUi();
check("§1 clicking the chip restores the controller",
  ui.min === "false" && ui.on === "true", `min=${ui.min} on=${ui.on}`);
await page.keyboard.press("Escape");

/* ============ §2 · gradient descent (?step=4) ============ */
await page.goto(BASE + "/?step=4", { waitUntil: "load" });
await page.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
await waitIdle(page);
await activeChip("s2").click();
const s20 = await tourAt(0, 20000, "s2 start");
check("§2 tour starts at the needle sentence (1/5, no gate)",
  !!s20 && s20.id === "s2" && s20.stepIndex === 0 && s20.count === 5 && s20.gate === false,
  `i=${s20?.stepIndex} n=${s20?.count} gate=${s20?.gate}`);

// Space walks the sentences (Space = Next inside a tour)
const s21 = await nextTo(1, { viaSpace: true });
check("§2 Space advances into the compass-draw gate (page 5, gd-b)",
  !!s21 && s21.gate === true && s21.gateKind === "arrowDrawn" && (await st()).step === 5,
  `i=${s21?.stepIndex} gate=${s21?.gate} step=${(await st()).step}`);
// gate swallows Space
await page.keyboard.press("Space");
await sleep(250);
{
  const t = await tour();
  check("§2 gate swallows Space", t?.stepIndex === 1 && t.gate === true, `i=${t?.stepIndex}`);
}
// real compass drag commits the arrow
{
  const box = await page.locator("#minimap-canvas").boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx + 10, cy + 40);
  await page.mouse.down();
  await page.mouse.move(cx + 62, cy + 80, { steps: 8 });
  await page.mouse.up();
}
// the release auto-advances to the SAME page's next sentence (i=2)
const s22 = await tourAt(2, 15000, "s2 draw release -> i=2");
const gd = await page.evaluate(() => window.__wp1.gd());
check("§2 real compass drag commits the arrow and releases the gate (auto-advance)",
  !!s22 && gd.userTip !== null, `i=${s22?.stepIndex} userTip=${JSON.stringify(gd.userTip)}`);
await shot(page, "t2-s2-draw.png");

const s23 = await nextTo(3);
check("§2 Next lands on the eta gate (page 6, gd-c)",
  !!s23 && s23.gate === true && s23.gateKind === "etaMoved" && (await st()).step === 6,
  `i=${s23?.stepIndex} gate=${s23?.gate} step=${(await st()).step}`);
// real slider drag (mouse down at 30% -> 65% of the track)
{
  const box = await page.locator("#eta-slider").boundingBox();
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.3, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.65, y, { steps: 6 });
  await page.mouse.up();
}
// the release auto-advances to i=4 (the last sentence)
const s24 = await tourAt(4, 15000, "s2 eta release -> i=4");
const eta = await page.evaluate(() => window.__wp1.gd().eta);
check("§2 real slider drag releases the eta gate (auto-advance to the last sentence)",
  !!s24 && eta !== null && eta > 0.02, `i=${s24?.stepIndex} eta=${eta}`);
await page.click("#tour-next"); // Finish ▶ completes
await cleanExit("§2", 7);

/* ============ §6 · the fog game (?step=15) ============ */
await page.goto(BASE + "/?step=15", { waitUntil: "load" });
await page.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
await waitIdle(page);
await activeChip("s6").click();
const s60 = await tourAt(0, 20000, "s6 start");
check("§6 tour starts (1/6)", !!s60 && s60.id === "s6" && s60.stepIndex === 0 && s60.count === 6,
  `i=${s60?.stepIndex} n=${s60?.count}`);

const s61 = await nextTo(1);
{
  const fog = await page.evaluate(() => window.__wp1.fog());
  check("§6 stride gate armed on the level-1 fog board",
    !!s61 && s61.gate === true && s61.gateKind === "fogStride" && fog?.used === 0,
    `i=${s61?.stepIndex} gate=${s61?.gate} used=${fog?.used}`);
}
// real compass drag = one stride (measurement spent)
{
  const box = await page.locator("#minimap-canvas").boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx + 10, cy + 40);
  await page.mouse.down();
  await page.mouse.move(cx + 62, cy + 80, { steps: 8 });
  await page.mouse.up();
}
const s62 = await waitFor(page, async () => {
  const s = await tour();
  return s && s.phase === "active" && s.stepIndex === 2 ? s : null;
}, { label: "s6 stride releases gate -> i=2", maxMs: 15000 });
{
  const fog = await page.evaluate(() => window.__wp1.fog());
  check("§6 real compass drag spends a measurement and releases the stride gate",
    !!s62 && fog?.used === 1, `i=${s62?.stepIndex} used=${fog?.used}`);
}
await shot(page, "t2-s6-stride.png");

const s63 = await nextTo(3);
check("§6 level-2 fogRun gate armed (page 16)",
  !!s63 && s63.gate === true && s63.gateKind === "fogRun" && (await st()).step === 16,
  `i=${s63?.stepIndex} gate=${s63?.gate} step=${(await st()).step}`);
// the bare Finish must release (no soft-lock — TOURUX-S6)
await page.click("#fog-finish");
const s64 = await waitFor(page, async () => {
  const s = await tour();
  return s && s.phase === "active" && s.stepIndex === 4 ? s : null;
}, { label: "s6 bare finish releases -> i=4", maxMs: 20000 });
{
  const fog = await page.evaluate(() => window.__wp1.fog());
  const emptyLead = await page.evaluate(() => {
    const el = document.querySelector("#fog-empty-lead");
    return {
      hidden: el?.hidden ?? null,
      text: (el?.textContent ?? "").trim().replace(/\s+/g, " "),
      hasJump: !!document.querySelector("#fog-goto-l2"),
    };
  });
  check("§6 bare Finish with zero strides releases the gate into the no-run reveal (softened copy + jump button)",
    !!s64 && fog?.done === true && emptyLead.hidden === false && emptyLead.hasJump &&
    emptyLead.text.includes("no run of yours to replay"),
    `i=${s64?.stepIndex} done=${fog?.done} lead="${emptyLead.text.slice(0, 120)}"`);
}
await shot(page, "t2-s6-norun-reveal.png");

const s65 = await nextTo(5);
ui = await tourUi();
check("§6 the footer Replay gate arms; the reveal sentence resolved on the empty flavor",
  !!s65 && s65.stepIndex === 5 && s65.gate === true && s65.gateKind === "ghostReplay",
  `i=${s65?.stepIndex} gate=${s65?.gate}/${s65?.gateKind} marked=${JSON.stringify(ui.marked)}`);
// press Replay in the footer (real click) — this LAST gate's release
// completes the tour outright. §6's ghost race drives fogState.ghostsPlaying
// (the universal replayInfo object is not the fog replay's dial).
await page.click("#replay-btn");
const rep = await waitFor(page, async () => {
  const f = await page.evaluate(() => window.__wp1.fog());
  return f?.ghostsPlaying ? f : null;
}, { label: "s6 ghosts playing", maxMs: 10000 });
check("§6 footer Replay press re-runs the ghosts and releases the last gate",
  !!rep, `ghostsPlaying=${rep?.ghostsPlaying}`);
await shot(page, "t2-s6-ghosts.png");
await cleanExit("§6", 17);

await browser.close();
finish("T2-TOURS");
