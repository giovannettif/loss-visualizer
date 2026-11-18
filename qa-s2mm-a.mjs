/**
 * qa-s2mm-a.mjs — QA probe A (scope: §2 minimap purity), independent of gate-tour.
 *
 * Claim under test: the §2 (GD intro) compass minimap draws ONLY
 *   • the lavender needle (#C9A6DD; spotlight variant #EBD9F7 + halo),
 *   • the white user arrow (draw/commit; the white learner point always),
 *   • the red GD step arrow / red GD trajectory lanes,
 * and NEVER any stray identity color: §8 custom-rule purple #9A72AC,
 * momentum blue #58C4DD, Adam yellow #F4D345, fog teal #5CD0B3, gold #F0AC5F.
 *
 * States exercised (every §2 state the minimap can render):
 *   1  gd-a at rest (?step=4)
 *   2  gd-b at rest (?step=5)
 *   3  gd-b held-drag PREVIEW (scanned while the button is down)
 *   4  gd-b after COMMIT (+ grow animation drained)
 *   5  gd-b + §2 tour running, arrowDrawn gate OPEN
 *   6  gd-b + gate release draw committed
 *   7  gd-b + tour Back out of the open gate (needle beat, spotlight ON)
 *   8  gd-c at all four η regimes: crawling / descending / oscillating / diverging
 *   9  gd-c mid-Play replay (scan WHILE the replay animates)
 *  10  gd-d (?step=7) — the four curated red lanes
 *  11  gd-d → §3 mom-a → BACK to gd-d (stale-path leak check)
 *  12  ?shot=gd-b — the frozen canonical shot pose
 *
 * Usage: node qa-s2mm-a.mjs http://localhost:4181
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
const rows = [];
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  rows.push({ name, ok, detail });
  if (!ok) failures += 1;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

/** Pixel scan of #minimap-canvas: identity-color census. */
async function scanMinimap() {
  return page.evaluate(() => {
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
        ) n += 1;
      }
      return n;
    };
    return {
      W, H,
      purple: count(154, 114, 172, 12),   // §8 custom rule — BANNED on §2
      momBlue: count(88, 196, 221, 14),   // §3 momentum — BANNED on §2
      adamYellow: count(244, 211, 69, 14),// §4 Adam — BANNED on §2
      fogTeal: count(92, 208, 179, 14),   // §6 fog glow — BANNED on §2
      gold: count(240, 172, 95, 14),      // §3 apex markers — BANNED on §2
      needleLav: count(201, 166, 221, 12),   // allowed (needle)
      needleSpot: count(235, 217, 247, 12),  // allowed (spotlight needle)
      gdRed: count(252, 98, 85, 12),      // allowed (GD step + trail)
      white: count(250, 250, 250, 10),    // allowed (user arrow + point)
    };
  });
}

function bannedZero(s, label) {
  check(
    `${label}: no purple #9A72AC / momentum blue / Adam yellow / fog teal / gold`,
    s.purple === 0 && s.momBlue === 0 && s.adamYellow === 0 && s.fogTeal === 0 && s.gold === 0,
    JSON.stringify(s),
  );
}

const BOOT = 1700;

/* ---------------- 1-2. gd-a / gd-b at rest ---------------- */
await page.goto(`${base}/?step=4`, { waitUntil: "load" });
await sleep(BOOT);
check("gd-a entry unlocks", await waitIdle());
{
  const s = await scanMinimap();
  bannedZero(s, "A1 gd-a at rest");
  check("A1 gd-a: needle lavender present", s.needleLav >= 4, JSON.stringify(s));
  await page.screenshot({ path: resolve(outDir, "a1-gd-a-rest.png") });
}

await page.goto(`${base}/?step=5`, { waitUntil: "load" });
await sleep(BOOT);
check("gd-b entry unlocks", await waitIdle());
{
  const s = await scanMinimap();
  bannedZero(s, "A2 gd-b at rest");
  check("A2 gd-b: needle lavender present", s.needleLav >= 4, JSON.stringify(s));
}

/* ---------------- 3-4. gd-b drag preview (held) + commit ---------------- */
{
  const box = await page.locator("#minimap-canvas").boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx + 10, cy + 40);
  await page.mouse.down();
  await page.mouse.move(cx + 62, cy + 80, { steps: 8 });
  const sPrev = await scanMinimap(); // scanned WHILE the drag is held
  bannedZero(sPrev, "A3 gd-b held-drag preview");
  check(
    "A3 preview: white preview arrow on the map",
    sPrev.white >= 30,
    JSON.stringify(sPrev),
  );
  await page.screenshot({ path: resolve(outDir, "a3-gd-b-preview.png") });
  await page.mouse.up();
  await sleep(1500); // GD-step grow animation drains
  check("A4 gd-b post-commit settles", await waitIdle());
  const s = await scanMinimap();
  bannedZero(s, "A4 gd-b after commit");
  check(
    "A4 committed set: white arrow + red GD step + lavender needle",
    s.white >= 30 && s.gdRed >= 3 && s.needleLav >= 4,
    JSON.stringify(s),
  );
  await page.screenshot({ path: resolve(outDir, "a4-gd-b-committed.png") });
}

