/**
 * qa-look-anchor-probe.mjs — regression-2 audit: for EVERY registered hover
 * sentence (data-slook) across §1-5 (?step=1..14), hover it in free play and
 * measure, in viewport px:
 *
 *   anchor   = window.__wp1.lookPoint(key)          (the raw target)
 *   clamp    = anchor clamped to [12, w-12]×[12, h-12]  (anchorOverlay's clamp)
 *   tip      = the drawn arrowhead apex   (#tour-arrow polygon point 0)
 *   dot      = the drawn focal dot center (#tour-dot cx/cy)
 *   tipDist  = |tip − clamp|   (must be ~0: the overlay pins the tip there)
 *   dotDist  = |dot − clamp|   (must be ~0)
 *   edge     = anchor raw vs viewport (outside ⇒ the clamp pinned an edge —
 *              the "arrow pointing at nothing" shape)
 *   DOM containment: for registry targets that name a DOM element, the
 *   anchor must land INSIDE that element's rect (±2px) — the semantic check
 *   that the arrow points at the named instrument/control, not at a scene
 *   point or a panel gap.
 *
 * Read-only against src/ — serves the freshly built dist/ on a private port.
 * Writes per-sentence screenshots to qa-look-anchor-shots/.
 */

import { chromium } from "playwright";
import { launchGL } from "./tools/gl-launch.mjs";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, extname, resolve } from "node:path";

const DIST = join(process.cwd(), "dist");
const PORT = 4214;
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
mkdirSync("qa-look-anchor-shots", { recursive: true });

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

/** The registered (page, para, sent, lookKey, DOM target selector) rows of
 *  §1-5 — mirrors TOURS in src/view/tourEngine.ts. domSel: the element the
 *  anchor must land inside (null = scene projection target). */
const ROWS = [
  { page: 1, key: "fit-inset", domSel: "#fit-panel" },
  { page: 1, key: "loss-readout", domSel: "#loss-panel" },
  { page: 2, key: "needle", domSel: "#minimap-canvas" },
  { page: 3, key: "ball", domSel: null },
  { page: 4, key: "needle", domSel: "#minimap-canvas" },
  { page: 5, key: "compass", domSel: "#minimap-canvas" },
  { page: 5, key: "gd-step", domSel: null },
  { page: 6, key: "eta-slider", domSel: "#eta-slider" },
  { page: 7, key: "trail-gd", domSel: null },
  { page: 8, key: "trail-gd", domSel: null },
  { page: 8, key: "trail-mom", domSel: null },
  { page: 8, key: "beta-slider", domSel: "#beta-slider" },
  { page: 9, key: "mom-apexes", domSel: null },
  { page: 10, key: "trail-mom", domSel: null },
  { page: 11, key: "adam-bars", domSel: "#adam-panel .bar-row" },
  { page: 11, key: "adam-arrows", domSel: null },
  { page: 12, key: "steep-slider", domSel: "#steep-slider" },
  { page: 13, key: "lab-sliders", domSel: "#lab-sliders" },
  { page: 13, key: "lab-checklist", domSel: "#lab-checklist" },
  { page: 14, key: "trail-gd", domSel: null },
  { page: 14, key: "trail-adam", domSel: null },
];

const hypot = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

