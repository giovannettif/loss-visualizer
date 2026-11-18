// Computed-style check on the formula primitives (F1/F2/F3/F4).
import { chromium } from "playwright";
import { launchGL } from "./tools/gl-launch.mjs";

const PORT = process.env.PROBE_PORT ?? "4175";
const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

async function check(shot, selector, props) {
  await page.goto(`http://localhost:${PORT}/?shot=${shot}`, { waitUntil: "load" });
  await page.waitForTimeout(1200);
  const out = await page.evaluate(({ sel, props }) => {
    const el = document.querySelector(sel);
    if (!el) return { missing: true };
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const o = { rect: { w: Math.round(r.width), h: Math.round(r.height) } };
    for (const p of props) o[p] = cs[p];
    return o;
  }, { sel: selector, props });
  console.log(shot, selector, JSON.stringify(out));
}

await check("task-a", ".formula .sum", ["fontSize", "display", "flexDirection", "verticalAlign"]);
await check("task-a", ".formula .sum .sum-sym", ["fontSize"]);
await check("task-a", ".formula .sum .sum-n", ["fontSize"]);
await check("gd-c", ".frac", ["display", "flexDirection", "verticalAlign"]);
await check("gd-c", ".frac > .num", ["fontSize"]);
await check("gd-c", ".frac > .den", ["fontSize", "borderTopWidth"]);
await check("epi-a", ".formula-gold", ["fontSize", "color", "borderLeftColor"]);
await check("epi-a", ".formula-wstar sup", ["fontSize"]);
await browser.close();
console.log("STYLE_CHECK_DONE");
