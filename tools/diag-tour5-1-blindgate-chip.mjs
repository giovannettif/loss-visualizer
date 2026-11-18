/**
 * diag-tour5-1-blindgate-chip.mjs — TOUR5-1 repro.
 *
 * Finding: on the §7 swarm page (reader page 22/27), the s7 tour's last
 * step (7/7, blindToggled gate) shows #tour-gate-chip with white-space:nowrap
 * and NO max-width, centered at calc((100% - var(--reader-w))/2). At 900×620
 * the chip is ~511px wide on a 432px canvas pane: head clipped off-screen
 * left, tail painted into the reader pane over the marked sentence, and the
 * body slicing the #swarm-dock between the landscape pills (#swarm-maps) and
 * the replay/scrub transport (#swarm-replay) — the very dock the copy
 * points at.
 *
 * Harness: serve dist statically (the tools/diag-*.mjs pattern; equivalent
 * to `vite preview` for a built dist), ?step=18, start the s7 tour, steer
 * with "a", Next×2 (click #tour-next), release the ghost gate via
 * #tilt-replay-play, Next×2 → blindToggled gate. Measure chip vs reader /
 * marked sentence / dock / dock rows / raised bar. Then re-measure at
 * 1280×800 (control) with the gate still open. Read-only against src/.
 */

import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, extname, resolve } from "node:path";

const DIST = join(process.cwd(), "dist");
const PORT = 4277;
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
await new Promise((r, rej) => {
  srv.once("error", rej);
  srv.listen(PORT, () => r());
});
console.log(`serving dist on :${PORT}`);

const outDir = resolve("qa-diag");
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

async function waitIdle(maxMs = 25000) {
  const t0 = Date.now();
  for (;;) {
    const a = await page.evaluate(() => ({
      l: window.__wp1?.locked?.(),
      a: window.__wp1?.animating?.(),
    }));
    if (!a.l && !a.a) return true;
    if (Date.now() - t0 > maxMs) return false;
    await sleep(200);
  }
}
async function waitTour(pred, maxMs = 30000, lbl = "") {
  const t0 = Date.now();
  for (;;) {
    const s = await page.evaluate(() => window.__wp1?.tour?.());
    if (s && pred(s)) return s;
    if (Date.now() - t0 > maxMs) {
      console.log(`  (timeout ${lbl}: ${JSON.stringify(s)})`);
      return s;
    }
    await sleep(120);
  }
}

const geom = () =>
  page.evaluate(() => {
    const r = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1), r: +b.right.toFixed(1), b: +b.bottom.toFixed(1) };
    };
    const cs = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const c = getComputedStyle(el);
      return { whiteSpace: c.whiteSpace, maxWidth: c.maxWidth, left: c.left, bottom: c.bottom, transform: c.transform, fontSize: c.fontSize };
    };
    return {
      vw: window.innerWidth, vh: window.innerHeight,
      readerW: getComputedStyle(document.documentElement).getPropertyValue("--reader-w").trim(),
      chip: r("#tour-gate-chip"), chipCs: cs("#tour-gate-chip"),
      chipText: (document.querySelector("#tour-gate-chip")?.textContent ?? "").trim(),
      chipOn: document.querySelector("#tour-gate-chip")?.dataset.on,
      statusCs: cs("#tour-status"),
      reader: r("#reader"),
      marked: r("[data-tour-active]"),
      dock: r("#swarm-dock"), maps: r("#swarm-maps"), replay: r("#swarm-replay"),
      blindRow: r("#swarm-dock .toggle"),
      bar: r("#tour-bar"), barFull: r("#tour-bar-full"),
      page: window.__wp1?.page?.() ?? null,
      scene: window.__wp1?.scene?.() ?? null,
    };
  });

