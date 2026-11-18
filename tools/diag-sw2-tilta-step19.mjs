/**
 * diag-sw2-tilta-step19.mjs — companion to diag-sw2-tilta-1280.mjs: deep link
 * ?step=19 (the second §7 play reader step, same tilt-a scene) at 1280x800,
 * skip + settle, read ballScreen vs #tilt-panel. Finding
 * SW2-LW24-TILTA-BALL-UNDER-TILTPANEL-1280 cites steps 18-19.
 */
import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";

const DIST = join(process.cwd(), "dist");
const PORT = 4196;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".woff2": "font/woff2" };
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
const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto(`http://localhost:${PORT}/?step=19`, { waitUntil: "load" });
await sleep(700);
const shown = await page.evaluate(() => {
  const b = document.querySelector("#skip-btn");
  return b && !b.hidden && b.getBoundingClientRect().width > 0;
});
if (shown) { await page.click("#skip-btn"); console.log("[skip] clicked"); }
for (let i = 0; i < 60; i++) {
  const st = await page.evaluate(() => ({ locked: window.__wp1.locked(), animating: window.__wp1.animating() }));
  if (!st.locked && !st.animating) break;
  await sleep(100);
}
await sleep(500);
const s = await page.evaluate(() => {
  const pr = document.querySelector("#tilt-panel").getBoundingClientRect();
  const b = window.__wp1.ballScreen();
  const el = b ? document.elementFromPoint(b.x, b.y) : null;
  return {
    scene: window.__wp1.scene(), step: window.__wp1.step(),
    ball: b ? { x: +b.x.toFixed(1), y: +b.y.toFixed(1) } : null,
    panel: { l: +pr.left.toFixed(1), t: +pr.top.toFixed(1), r: +pr.right.toFixed(1), b: +pr.bottom.toFixed(1) },
    hit: el ? `${el.tagName}#${el.id}` : "none",
  };
});
console.log(JSON.stringify(s));
console.log("insidePanel:", s.ball && s.ball.x > s.panel.l && s.ball.x < s.panel.r && s.ball.y > s.panel.t && s.ball.y < s.panel.b);
await browser.close();
srv.close();
