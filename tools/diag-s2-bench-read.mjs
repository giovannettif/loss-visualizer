// diag-s2-bench-read.mjs — reads the §5 rebuild bench output.
import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";

const base = process.argv[2] ?? "http://localhost:4189";
const browser = await launchGL(chromium);
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto(`${base}/bench-s2.html`, { waitUntil: "load" });
await page.waitForFunction(
  () => (document.getElementById("out")?.textContent ?? "").includes("done"),
  null,
  { timeout: 60000 },
);
console.log(await page.evaluate(() => document.getElementById("out").textContent));
await browser.close();
