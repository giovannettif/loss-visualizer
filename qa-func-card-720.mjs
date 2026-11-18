// Short-viewport collision check: the card (top-center) vs the compass
// re-dock tiers (top-right at ≤800px height on gd scenes; top-right on lab).
import { chromium } from "playwright";
import { launchGL } from "./tools/gl-launch.mjs";

const base = process.argv[2] ?? "http://localhost:4173";
let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

async function waitIdle() {
  for (;;) {
    const a = await page.evaluate(() => ({
      locked: window.__wp1?.locked?.() ?? false,
      animating: window.__wp1?.animating?.() ?? false,
    }));
    if (!a.locked && !a.animating) return;
    await sleep(200);
  }
}
async function overlap(selA, selB) {
  return page.evaluate(([a, b]) => {
    const ra = document.querySelector(a)?.getBoundingClientRect();
    const rb = document.querySelector(b)?.getBoundingClientRect();
    if (!ra || !rb) return null;
    const x = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
    const y = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
    return x > 0 && y > 0 ? { x, y } : null;
  }, [selA, selB]);
}

for (const [url, name, compassSel] of [
  ["/?step=5", "gd-c 1280x720", "#minimap-panel"],
  ["/?step=13", "lab 1280x720", "#minimap-panel"],
  ["/?step=11", "adam-a 1280x720", "#adam-panel"],
  ["/?step=17", "fog-c 1280x720", "#fog-panel"],
  ["/?step=22", "labrule 1280x720", "#rule-panel"],
]) {
  await page.goto(`${base}${url}`, { waitUntil: "load" });
  await waitIdle();
  await sleep(400);
  const ov = await overlap("#func-card[data-visible='true']", compassSel);
  check(
    `${name}: no card/HUD overlap`,
    ov === null,
    ov ? JSON.stringify(ov) : "clean",
  );
  await page.screenshot({ path: `qa-func-card-shots/720-${name.split(" ")[0]}.png` });
}
await browser.close();
console.log(failures === 0 ? "CARD_720_OK" : `CARD_720_FAILURES: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
