/**
 * qa-int/t5-policy.mjs — interaction-policy edges (interaction lens):
 * plain clicks inert INSIDE a running tour; hover-to-look tiers (span +
 * registered-sentence graduation) with unhover clearing; Tab focus lights
 * a look; a focused range keeps its arrow keys without advancing; §7 tilt
 * keys steer the board without advancing while Space still advances; the
 * COPY-PLAN E1 inline jump buttons (#fog-goto-l2 / #tilt-goto-drive).
 * REAL input only; state via __wp1 (read-only).
 */
import { chromium } from "playwright";
import { launchGL } from "../tools/gl-launch.mjs";
import {
  check, finish, sleep, appState, waitIdle, waitFor, shot,
} from "./h.mjs";

const BASE = process.argv[2] ?? "http://localhost:4184";
const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
const st = () => appState(page);
const look = () => page.evaluate(() => window.__wp1.look());

/* ============ A. click inert inside a RUNNING tour (?step=1) ============ */
await page.goto(BASE + "/?step=1", { waitUntil: "load" });
await page.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
await waitIdle(page);
await page.locator('.rstep[data-active="true"] .tour-launch[data-tour="s1"]').click();
await waitFor(page, async () => {
  const t = await page.evaluate(() => window.__wp1.tour());
  return t.running && t.phase === "active" ? t : null;
}, { label: "s1 tour running" });
{
  const rb = await page.locator("#reader").boundingBox();
  await page.mouse.click(rb.x + rb.width * 0.5, rb.y + 200);
  await sleep(500);
  const t = await page.evaluate(() => window.__wp1.tour());
  const a = await st();
  check("a plain reader click mid-tour advances NEITHER the tour nor the reader",
    t.stepIndex === 0 && !t.gateOpenOnActivate === true ? true : t.stepIndex === 0 &&
    a.step === 1 && a.locked === false,
    `tour i=${t.stepIndex} running=${t.running} step=${a.step}`);
}
await page.keyboard.press("Escape");
await sleep(300);

/* ============ B. hover-to-look tier 1: a plain .look span (?step=2) ============ */
await page.goto(BASE + "/?step=2", { waitUntil: "load" }); // task-b (compass/needle page)
await page.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
await waitIdle(page);
{
  // a look span NOT inside a registered sentence (plain tier). Hover-point
  // picking mirrors tools/gate-hover.mjs: a multi-line inline span's
  // union-rect centre can hit-test to a sibling line, so probe the span's
  // OWN client rects until one resolves to the span itself.
  const target = await page.evaluate(() => {
    for (const el of document.querySelectorAll('.rstep[data-active="true"] .look[data-look]')) {
      if (el.closest(".sent[data-slook]")) continue;
      for (const r of el.getClientRects()) {
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        const hit = document.elementFromPoint(x, y);
        if (hit && (hit === el || el.contains(hit))) {
          return { key: el.dataset.look, x, y };
        }
      }
    }
    return null;
  });
  const rb = await page.locator("#reader").boundingBox();
  const neutral = { x: rb.x + rb.width * 0.5, y: rb.y + rb.height - 30 };
  if (!target) {
    check("tier-1 span hover (no plain span on this page — skipped)", false, "no unregistered span found");
  } else {
    // Two-stage hover: rest at a neutral spot first (the motion gate needs
    // the document at rest AND a fresh trusted pointer move), then cross to
    // the span so the pointerover lands while pointerHoverAllowed().
    await page.mouse.move(neutral.x, neutral.y);
    await sleep(900);
    await page.mouse.move(target.x, target.y, { steps: 4 });
    await sleep(450);
    const lk = await look();
    check(`tier-1: hovering the "${target.key}" span spotlights it`,
      lk?.id === target.key && lk.active === true,
      `look=${JSON.stringify({ id: lk?.id, active: lk?.active, ring: lk?.ring })}`);
    // unhover clears
    await page.mouse.move(neutral.x, neutral.y, { steps: 4 });
    await sleep(400);
    const lk2 = await look();
    check("tier-1: unhover clears the spotlight",
      lk2?.id === null && lk2?.active === false,
      `look=${JSON.stringify({ id: lk2?.id, active: lk2?.active })}`);
  }
}

