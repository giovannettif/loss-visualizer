/**
 * diag-l900-tilt-scorecard-trunc2.mjs — L900-TILT-SCORECARD-TRUNC, round 2.
 *
 * Round 1 (diag-l900-tilt-scorecard-trunc.mjs) did NOT reproduce: the finding
 * ran on the committed (HEAD) CSS — base columns 34/22/14/30, letter-spacing
 * 0.04em, padding 3px, 13.5px mono — while the working tree ships a narrow
 * fix batch (32/19/16/33 + letter-spacing 0 + 11px mono + 9.5px ▸). The
 * finding's measured cw29/cw62 match HEAD's 14%/30% columns exactly.
 *
 * This round:
 *   1. state-match — the finding's exact scorecard STATE on the current
 *      build: ?step=18, level 2 Rosenbrock, hold s+d, Finish, at 900x700 and
 *      900x900 (the r23 evidence state).
 *   2. head-styles — inject HEAD's width/letter-spacing/padding/font rules
 *      into the live page and re-measure, to confirm the finding's numbers
 *      (th sw35>cw29, td.mono sw68>cw62) arise from the HEAD-era CSS.
 *   3. slack report — per-td sw/cw slack on the current build, to size any
 *      residual risk (valley's e-18 values are the longest FINAL L strings).
 *
 * PASS (current build): no overflow in state-match runs. The head-styles
 * probe is expected to FAIL (reproduce the finding) — that confirms the
 * diagnosis rather than the build.
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

async function probe(page) {
  return page.evaluate(() => {
    const desc = (c) => {
      const cls = c.className ? "." + c.className.trim().split(/\s+/).join(".") : "";
      return `${c.tagName.toLowerCase()}${cls} sw${c.scrollWidth}>cw${c.clientWidth} "${c.textContent}"`;
    };
    const cells = [...document.querySelectorAll("#tilt-score th, #tilt-score tbody td")];
    return {
      overflow: cells.filter((c) => c.scrollWidth > c.clientWidth + 0.5).map(desc),
      slack: cells.map((c) => ({ t: c.textContent, sw: c.scrollWidth, cw: c.clientWidth })),
    };
  });
}

/* The finding's scorecard STATE: rosenbrock picked, real steered run, finish. */
async function openFinishedRosen(w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await page.goto(`http://localhost:${PORT}/?step=18`, { waitUntil: "load" });
  await page.waitForFunction(
    () => { const b = document.querySelector("#boot"); return !b || b.dataset.done === "true"; },
    null, { timeout: 15000 },
  ).catch(() => {});
  await idle(page);
  await page.evaluate(() => document.querySelector('.tilt-levels [data-level="rosen"]').click());
  await sleep(1500);
  await idle(page);
  await page.mouse.click(700, 850);
  await page.keyboard.down("s"); await sleep(900); await page.keyboard.up("s");
  await page.keyboard.down("d"); await sleep(700); await page.keyboard.up("d");
  await page.evaluate(() => document.querySelector("#tilt-finish").click());
  await sleep(600);
  return page;
}

/* 1: state-match on the current build */
for (const [w, h] of [[900, 700], [900, 900]]) {
  const page = await openFinishedRosen(w, h);
  const r = await probe(page);
  console.log(`\n=== state-match (rosen + finish) ${w}x${h} — current build ===`);
  console.log(JSON.stringify(r));
  check(
    `state-match ${w}x${h}: no truncated scorecard cell (current build)`,
    r.overflow.length === 0,
    r.overflow.length ? r.overflow.join(" | ") : "clean",
  );
  await page.screenshot({ path: join(OUT, `rosen-finished-${w}x${h}.png`) });

  /* 2: inject HEAD-era styles on the same live scorecard */
  await page.evaluate(() => {
    const st = document.createElement("style");
    st.id = "head-era-styles";
    st.textContent = `
      #tilt-score .scorecard th:nth-child(1), #tilt-score .scorecard td:nth-child(1) { width: 34%; }
      #tilt-score .scorecard th:nth-child(2), #tilt-score .scorecard td:nth-child(2) { width: 22%; }
      #tilt-score .scorecard th:nth-child(3), #tilt-score .scorecard td:nth-child(3) { width: 14%; }
      #tilt-score .scorecard th:nth-child(4), #tilt-score .scorecard td:nth-child(4) { width: 30%; }
      #tilt-score .scorecard th { letter-spacing: 0.04em; padding: 6px 3px; font-size: 10px; }
      #tilt-score .scorecard td { padding: 7px 3px; }
      #tilt-score .scorecard td.mono { font-size: 13.5px; }
      #tilt-score .scorecard td.mono[data-best="true"]::after { font-size: 11px; }
    `;
    document.head.appendChild(st);
  });
  await sleep(150);
  const old = await probe(page);
  console.log(`=== same page with HEAD-era styles injected ===`);
  console.log(JSON.stringify(old));
  check(
    `head-styles ${w}x${h}: reproduces the finding's truncation (expected FAIL)`,
    old.overflow.length === 0,
    old.overflow.length ? old.overflow.join(" | ") : "clean (finding NOT reproduced by HEAD styles)",
  );
  await page.screenshot({ path: join(OUT, `rosen-finished-${w}x${h}-headstyles.png`) });
  await page.evaluate(() => document.getElementById("head-era-styles").remove());
  await page.close();
}

await browser.close();
srv.close();
console.log(`\n${fails === 0 ? "ALL CHECKS PASS" : `${fails} CHECK(S) FAILED`}`);
process.exit(fails === 0 ? 0 : 1);
