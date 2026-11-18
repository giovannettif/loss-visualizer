/**
 * qa-diag-c3-captiming.mjs — C3-CAP-TIMING repro.
 *
 * Drives §2 exactly like tools/gate-tour.mjs section 4 (chip click →
 * waitTour(phase==="active" && stepIndex===0)) and measures, AT the moment
 * the gate's screenshot would fire vs after a settle wait:
 *   - computed opacity of #tour-overlay (leader overlay, 0.35s fade)
 *   - computed opacity of #tour-bar (controller, 0.35s fade)
 *   - computed opacity of a dim-target sibling (.step__body[data-tour-dim]
 *     > :not(.tour-keep), 0.45s fade to 0.35)
 *   - ms elapsed since the chip click
 * Screenshots both moments to shots/_diag-c3-immediate.png / _settled.png.
 *
 * Usage: node qa-diag-c3-captiming.mjs [baseUrl]
 */
import { chromium } from "playwright";
import { launchGL } from "./tools/gl-launch.mjs";

const base = process.argv[2] ?? "http://localhost:4175";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

async function tourState() {
  return page.evaluate(() => window.__wp1?.tour?.() ?? null);
}
async function fadeState() {
  return page.evaluate(() => {
    const ov = document.querySelector("#tour-overlay");
    const bar = document.querySelector("#tour-bar");
    const gate = document.querySelector("#tour-gate-chip");
    const dimBody = document.querySelector('.step__body[data-tour-dim="true"]');
    let sib = null;
    if (dimBody) {
      const el = [...dimBody.children].find(
        (c) => !c.classList.contains("tour-keep"),
      );
      if (el) sib = getComputedStyle(el).opacity;
    }
    return {
      overlayOpacity: ov ? Number(getComputedStyle(ov).opacity) : null,
      barOpacity: bar ? Number(getComputedStyle(bar).opacity) : null,
      gateOn: gate?.dataset.on ?? null,
      dimSibOpacity: sib,
    };
  });
}

await page.goto(`${base}/?step=4`, { waitUntil: "load" });
await sleep(1400);
// waitIdle, same as the gate
for (let i = 0; i < 125; i++) {
  const a = await page.evaluate(() => ({
    locked: window.__wp1?.locked?.(),
    animating: window.__wp1?.animating?.(),
  }));
  if (!a.locked && !a.animating) break;
  await sleep(200);
}

// Chip click + waitTour poll loop, identical cadence to the gate (120ms).
const t0 = Date.now();
await page.locator('.rstep[data-active="true"] .tour-launch').click();
let s = null;
for (;;) {
  s = await tourState();
  if (s && s.phase === "active" && s.stepIndex === 0) break;
  if (Date.now() - t0 > 12000) break;
  await sleep(120);
}
const atResolve = Date.now() - t0;
const imm = await fadeState();
await page.screenshot({ path: "shots/_diag-c3-immediate.png" });

await sleep(700); // longer than the longest fade (0.45s)
const settled = await fadeState();
await page.screenshot({ path: "shots/_diag-c3-settled.png" });

console.log(JSON.stringify({
  atResolveMs: atResolve,
  immediate: imm,
  settled,
}, null, 2));

await browser.close();