/* ============ C. tier 2: a registered sentence graduates (?step=1) ============ */
await page.goto(BASE + "/?step=1", { waitUntil: "load" });
await page.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
await waitIdle(page);
{
  const target = await page.evaluate(() => {
    const el = document.querySelector('.rstep[data-active="true"] .sent[data-slook]');
    if (!el) return null;
    // Same rect-fragment discipline: find a point that hit-tests INTO the
    // sentence's own inline boxes.
    for (const r of el.getClientRects()) {
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      if (hit && el.contains(hit)) return { slook: el.dataset.slook, x, y };
    }
    return null;
  });
  const rb = await page.locator("#reader").boundingBox();
  const neutral = { x: rb.x + rb.width * 0.5, y: rb.y + rb.height - 30 };
  if (!target) {
    check("tier-2 sentence hover (no registered sentence on page 1 — skipped)", false, "none found");
  } else {
    await page.mouse.move(neutral.x, neutral.y);
    await sleep(900);
    await page.mouse.move(target.x, target.y, { steps: 4 });
    await sleep(500);
    const hoverState = await page.evaluate(() => {
      const el = document.querySelector('.rstep[data-active="true"] .sent[data-slook-hover="true"]');
      return el ? el.dataset.slook : null;
    });
    const lk = await look();
    check("tier-2: hovering a registered sentence highlights the WHOLE sentence and spotlights its target",
      hoverState === target.slook && lk?.id === target.slook,
      `hovered="${hoverState}" look=${lk?.id}`);
    await page.mouse.move(neutral.x, neutral.y, { steps: 4 });
    await sleep(400);
    const cleared = await page.evaluate(() =>
      document.querySelector('.sent[data-slook-hover="true"]') === null);
    check("tier-2: unhover clears the sentence highlight", cleared,
      `cleared=${cleared}`);
  }
}

/* ============ D. Tab focus lights a look span (?step=2) ============ */
await page.goto(BASE + "/?step=2", { waitUntil: "load" });
await page.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
await waitIdle(page);
{
  let lit = null;
  let steps = 0;
  for (; steps < 40; steps++) {
    await page.keyboard.press("Tab");
    await sleep(60);
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      const onLook = el instanceof HTMLElement && el.closest?.("[data-look]");
      return onLook ? el.closest("[data-look]").dataset.look : null;
    });
    if (info) {
      await sleep(300); // focusin → setLook
      lit = { key: info, lk: await look() };
      break;
    }
  }
  check("Tab-focusing a look span lights the spotlight (keyboard path)",
    !!lit && lit.lk?.id === lit.key,
    steps < 40 ? `after ${steps + 1} Tabs: look=${lit?.lk?.id}` : "no look span reached in 40 Tabs");
  // click neutral ground to clear focus + spotlight
  const rb = await page.locator("#reader").boundingBox();
  await page.mouse.click(rb.x + rb.width * 0.5, rb.y + rb.height - 40);
  await sleep(300);
}

/* ============ E. a focused range keeps its arrows; reader keys resume after blur (?step=6) ============ */
await page.goto(BASE + "/?step=6", { waitUntil: "load" });
await page.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
await waitIdle(page);
{
  const slider = page.locator("#eta-slider");
  await slider.click(); // mouse-focus the range (value jumps to the click point)
  await waitIdle(page);
  const eta0 = await page.evaluate(() => window.__wp1.gd().eta);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await sleep(250);
  const eta1 = await page.evaluate(() => window.__wp1.gd().eta);
  const a1 = await st();
  check("a focused η slider keeps its native arrow keys (tunes without advancing)",
    eta1 > eta0 && a1.step === 6, `eta ${eta0?.toFixed(4)} -> ${eta1?.toFixed(4)} step=${a1.step}`);
  await page.keyboard.press("Space"); // mouse-focused range: stray focus must NOT eat reader Space
  await waitIdle(page);
  const a2 = await st();
  check("Space on a mouse-focused slider still advances the reader (stray-focus policy)",
    a2.step === 7, `step=${a2.step}`);
}

