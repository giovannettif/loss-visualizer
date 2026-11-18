/**
 * diag-u3-fogfinish-variants.mjs — U3-FOGFINISH-STUCK timing variants.
 *
 * A) stride on level 1 releases the gate (idx 2) → Finish immediately
 *    (level-1 reveal, tour at the ball sentence).
 * B) guided flow: stride → Space → fogRun gate → stride → Finish IMMEDIATELY
 *    (Finish pressed while the stride walk is mid-flight).
 * C) budget drained on level 1 BEFORE the tour reaches the fogStride gate
 *    (run finished with the compass read-only — can the gate ever release?).
 * D) guided flow with the SECOND stride queued mid-walk, then Finish.
 *
 * Usage: node tools/diag-u3-fogfinish-variants.mjs <baseUrl> <A|B|C|D>
 */

import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const base = process.argv[2] ?? "http://localhost:4199";
const variant = process.argv[3] ?? "B";
const outDir = resolve("shots-diag-u3");
mkdirSync(outDir, { recursive: true });

const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function snap(label) {
  const s = await page.evaluate(() => {
    const w = window.__wp1;
    const t = w?.tour?.() ?? null;
    const f = w?.fog?.();
    return {
      step: w?.step?.(),
      locked: w?.locked?.(),
      animating: w?.animating?.(),
      tour: t
        ? { phase: t.phase, idx: t.stepIndex, gate: t.gate, gateKind: t.gateKind, look: t.lookKey, overlay: t.overlayOn, page: t.page }
        : null,
      fog: f ? { level: f.level, used: f.used, done: f.done, reveal: Math.round((f.reveal ?? 0) * 100) / 100, ghosts: f.ghosts, playing: f.ghostsPlaying } : null,
      overlayAttr: document.querySelector("#tour-overlay")?.dataset.on,
      gateChip: document.querySelector("#tour-gate-chip")?.dataset.on,
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
      console.log(`  (timeout ${label}: ${JSON.stringify(s && { phase: s.phase, idx: s.stepIndex, gate: s.gate, kind: s.gateKind })})`);
      return s;
    }
    await sleep(100);
  }
}

async function waitIdle(maxMs = 25000) {
  const t0 = Date.now();
  for (;;) {
    const a = await page.evaluate(() => ({ l: window.__wp1?.locked?.(), a: window.__wp1?.animating?.() }));
    if (!a.l && !a.a) return true;
    if (Date.now() - t0 > maxMs) return false;
    await sleep(200);
  }
}

async function dragMinimap(dx0, dy0, dx1, dy1) {
  const box = await page.locator("#minimap-canvas").boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx + dx0, cy + dy0);
  await page.mouse.down();
  await page.mouse.move(cx + dx1, cy + dy1, { steps: 8 });
  await page.mouse.up();
}

/** Watches the post-Finish window; classifies the end state. */
async function watch(tag, ms = 26000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < ms) {
    last = await snap(`${tag} t+${Date.now() - t0}ms`);
    await sleep(900);
  }
  await page.screenshot({ path: resolve(outDir, `u3-${tag}-end.png`) });
  const t = last?.tour ?? {};
  let verdict;
  if (t.phase === "active" && t.idx === 4 && t.look === "gold-marker") verdict = "HEALED (step 4 active, gold-marker)";
  else if (t.gate === true) verdict = `STUCK-GATE (${t.gateKind} never released)`;
  else if (t.phase === "travel") verdict = "STUCK-TRAVEL (never activated)";
  else verdict = `OTHER (phase=${t.phase} idx=${t.idx} gate=${t.gate})`;
  console.log(`>>> ${tag}: ${verdict}`);
}

// ---- variant flows ----
await page.goto(`${base}/?step=15`, { waitUntil: "load" });
await sleep(1500);
await waitIdle();
await page.locator('.rstep[data-active="true"] .tour-launch').click();
await waitTour((s) => s.running && s.phase === "active", 12000, "tour start");

if (variant === "A") {
  // Step 0 → Space → stride gate → stride (releases to idx 2) → Finish NOW.
  await page.keyboard.press("Space");
  await waitTour((s) => s.gateKind === "fogStride", 12000, "stride gate");
  await dragMinimap(10, 40, 62, 80);
  await waitTour((s) => s.stepIndex === 2, 10000, "stride release");
  await page.click("#fog-finish");
  await watch("A-level1-finish-at-idx2");
} else if (variant === "B") {
  // Guided: level-1 stride, Space → fogRun gate, stride → Finish MID-WALK.
  await page.keyboard.press("Space");
  await waitTour((s) => s.gateKind === "fogStride", 12000, "stride gate");
  await dragMinimap(10, 40, 62, 80);
  await waitTour((s) => s.stepIndex === 2, 10000, "stride release");
  await page.keyboard.press("Space");
  await waitTour((s) => s.gateKind === "fogRun", 15000, "fogRun gate");
  await dragMinimap(10, 40, 62, 80);
  await page.click("#fog-finish"); // no wait — the walk is mid-flight
  await watch("B-finish-midwalk");
} else if (variant === "C") {
  // Drain the level-1 budget at step 0 (before the stride gate exists),
  // Finish auto-fires on drain; then Space into the fogStride gate.
  for (let i = 0; i < 10; i++) {
    await dragMinimap(10, 40, 62, 80);
    await sleep(1250);
  }
  const f = await page.evaluate(() => window.__wp1?.fog?.());
  console.log("after 10 strides:", JSON.stringify(f && { used: f.used, done: f.done, reveal: f.reveal }));
  await page.keyboard.press("Space");
  const g = await waitTour((s) => s.phase === "active" && s.stepIndex === 1, 12000, "step 1");
  console.log("step 1 state:", JSON.stringify(g));
  await snap("C-at-step1-gate");
  // Try Space (should be swallowed by the gate) and wait — can it ever release?
  await page.keyboard.press("Space");
  await watch("C-budget-drained-gate", 15000);
} else if (variant === "D") {
  // Guided: fogRun gate, stride 1, stride 2 QUEUED mid-walk, then Finish.
  await page.keyboard.press("Space");
  await waitTour((s) => s.gateKind === "fogStride", 12000, "stride gate");
  await dragMinimap(10, 40, 62, 80);
  await waitTour((s) => s.stepIndex === 2, 10000, "stride release");
  await page.keyboard.press("Space");
  await waitTour((s) => s.gateKind === "fogRun", 15000, "fogRun gate");
  await dragMinimap(10, 40, 62, 80);
  await sleep(300); // walk in flight
  await dragMinimap(0, 40, -50, 76); // queued mid-walk
  await page.click("#fog-finish");
  await watch("D-finish-queued");
}

await browser.close();
console.log("done", variant);
