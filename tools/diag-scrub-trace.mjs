// SCRUB-HITCH follow-up #2:
//  Part 1 — same drag, but default launch (GPU path, no swiftshader flags):
//           does the ~70ms native block vanish when rasterization is hardware?
//  Part 2 — CDP timeline trace (browser-level) of one swiftshader drag:
//           name the native phase (RecalculateStyles / Layout / Paint /
//           Rasterize / Present) that eats the ~70ms per input event.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const PORT = process.env.PORT ?? "4193";
const URL = `http://localhost:${PORT}/?step=13`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot(browser) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  await page.addInitScript(() => {
    document.addEventListener("input", (e) => {
      if (e.target && e.target.id === "replay-scrub") window.__inpStart = performance.now();
    }, { capture: true });
  });
  await page.goto(URL, { waitUntil: "load" });
  await page.evaluate(() => {
    window.__ticks = [];
    window.__inp = [];
    let last = null;
    const tick = (now) => {
      const gap = last == null ? null : now - last;
      last = now;
      window.__ticks.push(gap == null ? null : +(now - (last - gap)).toFixed(0) && +gap.toFixed(2));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    document.addEventListener("input", (e) => {
      if (e.target && e.target.id === "replay-scrub") {
        window.__inp.push({ dt: +(performance.now() - (window.__inpStart ?? 0)).toFixed(2), val: e.target.value });
      }
    }, { capture: false });
  });
  for (let i = 0; i < 60; i++) {
    const a = await page.evaluate(() => ({
      locked: window.__wp1?.locked?.() ?? true,
      animating: window.__wp1?.animating?.() ?? true,
    }));
    if (!a.locked && !a.animating) break;
    await sleep(250);
  }
  await sleep(500);
  await page.click("#play-btn");
  await page.waitForFunction(
    () => Number(document.querySelector("#replay-scrub")?.value ?? 0) >= 999,
    null, { timeout: 45000 },
  );
  await sleep(400);
  return page;
}

function stats(gaps, inp, label) {
  const sorted = [...gaps].sort((a, b) => a - b);
  const p = (q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : NaN);
  console.log("STATS:", JSON.stringify({
    label,
    frames: gaps.length,
    gapP50: +p(0.5).toFixed(1),
    gapP95: +p(0.95).toFixed(1),
    gapMax: +Math.max(...gaps).toFixed(1),
    over32: gaps.filter((g) => g > 32).length,
    over32Pct: +((100 * gaps.filter((g) => g > 32).length) / gaps.length).toFixed(1),
    inputEvents: inp.length,
    inpDtP50: inp.length ? [...inp.map((i) => i.dt)].sort((a, b) => a - b)[Math.floor(inp.length / 2)] : null,
  }));
}

async function dragOnce(page, { paced }) {
  const box = await page.locator("#replay-scrub").boundingBox();
  const y = Math.round(box.y + box.height / 2);
  const x0 = Math.round(box.x + box.width * 0.04);
  const x1 = Math.round(box.x + box.width * 0.96);
  const cdp = await page.context().newCDPSession(page);
  await page.evaluate(() => { window.__ticks.length = 0; window.__inp.length = 0; });
  const t0 = Date.now();
  const N = 120;
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: x0, y, button: "left", clickCount: 1 });
  for (let i = 1; i <= N; i++) {
    const x = Math.round(x0 + (x1 - x0) * (i / N));
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1 });
    if (paced) {
      const target = t0 + (i / N) * 2000;
      const wait = target - Date.now();
      if (wait > 0) await sleep(wait);
    }
  }
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: x1, y, button: "left", clickCount: 1 });
  const dragMs = Date.now() - t0;
  await sleep(300);
  const data = await page.evaluate(() => ({ ticks: window.__ticks, inp: window.__inp }));
  const gaps = data.ticks.filter((g) => g != null);
  stats(gaps, data.inp, `${paced ? "paced" : "burst"} dragMs=${dragMs}`);
  return dragMs;
}

/* ---- Part 1: GPU launch ---- */
{
  console.log("=== PART 1: default (GPU) launch ===");
  const browser = await chromium.launch();
  const page = await boot(browser);
  await dragOnce(page, { paced: true });
  await browser.close();
}

/* ---- Part 2: timeline trace of one swiftshader drag ---- */
{
  console.log("=== PART 2: swiftshader + CDP trace ===");
  const browser = await chromium.launch({
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu"],
  });
  const page = await boot(browser);
  const browserCdp = await browser.newBrowserCDPSession();
  await browserCdp.send("Tracing.start", {
    traceConfig: {
      includedCategories: [
        "devtools.timeline",
        "disabled-by-default-devtools.timeline.frame",
        "disabled-by-default-devtools.timeline.invalidationTracking",
      ],
    },
  });
  await dragOnce(page, { paced: true });
  const { data, metadata, stream } = await browserCdp.send("Tracing.end");
  // Drain the stream (both transferModes: reportSuccess/dataComplete or stream)
  let buf = data ?? "";
  if (stream) {
    while (true) {
      const chunk = await browserCdp.send("Tracing.requestMemoryDump").catch(() => null); // placeholder no-op
      void chunk;
      break;
    }
  }
  // Simpler: re-run with transferMode=ReturnAsStream is complex; Tracing.end
  // without stream returns data in one shot (may be truncated for long traces,
  // acceptable for a 2-3s window).
  const events = [];
  try {
    const lines = buf.split("\n").filter((l) => l.trim());
    for (const line of lines) {
      try { events.push(JSON.parse(line)); } catch {}
    }
  } catch (e) {
    console.log("trace parse error", e.message);
  }
  console.log("trace events parsed:", events.length);
  writeFileSync("qa/_diag_scrub_trace.json", JSON.stringify(events.slice(0, 200000)));

  // Aggregate: renderer-thread timeline categories by name.
  const byName = new Map();
  for (const ev of events) {
    if (ev.cat !== "devtools.timeline" && ev.cat !== "disabled-by-default-devtools.timeline.frame") continue;
    if (ev.ph !== "X" && ev.ph !== "E") continue;
    const key = `${ev.name}`;
    const cur = byName.get(key) ?? { n: 0, total: 0, max: 0 };
    cur.n += 1;
    if (ev.ph === "X") {
      cur.total += ev.dur ?? 0;
      cur.max = Math.max(cur.max, ev.dur ?? 0);
    }
    byName.set(key, cur);
  }
  const top = [...byName.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 25);
  console.log("TOP TIMELINE EVENTS by total dur (ms):");
  for (const [k, v] of top) console.log(`  ${String(v.n).padStart(5)}x  total=${(v.total / 1000).toFixed(1)}ms  max=${(v.max / 1000).toFixed(1)}ms  ${k}`);

  // The big tasks: find >50ms entries and their names.
  const big = events
    .filter((ev) => ev.ph === "X" && (ev.dur ?? 0) > 30000)
    .sort((a, b) => b.dur - a.dur)
    .slice(0, 15)
    .map((ev) => ({ name: ev.name, cat: ev.cat, dur: +(ev.dur / 1000).toFixed(1) }));
  console.log("EVENTS > 30ms:", JSON.stringify(big, null, 0));
  await browser.close();
}
console.log("DONE");
