/* Cycle B round-1 verification drive (Playwright, main page):
   BRK-1                — the off-state tour controller intercepts nothing.
   STUDENT-TILTB-LEAD   — an empty unsteered run shows the no-run lead.
   STUDENT-720-GDC      — at 1280x720 the gd-c ball clears the compass.
   STUDENT-CAM-PRESET   — a preset click restores the arrival zoom. */
import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";

const base = process.argv[2] ?? "http://localhost:4173";
let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const idle = async (page, maxMs = 25000) => {
  const t0 = Date.now();
  for (;;) {
    const a = await page.evaluate(() => ({ l: window.__wp1?.locked?.(), an: window.__wp1?.animating?.() }));
    if (!a.l && !a.an) return true;
    if (Date.now() - t0 > maxMs) return false;
    await sleep(250);
  }
};

const browser = await launchGL(chromium);

/* ---- BRK-1: the invisible controller must not eat inputs (900x620) ------ */
{
  const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
  await page.goto(`${base}/?step=21`, { waitUntil: "load" });
  await sleep(1500);
  await idle(page);
  const probe = await page.evaluate(() => {
    const at = (sel) => {
      const r = document.querySelector(sel).getBoundingClientRect();
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { hit: el ? el.id || el.tagName : "null", inBar: !!el?.closest?.("#tour-bar") };
    };
    const bar = document.querySelector("#tour-bar-full").getBoundingClientRect();
    const cs = getComputedStyle(document.querySelector("#tour-bar-full"));
    return {
      restart: at("#swarm-replay-restart"),
      scrub: at("#swarm-scrub"),
      barRect: { l: Math.round(bar.left), r: Math.round(bar.right), t: Math.round(bar.top), b: Math.round(bar.bottom) },
      pe: cs.pointerEvents,
    };
  });
  check(
    "BRK-1: off-state bar is pointer-events:none",
    probe.pe === "none",
    `pointerEvents=${probe.pe} bar=${JSON.stringify(probe.barRect)}`,
  );
  check(
    "BRK-1: #swarm-replay-restart is hit-testable (not the invisible #tour-back)",
    probe.restart.hit === "swarm-replay-restart" && probe.restart.inBar === false,
    JSON.stringify(probe.restart),
  );
  check(
    "BRK-1: #swarm-scrub is hit-testable (not the invisible #tour-next)",
    probe.scrub.hit === "swarm-scrub" && probe.scrub.inBar === false,
    JSON.stringify(probe.scrub),
  );
  const before = await page.evaluate(() => window.__wp1.swarm()?.time ?? -1);
  await page.locator("#swarm-replay-restart").click();
  await sleep(600);
  const after = await page.evaluate(() => window.__wp1.swarm());
  check(
    "BRK-1: the swarm restart click actually lands at 900px (was intercepted)",
    after !== null && after.playing === true,
    `before t=${before?.toFixed?.(2)} after=${JSON.stringify({ playing: after?.playing, t: after?.time?.toFixed?.(2) })}`,
  );
  await page.close();
}

/* ---- STUDENT-TILTB-EMPTY-RUN-LEAD: empty arrival shows the no-run lead -- */
{
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto(`${base}/?step=17`, { waitUntil: "load" });
  await sleep(1500);
  await idle(page);
  // Wheel across 18 and 19 without ever steering (the repro's flow).
  const tops = await page.evaluate(() => window.__wp1.scroll().tops);
  for (const k of [17, 18, 19]) {
    const half = (tops[k + 1] - tops[k]) / 2;
    const notches = Math.max(2, Math.ceil(half / 120) + 1);
    await page.mouse.move(1600 - 290, 450);
    for (let i = 0; i < notches; i++) {
      await page.mouse.wheel(0, 120);
      await sleep(60);
    }
    await idle(page);
    await sleep(400);
  }
  await idle(page);
  const s = await page.evaluate(() => ({
    step: window.__wp1.step(),
    runLeadHidden: document.querySelector("#tilt-run-lead")?.hidden ?? null,
    demoLeadHidden: document.querySelector("#tilt-demo-lead")?.hidden ?? null,
    emptyLeadHidden: document.querySelector("#tilt-empty-lead")?.hidden ?? null,
    emptyText: (document.querySelector("#tilt-empty-lead")?.textContent ?? "").replace(/\s+/g, " ").slice(0, 60),
    tilt: window.__wp1.tilt(),
    row: (document.querySelector("#tilt-scorecard-body")?.textContent ?? "").slice(0, 40),
  }));
  check(
    "STUDENT-TILTB: arrived on the scorecard page via wheel-through",
    s.step === 20,
    `step=${s.step} tilt.level=${s.tilt?.level} steered=${s.tilt?.steered}`,
  );
  check(
    "STUDENT-TILTB: an empty unsteered run shows the NO-RUN lead (run+demo leads hidden)",
    s.runLeadHidden === true && s.demoLeadHidden === true && s.emptyLeadHidden === false,
    JSON.stringify({ run: s.runLeadHidden, demo: s.demoLeadHidden, empty: s.emptyLeadHidden }),
  );
  check(
    "STUDENT-TILTB: the no-run lead copy is honest about the scrubber",
    s.emptyText.includes("haven") && s.emptyText.includes("no run of yours"),
    JSON.stringify(s.emptyText),
  );
  await page.close();
}

