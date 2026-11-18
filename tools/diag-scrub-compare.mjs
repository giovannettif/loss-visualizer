// SCRUB-HITCH comparison: original bundle vs antialias:!1 rewrite.
// Per config: (a) rAF gaps during normal ▶ playback (no input), (b) rAF gaps
// + per-event handler cost during a paced scrub drag. Ties SCRUB-HITCH to the
// per-frame render cost and quantifies the MSAA lever under SwiftShader.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";

const DIST = join(process.cwd(), "dist");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff" };

function makeServer(port, rewrite) {
  const srv = createServer((req, res) => {
    let p = req.url.split("?")[0];
    if (p === "/" || p === "") p = "/index.html";
    const file = join(DIST, p);
    if (!existsSync(file)) {
      res.writeHead(404).end("no");
      return;
    }
    let body = readFileSync(file);
    if (rewrite) {
      body = Buffer.from(body.toString("utf8")
        .replaceAll("new Xl({antialias:!0})", "new Xl({antialias:!1})")
        .replaceAll("Math.min(window.devicePixelRatio||1,2)", "0.5"),
      );
    }
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  });
  return new Promise((res) => srv.listen(port, () => res(srv)));
}

await makeServer(4194, false);
await makeServer(4195, true);
console.log("servers up: 4194=original, 4195=antialias:false");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gapStats(page) {
  return page.evaluate(() => {
    const gaps = window.__ticks
      .map((t) => (typeof t === "number" ? t : t?.gap))
      .filter((g) => g != null);
    const sorted = [...gaps].sort((a, b) => a - b);
    const p = (q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : NaN);
    return {
      frames: gaps.length,
      p50: +p(0.5).toFixed(1),
      p95: +p(0.95).toFixed(1),
      max: +Math.max(...gaps).toFixed(1),
      over32Pct: +((100 * gaps.filter((g) => g > 32).length) / gaps.length).toFixed(1),
    };
  });
}

async function run(port, label) {
  const browser = await chromium.launch({
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu"],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  await page.addInitScript(() => {
    document.addEventListener("input", (e) => {
      if (e.target && e.target.id === "replay-scrub") window.__inpStart = performance.now();
    }, { capture: true });
  });
  await page.goto(`http://localhost:${port}/?step=13`, { waitUntil: "load" });
  await page.evaluate(() => {
    window.__ticks = [];
    window.__inp = [];
    let last = null;
    const tick = (now) => {
      const gap = last == null ? null : now - last;
      last = now;
      window.__ticks.push(gap == null ? null : +gap.toFixed(2));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    document.addEventListener("input", (e) => {
      if (e.target && e.target.id === "replay-scrub") {
        window.__inp.push(+(performance.now() - (window.__inpStart ?? 0)).toFixed(2));
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
  await sleep(400);

  // (a) PLAYBACK gaps: click play, record ~4s of frames while it rolls.
  await page.evaluate(() => { window.__ticks.length = 0; });
  await page.click("#play-btn");
  const dur = await page.evaluate(() => window.__wp1.replayInfo().lanes);
  await sleep(4500);
  const playback = await gapStats(page);
  console.log(`${label} PLAYBACK (lab replay rolling):`, JSON.stringify(playback));
  // finish the replay if still going
  await page.waitForFunction(
    () => Number(document.querySelector("#replay-scrub")?.value ?? 0) >= 999,
    null, { timeout: 45000 },
  ).catch(() => {});
  await sleep(300);

  // (b) SCRUB DRAG (paced ~60Hz target).
  const box = await page.locator("#replay-scrub").boundingBox();
  const y = Math.round(box.y + box.height / 2);
  const x0 = Math.round(box.x + box.width * 0.04);
  const x1 = Math.round(box.x + box.width * 0.96);
  const cdp = await page.context().newCDPSession(page);
  await page.evaluate(() => { window.__ticks.length = 0; window.__inp.length = 0; });
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
  const dragMs = Date.now() - t0;
  await sleep(300);
  const scrub = await gapStats(page);
  const inp = await page.evaluate(() => window.__inp);
  scrub.inputEvents = inp.length;
  scrub.inpDtP50 = inp.length ? [...inp].sort((a, b) => a - b)[Math.floor(inp.length / 2)] : null;
  scrub.dragMs = dragMs;
  console.log(`${label} SCRUB DRAG:`, JSON.stringify(scrub));
  await browser.close();
}

await run(4194, "ORIG  ");
await run(4195, "NO-AA ");
console.log("DONE");
process.exit(0);