/* ---------------- 5-7. §2 tour: gate open / release / Back ---------------- */
{
  await page.locator("#tour-entry").click();
  const t0 = Date.now();
  let st = null;
  for (;;) {
    st = await page.evaluate(() => window.__wp1?.tour?.() ?? null);
    if (st?.phase === "active" && st?.stepIndex === 1 && st?.gate) break;
    if (Date.now() - t0 > 15000) break;
    await sleep(200);
  }
  check(
    "A5 tour at the arrowDrawn gate (sentence 2/5)",
    st?.id === "s2" && st?.stepIndex === 1 && st?.gate === true,
    JSON.stringify(st),
  );
  const sGate = await scanMinimap();
  bannedZero(sGate, "A5 gate open, no draw yet");
  await page.screenshot({ path: resolve(outDir, "a5-gdb-gate-open.png") });

  // The draw that RELEASES the gate (scanned right after commit).
  const box = await page.locator("#minimap-canvas").boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx + 10, cy + 40);
  await page.mouse.down();
  await page.mouse.move(cx + 58, cy + 76, { steps: 6 });
  await page.mouse.up();
  let st2 = null;
  const t1 = Date.now();
  for (;;) {
    st2 = await page.evaluate(() => window.__wp1?.tour?.() ?? null);
    if (st2?.stepIndex === 2 && st2?.gate === false) break;
    if (Date.now() - t1 > 15000) break;
    await sleep(200);
  }
  check("A6 committed draw releases the gate → sentence 3/5", st2?.stepIndex === 2, JSON.stringify(st2));
  await waitIdle();
  const sRel = await scanMinimap();
  bannedZero(sRel, "A6 gate released by the draw");
  check("A6 released state keeps the three-arrow set", sRel.gdRed >= 3 && sRel.white >= 30, JSON.stringify(sRel));

  // BACK OUT OF A GATE SCENARIO, PART 1: Next to the η gate on gd-c, then
  // Back across the page boundary — scanned state must stay clean.
  await page.locator("#tour-next").click();
  const t2 = Date.now();
  let st3 = null;
  for (;;) {
    st3 = await page.evaluate(() => window.__wp1?.tour?.() ?? null);
    if (st3?.phase === "active" && st3?.stepIndex === 3 && st3?.gate) break;
    if (Date.now() - t2 > 20000) break;
    await sleep(200);
  }
  check("A7a etaMoved gate open on gd-c", st3?.gate === true && st3?.gateKind === "etaMoved", JSON.stringify(st3));
  const sEta = await scanMinimap();
  bannedZero(sEta, "A7a gd-c during tour η gate");
  // BACK out of the gate (the FIX-3 no-trap path — minimap must stay clean).
  await page.locator("#tour-back").click();
  const t3 = Date.now();
  let st4 = null;
  for (;;) {
    st4 = await page.evaluate(() => window.__wp1?.tour?.() ?? null);
    if (st4?.phase === "active" && st4?.stepIndex === 2 && !st4?.gate) break;
    if (Date.now() - t3 > 15000) break;
    await sleep(200);
  }
  check("A7b Back out of the η gate → sentence 3/5 on gd-b", st4?.stepIndex === 2 && st4?.gate === false, JSON.stringify(st4));
  await waitIdle();
  const sBack = await scanMinimap();
  bannedZero(sBack, "A7b after Back from the gate");
  check("A7b committed arrows still the allowed set", sBack.gdRed >= 3 && sBack.white >= 30 && sBack.needleLav >= 4, JSON.stringify(sBack));
  await page.screenshot({ path: resolve(outDir, "a7-gdb-back-from-gate.png") });

  // Needle-beat spotlight state (Back once more → step 1... step 0 is the
  // needle look — Back again reaches it).
  await page.locator("#tour-back").click();
  const t4 = Date.now();
  for (;;) {
    const s5 = await page.evaluate(() => window.__wp1?.tour?.() ?? null);
    if (s5?.phase === "active" && s5?.stepIndex === 0) break;
    if (Date.now() - t4 > 15000) break;
    await sleep(200);
  }
  await sleep(900); // spotlight fade-in
  const sSpot = await scanMinimap();
  bannedZero(sSpot, "A8 needle-look spotlight beat");
  check(
    "A8 spotlighted needle draws (bright #EBD9F7 variant or halo-lavender)",
    sSpot.needleSpot >= 4 || sSpot.needleLav >= 4,
    JSON.stringify(sSpot),
  );
  await page.screenshot({ path: resolve(outDir, "a8-gda-spotlight.png") });
  await page.keyboard.press("Escape");
  await sleep(500);
}

