// Reproduce the cdp-responsive w900 lab flag: measure BOTH the reader and
// the card rects, plus the layout band inputs.
import { chromium } from "playwright";
import { launchGL } from "./tools/gl-launch.mjs";
const base = process.argv[2] ?? "http://localhost:4173";
const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto(`${base}/?step=13`, { waitUntil: "load" });
await new Promise((r) => setTimeout(r, 4500));
const rep = await page.evaluate(() => {
  const r = (sel) => document.querySelector(sel)?.getBoundingClientRect().toJSON();
  const card = document.querySelector("#func-card");
  return {
    reader: r("#reader"),
    card: r("#func-card"),
    cardLeftCss: card?.style.left,
    cardMaxW: card?.style.maxWidth,
    curves: r("#curves-panel"),
    compass: r("#minimap-panel"),
    readerW: getComputedStyle(document.documentElement).getPropertyValue("--reader-w"),
    intro: document.querySelector("#app")?.dataset.intro,
  };
});
console.log(JSON.stringify(rep, null, 1));
await page.screenshot({ path: "qa-func-card-shots/w900-lab.png" });
await browser.close();
