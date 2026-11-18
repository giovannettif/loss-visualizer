/**
 * diag-s8-verdict-cache.mjs — re-run the S8-SWEEP2-STALE-VERDICT repro
 * (qa/S8-FLIP-sweep2/drive.mjs) against the CURRENT tree: §8 verdict must
 * re-derive from the benchmark whenever the RAW config moves, even when the
 * rounded parts label (η via toPrecision(2)) is unchanged.
 *
 * Repro (from the finding): serve dist on :4181, open ?step=22, click the
 * 'least squares' pill, focus the η dial, Home + PageUp×2 + ArrowRight×14
 * → knob 724 (η 0.245 — custom wins 3 vs Adam 8). ArrowRight → knob 725
 * (η 0.247 — benchmark flips to Adam 8 vs custom 24). The verdict must
 * follow the scoreboard at 725, not reuse the 724 sentence.
 * Secondary pair from probe3: knobs 432→433 (custom 32→8 steps).
 *
 * Output: qa/S8-SWEEP2-STALE-VERDICT-r2/*.png + PASS/FAIL lines. Exit 1 on fail.
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";

const base = "http://localhost:4181";
const out = "qa/S8-SWEEP2-STALE-VERDICT-r2/";
mkdirSync(out, { recursive: true });

const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE.ERR", m.text()); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function idle() {
  for (let i = 0; i < 40; i++) {
    const a = await page.evaluate(() => ({ l: window.__wp1.locked(), a: window.__wp1.animating() }));
    if (!a.l && !a.a) return;
    await sleep(250);
  }
}
let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
}
async function read(tag) {
  await sleep(300);
  const r = await page.evaluate(() => ({
    knob: Number(document.querySelector("#rule-eta").value),
    etaTxt: document.querySelector("#rule-eta-value").textContent,
    A: document.querySelector("#rule-verdict-a").textContent,
    B: document.querySelector("#rule-verdict-b").textContent,
    rows: [...document.querySelectorAll("#rule-score-body-a tr")].map((tr) =>
      [...tr.children].map((td) => td.textContent + (td.dataset.best ? "*" : "")).join(" | ")),
    cfg: window.__wp1.rule().config,
  }));
  console.log(`\n=== ${tag} === knob=${r.knob} etaTxt=${r.etaTxt} lr=${r.cfg.lr.toPrecision(6)}`);
  r.rows.forEach((x) => console.log("  row:", x));
  console.log("  verdictA:", r.A);
  if (r.B !== r.A) console.log("  verdictB DIFFERS:", r.B);
  return r;
}

await page.goto(`${base}/?step=22`, { waitUntil: "load" });
await idle();
console.log("scene", await page.evaluate(() => window.__wp1.scene()));
await page.click('#rule-levels button[data-level="ls"]');
await idle();
await read("entry ls");

// Pair 1 (the finding's repro): Home + PageUp×2 + ArrowRight×14 → knob 724.
const eta = page.locator("#rule-eta");
await eta.focus();
await page.keyboard.press("Home");
for (let i = 0; i < 2; i++) await page.keyboard.press("PageUp");
let v = Number(await eta.inputValue());
while (v < 724) { await page.keyboard.press("ArrowRight"); v = Number(await eta.inputValue()); }
await sleep(400);
const r724 = await read("ls knob 724");
await page.screenshot({ path: out + "01-ls-knob724.png" });
check("knob 724 reached", r724.knob === 724, `knob=${r724.knob}`);
check("724 custom wins (3 steps, Adam 8)",
  r724.rows[0]?.startsWith("your rule") && /3/.test(r724.rows[0]) && r724.rows[0].includes("*"),
  r724.rows[0] ?? "no row");
check("724 verdict = win sentence", /Your rule wins .*: 3 steps — Adam needed 8\./.test(r724.A), r724.A);

await page.keyboard.press("ArrowRight");
await sleep(400);
const r725 = await read("ls knob 725");
await page.screenshot({ path: out + "02-ls-knob725.png" });
check("knob 725 reached", r725.knob === 725, `knob=${r725.knob}`);
const adamBest725 = r725.rows.some((x) => x.includes("Adam") && / \| 8\* \|/.test(x));
const custom725 = r725.rows.find((x) => x.startsWith("your rule")) ?? "";
check("725 scoreboard flipped to Adam-best, custom 24",
  adamBest725 && /\| 24 \|/.test(custom725),
  `customRow="${custom725}" adamBest=${adamBest725}`);
const staleWin = /Your rule wins .*: 3 steps/.test(r725.A);
check("725 verdict NOT the stale 724 win sentence", !staleWin, r725.A);
check("725 verdict re-derived (Adam wins … your rule needed 24)",
  /Adam wins .* in 8 steps; your rule needed 24\./.test(r725.A), r725.A);
check("725 verdictB == verdictA", r725.B === r725.A, "");

// Pair 2 (probe3): Home + PageUp×4 + ArrowRight×32 → knob 432, then 433.
await eta.focus();
await page.keyboard.press("Home");
for (let i = 0; i < 4; i++) await page.keyboard.press("PageUp");
v = Number(await eta.inputValue());
while (v < 432) { await page.keyboard.press("ArrowRight"); v = Number(await eta.inputValue()); }
await sleep(400);
const r432 = await read("ls knob 432");
await page.screenshot({ path: out + "03-ls-knob432.png" });
const custom432 = r432.rows.find((x) => x.startsWith("your rule")) ?? "";
check("432 custom 32 steps (Adam-best loss)",
  /32/.test(custom432) && r432.rows.some((x) => x.includes("Adam") && x.includes("*")),
  `customRow="${custom432}" verdict="${r432.A}"`);

await page.keyboard.press("ArrowRight");
await sleep(400);
const r433 = await read("ls knob 433");
await page.screenshot({ path: out + "04-ls-knob433.png" });
const custom433 = r433.rows.find((x) => x.startsWith("your rule")) ?? "";
check("433 custom 8 steps (tie-best win)", /\| 8\* \|/.test(custom433),
  `customRow="${custom433}" verdict="${r433.A}"`);
check("433 verdict re-derived to win sentence",
  /Your rule wins .*: 8 steps/.test(r433.A), r433.A);
check("433 verdict NOT stale 432 loss sentence", !/your rule needed 32/.test(r433.A), r433.A);

await browser.close();
console.log(failures === 0 ? "\nALL CHECKS PASS" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
