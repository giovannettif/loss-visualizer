/**
 * diag-s7-backnav-stale.mjs — S7-SW2-BACKNAV-STALE-STAMPS-TRAIL verification.
 *
 * Repro (from the finding): ?step=18 (tilt-a, valley), click canvas at
 * (700, 850), hold S 900 ms then D 700 ms, click 'Finish run · score',
 * advance to step 20 (tilt-b reveal), go back to step 19 (tilt-a).
 *
 * Pre-fix (BackupPlan1): the tilt-a branch of enterTiltState only called
 * clearTiltReveal() — the old run's stamp discs + live trail stayed (valley:
 * cells 1 / stamps 9; rosen: cells 1 / stamps 13), and tiltLiveBuilt kept the
 * old sample count so `run.rec.length - tiltLiveBuilt < 12` blocked the live
 * trail rebuild well into the new run.
 *
 * PASS here (post-fix tree): the back-nav tilt-a run is FRESH —
 *   D. landing:  steps=0, steered=false, cells=1, stamps<=1 (like Restart)
 *   E. 1 s play: stamps===cells (QA S7-1 invariant) with SMALL counts
 * Screenshots under qa/S7-TILT-BACKNAV/ give the visual record (old bug showed
 * the full old trail + 9-15 old discs beside the fresh ball).
 *
 * Read-only against src/ — serves the prebuilt dist/ on a private port.
 */

import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { join, extname, resolve } from "node:path";

const DIST = join(process.cwd(), "dist");
const PORT = 4212;
const OUT = resolve("qa", "S7-TILT-BACKNAV");
mkdirSync(OUT, { recursive: true });
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

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const raw = () => page.evaluate(() => window.__wp1.tilt());
const st = async () => {
  const t = await raw();
  return {
    step: await page.evaluate(() => window.__wp1.step()),
    scene: await page.evaluate(() => window.__wp1.scene()),
    level: t.level, done: t.done, steered: t.steered, steps: t.steps,
    cells: t.cells, stamps: t.stamps, ghost: t.ghost,
    pos: t.pos ? { x: +t.pos.x.toFixed(2), y: +t.pos.y.toFixed(2) } : null,
  };
};

async function waitIdle() {
  for (let i = 0; i < 60; i++) {
    const a = await page.evaluate(() => ({
      locked: window.__wp1.locked(), animating: window.__wp1.animating(),
    }));
    if (!a.locked && !a.animating) return true;
    await sleep(250);
  }
  return false;
}

async function shot(name) {
  const path = join(OUT, name);
  await page.screenshot({ path });
  return statSync(path).size / 1024;
}

/** Navigate one reader step with a key; poll, then fall back to the rail. */
async function gotoStep(delta, target, label) {
  const key = delta > 0 ? "ArrowDown" : "ArrowUp";
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press(key).catch(() => {});
    await sleep(500);
    await waitIdle();
    const s = await st();
    if (s.step === target) return { via: `${key} #${i + 1}`, s };
  }
  await page.evaluate((t) => {
    const rail = document.querySelectorAll("#rail button");
    rail[t]?.click();
  }, target);
  await sleep(600);
  await waitIdle();
  return { via: `rail[${target}] fallback`, s: await st() };
}

/** One full scenario at a level; mirrors the finding's repro. */
async function scenario(levelId, tag) {
  console.log(`\n=== scenario: ${tag} (${levelId}) ===`);
  await page.goto(`http://localhost:${PORT}/?step=18`, { waitUntil: "load" });
  await sleep(800);
  check(`${tag}: idle after boot`, await waitIdle());
  let s = await st();
  check(`${tag}: on step 18 tilt-a`, s.step === 18 && s.scene === "tilt-a", JSON.stringify(s));

  await page.mouse.click(700, 850);
  await sleep(400);
  s = await st();
  check(`${tag}: canvas click kept step 18`, s.step === 18, `step=${s.step}`);

  if (levelId !== "valley") {
    await page.click(`#tilt-levels button[data-level="${levelId}"]`);
    await sleep(800);
    s = await st();
    check(`${tag}: level picked`, s.level === levelId, `level=${s.level}`);
  }

  // Steer: S 900 ms, then D 700 ms (the finding's inputs).
  await page.keyboard.down("s");
  await sleep(900);
  await page.keyboard.up("s");
  await page.keyboard.down("d");
  await sleep(700);
  await page.keyboard.up("d");
  await sleep(300);
  s = await st();
  const played = s;
  check(`${tag}: run steered`, s.steered === true, JSON.stringify(s));
  check(`${tag}: played stamps track cells (QA S7-1)`, s.stamps === s.cells && s.cells > 1, `stamps=${s.stamps} cells=${s.cells}`);
  const N = s.stamps;

  await page.click("#tilt-finish");
  await sleep(400);
  s = await st();
  check(`${tag}: Finish ends the run`, s.done === true, JSON.stringify(s));

  // 18 -> 19 -> 20 (tilt-b), then back to 19 (tilt-a).
  const fwd1 = await gotoStep(+1, 19, "fwd1");
  console.log(`${tag}: 18->19 via ${fwd1.via}`);
  const fwd2 = await gotoStep(+1, 20, "fwd2");
  console.log(`${tag}: 19->20 via ${fwd2.via}`);
  s = await st();
  check(`${tag}: at tilt-b reveal`, s.step === 20 && s.scene === "tilt-b" && s.ghost === true, JSON.stringify(s));

  const back = await gotoStep(-1, 19, "back");
  console.log(`${tag}: 20->19 via ${back.via}`);
  s = await st();
  check(`${tag}: back on tilt-a`, s.step === 19 && s.scene === "tilt-a", JSON.stringify(s));

  // THE assertion: fresh run, no inherited discs.
  check(`${tag}: back-nav run is fresh (steps=0, unsteered)`, s.steps === 0 && s.steered === false, JSON.stringify(s));
  check(`${tag}: back-nav cells=1 (start cell)`, s.cells === 1, `cells=${s.cells}`);
  check(`${tag}: back-nav stamps<=1 (old run had ${N}) — S7-SW2-BACKNAV-STALE-STAMPS-TRAIL`, s.stamps <= 1, `stamps=${s.stamps}`);
  await shot(`${tag}-back-tilta.png`);

  // 1 s of play: stamps must track the FRESH run's cells, small counts.
  await page.keyboard.down("d");
  await sleep(1000);
  await page.keyboard.up("d");
  await sleep(300);
  s = await st();
  check(`${tag}: after 1 s play stamps track fresh cells (QA S7-1)`, s.stamps === s.cells, `stamps=${s.stamps} cells=${s.cells}`);
  // Pre-fix signature: stamps (old run's 10/15) >> cells (fresh 2/3) — a 5-8x
  // mismatch. A fresh run steered the same way covers similar ground, so the
  // absolute cell count is NOT a discriminator; the stamps===cells invariant
  // above is. Record the counts for the log only.
  console.log(`${tag}: fresh counts cells=${s.cells} stamps=${s.stamps} (played run had ${N} discs pre-fix alongside cells=1)`);
  await shot(`${tag}-back-tilta-played.png`);
  return played;
}

await scenario("valley", "valley");
await scenario("rosen", "rosen");

await browser.close();
srv.close();
console.log(failures === 0 ? "DIAG_S7_BACKNAV_OK" : `DIAG_S7_BACKNAV_FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
