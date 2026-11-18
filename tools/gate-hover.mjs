/**
 * gate-hover.mjs — hover-precision gate (flagship interaction, graduated to
 * sentences) over Playwright.
 *
 * For EVERY registered sentence (`.sent[data-slook]`, the TOURS table's look
 * keys) on the §1–§9 pages (1..26), with the reader parked on that page:
 *   1. A real (trusted) pointer hover highlights EXACTLY that sentence —
 *      one `[data-slook-hover]` in the document, and it is the target.
 *      The hover point is probed INSIDE the sentence's own inline boxes
 *      (elementFromPoint): a multi-line sentence's bounding-rect centre can
 *      land between lines or on a sibling sentence's line.
 *   2. If the sentence's registered target is LIVE on stage, the pointing
 *      overlay switches on and its arrowhead tip sits on the screen-space
 *      anchor `director.lookScreenPoint(key)` CLAMPED to the viewport (the
 *      tourEngine's 12px margins) — within 3px, computed live from
 *      `__wp1.lookPoint(key)`.
 *   3. If the target legitimately no-ops (e.g. "gd-step" before the reader
 *      has drawn — the S2A-GDSTEP-LOOK-PRECOMMIT guard), the overlay stays
 *      dark: hover highlights the sentence but NEVER invents a target.
 *   4. Unhover clears the highlight and the overlay.
 *   5. Clamp probe (§1's ball sentence): after dragging the camera so the
 *      ball's raw projection leaves the window, the arrowhead must sit ON
 *      the viewport boundary — the clamp is real, not vacuous.
 *
 * Usage: node tools/gate-hover.mjs [baseUrl]
 */

import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";

const base = process.argv[2] ?? "http://localhost:4173";
const VW = 1600;
const VH = 900;

const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: VW, height: VH } });
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

