/** qa-s2mm-labgate.mjs — instrument the s5 labMoved Back→Next re-arm:
 *  sample tour state + lab params at 100ms to see whether the gate ever
 *  arms (instant-release) or never arms (stuck in travel). */
import { chromium } from "playwright";
import { launchGL } from "./tools/gl-launch.mjs";

const base = process.argv[2] ?? "http://localhost:4181";
const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitIdle(maxMs = 30000) {
  const t0 = Date.now();
  for (;;) {
    const a = await page.evaluate(() => ({ locked: window.__wp1?.locked?.(), animating: window.__wp1?.animating?.() }));
    if (!a.locked && !a.animating) return true;
    if (Date.now() - t0 > maxMs) return false;
    await sleep(200);
  }
}
const snap = () =>
  page.evaluate(() => {
    const t = window.__wp1?.tour?.();
    return {
      i: t?.stepIndex, ph: t?.phase, gate: t?.gate, run: t?.running, page: t?.page,
      reader: window.__wp1?.step?.(),
      locked: window.__wp1?.locked?.(),
      animating: window.__wp1?.animating?.(),
      scrollPark: window.__wp1?.scroll?.().parked,
      atSnap: window.__wp1?.scroll?.().atSnap,
    };
  });

await page.goto(`${base}/?step=14`, { waitUntil: "load" });
await sleep(1700);
await waitIdle();
await page.locator("#tour-entry").click();
await sleep(2500);
console.log("seeded:", JSON.stringify(await snap()));

// Back during the gate.
const back = await page.locator("#tour-back").boundingBox();
await page.mouse.click(back.x + back.width / 2, back.y + back.height / 2);
const samples = [];
const t0 = Date.now();
let sawGate = false;
while (Date.now() - t0 < 12000) {
  const s = await snap();
  samples.push({ t: Date.now() - t0, ...s });
  if (s.gate) sawGate = true;
  if (s.ph === "active" && s.i === 2) {
    // continue sampling 3s past activation to catch arm→release
    const t1 = Date.now();
    while (Date.now() - t1 < 3000) {
      const s2 = await snap();
      samples.push({ t: Date.now() - t0, ...s2 });
      if (s2.gate) sawGate = true;
      await sleep(100);
    }
    break;
  }
  await sleep(100);
}
// Compact print: phase/gate transitions only.
let prev = "";
for (const s of samples) {
  const key = `${s.i}/${s.ph}/g${s.gate ? 1 : 0}/p${s.page}/r${s.reader}/l${s.locked ? 1 : 0}/a${s.animating ? 1 : 0}/sp${s.scrollPark}`;
  if (key !== prev) {
    console.log(`t=${String(s.t).padStart(5)} i=${s.i} ph=${s.ph} gate=${s.gate} tourPage=${s.page} reader=${s.reader} locked=${s.locked} anim=${s.animating} parked=${s.scrollPark}`);
    prev = key;
  }
}
console.log("sawGate(re-arm):", sawGate);
// Lab params sanity.
console.log("lab:", JSON.stringify(await page.evaluate(() => window.__wp1?.lab?.())));
await browser.close();
