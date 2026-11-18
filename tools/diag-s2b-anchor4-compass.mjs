/**
 * diag-s2b-anchor4-compass.mjs — reproduction + fix-validation probe for
 * finding S2B-ANCHOR-4 (s7 tour, tilt pages: the whole-tour lifted tour bar
 * (bottom:166px, keyed body[data-tour-live="s7"]) collides with the compass
 * re-docked bottom-RIGHT (director.applyHud sets data-dock="right" on
 * tilt-a/tilt-b) at 1280x800 and 1440x900.
 *
 * Per viewport (1280x800, 1440x900, 1280x1024):
 *   1. ?step=18 → start the s7 tour → gate chip + rects at step 1/7.
 *   2. Steer (hold A) → Next → step 3/7 (page 19, tilt-levels): measure
 *      #tour-bar-full ∩ #minimap-panel, elementFromPoint over the overlap.
 *   3. INJECT the candidate fix (compass top-right while s7 live + docked
 *      right) as a <style>, re-measure: bar∩compass, compass∩tilt-panel,
 *      chip∩compass. Remove the style (read-only against src/).
 *   4. Next → ghost gate → ▶ ghost → swarm page (step 5/7): confirm the
 *      dock flips left there and the lifted bar still clears the swarm dock
 *      (BRK-3) — i.e. a dock="right"-scoped fix cannot regress it.
 *
 * Read-only against src/ — serves the existing dist/ build.
 */

import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, extname, resolve } from "node:path";

const DIST = join(process.cwd(), "dist");
const PORT = 4196;
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

const OUT = resolve("qa", "S2B-ANCHOR-4-r1");
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await launchGL(chromium);

const FIX_CSS =
  'body[data-tour-live="s7"] #minimap-panel[data-dock="right"]{bottom:auto !important;top:62px !important;}';

const rectOf = (el) => {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { l: +r.left.toFixed(1), t: +r.top.toFixed(1), r: +r.right.toFixed(1), b: +r.bottom.toFixed(1) };
};
const inter = (a, b) => {
  if (!a || !b) return null;
  const w = Math.min(a.r, b.r) - Math.max(a.l, b.l);
  const h = Math.min(a.b, b.b) - Math.max(a.t, b.t);
  return w > 0 && h > 0 ? { w: +w.toFixed(1), h: +h.toFixed(1) } : null;
};

async function chromeRects(page) {
  return page.evaluate(() => {
    const g = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return null;
      return { l: +r.left.toFixed(1), t: +r.top.toFixed(1), r: +r.right.toFixed(1), b: +r.bottom.toFixed(1) };
    };
    return {
      bar: g("#tour-bar-full"),
      chip: g("#tour-bar-chip"),
      gateChip: g("#tour-gate-chip"),
      compass: g("#minimap-panel"),
      tiltPanel: g("#tilt-panel"),
      swarmDock: g("#swarm-dock"),
      dock: document.querySelector("#minimap-panel")?.dataset.dock ?? null,
      mapVisible: document.querySelector("#minimap-panel")?.dataset.visible ?? null,
      vp: `${innerWidth}x${innerHeight}`,
    };
  });
}

function report(tag, c) {
  const x = inter(c.bar, c.compass);
  const xc = inter(c.gateChip, c.compass);
  const xp = inter(c.compass, c.tiltPanel);
  console.log(`[${tag}] vp=${c.vp} dock=${c.dock} mapVisible=${c.mapVisible}`);
  console.log(`  bar=${JSON.stringify(c.bar)}`);
  console.log(`  compass=${JSON.stringify(c.compass)}`);
  if (c.gateChip) console.log(`  gateChip=${JSON.stringify(c.gateChip)} gateChip∩compass=${JSON.stringify(xc)}`);
  if (c.tiltPanel) console.log(`  tiltPanel=${JSON.stringify(c.tiltPanel)} compass∩tiltPanel=${JSON.stringify(xp)}`);
  if (c.swarmDock) console.log(`  swarmDock=${JSON.stringify(c.swarmDock)} bar∩swarmDock=${JSON.stringify(inter(c.bar, c.swarmDock))}`);
  console.log(`  bar∩compass=${JSON.stringify(x)}`);
  return x;
}

async function settle(page, maxMs = 20000) {
  const t0 = Date.now();
  for (;;) {
    const st = await page.evaluate(() => ({
      locked: window.__wp1.locked(), animating: window.__wp1.animating(),
    }));
    if (!st.locked && !st.animating) return true;
    if (Date.now() - t0 > maxMs) return false;
    await sleep(100);
  }
}

async function clickSkipIfShown(page) {
  const shown = await page.evaluate(() => {
    const b = document.querySelector("#skip-btn");
    return b && !b.hidden && getComputedStyle(b).display !== "none" && b.getBoundingClientRect().width > 0;
  });
  if (shown) {
    await page.click("#skip-btn");
    console.log("  [skip] clicked Skip animation");
    await sleep(250);
    return true;
  }
  return false;
}

