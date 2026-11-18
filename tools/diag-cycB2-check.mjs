/* Cycle B round-2 verification drive:
   BRK-3      — a RUNNING tour controller must not cover the swarm dock's
                transport (bar moves above the dock on the swarm page) while
                staying clickable itself.
   F1 re-check — #swarm-scrub (BY ID) is mouse-alive at both sizes; the
                round-2 finding's 13x13 "scrub" rect was the blind checkbox
                (querySelector("#swarm-dock input") matches it first). */
import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";

const base = process.argv[2] ?? "http://localhost:4173";
let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const idle = async (page, maxMs = 25000) => {
  const t0 = Date.now();
  for (;;) {
    const a = await page.evaluate(() => ({ l: window.__wp1?.locked?.(), an: window.__wp1?.animating?.() }));
    if (!a.l && !a.an) return true;
    if (Date.now() - t0 > maxMs) return false;
    await sleep(250);
  }
};

const browser = await launchGL(chromium);

/* ---- BRK-3: running tour vs the swarm dock transport -------------------- */
for (const [w, h] of [[900, 620], [1280, 800]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(`${base}/?step=21`, { waitUntil: "load" });
  await sleep(1500);
  await idle(page);
  await page.locator('.rstep[data-active="true"] .tour-launch').click();
  let tour = null;
  const t0 = Date.now();
  for (;;) {
    tour = await page.evaluate(() => window.__wp1.tour());
    if (tour?.running && tour?.phase === "active") break;
    if (Date.now() - t0 > 15000) break;
    await sleep(150);
  }
  check(`BRK-3 ${w}x${h}: s7 tour runs on the swarm page`, tour?.running === true, JSON.stringify({ running: tour?.running, phase: tour?.phase, page: tour?.page }));
  await sleep(600); // the 0.35s bar fade settles
  const m = await page.evaluate(() => {
    const rect = (sel) => {
      const r = document.querySelector(sel).getBoundingClientRect();
      return { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom) };
    };
    const hit = (sel) => {
      const r = document.querySelector(sel).getBoundingClientRect();
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { hit: el ? (el.id || el.tagName) : "null", inBar: !!el?.closest?.("#tour-bar") };
    };
    const dock = rect("#swarm-dock");
    const bar = rect("#tour-bar-full");
    return {
      dock, bar,
      overlap: !(bar.l >= dock.r || bar.r <= dock.l || bar.t >= dock.b || bar.b <= dock.t),
      play: hit("#swarm-replay-play"),
      restart: hit("#swarm-replay-restart"),
      scrub: hit("#swarm-scrub"),
      barOn: document.querySelector("#tour-bar")?.dataset.on,
    };
  });
  check(
    `BRK-3 ${w}x${h}: the live bar is clear of the swarm dock`,
    m.barOn === "true" && m.overlap === false,
    `bar=${JSON.stringify(m.bar)} dock=${JSON.stringify(m.dock)} on=${m.barOn}`,
  );
  check(
    `BRK-3 ${w}x${h}: dock transport hit-tests to the dock (not the bar)`,
    !m.play.inBar && !m.restart.inBar && !m.scrub.inBar,
    JSON.stringify({ play: m.play.hit, restart: m.restart.hit, scrub: m.scrub.hit }),
  );
  await page.locator("#swarm-replay-restart").click(); // pre-fix: Playwright interception error
  await sleep(500);
  const sw = await page.evaluate(() => window.__wp1.swarm());
  check(
    `BRK-3 ${w}x${h}: the dock restart click lands during the tour`,
    sw !== null && sw.playing === true,
    `playing=${sw?.playing} t=${sw?.time?.toFixed?.(2)}`,
  );
  const before = await page.evaluate(() => window.__wp1.tour().stepIndex);
  await page.locator("#tour-next").click();
  await sleep(700);
  const after = await page.evaluate(() => window.__wp1.tour().stepIndex);
  check(
    `BRK-3 ${w}x${h}: the raised bar is still clickable (Next advances the sentence)`,
    after === before + 1,
    `stepIndex ${before} -> ${after}`,
  );
  await page.keyboard.press("Escape");
  await sleep(500);
  await idle(page);
  await page.close();
}

/* ---- F1 re-check: the REAL scrubber is mouse-alive (no tour) ------------- */
for (const [w, h] of [[1600, 900], [900, 620]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(`${base}/?step=21`, { waitUntil: "load" });
  await sleep(1500);
  await idle(page);
  const m = await page.evaluate(() => {
    const r = document.querySelector("#swarm-scrub").getBoundingClientRect();
    const hits = [0.2, 0.5, 0.8].map((f) => {
      const el = document.elementFromPoint(r.left + r.width * f, r.top + r.height / 2);
      return el ? (el.id || el.tagName) : "null";
    });
    return {
      w: Math.round(r.width),
      firstInput: document.querySelector("#swarm-dock input").id,
      hits,
      labelBottom: Math.round(document.querySelector("#swarm-dock label").getBoundingClientRect().bottom),
      scrubTop: Math.round(r.top),
    };
  });
  check(
    `F1 ${w}x${h}: #swarm-scrub has real width and owns its whole track`,
    m.w >= 60 && m.hits.every((x) => x === "swarm-scrub"),
    `width=${m.w} hits=${JSON.stringify(m.hits)} (the finding's 13x13 rect is #swarm-dock input = "${m.firstInput}", the blind checkbox)`,
  );
  check(
    `F1 ${w}x${h}: the scrub row sits below the run-blind label (no overlap)`,
    m.scrubTop >= m.labelBottom,
    `labelBottom=${m.labelBottom} scrubTop=${m.scrubTop}`,
  );
  const st0 = await page.evaluate(() => ({ blind: window.__wp1.swarm()?.blind, scrub: window.__wp1.swarm()?.scrub }));
  const box = await page.locator("#swarm-scrub").boundingBox();
  await page.mouse.click(box.x + box.width * 0.7, box.y + box.height / 2);
  await sleep(400);
  const st1 = await page.evaluate(() => ({ blind: window.__wp1.swarm()?.blind, scrub: window.__wp1.swarm()?.scrub }));
  check(
    `F1 ${w}x${h}: a real click at 70% of the track SCRUBS (blind untouched)`,
    st1.blind === st0.blind && Math.abs(st1.scrub - st0.scrub) > 0.3,
    `blind ${st0.blind}->${st1.blind} scrub ${st0.scrub?.toFixed(2)}->${st1.scrub?.toFixed(2)}`,
  );
  await page.close();
}

await browser.close();
console.log(failures === 0 ? "ALL_PASS" : `FAILURES: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
