/**
 * qa-trail-tip-introspect.mjs — one-page interrogation: on mom-a (?step=8),
 * compute the real run paths the same way director.ts does and compare with
 * what lookPoint returns for trail-gd / trail-mom. Answers whether the
 * identical anchors are (a) genuinely coinciding run tips or (b) a lookup
 * bug. Also probes the lab page (?step=14) for trail-gd vs trail-adam.
 */

import { chromium } from "playwright";
import { launchGL } from "./tools/gl-launch.mjs";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";

const DIST = join(process.cwd(), "dist");
const PORT = 4216;
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

const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

async function waitIdle(maxMs = 25000) {
  const t0 = Date.now();
  for (;;) {
    const a = await page.evaluate(() => ({
      locked: window.__wp1?.locked?.(),
      animating: window.__wp1?.animating?.(),
    }));
    if (!a.locked && !a.animating) return true;
    if (Date.now() - t0 > maxMs) return false;
    await sleep(200);
  }
}

await page.goto(`http://localhost:${PORT}/?step=8`, { waitUntil: "load" });
await sleep(1500);
await waitIdle();
await sleep(2000);

const mom = await page.evaluate(() => {
  const out = { lookGd: null, lookMom: null, ball: null, momState: null };
  out.lookGd = window.__wp1.lookPoint("trail-gd");
  out.lookMom = window.__wp1.lookPoint("trail-mom");
  out.ball = window.__wp1.ballScreen();
  out.momState = window.__wp1.mom();
  // Reproduce the two run paths with the app's own bundled optimizers is not
  // possible from the page scope; instead interrogate the minimap canvas
  // paths the director just drew (same runs) — momState carries the paths if
  // exposed; print whatever it has:
  return out;
});
console.log("mom-a lookPoint(trail-gd) =", JSON.stringify(mom.lookGd));
console.log("mom-a lookPoint(trail-mom)=", JSON.stringify(mom.lookMom));
console.log("mom-a ballScreen          =", JSON.stringify(mom.ball));
console.log("mom-a momState            =", JSON.stringify(mom.momState).slice(0, 400));

// Wait for the §8 lab page and interrogate the same way.
await page.goto(`http://localhost:${PORT}/?step=14`, { waitUntil: "load" });
await sleep(1500);
await waitIdle();
await sleep(2000);
const lab = await page.evaluate(() => ({
  lookGd: window.__wp1.lookPoint("trail-gd"),
  lookAdam: window.__wp1.lookPoint("trail-adam"),
  labState: window.__wp1.lab(),
}));
console.log("lab lookPoint(trail-gd)  =", JSON.stringify(lab.lookGd));
console.log("lab lookPoint(trail-adam)=", JSON.stringify(lab.lookAdam));
console.log("lab labState             =", JSON.stringify(lab.labState).slice(0, 300));

await browser.close();
srv.close();
