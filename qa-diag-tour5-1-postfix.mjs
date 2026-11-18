/**
 * qa-diag-tour5-1-postfix.mjs — TOUR5-1 post-fix verification (the shipped
 * CSS, not injected): the gate chip gets #tour-bar-full's width cap and
 * wraps instead of spilling. At a 900px pane the §7 blind-gate chip must
 * (a) sit fully inside the viewport and the CANVAS pane (no spill off-screen
 * left / into the reader), (b) not overlap the swarm dock, (c) clear the
 * raised controller bar with a gap; at 1280×800 the same constraints hold
 * one-line. Walks the real §7 tour to the blindToggled gate at both
 * viewports. Serves the freshly built dist on :4235.
 */
import { chromium } from "playwright";
import { launchGL } from "./tools/gl-launch.mjs";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, extname, resolve } from "node:path";

const DIST = join(process.cwd(), "dist");
const PORT = 4235;
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff",
};
const srv = createServer((req, res) => {
  let p = req.url.split("?")[0];
  if (p === "/" || p === "") p = "/index.html";
  const file = join(DIST, p);
  if (!existsSync(file)) { res.writeHead(404).end("no"); return; }
  res.writeHead(200, { "content-type": MIME[extname(file) ?? ""] ?? "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r, rej) => { srv.once("error", rej); srv.listen(PORT, () => r()); });
console.log(`serving dist on :${PORT}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) fails++;
};

const browser = await launchGL(chromium);

async function driveToBlindGate(width, height, tag) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await page.goto(`http://localhost:${PORT}/?step=18`, { waitUntil: "load" });
  await sleep(1700);
  for (let i = 0; i < 60; i++) {
    const a = await page.evaluate(() => ({ l: window.__wp1?.locked?.(), an: window.__wp1?.animating?.() }));
    if (!a.l && !a.an) break;
    await sleep(200);
  }
  await page.locator('.rstep[data-active="true"] .tour-launch').click();
  for (let i = 0; i < 60; i++) {
    const t = await page.evaluate(() => window.__wp1?.tour?.());
    if (t?.phase === "active" && t?.gate && t?.gateKind === "tiltSteered") break;
    await sleep(200);
  }
  for (let i = 0; i < 6; i++) {
    await page.keyboard.down("a"); await sleep(260); await page.keyboard.up("a");
    await sleep(120);
  }
  await page.locator("#tour-next").click();
  await sleep(900);
  await page.locator("#tour-next").click();
  for (let i = 0; i < 60; i++) {
    const t = await page.evaluate(() => window.__wp1?.tour?.());
    if (t?.phase === "active" && t?.gate && t?.gateKind === "ghostReplay") break;
    await sleep(200);
  }
  await page.click("#tilt-replay-play");
  for (let i = 0; i < 80; i++) {
    const t = await page.evaluate(() => window.__wp1?.tour?.());
    if (t?.phase === "active" && t?.stepIndex === 4 && t?.page === 21) break;
    await sleep(200);
  }
  await sleep(800);
  await page.locator("#tour-next").click();
  await sleep(900);
  await page.locator("#tour-next").click();
  let gate = null;
  for (let i = 0; i < 60; i++) {
    const t = await page.evaluate(() => window.__wp1?.tour?.());
    if (t?.phase === "active" && t?.gate && t?.gateKind === "blindToggled") { gate = t; break; }
    await sleep(200);
  }
  await sleep(900); // fades settle

  const m = await page.evaluate(() => {
    const rect = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width, h: r.height };
    };
    const chip = rect("#tour-gate-chip");
    const bar = rect("#tour-bar");
    const dock = rect("#swarm-dock");
    const reader = rect("#reader");
    const overlap = (a, b) =>
      a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    return {
      tour: window.__wp1?.tour?.() ?? null,
      chip, bar, dock,
      readerLeft: reader?.left ?? null,
      vw: window.innerWidth, vh: window.innerHeight,
      chipText: (document.querySelector("#tour-gate-chip")?.textContent ?? "").trim(),
      chipOn: document.querySelector("#tour-gate-chip")?.dataset.on ?? null,
      dockVis: document.querySelector("#swarm-dock")?.dataset.visible ?? null,
      chipOverDock: overlap(chip, dock),
      chipOverReader: chip && reader ? chip.right > reader.left + 1 : null,
      gapToBar: chip && bar ? Math.round((bar.top - chip.bottom) * 10) / 10 : null,
      wrapped: chip ? chip.h > 34 : null,
    };
  });
  console.log(`\n=== ${tag} @ ${width}x${height} ===`);
  console.log(JSON.stringify({
    gate: m.tour?.gate, gateKind: m.tour?.gateKind,
    chip: m.chip && { left: Math.round(m.chip.left), right: Math.round(m.chip.right), top: Math.round(m.chip.top), bottom: Math.round(m.chip.bottom), w: Math.round(m.chip.w), h: Math.round(m.chip.h) },
    barTop: m.bar && Math.round(m.bar.top), dock: m.dock && { top: Math.round(m.dock.top), bottom: Math.round(m.dock.bottom) },
    readerLeft: m.readerLeft && Math.round(m.readerLeft), gapToBar: m.gapToBar, wrapped: m.wrapped,
  }));
  check(`${tag}: blindToggled gate armed on the swarm page`, m.tour?.gate === true && m.tour?.gateKind === "blindToggled" && m.tour?.page === 21, JSON.stringify(m.tour));
  check(`${tag}: chip visible`, m.chipOn === "true" && m.chip && m.chip.w > 0, `chipOn=${m.chipOn} text="${m.chipText.slice(0, 50)}…"`);
  check(`${tag}: chip fully inside the VIEWPORT (no off-screen spill)`, m.chip && m.chip.left >= 8 && m.chip.right <= m.vw - 8, `left=${Math.round(m.chip?.left)} right=${Math.round(m.chip?.right)} vw=${m.vw}`);
  check(`${tag}: chip fully inside the CANVAS pane (no spill into the reader)`, m.chipOverReader === false, `chip.right=${Math.round(m.chip?.right)} reader.left=${Math.round(m.readerLeft)}`);
  check(`${tag}: chip capped at the controller pill's width`, m.chip && m.chip.w <= m.vw - (m.readerLeft ?? 0) - 24 + 1, `w=${Math.round(m.chip?.w)} cap=${Math.round(m.vw - (m.readerLeft ?? 0) - 24)}`);
  check(`${tag}: ZERO dock overlap (the demanded control is unobstructed)`, m.dockVis === "true" && m.chipOverDock === false, `dockVis=${m.dockVis} dock=${JSON.stringify(m.dock && { top: Math.round(m.dock.top), bottom: Math.round(m.dock.bottom) })} chip.y=${m.chip && `${Math.round(m.chip.top)}..${Math.round(m.chip.bottom)}`}`);
  check(`${tag}: chip clears the raised bar with a gap`, m.gapToBar !== null && m.gapToBar >= 8, `gap=${m.gapToBar}px`);
  await page.screenshot({ path: resolve("shots", `tour5-1-postfix-${width}x${height}.png`) });
  await page.close();
  return m;
}

await driveToBlindGate(900, 620, "T5-1 narrow");
await driveToBlindGate(1280, 800, "T5-1 wide");

await browser.close();
srv.close();
console.log(fails === 0 ? "\nTOUR5-1 POSTFIX: ALL CHECKS PASSED" : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
