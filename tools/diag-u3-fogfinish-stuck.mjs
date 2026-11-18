/**
 * diag-u3-fogfinish-stuck.mjs — repro driver for U3-FOGFINISH-STUCK.
 *
 * Finding: clicking "Finish run · reveal" during the §6 tour leaves the
 * reveal covering the screen with the tour's pointing arrow still drawn —
 * the tour neither advances cleanly nor cleans up on the reveal transition.
 *
 * Repro per the finding: start the §6 tour, take strides, click Finish run.
 * Samples tour/lock/animating/fog/look state + overlay + screenshots.
 *
 * Usage: node tools/diag-u3-fogfinish-stuck.mjs [baseUrl]
 */

import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const base = process.argv[2] ?? "http://localhost:4173";
const outDir = resolve("shots-diag-u3");
mkdirSync(outDir, { recursive: true });

const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
page.on("console", (m) => {
  if (m.type() === "error") console.log("CONSOLE-ERROR:", m.text());
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function snap(label) {
  const s = await page.evaluate(() => {
    const w = window.__wp1;
    const t = w?.tour?.() ?? null;
    return {
      step: w?.step?.(),
      locked: w?.locked?.(),
      animating: w?.animating?.(),
      tour: t
        ? {
            phase: t.phase,
            idx: t.stepIndex,
            count: t.count,
            gate: t.gate,
            gateKind: t.gateKind,
            look: t.lookKey,
            overlayOn: t.overlayOn,
            page: t.page,
            sentence: (t.sentenceText ?? "").slice(0, 60),
          }
        : null,
      look: w?.look?.(),
      fog: w?.fog?.()
        ? {
            level: w.fog().level,
            used: w.fog().used,
            done: w.fog().done,
            reveal: Math.round((w.fog().reveal ?? 0) * 100) / 100,
            ghosts: w.fog().ghosts,
            ghostsPlaying: w.fog().ghostsPlaying,
            ghostsPaused: w.fog().ghostsPaused,
          }
        : null,
      overlayAttr: document.querySelector("#tour-overlay")?.dataset.on,
      gateChip: document.querySelector("#tour-gate-chip")?.dataset.on,
      dimBodies: document.querySelectorAll('.step__body[data-tour-dim="true"]').length,
      finishHidden: document.querySelector("#fog-finish")?.hidden ?? null,
    };
  });
  console.log(`[${label}]`, JSON.stringify(s));
  return s;
}

async function waitTour(pred, maxMs, label) {
  const t0 = Date.now();
  let s = null;
  for (;;) {
    s = await page.evaluate(() => window.__wp1?.tour?.() ?? null);
    if (s && pred(s)) return s;
    if (Date.now() - t0 > maxMs) {
      console.log(`  (timeout waiting for ${label}: ${JSON.stringify(s && { phase: s.phase, idx: s.stepIndex, gate: s.gate, kind: s.gateKind })})`);
      return s;
    }
    await sleep(120);
  }
}

async function waitIdle(maxMs = 25000) {
  const t0 = Date.now();
  for (;;) {
    const a = await page.evaluate(() => ({
      locked: window.__wp1?.locked?.(),
      animating: window.__wp1?.animating?.(),
    }));
    if (!a.locked && !a.animating) return true;
    if (Date.now() - t0 > maxMs) return false;
    await sleep(200);
  }
}

async function dragMinimap(dx0, dy0, dx1, dy1) {
  const box = await page.locator("#minimap-canvas").boundingBox();
  if (!box) throw new Error("minimap canvas missing");
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx + dx0, cy + dy0);
  await page.mouse.down();
  await page.mouse.move(cx + dx1, cy + dy1, { steps: 8 });
  await page.mouse.up();
}

// ---- the repro ----
await page.goto(`${base}/?step=15`, { waitUntil: "load" });
await sleep(1500);
console.log("entry idle:", await waitIdle());
await page.locator('.rstep[data-active="true"] .tour-launch').click();
await waitTour((s) => s.running && s.phase === "active", 12000, "§6 start");
await snap("tour-start");

await page.keyboard.press("Space"); // → the level-1 stride gate
const f1 = await waitTour((s) => s.phase === "active" && s.gateKind === "fogStride", 12000, "stride gate");
console.log("stride gate:", f1?.stepIndex, f1?.gate);

await dragMinimap(10, 40, 62, 80); // a level-1 stride
const f2 = await waitTour((s) => s.phase === "active" && s.stepIndex === 2, 10000, "stride release");
console.log("stride released →", f2?.stepIndex);

await page.keyboard.press("Space"); // → page 16, fogRun gate
const f3 = await waitTour((s) => s.phase === "active" && s.gateKind === "fogRun", 15000, "fogRun gate");
console.log("fogRun gate:", f3?.stepIndex, f3?.gate);
await snap("at-fogRun-gate");

// The finding says "take strides" (plural) then Finish.
await dragMinimap(10, 40, 62, 80);
await sleep(1400); // let the walk land
await dragMinimap(0, 40, -50, 76);
await sleep(1400);
await snap("after-strides");

// Click Finish run · reveal
await page.click("#fog-finish");
console.log("Finish clicked");

// Watch what happens for 25 s.
const t0 = Date.now();
let shotAt = new Set([500, 2000, 5000, 10000, 20000, 25000]);
while (Date.now() - t0 < 25500) {
  const el = Date.now() - t0;
  await snap(`t+${el}ms`);
  for (const at of [...shotAt]) {
    if (el >= at) {
      await page.screenshot({ path: resolve(outDir, `u3-t${at}.png`) });
      shotAt.delete(at);
    }
  }
  await sleep(1000);
}

// Final screenshot + a close look at the overlay geometry.
await page.screenshot({ path: resolve(outDir, "u3-final.png") });
const geo = await page.evaluate(() => {
  const svg = document.querySelector("#tour-overlay");
  const lead = document.querySelector("#tour-lead");
  const dot = document.querySelector("#tour-dot");
  return {
    svgOn: svg?.dataset.on,
    leadD: lead?.getAttribute("d"),
    dot: dot ? { cx: dot.getAttribute("cx"), cy: dot.getAttribute("cy") } : null,
    gateChipText: document.querySelector("#tour-gate-chip")?.textContent,
    barOn: document.querySelector("#tour-bar")?.dataset.on,
    count: document.querySelector("#tour-count")?.textContent,
  };
});
console.log("overlay geometry:", JSON.stringify(geo));

await browser.close();
console.log("done");