async function waitTour(page, pred, maxMs, tag) {
  const t0 = Date.now();
  for (;;) {
    const s = await page.evaluate(() => window.__wp1.tour());
    if (pred(s)) return s;
    if (Date.now() - t0 > maxMs) { console.log(`  [waitTour TIMEOUT] ${tag} last=${JSON.stringify(s)}`); return s; }
    await sleep(80);
  }
}

async function runViewport(width, height, tag) {
  console.log(`\n================= ${tag} (${width}x${height}) =================`);
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  await page.goto(`http://localhost:${PORT}/?step=18`, { waitUntil: "load" });
  await sleep(700);
  await clickSkipIfShown(page);
  await settle(page);
  await sleep(400);

  // 1. Start the s7 tour — the parked step's launch chip.
  await page.click('.tour-launch[data-tour="s7"]');
  const s0 = await waitTour(page, (s) => s.gate && s.gateKind === "tiltSteered", 12000, "steering gate");
  console.log(`  tour step1/7: idx=${s0.stepIndex} gate=${s0.gate} kind=${s0.gateKind}`);
  const c0 = await chromeRects(page);
  report(`${tag} step1/7 GATE`, c0);
  await page.screenshot({ path: join(OUT, `${tag}-s1-gate-pre.png`) });

  // 2. Hold A (the steering key) until the gate releases → step 2/7.
  await page.keyboard.down("a");
  await sleep(900);
  await page.keyboard.up("a");
  const s1 = await waitTour(page, (s) => s.phase === "active" && s.stepIndex === 1 && !s.gate, 12000, "step 2/7");
  console.log(`  tour step2/7: idx=${s1.stepIndex} gate=${s1.gate}`);
  await sleep(300);

  // Next → step 3/7 (page 19, tilt-levels) — the finding's measured step.
  await page.click("#tour-next");
  const s2 = await waitTour(page, (s) => s.phase === "active" && s.stepIndex === 2, 15000, "step 3/7");
  console.log(`  tour step3/7: idx=${s2.stepIndex} look=${s2.lookKey} page=${s2.page}`);
  await settle(page);
  await sleep(400);
  const c1 = await chromeRects(page);
  const hit = inter(c1.bar, c1.compass);
  report(`${tag} step3/7 PRE-FIX`, c1);
  if (hit) {
    const px = await page.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      return el ? `${el.tagName}#${el.id}` : "none";
    }, [Math.round((Math.max(c1.bar.l, c1.compass.l) + Math.min(c1.bar.r, c1.compass.r)) / 2),
        Math.round((Math.max(c1.bar.t, c1.compass.t) + Math.min(c1.bar.b, c1.compass.b)) / 2)]);
    console.log(`  elementFromPoint over the overlap center → ${px}`);
  }
  await page.screenshot({ path: join(OUT, `${tag}-s3-prefix.png`) });

  // 3. INJECT the candidate fix, re-measure, remove.
  await page.evaluate((css) => {
    const st = document.createElement("style");
    st.id = "s2b-fix-probe";
    st.textContent = css;
    document.head.appendChild(st);
  }, FIX_CSS);
  await sleep(400);
  const c2 = await chromeRects(page);
  report(`${tag} step3/7 FIX-INJECTED`, c2);
  await page.screenshot({ path: join(OUT, `${tag}-s3-fix.png`) });
  await page.evaluate(() => document.getElementById("s2b-fix-probe")?.remove());
  await sleep(250);

  // 4. Walk to the swarm page (ghost gate → ▶ ghost), verify BRK-3 baseline.
  await page.click("#tour-next"); // step 4/7 — ghost gate on page 20
  const s3 = await waitTour(page, (s) => s.phase === "active" && s.gateKind === "ghostReplay", 15000, "ghost gate");
  console.log(`  tour step4/7: idx=${s3.stepIndex} gate=${s3.gate} kind=${s3.gateKind} dockState`);
  const c3 = await chromeRects(page);
  report(`${tag} step4/7 GATE`, c3);
  await page.click("#tilt-replay-play");
  const s4 = await waitTour(page, (s) => s.phase === "active" && s.stepIndex === 4, 30000, "swarm page");
  console.log(`  tour step5/7: idx=${s4.stepIndex} look=${s4.lookKey} page=${s4.page}`);
  await settle(page);
  await sleep(800);
  const c4 = await chromeRects(page);
  report(`${tag} step5/7 SWARM`, c4);
  await page.screenshot({ path: join(OUT, `${tag}-s5-swarm.png`) });

  await page.keyboard.press("Escape");
  await sleep(300);
  const sEnd = await page.evaluate(() => window.__wp1.tour());
  console.log(`  after Esc: running=${sEnd.running}`);
  await page.close();
}

for (const [w, h, tag] of [
  [1280, 800, "1280x800"],
  [1440, 900, "1440x900"],
  [1280, 1024, "1280x1024"],
]) {
  await runViewport(w, h, tag);
}

await browser.close();
srv.close();
console.log(`\nscreenshots in ${OUT}`);
