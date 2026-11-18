// Diagnostic (COV22-2): the tilt-b empty/unsteered scorecard must not present
// the seeded ride's numbers as the player's run.
// Block 1 mirrors the COV22-2 block of diag-sweep2-b.mjs (?step=20 fresh load,
// the finding's exact repro). Block 2 mirrors verify-cycleb.mjs student-2
// (rail to tilt-b without playing → the "empty" run branch).
// Usage: node tools/diag-cov22-2.mjs [base]
import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";
const base = process.argv[2] ?? "http://localhost:4185";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) fails += 1;
};
const browser = await launchGL(chromium);
async function open(path, w = 1600, h = 900) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  await page.goto(`${base}/${path}`, { waitUntil: "load" });
  await page.waitForFunction(() => { const b = document.querySelector("#boot"); return !b || b.dataset.done === "true"; }, null, { timeout: 15000 }).catch(() => {});
  await sleep(800);
  return page;
}
async function idle(page, ms = 14000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const a = await page.evaluate(() => window.__wp1.locked() || window.__wp1.animating());
    if (!a) break;
    await sleep(150);
  }
  await sleep(300);
}

/* Block 1 — the finding's repro: fresh ?step=20, no input.
 * Expected after the fix: first scorecard row labelled "guided demo" (never
 * gold), panel readouts "—", verdict names the demo ride, demo lead shown. */
for (const [w, h] of [[1600, 900], [900, 700]]) {
  const page = await open(`?step=20`, w, h);
  await idle(page);
  const r = await page.evaluate(() => ({
    row: [...document.querySelectorAll("#tilt-scorecard-body tr:first-child td")].map((td) => td.textContent),
    bestInRow: document.querySelectorAll("#tilt-scorecard-body tr:first-child [data-best]").length,
    verdict: document.querySelector("#tilt-verdict").textContent,
    demoLead: !document.querySelector("#tilt-demo-lead").hidden,
    runLead: document.querySelector("#tilt-run-lead").hidden,
    ro: [document.querySelector("#tilt-cells")?.textContent, document.querySelector("#tilt-steps")?.textContent, document.querySelector("#tilt-loss")?.textContent],
    t: window.__wp1.tilt(),
  }));
  check(
    `COV22-2 REPRO ${w}x${h}: run is seeded, done, unsteered+curated (the finding's premise)`,
    r.t.done === true && r.t.steered === false && r.t.curated === true,
    JSON.stringify({ done: r.t.done, steered: r.t.steered, curated: r.t.curated, steps: r.t.steps }),
  );
  check(
    `COV22-2 ROW ${w}x${h}: row labelled 'guided demo', honest numbers, never gold`,
    r.row[0] === "guided demo" && r.bestInRow === 0,
    JSON.stringify({ row: r.row, best: r.bestInRow }),
  );
  check(
    `COV22-2 READOUTS ${w}x${h}: panel readouts show no numbers for the unsteered demo`,
    r.ro.every((t) => t === "—"),
    JSON.stringify(r.ro),
  );
  check(
    `COV22-2 VERDICT ${w}x${h}: verdict names the guided demo, denies it is the player's run`,
    /guided demo/.test(r.verdict) && /not your run/.test(r.verdict) && r.demoLead && r.runLead,
    JSON.stringify({ verdict: r.verdict.slice(0, 110), demoLead: r.demoLead, runLead: r.runLead }),
  );
  await page.close();
}

/* Block 2 — the empty branch: a session run that exists but was never
 * steered (rail 18 → tilt-a creates a requireInput run; rail 20 → tilt-b
 * finishes it). Expected: row "you (no run)" with em-dashes, verdict
 * "never tilted … nothing on stage is your run". */
{
  const page = await open("?step=18");
  await idle(page);
  await page.evaluate(() => document.querySelectorAll("#rail button")[20].click());
  await idle(page);
  await sleep(800);
  const r = await page.evaluate(() => ({
    scene: window.__wp1.scene(),
    t: window.__wp1.tilt(),
    row: [...document.querySelectorAll("#tilt-scorecard-body tr:first-child td")].map((td) => td.textContent),
    bestInRow: document.querySelectorAll("#tilt-scorecard-body tr:first-child [data-best]").length,
    verdict: document.querySelector("#tilt-verdict").textContent,
    ro: [document.querySelector("#tilt-cells")?.textContent, document.querySelector("#tilt-steps")?.textContent, document.querySelector("#tilt-loss")?.textContent],
  }));
  check(
    `COV22-2 EMPTY premise: run is done, unsteered, NOT curated`,
    r.scene === "tilt-b" && r.t.done === true && r.t.steered === false && r.t.curated === false,
    JSON.stringify({ scene: r.scene, done: r.t.done, steered: r.t.steered, curated: r.t.curated }),
  );
  check(
    `COV22-2 EMPTY ROW: 'you (no run)' with em-dash steps/cells/loss, never gold`,
    r.row[0] === "you (no run)" && r.row.slice(1).every((t) => t === "—") && r.bestInRow === 0,
    JSON.stringify({ row: r.row, best: r.bestInRow }),
  );
  check(
    `COV22-2 EMPTY READOUTS+VERDICT: readouts '—'; verdict 'never tilted … nothing on stage is your run'`,
    r.ro.every((t) => t === "—") && r.verdict.includes("never tilted") && r.verdict.includes("nothing on stage is your run"),
    JSON.stringify({ ro: r.ro, verdict: r.verdict.slice(0, 110) }),
  );
  await page.close();
}

await browser.close();
console.log(fails === 0 ? "DIAG_COV22_2_OK" : `DIAG_COV22_2_FAILED (${fails})`);
