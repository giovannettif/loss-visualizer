/**
 * qa-diag-s7-scrubber-postfix.mjs — TOUR-POINT-S7-SCRUBBER-SCORECARD
 * post-fix verification: the s7 step 4/7 (page 20, ghostReplay gate) now
 * carries look "tilt-replay" (kind panelPart → #tilt-replay). The leader
 * dot must land INSIDE the transport row (dotDist 0), not on the scorecard
 * rows above it. Same drive as the finding's repro: ?step=18 → chip →
 * steer → Next×2 → the ghost gate. Serves the freshly built dist on :4234.
 */
import { chromium } from "playwright";
import { launchGL } from "./tools/gl-launch.mjs";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, extname, resolve } from "node:path";

const DIST = join(process.cwd(), "dist");
const PORT = 4234;
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
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

await page.goto(`http://localhost:${PORT}/?step=18`, { waitUntil: "load" });
await sleep(1600);
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
let gate = null;
for (let i = 0; i < 60; i++) {
  const t = await page.evaluate(() => window.__wp1?.tour?.());
  if (t?.phase === "active" && t?.gate && t?.gateKind === "ghostReplay") { gate = t; break; }
  await sleep(200);
}
await sleep(800); // fades settle

const out = await page.evaluate(() => {
  const dot = document.querySelector("#tour-dot");
  const d = dot ? { x: +dot.getAttribute("cx"), y: +dot.getAttribute("cy") } : null;
  const rect = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  };
  const dist = (p, r) => r && p
    ? Math.round(Math.hypot(Math.max(r.x - p.x, 0, p.x - (r.x + r.w)), Math.max(r.y - p.y, 0, p.y - (r.y + r.h))))
    : null;
  const inside = (p, r) => r && p && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  const hit = d ? document.elementFromPoint(d.x, d.y) : null;
  const hitInRow = (() => {
    let el = hit;
    while (el) { if (el.id === "tilt-replay") return true; el = el.parentElement; }
    return false;
  })();
  return {
    tour: window.__wp1?.tour?.() ?? null,
    dot: d,
    overlayOn: document.querySelector("#tour-overlay")?.dataset.on,
    replayRow: rect("#tilt-replay"),
    replayPlay: rect("#tilt-replay-play"),
    scorecard: rect("#tilt-score"),
    dReplayRow: dist(d, rect("#tilt-replay")),
    dReplayPlay: dist(d, rect("#tilt-replay-play")),
    inReplayRow: inside(d, rect("#tilt-replay")),
    atDot: hit ? `${hit.tagName}${hit.id ? "#" + hit.id : ""}.${String(hit.className ?? "").slice(0, 24)}` : null,
    hitInRow,
  };
});
console.log(JSON.stringify({
  tour: { idx: out.tour?.stepIndex, gate: out.tour?.gate, gateKind: out.tour?.gateKind, lookKey: out.tour?.lookKey, page: out.tour?.page },
  dot: out.dot, overlayOn: out.overlayOn, replayRow: out.replayRow, atDot: out.atDot,
}, null, 2));
check("S7-SCRUB: gate armed on step 4/7 (page 20)", out.tour?.stepIndex === 3 && out.tour?.gateKind === "ghostReplay", JSON.stringify(out.tour));
check("S7-SCRUB: lookKey is tilt-replay (was tilt-panel)", out.tour?.lookKey === "tilt-replay", `lookKey=${out.tour?.lookKey}`);
check("S7-SCRUB: leader dot INSIDE the #tilt-replay transport row (was 133px away on the momentum row)", out.inReplayRow === true && out.dReplayRow === 0, `dot=${JSON.stringify(out.dot)} row=${JSON.stringify(out.replayRow)} dist=${out.dReplayRow}`);
check("S7-SCRUB: element at the dot is inside #tilt-replay", out.hitInRow === true, `atDot=${out.atDot}`);
check("S7-SCRUB: overlay live", out.overlayOn === "true", `overlay=${out.overlayOn}`);
await page.screenshot({ path: resolve("shots", "s7-scrubber-postfix.png") });

await browser.close();
srv.close();
console.log(fails === 0 ? "\nS7-SCRUB POSTFIX: ALL CHECKS PASSED" : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
