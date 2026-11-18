/**
 * find-fogjump.mjs — focused repro for the #fog-goto-l2 finding.
 * URL http://localhost:4184/?step=17 (the fog-c empty-run reveal).
 * Click the lead's "Take the Level 2 run →" button; report what state the
 * visitor lands on (fresh game vs restored finished run) and what the
 * panel/compass let them do there.
 */
import { chromium } from "playwright";
import { launchGL } from "../tools/gl-launch.mjs";
import { sleep, shot, OUT_DIR, appState, waitIdle } from "./h.mjs";
import { resolve } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:4184";
const tag = process.argv[3] ?? "run1";
const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

await page.goto(BASE + "/?step=17", { waitUntil: "load" });
await page.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
// the ?step boot plays the fog-c entry under the lock; the jump button's
// handler refuses while locked — wait for rest like a reader would.
await waitIdle(page);
await sleep(300);
const before = await page.evaluate(() => ({
  step: window.__wp1.step(),
  scene: window.__wp1.scene(),
  fog: window.__wp1.fog(),
  leadText: (document.querySelector("#fog-empty-lead")?.textContent ?? "").trim().replace(/\s+/g, " "),
  leadVisible: !document.querySelector("#fog-empty-lead")?.hidden,
}));
console.log(`[${tag}] BEFORE click:`, JSON.stringify(before));

await page.click("#fog-goto-l2");
await sleep(1500);
const after = await page.evaluate(() => {
  const cap = document.querySelector("#fog-caption");
  const finishBtn = document.querySelector("#fog-finish");
  return {
    step: window.__wp1.step(),
    scene: window.__wp1.scene(),
    fog: window.__wp1.fog(),
    fogCaption: cap?.textContent?.trim() ?? null,
    finishHidden: finishBtn?.hidden ?? null,
  };
});
console.log(`[${tag}] AFTER click:`, JSON.stringify(after));
await page.screenshot({ path: resolve(OUT_DIR, `find-fogjump-${tag}.png`) });
await browser.close();
