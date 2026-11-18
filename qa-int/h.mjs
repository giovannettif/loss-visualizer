/**
 * qa-int/h.mjs — shared harness for the interaction-regression QA run.
 * (Own-folder harness only; no project files are read/written by it at
 * runtime beyond driving the served build over Playwright.)
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

export const OUT_DIR = resolve("qa-int/shots");
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

export async function cam(page) {
  return page.evaluate(() => {
    const d = window.__wp1?.debug?.();
    return { attitude: d?.viewAttitude ?? null, pan: d?.viewPan ?? null };
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

/** Bounding box of the 3D canvas pane (left pane). */
export async function stageBox(page) {
  const b = await page.locator("#stage-wrap").boundingBox();
  if (!b) throw new Error("#stage-wrap missing");
  return b;
}

/** One real wheel event over the reader panel (55% across, mid-height). */
export async function wheelReader(page, dy) {
  const b = await readerBox(page);
  await page.mouse.move(b.x + b.width * 0.55, b.y + b.height * 0.5);
  await page.mouse.wheel(0, dy);
}

/** A wheel "gesture": n notches at gapMs — one gesture while gaps < 180ms. */
export async function wheelFling(page, { dy = 160, n = 8, gapMs = 20, over = "reader" } = {}) {
  const b = over === "reader" ? await readerBox(page) : await stageBox(page);
  const px = over === "reader" ? b.x + b.width * 0.55 : b.x + b.width * 0.5;
  const py = over === "reader" ? b.y + b.height * 0.5 : b.y + b.height * 0.5;
  await page.mouse.move(px, py);
  for (let i = 0; i < n; i++) {
    await page.mouse.wheel(0, dy);
    await sleep(gapMs);
  }
}

export async function railClick(page, k) {
  const btns = page.locator("#rail button");
  await btns.nth(k).click();
}
