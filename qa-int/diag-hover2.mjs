/** diag-hover2.mjs — what element really sits at the hover target? */
import { chromium } from "playwright";
import { launchGL } from "../tools/gl-launch.mjs";
import { sleep } from "./h.mjs";

const BASE = process.argv[2] ?? "http://localhost:4184";
const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(BASE + "/?step=2", { waitUntil: "load" });
await page.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
await sleep(1500);

const info = await page.evaluate(() => {
  const spans = [];
  for (const el of document.querySelectorAll('.rstep[data-active="true"] .look[data-look]')) {
    const r = el.getBoundingClientRect();
    const c = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    spans.push({
      key: el.dataset.look,
      cx: Math.round(r.left + r.width / 2),
      cy: Math.round(r.top + r.height / 2),
      topHit: c ? `${c.tagName}.${(c.className ?? "").toString().slice(0, 20)}` : null,
      topHitLook: c?.closest?.("[data-look]")?.dataset.look ?? null,
      topHitSent: c?.closest?.(".sent")?.dataset?.slook ?? null,
      inSent: !!el.closest(".sent[data-slook]"),
      displayed: r.width > 0 && r.height > 0,
    });
  }
  const sents = [...document.querySelectorAll('.rstep[data-active="true"] .sent[data-slook]')].map((el) => {
    const r = el.getBoundingClientRect();
    return { slook: el.dataset.slook, top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) };
  });
  const activePage = document.querySelector('.rstep[data-active="true"]');
  const cs = getComputedStyle(activePage);
  return { spans, sents, activeTop: Math.round(activePage.getBoundingClientRect().top), display: cs.display, transform: cs.transform };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
