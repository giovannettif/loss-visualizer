/**
 * diag-l900-tilt-scorecard-trunc.mjs — L900-TILT-SCORECARD-TRUNC verification.
 *
 * Replays the finding's repro at its stated scale (dist on :4182):
 *   1. tilt-finish-900x700 — ?step=18, hold D, click Finish. Finding: the
 *      CELLS th truncates to 'CELL' (sw35>cw29) and the momentum FINAL L cell
 *      '−1.53e-4 ▸' overflows (sw68>cw62), clipping the ▸ marker.
 *   2. tilt-finish-900x900 — same flow, taller viewport.
 *   3. tiltb-900x700 / tiltb-900x900 — ?step=20 deep link (guided-demo
 *      scorecard), the finding's s20 deep links.
 *   4. tilt-finish-1600x900 — control (finding: header/cell fully visible).
 *
 * PASS criterion: no `#tilt-score th` or `#tilt-score tbody td` has
 * scrollWidth > clientWidth (+0.5px slack, the diag-sweep2-b.mjs threshold)
 * in any run. Screenshots land in shots/_diag_l900_tilt_scorecard/.
 *
 * Read-only against src/ — serves the freshly built dist/.
 */

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, extname } from "node:path";
import { launchGL } from "./gl-launch.mjs";

const DIST = join(process.cwd(), "dist");
const PORT = 4182;
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
console.log(`serving dist on :${PORT}`);

const OUT = join(process.cwd(), "shots", "_diag_l900_tilt_scorecard");
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fails = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) fails++;
}

const browser = await launchGL(chromium);

async function idle(page, ms = 12000) {
  const t0 = Date.now();
  for (;;) {
    const s = await page.evaluate(() => ({
      locked: window.__wp1.locked(),
      anim: window.__wp1.animating(),
    }));
    if (!s.locked && !s.anim) break;
    if (Date.now() - t0 > ms) break;
    await sleep(200);
  }
  await sleep(400);
}

/* Probe: per-cell sw/cw overflow + geometry of the 4 columns. */
async function probe(page) {
  return page.evaluate(() => {
    const cells = [...document.querySelectorAll("#tilt-score th, #tilt-score tbody td")];
    const overflow = cells
      .filter((c) => c.scrollWidth > c.clientWidth + 0.5)
      .map((c) => {
        const cls = c.className ? "." + c.className.trim().split(/\s+/).join(".") : "";
        return `${c.tagName.toLowerCase()}${cls} sw${c.scrollWidth}>cw${c.clientWidth} "${c.textContent}"`;
      });
    const ths = [...document.querySelectorAll("#tilt-score thead th")].map((th) => ({
      text: th.textContent,
      w: Math.round(th.getBoundingClientRect().width * 10) / 10,
      sw: th.scrollWidth,
      cw: th.clientWidth,
    }));
    const table = document.querySelector("#tilt-score table");
    const panel = document.querySelector("#tilt-panel");
    return {
      overflow,
      ths,
      tableW: Math.round(table.getBoundingClientRect().width * 10) / 10,
      panelW: Math.round(panel.getBoundingClientRect().width * 10) / 10,
      rows: [...document.querySelectorAll("#tilt-scorecard-body tr")].map((tr) =>
        [...tr.children].map((td) => td.textContent),
      ),
      thFont: getComputedStyle(document.querySelector("#tilt-score thead th")).fontSize,
      monoFont: getComputedStyle(document.querySelector("#tilt-scorecard-body td.mono")).fontSize,
    };
  });
}

async function openTiltA(w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await page.goto(`http://localhost:${PORT}/?step=18`, { waitUntil: "load" });
  await page.waitForFunction(
    () => { const b = document.querySelector("#boot"); return !b || b.dataset.done === "true"; },
    null, { timeout: 15000 },
  ).catch(() => {});
  await idle(page);
  // The finding's repro: hold D, click Finish (drive sequence as in
  // diag-sweep2-b.mjs §7 block).
  await page.mouse.click(700, 850);
  await page.keyboard.down("s"); await sleep(900); await page.keyboard.up("s");
  await page.keyboard.down("d"); await sleep(700); await page.keyboard.up("d");
  await page.evaluate(() => document.querySelector("#tilt-finish").click());
  await sleep(600);
  return page;
}

async function openTiltB(w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await page.goto(`http://localhost:${PORT}/?step=20`, { waitUntil: "load" });
  await page.waitForFunction(
    () => { const b = document.querySelector("#boot"); return !b || b.dataset.done === "true"; },
    null, { timeout: 15000 },
  ).catch(() => {});
  await idle(page);
  return page;
}

/* 1-2: the finding's repro at 900x700 and 900x900 */
for (const [w, h] of [[900, 700], [900, 900]]) {
  const page = await openTiltA(w, h);
  const r = await probe(page);
  console.log(`\n=== tilt-finish ${w}x${h} ===`);
  console.log(JSON.stringify(r, null, 1));
  check(
    `tilt-finish ${w}x${h}: no truncated scorecard cell`,
    r.overflow.length === 0,
    r.overflow.length ? r.overflow.join(" | ") : "clean",
  );
  await page.screenshot({ path: join(OUT, `tilt-finished-${w}x${h}.png`) });
  await page.close();
}

/* 3: tilt-b deep links */
for (const [w, h] of [[900, 700], [900, 900]]) {
  const page = await openTiltB(w, h);
  const r = await probe(page);
  console.log(`\n=== tiltb ${w}x${h} ===`);
  console.log(JSON.stringify(r, null, 1));
  check(
    `tiltb ${w}x${h}: no truncated scorecard cell`,
    r.overflow.length === 0,
    r.overflow.length ? r.overflow.join(" | ") : "clean",
  );
  await page.screenshot({ path: join(OUT, `tiltb-${w}x${h}.png`) });
  await page.close();
}

/* 4: control at the wide layout */
{
  const page = await openTiltA(1600, 900);
  const r = await probe(page);
  console.log(`\n=== tilt-finish 1600x900 (control) ===`);
  console.log(JSON.stringify(r, null, 1));
  check(
    "tilt-finish 1600x900 (control): no truncated scorecard cell",
    r.overflow.length === 0,
    r.overflow.length ? r.overflow.join(" | ") : "clean",
  );
  await page.screenshot({ path: join(OUT, "tilt-finished-1600x900.png") });
  await page.close();
}

await browser.close();
srv.close();
console.log(`\n${fails === 0 ? "ALL CHECKS PASS" : `${fails} CHECK(S) FAILED`}`);
process.exit(fails === 0 ? 0 : 1);
