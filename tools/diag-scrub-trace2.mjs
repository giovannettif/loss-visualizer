// SCRUB-HITCH follow-up #3: proper CDP timeline trace of one scrub drag.
// Collects via Tracing.dataCollected, aggregates renderer main-thread phases
// (EventDispatch / RecalculateStyles / UpdateLayout / PrePaint / Commit /
// HitTest / CompositeLayers / FunctionCall / Task) and the >30ms tasks.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const PORT = process.env.PORT ?? "4193";
const URL = `http://localhost:${PORT}/?step=13`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto(URL, { waitUntil: "load" });
for (let i = 0; i < 60; i++) {
  const a = await page.evaluate(() => ({
    locked: window.__wp1?.locked?.() ?? true,
    animating: window.__wp1?.animating?.() ?? true,
  }));
  if (!a.locked && !a.animating) break;
  await sleep(250);
}
await sleep(400);
await page.click("#play-btn");
await page.waitForFunction(
  () => Number(document.querySelector("#replay-scrub")?.value ?? 0) >= 999,
  null, { timeout: 45000 },
);
await sleep(400);

const browserCdp = await browser.newBrowserCDPSession();
const chunks = [];
browserCdp.on("Tracing.dataCollected", (ev) => { if (Array.isArray(ev.value)) chunks.push(...ev.value); });
let complete = new Promise((res) => browserCdp.once("Tracing.tracingComplete", res));
await browserCdp.send("Tracing.start", {
  traceConfig: {
    includedCategories: [
      "devtools.timeline",
      "toplevel",
      "disabled-by-default-devtools.timeline.frame",
    ],
  },
});

// One drag, ~120 events.
const box = await page.locator("#replay-scrub").boundingBox();
const y = Math.round(box.y + box.height / 2);
const x0 = Math.round(box.x + box.width * 0.04);
const x1 = Math.round(box.x + box.width * 0.96);
const cdp = await page.context().newCDPSession(page);
const t0 = Date.now();
await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: x0, y, button: "left", clickCount: 1 });
for (let i = 1; i <= 120; i++) {
  const x = Math.round(x0 + (x1 - x0) * (i / 120));
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1 });
  const target = t0 + (i / 120) * 2000;
  const wait = target - Date.now();
  if (wait > 0) await sleep(wait);
}
await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: x1, y, button: "left", clickCount: 1 });
console.log("dragMs:", Date.now() - t0);
await sleep(500);
await browserCdp.send("Tracing.end");
await complete;
console.log("trace events:", chunks.length);
writeFileSync("qa/_diag_scrub_trace2.json", JSON.stringify(chunks));

// Aggregate X-phase events by name across ALL processes, split by pid.
const byName = new Map();
const pids = new Map();
for (const ev of chunks) {
  pids.set(ev.pid, (pids.get(ev.pid) ?? 0) + 1);
  if (ev.ph !== "X") continue;
  const key = `${ev.name}`;
  const cur = byName.get(key) ?? { n: 0, total: 0, max: 0 };
  cur.n += 1;
  cur.total += ev.dur ?? 0;
  cur.max = Math.max(cur.max, ev.dur ?? 0);
  byName.set(key, cur);
}
console.log("pids:", JSON.stringify([...pids.entries()].map(([p, n]) => ({ pid: p, events: n }))));
const top = [...byName.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 30);
console.log("TOP TRACE EVENTS by total dur (ms):");
for (const [k, v] of top) console.log(`  ${String(v.n).padStart(6)}x  total=${(v.total / 1000).toFixed(1)}ms  max=${(v.max / 1000).toFixed(1)}ms  ${k}`);

// Big slices > 30ms
const big = chunks
  .filter((ev) => ev.ph === "X" && (ev.dur ?? 0) > 30000)
  .sort((a, b) => b.dur - a.dur)
  .slice(0, 12)
  .map((ev) => ({ name: ev.name, pid: ev.pid, tid: ev.tid, durMs: +(ev.dur / 1000).toFixed(1) }));
console.log("EVENTS > 30ms:", JSON.stringify(big, null, 0));

await browser.close();
console.log("DONE");
