/**
 * diag-l900-stale-tops-repro.mjs — L900-LABRULE-STALE-TOPS-PARK verification.
 *
 * Replays the finding's repro at its stated scale (dist on :4182, 900x900):
 * the preceding labrule step (index 22) grows ~1-2s after load when its
 * benchmark scorecard/verdicts populate; if `tops` is never re-measured,
 * step 23 parks 112px too low and its last verdict row (#rule-verdict-b)
 * ends up under the transport footer.
 *
 * Runs:
 *   1. deep-900x900   — goto ?step=23, wait 3s (finding's timing), measure.
 *   2. deep-900x700   — control (finding: parks exactly).
 *   3. deep-1600x900  — control (finding: parks exactly).
 *   4. wheelnav-900x900 — ?step=22, wait for the scorecard, ArrowDown → 23.
 *   5. resize-heal probe on run 1's page — setViewportSize(901,900) (the
 *      finding's documented manual cure) → reanchor → re-measure.
 *
 * PASS criteria per run: stored tops[23] === live offsetTop (Δ ≤ 1),
 * step-23 rect.top ≈ 0 (≤ 1.5), and #rule-verdict-b fully above the
 * footer top (no vertical overlap).
 *
 * Read-only against src/ — serves the freshly built dist/.
 */

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, extname } from "node:path";
import { launchGL } from "./gl-launch.mjs";

const DIST = join(process.cwd(), "dist");
const PORT = 4182;
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff",
};
const srv = createServer((req, res) => {
  let p = req.url.split("?")[0];
  if (p === "/" || p === "") p = "/index.html";
  const file = join(DIST, p);
  if (!existsSync(file)) { res.writeHead(404).end("no"); return; }
  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => srv.listen(PORT, () => r(srv)));
console.log(`serving dist on :${PORT}`);

const OUT = join(process.cwd(), "shots", "_diag_l900_stale_tops");
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fails = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) fails++;
}

const browser = await launchGL(chromium);

async function idle(page, ms = 12000) {
  const t0 = Date.now();
  for (;;) {
    const s = await page.evaluate(() => ({
      locked: window.__wp1.locked(),
      anim: window.__wp1.animating(),
    }));
    if (!s.locked && !s.anim) break;
    if (Date.now() - t0 > ms) break;
    await sleep(200);
  }
  await sleep(400);
}

async function measure(page) {
  return page.evaluate(() => {
    const steps = document.querySelectorAll("#reader-body .rstep");
    const step23 = steps[23];
    const step22 = steps[22];
    const sc = window.__wp1.scroll();
    const r23 = step23.getBoundingClientRect();
    const vb = document.querySelector("#rule-verdict-b");
    const foot = document.querySelector("#reader-foot");
    const vr = vb ? vb.getBoundingClientRect() : null;
    const fr = foot ? foot.getBoundingClientRect() : null;
    return {
      step: window.__wp1.step(),
      y: sc.y, target: sc.target, parked: sc.parked,
      storedTop23: sc.tops[23] ?? null,
      storedTop22: sc.tops[22] ?? null,
      liveTop22: Math.round(step22.offsetTop),
      liveTop23: Math.round(step23.offsetTop),
      delta23: sc.tops[23] == null ? null : Math.round(step23.offsetTop) - sc.tops[23],
      step23RectTop: Math.round(r23.top * 10) / 10,
      step22H: Math.round(step22.offsetHeight),
      step23H: Math.round(step23.offsetHeight),
      verdictB: vr ? { top: Math.round(vr.top), bottom: Math.round(vr.bottom) } : null,
      footTop: fr ? Math.round(fr.top) : null,
      overlapPx: vr && fr ? Math.round((vr.bottom - fr.top) * 10) / 10 : null,
      fit22: step22.dataset.fit ?? null,
    };
  });
}

function verdict(run, m) {
  const parkOk = Math.abs(m.step23RectTop) <= 1.5;
  const freshOk = m.delta23 !== null && Math.abs(m.delta23) <= 1;
  const clearOk = m.overlapPx !== null && m.overlapPx <= 0;
  check(
    `${run}: tops fresh (Δ=${m.delta23})`,
    freshOk,
    `stored=${m.storedTop23} live=${m.liveTop23}`,
  );
  check(`${run}: parked at rect.top=0`, parkOk, `rect.top=${m.step23RectTop}`);
  check(
    `${run}: #rule-verdict-b clear of footer`,
    clearOk,
    `row y${m.verdictB?.top}-${m.verdictB?.bottom} vs footTop=${m.footTop} overlap=${m.overlapPx}px`,
  );
}

/* ---------------- 1-3: deep links ---------------- */

