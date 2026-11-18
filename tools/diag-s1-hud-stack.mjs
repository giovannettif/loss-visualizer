// diag S1-HUD-STACK-1280x720 — §1 compass vs loss-panel overlap at short viewports.
// Verifies the working-tree fix (page.css @media max-height:800px dock rule):
//   1. with-fix  — measure rects + hit-tests exactly like qa/sweep2-s1-task/probe7.mjs
//   2. pre-fix   — inject an override stylesheet that restores the bottom-left dock
//                  under the same media condition (emulates the rule not existing)
//                  and re-measure; the finding's overlap must reproduce.
//   3. threshold — 1280x801 (media does not match) must have no overlap, proving
//                  the 800px breakpoint sits above the true ~765px overlap threshold.
// Screenshots land in qa/S1-HUD-STACK-1280x720-diag/.
import { chromium } from "../node_modules/playwright/index.mjs";
import { launchGL } from "./gl-launch.mjs";
import { mkdirSync } from "node:fs";

const BASE = "http://localhost:4285/";
const OUT = new URL("../qa/S1-HUD-STACK-1280x720-diag/", import.meta.url).pathname.replace(
  /^\/(\w:)/,
  "$1",
);
mkdirSync(OUT, { recursive: true });

const SIZES = (process.env.SIZES ?? "1280x720,1280x800,1280x801").split(",");
const STEPS = (process.env.STEPS ?? "1,3").split(",").map(Number);

// Same specificity, later in source order → emulates "the S1 rule does not exist".
const PRE_FIX_OVERRIDE = `
@media (max-height: 800px) {
  #stage-wrap:has(#loss-panel[data-visible="true"]) #minimap-panel {
    top: auto; bottom: 14px; left: 14px; right: auto;
  }
}
`;

const browser = await launchGL(chromium);

async function measure(page) {
  return page.evaluate(() => {
    const name = (el) =>
      el && (el.id || (typeof el.className === "string" ? el.className : el.className.baseVal) || el.tagName);
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) };
    };
    const loss = box("#loss-panel");
    const map = box("#minimap-panel");
    const fit = box("#fit-panel");
    const lvEl = document.getElementById("loss-value");
    const lr = lvEl.getBoundingClientRect();
    const topAtLossValue = document.elementFromPoint(lr.left + lr.width / 2, lr.top + lr.height / 2);
    const b = window.__wp1.ballScreen();
    const topAtBall = b ? document.elementFromPoint(b.x, b.y) : null;
    const ms = getComputedStyle(document.getElementById("minimap-panel"));
    return {
      loss,
      fit,
      map,
      overlap: !!(loss && map && map.t < loss.b && map.b > loss.t && map.l < loss.r && map.r > loss.l),
      lossValueHit: name(topAtLossValue),
      ball: b ? { x: Math.round(b.x), y: Math.round(b.y) } : null,
      ballHit: name(topAtBall),
      mapPos: { top: ms.top, bottom: ms.bottom, left: ms.left, right: ms.right },
    };
  });
}

const report = [];
for (const sz of SIZES) {
  const [vw, vh] = sz.split("x").map(Number);
  for (const step of STEPS) {
    const page = await browser.newPage({ viewport: { width: vw, height: vh } });
    const errs = [];
    page.on("pageerror", (e) => errs.push(String(e)));
    await page.goto(BASE + "?step=" + step);
    await page.waitForFunction(
      () => window.__wp1 && window.__wp1.scene().startsWith("task"),
      null,
      { timeout: 30000 },
    );
    await page.waitForTimeout(3000);

    const withFix = await measure(page);
    await page.screenshot({ path: OUT + `diag-${vw}x${vh}-step${step}-withfix.png` });

    await page.addStyleTag({ content: PRE_FIX_OVERRIDE });
    await page.waitForTimeout(200);
    const preFix = await measure(page);
    await page.screenshot({ path: OUT + `diag-${vw}x${vh}-step${step}-prefix.png` });

    const row = { size: `${vw}x${vh}`, step, withFix, preFix, errs };
    report.push(row);
    console.log(
      [
        `${vw}x${vh} step ${step}`,
        `FIXED  overlap=${withFix.overlap} lossValueHit=${withFix.lossValueHit} ballHit=${withFix.ballHit} mapPos=${JSON.stringify(withFix.mapPos)}`,
        `PREFIX overlap=${preFix.overlap} lossValueHit=${preFix.lossValueHit} ballHit=${preFix.ballHit}`,
        `loss=${JSON.stringify(withFix.loss)} map=${JSON.stringify(withFix.map)} fit=${JSON.stringify(withFix.fit)}`,
      ].join("\n  "),
    );
    await page.close();
  }
}
await browser.close();
