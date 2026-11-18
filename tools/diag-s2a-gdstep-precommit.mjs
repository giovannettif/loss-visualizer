/**
 * diag-s2a-gdstep-precommit.mjs — QA S2A-GDSTEP-LOOK-PRECOMMIT verification.
 *
 * The §2 gdStep hover/focus look must NOT reveal GD's step before the learner
 * commits an arrow. Pre-commit (userTip=null, gdTip=null), hovering (1600x900,
 * the finding's p5 repro) or keyboard-focusing (1280x800, the p12 repro) the
 * "GD's actual step plays out beside it in red" span must leave the scene
 * undimmed and ringless. After a commit (gdTip set) the same look must still
 * light up — the ring is the payoff, not the leak.
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

const OUT = resolve("qa/s2a-gdstep-precommit-r1");
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SPAN = '.rstep[data-scene="gd-b"] [data-look="gd-step"]';

const browser = await launchGL(chromium);

async function freshPage(w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const logs = [];
  page.on("pageerror", (e) => logs.push("pageerror: " + e.message));
  await page.goto(`http://localhost:${PORT}/?step=5`, { waitUntil: "load" });
  await sleep(3500);
  for (let i = 0; i < 40; i++) {
    const a = await page.evaluate(() => window.__wp1.locked() || window.__wp1.animating());
    if (!a) break;
    await sleep(250);
  }
  await sleep(500);
  page._logs = logs;
  return page;
}

const state = (page) =>
  page.evaluate(() => ({
    scene: window.__wp1.scene(),
    look: window.__wp1.look(),
    gd: window.__wp1.gd(),
  }));

let fails = 0;
const check = (tag, cond, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"} ${tag}`, typeof detail === "string" ? detail : JSON.stringify(detail));
  if (!cond) fails++;
};

// T1 — hover pre-commit at 1600x900 (the finding's p5 repro).
{
  const page = await freshPage(1600, 900);
  const pre = await state(page);
  check("T1 fresh gd-b: scene is gd-b, no arrow drawn",
    pre.scene === "gd-b" && pre.gd.userTip === null && pre.gd.gdTip === null,
    { scene: pre.scene, userTip: pre.gd.userTip, gdTip: pre.gd.gdTip });
  await page.locator(SPAN).first().hover();
  await sleep(700);
  const s = await state(page);
  check("T1 pre-commit hover: no spotlight ring", s.look.ring === false, s.look);
  check("T1 pre-commit hover: no scene dim", s.look.sceneDim === false, s.look);
  check("T1 pre-commit hover: gdTip still hidden", s.gd.gdTip === null, s.gd.gdTip);
  await page.screenshot({ path: join(OUT, "t1-hover-precommit.png") });
  await page.mouse.move(700, 450);
  await sleep(500);
  const off = await state(page);
  check("T1 leave span: look fully cleared", off.look.active === false && off.look.ring === false, off.look);
  if (page._logs.length) check("T1 no page errors", false, page._logs.join("\n"));
  await page.close();
}

// T2 — keyboard focus pre-commit at 1280x800 (the finding's p12 repro).
{
  const page = await freshPage(1280, 800);
  await page.locator(SPAN).first().focus();
  await sleep(700);
  const s = await state(page);
  check("T2 pre-commit focus: no spotlight ring", s.look.ring === false, s.look);
  check("T2 pre-commit focus: no scene dim", s.look.sceneDim === false, s.look);
  check("T2 pre-commit focus: gdTip still hidden", s.gd.gdTip === null, s.gd.gdTip);
  await page.screenshot({ path: join(OUT, "t2-focus-precommit.png") });
  await page.close();
}

// T3 — a hover held THROUGH the commit must light up on its own: the span's
// lookId stays set (ringless) pre-commit; the commit fires onArrowCommit →
// updateGdArrows → reapplyLook, which re-applies it now that gdTip exists.
// The commit is driven with synthetic pointer events on the minimap surface
// (CompassMinimap handles untrusted probes) so the REAL pointer never leaves
// the span — no pointerout, no setLook(null).
{
  const page = await freshPage(1600, 900);
  const rect = await page.evaluate(() => {
    const r = document.querySelector("#minimap-canvas").getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const PAD = 18, PADB = 27, E = 15;
  const iw = rect.w - PAD - 8, ih = rect.h - PAD - PADB;
  const sx = Math.min(iw / 30, ih / 30);
  const x0 = PAD + (iw - 30 * sx) / 2, y0 = PAD + (ih - 30 * sx) / 2;
  const toPx = (p) => ({ x: rect.x + x0 + (p.x + E) * sx, y: rect.y + y0 + (E - p.y) * sx });

  await page.locator(SPAN).first().hover();
  await sleep(400);
  const preHover = await state(page);
  check("T3 parked on span pre-commit: look registered, ringless",
    preHover.look.id === "gd-step" && preHover.look.ring === false, preHover.look);

  const start = (await page.evaluate(() => window.__wp1.gd())).point;
  const sp = toPx(start);
  const t1 = toPx({ x: 2.3, y: -6.1 });
  await page.evaluate(([down, up]) => {
    const surf = document.querySelector("#minimap-canvas").parentElement;
    const ev = (type, at) =>
      surf.dispatchEvent(new PointerEvent(type, {
        clientX: at.x, clientY: at.y, button: 0, buttons: 1,
        pointerId: 7, pointerType: "mouse", isPrimary: true, bubbles: true,
      }));
    ev("pointerdown", down);
    ev("pointermove", { x: (down.x + up.x) / 2, y: (down.y + up.y) / 2 });
    ev("pointermove", up);
    ev("pointerup", up);
  }, [sp, t1]);
  await sleep(1200);
  const held = await state(page);
  check("T3 commit: gdTip set by commit", held.gd.gdTip !== null && held.gd.userTip !== null,
    { userTip: held.gd.userTip, gdTip: held.gd.gdTip });
  check("T3 hover held through commit: ring on", held.look.ring === true, held.look);
  check("T3 hover held through commit: scene dimmed", held.look.sceneDim === true, held.look);
  check("T3 hover held through commit: look id is gd-step", held.look.id === "gd-step", held.look.id);
  await page.screenshot({ path: join(OUT, "t3-hover-through-commit.png") });
  if (page._logs.length) check("T3 no page errors", false, page._logs.join("\n"));
  await page.close();
}

// T4 — plain post-commit hover: commit first (real pointer drag), leave, then
// hover the span — the payoff look must still work (no regression).
{
  const page = await freshPage(1600, 900);
  const rect = await page.evaluate(() => {
    const r = document.querySelector("#minimap-canvas").getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const PAD = 18, PADB = 27, E = 15;
  const iw = rect.w - PAD - 8, ih = rect.h - PAD - PADB;
  const sx = Math.min(iw / 30, ih / 30);
  const x0 = PAD + (iw - 30 * sx) / 2, y0 = PAD + (ih - 30 * sx) / 2;
  const toPx = (p) => ({ x: rect.x + x0 + (p.x + E) * sx, y: rect.y + y0 + (E - p.y) * sx });
  const start = (await page.evaluate(() => window.__wp1.gd())).point;
  const sp = toPx(start);
  const t1 = toPx({ x: 2.3, y: -6.1 });
  await page.mouse.move(sp.x, sp.y);
  await page.mouse.down();
  await page.mouse.move(t1.x, t1.y, { steps: 6 });
  await page.mouse.up();
  await sleep(1200);
  const committed = await state(page);
  check("T4 commit: gdTip set", committed.gd.gdTip !== null, committed.gd.gdTip);
  await page.locator(SPAN).first().hover();
  await sleep(700);
  const s = await state(page);
  check("T4 post-commit hover: ring on", s.look.ring === true, s.look);
  check("T4 post-commit hover: scene dimmed", s.look.sceneDim === true, s.look);
  check("T4 post-commit hover: look id is gd-step", s.look.id === "gd-step", s.look.id);
  await page.screenshot({ path: join(OUT, "t4-hover-postcommit.png") });
  if (page._logs.length) check("T4 no page errors", false, page._logs.join("\n"));
  await page.close();
}

console.log(fails === 0 ? "ALL CHECKS PASS" : `${fails} CHECK(S) FAILED`);
srv.close();
await browser.close();
process.exit(fails === 0 ? 0 : 1);
