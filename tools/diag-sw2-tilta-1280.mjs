/**
 * diag-sw2-tilta-1280.mjs — reproduction + root-cause probe for finding
 * SW2-LW24-TILTA-BALL-UNDER-TILTPANEL-1280 (tilt-a at 1280x800: the ball
 * starts under the opaque #tilt-panel).
 *
 * A. DEEP LINK: ?step=18 at 1280x800, click Skip if shown, settle, read
 *    __wp1.ballScreen() vs #tilt-panel rect + elementFromPoint + screenshot.
 *    Then a 1px viewport change (re-marks hudNudgeDirty → recompute) to test
 *    whether the ball-clear nudge machinery CAN clear it once re-run settled.
 * B. WHEEL FLOW: ?step=17 → wheel over the reader into step 18, settle, same
 *    reads + screenshot (the finding's second repro path).
 * C. GEOMETRY: in-page, re-run the production grid search (director's
 *    computeHudClearNudge: CLEAR=28, dx 0..200/4, dy -120..160/4, pane
 *    margins 40) against the MEASURED ball + obstacles to see whether any
 *    valid nudge exists at this viewport at all.
 *
 * Read-only against src/ — serves the existing dist/ build.
 */

import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, extname, resolve } from "node:path";

const DIST = join(process.cwd(), "dist");
const PORT = 4195;
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff",
};
const srv = createServer((req, res) => {
  let p = req.url.split("?")[0];
  if (p === "/" || p === "") p = "/index.html";
  const file = join(DIST, p);
  if (!existsSync(file)) { res.writeHead(404).end("no"); return; }
  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => srv.listen(PORT, () => r(srv)));
console.log(`serving dist on :${PORT}`);

const OUT = resolve("qa", "SW2-LW24-TILTA-BALL-UNDER-TILTPANEL-1280-r1");
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await launchGL(chromium);

async function readState(page, tag) {
  const s = await page.evaluate(() => {
    const wp = window.__wp1;
    const panelEl = document.querySelector("#tilt-panel");
    const pr = panelEl.getBoundingClientRect();
    const ball = wp.ballScreen();
    const obstacles = [...document.querySelectorAll('#stage-wrap .hud.panel[data-visible="true"]')]
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { id: el.id, l: +r.left.toFixed(0), t: +r.top.toFixed(0), r: +r.right.toFixed(0), b: +r.bottom.toFixed(0) };
      });
    let hitEl = null;
    if (ball) {
      const el = document.elementFromPoint(ball.x, ball.y);
      hitEl = el ? `${el.tagName}#${el.id}.${el.className?.baseVal ?? el.className}` : "none";
    }
    const reader = document.querySelector("#reader").getBoundingClientRect();
    const tilt = wp.tilt();
    return {
      scene: wp.scene(), step: wp.step(), intro: wp.scroll().intro,
      locked: wp.locked(), animating: wp.animating(),
      frameX: wp.layout().frameX,
      ball: ball ? { x: +ball.x.toFixed(1), y: +ball.y.toFixed(1) } : null,
      hitElement: hitEl,
      panel: { l: +pr.left.toFixed(1), t: +pr.top.toFixed(1), r: +pr.right.toFixed(1), b: +pr.bottom.toFixed(1) },
      panelVisible: panelEl.dataset.visible,
      obstacles,
      readerL: +reader.left.toFixed(1), readerW: +reader.width.toFixed(1),
      viewport: `${innerWidth}x${innerHeight}`,
      tiltLevel: tilt ? tilt.level : null,
      tiltPos: tilt && tilt.pos ? { x: +tilt.pos.x.toFixed(2), y: +tilt.pos.y.toFixed(2) } : null,
      ballVisible: ball !== null,
    };
  });
  const inside = s.ball && s.ball.x > s.panel.l && s.ball.x < s.panel.r && s.ball.y > s.panel.t && s.ball.y < s.panel.b;
  console.log(`[${tag}] scene=${s.scene} step=${s.step} intro=${s.intro} locked=${s.locked} anim=${s.animating} frameX=${s.frameX}`);
  console.log(`  ball=${JSON.stringify(s.ball)} panel=${JSON.stringify(s.panel)} inside=${inside} hitEl=${s.hitElement}`);
  console.log(`  panelVisible=${s.panelVisible} obstacles=${JSON.stringify(s.obstacles)} readerL=${s.readerL} tilt=${s.tiltLevel}/${JSON.stringify(s.tiltPos)}`);
  return { ...s, insidePanel: inside };
}

async function settle(page, maxMs = 20000) {
  const t0 = Date.now();
  for (;;) {
    const st = await page.evaluate(() => ({
      locked: window.__wp1.locked(), animating: window.__wp1.animating(),
    }));
    if (!st.locked && !st.animating) return true;
    if (Date.now() - t0 > maxMs) return false;
    await sleep(100);
  }
}

