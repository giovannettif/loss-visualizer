/**
 * diag-s1-hud-ball.mjs — S1-BALL-UNDER-HUD reproduction at the finding's scales.
 *
 * (a) ?step=3 (task-c, risen surface) at 900x700 / 1280x720 / 1280x800
 *     (+ 1440x900 and 1600x900 as controls): after the entry drains and the
 *     framing settles, is __wp1.ballScreen() covered by #fit-panel /
 *     #loss-panel (elementFromPoint), and is the ball grabbable at all?
 * (b) 1440x900: grab the ball, drag straight up in 11px steps past the
 *     surface silhouette; per step log fit / ball pos / cursor-to-ball
 *     distance / what element is under the ball. After release: is the ball
 *     still visible and grabbable?
 *
 * Read-only against src/ — serves the freshly built dist/ on 4285.
 */

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, extname, resolve } from "node:path";

const DIST = join(process.cwd(), "dist");
const PORT = 4285;
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

const OUT = resolve("shots/_diag_s1_hud");
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readState(page) {
  return page.evaluate(() => {
    const ball = window.__wp1.ballScreen();
    const under = ball
      ? (() => {
          const el = document.elementFromPoint(ball.x, ball.y);
          if (!el) return "none";
          const panel = el.closest(".hud.panel, #hud-left");
          return panel ? panel.id ?? panel.className : el.id || el.tagName;
        })()
      : "no-ball";
    const rect = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { l: +r.left.toFixed(1), t: +r.top.toFixed(1), r: +r.right.toFixed(1), b: +r.bottom.toFixed(1), vis: el.dataset?.visible };
    };
    const f = window.__wp1.fit();
    return {
      scene: window.__wp1.scene(),
      step: window.__wp1.step(),
      ball: ball ? { x: +ball.x.toFixed(1), y: +ball.y.toFixed(1) } : null,
      under,
      fitPanel: rect("#fit-panel"),
      lossPanel: rect("#loss-panel"),
      hudLeft: rect("#hud-left"),
      fit: { w: +f.w.toFixed(3), b: +f.b.toFixed(3) },
      loss: +window.__wp1.loss().toFixed(2),
      frameX: window.__wp1.layout().frameX,
      locked: window.__wp1.locked(),
      animating: window.__wp1.animating(),
    };
  });
}

/** Wait until lock/entry drained AND ballScreen holds still ~1.2s (nudge ease). */
async function settle(page, cap = 20000) {
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

/* ---------------- part (a): static framing vs HUD ---------------- */
for (const [w, h] of [[900, 700], [1280, 720], [1280, 800], [1440, 900], [1600, 900]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto(`http://localhost:${PORT}/?step=3`, { waitUntil: "load" });
  const st = await settle(page);
  const grab = st.under === "no-ball" ? false : !(typeof st.under === "string" && st.under.includes("panel"));
  console.log(`[${w}x${h}] scene=${st.scene} ball=(${st.ball?.x},${st.ball?.y}) under="${st.under}" ` +
    `fitPanel=${JSON.stringify(st.fitPanel)} lossPanel=${JSON.stringify(st.lossPanel)} ` +
    `fit=(${st.fit.w},${st.fit.b}) loss=${st.loss} frameX=${st.frameX} grabbable=${grab}`);
  await page.screenshot({ path: join(OUT, `a-${w}x${h}.png`) });

  /* ---------------- part (b): drag up past the silhouette (1440x900 only) */
  if (w === 1440 && h === 900) {
    if (st.under.includes("panel") || !st.ball) {
      console.log("  (b) SKIPPED: ball starts under a panel — cannot grab");
    } else {
      const bx = st.ball.x, by = st.ball.y;
      await page.mouse.move(bx, by);
      await page.mouse.down();
      console.log(`  (b) grab at (${bx.toFixed(0)},${by.toFixed(0)}) fit=(${st.fit.w},${st.fit.b})`);
      let prevFit = st.fit;
      for (let i = 1; i <= 25; i++) {
        const cy = by - 11 * i;
        await page.mouse.move(bx, cy);
        await sleep(40);
        const s = await readState(page);
        const d = s.ball ? Math.hypot(s.ball.x - bx, s.ball.y - cy) : NaN;
        const jump = Math.abs(s.fit.w - prevFit.w) + Math.abs(s.fit.b - prevFit.b) > 0.15;
        console.log(`  step ${String(i).padStart(2)}: cursor=(${bx},${cy}) ball=(${s.ball?.x},${s.ball?.y}) ` +
          `dist=${d.toFixed(1)}px under="${s.under}" fit=(${s.fit.w},${s.fit.b})${jump ? "  <-- FIT JUMP" : ""}`);
        prevFit = s.fit;
      }
      await page.mouse.up();
      await sleep(400);
      const end = await readState(page);
      const grabbable = !end.under.includes("panel") && end.under !== "none" && end.under !== "no-ball";
      console.log(`  (b) after release: ball=(${end.ball?.x},${end.ball?.y}) under="${end.under}" ` +
        `fit=(${end.fit.w},${end.fit.b}) loss=${end.loss} grabbable=${grabbable}`);
      await page.screenshot({ path: join(OUT, "b-1440-after.png") });
      // Recovery grab: can the ball still be picked up and moved?
      if (grabbable && end.ball) {
        await page.mouse.move(end.ball.x, end.ball.y);
        await page.mouse.down();
        await page.mouse.move(end.ball.x + 30, end.ball.y + 10, { steps: 5 });
        await sleep(60);
        const rec = await readState(page);
        const moved = Math.hypot(rec.fit.w - end.fit.w, rec.fit.b - end.fit.b) > 0.02 ||
          (rec.ball && end.ball && Math.hypot(rec.ball.x - end.ball.x, rec.ball.y - end.ball.y) > 5);
        await page.mouse.up();
        console.log(`  (b) recovery grab moved the fit: ${moved}`);
      }
    }
  }
}
await browser.close();
srv.close();
console.log("done");