function report(tag, m) {
  console.log(`\n=== ${tag} ===`);
  console.log(JSON.stringify(m, null, 2));
  const c = m.chip, rd = m.reader, mk = m.marked, dk = m.dock;
  if (!c || !c.w) { console.log("chip not open/visible"); return; }
  console.log(`-- verdicts --`);
  console.log(`chip ${c.x}..${c.r} (w=${c.w}) y ${c.y}..${c.b} | reader.x=${rd?.x} | pane=${m.vw - (rd?.x ?? 0)}px`);
  console.log(`clipped off-screen left : ${c.x < -0.5}   (chip.x=${c.x})`);
  console.log(`tail over reader pane   : ${c.r > rd.x + 0.5}   (chip.r=${c.r})`);
  console.log(`over the MARKED sentence: ${c.r > mk.x && c.y < mk.b && mk.y < c.b}   (marked.x=${mk.x}, marked y ${mk.y}..${mk.b})`);
  const overDock = c.y < dk.b && dk.y < c.b && c.x < dk.r && dk.x < c.r;
  console.log(`overlaps #swarm-dock    : ${overDock}   (dock ${dk.x}..${dk.r} y ${dk.y}..${dk.b})`);
  const overMaps = c.y < m.maps.b && m.maps.y < c.b && c.x < m.maps.r && m.maps.x < c.r;
  const overReplay = c.y < m.replay.b && m.replay.y < c.b && c.x < m.replay.r && m.replay.x < c.r;
  console.log(`  slices maps row       : ${overMaps}   (maps y ${m.maps.y}..${m.maps.b})`);
  console.log(`  slices transport row  : ${overReplay}  (replay y ${m.replay.y}..${m.replay.b})`);
  console.log(`  between rows          : ${!overMaps && !overReplay && overDock}   (between maps.b=${m.maps.b} and replay.y=${m.replay.y})`);
  const cap = m.vw - (rd?.x ?? 0) - 24;
  console.log(`#tour-bar-full-style cap would be ${cap}px; chip w=${c.w} exceeds it: ${c.w > cap}`);
  console.log(`bar (BRK-3) bottom computed: ${m.barFull ? "raised " + JSON.stringify({ y: m.barFull.y, b: m.barFull.b }) : "n/a"}`);
}

/* ---- repro at 900×620 ---- */
await page.goto(`http://localhost:${PORT}/?step=18`, { waitUntil: "load" });
await sleep(1700);
if (!(await waitIdle())) console.log("WARN: §7 entry still locked");
await page.locator('.rstep[data-active="true"] .tour-launch').click();
await waitTour((s) => s.running && s.phase === "active", 12000, "tour start");
await sleep(500);
// gate 1 (tiltSteered): steer out with "a"
await page.keyboard.down("a"); await sleep(300); await page.keyboard.up("a");
await waitTour((s) => s.phase === "active" && s.stepIndex === 1, 12000, "steer release");
await sleep(700);
await page.locator("#tour-next").click();
await waitTour((s) => s.phase === "active" && s.stepIndex === 2, 15000, "next1");
await sleep(700);
await page.locator("#tour-next").click();
await waitTour((s) => s.phase === "active" && s.gateKind === "ghostReplay", 15000, "ghost gate");
await sleep(500);
await page.click("#tilt-replay-play");
await waitTour((s) => s.phase === "active" && s.stepIndex === 4, 25000, "swarm page");
await sleep(800);
await page.locator("#tour-next").click();
await waitTour((s) => s.phase === "active" && s.stepIndex === 5, 15000, "scorecard beat");
await sleep(700);
await page.locator("#tour-next").click();
await waitTour((s) => s.phase === "active" && s.gateKind === "blindToggled", 15000, "blind gate");
await sleep(800); // fade settles

report("TOUR5-1 repro @ 900×620 (blindToggled gate, page 22/27, step 7/7)", await geom());
await page.screenshot({ path: resolve(outDir, "tour5-1-blindgate-900x620.png") });

/* ---- control: same gate, viewport widened to 1280×800 ---- */
await page.setViewportSize({ width: 1280, height: 800 });
await sleep(1200);
report("control @ 1280×800 (same gate still open)", await geom());
await page.screenshot({ path: resolve(outDir, "tour5-1-blindgate-1280x800.png") });

await browser.close();
srv.close();
console.log("\nDONE");
