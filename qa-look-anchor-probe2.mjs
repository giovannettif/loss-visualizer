/**
 * qa-look-anchor-probe2.mjs — trail-anchor divergence check (follow-up to
 * qa-look-anchor-probe.mjs, which measured the trail rows while the races
 * were still near the shared start). For each trail-bearing page, wait for
 * the race to develop (10s), then hover each trail sentence and compare the
 * anchors ACROSS optimizers — the arrows must land on DIFFERENT tips
 * (gd ≠ mom ≠ adam by tens of px), each stable across a re-hover.
 */

import { chromium } from "playwright";
import { launchGL } from "./tools/gl-launch.mjs";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";

const DIST = join(process.cwd(), "dist");
const PORT = 4215;
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
async function hoverAnchor(key) {
  const sel = `.rstep[data-active="true"] .sent[data-slook="${key}"]`;
  const n = await page.locator(sel).count();
  if (n === 0) return null;
  await page.hover(sel);
  await sleep(500);
  const p = await page.evaluate((k) => window.__wp1?.lookPoint?.(k) ?? null, key);
  await page.mouse.move(10, 10);
  await sleep(250);
  return p;
}

const PLAN = [
  { page: 7, keys: ["trail-gd"] },                 // gd-d: the four curated lanes
  { page: 8, keys: ["trail-gd", "trail-mom"] },    // mom-a
  { page: 10, keys: ["trail-mom"] },               // mom-c
  { page: 14, keys: ["trail-gd", "trail-adam"] },  // lab page 2
];

let failures = 0;
for (const { page: pg, keys } of PLAN) {
  await page.goto(`http://localhost:${PORT}/?step=${pg}`, { waitUntil: "load" });
  await sleep(1500);
  await waitIdle();
  await sleep(10000); // let the race develop so every trail's path diverges
  const seen = {};
  for (const key of keys) {
    const a1 = await hoverAnchor(key);
    const a2 = await hoverAnchor(key);
    seen[key] = { a1, a2 };
    const stable = a1 && a2 && Math.hypot(a1.x - a2.x, a1.y - a2.y) < 1.5;
    console.log(`${a1 && stable ? "ok  " : "FAIL"}  p${pg} ${key} anchor=(${a1?.x.toFixed(0)},${a1?.y.toFixed(0)}) rehover-drift=${a1 && a2 ? Math.hypot(a1.x - a2.x, a1.y - a2.y).toFixed(1) : "n/a"}px`);
    if (!a1 || !stable) failures += 1;
  }
  // Cross-optimizer separation: distinct trail keys must anchor apart.
  const ks = Object.keys(seen);
  for (let i = 0; i < ks.length; i++) {
    for (let j = i + 1; j < ks.length; j++) {
      const A = seen[ks[i]].a1;
      const B = seen[ks[j]].a1;
      const d = A && B ? Math.hypot(A.x - B.x, A.y - B.y) : 0;
      const ok = d >= 8;
      console.log(`${ok ? "ok  " : "FAIL"}  p${pg} separation ${ks[i]} ↔ ${ks[j]} = ${d.toFixed(0)}px`);
      if (!ok) failures += 1;
    }
  }
  await page.screenshot({ path: `qa-look-anchor-shots/trail-dev-p${pg}.png` });
}

await browser.close();
srv.close();
console.log(failures === 0 ? "PROBE_PASS" : `PROBE_FAILURES: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
