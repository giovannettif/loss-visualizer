/**
 * qa-diag-s7ghost-hover.mjs — reproduce TOUR-HOVER-S7-GHOST-FLAVOR-DEAD.
 *
 * The §7 scorecard page (page 20, scene tilt-b) swaps its lead paragraph
 * three ways (played run / guided demo / empty run). The tour registers the
 * ghost-replay sentence (page 20, para 1, sent 0, altPara 2, altPara2 3,
 * look "tilt-replay") and the free-play hover graduation keys off
 * `.sent[data-slook]`. This probe checks, for BOTH reachable flavors:
 *   - which flavor paragraph is visible after arrival,
 *   - which sentence spans carry data-slook / data-look (the two hover wires),
 *   - a trusted hover on the visible flavor's sentence 0: does it light
 *     ([data-slook-hover]), switch the leader overlay on, and set a look?
 * Plus a tour control: the guided walk on the same step must still light and
 * point (resolveSentence re-resolves at activation).
 *
 * Usage: node qa-diag-s7ghost-hover.mjs [baseUrl]
 */

import { chromium } from "playwright";
import { launchGL } from "./tools/gl-launch.mjs";

const base = process.argv[2] ?? "http://localhost:4199";
const VW = 1600;
const VH = 900;

const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: VW, height: VH } });
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

/** DOM inventory of the three flavor leads + their hover wires. */
async function flavorInventory() {
  return page.evaluate(() => {
    const step = document.querySelector('.rstep[data-active="true"]');
    const body = step?.querySelector(".step__body");
    const ps = body ? Array.from(body.children).filter((el) => el.tagName === "P") : [];
    const ids = ["tilt-run-lead", "tilt-demo-lead", "tilt-empty-lead"];
    const out = {};
    for (const id of ids) {
      const p = document.getElementById(id);
      if (!p) { out[id] = null; continue; }
      const spans = Array.from(p.querySelectorAll("span.sent")).map((s) => ({
        sent: s.dataset.sent,
        slook: s.dataset.slook ?? null,
        hoverable: s.getClientRects().length > 0,
        looks: Array.from(s.querySelectorAll("[data-look]")).map((l) => l.dataset.look),
      }));
      out[id] = {
        hidden: p.hidden,
        rects: p.getClientRects().length,
        paraIndex: ps.indexOf(p),
        spans,
      };
    }
    return out;
  });
}

/** Trusted hover on a point inside the given element's inline boxes. */
async function hoverInside(pId, sentIdx) {
  const pt = await page.evaluate(
    ({ pId, sentIdx }) => {
      const p = document.getElementById(pId);
      const s = p?.querySelector(`span.sent[data-sent="${sentIdx}"]`);
      if (!s) return null;
      for (const r of Array.from(s.getClientRects())) {
        const cands = [
          { x: r.x + r.width / 2, y: r.y + r.height / 2 },
          { x: r.x + r.width * 0.3, y: r.y + r.height / 2 },
          { x: r.x + r.width * 0.7, y: r.y + r.height / 2 },
        ];
        for (const c of cands) {
          const hit = document.elementFromPoint(c.x, c.y);
          if (hit && hit.closest("span.sent") === s) return c;
        }
      }
      return null;
    },
    { pId, sentIdx },
  );
  if (!pt) return null;
  await page.mouse.move(pt.x, pt.y, { steps: 4 });
  await sleep(300);
  return page.evaluate(() => ({
    litCount: document.querySelectorAll("[data-slook-hover]").length,
    overlayOn: document.querySelector("#tour-overlay")?.dataset.on === "true",
    lookKey: window.__wp1.tour().lookKey,
    lookActive: window.__wp1.look()?.active ?? null,
  }));
}

async function unhover() {
  await page.mouse.move(8, 8);
  await sleep(220);
}

const READER_X = VW - 290;
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

const expectHoverAlive = async (label, pId) => {
  const st = await hoverInside(pId, 0);
  if (!st) {
    check(`${label}: hoverable point found in visible flavor`, false, "no inline-box hit");
    return;
  }
  check(
    `${label}: sentence 0 highlights on hover (data-slook-hover)`,
    st.litCount === 1,
    `litCount=${st.litCount}`,
  );
  check(
    `${label}: leader overlay switches on`,
    st.overlayOn === true,
    `overlayOn=${st.overlayOn}`,
  );
  check(
    `${label}: look key engages (tour.lookKey / spotlight)`,
    st.lookKey === "tilt-replay",
    `lookKey=${JSON.stringify(st.lookKey)} lookActive=${st.lookActive}`,
  );
  await unhover();
};