let failures = 0;
let checked = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wait for the reader to park + unlock (the v4 snap/lock). */
async function waitIdle() {
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

/** A viewport point genuinely inside the sentence's own inline boxes. */
async function hoverPointFor(el) {
  return el.evaluate((s) => {
    const rects = Array.from(s.getClientRects());
    const cands = [];
    for (const r of rects) {
      cands.push({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
      cands.push({ x: r.x + r.width * 0.3, y: r.y + r.height / 2 });
      cands.push({ x: r.x + r.width * 0.7, y: r.y + r.height / 2 });
    }
    for (const c of cands) {
      const hit = document.elementFromPoint(c.x, c.y);
      if (hit && hit.closest(".sent[data-slook]") === s) return { x: c.x, y: c.y };
    }
    return null;
  });
}

/** Hover one sentence with a trusted mouse move and read the hover state. */
async function hoverSentence(el) {
  const pt = await hoverPointFor(el);
  if (!pt) return null;
  // Identity marker: DOM nodes don't survive evaluate's serialization, so
  // the "exactly this sentence" check reads a marker attribute instead.
  await el.evaluate((s) => s.setAttribute("data-probe-hover", "1"));
  await page.mouse.move(pt.x, pt.y);
  await sleep(260); // the leader re-anchors on the engine's rAF schedule
  const st = await page.evaluate(() => {
    const lit = Array.from(document.querySelectorAll("[data-slook-hover]"));
    const raw = document.querySelector("#tour-arrow")?.getAttribute("points") ?? "";
    const pts = raw
      ? raw
          .trim()
          .split(/\s+/)
          .map((pair) => pair.split(",").map(Number))
      : null;
    return {
      litCount: lit.length,
      litIsTarget: lit.length === 1 && lit[0].getAttribute("data-probe-hover") === "1",
      litTags: lit.map((n) => (n.textContent ?? "").trim().slice(0, 32)),
      overlayOn: document.querySelector("#tour-overlay")?.dataset.on === "true",
      lookKey: window.__wp1.tour().lookKey,
      headTip: pts && pts.length > 0 ? { x: pts[0][0], y: pts[0][1] } : null,
    };
  });
  await el.evaluate((s) => s.removeAttribute("data-probe-hover"));
  return st;
}

/** Move the pointer off the reader text and verify the hover cleared. */
async function unhover() {
  const chip = await page.locator("#reader-chip").boundingBox();
  if (chip) {
    await page.mouse.move(chip.x + chip.width / 2, chip.y + chip.height / 2);
  } else {
    await page.mouse.move(8, 8);
  }
  await sleep(220);
  return page.evaluate(() => ({
    litCount: document.querySelectorAll("[data-slook-hover]").length,
    overlayOn: document.querySelector("#tour-overlay")?.dataset.on === "true",
    lookKey: window.__wp1.tour().lookKey,
  }));
}

/** The clamped expected anchor for a look key (tourEngine's 12px margins). */
function clamped(pt) {
  if (!pt) return null;
  return {
    x: Math.min(Math.max(pt.x, 12), VW - 12),
    y: Math.min(Math.max(pt.y, 12), VH - 12),
  };
}

// TOUR-HOVER-S7-GHOST-FLAVOR-DEAD: the sweep covers ALL nine sections —
// the §7/§6 flavor pages boot with their lead paragraphs swapped, and the
// boot-time data-slook stamp now lands on every flavor (main.ts), so the
// visible flavor's sentence must carry the wire and graduate here too.
const PAGES = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
  15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
]; // §1–§9

for (const step of PAGES) {
  await page.goto(`${base}/?step=${step}`, { waitUntil: "load" });
  await page.waitForTimeout(700);
  const idle = await waitIdle();
  const scene = await page.evaluate(() => window.__wp1.scene());
  check(
    `page ${step}: reader parked + unlocked`,
    idle && (await page.evaluate(() => window.__wp1.scroll().parked)),
    `scene=${scene} idle=${idle}`,
  );

  const sents = page.locator('.rstep[data-active="true"] .sent[data-slook]');
  const n = await sents.count();

  // A plain (unregistered) sentence must never highlight: hover its centre,
  // expect zero lit sentences and a dark overlay.
  {
    const plain = page.locator('.rstep[data-active="true"] .sent:not([data-slook])').first();
    if ((await plain.count()) > 0) {
      const pb = await plain.boundingBox();
      if (pb) {
        await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2);
        await sleep(220);
        const st = await page.evaluate(() => ({
          litCount: document.querySelectorAll("[data-slook-hover]").length,
          overlayOn: document.querySelector("#tour-overlay")?.dataset.on === "true",
        }));
        check(
          `page ${step}: unregistered sentence stays dark`,
          st.litCount === 0 && st.overlayOn === false,
          JSON.stringify(st),
        );
      }
    }
  }

  let hiddenStamps = 0;
  for (let i = 0; i < n; i++) {
    const el = sents.nth(i);
    const meta = await el.evaluate((s) => ({
      look: s.dataset.slook ?? "",
      text: (s.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 60),
      hidden: s.getClientRects().length === 0,
    }));
    // Flavor stamps (TOUR-HOVER-S7-GHOST-FLAVOR-DEAD) land on every flavor's
    // addressed span, including the paragraphs the director currently has
    // hidden — those match the locator yet cannot be hovered (no client
    // rects, nothing at any elementFromPoint). Skip them: the VISIBLE
    // flavor's span carries the same key and is the contract under test.
    if (meta.hidden) {
      hiddenStamps += 1;
      continue;
    }
    checked += 1;

    const st = await hoverSentence(el);
    const label = `p${step} s${i} "${meta.text}"`;
    if (!st) {
      check(`${label} — hoverable point found`, false, "no inline-box hit");
      continue;
    }

    // 1: exactly this sentence lights (regardless of target availability).
    check(
      `${label} — highlight is exactly this sentence`,
      st.litCount === 1 && st.litIsTarget,
      `litCount=${st.litCount} lit=${JSON.stringify(st.litTags)}`,
    );

    const raw = await page.evaluate((k) => window.__wp1.lookPoint(k), meta.look);
    if (raw === null) {
      // The registered target is not on stage at idle: the spotlight and
      // leader must stay dark — hover never invents a target. (The SVG's
      // last geometry may linger in the DOM; data-on="false" hides the
      // overlay wholesale, which is the visibility contract.)
      check(
        `${label} — absent target keeps the overlay dark (never invents)`,
        st.overlayOn === false,
        `look=${meta.look} overlayOn=${st.overlayOn}`,
      );
    } else {
      check(
        `${label} — pointing overlay on for the live target`,
        st.overlayOn === true && st.lookKey === meta.look,
        `overlayOn=${st.overlayOn} lookKey=${st.lookKey} want=${meta.look}`,
      );
      const want = clamped(raw);
      const d =
        want && st.headTip
          ? Math.hypot(st.headTip.x - want.x, st.headTip.y - want.y)
          : Infinity;
      check(
        `${label} — arrow tip on the clamped anchor (≤3px)`,
        d <= 3,
        `tip=${JSON.stringify(st.headTip)} want=${JSON.stringify(want)} raw=${JSON.stringify(raw)} d=${d.toFixed(1)}px`,
      );
    }

    // 4: unhover clears both.
    const off = await unhover();
    check(
      `${label} — unhover clears highlight + overlay`,
      off.litCount === 0 && off.overlayOn === false && off.lookKey === null,
      JSON.stringify(off),
    );
  }

  check(
    `page ${step}: registered sentences swept (hovered ≥1, hidden stamps ${hiddenStamps})`,
    n - hiddenStamps > 0,
    `count=${n} hovered=${n - hiddenStamps}`,
  );
}

check("hover: §1–§5 registered sentence floor (≥18)", checked >= 18, `checked=${checked}`);
// The §6–§9 extension (TOUR-HOVER-S7-GHOST-FLAVOR-DEAD): the full sweep
// covers every section's registered sentences — the floor locks the
// extension in (the §1–§5 rows alone peak at 21).
check("hover: §1–§9 full-sweep floor (≥30)", checked >= 30, `checked=${checked}`);

/* ---------------- clamp probe: the boundary is real ---------------- */

// Park on §1's ball sentence (page 3), then LEFT-DRAG the camera until the
// ball's raw projection leaves the window. The arrowhead must sit exactly
// on the 12px viewport boundary — clamped, not merely nearby.
await page.goto(`${base}/?step=3`, { waitUntil: "load" });
await page.waitForTimeout(700);
await waitIdle();

const ballSent = page.locator('.rstep[data-active="true"] .sent[data-slook="ball"]').first();
{
  const nb = await ballSent.count();
  check("clamp probe: the ball sentence is registered on page 3", nb === 1, `count=${nb}`);
}
{
  const pane = await page.evaluate(() => {
    const c = document.querySelector("#stage-wrap canvas");
    const r = c.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, left: r.x, top: r.y };
  });
  // Exile the ball's projection from the window. Pan alone can't (applyCamera
  // clamps it inside the pane — zero slack at fit zoom), orbit pivots near
  // the terrain centre, and a straight deep zoom only reaches ~5.5× (zoomMin
  // = 0.18·fit), not enough for a near-centre ball. The working sequence:
  // zoom in part-way (slack appears), PAN hard toward the top-left (the drag
  // starts bottom-right, well clear of the white point's ~26px grab), then
  // zoom to the floor — the magnified offset carries the ball out.
  const outOfWindow = (pt) =>
    pt === null || pt.x < 12 || pt.x > VW - 12 || pt.y < 12 || pt.y > VH - 12;
  const readRaw = () => page.evaluate(() => window.__wp1.lookPoint("ball"));
  const zoomPump = async (n) => {
    for (let i = 0; i < n; i++) {
      await page.mouse.move(pane.x, pane.y);
      await page.mouse.wheel(0, -600);
      await sleep(200);
    }
  };
  let raw = await readRaw();
  if (!outOfWindow(raw)) {
    await zoomPump(2);
    for (let k = 0; k < 2 && !outOfWindow(raw); k++) {
      await page.mouse.move(pane.left + 750, pane.top + 620);
      await page.mouse.down();
      await page.mouse.move(pane.left + 80, pane.top + 240, { steps: 6 });
      await page.mouse.up();
      await sleep(320);
      raw = await readRaw();
    }
  }
  for (let i = 0; i < 8 && !outOfWindow(raw); i++) {
    await zoomPump(1);
    raw = await readRaw();
  }
  check(
    "clamp probe: drove the ball's raw anchor off-window (zoom, then pan)",
    outOfWindow(raw),
    `raw=${JSON.stringify(raw)}`,
  );
  check(
    "clamp probe: panned the ball's raw anchor off-window",
    raw !== null && (raw.x < 12 || raw.x > VW - 12 || raw.y < 12 || raw.y > VH - 12),
    `raw=${JSON.stringify(raw)}`,
  );
  const st = await hoverSentence(ballSent);
  const want = clamped(raw);
  const onBoundary =
    st?.headTip &&
    Math.hypot(st.headTip.x - want.x, st.headTip.y - want.y) <= 3 &&
    (st.headTip.x <= 13 || st.headTip.x >= VW - 13 || st.headTip.y <= 13 || st.headTip.y >= VH - 13);
  check(
    "clamp probe: arrowhead pinned to the viewport boundary",
    onBoundary === true,
    `tip=${JSON.stringify(st?.headTip)} want=${JSON.stringify(want)}`,
  );
  await unhover();
}

await browser.close();
console.log(
  failures === 0
    ? `GATE_HOVER_OK (${checked} registered sentences)`
    : `GATE_HOVER_FAILED (${failures})`,
);
process.exit(failures === 0 ? 0 : 1);
