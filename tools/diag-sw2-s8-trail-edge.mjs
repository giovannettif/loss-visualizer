// Diagnostic — SW2-S8-DIVERGED-TRAIL-PAST-EXTENT (reverify after the
// marginFrac 0.1 → 0 fix in ruleDisplayPath).
// Finding repro: ?step=22, workbench parts normalize OFF, β 0, clip OFF,
// η End (2.00). OBSERVED (at margin 0.1): the purple trail ran 10% past the
// extent into the void on 'valley' / 'Rosenbrock' / 'least squares', and on
// Rosenbrock the last chord cut through the terrain.
// EXPECTED now: the trail stops ON the terrain edge in every view.
// Captures iso + map screenshots per landscape for visual verdict, plus the
// in-page benchmark state (raw paths for cross-checking against the core).
// Usage: bash tools/run-gate.sh tools/diag-sw2-s8-trail-edge.mjs [base]
import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";
import { mkdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const base = process.argv[2] ?? "http://localhost:4173";
const outDir = resolve("qa", "SW2-S8-TRAIL-EDGE-REVERIFY");
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

let fails = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) fails += 1;
};

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

await page.goto(`${base}/?step=22`, { waitUntil: "load" });
check("reader reached the workbench", await waitIdle());
check("scene is labrule", (await page.evaluate(() => window.__wp1.scene())) === "labrule");

// The finding's diverged config: normalize OFF, β 0, clip OFF, η = 2.00.
await page.evaluate(() => {
  const norm = document.querySelector("#rule-norm");
  norm.checked = false;
  norm.dispatchEvent(new Event("change", { bubbles: true }));
  const beta = document.querySelector("#rule-beta");
  beta.value = "0";
  beta.dispatchEvent(new Event("input", { bubbles: true }));
  const clip = document.querySelector("#rule-clip");
  clip.value = "0";
  clip.dispatchEvent(new Event("input", { bubbles: true }));
  const eta = document.querySelector("#rule-eta");
  eta.value = "1000"; // knob 1000 = η 2.00 (ruleEtaFromKnob max)
  eta.dispatchEvent(new Event("input", { bubbles: true }));
});
await waitIdle();
await sleep(800); // coalesced rebuild + first render

const st = await page.evaluate(() => window.__wp1.rule());
check("config applied (η2/raw/unclipped)", st?.config?.lr != null && st?.config?.normalize === false, JSON.stringify(st?.config));
check("benchmark ran (4 lanes)", st?.runs?.length === 4, JSON.stringify(st?.runs?.map((r) => `${r.key}:${r.steps ?? "DNF"}`)));

for (const level of ["bowl", "rosen", "ls"]) {
  await page.click(`#rule-levels button[data-level="${level}"]`);
  await waitIdle();
  await sleep(600);
  const cur = await page.evaluate(() => window.__wp1.rule());
  const custom = cur?.runs?.find((r) => r.key === "custom");
  // η 2.00 raw/unclipped diverges on every level → the custom run must DNF
  // (its 400 steps run off the extent; only the display prefix is drawn).
  check(`${level}: custom rule diverged (DNF) as the finding config`, custom?.steps === null, `steps=${custom?.steps ?? "DNF"} on level=${cur?.level}`);
  const kbIso = await shot(`${level}-diverge-iso.png`);
  await page.click('.lv-btn[data-preset="map"]');
  await sleep(600);
  const kbMap = await shot(`${level}-diverge-map.png`);
  await page.click('.lv-btn[data-preset="iso"]');
  await sleep(400);
  check(`${level}: iso+map screenshots captured`, kbIso > 20 && kbMap > 20, `${kbIso.toFixed(0)}KB / ${kbMap.toFixed(0)}KB`);
}

// Also capture the finding's exact Rosenbrock η values (0.0956, 0.176).
await page.click('#rule-levels button[data-level="rosen"]');
await waitIdle();
for (const [tag, eta] of [["e00956", "600"], ["e0176", "680"]]) {
  // knob values from the log η sweep (floor 0.001 → 2):
  // ruleEtaFromKnob(600) = 0.001·2000^0.6 ≈ 0.09564, (680) ≈ 0.1757
  await page.evaluate((v) => {
    const el = document.querySelector("#rule-eta");
    el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, eta);
  await waitIdle();
  await sleep(600);
  const cur = await page.evaluate(() => window.__wp1.rule());
  const etaApplied = cur?.config?.lr;
  console.log(`INFO  rosen ${tag}: η applied = ${etaApplied}`);
  await shot(`rosen-${tag}-iso.png`);
}

console.log(`\nRESULT: ${fails === 0 ? "ALL PASS" : fails + " FAILURES"} — screenshots in qa/SW2-S8-TRAIL-EDGE-REVERIFY/`);
await browser.close();
process.exit(fails === 0 ? 0 : 1);
