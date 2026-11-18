/**
 * diag-s1-hud-orbit.mjs — S1-BALL-UNDER-HUD residual: user orbit on task-c.
 * Right-drag orbits (LandscapeView onPointerDown button===2). Grip in the
 * CLEAR lower pane (the 900x700 canvas center is covered by #loss-panel).
 * After each swing + settle: is the ball under a HUD panel, and grabbable?
 * hudNudgeDirty is NOT set by user orbit, so no recompute is expected.
 * Serves dist/ on 4287.
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, extname, resolve } from "node:path";
const DIST = join(process.cwd(), "dist");
const PORT = 4287;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png" };
const srv = createServer((req, res) => {
  let p = req.url.split("?")[0];
  if (p === "/" || p === "") p = "/index.html";
  const file = join(DIST, p);
  if (!existsSync(file)) { res.writeHead(404).end("no"); return; }
  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => srv.listen(PORT, () => r(srv)));
const OUT = resolve("shots/_diag_s1_hud");
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readState(page) {
  return page.evaluate(() => {
    const ball = window.__wp1.ballScreen();
    const under = ball ? (() => {
      const el = document.elementFromPoint(ball.x, ball.y);
      if (!el) return "none";
      const panel = el.closest(".hud.panel, #hud-left");
      return panel ? panel.id ?? panel.className : el.id || el.tagName;
    })() : "no-ball";
    const f = window.__wp1.fit();
    return { ball: ball ? { x: +ball.x.toFixed(1), y: +ball.y.toFixed(1) } : null, under,
      fit: { w: +f.w.toFixed(3), b: +f.b.toFixed(3) },
      locked: window.__wp1.locked(), animating: window.__wp1.animating() };
  });
}
async function settleBall(page, cap = 12000) {
  const t0 = Date.now();
  let last = await readState(page);
  for (;;) {
    await sleep(300);
    const cur = await readState(page);
    if (!cur.locked && !cur.animating && cur.ball && last.ball &&
        Math.hypot(cur.ball.x - last.ball.x, cur.ball.y - last.ball.y) < 0.4) return cur;
    last = cur;
    if (Date.now() - t0 > cap) return cur;
  }
}
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto(`http://localhost:${PORT}/?step=3`, { waitUntil: "load" });
console.log("base:", JSON.stringify(await settleBall(page)));

// grip point: bottom strip of the canvas pane, right of the ball, clear of panels
const grip = await page.evaluate(() => {
  const r = document.querySelector(".lv-canvas").getBoundingClientRect();
  const tryPt = (x, y) => {
    const el = document.elementFromPoint(x, y);
    return el && el.classList.contains("lv-canvas") ? { x, y } : null;
  };
  return tryPt(r.left + r.width - 60, r.top + r.height - 60) ??
         tryPt(r.left + r.width / 2, r.top + r.height - 40) ?? { x: r.left + 30, y: r.top + r.height - 30 };
});
console.log("orbit grip:", JSON.stringify(grip));

for (const [dx, dy, tag] of [[-300, 0, "azim-ccw"], [300, 0, "azim-cw"], [-260, -140, "azim-up"], [0, 180, "elev-down"], [-420, 0, "azim-far"]]) {
  await page.mouse.move(grip.x, grip.y);
  await page.mouse.down({ button: "right" });
  for (let s = 1; s <= 8; s++) {
    await page.mouse.move(grip.x + (dx * s) / 8, grip.y + (dy * s) / 8);
    await sleep(25);
  }
  await page.mouse.up({ button: "right" });
  const end = await settleBall(page);
  console.log(`orbit ${tag}: ball=(${end.ball?.x},${end.ball?.y}) under="${end.under}" fit=(${end.fit.w},${end.fit.b})`);
  await page.screenshot({ path: join(OUT, `orbit2-${tag}.png`) });
}
await browser.close();
srv.close();
console.log("done");