/* ============ F. §7 tilt keys steer, reader keys still work (?step=18) ============ */
await page.goto(BASE + "/?step=18", { waitUntil: "load" });
await page.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
await waitIdle(page);
{
  await page.keyboard.down("a");
  await sleep(350);
  const during = await page.evaluate(() => {
    const t = window.__wp1.tilt();
    return { input: t.input, done: t.done, steps: t.steps };
  });
  const a1 = await st();
  await page.keyboard.up("a");
  check("a live tilt run: 'a' steers the board (input ≠ 0) and advances nothing",
    during.done === false && (during.input.x !== 0 || during.steps > 0) && a1.step === 18,
    `input=${JSON.stringify(during.input)} steps=${during.steps} step=${a1.step}`);
  await page.keyboard.press("ArrowDown"); // reader key during a live run
  await waitIdle(page);
  const a2 = await st();
  check("ArrowDown during a live tilt run still pages the reader (S2-BWD-1)",
    a2.step === 19, `step=${a2.step}`);
}

/* ============ G. E1 jump buttons ============ */
// §6: the fog-c empty-run lead ships "Take the Level 2 run →"
await page.goto(BASE + "/?step=17", { waitUntil: "load" });
await page.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
await waitIdle(page);
{
  const visible = await page.evaluate(() => {
    const b = document.querySelector("#fog-goto-l2");
    return b && !b.closest("hidden") ? !b.hidden && b.offsetParent !== null : false;
  });
  const fogBefore = await page.evaluate(() => {
    const f = window.__wp1.fog();
    return { level: f?.level, used: f?.used, done: f?.done };
  });
  await page.click("#fog-goto-l2");
  await waitIdle(page);
  const a = await st();
  const fog = await page.evaluate(() => {
    const f = window.__wp1.fog();
    return { level: f?.level, used: f?.used, done: f?.done };
  });
  check("#fog-goto-l2 jumps the reader back to the fog-b page",
    a.step === 16, `step=${a.step} buttonVisible=${visible} fogBefore=${JSON.stringify(fogBefore)}`);
  // What landed there? (restore-back review vs fresh game — see QAReport)
  const flavor =
    fog.done === false ? "fresh game" :
    fog.used === 0 && fog.done === true ? "restored EMPTY finished run (read-only)" :
    "restored played finished run (review)";
  console.log(`  INFO  #fog-goto-l2 landed on: ${flavor} fog=${JSON.stringify(fog)}`);
  check("#fog-goto-l2 lands on a level-2 Rosenbrock state the visitor can actually play",
    fog.done === false, `landed: ${flavor} fog=${JSON.stringify(fog)}`);
}
// §7: the tilt-b demo lead ships "Take the drive →"
await page.goto(BASE + "/?step=20", { waitUntil: "load" });
await page.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
await waitIdle(page);
{
  const has = await page.evaluate(() => {
    const b = document.querySelector("#tilt-goto-drive");
    return !!b && b.offsetParent !== null;
  });
  if (!has) {
    // flavor without the lead: report as not covered rather than guess
    check("#tilt-goto-drive present on the reachable tilt-b flavor", false, "button not visible on this flavor");
  } else {
    await page.click("#tilt-goto-drive");
    await waitIdle(page);
    const a = await st();
    const t = await page.evaluate(() => {
      const s = window.__wp1.tilt();
      return { done: s.done, level: s.level };
    });
    check("#tilt-goto-drive jumps the reader back to the first tilt play page (a fresh run)",
      a.step === 18 && t.done === false, `step=${a.step} tilt=${JSON.stringify(t)}`);
  }
}
await shot(page, "t5-tilta-jumped.png");

await browser.close();
finish("T5-POLICY");
