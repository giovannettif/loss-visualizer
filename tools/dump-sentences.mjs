/**
 * dump-sentences.mjs — authoring aid for the tour v2 sentence tables.
 *
 * Loads the built page, waits for the runtime sentence segmentation
 * (src/view/sentences.ts), and dumps every reader page's paragraphs and
 * their sentence spans as [page][para][sent] → text. Run against a preview
 * server:  node tools/dump-sentences.mjs [baseUrl]
 */

import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:4173";

const browser = await chromium.launch({ args: ["--use-angle=d3d11"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(`${base}/?step=0`, { waitUntil: "load" });
await page.waitForTimeout(2200);

const scenes = await page.evaluate(() =>
  [...document.querySelectorAll("#reader-body .rstep")].map((el) => el.dataset.scene),
);
const sents = await page.evaluate(() =>
  [...document.querySelectorAll("#reader-body .rstep")].map((step) =>
    [...step.querySelectorAll(".step__body > p")].map((p) =>
      [...p.querySelectorAll("span.sent")].map((s) => (s.textContent ?? "").trim()),
    ),
  ),
);
const counts = await page.evaluate(() =>
  [...document.querySelectorAll("#reader-body .rstep")].map((step) =>
    [...step.querySelectorAll(".step__body > p")].map((p) => p.dataset.sentCount ?? "?"),
  ),
);

for (let pg = 0; pg < sents.length; pg++) {
  console.log(`\n=== page ${pg} (${scenes[pg]}) ===`);
  sents[pg].forEach((para, pi) => {
    console.log(`  para ${pi}: (${counts[pg][pi]} sentences)`);
    para.forEach((s, si) => {
      const t = s.length > 110 ? `${s.slice(0, 107)}…` : s;
      console.log(`    [${pi},${si}] ${t}`);
    });
  });
}
await browser.close();
