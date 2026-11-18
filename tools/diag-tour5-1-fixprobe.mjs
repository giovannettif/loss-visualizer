/**
 * diag-tour5-1-fixprobe.mjs — TOUR5-1 fix validation by injected CSS.
 *
 * Injects (page.addStyleTag, runtime only — no project file is edited) the
 * proposed fix for #tour-gate-chip / #tour-status:
 *   1. the #tour-bar-full cap: max-width: calc(100vw - var(--reader-w) - 24px)
 *      + white-space:normal + text-align:center (wrap instead of nowrap);
 *   2. a BRK-3-style raise while a gate/closing pill is live on the §7
 *      swarm page: bottom: 216px (= raised bar top 166 + 41 bar height + 9px
 *      gap).
 * Then walks the s7 tour to the blindToggled gate at 900×620 and re-measures
 * the same geometry the repro script measured, plus a 1280×800 control.
 *
 * PASS = chip fully inside the canvas pane (x >= 0, r <= reader.x), no
 * intersection with #swarm-dock, >= 8px clearance to #tour-bar-full.
 */

import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";

const DIST = join(process.cwd(), "dist");
const PORT = 4278;
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FIX_CSS = `
  #tour-gate-chip, #tour-status {
    max-width: calc(100vw - var(--reader-w) - 24px);
    white-space: normal;
    text-align: center;
    line-height: 1.45;
  }
  body:has(.rstep[data-active="true"][data-scene="swarm"]) #tour-gate-chip[data-on="true"],
  body:has(.rstep[data-active="true"][data-scene="swarm"]) #tour-status[data-on="true"] {
    bottom: 216px;
  }
`;

const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

async function waitIdle(maxMs = 25000) {
  const t0 = Date.now();
  for (;;) {
    const a = await page.evaluate(() => ({ l: window.__wp1?.locked?.(), a: window.__wp1?.animating?.() }));
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
    if (Date.now() - t0 > maxMs) { console.log(`  (timeout ${lbl}: ${JSON.stringify(s)})`); return s; }
    await sleep(120);
  }
}

async function walkToBlindGate() {
  await page.goto(`http://localhost:${PORT}/?step=18`, { waitUntil: "load" });
  await sleep(1700);
  if (!(await waitIdle())) console.log("WARN: entry still locked");
  await page.addStyleTag({ content: FIX_CSS });
  await page.locator('.rstep[data-active="true"] .tour-launch').click();
  await waitTour((s) => s.running && s.phase === "active", 12000, "start");
  await sleep(400);
  await page.keyboard.down("a"); await sleep(300); await page.keyboard.up("a");
  await waitTour((s) => s.phase === "active" && s.stepIndex === 1, 12000, "steer");
  await sleep(600);
  await page.locator("#tour-next").click();
  await waitTour((s) => s.phase === "active" && s.stepIndex === 2, 15000, "next1");
  await sleep(600);
  await page.locator("#tour-next").click();
  await waitTour((s) => s.phase === "active" && s.gateKind === "ghostReplay", 15000, "ghost");
  await sleep(400);
  await page.click("#tilt-replay-play");
  await waitTour((s) => s.phase === "active" && s.stepIndex === 4, 25000, "swarm");
  await sleep(700);
  await page.locator("#tour-next").click();
  await waitTour((s) => s.phase === "active" && s.stepIndex === 5, 15000, "beat5");
  await sleep(600);
  await page.locator("#tour-next").click();
  await waitTour((s) => s.phase === "active" && s.gateKind === "blindToggled", 15000, "blind gate");
  await sleep(800);
}

const measure = () =>
  page.evaluate(() => {
    const r = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1), r: +b.right.toFixed(1), b: +b.bottom.toFixed(1) };
    };
    return {
      vw: window.innerWidth, vh: window.innerHeight,
      chip: r("#tour-gate-chip"), reader: r("#reader"), marked: r("[data-tour-active]"),
      dock: r("#swarm-dock"), blindRow: r("#swarm-dock .toggle"),
      bar: r("#tour-bar-full"),
    };
  });

function judge(tag, m) {
  const c = m.chip, rd = m.reader, dk = m.dock, br = m.bar;
  const inside = c.x >= -0.5 && c.r <= rd.x + 0.5;
  const noDock = !(c.y < dk.b && dk.y < c.b && c.x < dk.r && dk.x < c.r);
  const noBlindRow = !(c.y < m.blindRow.b && m.blindRow.y < c.b && c.x < m.blindRow.r && m.blindRow.x < c.r);
  // The chip sits ABOVE the raised bar: clearance = bar top − chip bottom.
  const barGap = br ? +(br.y - c.b).toFixed(1) : null;
  const gapOk = barGap === null || barGap >= 8;
  const ok = inside && noDock && gapOk;
  console.log(`${ok ? "PASS" : "FAIL"}  ${tag}: chip ${c.x}..${c.r} y ${c.y}..${c.b} (w=${c.w} h=${c.h}) | reader.x=${rd.x} | dock y ${dk.y}..${dk.b}`);
  console.log(`      inside pane=${inside}  no dock overlap=${noDock}  clears blind toggle row=${noBlindRow}  gap to raised bar=${barGap}px (>=8: ${gapOk})`);
  return ok;
}

let ok = true;
await walkToBlindGate();
ok = judge("fix-injected @ 900×620", await measure()) && ok;
await page.screenshot({ path: "qa-diag/tour5-1-fixprobe-900x620.png" });

await page.setViewportSize({ width: 1280, height: 800 });
await sleep(1200);
ok = judge("fix-injected @ 1280×800 (same gate)", await measure()) && ok;
await page.screenshot({ path: "qa-diag/tour5-1-fixprobe-1280x800.png" });

await browser.close();
srv.close();
console.log(ok ? "\nFIX_PROBE_ALL_PASS" : "\nFIX_PROBE_FAILED");
process.exit(ok ? 0 : 1);
