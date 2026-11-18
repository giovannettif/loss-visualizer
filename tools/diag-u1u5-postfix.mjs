/**
 * diag-u1u5-postfix.mjs — post-fix verification for U1-POINT-ETA + U5-POINT-
 * LEVELS (the pre-fix repro drivers tools/diag-u1-point-eta.mjs and
 * tools/diag-u5-tour-s7-pills.mjs pin the BUGGY state, so they must not be
 * re-run as pass/fail after the fix).
 *
 * U1: the §2 η-gate step (page 6/gd-c) now carries look "eta-slider"
 *     (lookRegistry kind "control") — the tour's leader dot must land inside
 *     the #eta-slider rect in the READER panel, the look must spotlight the
 *     slider (data-spot, no scene dim), and free-play sentence hover must
 *     anchor the same control.
 * U5: the §7 level sentence (page 19/tilt-b) now carries look "tilt-levels" —
 *     the dot must land inside #tilt-levels (inside a pill), with the tilt
 *     panel spotlit and the pills row data-spot-glowed.
 *
 * Read-only against src/ — serves the freshly built dist/ on :4188.
 */

import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname, resolve } from "node:path";

const DIST = join(process.cwd(), "dist");
const PORT = 4188;
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff",
};
const srv = createServer((req, res) => {
  let p = req.url.split("?")[0];
  if (p === "/" || p === "") p = "/index.html";
  const file = join(DIST, p);
  if (!existsSync(file)) { res.writeHead(404).end("no"); return; }
  res.writeHead(200, { "content-type": MIME[extname(file) ?? ""] ?? "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r, rej) => {
  srv.once("error", rej);
  srv.listen(PORT, () => r());
});
console.log(`serving dist on :${PORT}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) fails++;
};

const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

async function tourState() {
  return page.evaluate(() => window.__wp1?.tour?.() ?? null);
}
async function waitTour(pred, maxMs = 20000, label = "tour state") {
  const t0 = Date.now();
  let s = null;
  for (;;) {
    s = await tourState();
    if (s && pred(s)) return s;
    if (Date.now() - t0 > maxMs) {
      console.log(`  (timeout waiting for ${label}: ${JSON.stringify(s)})`);
      return s;
    }
    await sleep(120);
  }
}
async function waitIdle(maxMs = 25000) {
  const t0 = Date.now();
  for (;;) {
    const a = await page.evaluate(() => ({
      locked: window.__wp1?.locked?.(),
      animating: window.__wp1?.animating?.(),
    }));
    if (!a.locked && !a.animating) return true;
    if (Date.now() - t0 > maxMs) return false;
    await sleep(200);
  }
}

/** Drags an arrow on the compass minimap (releases the §2 arrowDrawn gate). */
async function dragMinimap(dx0, dy0, dx1, dy1) {
  const box = await page.locator("#minimap-canvas").boundingBox();
  if (!box) throw new Error("minimap canvas missing");
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx + dx0, cy + dy0);
  await page.mouse.down();
  await page.mouse.move(cx + dx1, cy + dy1, { steps: 8 });
  await page.mouse.up();
}

/** The leader dot vs a control's rect + the look state. */
const probe = (sel) =>
  page.evaluate((sel) => {
    const dot = document.querySelector("#tour-dot");
    const ax = dot ? Number(dot.getAttribute("cx")) : null;
    const ay = dot ? Number(dot.getAttribute("cy")) : null;
    const el = document.querySelector(sel);
    const r = el?.getBoundingClientRect();
    const inRect = r && ax !== null && ax >= r.left && ax <= r.right && ay >= r.top && ay <= r.bottom;
    return {
      anchor: { x: ax, y: ay },
      overlayOn: document.querySelector("#tour-overlay")?.dataset.on,
      rect: r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null,
      spot: el?.dataset?.spot ?? null,
      inRect,
      look: window.__wp1?.look?.() ?? null,
      tourLookKey: window.__wp1?.tour?.()?.lookKey ?? null,
    };
  }, sel);

/* ---------------- U1: the §2 η gate points at the reader slider ---------- */

await page.goto(`http://localhost:${PORT}/?step=4`, { waitUntil: "load" });
await sleep(1500);
if (!(await waitIdle())) console.log("WARN: §2 still locked after entry");
{
  await page.locator('.rstep[data-active="true"] .tour-launch').click();
  await waitTour((s) => s.phase === "active" && s.stepIndex === 0, 12000, "U1 start");
  await page.keyboard.press("Space"); // → the compass gate on gd-b
  await waitTour((s) => s.phase === "active" && s.stepIndex === 1, 12000, "U1 compass gate");
  await dragMinimap(10, 40, 62, 80); // the gate's action: draw the arrow
  await sleep(1300); // the commit + GD's step play out
  await waitTour((s) => s.phase === "active" && s.stepIndex === 2, 12000, "U1 gd-step");
  await page.keyboard.press("Space"); // → the η gate on gd-c (page 6)
  const g = await waitTour((s) => s.phase === "active" && s.stepIndex === 3, 15000, "U1 eta gate");
  check("U1: tour parked on the η gate step", g?.gateKind === "etaMoved" && g?.gate === true, JSON.stringify(g));
  await sleep(800); // fades settle

  const p = await probe("#eta-slider");
  check("U1: lookKey is eta-slider (was ball)", p.tourLookKey === "eta-slider", `lookKey=${p.tourLookKey}`);
  check("U1: leader dot INSIDE the #eta-slider rect (was ~856px away at the ball)",
    p.inRect === true, `dot=${JSON.stringify(p.anchor)} rect=${JSON.stringify(p.rect)}`);
  check("U1: overlay live", p.overlayOn === "true", `overlay=${p.overlayOn}`);
  check("U1: slider glows via data-spot", p.spot === "true", `data-spot=${p.spot}`);
  check(
    "U1: look active with NO scene dim/ring (reader DOM target, not a scene object)",
    p.look?.active === true && p.look?.id === "eta-slider" &&
      p.look?.sceneDim === false && p.look?.ring === false &&
      JSON.stringify(p.look?.spotPanels) === JSON.stringify(["eta-slider"]),
    JSON.stringify(p.look),
  );
  await page.screenshot({ path: resolve("shots", "u1-postfix-eta-gate.png") });

  // The gate still releases on a real η move (no regression from the re-point).
  await page.evaluate(() => {
    const s = document.querySelector("#eta-slider");
    s.value = "820";
    s.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const rel = await waitTour((s) => s.phase === "active" && s.stepIndex === 4, 12000, "U1 release");
  check("U1: η move still releases the gate", rel?.stepIndex === 4 && rel?.gate === false, JSON.stringify(rel));
  await page.keyboard.press("Escape");
  await waitTour((s) => !s.running, 5000, "U1 esc");
  await waitIdle();

  // Free-play graduation: hovering the registered sentence anchors the slider.
  await page.locator('.rstep[data-active="true"] .sent[data-slook]').first().hover().catch(() => {});
  const sl = await page.evaluate(() => document.querySelectorAll('.sent[data-slook="eta-slider"]').length);
  check("U1: the η sentence carries data-slook=eta-slider for free-play hover", sl === 1, `count=${sl}`);
}

/* ---------------- U5: the §7 level sentence points at the pills ---------- */

await page.goto(`http://localhost:${PORT}/?step=18`, { waitUntil: "load" });
await sleep(1600);
if (!(await waitIdle())) console.log("WARN: §7 still locked after entry");
{
  await page.locator('.rstep[data-active="true"] .tour-launch').click();
  await waitTour((s) => s.phase === "active" && s.stepIndex === 0, 12000, "U5 start");
  await page.keyboard.press("Escape");
  await waitTour((s) => !s.running, 5000, "U5 esc 1");
  await waitIdle();
  // U4: the chip always starts at the head — walk with Next after releasing
  // the steering gate, to reach stepIndex 2 (the level sentence on page 19).
  await page.locator('.rstep[data-active="true"] .tour-launch').click();
  await waitTour((s) => s.phase === "active" && s.stepIndex === 0, 12000, "U5 start 2");
  await page.keyboard.down("a");
  await sleep(300);
  await page.keyboard.up("a");
  await waitTour((s) => s.phase === "active" && s.stepIndex === 1, 12000, "U5 steering release");
  await page.locator("#tour-next").click();
  await waitTour((s) => s.phase === "active" && s.stepIndex === 2, 15000, "U5 level sentence");

  const p = await probe("#tilt-levels");
  check("U5: lookKey is tilt-levels (was tilt-panel)", p.tourLookKey === "tilt-levels", `lookKey=${p.tourLookKey}`);
  check("U5: leader dot INSIDE the #tilt-levels pills row (was the damping row ~56px above)",
    p.inRect === true, `dot=${JSON.stringify(p.anchor)} rect=${JSON.stringify(p.rect)}`);
  const pillHit = await page.evaluate(() => {
    const dot = document.querySelector("#tour-dot");
    const ax = Number(dot?.getAttribute("cx"));
    const ay = Number(dot?.getAttribute("cy"));
    return [...document.querySelectorAll("#tilt-levels .btn")].some((b) => {
      const r = b.getBoundingClientRect();
      return ax >= r.left && ax <= r.right && ay >= r.top && ay <= r.bottom;
    });
  });
  check("U5: dot lands inside a level PILL (the sentence names Rosenbrock)", pillHit === true);
  check("U5: pills row glows via data-spot + tilt panel spotlit", p.spot === "true" && JSON.stringify(p.look?.spotPanels).includes("tilt-panel"), `data-spot=${p.spot} spotPanels=${JSON.stringify(p.look?.spotPanels)}`);
  check("U5: scene dim live (panel-family spotlight unchanged)", p.look?.active === true && p.look?.sceneDim === true, JSON.stringify(p.look));
  await page.screenshot({ path: resolve("shots", "u5-postfix-level-pills.png") });

  await page.keyboard.press("Escape");
  await waitTour((s) => !s.running, 5000, "U5 esc 2");
}

await browser.close();
srv.close();
console.log(fails === 0 ? "\nU1+U5 POSTFIX: ALL CHECKS PASSED" : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
