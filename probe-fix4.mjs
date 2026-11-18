// probe-fix4 — MY OWN CDP drive verifying the three FIX-4 behaviors on the
// BUILT site (http://localhost:4173), independent of gate-tour.mjs:
//   (1) the §2 compass (gd-b, ?step=5) draws NO custom-rule purple before or
//       after a committed draw; the needle draws lavender; white + red
//       appear after the draw. (Also captures ?step=4 — the ask's literal
//       URL — which is gd-A: the compass without arrow drawing.)
//   (2) the tour entry is one fixed bottom-center chip with a per-section
//       label, hidden on the hero/intro; starting from mid-section
//       (?step=16, ?step=17) begins AT the parked step ("4 / 6", "5 / 6")
//       with NO upward travel.
//   (3) during an open gate: the Back button reverses + disarms, the Next
//       button politely skips, and ArrowUp (with the controller focused)
//       still reverses.
import { chromium } from "playwright";
import { launchGL } from "./tools/gl-launch.mjs";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const base = "http://localhost:4173";
mkdirSync("qa-fix4-shots", { recursive: true });

const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fails = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) fails += 1;
};

async function waitIdle(maxMs = 25000) {
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
const tour = () => page.evaluate(() => window.__wp1?.tour?.() ?? null);
const app = () =>
  page.evaluate(() => ({
    scene: window.__wp1?.scene?.(),
    step: window.__wp1?.step?.(),
    locked: window.__wp1?.locked?.(),
  }));
const scroll = () => page.evaluate(() => window.__wp1?.scroll?.() ?? null);
async function waitTour(pred, maxMs = 20000, label = "tour") {
  const t0 = Date.now();
  let t = null;
  for (;;) {
    t = await tour();
    if (t && pred(t)) return t;
    if (Date.now() - t0 > maxMs) {
      console.log(`  (timeout: ${label} — ${JSON.stringify(t)})`);
      return t;
    }
    await sleep(150);
  }
}

/* ---------------- (1) the §2 compass draws no custom purple ------------- */
{
  await page.goto(`${base}/?step=5`, { waitUntil: "load" });
  await sleep(1800);
  await waitIdle();

  const scan = () =>
    page.evaluate(() => {
      const cv = document.querySelector("#minimap-canvas");
      if (!cv) return { error: "no canvas" };
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
          ) n++;
        }
        return n;
      };
      return {
        customPurple: count(154, 114, 172, 12),
        needleLavender: count(201, 166, 221, 12),
        gdRed: count(252, 98, 85, 12),
        whiteArrow: count(250, 250, 250, 10),
      };
    });

  const before = await scan();
  check("(1) gd-b at rest: ZERO custom-rule purple pixels (the needle's old hex)", before.customPurple === 0, JSON.stringify(before));
  check("(1) gd-b at rest: the needle draws in lavender", before.needleLavender >= 4, JSON.stringify(before));

  const box = await page.locator("#minimap-canvas").boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx + 10, cy + 40);
  await page.mouse.down();
  await page.mouse.move(cx + 62, cy + 80, { steps: 8 });
  await page.mouse.up();
  await sleep(1400);
  await waitIdle();
  const gd = await page.evaluate(() => window.__wp1?.gd?.());
  check("(1) the draw committed (white tip + red GD tip live)", gd?.userTip !== null && gd?.gdTip !== null, JSON.stringify(gd));

  const after = await scan();
  check("(1) after a committed draw: STILL no custom-rule purple", after.customPurple === 0, JSON.stringify(after));
  check(
    "(1) after the draw: white arrow + red GD step + lavender needle, nothing else purple",
    after.gdRed >= 3 && after.whiteArrow >= 30 && after.needleLavender >= 4,
    JSON.stringify(after),
  );
  await page.screenshot({ path: resolve("qa-fix4-shots", "38-fix4-gdb-arrows.png") });

  // The ask's literal URL (?step=4) is gd-A — capture it too (needle only,
  // no draw instrument): same purple rule must hold.
  await page.goto(`${base}/?step=4`, { waitUntil: "load" });
  await sleep(1800);
  await waitIdle();
  const step4 = await scan();
  check("(1) ?step=4 (gd-a): no custom-rule purple either", step4.customPurple === 0, JSON.stringify(step4));
  await page.screenshot({ path: resolve("qa-fix4-shots", "39-fix4-gda.png") });
}

