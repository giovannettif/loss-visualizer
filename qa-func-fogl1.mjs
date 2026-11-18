// Level-1 reveal: fog-a run end (Finish) must show the LEAST-SQUARES card.
import { chromium } from "playwright";
import { launchGL } from "./tools/gl-launch.mjs";
const base = process.argv[2] ?? "http://localhost:4173";
const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await page.goto(`${base}/?step=15`, { waitUntil: "load" });
for (;;) {
  const a = await page.evaluate(() => ({ l: window.__wp1?.locked?.(), an: window.__wp1?.animating?.() }));
  if (!a.l && !a.an) break;
  await sleep(200);
}
await sleep(400);
// One stride on the compass (a real drag along +x), then Finish.
const mm = await page.evaluate(() => {
  const c = document.querySelector("#minimap-canvas");
  const r = c.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});
// drag from the white point toward +x: the start (0.2, 0.5) maps near the
// canvas center-ish; a 40px horizontal drag is inside the stride ring.
await page.mouse.move(mm.x + mm.w / 2, mm.y + mm.h / 2);
await page.mouse.down();
await page.mouse.move(mm.x + mm.w / 2 + 60, mm.y + mm.h / 2, { steps: 8 });
await page.mouse.up();
await sleep(1400);
await page.click("#fog-finish");
await sleep(1200);
const card = await page.evaluate(() => ({
  visible: document.querySelector("#func-card")?.dataset.visible === "true",
  title: document.querySelector("#func-card-title")?.textContent,
  math: (document.querySelector("#func-card-math")?.textContent ?? "").replace(/\s+/g, " ").trim(),
  values: (document.querySelector("#func-card-vals")?.textContent ?? "").replace(/\u00A0/g, " ").trim(),
}));
console.log(JSON.stringify(card));
const ok = card.visible && card.math.includes("Σ") && card.math.includes("(w·x") && card.values.includes("12 points");
console.log(ok ? "FOG_L1_REVEAL_OK" : "FOG_L1_REVEAL_FAIL");
await page.screenshot({ path: "qa-func-card-shots/13-foga-reveal-ls-card.png" });
await browser.close();
process.exit(ok ? 0 : 1);
