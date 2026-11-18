/** qa-diag-slook-adjacent.mjs — adjacent wiring census for the S7 ghost fix:
 *  which registered addresses carry data-slook today, across the flavor and
 *  late-fill pages (17, 20, 22, 23). Usage: node qa-diag-slook-adjacent.mjs [base] */
import { chromium } from "playwright";
import { launchGL } from "./tools/gl-launch.mjs";

const base = process.argv[2] ?? "http://localhost:4199";
const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitIdle() {
  for (let i = 0; i < 40; i++) {
    const a = await page.evaluate(() => ({
      locked: window.__wp1.locked(),
      animating: window.__wp1.animating(),
    }));
    if (!a.locked && !a.animating) return true;
    await sleep(250);
  }
  return false;
}

for (const step of [17, 20, 22, 23]) {
  await page.goto(`${base}/?step=${step}`, { waitUntil: "load" });
  await page.waitForTimeout(700);
  await waitIdle();
  const inv = await page.evaluate(() => {
    const stepEl = document.querySelector('.rstep[data-active="true"]');
    const body = stepEl?.querySelector(".step__body");
    const ps = body ? Array.from(body.children).filter((el) => el.tagName === "P") : [];
    return ps.map((p, i) => ({
      para: i,
      id: p.id ?? null,
      hidden: p.hidden,
      rects: p.getClientRects().length,
      spans: p.querySelectorAll("span.sent").length,
      slookSpans: p.querySelectorAll("span.sent[data-slook]").length,
      lookSpans: p.querySelectorAll("[data-look]").length,
      slookKeys: Array.from(p.querySelectorAll("span.sent[data-slook]")).map(
        (s) => s.dataset.slook,
      ),
      text: (p.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40),
    }));
  });
  console.log(`\n=== page ${step} (${await page.evaluate(() => window.__wp1.scene())}) ===`);
  for (const p of inv) {
    console.log(
      `  para ${p.para}${p.id ? ` #${p.id}` : ""} hidden=${p.hidden} spans=${p.spans} ` +
        `slook=${p.slookSpans}${p.slookKeys.length ? JSON.stringify(p.slookKeys) : ""} ` +
        `dataLook=${p.lookSpans} | ${p.text}`,
    );
  }
}
await browser.close();
console.log("\nADJACENT_CENSUS_DONE");
