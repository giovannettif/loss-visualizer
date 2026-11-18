// Diagnostic (QA S2-FOOTER-REFLOW-WRAP): measure #reader-foot and the
// Skip/continue slots in the idle, locked and post-unlock states, at the
// scales the finding names, on both a transport step (?step=5 → gd-c) and
// the lab step (?step=12 → lab). The finding claims the footer's height and
// row layout change between locked and idle (Skip wrapping to two lines,
// 'continue ↓' wrapping, Skip/hint dropping to a second row).
//
// Usage: node tools/diag-s2-footer-wrap.mjs [baseUrl]   (default :4183)
import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const base = process.argv[2] ?? "http://localhost:4183";
const outDir = resolve("shots", "qa-s2-footer-wrap");
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const RUNS = [
  { tag: "step6-1600", w: 1600, h: 900, from: 5 },
  { tag: "step6-1280", w: 1280, h: 720, from: 5 },
  { tag: "step6-1024", w: 1024, h: 768, from: 5 },
  { tag: "lab-1600", w: 1600, h: 900, from: 12 },
  { tag: "lab-1280", w: 1280, h: 720, from: 12 },
];

const browser = await launchGL(chromium);

async function measure(page) {
  return page.evaluate(() => {
    const $ = (s) => document.querySelector(s);
    const wp = window.__wp1;
    const slot = (s) => {
      const el = $(s);
      if (!el || el.hidden) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        w: Math.round(r.width * 10) / 10,
        h: Math.round(r.height * 10) / 10,
        top: Math.round(r.top * 10) / 10,
        left: Math.round(r.left * 10) / 10,
        ws: cs.whiteSpace,
        flexBasis: cs.flexBasis,
      };
    };
    const foot = $("#reader-foot");
    const fr = foot.getBoundingClientRect();
    const transport = slot("#transport");
    const skip = slot("#skip-btn");
    const hint = slot("#continue-hint");
    const tops = [transport?.top, skip?.top, hint?.top].filter((t) => t != null);
    return {
      scene: wp?.scene?.(),
      step: wp?.step?.(),
      locked: wp?.locked?.(),
      animating: wp?.animating?.(),
      footH: Math.round(fr.height * 10) / 10,
      footY: Math.round(fr.top * 10) / 10,
      rows: tops.length > 1 ? new Set(tops.map((t) => Math.round(t))).size : 1,
      transport,
      skip,
      hint,
      playBtnHidden: $("#play-btn")?.hidden ?? null,
      speedHidden: $("#speed-wrap")?.hidden ?? null,
    };
  });
}

async function waitIdle(page, maxMs = 30000) {
  const t0 = Date.now();
  for (;;) {
    const s = await page.evaluate(() => ({
      locked: window.__wp1?.locked?.() ?? false,
      animating: window.__wp1?.animating?.() ?? false,
    }));
    if (!s.locked && !s.animating) return true;
    if (Date.now() - t0 > maxMs) return false;
    await sleep(150);
  }
}

for (const run of RUNS) {
  const page = await browser.newPage({ viewport: { width: run.w, height: run.h } });
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await page.goto(`${base}/?step=${run.from}`, { waitUntil: "load" });
  const booted = await waitIdle(page);
  const idleBefore = await measure(page);
  await page.screenshot({ path: resolve(outDir, `idle-${run.tag}.png`) });

  // Advance one step (finding's repro: ArrowDown into the next reader page).
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press("ArrowDown");

  // Poll for the lock; sample as soon as it is seen (the lock outlives the
  // entry animation, well above the poll interval).
  let lockedS = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 12000) {
    const s = await measure(page);
    if (s.locked) { lockedS = s; break; }
    if (s.step !== run.from) { lockedS = s; break; } // arrived, maybe no lock
    await sleep(25);
  }
  if (lockedS) {
    await page.screenshot({ path: resolve(outDir, `lock-${run.tag}.png`) });
  }
  const drained = await waitIdle(page);
  const idleAfter = await measure(page);
  await page.screenshot({ path: resolve(outDir, `after-${run.tag}.png`) });

  const fmt = (s, name) => {
    if (!s) return `${name}: <never sampled>`;
    const slotStr = (t, n) =>
      t ? `${n} ${t.w}x${t.h} @row-top ${t.top} (ws:${t.ws}, basis:${t.flexBasis})` : `${n}: hidden`;
    return [
      `${name}: step=${s.step} scene=${s.scene} locked=${s.locked} anim=${s.animating}`,
      `  foot h=${s.footH} top=${s.footY} rows=${s.rows}`,
      `  ${slotStr(s.transport, "transport")} playHidden=${s.playBtnHidden} speedHidden=${s.speedHidden}`,
      `  ${slotStr(s.skip, "skip")}`,
      `  ${slotStr(s.hint, "hint")}`,
    ].join("\n");
  };
  console.log(`\n=== ${run.tag} (${run.w}x${run.h}, ?step=${run.from} → ArrowDown) bootIdle=${booted} drained=${drained} ===`);
  console.log(fmt(idleBefore, "idle-before"));
  console.log(fmt(lockedS, "locked"));
  console.log(fmt(idleAfter, "idle-after"));

  const stable =
    idleBefore && idleAfter &&
    Math.abs(idleBefore.footH - idleAfter.footH) < 0.5 &&
    idleBefore.footH === lockedS?.footH;
  const unwrapped =
    (!idleAfter.skip || idleAfter.skip.h <= 32) &&
    (!idleAfter.hint || idleAfter.hint.h <= 20) &&
    (!lockedS?.skip || lockedS.skip.h <= 32);
  const oneRow = (idleAfter.rows ?? 1) === 1 && (lockedS?.rows ?? 1) === 1;
  console.log(
    `VERDICT ${run.tag}: foot stable across lock/idle=${stable} (before=${idleBefore?.footH} lock=${lockedS?.footH} after=${idleAfter?.footH}) · labels unwrapped=${unwrapped} · single row=${oneRow}`,
  );
  await page.close();
}
await browser.close();
