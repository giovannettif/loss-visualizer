/**
 * diag-s2-scorecard-spoiler.mjs — repro for QA finding
 * S2-SWARM-SCORECARD-PRECOMPUTED-SPOILER on the CURRENT tree.
 *
 * Beats (from the finding):
 *  A. ?step=21 at 1600x900, no input — the swarm line / cluster scorecard
 *     must NOT show the final result while balls are still scattered
 *     (counts accumulate as balls arrive).
 *  B. Click #swarm-blind — after the rewind the panel must read
 *     "0 cells painted · 0 minima found" with NO named cluster rows,
 *     not "7 minima found" + six named rows over a black map.
 *
 * Read-only against src/ — serves dist/ on :4198.
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";

const DIST = join(process.cwd(), "dist");
const PORT = 4198;
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
const bootQ = process.argv[2] ?? "?step=21";
const frozen = bootQ.includes("shot=");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto(`http://localhost:${PORT}/${bootQ}`, { waitUntil: "load" });
if (frozen) {
  await sleep(2500); // frozen posters: no reader lock to wait out
} else {
  for (let i = 0; i < 80; i++) {
    const a = await page.evaluate(() => ({ l: window.__wp1.locked(), a: window.__wp1.animating() }));
    if (!a.l && !a.a) break;
    await sleep(250);
  }
}

const read = () =>
  page.evaluate(() => {
    const line = document.querySelector("#tilt-swarm-line");
    const cl = document.querySelector("#tilt-swarm-clusters");
    const sw = window.__wp1.swarm();
    return {
      scene: window.__wp1.scene(),
      step: window.__wp1.step(),
      line: line ? line.textContent : null,
      lineHidden: line ? line.hidden : null,
      clustersHidden: cl ? cl.hidden : null,
      clusterRows: cl
        ? [...cl.querySelectorAll("li:not(.tc-more)")].map((li) => li.textContent)
        : [],
      swarm: sw && {
        arrived: sw.arrived, playing: sw.playing, time: Math.round(sw.time * 100) / 100,
        blind: sw.blind, painted: sw.painted, minimaFound: sw.minimaFound,
        clusterCounts: sw.clusters.map((c) => `${c.name}×${c.count}`),
      },
    };
  });

// ---- Beat A: visible mode, the first frames of the ride ----
const a0 = await read();
console.log("A t0   :", JSON.stringify(a0));
await sleep(770);
const a77 = await read();
console.log("A t.77 :", JSON.stringify(a77));
await page.screenshot({ path: "qa-diag-a-1500.png" });

// wait for the ride to end (delay(99)+7s ≈ 8.43s), then the over-state
for (let i = 0; i < 60; i++) {
  const s = await page.evaluate(() => window.__wp1.swarm());
  if (s && !s.playing) break;
  await sleep(400);
}
const aEnd = await read();
console.log("A end  :", JSON.stringify(aEnd));

// ---- Beat B: blind mode — rewind must clear the scorecard ----
if (!frozen) {
  await page.click("#swarm-blind");
  await sleep(180); // the finding's t=0.18s beat
}
const b0 = await read();
console.log("B t.18 :", JSON.stringify(b0));
await page.screenshot({ path: "qa-diag-c-blind-0.png" });

// ---- verdicts ----
const badA =
  (a0.swarm.arrived === 0 && /in a basin/.test(a0.line ?? "")) ||
  a0.clusterRows.length > 0 ||
  (a77.swarm && a77.clusterRows.length > 0 && !/rolling|stalled/.test(a77.line ?? "") === false);
const rowsSum = (r) =>
  r.clusterRows.reduce((n, t) => n + (Number((t.match(/×(\d+)/) ?? [])[1]) || 0), 0);
const overA =
  a77.swarm && rowsSum(a77) > a77.swarm.arrived;
const badB =
  /minima found/.test(b0.line ?? "") && !/0 minima found/.test(b0.line ?? "") ||
  (b0.clusterRows.length > 0 && b0.swarm.painted === 0);
console.log("VERDICT beatA first-frame spoiler:", badA ? "REPRODUCED" : "clean");
console.log("VERDICT beatA rows>arrived:", overA ? "REPRODUCED" : "clean");
console.log("VERDICT beatB blind spoiler:", badB ? "REPRODUCED" : "clean");
await browser.close();
srv.close();