async function clickSkipIfShown(page) {
  const shown = await page.evaluate(() => {
    const b = document.querySelector("#skip-btn");
    return b && !b.hidden && getComputedStyle(b).display !== "none" && b.getBoundingClientRect().width > 0;
  });
  if (shown) {
    await page.click("#skip-btn");
    console.log("  [skip] clicked Skip animation");
    await sleep(250);
    return true;
  }
  return false;
}

/* ---------------- A: deep link ?step=18 ---------------- */
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  await page.goto(`http://localhost:${PORT}/?step=18`, { waitUntil: "load" });
  await sleep(700);
  await clickSkipIfShown(page);
  const ok = await settle(page);
  await sleep(500);
  const a1 = await readState(page, "A deep ?step=18");
  await page.screenshot({ path: join(OUT, "deep-1280-s18-tilt-a.png") });

  // Re-mark dirty via a 1px viewport change (hudNudgeViewport signature), let
  // the per-frame upkeep recompute while fully settled, then re-read.
  await page.setViewportSize({ width: 1279, height: 800 });
  await sleep(300);
  await page.setViewportSize({ width: 1280, height: 800 });
  await sleep(1200);
  const a2 = await readState(page, "A after 1px resize roundtrip");
  await page.screenshot({ path: join(OUT, "deep-1280-s18-after-resize.png") });

  // C: production-grid-search feasibility against measured geometry.
  const geo = await page.evaluate(() => {
    const ball = window.__wp1.ballScreen();
    if (!ball) return { feasible: false, why: "no ball" };
    const CLEAR = 28;
    const readerEl = document.getElementById("reader");
    const readerL =
      readerEl && getComputedStyle(readerEl).transform !== "none"
        ? innerWidth - 8
        : readerEl ? readerEl.getBoundingClientRect().left : innerWidth - 8;
    const pane = { l: 8, t: 8, r: readerL - 8, b: innerHeight - 8 };
    const obs = [...document.querySelectorAll('#stage-wrap .hud.panel[data-visible="true"]')].map((el) => {
      const r = el.getBoundingClientRect();
      return { l: r.left - CLEAR, t: r.top - CLEAR, r: r.right + CLEAR, b: r.bottom + CLEAR };
    });
    const inside = (x, y) => obs.some((o) => x > o.l && x < o.r && y > o.t && y < o.b);
    const ok = (x, y) =>
      !inside(x, y) && x >= pane.l + 40 && x <= pane.r - 40 && y >= pane.t + 40 && y <= pane.b - 40;
    let best = Infinity, found = null;
    for (let dx = 0; dx <= 200; dx += 4)
      for (let dy = -120; dy <= 160; dy += 4) {
        const d = dx * dx + dy * dy;
        if (d >= best || !ok(ball.x + dx, ball.y + dy)) continue;
        best = d; found = { x: dx, y: dy };
      }
    return { feasible: !!found, found, pane, obsCount: obs.length, obs };
  });
  console.log(`  [C geometry after resize] re-run of the grid search vs measured ball: ${JSON.stringify(geo)}`);
  await page.close();
}

/* ---------------- B: wheel flow ?step=17 → wheel into 18 ---------------- */
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  await page.goto(`http://localhost:${PORT}/?step=17`, { waitUntil: "load" });
  await sleep(700);
  await clickSkipIfShown(page);
  await settle(page);
  await sleep(400);
  const at = await page.evaluate(() => {
    const r = document.querySelector("#reader-body").getBoundingClientRect();
    return { x: r.left + 80, y: Math.min(r.top + r.height / 2, 700) };
  });
  // Wheel until step 18 lands (each advance may lock; skip through the locks).
  for (let i = 0; i < 20; i++) {
    const st = await page.evaluate(() => ({
      step: window.__wp1.step(), locked: window.__wp1.locked(), animating: window.__wp1.animating(),
    }));
    if (st.step === 18 && !st.locked && !st.animating) break;
    if (st.locked) { await clickSkipIfShown(page); await settle(page); }
    await page.mouse.move(at.x, at.y);
    await page.mouse.wheel(0, 300);
    await sleep(400);
  }
  await clickSkipIfShown(page);
  const okb = await settle(page);
  await sleep(500);
  const b1 = await readState(page, "B wheel 17→18");
  // Same viewport, other levels: their starts must clear the panel too.
  for (const lv of ["rosen", "rastr"]) {
    await page.click(`#tilt-levels button[data-level="${lv}"]`);
    await sleep(1200);
    await readState(page, `B wheel flow level ${lv}`);
  }
  await page.screenshot({ path: join(OUT, "wheel-1280-s18-rastr.png") });
  await page.screenshot({ path: join(OUT, "wheel-1280-s18-tilt-a.png") });
  console.log(`  settle ok deep=${okb}`);
  await page.close();
}

await browser.close();
srv.close();
console.log(`\nscreenshots in ${OUT}`);
