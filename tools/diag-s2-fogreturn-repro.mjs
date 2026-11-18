/**
 * diag-s2-fogreturn-repro.mjs — S2-FOG-RUN-LOST-ON-RETURN verification.
 *
 * Replays the finding's repro at its stated scale (dist on :4184, 1600x900):
 *   1. ?step=16 (fog-b), draw 2 strides aimed at (-0.57, 0.43) then (0, 0)
 *      (each clamps to the 0.905 stride ring → lands near the trap, L ≈ 1.3-1.4).
 *   2. Click "Finish run · reveal", wheel into fog-c (step 17) — the FIRST
 *      reveal visit must show "you (manual run) 2 …" with the white ghost.
 *   3. Wheel forward into tilt-a (step 18), then back into fog-c by WHEEL
 *      (the finding's probe3) — expect used=2, done, ghosts=4 (white lane +
 *      3 machines), "you (manual run)", played-run paragraphs.
 *   4. Forward again, then back by RAIL BUTTON 17 (the finding's probe12) —
 *      same expectations.
 * The broken state this finding shipped with: used=0, ghosts=3 (no white
 * lane), "you (no run) 0 4.84", the empty-run paragraphs + "You never took
 * a measurement" verdict.
 *
 * Read-only against src/ — serves the freshly built dist/.
 */

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, extname } from "node:path";
import { launchGL } from "./gl-launch.mjs";

const DIST = join(process.cwd(), "dist");
const PORT = 4184;
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

const OUT = join(process.cwd(), "shots", "_diag_fogreturn");
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fails = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) fails++;
}

const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

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

/** Wheel (over the reader text column) until step() === target. One boundary
 *  crossing per gesture (QA KW-8), so tick → sleep → re-poll in a loop. */
async function gotoStep(page, target, tag) {
  const body = await page.evaluate(() => {
    const r = document.querySelector("#reader-body").getBoundingClientRect();
    return { x: r.left + 80, y: Math.min(r.top + r.height / 2, 700) };
  });
  await page.mouse.move(body.x, body.y);
  for (let i = 0; i < 14; i++) {
    const cur = await page.evaluate(() => window.__wp1.step());
    if (cur === target) break;
    await page.mouse.wheel(0, target > cur ? 300 : -300);
    await sleep(320);
  }
  await idle(page);
  const cur = await page.evaluate(() => ({
    step: window.__wp1.step(),
    scene: window.__wp1.scene(),
  }));
  console.log(`  [${tag}] step=${cur.step} scene=${cur.scene}`);
  return cur;
}

/** Minimap pixel for a parameter point — replicates CompassMinimap's plane
 *  (PAD 18 left/top, 8 right, PAD_BOTTOM 27; equal aspect; extent [-2,2]x[-1,3]). */
async function aimPixel(page, p) {
  return page.evaluate(([px, py]) => {
    const c = document.querySelector("#minimap-canvas");
    const r = c.getBoundingClientRect();
    const iw = r.width - 26, ih = r.height - 45;
    const s = Math.min(iw / 4, ih / 4);
    const x0 = 18 + (iw - 4 * s) / 2;
    const y0 = 18 + (ih - 4 * s) / 2;
    return { x: r.left + x0 + (px + 2) * s, y: r.top + y0 + (3 - py) * s };
  }, [p.x, p.y]);
}

async function stride(page, tip) {
  const fog = await page.evaluate(() => window.__wp1.fog());
  const from = await aimPixel(page, fog.point);
  const to = await aimPixel(page, tip);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
  await sleep(700);
  await idle(page);
  return page.evaluate(() => window.__wp1.fog());
}

/** Everything the finding quotes, in one snapshot. */
async function fogRevealState(page) {
  return page.evaluate(() => {
    const f = window.__wp1.fog();
    const rows = [...document.querySelectorAll("#fog-scorecard-body tr")].map((tr) =>
      [...tr.querySelectorAll("td")].map((td) => td.textContent.trim()),
    );
    const vis = (sel) => {
      const el = document.querySelector(sel);
      return el ? !el.hidden : null;
    };
    return {
      used: f?.used, done: f?.done, ghosts: f?.ghosts,
      point: f?.point, pathLen: f?.pathLen, path: f?.path,
      rows,
      verdict: document.querySelector("#fog-verdict")?.textContent ?? null,
      runLeadVisible: vis("#fog-run-lead"),
      emptyLeadVisible: vis("#fog-empty-lead"),
      trapNoteVisible: vis("#fog-trap-note"),
      emptyVerdictVisible: vis("#fog-empty-verdict-note"),
    };
  });
}