/* ---------------- 8-9. gd-c: the four η regimes + mid-replay ---------------- */
await page.goto(`${base}/?step=6`, { waitUntil: "load" });
await sleep(BOOT);
check("gd-c entry unlocks", await waitIdle());
{
  const slider = page.locator("#eta-slider");
  const box = await slider.boundingBox();
  const etaAt = async (t) => {
    await page.mouse.click(box.x + (box.width * t) / 1000, box.y + box.height / 2);
    await sleep(350);
    await waitIdle();
  };
  const regimes = [
    ["crawling", 100],     // η≈0.004
    ["descending", 566],   // η≈0.10
    ["oscillating", 848],  // η≈0.70
    ["diverging", 968],    // η≈1.6
  ];
  for (const [name, t] of regimes) {
    await etaAt(t);
    const gd = await page.evaluate(() => window.__wp1?.gd?.() ?? null);
    const s = await scanMinimap();
    bannedZero(s, `A9 gd-c η regime=${name} (η=${gd?.eta?.toFixed(4)}, ${gd?.regime})`);
    check(
      `A9 gd-c ${name}: needle + red trail present`,
      s.needleLav >= 4 && s.gdRed >= 1,
      JSON.stringify({ eta: gd?.eta, regime: gd?.regime, ...s }),
    );
    await page.screenshot({ path: resolve(outDir, `a9-gdc-${name}.png`) });
  }

  // Mid-replay scan: the ball + trail animate; the minimap holds its set.
  const playVisible = await page.evaluate(() => {
    const b = document.querySelector("#play-btn");
    return !!b && !b.hidden;
  });
  if (playVisible) {
    await page.locator("#play-btn").click();
    await sleep(1100); // mid-replay
    const s = await scanMinimap();
    bannedZero(s, "A10 gd-c mid-Play replay");
    await page.screenshot({ path: resolve(outDir, "a10-gdc-replay.png") });
    await waitIdle(30000);
  } else {
    check("A10 gd-c Play button visible", false, "#play-btn hidden — replay not exercised");
  }
}

/* ---------------- 10-11. gd-d lanes + §3 round-trip ---------------- */
await page.goto(`${base}/?step=7`, { waitUntil: "load" });
await sleep(BOOT);
check("gd-d entry unlocks", await waitIdle());
{
  const s = await scanMinimap();
  bannedZero(s, "A11 gd-d four curated lanes");
  check("A11 gd-d: needle + heavy red trail set", s.needleLav >= 4 && s.gdRed >= 40, JSON.stringify(s));
  await page.screenshot({ path: resolve(outDir, "a11-gdd-lanes.png") });

  // §3 round-trip: mom-a then back to gd-d — a stale momentum path on the
  // §2 map would surface here as momBlue > 0.
  const rail = await page.locator("#rail").boundingBox();
  const clickPage = async (p) => {
    await page.mouse.click(rail.x + rail.width / 2, rail.y + (rail.height * (p + 0.5)) / 27);
    await sleep(600);
    await waitIdle();
  };
  await clickPage(8); // mom-a
  const scene1 = await page.evaluate(() => window.__wp1?.scene?.());
  await clickPage(7); // gd-d again
  const scene2 = await page.evaluate(() => window.__wp1?.scene?.());
  check("A12 round-trip landed gd-d", scene1 === "mom-a" && scene2 === "gd-d", `${scene1} → ${scene2}`);
  const s2 = await scanMinimap();
  bannedZero(s2, "A12 gd-d after §3 round-trip (no stale momentum path)");
  check("A12 gd-d restored set", s2.needleLav >= 4 && s2.gdRed >= 40, JSON.stringify(s2));
  await page.screenshot({ path: resolve(outDir, "a12-gdd-return.png") });
}

/* ---------------- 12. ?shot=gd-b frozen pose ---------------- */
await page.goto(`${base}/?shot=gd-b`, { waitUntil: "load" });
await sleep(BOOT + 800);
{
  const s = await scanMinimap();
  bannedZero(s, "A13 shot=gd-b frozen canonical pose");
  check(
    "A13 frozen pose: the three-arrow instrument set",
    s.gdRed >= 3 && s.white >= 30 && (s.needleLav >= 4 || s.needleSpot >= 4),
    JSON.stringify(s),
  );
  await page.screenshot({ path: resolve(outDir, "a13-shot-gdb.png") });
}

await browser.close();
console.log(`\nQA-S2MM-A ${failures === 0 ? "ALL_PASS" : "FAILED"} (${rows.length} checks, ${failures} failures)`);
process.exit(failures === 0 ? 0 : 1);
