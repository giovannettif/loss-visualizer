/**
 * diag-s2b26-ring.mjs — repro harness for QA finding S2B26-GDA-RING-BURIED.
 *
 * Finding: in gd-a (?step=4) the hover-to-look spotlight ring around the
 * drifting 'current point' ball is mostly buried in the valley surface
 * (depth-tested flat ring, low 16° elevation camera), shrinking to a left
 * sliver as the ball drifts. Expected: a complete ring, as on task-c.
 *
 * Runs the finding's named repro against a served preview:
 *   ?step=4, 1500×900, wait idle, real-mouse hover on the
 *   span[data-look="ball"] ('current point') in the gd-a reader step,
 *   then samples ~2.4 s of ring crops + look diagnostics.
 * Also boots ?step=3 (task-c) for the expected-complete-ring comparison.
 *
 * Usage: node tools/diag-s2b26-ring.mjs [baseUrl] [outDir]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:4185";
const outDir = process.argv[3] ?? "qa/S2B26-GDA-RING-BURIED-r1";
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const report = {};

async function runStep(step, spanText, holdMs, sampleEveryMs) {
  const ctx = await browser.newContext({
    viewport: { width: 1500, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  await page.goto(`${base}/?step=${step}`, { waitUntil: "load" });
  await page.waitForFunction(() => (window.__wp1 ? true : false), null, { timeout: 20000 });
  await page.waitForFunction(
    () => !window.__wp1.locked() && !window.__wp1.animating() && window.__wp1.scroll().parked,
    null,
    { timeout: 20000 },
  );
  // The active reader step carries the span; hover its center with REAL mouse
  // events (mouse.move, no element.scrollIntoView side effects).
  const span = page.locator(`.rstep[data-scene] [data-look="ball"]`).filter({ hasText: spanText });
  const box = await span.boundingBox();
  if (!box) throw new Error(`span not found for step ${step}: ${spanText}`);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx - 60, cy - 40);
  await page.mouse.move(cx, cy, { steps: 8 });

  const look0 = await page.evaluate(() => window.__wp1.look());
  const scene = await page.evaluate(() => window.__wp1.scene());
  if (!look0.ring) throw new Error(`spotlight ring did not activate on step ${step}: ${JSON.stringify(look0)}`);

  const dir = join(outDir, `s${step}`);
  mkdirSync(dir, { recursive: true });
  const frames = [];
  const n = Math.ceil(holdMs / sampleEveryMs);
  for (let i = 0; i < n; i++) {
    const ball = await page.evaluate(() => window.__wp1.ballScreen());
    const look = await page.evaluate(() => window.__wp1.look());
    const name = `f${String(i).padStart(5, "0")}.png`;
    if (ball) {
      const x = Math.max(0, Math.round(ball.x - 150));
      const y = Math.max(0, Math.round(ball.y - 105));
      await page.screenshot({
        path: join(dir, name),
        clip: { x, y, width: 300, height: 210 },
      });
    }
    frames.push({ name, t: i * sampleEveryMs, ball, look });
    await page.waitForTimeout(sampleEveryMs);
  }
  // Two full frames for context (early vs late drift).
  await page.screenshot({ path: join(dir, "full-early.png") });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(dir, "full-late.png") });

  const lookEnd = await page.evaluate(() => window.__wp1.look());
  report[`step${step}`] = { scene, spanText, look0, lookEnd, frames };
  await ctx.close();
}

await runStep(4, "current point", 2400, 120); // gd-a — the finding
await runStep(3, "Drag the white point", 900, 120); // task-c — expected-good comparison

writeFileSync(join(outDir, "diag.json"), JSON.stringify(report, null, 1));
await browser.close();
console.log("OK — wrote", outDir);
