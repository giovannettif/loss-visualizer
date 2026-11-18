/**
 * diag-s2-skipcmp.mjs — Run A of finding S2-SKIP-CROSSFADE-BLANK (rebuilds the
 * lost skipcmp.mjs; the original script only survives as screenshots in
 * qa/S2-SKIP-CROSSFADE-BLANK-r1/ and qa/sweep2-stepper-fwd-16/).
 *
 * Per entry: deep-link ?step=k-1 (the reader step BEFORE the target), wait for
 * idle, press ArrowDown (non-instant entry → cross-landscape crossfade, swap
 * stage 'out', rise/opac tweening to 0 over 0.55 s), press Space ~140 ms later
 * (locked → director.finishTransitionsNow() mid-'out'), wait for idle, read
 * __wp1.debug(). A natural pass (ArrowDown, NO Space) records the expected
 * settled presentation per entry.
 *
 * Bug signature (pre-fix): skip lands rise 0 / opac 0 — the out tweens' 0
 * targets — while the natural pass reads the spec values. Expected with the
 * fix (director.ts finishTransitionsNow swap branch): skip == natural == spec.
 *
 * Usage: node tools/diag-s2-skipcmp.mjs [baseUrl]
 */

import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const base = process.argv[2] ?? "http://localhost:4183";
const OUT = join(process.cwd(), "qa", "S2-SKIP-CROSSFADE-BLANK-r2");
mkdirSync(OUT, { recursive: true });

// target reader step k (0-based, == SCENE_ORDER index) + its SCENES spec
// rise/opac (director.ts SCENES block — the natural settled presentation).
const ENTRIES = [
  { name: "task-a",  k: 1,  rise: 0,   opac: 0.5 },
  { name: "gd-a",    k: 4,  rise: 1,   opac: 1 },
  { name: "mom-a",   k: 8,  rise: 1,   opac: 1 },
  { name: "adam-a",  k: 11, rise: 1,   opac: 1 },
  { name: "lab",     k: 13, rise: 1,   opac: 1 },
  { name: "fog-a",   k: 15, rise: 1,   opac: 1 },
  { name: "fog-b",   k: 16, rise: 1,   opac: 1 },
  { name: "tilt-a",  k: 18, rise: 1,   opac: 1 },
  { name: "swarm",   k: 21, rise: 1,   opac: 1 },
  { name: "labrule", k: 22, rise: 1,   opac: 1 },
  { name: "epi-a",   k: 24, rise: 1,   opac: 1 },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

async function appState() {
  return page.evaluate(() => {
    const d = window.__wp1?.debug?.() ?? null;
    return {
      scene: window.__wp1?.scene?.(),
      step: window.__wp1?.step?.(),
      locked: window.__wp1?.locked?.(),
      animating: window.__wp1?.animating?.(),
      rise: d ? Math.round(d.rise * 1000) / 1000 : null,
      opac: d ? Math.round(d.opac * 1000) / 1000 : null,
      swap: d ? d.swap : null,
      built: d ? d.built : null,
      tweens: d ? d.tweens : null,
    };
  });
}
async function waitIdle(maxMs = 25000) {
  const t0 = Date.now();
  for (;;) {
    const a = await appState();
    if (!a.locked && !a.animating) return true;
    if (Date.now() - t0 > maxMs) return false;
    await sleep(80);
  }
}

let fails = 0;
const rows = [];

for (const e of ENTRIES) {
  /* ---- natural pass (reference): no skip ---- */
  await page.goto(`${base}/?step=${e.k - 1}`, { waitUntil: "load" });
  await sleep(1200);
  if (!(await waitIdle())) console.log(`  [${e.name}] natural: base step never idled`);
  await sleep(400);
  await page.keyboard.press("ArrowDown");
  if (!(await waitIdle())) console.log(`  [${e.name}] natural: entry never idled`);
  await sleep(400);
  const nat = await appState();
  await page.screenshot({ path: join(OUT, `nat-${e.name}.png`) });

  /* ---- skip pass: Space 140 ms into the entry ---- */
  await page.goto(`${base}/?step=${e.k - 1}`, { waitUntil: "load" });
  await sleep(1200);
  if (!(await waitIdle())) console.log(`  [${e.name}] skip: base step never idled`);
  await sleep(400);
  await page.keyboard.press("ArrowDown");
  await sleep(140);
  const pre = await appState(); // expect locked, swap 'out', rise/opac mid-fade
  await page.keyboard.press(" ");
  if (!(await waitIdle())) console.log(`  [${e.name}] skip: never idled after Space`);
  await sleep(400);
  const post = await appState();
  await page.screenshot({ path: join(OUT, `skip-${e.name}-skip.png`) });

  const natOk =
    nat.scene === e.name &&
    Math.abs(nat.rise - e.rise) <= 0.02 &&
    Math.abs(nat.opac - e.opac) <= 0.02;
  const skipOk =
    post.scene === e.name &&
    Math.abs(post.rise - e.rise) <= 0.02 &&
    Math.abs(post.opac - e.opac) <= 0.02;
  const wasOut = pre.swap === "out";
  if (!wasOut) console.log(`  [${e.name}] NOTE: pre-skip swap=${JSON.stringify(pre.swap)} rise=${pre.rise} (not mid-'out')`);
  if (!natOk) fails++; // the reference itself is wrong — the test is invalid
  if (!skipOk) fails++;
  rows.push({ e, nat, pre, post, natOk, skipOk });
  console.log(
    `${skipOk && natOk ? "PASS" : "FAIL"}  ${e.name.padEnd(8)} natural rise=${nat.rise} opac=${nat.opac}` +
      ` | pre-skip swap=${pre.swap} locked=${pre.locked} rise=${pre.rise} opac=${pre.opac}` +
      ` | skip rise=${post.rise} opac=${post.opac} swap=${post.swap} (spec rise=${e.rise} opac=${e.opac})`,
  );
}

await browser.close();
console.log(`\n${fails === 0 ? "ALL PASS" : fails + " FAILURES"} — ${rows.length} entries`);
process.exit(fails === 0 ? 0 : 1);
