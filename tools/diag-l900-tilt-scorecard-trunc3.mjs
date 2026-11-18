/**
 * diag-l900-tilt-scorecard-trunc3.mjs — L900-TILT-SCORECARD-TRUNC, round 3.
 *
 * Completes the render matrix on the CURRENT build: the r23 evidence's
 * tilt-b state (played rosen run preserved across ArrowDown ×2 from a
 * finished tilt-a), probed at 900x700 and 900x900 — plus visual crops of
 * the current-build scorecards. PASS: no cell with sw > cw (+0.5px).
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
      locked: window.__wp1?.locked?.() ?? true,
      anim: window.__wp1?.animating?.() ?? true,
    }));
    if (!s.locked && !s.anim) break;
    if (Date.now() - t0 > ms) break;
    await sleep(200);
  }
  await sleep(400);
}

async function probe(page) {
  return page.evaluate(() => {
    const cells = [...document.querySelectorAll("#tilt-score th, #tilt-score tbody td")];
    const overflow = cells
      .filter((c) => c.scrollWidth > c.clientWidth + 0.5)
      .map((c) => {
        const cls = c.className ? "." + c.className.trim().split(/\s+/).join(".") : "";
        return `${c.tagName.toLowerCase()}${cls} sw${c.scrollWidth}>cw${c.clientWidth} "${c.textContent}"`;
      });
    return {
      overflow,
      rows: [...document.querySelectorAll("#tilt-scorecard-body tr")].map((tr) =>
        [...tr.children].map((td) => td.textContent),
      ),
      scene: window.__wp1.scene(),
    };
  });
}

for (const [w, h] of [[900, 700], [900, 900]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await page.goto(`http://localhost:${PORT}/?step=18`, { waitUntil: "load" });
  await page.waitForFunction(
    () => { const b = document.querySelector("#boot"); return !b || b.dataset.done === "true"; },
    null, { timeout: 15000 },
  ).catch(() => {});
  await idle(page);
  // Play a real run on rosen, finish, then carry it to tilt-b (r23 state).
  await page.evaluate(() => document.querySelector('.tilt-levels [data-level="rosen"]').click());
  await sleep(1500);
  await idle(page);
  await page.mouse.click(700, 850);
  await page.keyboard.down("s"); await sleep(900); await page.keyboard.up("s");
  await page.keyboard.down("d"); await sleep(700); await page.keyboard.up("d");
  await page.evaluate(() => document.querySelector("#tilt-finish").click());
  await sleep(600);
  await page.keyboard.press("ArrowDown"); await idle(page);
  await page.keyboard.press("ArrowDown"); await idle(page);
  const r = await probe(page);
  console.log(`\n=== tiltb-with-run ${w}x${h} — current build ===`);
  console.log(JSON.stringify(r));
  check(
    `tiltb-with-run ${w}x${h}: on tilt-b with the preserved run`,
    r.scene === "tilt-b" && r.rows[0]?.[0] === "you (tilt)",
    JSON.stringify({ scene: r.scene, firstRow: r.rows[0]?.[0] }),
  );
  check(
    `tiltb-with-run ${w}x${h}: no truncated scorecard cell (current build)`,
    r.overflow.length === 0,
    r.overflow.length ? r.overflow.join(" | ") : "clean",
  );
  await page.screenshot({ path: join(OUT, `tiltb-run-${w}x${h}.png`) });
  await page.close();
}

await browser.close();
srv.close();
console.log(`\n${fails === 0 ? "ALL CHECKS PASS" : `${fails} CHECK(S) FAILED`}`);
process.exit(fails === 0 ? 0 : 1);
