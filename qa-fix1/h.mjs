/**
 * qa-fix1/h.mjs — shared harness for the QA round-1 fix verification run.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

export const OUT_DIR = resolve("qa-fix1/shots");
mkdirSync(OUT_DIR, { recursive: true });

let failures = 0;
const failed = [];
export function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) {
    failures += 1;
    failed.push(name);
  }
}
export function finish(label) {
  if (failures === 0) console.log(`${label}: ALL_PASS`);
  else console.log(`${label}: ${failures} FAIL -> ${failed.join(" | ")}`);
  process.exitCode = failures === 0 ? 0 : 1;
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function appState(page) {
  return page.evaluate(() => {
    const w = window.__wp1;
    if (!w) return null;
    const s = w.scroll();
    return {
      scene: w.scene(),
      step: w.step(),
      count: w.count(),
      locked: w.locked(),
      animating: w.animating(),
      scroll: s,
      intro: s.intro,
      parked: s.parked,
    };
  });
}

/** Waits until the reader is unlocked and the director idle. */
export async function waitIdle(page, maxMs = 25000) {
  const t0 = Date.now();
  let s = null;
  for (;;) {
    s = await appState(page);
    if (s && !s.locked && !s.animating) return s;
    if (Date.now() - t0 > maxMs) return s;
    await sleep(150);
  }
}

export async function waitFor(page, fn, { maxMs = 15000, label = "condition", pollMs = 120 } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > maxMs) {
      console.log(`  (timeout waiting for ${label})`);
      return null;
    }
    await sleep(pollMs);
  }
}

export async function shot(page, name) {
  await page.screenshot({ path: resolve(OUT_DIR, name) });
}

export async function readerBox(page) {
  const b = await page.locator("#reader").boundingBox();
  if (!b) throw new Error("#reader missing");
  return b;
}

export async function wheelReader(page, dy) {
  const b = await readerBox(page);
  await page.mouse.move(b.x + b.width * 0.55, b.y + b.height * 0.5);
  await page.mouse.wheel(0, dy);
}
