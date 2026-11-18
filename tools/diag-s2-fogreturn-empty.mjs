/**
 * diag-s2-fogreturn-empty.mjs — S2-FOG-RUN-LOST-ON-RETURN, the OTHER half of
 * the contract: a reader who genuinely scrolls through fog-b without drawing
 * a stride must STILL get the honest empty-run reveal ("you (no run) 0 4.84"
 * + the empty-run paragraphs). The fogRbResult restore must only kick in for
 * played runs, never fabricate one for a true skip.
 * Companion to diag-s2-fogreturn-repro.mjs. Serves the freshly built dist/.
 */

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, extname } from "node:path";
import { launchGL } from "./gl-launch.mjs";

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

await page.goto(`http://localhost:${PORT}/?step=16`, { waitUntil: "load" });
await idle(page);

// Scroll straight through fog-b without drawing anything → fog-c.
await gotoStep(page, 17, "wheel→fog-c (no strides drawn)");
const S = await page.evaluate(() => {
  const f = window.__wp1.fog();
  const rows = [...document.querySelectorAll("#fog-scorecard-body tr")].map((tr) =>
    [...tr.querySelectorAll("td")].map((td) => td.textContent.trim()),
  );
  const vis = (sel) => {
    const el = document.querySelector(sel);
    return el ? !el.hidden : null;
  };
  return {
    used: f?.used, ghosts: f?.ghosts, rows,
    verdict: document.querySelector("#fog-verdict")?.textContent ?? null,
    verdictHidden: document.querySelector("#fog-verdict")?.hidden ?? null,
    runLeadVisible: vis("#fog-run-lead"),
    emptyLeadVisible: vis("#fog-empty-lead"),
    trapNoteVisible: vis("#fog-trap-note"),
    emptyVerdictVisible: vis("#fog-empty-verdict-note"),
  };
});
await page.screenshot({ path: join(OUT, "05-fogc-genuine-skip.png") });

check("genuine skip: empty run graded honestly (used=0)", S.used === 0, `used=${S.used}`);
check("genuine skip: machine ghosts only (ghosts=3)", S.ghosts === 3, `ghosts=${S.ghosts}`);
check("genuine skip: scorecard row 1 is \"you (no run) 0 4.84\"",
  S.rows[0]?.join(" ") === "you (no run) 0 4.84", `row0="${S.rows[0]?.join(" ")}"`);
check("genuine skip: empty-run paragraphs shown",
  S.runLeadVisible === false && S.emptyLeadVisible === true &&
  S.trapNoteVisible === false && S.emptyVerdictVisible === true,
  `runLead=${S.runLeadVisible} emptyLead=${S.emptyLeadVisible} trapNote=${S.trapNoteVisible} emptyVerdict=${S.emptyVerdictVisible}`);
check("genuine skip: no verdict on the empty run (hidden — never the scolding line)",
  S.verdictHidden === true && !(S.verdict ?? "").startsWith("You never took a measurement"),
  `verdictHidden=${S.verdictHidden} verdict="${S.verdict}"`);

// And the empty run must still be restored as empty (not fabricated) when
// leaving to tilt-a and coming back.
await gotoStep(page, 18, "wheel→tilt-a");
await gotoStep(page, 17, "wheel→fog-c back (still empty)");
const S2 = await page.evaluate(() => {
  const f = window.__wp1.fog();
  const rows = [...document.querySelectorAll("#fog-scorecard-body tr")].map((tr) =>
    [...tr.querySelectorAll("td")].map((td) => td.textContent.trim()),
  );
  return { used: f?.used, ghosts: f?.ghosts, row0: rows[0]?.join(" ") };
});
check("genuine skip survives return: still used=0, \"you (no run)\"",
  S2.used === 0 && S2.row0 === "you (no run) 0 4.84", `used=${S2.used} row0="${S2.row0}"`);

console.log(fails === 0 ? "\nALL CHECKS PASSED" : `\n${fails} CHECK(S) FAILED`);
await browser.close();
srv.close();
process.exit(fails === 0 ? 0 : 1);
