/**
 * diag-sw2-taskc-ball-repro.mjs — SW2-LW24-TASKC-POINT-UNDER-LOSSPANEL-1280
 * reproduction against the CURRENT tree (the finding's evidence predates the
 * director.ts hudClear implementation, so this checks whether that fix holds).
 *
 * The finding's repro, verbatim in shape:
 *   - deep link ?step=3 (task-c) at 1280x800 (control 1440x900),
 *   - wait for __wp1, drain lock/entry (Skip if shown), let the ball settle,
 *   - read __wp1.ballScreen() vs the visible .hud.panel rects,
 *   - elementFromPoint(ball) — "DIV #loss-value" means hidden under the panel,
 *   - a REAL mouse drag from ball to ball+(60,+30): fit/loss must change if
 *     the point is grabbable (finding: readout stuck at w=0.91 b=1.31).
 * Plus the same probe for ?step=18 (tilt-a) at 1280x800, which the finding's
 * fix sketch names alongside task-c.
 *
 * Read-only against src/ — serves the freshly built dist/ on 4291.
 */

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, extname, resolve } from "node:path";

const DIST = join(process.cwd(), "dist");
const PORT = 4291;
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

const OUT = resolve("shots/_diag_sw2_taskc");
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readState(page) {
  return page.evaluate(() => {
    const ball = window.__wp1.ballScreen();
    const panels = [];
    for (const el of document.querySelectorAll(".hud.panel, #minimap-panel")) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) < 0.05) continue;
      const b = el.getBoundingClientRect();
      if (b.width < 2 || b.height < 2) continue;
      panels.push({ id: el.id, l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom), bg: cs.backgroundColor });
    }
    const underEl = ball ? document.elementFromPoint(ball.x, ball.y) : null;
    const under = !ball ? "no-ball"
      : underEl === null ? "none"
      : (underEl.closest(".hud.panel")?.id ?? underEl.id ?? underEl.tagName);
    const f = window.__wp1.fit();
    return {
      scene: window.__wp1.scene(),
      step: window.__wp1.step(),
      ball: ball ? { x: +ball.x.toFixed(1), y: +ball.y.toFixed(1) } : null,
      under,
      underTag: underEl ? `${underEl.tagName}#${underEl.id}` : null,
      panels,
      fit: { w: +f.w.toFixed(3), b: +f.b.toFixed(3) },
      loss: +window.__wp1.loss().toFixed(3),
      frameX: window.__wp1.layout().frameX,
      locked: window.__wp1.locked(),
      animating: window.__wp1.animating(),
    };
  });
}

/** Wait until lock/entry drained AND ballScreen holds still ~1.2s (nudge ease). */
async function settle(page, cap = 25000) {
  const t0 = Date.now();
  for (;;) {
    await sleep(250);
    const st = await page.evaluate(() => ({
      locked: window.__wp1.locked(),
      animating: window.__wp1.animating(),
      ball: window.__wp1.ballScreen(),
    }));
    if (!st.locked && !st.animating && st.ball) {
      const a = await readState(page);
      await sleep(600);
      const b = await readState(page);
      if (a.ball && b.ball && Math.hypot(a.ball.x - b.ball.x, a.ball.y - b.ball.y) < 1) return b;
    }
    if (Date.now() - t0 > cap) return readState(page);
  }
}

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

for (const [w, h, step, tag] of [
  [1280, 800, 3, "task-c-1280"],
  [1440, 900, 3, "task-c-1440-control"],
  [1280, 800, 18, "tilt-a-1280"],
]) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto(`http://localhost:${PORT}/?step=${step}`, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__wp1, null, { timeout: 20000 });
  // Drain any lock the deep link opened (Skip when visible), like the finding's flow.
  for (let i = 0; i < 5; i++) {
    const l = await page.evaluate(() => window.__wp1.locked() || window.__wp1.animating());
    if (!l) break;
    await page.locator("#skip-btn:visible").click({ timeout: 1500 }).catch(() => {});
    await sleep(700);
  }
  const st = await settle(page);
  console.log(`\n== ${tag} (${w}x${h}) step=${st.step} scene=${st.scene} ==`);
  console.log(`ball=(${st.ball?.x},${st.ball?.y}) under="${st.under}" (${st.underTag}) frameX=${st.frameX}`);
  console.log(`panels: ${st.panels.map((p) => `${p.id} (${p.l},${p.t})-(${p.r},${p.b}) ${p.bg}`).join(" ; ") || "none"}`);
  const inPanel = st.panels.some((p) => st.ball && st.ball.x > p.l && st.ball.x < p.r && st.ball.y > p.t && st.ball.y < p.b);
  console.log(`ball-centre inside a visible panel: ${inPanel}`);

  // Real mouse drag from the ball to ball+(60,+30) — the finding's gesture.
  if (!st.ball) { console.log("drag: SKIPPED (no ball)"); continue; }
  const before = { fit: st.fit, loss: st.loss };
  await page.mouse.move(st.ball.x, st.ball.y);
  await page.mouse.down();
  await page.mouse.move(st.ball.x + 60, st.ball.y + 30, { steps: 20 });
  await sleep(80);
  const mid = await readState(page);
  await page.mouse.up();
  await sleep(400);
  const after = await readState(page);
  const moved = Math.abs(after.fit.w - before.fit.w) + Math.abs(after.fit.b - before.fit.b) > 0.02;
  const midUnder = mid.under === "no-ball" ? null : mid.under;
  console.log(`drag: fit ${before.fit.w},${before.fit.b} -> ${after.fit.w},${after.fit.b} loss ${before.loss} -> ${after.loss} moved=${moved}`);
  console.log(`drag-mid: ball=(${mid.ball?.x},${mid.ball?.y}) under="${midUnder}"`);
  await page.screenshot({ path: join(OUT, `${tag}.png`) });
}
await browser.close();
srv.close();
console.log("\ndone");