/* ---------------- (2) the fixed bottom-center entry + start-here -------- */
{
  const entry = () =>
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
        offCenter: Math.round(r.left + r.width / 2 - paneCx),
        bottomGap: Math.round(window.innerHeight - r.bottom),
      };
    });

  // Hero + intro hide it.
  await page.goto(`${base}/?step=0`, { waitUntil: "load" });
  await sleep(1500);
  const hero = await entry();
  check("(2) hero: entry absent/hidden", !hero.exists || hero.hidden === true, JSON.stringify(hero));
  await page.goto(`${base}/`, { waitUntil: "load" });
  await sleep(1800);
  const intro = await entry();
  check("(2) intro park: entry hidden", !intro.exists || intro.hidden === true, JSON.stringify(intro));

  // Parked on gd-b: fixed, bottom-center of the canvas pane, per-section label.
  await page.goto(`${base}/?step=5`, { waitUntil: "load" });
  await sleep(1500);
  await waitIdle();
  const e5 = await entry();
  check(
    "(2) gd-b: entry visible, fixed, bottom-center, 'Tour section 2'",
    e5.exists && !e5.hidden && e5.pos === "fixed" && Math.abs(e5.offCenter) <= 12 &&
      e5.bottomGap >= 8 && e5.bottomGap <= 28 && e5.tour === "s2" &&
      e5.label === "▶ Tour section 2",
    JSON.stringify(e5),
  );

  // Mid-section starts, no upward travel.
  const midStart = async (stepIdx, wantIdx) => {
    await page.goto(`${base}/?step=${stepIdx}`, { waitUntil: "load" });
    await sleep(1600);
    await waitIdle();
    const before = await app();
    const sc0 = await scroll();
    await page.locator("#tour-entry").click();
    const t = await waitTour((x) => x.running && x.phase === "active" && x.stepIndex === wantIdx, 20000, `start ?step=${stepIdx}`);
    const a = await app();
    const sc1 = await scroll();
    const ok =
      t?.id === "s6" && t?.stepIndex === wantIdx && t?.page === stepIdx &&
      a.step === stepIdx && a.scene === before.scene &&
      sc1.target === sc0.target;
    check(
      `(2) ?step=${stepIdx}: tour starts at step ${wantIdx + 1} / 6, reader stays parked (no upward travel)`,
      ok === true,
      `tour=${JSON.stringify({ id: t?.id, stepIndex: t?.stepIndex, page: t?.page })} scroll ${sc0.target}→${sc1.target}`,
    );
    await page.keyboard.press("Escape");
    await waitTour((x) => !x.running, 5000, "esc");
    await waitIdle();
  };
  await midStart(16, 3);
  await midStart(17, 4);
}

/* ---------------- (3) gate navigation: Back works, Next skips ----------- */
{
  await page.goto(`${base}/?step=4`, { waitUntil: "load" });
  await sleep(1600);
  await waitIdle();
  await page.locator("#tour-entry").click();
  const t0 = await waitTour((x) => x.running && x.phase === "active" && x.stepIndex === 0, 15000, "s2 start");
  check("(3) s2 tour starts on the needle sentence", t0?.id === "s2" && t0?.stepIndex === 0 && t0?.gate === false, JSON.stringify(t0));

  await page.keyboard.press("Space");
  const t1 = await waitTour((x) => x.stepIndex === 1 && x.gate === true, 15000, "arrow gate");
  check("(3) the compass-draw gate arms on gd-b", t1?.gate === true && t1?.gateKind === "arrowDrawn", JSON.stringify(t1));

  // Back DURING the gate: reverses + disarms, reader returns to gd-a, no
  // lock. Wait for the walk to reach REST at idx 0 (phase active) before
  // driving Next — nextNow ignores clicks mid-travel by design.
  await page.locator("#tour-back").click();
  const tBack = await waitTour((x) => x.phase === "active" && x.stepIndex === 0 && x.gate === false, 10000, "back during gate");
  const aBack = await app();
  check(
    "(3) Back during an open gate reverses + disarms (→ gd-a needle sentence, no lock)",
    tBack?.stepIndex === 0 && tBack?.gate === false && aBack.scene === "gd-a" && aBack.locked === false,
    `tour=${JSON.stringify(tBack)} app=${JSON.stringify(aBack)}`,
  );

  // Forward: the gate re-arms; ArrowUp with the controller focused (the
  // Next click just left focus there) must STILL reverse — the engine fix.
  await page.locator("#tour-next").click();
  const t2 = await waitTour((x) => x.stepIndex === 1 && x.gate === true, 15000, "gate re-arm");
  check("(3) the gate re-arms on fresh arrival", t2?.stepIndex === 1 && t2?.gate === true, JSON.stringify(t2));
  await page.keyboard.press("ArrowUp");
  const tUp = await waitTour((x) => x.phase === "active" && x.stepIndex === 0 && x.gate === false, 10000, "ArrowUp during gate");
  check(
    "(3) ArrowUp (controller focused) reverses + disarms too",
    tUp?.stepIndex === 0 && tUp?.gate === false,
    JSON.stringify(tUp),
  );

  // Next politely SKIPS the gate: forward to gd-b, Next with the gate open
  // → disarms and lands on the GD-step sentence.
  await page.locator("#tour-next").click();
  const t3 = await waitTour((x) => x.stepIndex === 1 && x.gate === true, 15000, "re-arm 2");
  check("(3) re-armed again", t3?.gate === true, JSON.stringify(t3));
  await page.locator("#tour-next").click();
  const tSkip = await waitTour((x) => x.stepIndex === 2 && x.gate === false, 10000, "Next skips");
  check(
    "(3) Next during an open gate politely skips it (→ GD's-step sentence, disarmed)",
    tSkip?.stepIndex === 2 && tSkip?.gate === false,
    JSON.stringify(tSkip),
  );

  await page.keyboard.press("Escape");
  await waitTour((x) => !x.running, 5000, "esc");
  const clean = await app();
  check("(3) Esc exits clean, no lock left", clean.locked === false, JSON.stringify(clean));
}

await page.screenshot({ path: resolve("qa-fix4-shots", "40-fix4-end.png") });
await browser.close();
console.log(fails === 0 ? "PROBE_ALL_PASS" : `PROBE_FAILURES: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
