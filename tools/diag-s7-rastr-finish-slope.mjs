/**
 * diag-s7-rastr-finish-slope.mjs — QA S7-RASTR-FINISH-SLOPE reproduction.
 *
 * The finding: on Rastrigin, pressing Finish while the ball sits visibly
 * still at a pit floor graded the run "none — on a slope" (|∇f| < 0.8 needs
 * ~0.002 of the floor at curvature ≈ 395), the verdict never named the pit,
 * and the player's ℒ took the gold same-pit mark while the footer said slope.
 *
 * Repro (finding verbatim): dist served at /?step=18, viewport 1600×900,
 * click "3 · Rastrigin", tap W for 80 ms, wait for #tilt-finish
 * data-cue=pulse, click Finish. Variant B: Finish at ~3.5 s (before cue).
 *
 * PASS = footer never says "none — on a slope" for the player; the footer
 * groups "you (tilt)" into the pit line "(−1, 2) local"; the verdict names
 * the pit ("You stopped in a local minimum near (−1, 2)"); the player's ℒ
 * gold mark agrees with the pit rule (gold only when the row is atMin in the
 * same pit as the best row — never gold-on-slope); "measurements" pluralized.
 *
 * Read-only against src/ — serves the prebuilt dist/ on a private port.
 */

import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, extname, resolve } from "node:path";

const DIST = join(process.cwd(), "dist");
const PORT = 4196;
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
const OUT = resolve("qa", "S7-RASTR-FINISH-SLOPE-r1");
mkdirSync(OUT, { recursive: true });

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

/** Enter ?step=18, select Rastrigin, tap W for 80 ms. */
async function enterRastrAndTapW() {
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
  check("scene is tilt-a", (await page.evaluate(() => window.__wp1.scene())) === "tilt-a");
  await page.click('#tilt-levels button[data-level="rastr"]');
  await sleep(800);
  const fresh = await page.evaluate(() => window.__wp1.tilt());
  check("rastr fresh run", fresh.level === "rastr" && !fresh.done, `level=${fresh.level} pos=${JSON.stringify(fresh.pos)}`);
  await page.keyboard.down("w");
  await sleep(80);
  await page.keyboard.up("w");
  check("W tap steered the run", (await page.evaluate(() => window.__wp1.tilt())).steered === true);
}

/** The full scorecard readout after the run ends. */
async function readScorecard(tag) {
  const r = await page.evaluate(() => {
    const t = window.__wp1.tilt();
    const foot = document.querySelector("#tilt-scorecard-min");
    const verdict = document.querySelector("#tilt-verdict");
    const goldRows = [...document.querySelectorAll("#tilt-scorecard-body tr")].map((tr) => ({
      label: tr.querySelector("td")?.textContent,
      loss: tr.querySelectorAll("td")[3]?.textContent,
      gold: tr.querySelectorAll("td")[3]?.dataset.best === "true",
    }));
    const goldFootLines = foot && !foot.hidden
      ? [...foot.querySelectorAll("[data-best]")].map((d) => d.textContent)
      : [];
    return {
      pos: t.pos, vel: t.vel, done: t.done, settled: t.settled, steps: t.steps,
      footHidden: !foot || foot.hidden,
      foot: foot && !foot.hidden ? foot.innerText : "(hidden)",
      verdict: verdict ? verdict.innerText : "(missing)",
      goldRows, goldFootLines,
    };
  });
  console.log(`\n[${tag}] end pos=${JSON.stringify(r.pos)} |v|=${Math.hypot(r.vel.x, r.vel.y).toFixed(4)} settled=${r.settled} steps=${r.steps}`);
  console.log(`[${tag}] footer: ${JSON.stringify(r.foot)}`);
  console.log(`[${tag}] verdict: ${JSON.stringify(r.verdict)}`);
  console.log(`[${tag}] gold ℒ cells: ${JSON.stringify(r.goldRows.filter((x) => x.gold))}`);
  console.log(`[${tag}] gold footer lines: ${JSON.stringify(r.goldFootLines)}`);
  await page.screenshot({ path: join(OUT, `${tag}.png`) });
  return r;
}

/* ---------------- A: Finish at the cue pulse (the finding's main repro) ---------------- */

await enterRastrAndTapW();
const cueSeen = await page
  .waitForSelector('#tilt-finish[data-cue="pulse"]', { timeout: 15000 })
  .then(() => true)
  .catch(() => false);
check("Finish cue pulses (data-cue=pulse)", cueSeen);
if (!cueSeen) {
  console.log("cue never fired — aborting variant A");
} else {
  await page.click("#tilt-finish");
  await sleep(600);
  const a = await readScorecard("A-cue-finish");

  // Pit check: the ball rests in the (−1, 2) pit (Chebyshev < 0.1).
  const inPit =
    Math.max(Math.abs(a.pos.x - -1), Math.abs(a.pos.y - 2)) < 0.1;
  check("A: ball rests at the (−1, 2) pit floor", inPit, JSON.stringify(a.pos));

  // The finding's three symptoms:
  check("A: footer never says 'none — on a slope'", !a.foot.includes("on a slope"), JSON.stringify(a.foot));
  check("A: footer groups you (tilt) into the (−1, 2) local pit line",
    /\(−1, 2\) local/.test(a.foot) && /you \(tilt\)/.test(a.foot), JSON.stringify(a.foot));
  check("A: verdict names the pit",
    a.verdict.includes("You stopped in a local minimum near (−1, 2)"), JSON.stringify(a.verdict.slice(0, 90)));
  check("A: verdict pluralizes measurements", /1 measurement|measurements/.test(a.verdict), "");

  // Gold agreement: a gold ℒ on the player's row is allowed only when the
  // player is atMin (in a pit) AND the best row is atMin AND same pit —
  // i.e. never a gold-on-slope. Mirror of director.ts lossBest for rastr.
  const you = a.goldRows.find((x) => x.label === "you (tilt)");
  const goldOK = !you?.gold || (inPit && a.goldRows.some((x) => x.gold));
  check("A: player ℒ gold agrees with the pit rule (no gold-on-slope)", goldOK,
    `youGold=${!!you?.gold} youLoss=${you?.loss}`);
}

/* ---------------- B: Finish at ~3.5 s (before the cue) ---------------- */

await enterRastrAndTapW();
await sleep(3500);
const bState = await page.evaluate(() => window.__wp1.tilt());
check("B: run still live at 3.5 s", !bState.done, `pos=${JSON.stringify(bState.pos)} |v|=${Math.hypot(bState.vel.x, bState.vel.y).toFixed(3)}`);
await page.click("#tilt-finish");
await sleep(600);
const b = await readScorecard("B-3p5s-finish");

const bInPit = Math.max(Math.abs(b.pos.x - -1), Math.abs(b.pos.y - 2)) < 0.15;
check("B: ball in the (−1, 2) pit basin", bInPit, JSON.stringify(b.pos));
check("B: footer never says 'none — on a slope'", !b.foot.includes("on a slope"), JSON.stringify(b.foot));
check("B: verdict names the pit",
  b.verdict.includes("You stopped in a local minimum near (−1, 2)") ||
    b.verdict.includes("You settled into a local minimum near (−1, 2)"),
  JSON.stringify(b.verdict.slice(0, 90)));

await browser.close();
srv.close();
console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURES`}`);
process.exit(failures === 0 ? 0 : 1);
