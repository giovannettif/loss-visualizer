/**
 * diag-tp2-tilt-speed.mjs — QA TP2-TILT-NO-SPEED verification.
 *
 * Finding (against an older tree): the §7 tilt-b ghost replay had no speed
 * control — the universal 0.5×/1×/2× cluster was hidden (SCENES['tilt-b']
 * carries no transport flag) and the tick advanced tiltScrubClock by raw dt.
 * The tree under test implements the bespoke-row fix: #tilt-speed lives in
 * the #tilt-replay row (index.html), its buttons route to setReplaySpeed
 * (main.ts), and the tick scales by this.replaySpeed (director.ts).
 *
 * Checks, on ?shot=tilt-b (deterministic ghost parked at 35%) and ?step=20
 * (the finding's original repro URL):
 *   1. #tilt-replay visible; #tilt-speed visible with 0.5×/1×/2× buttons.
 *   2. Universal footer transport (#play-btn / #speed-wrap) stays hidden —
 *      the in-row cluster REPLACES it on tilt-b (by design, QA
 *      S7-TILTB-DEAD-CONTROLS family); no dead duplicate.
 *   3. Speed buttons toggle data-on (setReplaySpeed → els.speedButtons sync).
 *   4. The ride rate follows the toggle: Δscrub per second at 1× vs 2× vs
 *      0.5× measures ≈ 2× / 0.5× (tick scaling, ghostDuration nominal).
 *
 * Read-only against src/ — serves the freshly built dist/ on 4186.
 */
import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, extname, resolve } from "node:path";

const DIST = join(process.cwd(), "dist");
const PORT = 4186;
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

const visible = (sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return "missing";
    return el.hidden || el.offsetParent === null ? "hidden" : "visible";
  }, sel);

/** Park the ghost at frac via the scrub input, then start the ride. */
async function parkAndPlay(frac) {
  await page.evaluate((f) => {
    const scrub = document.querySelector("#tilt-scrub");
    scrub.value = String(Math.round(f * 1000));
    scrub.dispatchEvent(new Event("input", { bubbles: true }));
  }, frac);
  await sleep(150);
  await page.locator("#tilt-replay-play").click();
  await sleep(250);
}

/** Mean Δscrub per second over a 1.0 s window, sampled from tiltState.
 * Park at 0.10 (not 0.30): at 2× a full ride is ~1.7 s, so a late/long
 * window would hit scrub=1.0 mid-measurement and truncate the Δ (that
 * clamp, not the speed, is what the first run of this probe measured). */
async function measureRate() {
  const s0 = await page.evaluate(() => window.__wp1.tilt().scrub);
  await sleep(1000);
  const s1 = await page.evaluate(() => window.__wp1.tilt().scrub);
  await page.evaluate(() => {
    const scrub = document.querySelector("#tilt-scrub");
    scrub.value = "1000";
    scrub.dispatchEvent(new Event("input", { bubbles: true })); // pause @ end
  });
  return (s1 - s0) / 1.0;
}

/* ---------------- A. the finding's repro URL: ?step=20 ---------------- */
await page.goto(`http://localhost:${PORT}/?step=20`, { waitUntil: "load" });
await sleep(3000);
for (let i = 0; i < 30; i++) {
  if (!(await page.evaluate(() => window.__wp1.locked() || window.__wp1.animating()))) break;
  await sleep(250);
}
await sleep(400);
check("step=20: scene is tilt-b", (await page.evaluate(() => window.__wp1.scene())) === "tilt-b",
  `scene=${await page.evaluate(() => window.__wp1.scene())}`);
check("step=20: #tilt-replay row visible", (await visible("#tilt-replay")) === "visible");
check("step=20: #tilt-speed cluster visible (the finding's core complaint)",
  (await visible("#tilt-speed")) === "visible");
check("step=20: universal footer transport stays hidden (bespoke row replaces it)",
  (await visible("#play-btn")) === "hidden" && (await visible("#speed-wrap")) === "hidden",
  `play-btn=${await visible("#play-btn")} speed-wrap=${await visible("#speed-wrap")}`);
{
  const btns = await page.evaluate(() =>
    [...document.querySelectorAll("#tilt-speed button")].map((b) => b.dataset.speed),
  );
  check("step=20: three speed buttons 0.5/1/2",
    btns.length === 3 && btns.join(",") === "0.5,1,2", btns.join(","));
}

