// Root-cause confirmation for S2-FOOTER-REFLOW-WRAP: inject the PRE-FIX
// rules (HEAD state: nowrap base footer with wrap only <=1100px, auto-sized
// Skip/continue) as an override stylesheet on the current build, then
// re-measure the finding's claims. If the finding's numbers reappear
// (1600: foot 61 locked vs 48 idle, Skip two lines; 1280: hint ~70x34;
// 1024: 83/69 second-row jump), the reserved-slot + nowrap fix is proven
// to be the resolving change. No project files are modified.
import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const base = "http://localhost:4183";
const outDir = resolve("shots", "qa-s2-footer-wrap");
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PREFIX_CSS = `
  /* restore HEAD state of #reader-foot + slots */
  #reader-foot { flex-wrap: nowrap; row-gap: 0px; min-height: 46px; }
  @media (max-width: 1100px) { #reader-foot { flex-wrap: wrap; row-gap: 4px; } }
  #skip-btn, #continue-hint {
    flex: 0 1 auto; width: auto; height: auto;
    white-space: normal; margin-left: 0;
  }
  #transport { flex: 0 1 auto; min-width: auto; }
  #continue-hint { text-align: left; }
`;

const measure = (page) =>
  page.evaluate(() => {
    const $ = (s) => document.querySelector(s);
    const wp = window.__wp1;
    const slot = (s) => {
      const el = $(s);
      if (!el || el.hidden) return null;
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    };
    const lines = (s) => {
      const el = $(s);
      if (!el || el.hidden) return null;
      const range = document.createRange();
      range.selectNodeContents(el);
      const tops = [
        ...new Set(
          [...range.getClientRects()]
            .filter((r) => r.width > 0.5)
            .map((r) => Math.round(r.top)),
        ),
      ];
      return tops.length;
    };
    return {
      step: wp?.step?.(),
      scene: wp?.scene?.(),
      locked: wp?.locked?.(),
      footH: Math.round($("##reader-foot".replace("##", "#")).getBoundingClientRect().height),
      skip: slot("#skip-btn"),
      hint: slot("#continue-hint"),
      skipLines: lines("#skip-btn"),
      hintLines: lines("#continue-hint"),
    };
  });

const waitIdle = async (page, maxMs = 30000) => {
  const t0 = Date.now();
  for (;;) {
    const s = await page.evaluate(() => ({
      l: window.__wp1?.locked?.() ?? false,
      a: window.__wp1?.animating?.() ?? false,
    }));
    if (!s.l && !s.a) return true;
    if (Date.now() - t0 > maxMs) return false;
    await sleep(150);
  }
};

const browser = await launchGL(chromium);
for (const [tag, w, h] of [
  ["prefix-1600", 1600, 900],
  ["prefix-1280", 1280, 720],
  ["prefix-1024", 1024, 768],
]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(`${base}/?step=5`, { waitUntil: "load" });
  await page.addStyleTag({ content: PREFIX_CSS }); // after load: survives navigation
  await waitIdle(page);
  const idle = await measure(page);
  await page.keyboard.press("ArrowDown");
  let lock = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 12000) {
    const s = await measure(page);
    if (s.locked) { lock = s; break; }
    await sleep(25);
  }
  await waitIdle(page);
  const after = await measure(page);
  await page.screenshot({ path: resolve(outDir, `${tag}-lock.png`) });
  console.log(
    `${tag}: idle foot=${idle.footH} skip=${JSON.stringify(idle.skip)}(${idle.skipLines}L) hint=${JSON.stringify(idle.hint)}(${idle.hintLines}L)`,
  );
  console.log(
    `   lock foot=${lock?.footH} skip=${JSON.stringify(lock?.skip)}(${lock?.skipLines}L) hint=${JSON.stringify(lock?.hint)} scene=${lock?.scene}`,
  );
  console.log(
    `   after foot=${after.footH} skip=${JSON.stringify(after.skip)} hint=${JSON.stringify(after.hint)}(${after.hintLines}L)`,
  );
  await page.close();
}
await browser.close();
