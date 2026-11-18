/**
 * qa-diag-s2b-anchor2-fixcheck.mjs — validate the S2B-ANCHOR-2 fix at
 * runtime (no src/ edits): while body[data-tour-live="s9"], hold
 * #epi-lattice-note above the chrome stack (bottom:130px) and animate the
 * settle. Re-measures note∩bar / note∩pill at s9 steps 4/5/6 + closing.
 *
 * Run: node qa-diag-s2b-anchor2-fixcheck.mjs [width height]
 */
import { chromium } from "playwright";
import { launchGL } from "./tools/gl-launch.mjs";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";

const W = Number(process.argv[2] ?? 1440);
const H = Number(process.argv[3] ?? 900);
const DIST = join(process.cwd(), "dist");
const PORT = 4192;
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
  const note = r("#epi-lattice-note");
  const bar = r("#tour-bar-full");
  const pill = r("#tour-status");
  const pillOn = document.querySelector("#tour-status")?.dataset.on;
  const minChip = r("#tour-bar-chip");
  return {
    scene: window.__wp1?.scene?.(),
    note, bar, pill, pillOn,
    noteAndBar: inter(note, bar),
    noteAndPill: inter(note, pill),
    noteAndMinChip: inter(note, minChip),
    gapNoteBottomToPillTop: note && pill ? Math.round(note.y + note.h <= pill.y + pill.h ? pill.y - (note.y + note.h) : null) : null,
  };
});

await page.locator('.rstep[data-active="true"] .tour-launch').click();
await new Promise((r) => setTimeout(r, 1800));

// The candidate fix, injected at runtime (page.css:1444 would carry it):
await page.evaluate(() => {
  const s = document.createElement("style");
  s.id = "anchor2-fix";
  s.textContent = `
    #epi-lattice-note { transition: bottom 0.35s var(--ease); }
    body[data-tour-live="s9"] #epi-lattice-note { bottom: 130px; }
  `;
  document.head.appendChild(s);
});

const log = [];
for (let i = 0; i < 3; i++) {
  await page.locator("#tour-next").click();
  await new Promise((r) => setTimeout(r, 1600));
}
log.push({ at: "step 4/6 (epi-b)", ...await measure() });
await page.screenshot({ path: `qa-diag-s2b-anchor2-${W}x${H}-FIX-step4.png` });
for (let i = 0; i < 2; i++) {
  await page.locator("#tour-next").click();
  await new Promise((r) => setTimeout(r, 1600));
}
log.push({ at: "step 6/6 (epi-c)", ...await measure() });
await page.locator("#tour-next").click();
await new Promise((r) => setTimeout(r, 700));
log.push({ at: "closing pill", ...await measure() });
await page.screenshot({ path: `qa-diag-s2b-anchor2-${W}x${H}-FIX-closing.png` });

// Minimized chip must also clear the lifted note.
await page.locator("#tour-min").click();
await new Promise((r) => setTimeout(r, 600));
log.push({ at: "minimized chip", ...await measure() });

console.log(JSON.stringify(log, null, 1));
await browser.close();
srv.close();
console.log("DONE");
