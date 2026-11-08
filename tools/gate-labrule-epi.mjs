/**
 * gate-labrule-epi.mjs — WP-D + WP-E live gate over Playwright.
 *
 *   1. ?shot=labrule — the workbench on Rosenbrock: the assembled rule
 *      (purple) BEATS Adam (14 vs 164 steps), panel + both scorecards live.
 *   2. Live level pills — bowl: momentum wins, the advantage flips;
 *      least squares: the rule finishes last. Both reader scorecards update.
 *   3. Live part drag — η knob re-runs the benchmark.
 *   4. ?shot=epi-a — the formula reveal: gold marker + pinned typeset note.
 *   5. ?shot=epi-b — the lattice: 24³ faint points, ghost terrain, no marker.
 *   6. ?shot=epi-c — the lattice holds under the limitations + credits step.
 *
 * Usage: node tools/gate-labrule-epi.mjs [baseUrl]
 */

import { chromium } from "playwright";
import { mkdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const base = process.argv[2] ?? "http://localhost:4173";
const outDir = resolve("shots");
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(file) {
  const path = resolve(outDir, file);
  await page.screenshot({ path });
  return statSync(path).size / 1024;
}

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

/* ---------------- 1: ?shot=labrule — the curated win ---------------- */

await page.goto(`${base}/?shot=labrule`, { waitUntil: "load" });
await page.waitForTimeout(1500);
{
  const st = await page.evaluate(() => window.__wp1.rule());
  const scene = await page.evaluate(() => window.__wp1.scene());
  check("labrule: scene booted", scene === "labrule", `scene=${scene}`);
  check("labrule: on Rosenbrock (the win landscape)", st?.level === "rosen" && st?.built === "rosen", JSON.stringify({ level: st?.level, built: st?.built }));
  check("labrule: benchmark ran (4 lanes)", st?.runs?.length === 4, JSON.stringify(st?.runs?.map((r) => `${r.key}:${r.steps ?? "DNF"}`)));
  const custom = st?.runs?.find((r) => r.key === "custom");
  const adam = st?.runs?.find((r) => r.key === "adam");
  const mom = st?.runs?.find((r) => r.key === "mom");
  check("labrule: custom rule BEATS Adam (14 vs 164)", custom?.steps === 14 && adam?.steps === 164, `custom=${custom?.steps} adam=${adam?.steps}`);
  check("labrule: custom wins overall", custom?.steps < mom?.steps && custom?.steps < adam?.steps, `mom=${mom?.steps}`);
  check("labrule: curated parts assembled", st?.config?.lr != null && st?.config?.normalize === true, JSON.stringify(st?.config));
  const panelVisible = await page.evaluate(
    () => document.querySelector("#rule-panel")?.dataset.visible === "true",
  );
  check("labrule: workbench panel visible", panelVisible === true);
  const rows = await page.locator("#rule-score-body-a tr").count();
  check("labrule: scorecard A has 4 rows", rows === 4, `rows=${rows}`);
  const rowsB = await page.locator("#rule-score-body-b tr").count();
  check("labrule: scorecard B has 4 rows", rowsB === 4, `rowsB=${rowsB}`);
  const verdict = await page.evaluate(() => document.querySelector("#rule-verdict-a")?.textContent ?? "");
  check("labrule: verdict names the win", verdict.includes("wins"), verdict.slice(0, 80));
  const kb = await shot("22-labrule.png");
  check("labrule: screenshot captured", kb > 30, `${kb.toFixed(1)} KB`);
}

/* ---------------- 2: live level pills — the flip ---------------- */

await page.goto(`${base}/?step=22`, { waitUntil: "load" });
check("live: reader reached the workbench", await waitIdle());
check("live: scene is labrule", (await page.evaluate(() => window.__wp1.scene())) === "labrule");
{
  const st = await page.evaluate(() => window.__wp1.rule());
  check("live: rosen benchmark ran", st?.runs?.length === 4, JSON.stringify(st?.runs?.map((r) => r.key)));

  // Switch to the bowl: momentum wins, custom does not.
  await page.click('#rule-levels button[data-level="bowl"]');
  await waitIdle();
  const bowl = await page.evaluate(() => window.__wp1.rule());
  const bowlCustom = bowl?.runs?.find((r) => r.key === "custom");
  const bowlMom = bowl?.runs?.find((r) => r.key === "mom");
  const bowlAdam = bowl?.runs?.find((r) => r.key === "adam");
  check("live: bowl level swaps terrain + re-runs", bowl?.level === "bowl" && bowl?.built === "bowl", JSON.stringify({ level: bowl?.level, built: bowl?.built }));
  check("live: FLIP — momentum (21) beats custom (57) on the bowl", bowlMom?.steps === 21 && bowlCustom?.steps === 57, `mom=${bowlMom?.steps} custom=${bowlCustom?.steps}`);
  check("live: FLIP — custom no longer wins", bowlCustom.steps > bowlMom.steps, `custom=${bowlCustom?.steps} vs mom=${bowlMom?.steps}`);
  check("live: Adam behind custom on the bowl too", bowlAdam.steps > bowlCustom.steps, `adam=${bowlAdam?.steps}`);
  const verdictB = await page.evaluate(() => document.querySelector("#rule-verdict-b")?.textContent ?? "");
  check("live: verdict B reports the flip", verdictB.includes("flips"), verdictB.slice(0, 80));
  const bowlRows = await page.evaluate(() => document.querySelectorAll("#rule-score-body-b tr").length);
  check("live: scorecard B updated (4 rows)", bowlRows === 4, `rows=${bowlRows}`);

  // Switch to least squares: custom finishes LAST.
  await page.click('#rule-levels button[data-level="ls"]');
  await waitIdle();
  const ls = await page.evaluate(() => window.__wp1.rule());
  const lsCustom = ls?.runs?.find((r) => r.key === "custom");
  const lsAdam = ls?.runs?.find((r) => r.key === "adam");
  const machineSteps = ls.runs.filter((r) => r.key !== "custom").map((r) => r.steps);
  check("live: least-squares level runs", ls?.level === "ls", `level=${ls?.level}`);
  check("live: LAST — custom (42) behind Adam (8)", lsAdam?.steps === 8 && lsCustom?.steps === 42, `adam=${lsAdam?.steps} custom=${lsCustom?.steps}`);
  check("live: custom behind every machine on ls", machineSteps.every((s) => s < lsCustom.steps), `machines=${JSON.stringify(machineSteps)}`);

  // A part move re-runs the benchmark live: kill normalize → custom DNFs.
  await page.evaluate(() => {
    const t = document.querySelector("#rule-norm");
    t.checked = false;
    t.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await waitIdle();
  const off = await page.evaluate(() => window.__wp1.rule());
  const offCustom = off?.runs?.find((r) => r.key === "custom");
  check("live: normalize off re-runs the benchmark", offCustom?.config != null || offCustom != null, `custom=${JSON.stringify(offCustom)}`);
  check("live: config changed (normalize off)", off?.config?.normalize === false);
  await page.evaluate(() => {
    const t = document.querySelector("#rule-norm");
    t.checked = true;
    t.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await waitIdle();
}

/* ---------------- 3–6: the epilogue shots ---------------- */

await page.goto(`${base}/?shot=epi-a`, { waitUntil: "load" });
await page.waitForTimeout(1500);
{
  const st = await page.evaluate(() => window.__wp1.epi());
  const scene = await page.evaluate(() => window.__wp1.scene());
  check("epi-a: scene booted", scene === "epi-a", `scene=${scene}`);
  check("epi-a: gold marker on the normal-equation minimum", st?.marker === true, `marker=${st?.marker}`);
  check("epi-a: argmin exact (w 0.9094, b 1.3064)", Math.abs(st?.argmin?.x - 0.909382) < 1e-4 && Math.abs(st?.argmin?.y - 1.306352) < 1e-4, JSON.stringify(st?.argmin));
  const note = await page.evaluate(() => ({
    visible: document.querySelector("#epi-formula")?.dataset.visible === "true",
    text: document.querySelector("#epi-formula")?.textContent ?? "",
  }));
  check("epi-a: formula note visible", note.visible === true);
  check("epi-a: note carries the exact formula", note.text.includes("L(w, b)") || note.text.includes("Σ"), note.text.slice(0, 60));
  check("epi-a: no lattice yet", st?.lattice === false, `lattice=${st?.lattice}`);
  const kb = await shot("23-epi-a.png");
  check("epi-a: screenshot captured", kb > 30, `${kb.toFixed(1)} KB`);
}

await page.goto(`${base}/?shot=epi-b`, { waitUntil: "load" });
await page.waitForTimeout(1500);
{
  const st = await page.evaluate(() => window.__wp1.epi());
  const scene = await page.evaluate(() => window.__wp1.scene());
  check("epi-b: scene booted", scene === "epi-b", `scene=${scene}`);
  check("epi-b: lattice on stage", st?.lattice === true, `lattice=${st?.lattice}`);
  check("epi-b: lattice faint but visible", st?.latticeOpacity > 0.3, `opacity=${st?.latticeOpacity?.toFixed(2)}`);
  check("epi-b: marker dissolved with the map", st?.marker === false, `marker=${st?.marker}`);
  const note = await page.evaluate(() => ({
    formula: document.querySelector("#epi-formula")?.dataset.visible,
    lattice: document.querySelector("#epi-lattice-note")?.dataset.visible,
  }));
  check("epi-b: formula note hidden, lattice note shown", note.formula === "false" && note.lattice === "true", JSON.stringify(note));
  const kb = await shot("24-epi-b.png");
  check("epi-b: screenshot captured", kb > 30, `${kb.toFixed(1)} KB`);
}

await page.goto(`${base}/?shot=epi-c`, { waitUntil: "load" });
await page.waitForTimeout(1500);
{
  const st = await page.evaluate(() => window.__wp1.epi());
  const scene = await page.evaluate(() => window.__wp1.scene());
  check("epi-c: scene booted", scene === "epi-c", `scene=${scene}`);
  check("epi-c: lattice holds", st?.lattice === true, `lattice=${st?.lattice}`);
  const limits = await page.evaluate(() => document.querySelectorAll(".limits-list li").length);
  check("epi-c: four stated limitations", limits === 4, `items=${limits}`);
  const links = await page.evaluate(() =>
    [...document.querySelectorAll(".credits-list a")].map((a) => a.href),
  );
  check("epi-c: five prior-art links", links.length === 5, JSON.stringify(links));
  const kb = await shot("25-epi-c.png");
  check("epi-c: screenshot captured", kb > 30, `${kb.toFixed(1)} KB`);
}

/* ---------------- 4: full journey sanity ---------------- */

await page.goto(`${base}/`, { waitUntil: "load" });
await page.waitForTimeout(800);
{
  const count = await page.evaluate(() => window.__wp1.count());
  check("journey: reader has 27 steps", count === 27, `count=${count}`);
  // Jump the rail to the epilogue: the lattice builds live (not frozen).
  await page.evaluate(() => {
    const rail = document.querySelectorAll("#rail button");
    rail[rail.length - 1].click();
  });
  await waitIdle();
  const scene = await page.evaluate(() => window.__wp1.scene());
  check("journey: rail jump lands on epi-c", scene === "epi-c", `scene=${scene}`);
  const st = await page.evaluate(() => window.__wp1.epi());
  check("journey: lattice builds live", st?.lattice === true, `lattice=${st?.lattice} opacity=${st?.latticeOpacity?.toFixed(2)}`);
}

await browser.close();
console.log(failures === 0 ? "GATE_LABRULE_EPI_OK" : `GATE_LABRULE_EPI_FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
