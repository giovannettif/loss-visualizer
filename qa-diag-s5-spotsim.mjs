// Confirms: (a) the "control"-kind anchor math (director.ts:2692) would land
// on #lab-checklist's rect center; (b) data-spot on the checklist today has
// NO matching CSS rule (no glow) — the fix must add one.
import { chromium } from "playwright";
import { launchGL } from "./tools/gl-launch.mjs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto("http://localhost:4195/?step=13", { waitUntil: "load" });
await sleep(2000);
const out = await page.evaluate(() => {
  const cl = document.getElementById("lab-checklist");
  const rects = cl.getClientRects().length; // the control-kind visibility guard
  const r = cl.getBoundingClientRect();
  const anchor = { x: r.left + r.width * 0.5, y: r.top + r.height / 2 }; // control case returns this
  // simulate applyLook's control case (director.ts:6474) minus the registry:
  cl.dataset.spot = "true";
  const cs = getComputedStyle(cl);
  const spotStyle = {
    boxShadow: cs.boxShadow,
    borderColor: cs.borderColor,
    opacityDimmed: cs.opacity,
  };
  cl.removeAttribute("data-spot");
  return { rects, anchor: { x: Math.round(anchor.x), y: Math.round(anchor.y) }, spotStyle };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
