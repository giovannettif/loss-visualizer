// Diagnostic — MOM-APEX-RELIGHT-AFTER-SKIP repro-level verification.
// Repro from the finding: ?step=8 → mom-b → Skip animation → hover (or
// keyboard-focus) the mom-apexes look span → the gold markers must relight.
// Control: the natural burn-bright/fade path must relight the same way.
// Usage: node tools/diag-momapex-relight.mjs [base]
import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";
const base = process.argv[2] ?? "http://localhost:4311";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) fails += 1;
};
const browser = await launchGL(chromium);

// Count gold-ish pixels (MANIM.gold 0xf0ac5f = 240,172,95) in a screenshot,
// decoded in-page (diag-sweep2-c pattern: dataURL → Image → 2D canvas).
async function goldCount(page) {
  const buf = await page.screenshot({ type: "png" });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const x = c.getContext("2d");
    x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (Math.abs(d[i] - 240) <= 50 && Math.abs(d[i + 1] - 172) <= 60 && Math.abs(d[i + 2] - 95) <= 65) n += 1;
    }
    return n;
  }, buf.toString("base64"));
}

async function open(path) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto(`${base}/${path}`, { waitUntil: "load" });
  await page.waitForFunction(
    () => { const b = document.querySelector("#boot"); return !b || b.dataset.done === "true"; },
    null, { timeout: 15000 },
  ).catch(() => {});
  await sleep(800);
  return page;
}
async function idle(page, ms = 14000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const a = await page.evaluate(() => window.__wp1.locked() || window.__wp1.animating());
    if (!a) break;
    await sleep(150);
  }
  await sleep(300);
}
// Land on mom-b (?step=8 is mom-a; one ArrowDown enters mom-b, locked+playing).
async function toMomB(page) {
  await idle(page);
  const s0 = await page.evaluate(() => window.__wp1.scene());
  await page.keyboard.press("ArrowDown");
  await sleep(300);
  const locked = await page.evaluate(() => window.__wp1.locked());
  const s1 = await page.evaluate(() => window.__wp1.scene());
  return { s0, s1, locked };
}
// Find a clickable point inside the active step's mom-apexes span.
async function spanPoint(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.rstep[data-active="true"] [data-look="mom-apexes"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    for (const fy of [0.15, 0.35, 0.55, 0.75, 0.95]) {
      for (const fx of [0.08, 0.3, 0.5, 0.7, 0.92]) {
        const x = r.left + r.width * fx, y = r.top + r.height * fy;
        const hit = document.elementFromPoint(x, y);
        if (hit && (hit === el || el.contains(hit))) return { x, y };
      }
    }
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
}
async function hoverSpan(page) {
  const pt = await spanPoint(page);
  await page.mouse.move(400, 450);
  await sleep(300);
  await page.mouse.move(pt.x, pt.y);
  await sleep(1200);
  return pt;
}

/* ---- Run 1: Skip → POINTER hover on the mom-apexes span ---- */
{
  const page = await open("?step=8");
  const nav = await toMomB(page);
  check("R1 nav: ArrowDown locks on mom-b", nav.s0 === "mom-a" && nav.s1 === "mom-b" && nav.locked, JSON.stringify(nav));
  await page.evaluate(() => window.__wp1.skip());
  await idle(page);
  await sleep(2000); // scroll ease settle (hover-to-look motion gate)
  const mom = await page.evaluate(() => window.__wp1.mom());
  const baseGold = await goldCount(page);
  console.log(`  R1 mom state after skip: ${JSON.stringify(mom).slice(0, 160)}  goldBaseline=${baseGold}`);
  await hoverSpan(page);
  const look = await page.evaluate(() => window.__wp1.look());
  const gold = await goldCount(page);
  check("R1 SKIP+HOVER: look activates on mom-apexes with dim + ring", look.id === "mom-apexes" && look.sceneDim === true && look.ring === true, JSON.stringify(look));
  check("R1 SKIP+HOVER: gold markers relight (gold pixels rise vs baseline)", gold > baseGold + 150, `baseline=${baseGold} hover=${gold} delta=${gold - baseGold}`);
  await page.close();
}

/* ---- Run 2: Skip → KEYBOARD focus on the mom-apexes span ---- */
{
  const page = await open("?step=8");
  await toMomB(page);
  await page.evaluate(() => window.__wp1.skip());
  await idle(page);
  await sleep(2000);
  const baseGold = await goldCount(page);
  await page.evaluate(() => {
    const el = document.querySelector('.rstep[data-active="true"] [data-look="mom-apexes"]');
    el.focus();
  });
  await sleep(1200);
  const look = await page.evaluate(() => window.__wp1.look());
  const gold = await goldCount(page);
  check("R2 SKIP+FOCUS: look activates on mom-apexes with dim + ring", look.id === "mom-apexes" && look.sceneDim === true && look.ring === true, JSON.stringify(look));
  check("R2 SKIP+FOCUS: gold markers relight", gold > baseGold + 150, `baseline=${baseGold} focus=${gold} delta=${gold - baseGold}`);
  await page.close();
}

/* ---- Run 3 (control): NATURAL fade → pointer hover must relight ---- */
{
  const page = await open("?step=8");
  await toMomB(page);
  await idle(page);
  await sleep(2400); // markers burn bright then fade (decay dt/1.8 from T=1)
  const mid = await page.evaluate(() => window.__wp1.look());
  const baseGold = await goldCount(page);
  await hoverSpan(page);
  const look = await page.evaluate(() => window.__wp1.look());
  const gold = await goldCount(page);
  check("R3 NATURAL-FADE control: look activates with dim + ring", look.id === "mom-apexes" && look.sceneDim === true && look.ring === true, JSON.stringify(look));
  check("R3 NATURAL-FADE control: gold markers relight", gold > baseGold + 150, `baseline=${baseGold} hover=${gold} delta=${gold - baseGold}`);
  // decay holds while the look is active (per-frame gate) — still lit 1s later
  await sleep(1000);
  const held = await page.evaluate(() => window.__wp1.look());
  check("R3 control: relight holds while the span stays hovered", held.sceneDim === true && held.ring === true, JSON.stringify(held));
  await page.close();
}

await browser.close();
console.log(fails === 0 ? "DIAG_MOMAPEX_OK" : `DIAG_MOMAPEX_FAILED (${fails})`);
process.exit(fails === 0 ? 0 : 1);
