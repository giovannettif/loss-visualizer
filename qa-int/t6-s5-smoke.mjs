/** t6-s5-smoke.mjs — §5 tour smoke against the NEW lab dock (regression). */
import { chromium } from "playwright";
import { launchGL } from "../tools/gl-launch.mjs";
import { check, finish, sleep, appState, waitIdle, waitFor, shot } from "./h.mjs";
const BASE = process.argv[2] ?? "http://localhost:4184";
const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
const st = () => appState(page);
const tour = () => page.evaluate(() => window.__wp1.tour());

await page.goto(BASE + "/?step=13", { waitUntil: "load" });
await page.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
await waitIdle(page);
await page.locator('.rstep[data-active="true"] .tour-launch[data-tour="s5"]').click();
const t0 = await waitFor(page, async () => {
  const t = await tour();
  return t.running && t.phase === "active" && t.stepIndex === 0 ? t : null;
}, { label: "s5 start", maxMs: 20000 });
check("s5 tour starts at the lab sliders sentence (gate armed)", !!t0 && t0.gate === true,
  `i=${t0?.stepIndex} gate=${t0?.gate} kind=${t0?.gateKind}`);
// release the labMoved gate by dragging the slider INSIDE THE DOCK
{
  const box = await page.locator("#lab-dock #elong-slider").boundingBox();
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.5, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.75, y, { steps: 6 });
  await page.mouse.up();
}
const t1 = await waitFor(page, async () => {
  const t = await tour();
  return t.phase === "active" && t.stepIndex === 1 ? t : null;
}, { label: "s5 dock drag releases gate", maxMs: 20000 });
check("s5 gate releases via a DOCK slider drag (auto-advance to the checklist sentence)",
  !!t1 && t1.gate === false, `i=${t1?.stepIndex} gate=${t1?.gate}`);
// the checklist look target still resolves (leader overlay on)
const lk = await page.evaluate(() => window.__wp1.look());
console.log(`  INFO  look at i=1: ${JSON.stringify({ id: lk?.id, active: lk?.active })}`);
await page.keyboard.press("Escape");
await sleep(400);
const tEnd = await tour();
check("s5 Esc exits clean", tEnd.running === false, `running=${tEnd.running}`);
await browser.close();
finish("T6-S5-SMOKE");
