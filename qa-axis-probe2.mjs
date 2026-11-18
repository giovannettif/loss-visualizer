// Second probe: §1 formula box (F1), swarm blind (no axis leak), tilt-a
// (axes present per COPY-PLAN §4.2), hero (identity colors).
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
  await page.waitForTimeout(1600 + extraMs);
  await page.screenshot({ path: resolve(outDir, file) });
  console.log("captured", file, "<-", url);
}

await capture(`http://localhost:${PORT}/?shot=task-a`, "task-a-formula.png");
await capture(`http://localhost:${PORT}/?shot=swarm`, "swarm-blind.png");
await capture(`http://localhost:${PORT}/?shot=tilt-a`, "tilt-a.png");
await capture(`http://localhost:${PORT}/?shot=hero`, "hero.png");

await browser.close();
console.log("PROBE2_DONE");
