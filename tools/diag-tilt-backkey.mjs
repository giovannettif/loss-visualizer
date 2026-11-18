/**
 * diag-tilt-backkey.mjs — S2-BWD-1 reproduction: ArrowUp/ArrowDown are dead
 * reader keys on the tilt-a reader steps (18/19) while a run is live.
 *
 *   A. Fresh ?step=19 entry: run reports done=false, steered=false and STAYS
 *      that way with no input (15 s poll) — the capture window is unbounded.
 *      Then one ArrowUp: step must stay 19 (capture) and the board must
 *      respond (input.y=1 → steered → pos moves).
 *   B. Repeated ArrowUps over ~12 s (finding t1 style): never navigates.
 *   C. Space advances 19→20 is NOT tested here (that crosses scenes); Space
 *      18→19 forward control (finding t8) is: fresh ?step=18, Space → 19.
 *   D. Positive control: click #tilt-finish (run done) → ArrowUp navigates
 *      back (finding t6: only after Finish did ArrowUp navigate 18→17).
 *
 * Read-only against src/ — serves the prebuilt dist/ on a private port.
 */

import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";

const DIST = join(process.cwd(), "dist");
const PORT = 4197;
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

const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

const st = () =>
  page.evaluate(() => {
    const t = window.__wp1.tilt();
    return {
      step: window.__wp1.step(),
      scene: window.__wp1.scene(),
      locked: window.__wp1.locked(),
      animating: window.__wp1.animating(),
      done: t.done, steered: t.steered, settled: t.settled,
      pos: { x: +t.pos.x.toFixed(2), y: +t.pos.y.toFixed(2) },
      vel: { x: +t.vel.x.toFixed(3), y: +t.vel.y.toFixed(3) },
      input: { ...t.input }, steps: t.steps, cells: t.cells, level: t.level,
    };
  });

async function gotoIdle(query) {
  await page.goto(`http://localhost:${PORT}/${query}`, { waitUntil: "load" });
  await page.waitForTimeout(800);
  for (let i = 0; i < 40; i++) {
    const a = await page.evaluate(() => ({
      locked: window.__wp1.locked(), animating: window.__wp1.animating(),
    }));
    if (!a.locked && !a.animating) break;
    await sleep(250);
  }
}

async function tapKey(key, holdMs = 300) {
  await page.keyboard.down(key);
  await sleep(holdMs);
  const during = await st();
  await page.keyboard.up(key);
  await sleep(250);
  return { during, after: await st() };
}

/* ---- A: fresh ?step=19 — unsteered run stays live (unbounded window) ---- */
await gotoIdle("?step=19");
const a0 = await st();
console.log("A0 fresh ?step=19:", JSON.stringify(a0));
let stayedLive = true;
for (let s = 0; s < 15; s++) {
  await sleep(1000);
  const t = await st();
  if (t.done || t.steered || t.step !== 19) { stayedLive = false; console.log(`A poll t+${s + 1}s:`, JSON.stringify(t)); break; }
}
console.log("A1 unsteered run still live after 15s untouched:", stayedLive, JSON.stringify(await st()));

const upA = await tapKey("ArrowUp");
console.log("A2 ArrowUp DURING:", JSON.stringify(upA.during));
console.log("A3 ArrowUp AFTER :", JSON.stringify(upA.after));
console.log("A VERDICT: navigated =", upA.after.step !== 19,
  "| captured(board responded) =", upA.during.input.y === 1 || upA.during.steered);

/* ---- B: repeated ArrowUps over ~12 s (t1 style) ---- */
let navd = 0;
for (let i = 0; i < 12; i++) {
  await page.keyboard.down("ArrowUp");
  await sleep(120);
  await page.keyboard.up("ArrowUp");
  await sleep(880);
  const t = await st();
  if (t.step !== 19) { navd += 1; console.log(`B iter ${i}: NAVIGATED to ${t.step}`); break; }
}
console.log("B VERDICT: navigations in 12 ArrowUps =", navd, "final:", JSON.stringify(await st()));

/* ---- C: fresh ?step=18, Space forward control (reader navigable) ---- */
await gotoIdle("?step=18");
const c0 = await st();
console.log("C0 fresh ?step=18:", JSON.stringify(c0));
await page.keyboard.press("Space");
await sleep(700);
for (let i = 0; i < 20; i++) {
  const a = await page.evaluate(() => ({ locked: window.__wp1.locked(), animating: window.__wp1.animating() }));
  if (!a.locked && !a.animating) break;
  await sleep(250);
}
const c1 = await st();
console.log("C1 after Space:", JSON.stringify(c1), "| advanced =", c1.step !== 18);

/* ---- C2: ArrowDown while live (finding: forward is captured too) ---- */
const dn = await tapKey("ArrowDown");
console.log("C2 ArrowDown DURING:", JSON.stringify(dn.during));
console.log("C3 ArrowDown AFTER :", JSON.stringify(dn.after));
console.log("C VERDICT2: ArrowDown navigated =", dn.after.step !== 18,
  "| captured(board responded) =", dn.during.input.y === -1 || dn.after.steered);

/* ---- D: Finish ends the run, THEN ArrowUp navigates back ---- */
await page.click("#tilt-finish");
await sleep(400);
const d0 = await st();
const upD = await tapKey("ArrowUp");
console.log("D0 after Finish:", JSON.stringify(d0));
console.log("D1 ArrowUp AFTER :", JSON.stringify(upD.after));
console.log("D VERDICT: navigated back after Finish =", upD.after.step < d0.step);

await browser.close();
srv.close();
