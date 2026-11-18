/**
 * diag-copy2-tilt-units.mjs — QA COPY2-TILT-STEPS-CELLS-NOT-SAME-PAIR re-check.
 *
 * The finding (2026-11-04 QA report): the tilt-a step-2 copy promised the
 * scorecard's steps+cells were "the same pair of numbers an optimizer is
 * graded by", but machine rows showed "—" for cells, the steps column mixed
 * the player's 120 Hz physics substeps with the machines' 400 update
 * iterations AND ranked them (400 marked best); "decays within a few steps"
 * was wrong in substep units (at c=1.2, 1/e needs ~100 substeps ≈ 0.83 s).
 *
 * Repro (finding verbatim): dist served at /?step=18, viewport 1600×900,
 * hold D for 0.7 s, hold S for 0.5 s, click #tilt-finish, read
 * #tilt-scorecard-body.
 *
 * PASS = every machine row has a numeric cells value (not "—"); no
 * steps/cells td ever carries data-best (gold lives in the loss column
 * only); the steps header documents the two units; the copy states the
 * different-unit rule and never says "same pair of numbers"; the damping
 * sentence says "within a second or so", not "within a few steps"; and the
 * decay claim is numerically true across the c slider range.
 *
 * Read-only against src/ — serves the freshly built dist/ on a private port.
 */

import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, extname, resolve } from "node:path";

const DIST = join(process.cwd(), "dist");
const PORT = 4197;
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = resolve("qa", "COPY2-TILT-STEPS-CELLS-NOT-SAME-PAIR-r2");
mkdirSync(OUT, { recursive: true });

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

/* ---------------- the finding's repro, verbatim ---------------- */

await page.goto(`http://localhost:${PORT}/?step=18`, { waitUntil: "load" });
await page.waitForTimeout(800);
for (let i = 0; i < 40; i++) {
  const a = await page.evaluate(() => ({
    locked: window.__wp1.locked(),
    animating: window.__wp1.animating(),
  }));
  if (!a.locked && !a.animating) break;
  await sleep(250);
}
check("live: scene is tilt-a", (await page.evaluate(() => window.__wp1.scene())) === "tilt-a");

await page.keyboard.down("d");
await sleep(700); // finding: hold D for 0.7 s
await page.keyboard.up("d");
await page.keyboard.down("s");
await sleep(500); // finding: hold S for 0.5 s
await page.keyboard.up("s");
await sleep(300);

const steered = await page.evaluate(() => window.__wp1.tilt().steered);
check("live: run is steered (graded, not demo)", steered === true);

await page.click("#tilt-finish");
await sleep(400);
const done = await page.evaluate(() => window.__wp1.tilt().done);
check("live: Finish ends the run", done === true);
const scoreVisible = await page.evaluate(() => !document.querySelector("#tilt-score").hidden);
check("live: scorecard block visible", scoreVisible === true);

/* ---------------- the scorecard itself ---------------- */

const table = await page.evaluate(() => {
  const head = [...document.querySelectorAll("#tilt-score thead th")].map((th) => ({
    text: th.textContent.trim(),
    title: th.getAttribute("title") ?? "",
  }));
  const rows = [...document.querySelectorAll("#tilt-scorecard-body tr")].map((tr) =>
    [...tr.querySelectorAll("td")].map((td) => ({
      text: td.textContent.trim(),
      best: td.dataset.best === "true",
    })),
  );
  return { head, rows };
});
console.log("header:", JSON.stringify(table.head));
for (const r of table.rows) console.log("row:", JSON.stringify(r));

check("scorecard: 4 rows (you + GD + momentum + Adam)", table.rows.length === 4, `rows=${table.rows.length}`);
check(
  "scorecard: header order is run·steps·cells·final L",
  table.head.length === 4 && /steps/.test(table.head[1].text) && /cells/.test(table.head[2].text) && /L/.test(table.head[3].text),
  JSON.stringify(table.head.map((h) => h.text)),
);

// Finding fix option 1: give the machines a cells count.
const machines = table.rows.slice(1);
for (const r of machines) {
  check(
    `scorecard: machine "${r[0].text}" has a numeric cells value (not "—")`,
    /^\d+$/.test(r[2].text),
    `cells=${r[2].text}`,
  );
}
// Finding fix option 1 (second half): say player steps are physics substeps.
check(
  "scorecard: steps header documents both units",
  /physics substeps/i.test(table.head[1].title) && /update iterations/i.test(table.head[1].title),
  JSON.stringify(table.head[1].title),
);

// Player steps (120 Hz substeps) and machine steps (400 iterations) differ
// in magnitude — allowed, but only because nothing ranks them.
const you = table.rows[0];
check("scorecard: player row fully numeric", /^\d+$/.test(you[1].text) && /^\d+$/.test(you[2].text), `steps=${you[1].text} cells=${you[2].text}`);
check(
  "scorecard: player steps are substeps-scale, machines are iterations",
  Number(you[1].text) !== 400 && machines.every((r) => /^\d+$/.test(r[1].text)),
  `you=${you[1].text} machines=${machines.map((r) => r[1].text).join(",")}`,
);

// The steps column must never be ranked/gold again (finding: 400 marked best).
const bestTds = table.rows.flatMap((r, ri) => r.map((td, ci) => ({ ri, ci, best: td.best }))).filter((t) => t.best);
check(
  "scorecard: gold marks live in the loss column (index 3) only",
  bestTds.length > 0 && bestTds.every((t) => t.ci === 3),
  JSON.stringify(bestTds),
);

/* ---------------- the copy (served HTML) ---------------- */

const html = readFileSync(join(DIST, "index.html"), "utf8").replace(/\s+/g, " ");
check("copy: no 'same pair of numbers' promise remains", !html.includes("same pair of numbers"));
check(
  "copy: states the different-unit rule",
  html.includes("Your steps are physics substeps") && html.includes("a different unit") && html.includes("compares cells and loss"),
);
check("copy: damping says 'within a second or so'", html.includes("within a second or so"));
check("copy: no 'decays within a few steps' remains", !html.includes("within a few steps"));

/* ---------------- the damping claim, numerically ---------------- */

// v decays by (1 − c·dt) per substep with no input/gradient; 1/e needs
// n = ln(e)/−ln(1 − c·dt) substeps = n·dt seconds. The copy claims "within
// a second or so" for raised c — check the whole slider range [1.2, 2.2].
const DT = 1 / 120;
for (const c of [1.2, 1.7, 2.2]) {
  const n = Math.log(Math.E) / -Math.log(1 - c * DT);
  check(
    `decay: 1/e of velocity within a second at c=${c}`,
    n * DT < 1.0,
    `${n.toFixed(1)} substeps = ${(n * DT).toFixed(2)} s`,
  );
}

/* ---------------- screenshot + report ---------------- */

const shot = resolve(OUT, "scorecard-units.png");
await page.screenshot({ path: shot });
console.log(`screenshot: ${shot}`);

console.log(failures === 0 ? "\nALL CHECKS PASS" : `\n${failures} CHECK(S) FAILED`);
await browser.close();
srv.close();
process.exit(failures === 0 ? 0 : 1);