/* ---------------- B. deterministic pose: ?shot=tilt-b ---------------- */
/* Visibility/pose only — ?shot pages run director.frozen=true (main.ts:1165),
 * which gates the ride tick (director.ts:2340 !this.frozen), so RATE is
 * measured on the live ?step=20 page below. */
await page.goto(`http://localhost:${PORT}/?shot=tilt-b`, { waitUntil: "load" });
await sleep(2500);
check("shot=tilt-b: scene booted", (await page.evaluate(() => window.__wp1.scene())) === "tilt-b");
check("shot=tilt-b: ghost parked at 35%, not playing",
  Math.abs((await page.evaluate(() => window.__wp1.tilt().scrub)) - 0.35) < 0.02 &&
  (await page.evaluate(() => window.__wp1.tilt().scrubPlaying)) === false);

/* ---------------- C. live rate: ?step=20 (not frozen) ---------------- */
await page.goto(`http://localhost:${PORT}/?step=20`, { waitUntil: "load" });
await sleep(3000);
for (let i = 0; i < 30; i++) {
  if (!(await page.evaluate(() => window.__wp1.locked() || window.__wp1.animating()))) break;
  await sleep(250);
}
await sleep(400);
check("step=20 (live): #tilt-replay row visible", (await visible("#tilt-replay")) === "visible");
check("step=20 (live): 1× is the default highlighted speed",
  (await page.evaluate(() => document.querySelector('#tilt-speed button[data-speed="1"]').dataset.on)) === "true");

// 1× baseline
await parkAndPlay(0.1);
check("1×: ride is playing", (await page.evaluate(() => window.__wp1.tilt().scrubPlaying)) === true);
const rate1 = await measureRate();
check("1×: scrub advances at 1× (≈0.045–0.4 /s, nominal duration 2.5–11 s)",
  rate1 > 0.04 && rate1 < 0.4, `rate1=${rate1.toFixed(4)}/s`);

// 2× — click and check highlight + rate
await page.locator('#tilt-speed button[data-speed="2"]').click();
await sleep(200);
check("2×: button highlighted (data-on sync)",
  (await page.evaluate(() => document.querySelector('#tilt-speed button[data-speed="2"]').dataset.on)) === "true" &&
  (await page.evaluate(() => document.querySelector('#tilt-speed button[data-speed="1"]').dataset.on)) === "false");
await parkAndPlay(0.1);
const rate2 = await measureRate();
const ratio2 = rate2 / rate1;
check("2×: ride rate ≈ 2× the 1× rate", ratio2 > 1.6 && ratio2 < 2.4, `rate2=${rate2.toFixed(4)}/s ratio=${ratio2.toFixed(3)}`);

// 0.5×
await page.locator('#tilt-speed button[data-speed="0.5"]').click();
await sleep(200);
await parkAndPlay(0.1);
const rateHalf = await measureRate();
const ratioHalf = rateHalf / rate1;
check("0.5×: ride rate ≈ half the 1× rate", ratioHalf > 0.35 && ratioHalf < 0.65, `rateHalf=${rateHalf.toFixed(4)}/s ratio=${ratioHalf.toFixed(3)}`);
check("0.5×: button highlighted",
  (await page.evaluate(() => document.querySelector('#tilt-speed button[data-speed="0.5"]').dataset.on)) === "true");

// Pause semantics survive: ❚❚ pause stops a live ride mid-flight.
await parkAndPlay(0.1);
await sleep(150);
await page.locator("#tilt-replay-play").click();
await sleep(150);
check("pause still works alongside speed state",
  (await page.evaluate(() => window.__wp1.tilt().scrubPlaying)) === false);

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
srv.close();
console.log(failures === 0 ? "DIAG_TP2_TILT_SPEED_OK" : `DIAG_TP2_TILT_SPEED_FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
