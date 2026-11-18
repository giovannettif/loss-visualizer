// Console/page-error sweep across the axis-frame-touched scene states.
import { chromium } from "playwright";
import { launchGL } from "./tools/gl-launch.mjs";

const PORT = process.env.PROBE_PORT ?? "4175";
const STATES = [
  "task-a", "task-b", "gd-c", "mom-a", "adam-a", "lab", "fog-b", "tilt-a",
  "swarm", "labrule", "epi-a", "hero", "intro",
];
const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});
for (const s of STATES) {
  errors.length = 0;
  await page.goto(`http://localhost:${PORT}/?shot=${s}`, { waitUntil: "load" });
  await page.waitForTimeout(2200);
  console.log(`${s}: ${errors.length === 0 ? "CLEAN" : errors.join(" | ")}`);
}
await browser.close();
console.log("SWEEP_DONE");
