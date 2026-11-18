/**
 * diag-s2-swarmblind-entry.mjs — S2-SWARM-BLIND-ENTRY-UNFOGGED reproduction
 * driver (verification pass against the fix at rebuildNow).
 *
 * Repro (from the finding): ?step=21 at 1600x900, check #swarm-blind,
 * ArrowUp to tilt-b, wait 2.5s, ArrowDown back to the swarm. Pre-fix, the
 * incoming swarm terrain rose UN-fogged for the whole crossfade (fog only
 * snapped on at swap end in refreshSwarmVisuals). Expected with the fix: the
 * terrain is fogged from its first rise frame at +800/+1000/+1200ms.
 *
 * Controls:
 *   A  blind entry from tilt-b (the bug path)      -> c-from-tiltb-*.png
 *   B  visible entry from tilt-b (bright control)  -> v-from-tiltb-*.png
 *   C  blind entry backward from labrule           -> b-from-labrule-*.png
 *
 * Dark/bright is judged by screenshot file size (fogged ≈ 90-100 KB vs full
 * terrain ≈ 280-350 KB on this 1600x900 viewport — same proxy the r1 round
 * used) plus manual visual inspection of the captured PNGs.
 *
 * Run: node tools/diag-s2-swarmblind-entry.mjs http://localhost:4191
 */
import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.argv[2] ?? "http://localhost:4191";
const outDir = resolve("qa/S2-SWARM-BLIND-ENTRY-UNFOGGED-r2");
mkdirSync(outDir, { recursive: true });

const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on("pageerror", (err) => errors.push("PAGEERROR: " + err.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("CONSOLE: " + m.text()); });

let failures = 0;
const results = [];
function check(id, name, ok, detail = "") {
  const line = `${ok ? "PASS" : "FAIL"}  [${id}] ${name}${detail ? ` — ${detail}` : ""}`;
  console.log(line); results.push(line);
  if (!ok) failures += 1;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function shot(f) {
  const p = resolve(outDir, f);
  await page.screenshot({ path: p });
  return Math.round(statSync(p).size / 102.4) / 10; // KB, 1 decimal
}
const swarm = () => page.evaluate(() => window.__wp1?.swarm?.() ?? null);
const scene = () => page.evaluate(() => window.__wp1?.scene?.() ?? null);
const swarmLine = () =>
  page.evaluate(() => document.querySelector("#tilt-swarm-line")?.textContent ?? null);
async function waitIdle(maxMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const a = await page.evaluate(() => ({
      locked: window.__wp1?.locked?.() ?? false,
      animating: window.__wp1?.animating?.() ?? false,
    }));
    if (!a.locked && !a.animating) return true;
    await sleep(150);
  }
  return false;
}
async function clickBlind(on) {
  const cur = await page.evaluate(() => document.querySelector("#swarm-blind")?.checked ?? null);
  if (cur !== on) await page.click("#swarm-blind");
  const after = await page.evaluate(() => document.querySelector("#swarm-blind")?.checked ?? null);
  if (after !== on) throw new Error(`#swarm-blind click did not reach ${on}`);
}
async function waitFlightEnd(maxMs = 25000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < maxMs) {
    last = await swarm();
    if (last && last.playing === false && last.time > 5) return last;
    await sleep(150);
  }
  return last;
}

/* ---------- boot: the swarm step, blind checked ---------- */
await page.goto(`${base}/?step=21`, { waitUntil: "load" });
await page.waitForFunction(() => window.__wp1 && window.__wp1.scene(), null, { timeout: 30000 });
await waitIdle();
check("boot", "scene is swarm after ?step=21", (await scene()) === "swarm");
await clickBlind(true);
await sleep(900); // clean re-run starts; panel sig refreshes
const s0 = await swarm();
check("blind-on", "#swarm-blind click sets blind mode", s0?.blind === true, `blind=${s0?.blind}`);
const line0 = await swarmLine();
check("panel", "panel reads the blind line", typeof line0 === "string" && line0.includes("blind"), JSON.stringify(line0));