const DEEPS = [
  { tag: "deep-900x900", w: 900, h: 900 },
  { tag: "deep-900x700", w: 900, h: 700 },
  { tag: "deep-1600x900", w: 1600, h: 900 },
];
let firstPage = null;
for (const run of DEEPS) {
  const page = await browser.newPage({ viewport: { width: run.w, height: run.h } });
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await page.goto(`http://localhost:${PORT}/?step=23`, { waitUntil: "load" });
  await idle(page);
  const t3 = await measure(page); // finding's timing: ~3s after load by now
  console.log(`\n=== ${run.tag} (?step=23, waited idle + 3s) ===`);
  console.log(JSON.stringify(t3));
  verdict(run.tag, t3);
  await page.screenshot({ path: join(OUT, `${run.tag}.png`) });
  if (run.tag === "deep-900x900") firstPage = page;
  else await page.close();
}

/* ---------------- 4: sequential wheel-nav 22 → 23 ---------------- */

{
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await page.goto(`http://localhost:${PORT}/?step=22`, { waitUntil: "load" });
  await idle(page);
  await sleep(2500); // let step 22's scorecard/verdicts populate fully
  const before = await measure(page);
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press("ArrowDown");
  await idle(page);
  await sleep(1000);
  const after = await measure(page);
  console.log(`\n=== wheelnav-900x900 (?step=22 → ArrowDown → 23) ===`);
  console.log(`at 22: ${JSON.stringify(before)}`);
  console.log(`at 23: ${JSON.stringify(after)}`);
  check("wheelnav: landed on step 23", after.step === 23, `step=${after.step}`);
  verdict("wheelnav-900x900", after);
  await page.screenshot({ path: join(OUT, "wheelnav-900x900.png") });
  await page.close();
}

/* ---------------- 4b: growth timeline (does step 22 grow, and does tops track it?) ---------------- */

{
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await page.goto(`http://localhost:${PORT}/?step=23`, { waitUntil: "load" });
  await page.evaluate(() => {
    const samples = [];
    const s23 = document.querySelectorAll("#reader-body .rstep")[23];
    const s22 = document.querySelectorAll("#reader-body .rstep")[22];
    window.__growthSamples = samples;
    const t0 = performance.now();
    const timer = setInterval(() => {
      const sc = window.__wp1.scroll();
      samples.push({
        t: Math.round(performance.now() - t0),
        h22: s22.offsetHeight,
        live23: s23.offsetTop,
        stored23: sc.tops[23] ?? null,
        fit22: s22.dataset.fit ?? null,
      });
      if (performance.now() - t0 > 5200) clearInterval(timer);
    }, 150);
  });
  await sleep(5600);
  const samples = await page.evaluate(() => window.__growthSamples);
  // Keep only samples where something changed
  const changes = samples.filter((s, i) => {
    if (i === 0) return true;
    const p = samples[i - 1];
    return s.h22 !== p.h22 || s.live23 !== p.live23 || s.stored23 !== p.stored23 || s.fit22 !== p.fit22;
  });
  const stale = samples.filter((s) => s.stored23 !== null && s.stored23 !== s.live23);
  console.log(`\n=== growth timeline 900x900 (?step=23, sampled every 150ms for 5.2s) ===`);
  console.log(changes.map((s) => `  t=${String(s.t).padStart(5)} h22=${s.h22} fit22=${s.fit22} live23=${s.live23} stored23=${s.stored23}`).join("\n"));
  check(
    "growth timeline: stored tops[23] never diverged from live offset",
    stale.length === 0,
    stale.length === 0 ? `${samples.length} samples, all fresh` : `stale at t=${stale.map((s) => s.t).join(",")} (Δ=${stale.map((s) => s.live23 - s.stored23).join(",")})`,
  );
  await page.close();
}

/* ---------------- 5: resize-heal probe (finding's manual cure) ---------------- */

if (firstPage) {
  await firstPage.setViewportSize({ width: 901, height: 900 });
  await sleep(1200);
  const healed = await measure(firstPage);
  console.log(`\n=== resize-heal (900x900 → 901x900) ===`);
  console.log(JSON.stringify(healed));
  check("resize-heal: still parked + tops fresh", Math.abs(healed.step23RectTop) <= 1.5 && Math.abs(healed.delta23) <= 1,
    `rect.top=${healed.step23RectTop} Δ=${healed.delta23}`);
  await firstPage.screenshot({ path: join(OUT, "resized-901x900.png") });
  await firstPage.close();
}

await browser.close();
srv.close();
console.log(`\n${fails === 0 ? "ALL CHECKS PASS" : `${fails} CHECK(S) FAILED`}`);
process.exit(fails === 0 ? 0 : 1);