let failures = 0;
const bad = [];
for (const row of ROWS) {
  await page.goto(`http://localhost:${PORT}/?step=${row.page}`, { waitUntil: "load" });
  await sleep(1500);
  await waitIdle();
  // §2 gd-b's gd-step target exists only after a committed user arrow —
  // draw one first so the sentence's hover has its live target.
  if (row.key === "gd-step") {
    const box = await page.locator("#minimap-canvas").boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx + 10, cy + 40);
    await page.mouse.down();
    await page.mouse.move(cx + 62, cy + 80, { steps: 8 });
    await page.mouse.up();
    await sleep(1300);
    await waitIdle();
  }
  const sel = `.rstep[data-active="true"] .sent[data-slook="${row.key}"]`;
  const n = await page.locator(sel).count();
  if (n === 0) {
    console.log(`FAIL  p${row.page} ${row.key}: no sentence span found (${sel})`);
    failures += 1;
    bad.push(`p${row.page}:${row.key}:no-span`);
    continue;
  }
  await page.hover(sel);
  await sleep(500); // motion gate (150ms) + overlay re-anchor
  const m = await page.evaluate((key) => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const raw = window.__wp1?.lookPoint?.(key) ?? null;
    const arrow = document.querySelector("#tour-arrow");
    const dot = document.querySelector("#tour-dot");
    const pts = (arrow?.getAttribute("points") ?? "").trim().split(/\s+/)[0] ?? "";
    const [tx, ty] = pts.split(",").map(Number);
    const cx = Number(dot?.getAttribute("cx"));
    const cy = Number(dot?.getAttribute("cy"));
    return {
      w, h, raw,
      overlayOn: document.querySelector("#tour-overlay")?.dataset.on,
      tip: Number.isFinite(tx) ? { x: tx, y: ty } : null,
      dot: Number.isFinite(cx) ? { x: cx, y: cy } : null,
      look: window.__wp1?.look?.(),
    };
  }, row.key);
  const shot = `qa-look-anchor-shots/p${row.page}-${row.key.replace(/[^a-z0-9-]/gi, "_")}.png`;
  await page.screenshot({ path: resolve(shot) });

  const label = `p${row.page} ${row.key}`;
  if (!m.raw) {
    console.log(`FAIL  ${label}: lookPoint null (overlay=${m.overlayOn}) — target absent`);
    failures += 1;
    bad.push(`${label}:null-anchor`);
    continue;
  }
  const clamp = {
    x: Math.min(Math.max(m.raw.x, 12), m.w - 12),
    y: Math.min(Math.max(m.raw.y, 12), m.h - 12),
  };
  const tipDist = m.tip ? hypot(m.tip.x, m.tip.y, clamp.x, clamp.y) : -1;
  const dotDist = m.dot ? hypot(m.dot.x, m.dot.y, clamp.x, clamp.y) : -1;
  const offscreen = m.raw.x < 0 || m.raw.y < 0 || m.raw.x > m.w || m.raw.y > m.h;
  const clamped = Math.abs(m.raw.x - clamp.x) > 0.5 || Math.abs(m.raw.y - clamp.y) > 0.5;

  // DOM containment: the anchor must land inside EVERY selector's rect
  // (panelChild passes a child selector — test against the union rect).
  const dom = await page.evaluate((sel2) => {
    const els = [...document.querySelectorAll(sel2)];
    if (els.length === 0) return { found: false };
    const rs = els.map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
    if (rs.length === 0) return { found: false, hidden: true };
    const l = Math.min(...rs.map((r) => r.left));
    const r = Math.max(...rs.map((r) => r.right));
    const t = Math.min(...rs.map((r) => r.top));
    const b = Math.max(...rs.map((r) => r.bottom));
    return { found: true, rect: { l, r, t, b } };
  }, row.domSel);
  let domOut = null;
  if (row.domSel && dom.found && !dom.hidden && m.raw) {
    const M = 2;
    const outside =
      m.raw.x < dom.rect.l - M || m.raw.x > dom.rect.r + M ||
      m.raw.y < dom.rect.t - M || m.raw.y > dom.rect.b + M;
    if (outside) {
      domOut = hypot(
        m.raw.x, m.raw.y,
        Math.min(Math.max(m.raw.x, dom.rect.l), dom.rect.r),
        Math.min(Math.max(m.raw.y, dom.rect.t), dom.rect.b),
      );
    }
  }

  const problems = [];
  if (m.overlayOn !== "true") problems.push(`overlay off (${m.overlayOn})`);
  if (!m.tip) problems.push("no arrowhead drawn");
  else if (tipDist > 0.5) problems.push(`tipDist=${tipDist.toFixed(1)}px`);
  if (!m.dot) problems.push("no focal dot");
  else if (dotDist > 0.5) problems.push(`dotDist=${dotDist.toFixed(1)}px`);
  if (offscreen) problems.push(`anchor offscreen (${m.raw.x.toFixed(0)},${m.raw.y.toFixed(0)})`);
  else if (clamped) problems.push(`anchor clamped to edge (raw ${m.raw.x.toFixed(0)},${m.raw.y.toFixed(0)})`);
  if (domOut !== null) problems.push(`anchor ${domOut.toFixed(0)}px outside ${row.domSel} rect`);
  if (row.domSel && !dom.found) problems.push(`dom target ${row.domSel} not found/hidden`);

  const line = `${problems.length === 0 ? "ok  " : "FAIL"}  ${label} anchor=(${m.raw.x.toFixed(0)},${m.raw.y.toFixed(0)}) tipDist=${tipDist.toFixed(1)} dotDist=${dotDist.toFixed(1)}${domOut !== null ? ` domOut=${domOut.toFixed(0)}px` : ""}`;
  console.log(line + (problems.length ? ` — ${problems.join("; ")}` : ""));
  if (problems.length > 0) {
    failures += 1;
    bad.push(`${label}:${problems.join(";")}`);
  }
  await page.mouse.move(10, 10);
  await sleep(300);
}

console.log(bad.length ? `\nBAD: ${bad.join(" | ")}` : "\nALL_ANCHORS_OK");
await browser.close();
srv.close();
console.log(failures === 0 ? "PROBE_PASS" : `PROBE_FAILURES: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