/* ---------------- case 1: deep-link boot (?step=20) ---------------- */
{
  await page.goto(`${base}/?step=20`, { waitUntil: "load" });
  await page.waitForTimeout(700);
  const idle = await waitIdle();
  check(
    "deep-link: reader parked + unlocked on page 20",
    idle && (await page.evaluate(() => window.__wp1.scroll().parked)),
    `scene=${await page.evaluate(() => window.__wp1.scene())}`,
  );

  const inv = await flavorInventory();
  console.log("deep-link flavor inventory:", JSON.stringify(inv, null, 1));

  const wiredOutside = inv["tilt-run-lead"].spans.some((s) => s.slook);
  const demoUnwired = inv["tilt-demo-lead"].spans.every(
    (s) => !s.slook && s.looks.length === 0,
  );
  const emptyUnwired = inv["tilt-empty-lead"].spans.every(
    (s) => !s.slook && s.looks.length === 0,
  );
  check(
    "deep-link: boot data-slook landed on the played-run flavor (#tilt-run-lead)",
    wiredOutside,
    `run-lead slook spans=${inv["tilt-run-lead"].spans.filter((s) => s.slook).length}`,
  );
  check(
    "deep-link: guided-demo flavor (#tilt-demo-lead) has NO hover wire",
    demoUnwired,
  );
  check(
    "deep-link: empty-run flavor (#tilt-empty-lead) has NO hover wire",
    emptyUnwired,
  );

  const visibleFlavor = ["tilt-run-lead", "tilt-demo-lead", "tilt-empty-lead"].find(
    (id) => inv[id] && !inv[id].hidden && inv[id].rects > 0,
  );
  console.log("deep-link visible flavor:", visibleFlavor);
  if (visibleFlavor && visibleFlavor !== "tilt-run-lead") {
    await expectHoverAlive("deep-link/visible-flavor", visibleFlavor);
  } else if (visibleFlavor === "tilt-run-lead") {
    console.log("  (deep-link shows the played-run flavor — hovering that one instead)");
    await expectHoverAlive("deep-link/played-run", visibleFlavor);
  }
}

/* ---------------- case 2: wheel arrival (from ?step=19) ---------------- */
{
  await page.goto(`${base}/?step=19`, { waitUntil: "load" });
  await page.waitForTimeout(700);
  await waitIdle();
  const n = await notchesToCross(19);
  await wheelReader(n);
  await waitIdle();
  check(
    "wheel: reader parked + unlocked on page 20",
    (await page.evaluate(() => window.__wp1.step())) === 20 &&
      (await page.evaluate(() => window.__wp1.scroll().parked)),
    `step=${await page.evaluate(() => window.__wp1.step())}`,
  );

  const inv = await flavorInventory();
  console.log("wheel-arrival flavor inventory:", JSON.stringify(inv, null, 1));
  const visibleFlavor = ["tilt-run-lead", "tilt-demo-lead", "tilt-empty-lead"].find(
    (id) => inv[id] && !inv[id].hidden && inv[id].rects > 0,
  );
  console.log("wheel-arrival visible flavor:", visibleFlavor);
  if (visibleFlavor) await expectHoverAlive("wheel-arrival/visible-flavor", visibleFlavor);
}

/* ---------------- control: the guided tour still works on this step -------- */
{
  await page.goto(`${base}/?step=20`, { waitUntil: "load" });
  await page.waitForTimeout(700);
  await waitIdle();
  const chip = page.locator('.rstep[data-active="true"] .tour-launch[data-tour="s7"]');
  check("tour control: s7 chip present on page 20", (await chip.count()) === 1);
  await chip.click();
  await sleep(400);
  await waitIdle();
  await sleep(400); // let the frame loop activate step 0 at rest
  // Next to the ghost step: playlist index 3 ("4 / 7"). Step 0 carries the
  // tiltSteered gate (Next/Space swallowed while it is open — the action is
  // the only way through), so steer while gated, otherwise click Next.
  for (let i = 0; i < 16; i++) {
    const at = await page.evaluate(() => {
      const t = window.__wp1.tour();
      return { idx: t.stepIndex, phase: t.phase, gate: t.gate };
    });
    if (at.idx === 3 && at.phase === "active" && !at.gate) break;
    if (at.gate) {
      await page.keyboard.press("d");
      await sleep(250);
      await page.keyboard.press("d");
      await sleep(450);
    } else {
      await page.click("#tour-next");
      await sleep(350);
    }
    await waitIdle();
    await sleep(250);
  }
  const st = await page.evaluate(() => {
    const t = window.__wp1.tour();
    return {
      stepIndex: t.stepIndex,
      sentenceActive: t.sentenceActive,
      overlayOn: t.overlayOn,
      lookKey: t.lookKey,
      text: (t.sentenceText ?? "").slice(0, 60),
    };
  });
  check(
    "tour control: ghost step (4/7) lights its sentence + points",
    st.stepIndex === 3 && st.sentenceActive && st.overlayOn && st.lookKey === "tilt-replay",
    JSON.stringify(st),
  );
  await page.click("#tour-exit");
  await sleep(300);
}

await browser.close();
console.log(
  failures === 0
    ? "S7GHOST_REPRO: all expectations held (bug NOT reproduced — investigate)"
    : `S7GHOST_REPRO: ${failures} failing check(s) — see FAIL lines`,
);
process.exit(0);
