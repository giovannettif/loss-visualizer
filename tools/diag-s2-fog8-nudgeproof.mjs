/**
 * diag-s2-fog8-nudgeproof.mjs — companion to diag-s2-fog8-underpanel.mjs:
 * catches the fognx/fogny tween keys in director.debugSnap IMMEDIATELY after
 * a stride commit (direct evidence computeFogPlayNudge engaged), and reads
 * the settled ball projection per stride at 1600x900.
 *
 * Read-only against src/ — serves dist/ on :4196.
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";

const DIST = join(process.cwd(), "dist");
const PORT = 4196;
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto(`http://localhost:${PORT}/?step=15`, { waitUntil: "load" });
for (let i = 0; i < 80; i++) {
  const a = await page.evaluate(() => ({ l: window.__wp1.locked(), a: window.__wp1.animating() }));
  if (!a.l && !a.a) break;
  await sleep(250);
}
await sleep(600);

const mmBox = await page.locator("#minimap-canvas").boundingBox();
const mm = { x: mmBox.x, y: mmBox.y, w: mmBox.width, h: mmBox.height };
const PAD = 18, PADB = 27;
const iw = mm.w - PAD - 8, ih = mm.h - PAD - PADB;
const s = Math.min(iw / 4, ih / 8);
const x0 = PAD + (iw - 4 * s) / 2, y0 = PAD + (ih - 8 * s) / 2;
const map = (p) => ({ x: mm.x + x0 + (p.x + 1) * s, y: mm.y + y0 + (5 - p.y) * s });
const tipPx = map({ x: -1, y: 5 });

for (let i = 1; i <= 3; i++) {
  const st = await page.evaluate(() => window.__wp1.fog().point);
  const fromPx = map(st);
  await page.mouse.move(fromPx.x, fromPx.y);
  await page.mouse.down();
  await page.mouse.move(tipPx.x, tipPx.y, { steps: 8 });
  await page.mouse.up();
  // sample the tween table while the walk/nudge is in flight
  const mid = await page.evaluate(() => ({
    tweens: window.__wp1.debug().tweens,
    ballMid: window.__wp1.ballScreen(),
  }));
  for (let k = 0; k < 60; k++) {
    const a = await page.evaluate(() => window.__wp1.animating());
    if (!a) break;
    await sleep(150);
  }
  await sleep(300);
  const end = await page.evaluate(() => ({
    ball: window.__wp1.ballScreen(),
    point: window.__wp1.fog().point,
    tweens: window.__wp1.debug().tweens,
  }));
  console.log(`stride ${i}: midTweens=${JSON.stringify(mid.tweens)} midBall=(${mid.ballMid?.x.toFixed(0)},${mid.ballMid?.y.toFixed(0)})`);
  console.log(`          settled ball=(${end.ball?.x.toFixed(1)},${end.ball?.y.toFixed(1)}) point=(${end.point.x.toFixed(2)},${end.point.y.toFixed(2)}) tweensAfter=${JSON.stringify(end.tweens)}`);
}
await browser.close();
srv.close();
