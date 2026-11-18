import { chromium } from "playwright";
import { mkdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { launchGL } from "./gl-launch.mjs";

const SWIFT = process.argv.includes("--swiftshader");
const outDir = resolve("shots");
mkdirSync(outDir, { recursive: true });

/** The canonical capture list — current page states only. Exported so QA
 *  probes (qa-kicker-chip-clearance) sweep exactly these states. */
export const SHOT_TARGETS = [
  // The intro choreography: ?shot=intro is the canonical full-bleed title
  // hook; ?shot=hero renders the identical deterministic full-bleed pose.
  ["http://localhost:4173/?shot=intro", "01-intro.png"],
  ["http://localhost:4173/?shot=hero", "01-hero.png"],
  ["http://localhost:4173/?shot=task-a", "02-task-a.png"],
  ["http://localhost:4173/?shot=task-b", "03-task-b.png"],
  ["http://localhost:4173/?shot=task-c", "04-task-c.png"],
  ["http://localhost:4173/?shot=gd-a", "07-gd-a.png"],
  ["http://localhost:4173/?shot=gd-b", "08-gd-b.png"],
  ["http://localhost:4173/?shot=gd-c", "09-gd-c.png"],
  ["http://localhost:4173/?shot=gd-d", "10-gd-d.png"],
  ["http://localhost:4173/?shot=mom-a", "11-mom-a.png"],
  ["http://localhost:4173/?shot=mom-b", "12-mom-b.png"],
  ["http://localhost:4173/?shot=mom-c", "28-mom-c.png"],
  ["http://localhost:4173/?shot=adam-a", "13-adam-a.png"],
  ["http://localhost:4173/?shot=adam-b", "14-adam-b.png"],
  ["http://localhost:4173/?shot=lab", "15-lab.png"],
  ["http://localhost:4173/?shot=fog-a", "16-fog-a.png"],
  ["http://localhost:4173/?shot=fog-b", "17-fog-b.png"],
  ["http://localhost:4173/?shot=fog-c", "18-fog-c.png"],
  ["http://localhost:4173/?shot=tilt-a", "19-tilt-a.png"],
  ["http://localhost:4173/?shot=tilt-b", "20-tilt-b.png"],
  ["http://localhost:4173/?shot=swarm", "21-swarm.png"],
  // The picker's NON-default countries (the pills live only in the live
  // dock): each pins the same late-flight frozen pose on its own terrain
  // via ?shot=swarm&map=…
  ["http://localhost:4173/?shot=swarm&map=multi-well-large", "30-swarm-mwl.png"],
  ["http://localhost:4173/?shot=swarm&map=himmelblau", "31-swarm-himmel.png"],
  ["http://localhost:4173/?shot=swarm&map=archipelago", "32-swarm-arch.png"],
  ["http://localhost:4173/?shot=labrule", "22-labrule.png"],
  ["http://localhost:4173/?shot=fogswarm", "25-fogswarm.png"],
  ["http://localhost:4173/?shot=epi-a", "23-epi-a.png"],
  ["http://localhost:4173/?shot=epi-b", "24-epi-b.png"],
  ["http://localhost:4173/?shot=epi-c", "29-epi-c.png"],
];

async function main() {
  const args = SWIFT
    ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu"]
    : [];

  // Hardware-GL launch unless --swiftshader is passed explicitly (QA SCRUB-HITCH).
  const browser = await launchGL(chromium, { args });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

  for (const [url, file] of SHOT_TARGETS) {
    await page.goto(url, { waitUntil: "load" });
    await page.waitForTimeout(1200); // let the WebGL frame render
    await page.screenshot({ path: resolve(outDir, file) });
    console.log("captured", file, "<-", url);
  }
  await browser.close();

  let allBig = true;
  for (const [, file] of SHOT_TARGETS) {
    const kb = statSync(resolve(outDir, file)).size / 1024;
    if (kb <= 30) allBig = false;
    console.log(`${file}: ${kb.toFixed(1)} KB ${kb > 30 ? "OK" : "TOO SMALL"}`);
  }
  console.log(allBig ? "ALL_OK" : "NEED_SWIFTSHADER");
}

// Run the capture loop only when executed directly (the exported target
// list lets probes import this module without side effects).
const invoked = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (invoked && invoked === import.meta.url) {
  await main();
}
