/** Screenshot sanity for hover-to-look + the upgraded transport. */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const base = process.argv[2] ?? "http://localhost:4173";
mkdirSync(".shots/look", { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gotoStep(n) {
  await page.goto(`${base}/?step=${n}`, { waitUntil: "load" });
  await sleep(3500);
  for (let i = 0; i < 25; i++) {
    if (!(await page.evaluate(() => window.__wp1.locked()))) break;
    await sleep(300);
  }
  await sleep(400);
}

/** Hover the active step's look span (grid-probed, like the verify script). */
async function hoverLook(key) {
  const pt = await page.evaluate((k) => {
    const el = document.querySelector(`.rstep[data-active="true"] [data-look="${k}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    for (const fy of [0.15, 0.35, 0.55, 0.75, 0.95]) {
      for (const fx of [0.08, 0.3, 0.5, 0.7, 0.92]) {
        const x = r.left + r.width * fx;
        const y = r.top + r.height * fy;
        const hit = document.elementFromPoint(x, y);
        if (hit && (hit === el || el.contains(hit))) return { x, y };
      }
    }
    return null;
  }, key);
  if (!pt) throw new Error(`no hit point for ${key}`);
  await page.mouse.move(400, 450);
  await sleep(120);
  await page.mouse.move(pt.x, pt.y);
  await sleep(1000);
}

// §1: the fit inset spotlighted, other panels dimmed.
await gotoStep(1);
await hoverLook("loss-readout");
await page.screenshot({ path: resolve(".shots/look", "01-loss-readout-spot.png") });

// §2 gd-a: needle spotlight (minimap halo + panel glow).
await gotoStep(4);
await hoverLook("needle");
await page.screenshot({ path: resolve(".shots/look", "02-needle-spot.png") });

// §3 mom-a: trail spotlight (blue kept bright, scene recedes).
await gotoStep(8);
await hoverLook("trail-mom");
await page.screenshot({ path: resolve(".shots/look", "03-trail-spot.png") });

// §4 adam-a: arrows spotlight ring.
await gotoStep(11);
await hoverLook("adam-arrows");
await page.screenshot({ path: resolve(".shots/look", "04-arrows-spot.png") });

// §2 gd-c: transport playing (pause label, scrub fill, progress underline).
await gotoStep(6);
await page.click("#play-btn");
await sleep(1500);
await page.screenshot({ path: resolve(".shots/look", "05-transport-playing.png") });

await browser.close();
console.log("screenshots done");
