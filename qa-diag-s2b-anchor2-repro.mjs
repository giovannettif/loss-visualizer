/**
 * qa-diag-s2b-anchor2-repro.mjs — reproduce S2B-ANCHOR-2: the §9
 * dimension-lattice caption (#epi-lattice-note) and the tour controller
 * (#tour-bar / #tour-status closing pill) share the bottom-center slot.
 *
 * Run: node qa-diag-s2b-anchor2-repro.mjs [width height]
 * Starts the s9 tour from ?step=24, Next×3 (→ step 4/6 on epi-b), then
 * Next×2 (→ 6/6 on epi-c) and Finish (→ closing pill); measures the note,
 * the bar and the pill rects + their intersection at each pause.
 */
import { chromium } from "playwright";
import { launchGL } from "./tools/gl-launch.mjs";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";

const W = Number(process.argv[2] ?? 1440);
const H = Number(process.argv[3] ?? 900);
const DIST = join(process.cwd(), "dist");
const PORT = 4191;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const srv = createServer((req, res) => {
  let p = req.url.split("?")[0];
  if (p === "/" || p === "") p = "/index.html";
  const file = join(DIST, p);
  if (!existsSync(file)) { res.writeHead(404).end("no"); return; }
  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r, rej) => { srv.once("error", rej); srv.listen(PORT, () => r()); });

const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.goto(`http://localhost:${PORT}/?step=24`, { waitUntil: "load" });
await new Promise((r) => setTimeout(r, 2600));

const measure = () => page.evaluate(() => {
  const r = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
  };
  const inter = (a, b) => {
    if (!a || !b) return null;
    const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
    if (x2 <= x1 || y2 <= y1) return null;
    return { w: Math.round(x2 - x1), h: Math.round(y2 - y1) };
  };
  const vis = (sel) => document.querySelector(sel)?.getAttribute("data-visible");
  const note = r("#epi-lattice-note .caption") ?? r("#epi-lattice-note");
  const noteWrap = r("#epi-lattice-note");
  const bar = r("#tour-bar-full");
  const pill = r("#tour-status");
  const chip = r("#tour-gate-chip");
  const barOn = document.querySelector("#tour-bar")?.dataset.on;
  return {
    scene: window.__wp1?.scene?.(),
    tour: window.__wp1?.tour?.(),
    noteVisible: vis("#epi-lattice-note"),
    note, noteWrap, bar, pill, chip, barOn,
    noteAndBar: inter(noteWrap, bar),
    noteAndPill: inter(noteWrap, pill),
    noteAndChip: inter(noteWrap, chip),
  };
});

await page.locator('.rstep[data-active="true"] .tour-launch').click();
await new Promise((r) => setTimeout(r, 1800));

const log = [];
for (let i = 0; i < 3; i++) {
  await page.locator("#tour-next").click();
  await new Promise((r) => setTimeout(r, 1600));
}
log.push({ at: "step 4/6 (epi-b)", ...await measure() });
await page.screenshot({ path: `qa-diag-s2b-anchor2-${W}x${H}-step4.png` });

for (let i = 0; i < 2; i++) {
  await page.locator("#tour-next").click();
  await new Promise((r) => setTimeout(r, 1600));
}
log.push({ at: "step 6/6 (epi-c)", ...await measure() });

await page.locator("#tour-next").click(); // Finish → closing pill
await new Promise((r) => setTimeout(r, 700));
log.push({ at: "closing pill", ...await measure() });
await page.screenshot({ path: `qa-diag-s2b-anchor2-${W}x${H}-closing.png` });

console.log(JSON.stringify(log, null, 1));
await browser.close();
srv.close();
console.log("DONE");
