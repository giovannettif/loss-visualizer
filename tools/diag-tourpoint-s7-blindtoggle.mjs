/**
 * diag-tourpoint-s7-blindtoggle.mjs — TOUR-POINT-S7-BLINDTOGGLE-DOCK repro.
 *
 * The finding: s7 tour step 7/7 (page 21, the "ensembles (many restarts)
 * cover ground faster…" sentence) uses look "tilt-panel" (the top-left HUD)
 * while its gate demands ticking #swarm-blind in #swarm-dock (bottom-left
 * of the canvas). The leader should terminate on the toggle's panel, not
 * the opposite corner.
 *
 * Harness: serve dist on :4233, ?step=18, start the s7 tour, steer out of
 * gate 1 with "a", Next×2, release gate 3 via #tilt-replay-play, Next×2,
 * measure #tour-dot vs #tilt-panel / #swarm-dock / #swarm-blind rects.
 * Read-only against src/.
 */

import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, extname, resolve } from "node:path";

const DIST = join(process.cwd(), "dist");
const PORT = 4233;
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

const outDir = resolve("shots");
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

async function tourState() {
  return page.evaluate(() => window.__wp1?.tour?.() ?? null);
}
async function waitTour(pred, maxMs = 20000, label = "tour state") {
  const t0 = Date.now();
  let s = null;
  for (;;) {
    s = await tourState();
    if (s && pred(s)) return s;
    if (Date.now() - t0 > maxMs) {
      console.log(`  (timeout waiting for ${label}: ${JSON.stringify(s)})`);
      return s;
    }
    await sleep(120);
  }
}
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

const geom = () =>
  page.evaluate(() => {
    const dot = document.querySelector("#tour-dot");
    const rect = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const ax = dot ? Number(dot.getAttribute("cx")) : null;
    const ay = dot ? Number(dot.getAttribute("cy")) : null;
    const inRect = (x, y, r) => r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
    const dock = rect("#swarm-dock");
    const blind = rect("#swarm-blind");
    const panel = rect("#tilt-panel");
    const d = (r) => (r && ax !== null ? Math.round(Math.hypot(ax - (r.x + r.w / 2), ay - (r.y + r.h / 2))) : null);
    return {
      anchor: { x: ax, y: ay },
      overlayOn: document.querySelector("#tour-overlay")?.dataset.on,
      gateLabel: document.querySelector("#tour-gate-chip")?.textContent ?? null,
      gateOn: document.querySelector("#tour-gate-chip")?.dataset.on ?? null,
      panel, dock, blind,
      anchorInPanel: inRect(ax, ay, panel),
      anchorInDock: inRect(ax, ay, dock),
      anchorInBlind: inRect(ax, ay, blind),
      dPanelCenter: d(panel),
      dDockCenter: d(dock),
      dBlindCenter: d(blind),
      dockVisible: document.querySelector("#swarm-dock")?.dataset.visible ?? null,
      scene: window.__wp1?.scene?.(),
      sentence: (document.querySelector("[data-tour-active]")?.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 90),
    };
  });

await page.goto(`http://localhost:${PORT}/?step=18`, { waitUntil: "load" });
await sleep(1600);
if (!(await waitIdle())) console.log("WARN: still locked after entry");
{
  const scene = await page.evaluate(() => window.__wp1.scene());
  console.log(`boot: scene=${scene}`);

  await page.locator('.rstep[data-active="true"] .tour-launch').click();
  // step 1/7 (idx 0): gate tiltSteered — steer with "a".
  const s0 = await waitTour((x) => x.phase === "active" && x.gate && x.gateKind === "tiltSteered", 20000, "tiltSteered gate");
  console.log("step1 gate:", JSON.stringify({ stepIndex: s0.stepIndex, count: s0.count, gateKind: s0.gateKind }));
  for (let i = 0; i < 6; i++) {
    await page.keyboard.down("a"); await sleep(260); await page.keyboard.up("a");
    await sleep(120);
  }
  const s1 = await waitTour((x) => x.phase === "active" && !x.gate, 10000, "steer release");
  console.log("after steer:", JSON.stringify({ stepIndex: s1.stepIndex, gate: s1.gate }));

  // Next×2 → idx 2, then idx 3 (gate ghostReplay).
  await page.keyboard.press("Space"); await sleep(900);
  await page.keyboard.press("Space"); await sleep(900);
  const s3 = await waitTour((x) => x.gate && x.gateKind === "ghostReplay", 10000, "ghostReplay gate");
  console.log("gate2:", JSON.stringify({ stepIndex: s3.stepIndex, gateKind: s3.gateKind }));
  await page.locator("#tilt-replay-play").click();
  const s4 = await waitTour((x) => x.phase === "active" && !x.gate && x.stepIndex === 4, 15000, "release → idx 4");
  console.log("after replay:", JSON.stringify({ stepIndex: s4.stepIndex, gate: s4.gate }));

  // Next×2 → idx 5, idx 6 (the blind-toggle gate).
  await page.keyboard.press("Space"); await sleep(900);
  await page.keyboard.press("Space"); await sleep(900);
  const s6 = await waitTour((x) => x.gate && x.gateKind === "blindToggled", 10000, "blindToggled gate");
  console.log("final step:", JSON.stringify({ stepIndex: s6.stepIndex, count: s6.count, gateKind: s6.gateKind, gateLabel: s6.gateLabel, lookKey: s6.lookKey }));
  await sleep(800); // fades settle

  const g = await geom();
  console.log("GEOMETRY (s7 step 7/7, blindToggled gate):");
  console.log(JSON.stringify(g, null, 2));
  await page.screenshot({ path: resolve(outDir, "tourpoint-s7-blindtoggle.png") });
}

await browser.close();
srv.close();
console.log("DONE");
