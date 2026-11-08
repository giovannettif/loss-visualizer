import { chromium } from "playwright";
import { mkdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const SWIFT = process.argv.includes("--swiftshader");
const outDir = resolve("shots");
mkdirSync(outDir, { recursive: true });

const targets = [
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
  ["http://localhost:4173/?shot=adam-a", "13-adam-a.png"],
  ["http://localhost:4173/?shot=adam-b", "14-adam-b.png"],
  ["http://localhost:4173/?shot=lab", "15-lab.png"],
  ["http://localhost:4173/?shot=fog-a", "16-fog-a.png"],
  ["http://localhost:4173/?shot=fog-b", "17-fog-b.png"],
  ["http://localhost:4173/?shot=fog-c", "18-fog-c.png"],
  ["http://localhost:4173/?shot=tilt-a", "19-tilt-a.png"],
  ["http://localhost:4173/?shot=tilt-b", "20-tilt-b.png"],
  ["http://localhost:4173/?shot=swarm", "21-swarm.png"],
  ["http://localhost:4173/?shot=labrule", "22-labrule.png"],
  ["http://localhost:4173/?shot=fogswarm", "25-fogswarm.png"],
  ["http://localhost:4173/?shot=epi-a", "23-epi-a.png"],
  ["http://localhost:4173/?shot=epi-b", "24-epi-b.png"],
];

const args = SWIFT
  ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu"]
  : [];

const browser = await chromium.launch({ args });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

for (const [url, file] of targets) {
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(1200); // let the WebGL frame render
  await page.screenshot({ path: resolve(outDir, file) });
  console.log("captured", file, "<-", url);
}
await browser.close();

let allBig = true;
for (const [, file] of targets) {
  const kb = statSync(resolve(outDir, file)).size / 1024;
  if (kb <= 30) allBig = false;
  console.log(`${file}: ${kb.toFixed(1)} KB ${kb > 30 ? "OK" : "TOO SMALL"}`);
}
console.log(allBig ? "ALL_OK" : "NEED_SWIFTSHADER");
