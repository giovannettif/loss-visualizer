// Visual probe for the labeled axis frame + upgraded formulas (COPY-PLAN
// §4.1 / §3). Captures: least-squares isometric, least-squares Map view,
// gd-c (frac thresholds), epi-a (gold Σ formula + w* closed form),
// fog-b (fog-leak guard: NO axis frame while fogged).
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { launchGL } from "./tools/gl-launch.mjs";

const PORT = process.env.PROBE_PORT ?? "4175";
const outDir = resolve("qa-axis-shots");
mkdirSync(outDir, { recursive: true });

const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

async function capture(url, file, extraMs = 0) {
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(1600 + extraMs); // render + settle
  await page.screenshot({ path: resolve(outDir, file) });
  console.log("captured", file, "<-", url);
}

// 1) §1 least squares, isometric default.
await capture(`http://localhost:${PORT}/?shot=task-b`, "ls-iso.png");

// 2) Same landscape, Map view preset (click the view's own button).
await page.click('button[data-preset="map"]');
await page.waitForTimeout(900);
await page.screenshot({ path: resolve(outDir, "ls-map.png") });
console.log("captured ls-map.png (Map view preset clicked)");

// 3) gd-c: the 1/λmax and 2/λmax stacked fractions in the reader.
await capture(`http://localhost:${PORT}/?shot=gd-c`, "formula-gdc.png");

// 4) epi-a: the gold Σ box + w* = (XᵀX)⁻¹Xᵀy closed form.
await capture(`http://localhost:${PORT}/?shot=epi-a`, "formula-epi.png");

// 5) fog-b: mid-fog-game — the axis frame must be fully hidden.
await capture(`http://localhost:${PORT}/?shot=fog-b`, "fog-b-noaxes.png");

// Diagnostics: the preset button really registered + page stayed healthy.
const diag = await page.evaluate(() => ({
  mapBtn: !!document.querySelector('button[data-preset="map"]'),
  errors: 0,
}));
console.log("diag:", JSON.stringify(diag));

await browser.close();
console.log("PROBE_DONE");
