/**
 * diag-u3-fogfinish-deadend.mjs — U3-FOGFINISH-STUCK deadend variants.
 *
 * E) The LEVEL-1 mirror of TOURUX-S6 round 1: at the level-1 fogStride gate
 *    (idx 1), click "Finish run · reveal" with ZERO strides. The run ends
 *    (done=true, compass read-only) — can the fogStride gate still release?
 * F) Strides + Finish on level 1 while the tour sits on a PRE-GATE sentence
 *    (idx 0), THEN Space into the stride gate (gate snap has used frozen).
 *
 * Usage: node tools/diag-u3-fogfinish-deadend.mjs <baseUrl> <E|F>
 */

import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const base = process.argv[2] ?? "http://localhost:4199";
const variant = process.argv[3] ?? "E";
const outDir = resolve("shots-diag-u3");
mkdirSync(outDir, { recursive: true });

const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function snap(label) {
  const s = await page.evaluate(() => {
    const w = window.__wp1;
    const t = w?.tour?.();
    const f = w?.fog?.();
    return {
      step: w?.step?.(),
      locked: w?.locked?.(),
      animating: w?.animating?.(),
      tour: t ? { phase: t.phase, idx: t.stepIndex, gate: t.gate, gateKind: t.gateKind, look: t.lookKey, overlay: t.overlayOn, page: t.page, chip: t.gateLabel } : null,
      fog: f ? { level: f.level, used: f.used, done: f.done, reveal: Math.round((f.reveal ?? 0) * 100) / 100 } : null,
      overlayAttr: document.querySelector("#tour-overlay")?.dataset.on,
      gateChip: document.querySelector("#tour-gate-chip")?.dataset.on,
      caption: document.querySelector("#fog-caption")?.textContent ?? null,
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
      console.log(`  (timeout ${label})`);
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

async function watch(tag, ms = 12000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < ms) {
    last = await snap(`${tag} t+${Math.round((Date.now() - t0) / 1000)}s`);
    await sleep(1500);
  }
  await page.screenshot({ path: resolve(outDir, `u3-${tag}.png`) });
  const t = last?.tour ?? {};
  console.log(`>>> ${tag}: idx=${t.idx} gate=${t.gate} kind=${t.gateKind} phase=${t.phase}`);
}

await page.goto(`${base}/?step=15`, { waitUntil: "load" });
await sleep(1500);
await waitIdle();
await page.locator('.rstep[data-active="true"] .tour-launch').click();
await waitTour((s) => s.running && s.phase === "active", 12000, "tour start");

if (variant === "E") {
  // Space → idx 1 gate (fogStride) arms → click Finish with ZERO strides.
  await page.keyboard.press("Space");
  await waitTour((s) => s.phase === "active" && s.gateKind === "fogStride", 12000, "stride gate");
  await page.click("#fog-finish"); // premature finish, level 1, used=0
  await watch("E-level1-premature-finish");
  // Prove the gate can NEVER release: press Space (should be swallowed) and
  // try a stride drag on the dead compass; then wait.
  await page.keyboard.press("Space");
  await dragMinimap(10, 40, 62, 80);
  await sleep(2000);
  await watch("E-after-space-and-stride-attempt", 8000);
} else if (variant === "F") {
  // Strides + Finish at idx 0 (pre-gate), then Space into the stride gate.
  await dragMinimap(10, 40, 62, 80);
  await sleep(1500);
  await page.click("#fog-finish");
  await sleep(2200); // reveal lifts
  await snap("F-finished-at-idx0");
  await page.keyboard.press("Space"); // → idx 1, fogStride gate arms
  const g = await waitTour((s) => s.phase === "active" && s.gateKind === "fogStride", 12000, "stride gate");
  console.log("gate armed with frozen used:", JSON.stringify(g && { idx: g.stepIndex, gate: g.gate }));
  await watch("F-gate-after-finished-run");
  await page.keyboard.press("Space"); // swallowed?
  await dragMinimap(10, 40, 62, 80); // dead compass?
  await sleep(2000);
  await watch("F-after-escape-attempts", 8000);
}

await browser.close();
console.log("done", variant);