/* ---------- A: bug path — blind entry forward from tilt-b ---------- */
await page.keyboard.press("ArrowUp"); // swarm -> tilt-b
await sleep(2500);
await waitIdle();
check("A-tiltb", "ArrowUp lands on tilt-b", (await scene()) === "tilt-b");
await shot("a-tiltb-before.png");
await page.keyboard.press("ArrowDown"); // tilt-b -> swarm (crossfade rebuild)
const t0 = Date.now();
const samples = [800, 1000, 1200];
const sizes = {};
const blindLine = {};
for (const ms of samples) {
  const wait = ms - (Date.now() - t0);
  if (wait > 0) await sleep(wait);
  sizes[ms] = await shot(`c-from-tiltb-${ms}.png`);
  blindLine[ms] = await swarmLine();
}
const sEnd = await waitFlightEnd();
const endKb = await shot("d-end.png");
check("A-end", "blind flight completes with cells painted", sEnd?.playing === false && (sEnd?.painted ?? 0) > 100,
  `painted=${sEnd?.painted} time=${sEnd?.time?.toFixed(2)}`);

/* ---------- B: visible entry from tilt-b (bright control) ---------- */
await clickBlind(false);
await sleep(900);
await page.keyboard.press("ArrowUp");
await sleep(2500);
await waitIdle();
check("B-tiltb", "control: back on tilt-b, blind off", (await scene()) === "tilt-b");
await page.keyboard.press("ArrowDown");
const t1 = Date.now();
const visSizes = {};
for (const ms of samples) {
  const wait = ms - (Date.now() - t1);
  if (wait > 0) await sleep(wait);
  visSizes[ms] = await shot(`v-from-tiltb-${ms}.png`);
}
await waitFlightEnd();
await shot("v-end.png");

/* ---------- C: blind entry backward from labrule ---------- */
await clickBlind(true);
await sleep(900);
await page.keyboard.press("ArrowDown"); // swarm -> labrule
await sleep(2500);
await waitIdle();
check("C-labrule", "ArrowDown lands on labrule", (await scene()) === "labrule");
await page.keyboard.press("ArrowUp"); // labrule -> swarm (backward, crossfade rebuild)
const t2 = Date.now();
const backSizes = {};
for (const ms of samples) {
  const wait = ms - (Date.now() - t2);
  if (wait > 0) await sleep(wait);
  backSizes[ms] = await shot(`b-from-labrule-${ms}.png`);
}
const sBack = await waitFlightEnd();

/* ---------- verdicts ---------- */
// The bug's signature: mid-crossfade frames at full brightness (>60% of the
// visible control). Fogged frames are ~30% of it (r1: 93 KB vs 280-345 KB).
for (const ms of samples) {
  const ratio = sizes[ms] / visSizes[ms];
  check(`A-${ms}`, `blind entry @+${ms}ms is DARK (fogged from first rise frame)`,
    ratio < 0.6, `blind=${sizes[ms]}KB visible=${visSizes[ms]}KB ratio=${ratio.toFixed(2)}`);
}
for (const ms of samples) {
  const ratio = backSizes[ms] / visSizes[ms];
  check(`C-${ms}`, `backward entry (labrule→swarm) @+${ms}ms is DARK`,
    ratio < 0.6, `blind=${backSizes[ms]}KB visible=${visSizes[ms]}KB ratio=${ratio.toFixed(2)}`);
}
check("C-end", "backward blind flight also paints", sBack?.playing === false && (sBack?.painted ?? 0) > 100,
  `painted=${sBack?.painted}`);
check("E0", "no page/console errors", errors.length === 0, errors.slice(0, 3).join(" | "));

writeFileSync(
  resolve(outDir, "results.json"),
  JSON.stringify({ results, errors, sizes, visSizes, backSizes, blindLine }, null, 2),
  { encoding: "utf8" },
);
console.log(failures === 0 ? "\nDIAG_CHECKS_PASS" : `\nDIAG: ${failures} FAILURES`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
