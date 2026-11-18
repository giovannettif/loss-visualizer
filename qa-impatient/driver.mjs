/**
 * driver.mjs — shared helpers for the impatient-user QA run (port 4182).
 * Drives the REAL page at http://localhost:4182/ with true input events.
 */
import { chromium } from "playwright";

export const BASE = "http://localhost:4182/";

export async function launch(opts = {}) {
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--disable-gpu-sandbox",
      "--no-sandbox",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (e) => console.log(`  [pageerror] ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") console.log(`  [console.error] ${m.text()}`);
  });
  return { browser, page };
}

/** Wait until the boot overlay is gone and the app diagnostics are live. */
export async function waitReady(page) {
  await page.waitForFunction(() => {
    const w = window.__wp1;
    return w && !document.getElementById("boot");
  }, null, { timeout: 30000, polling: 250 });
  await page.waitForTimeout(400);
}

export const app = (page, expr) => page.evaluate((src) => eval(src), expr);

/** Consistency snapshot: is the stepper/scene/rail/count in a sane state? */
export async function snapshot(page) {
  return page.evaluate(() => {
    const w = window.__wp1;
    const steps = [...document.querySelectorAll("#reader-body .rstep")];
    const cur = w.step();
    const rail = [...document.querySelectorAll("#rail button")];
    return {
      step: cur,
      count: w.count(),
      scene: w.scene(),
      locked: w.locked(),
      animating: w.animating(),
      scroll: w.scroll(),
      countText: document.querySelector("#reader-count")?.textContent ?? null,
      railCurrent: rail.findIndex((b) => b.dataset.current === "true"),
      activeInert: steps.every((el, k) => (k === cur) === (el.dataset.active === "true")),
      hintHidden: document.querySelector("#continue-hint")?.hidden ?? null,
      skipHidden: document.querySelector("#skip-btn")?.hidden ?? null,
      tour: w.tour(),
      fog: w.fog() ? { used: w.fog().used, done: w.fog().done } : null,
      tilt: w.tilt() ? { cells: w.tilt().cells, steps: w.tilt().steps, live: w.tilt().live ?? null } : null,
    };
  });
}

export function ok(cond, label, detail = "") {
  const tag = cond ? "PASS" : "FAIL";
  console.log(`  [${tag}] ${label}${detail ? ` — ${detail}` : ""}`);
  return cond;
}

export async function shot(page, name) {
  await page.screenshot({ path: `qa-impatient/${name}.png` });
}