/* ---- STUDENT-720-GDC: the gd-c ball clears the compass at 1280x720 ------ */
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(`${base}/?step=6`, { waitUntil: "load" });
  await sleep(1500);
  await idle(page);
  const g = await page.evaluate(() => {
    const ball = window.__wp1.ballScreen();
    const panel = document.querySelector("#minimap-panel").getBoundingClientRect();
    return { ball, panel: { l: panel.left, t: panel.top, r: panel.right, b: panel.bottom } };
  });
  const clear =
    g.ball === null ||
    g.ball.y + 14 <= g.panel.t + 1 ||
    g.ball.x - 14 >= g.panel.r ||
    g.ball.x + 14 <= g.panel.l ||
    g.ball.y - 14 >= g.panel.b;
  check(
    "STUDENT-720: the gd-c ball no longer sits under the compass panel",
    clear,
    `ball=${JSON.stringify(g.ball)} panel=${JSON.stringify(g.panel)}`,
  );
  check(
    "STUDENT-720: the compass re-docked to the pane's top-right",
    g.panel.t < 200,
    `panel.top=${g.panel.t?.toFixed?.(1)}`,
  );
  await page.close();
}

/* ---- STUDENT-CAM-PRESET: a preset click restores the arrival zoom -------- */
{
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto(`${base}/?step=5`, { waitUntil: "load" });
  await sleep(1500);
  await idle(page);
  await sleep(500);
  const z0 = await page.evaluate(() => window.__wp1.debug().viewAttitude.zoomRadius);
  const CX = 420, CY = 450;
  const zoomIn = async () => {
    for (let i = 0; i < 5; i++) {
      await page.mouse.move(CX, CY);
      await page.mouse.wheel(0, -120);
      await sleep(120);
    }
    await sleep(400);
  };
  const clickIso = async () => {
    await page.locator('.lv-btn[data-preset="iso"]').click();
    await sleep(1200);
    return page.evaluate(() => window.__wp1.debug().viewAttitude.zoomRadius);
  };
  await zoomIn();
  const zIn = await page.evaluate(() => window.__wp1.debug().viewAttitude.zoomRadius);
  const zPost = await clickIso();
  check(
    'STUDENT-CAM: wheeling in changed the zoom',
    Math.abs(zIn - z0) > 1,
    `${z0.toFixed(2)} -> ${zIn.toFixed(2)}`,
  );
  check(
    'STUDENT-CAM: the Isometric preset rescues a deep zoom (standard distance restored)',
    zPost > zIn + 1,
    `${zIn.toFixed(2)} -> preset ${zPost.toFixed(2)}`,
  );
  // The standard pose REPRODUCES: zoom deep again, click Isometric, the same
  // distance comes back (a stable standard, not a late tween).
  await zoomIn();
  const zIn2 = await page.evaluate(() => window.__wp1.debug().viewAttitude.zoomRadius);
  const zPost2 = await clickIso();
  check(
    'STUDENT-CAM: the preset standard pose is deterministic across repeats',
    Math.abs(zPost2 - zPost) < 0.5 && zIn2 < zPost2 - 1,
    `second: deep ${zIn2.toFixed(2)} -> ${zPost2.toFixed(2)} (first ${zPost.toFixed(2)})`,
  );
  await page.close();
}

await browser.close();
console.log(failures === 0 ? "ALL_PASS" : `FAILURES: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
