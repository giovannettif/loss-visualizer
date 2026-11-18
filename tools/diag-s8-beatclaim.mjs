// Diagnostic (S8-SWEEP2-BEAT-CLAIM-STATIC): does §8 step A's beat claim
// contradict the live scoreboard after the player picks another landscape?
// Repro of the original finding: open ?step=22, click the "least squares"
// pill, crank η until the rule DNFs — at every point the step-A paragraph
// must scope its "beats Adam" claim to the curated opening landscape
// (Rosenbrock) and never assert a present-tense win on the live state.
// Usage: node tools/diag-s8-beatclaim.mjs [base]
import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";
import { mkdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const base = process.argv[2] ?? "http://localhost:4173";
const outDir = resolve("shots");
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) fails += 1;
};

const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

async function waitIdle() {
  for (let i = 0; i < 40; i++) {
    const a = await page.evaluate(() => ({
      locked: window.__wp1.locked(),
      animating: window.__wp1.animating(),
    }));
    if (!a.locked && !a.animating) return true;
    await sleep(250);
  }
  return false;
}

/** The step-A body text: the reader step whose h2 is "Assemble an update rule." */
const stepABody = () =>
  page.evaluate(() => {
    const step = [...document.querySelectorAll("#reader-body .rstep")].find(
      (s) => s.querySelector("h2")?.textContent.includes("Assemble an update rule."),
    );
    return step ? step.querySelector(".step__body").innerText : null;
  });

/** The sentence in `text` that contains "beats Adam" (null if absent). */
const beatSentence = (text) =>
  text
    ?.split(/(?<=[.!?])\s+/)
    .find((s) => /beats Adam/.test(s)) ?? null;

const scoreRows = () =>
  page.evaluate(() =>
    [...document.querySelectorAll("#rule-score-body-a tr")].map((tr) =>
      [...tr.children].map((td) => td.textContent.trim()).join(" | "),
    ),
  );

/* ---- 1: entry pose (Rosenbrock) — the claim is true and scoped ---- */
await page.goto(`${base}/?step=22`, { waitUntil: "load" });
check("entry: reader reached the workbench", await waitIdle());
check("entry: scene is labrule", (await page.evaluate(() => window.__wp1.scene())) === "labrule");
{
  const body = await stepABody();
  const sent = beatSentence(body);
  check("entry: step A found", body != null);
  check("entry: no static 'currently beating Adam' claim", body != null && !/currently\s+beating\s+Adam/i.test(body), JSON.stringify(sent));
  check("entry: beat claim is scoped to the opening landscape", sent != null && /opening\s+landscape/i.test(sent) && /Rosenbrock/.test(sent), JSON.stringify(sent));
  const rows = await scoreRows();
  const custom = rows.find((r) => r.startsWith("your rule"));
  const adam = rows.find((r) => /adam/i.test(r));
  check("entry: on Rosenbrock the claim is TRUE (custom 14 beats Adam 164)", /14/.test(custom ?? "") && /164/.test(adam ?? ""), JSON.stringify({ custom, adam }));
  const verdict = await page.evaluate(() => document.querySelector("#rule-verdict-a")?.textContent ?? "");
  check("entry: verdict names the win", /Your rule wins/.test(verdict), verdict.slice(0, 90));
  await page.screenshot({ path: resolve(outDir, "diag-s8-beatclaim-1-entry.png") });
}

/* ---- 2: the finding's repro — pick least squares, claim must not contradict ---- */
await page.click('#rule-levels button[data-level="ls"]');
await waitIdle();
await sleep(400);
{
  const body = await stepABody();
  const sent = beatSentence(body);
  check("ls: beat sentence still scoped to Rosenbrock (nothing asserted about the live landscape)", sent != null && /Rosenbrock/.test(sent), JSON.stringify(sent));
  const rows = await scoreRows();
  const custom = rows.find((r) => r.startsWith("your rule"));
  const adam = rows.find((r) => /adam/i.test(r));
  check("ls: scoreboard shows the loss (custom 42, Adam 8 — the finding's numbers)", /42/.test(custom ?? "") && /(^|\s)8(\s|$)/.test(adam ?? ""), JSON.stringify({ custom, adam }));
  const verdict = await page.evaluate(() => document.querySelector("#rule-verdict-a")?.textContent ?? "");
  check("ls: verdict names a machine as winner (not the custom rule)", !/Your rule wins/.test(verdict) && /wins least squares/.test(verdict), verdict.slice(0, 110));
  await page.screenshot({ path: resolve(outDir, "diag-s8-beatclaim-2-ls.png") });
}

/* ---- 3: diverged config — paragraph must stay silent about the live state ---- */
// η=2.0 with normalize ON still converges (per-coordinate scaling absorbs the
// step size — the section's own point), so kill normalize too: dials-down GD
// at η=2.0 on least squares (tuned ≈0.008) must blow up.
await page.evaluate(() => {
  const s = document.querySelector("#rule-eta");
  s.value = "1000";
  s.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.evaluate(() => {
  const t = document.querySelector("#rule-norm");
  t.checked = false;
  t.dispatchEvent(new Event("change", { bubbles: true }));
});
// clip knob 0 = off (ruleLab.ts:137); the default 0.35 cap would prevent any blow-up.
await page.evaluate(() => {
  const s = document.querySelector("#rule-clip");
  s.value = "0";
  s.dispatchEvent(new Event("input", { bubbles: true }));
});
await waitIdle();
await sleep(400);
{
  const body = await stepABody();
  const sent = beatSentence(body);
  check("diverged: beat sentence still scoped to Rosenbrock", sent != null && /Rosenbrock/.test(sent), JSON.stringify(sent));
  const rows = await scoreRows();
  const custom = rows.find((r) => r.startsWith("your rule"));
  check("diverged: custom row shows DNF + diverged", /DNF/.test(custom ?? "") && /diverged/.test(custom ?? ""), JSON.stringify(custom));
  const verdict = await page.evaluate(() => document.querySelector("#rule-verdict-a")?.textContent ?? "");
  check("diverged: verdict still names the live winner", !/Your rule wins/.test(verdict) && /wins least squares/.test(verdict), verdict.slice(0, 110));
  const shotPath = resolve(outDir, "diag-s8-beatclaim-3-diverged.png");
  await page.screenshot({ path: shotPath });
  check("diverged: screenshot captured", statSync(shotPath).size / 1024 > 30);
}

await browser.close();
console.log(fails === 0 ? "DIAG_S8_BEATCLAIM_OK" : `DIAG_S8_BEATCLAIM_FAILED (${fails})`);
process.exit(fails === 0 ? 0 : 1);