/* ---- 1. play fog-b: two strides toward the trap ---- */
await page.goto(`http://localhost:${PORT}/?step=16`, { waitUntil: "load" });
await idle(page);
{
  const s = await page.evaluate(() => ({ step: window.__wp1.step(), scene: window.__wp1.scene() }));
  check("boot: ?step=16 lands on fog-b", s.step === 16 && s.scene === "fog-b", `step=${s.step} scene=${s.scene}`);
}
let f = await stride(page, { x: -0.57, y: 0.43 });
console.log(`  stride 1 → used=${f.used} point=(${f.point.x.toFixed(2)},${f.point.y.toFixed(2)})`);
f = await stride(page, { x: 0, y: 0 });
console.log(`  stride 2 → used=${f.used} point=(${f.point.x.toFixed(2)},${f.point.y.toFixed(2)})`);
check("fog-b: two strides committed (used=2)", f?.used === 2, `used=${f?.used}`);

/* ---- 2. finish, first fog-c visit ---- */
await page.click("#fog-finish");
await sleep(2200); // fogrev tween 1.6s
await gotoStep(page, 17, "wheel→fog-c(1st)");
const A = await fogRevealState(page);
await page.screenshot({ path: join(OUT, "01-fogc-first.png") });
console.log(`  1st reveal: rows=${JSON.stringify(A.rows)} ghosts=${A.ghosts} used=${A.used}`);

/* ---- 3. leave by wheel to tilt-a, return by wheel ---- */
await gotoStep(page, 18, "wheel→tilt-a");
const T = await page.evaluate(() => window.__wp1.fog());
await page.screenshot({ path: join(OUT, "02-tilta.png") });
check("tilt-a: fog stage cleared (fog() null)", T === null, `fog=${JSON.stringify(T)}`);

await gotoStep(page, 17, "wheel→fog-c(back by wheel)");
const B1 = await fogRevealState(page);
await page.screenshot({ path: join(OUT, "03-fogc-after-wheel-back.png") });

/* ---- 4. leave again, return by rail button 17 ---- */
await gotoStep(page, 18, "wheel→tilt-a(2nd)");
await page.locator("#rail button").nth(17).click();
await idle(page);
{
  const s = await page.evaluate(() => ({ step: window.__wp1.step(), scene: window.__wp1.scene() }));
  check("rail 17 lands on fog-c", s.step === 17 && s.scene === "fog-c", `step=${s.step} scene=${s.scene}`);
}
const B2 = await fogRevealState(page);
await page.screenshot({ path: join(OUT, "04-fogc-after-rail-back.png") });

/* ---- assertions ---- */
const played = (tag, S) => {
  const row0 = S.rows[0]?.join(" ") ?? "none";
  check(`${tag}: run kept (used=2, done, same end point)`,
    S.used === 2 && S.done === true &&
    Math.abs(S.point.x - A.point.x) < 1e-9 && Math.abs(S.point.y - A.point.y) < 1e-9,
    `used=${S.used} done=${S.done} point=(${S.point?.x?.toFixed(3)},${S.point?.y?.toFixed(3)}) vs A=(${A.point?.x?.toFixed(3)},${A.point?.y?.toFixed(3)})`);
  check(`${tag}: white ghost lane present (ghosts=4)`, S.ghosts === 4, `ghosts=${S.ghosts}`);
  check(`${tag}: scorecard row 1 is "you (manual run) 2 …"`,
    row0.startsWith("you (manual run)") && S.rows[0]?.[1] === "2", `row0="${row0}"`);
  check(`${tag}: played-run paragraphs, not empty-run copy`,
    S.runLeadVisible === true && S.emptyLeadVisible === false &&
    S.trapNoteVisible === true && S.emptyVerdictVisible === false,
    `runLead=${S.runLeadVisible} emptyLead=${S.emptyLeadVisible} trapNote=${S.trapNoteVisible} emptyVerdict=${S.emptyVerdictVisible}`);
  check(`${tag}: verdict is not "You never took a measurement"`,
    !(S.verdict ?? "").startsWith("You never took a measurement"), `verdict="${S.verdict}"`);
};
played("1st visit", A);
played("wheel return", B1);
played("rail return", B2);
check("first visit already showed the played run (baseline sanity)", A.rows[0]?.[0] === "you (manual run)", `rows=${JSON.stringify(A.rows)}`);

console.log(fails === 0 ? "\nALL CHECKS PASSED" : `\n${fails} CHECK(S) FAILED`);
await browser.close();
srv.close();
process.exit(fails === 0 ? 0 : 1);
