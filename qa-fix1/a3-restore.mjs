/**
 * a3-restore.mjs — regression guard for INT-1's change: a PLAYED (used > 0)
 * finished level-2 run must STILL restore on backward re-entry of fog-b
 * (T6-S6-BACK-RESETS-FINISHED-FOG-RUN), while the empty run gets a fresh game.
 */
import { chromium } from "playwright";
import { launchGL } from "../tools/gl-launch.mjs";
import { sleep, appState, waitIdle, check, finish, OUT_DIR } from "./h.mjs";
import { resolve } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:4188";
const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

// Boot on fog-b (step 16), take a few strides, Finish.
await page.goto(`${BASE}/?step=16`, { waitUntil: "load" });
await page.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
await waitIdle(page);
await sleep(300);

// Draw strides on the compass: drag from the start point outward.
const mm = await page.locator("#minimap-canvas").boundingBox();
const st0 = await page.evaluate(() => window.__wp1.fog());
for (const [dx, dy] of [[25, -18], [22, -14], [18, -12]]) {
  const bx = mm.x + mm.width / 2 + (dx - 20);
  const by = mm.y + mm.height / 2 + (dy + 10);
  await page.mouse.move(bx, by);
  await page.mouse.down();
  await page.mouse.move(bx + dx * 2.2, by + dy * 2.2, { steps: 8 });
  await page.mouse.up();
  await sleep(400);
}
const played = await page.evaluate(() => window.__wp1.fog());
console.log(`after strides: used=${played.used} done=${played.done}`);
// Finish the run
await page.click("#fog-finish");
await sleep(800);
const fin = await page.evaluate(() => window.__wp1.fog());
check("fog-b: strides spent + Finish ends the run", fin.used > 0 && fin.done === true, JSON.stringify({ used: fin.used, done: fin.done }));

// Forward to fog-c (the reveal), then BACK to fog-b — the played run must restore.
await page.keyboard.press("ArrowDown");
await sleep(2500);
await waitIdle(page);
const atC = await page.evaluate(() => ({ step: window.__wp1.step(), scene: window.__wp1.scene(), fog: window.__wp1.fog() }));
check("fog-c reached with the played run", atC.step === 17 && atC.fog.used > 0 && atC.fog.done === true, JSON.stringify(atC));

await page.keyboard.press("ArrowUp"); // backward: fog-c → fog-b restores
await sleep(1200);
const back = await page.evaluate(() => {
  const f = window.__wp1.fog();
  return { step: window.__wp1.step(), scene: window.__wp1.scene(), used: f?.used, done: f?.done, finishHidden: document.querySelector("#fog-finish")?.hidden };
});
check(
  "backward re-entry of fog-b still RESTORES a played (used>0) finished run",
  back.step === 16 && back.used === fin.used && back.done === true,
  JSON.stringify(back),
);
await page.screenshot({ path: resolve(OUT_DIR, "a3-fogb-restored.png") });

// And the empty flavor: from the restored run, forward to fog-c, jump back —
// the run is now used>0 so it must restore (this is the fog-goto-l2 path
// AFTER the reader actually played).
await page.keyboard.press("ArrowDown"); // to fog-c
await sleep(2000);
await waitIdle(page);
const leadBtn = await page.evaluate(() => {
  const lead = document.querySelector("#fog-empty-lead");
  return { emptyLeadVisible: lead && !lead.hidden };
});
await page.keyboard.press("ArrowUp");
await sleep(1200);
const back2 = await page.evaluate(() => {
  const f = window.__wp1.fog();
  return { step: window.__wp1.step(), used: f?.used, done: f?.done };
});
check("second backward re-entry still restores (idempotent)", back2.step === 16 && back2.used === fin.used && back2.done === true, JSON.stringify(back2));

await browser.close();
finish("a3-restore");
