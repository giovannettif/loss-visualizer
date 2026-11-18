/**
 * diag-s7-deadkey-verify.mjs — QA S7-RASTR-DEAD-KEY-DIAGONAL verification.
 *
 * The finding (diagnosed against a pre-fix working tree): the director
 * rotated the WASD tilt by the camera azimuth WITHOUT renormalizing, so near
 * diagonal azimuths a single key split into ~0.707/axis → 36·0.707 ≈ 25.5
 * < the ≈31.9 per-axis force a Rastrigin pit wall needs (gravity 0.5 ×
 * |∇f|max ≈ 63.8) — one key could never climb out of the start pit.
 *
 * The fix (src/scenes/tiltGame.ts tiltScreenToParam, wired at
 * src/scenes/director.ts tiltInputParam): rotate, then rescale so the
 * DOMINANT axis gets the full unit tilt.
 *
 * This harness re-runs the finding's repro against the BUILT dist:
 *   ?step=18 → '3 · Rastrigin' → right-drag orbit to azimuth ≈ −45° →
 *   ↻ Restart run → hold each of A/D/W/S for 5 s.
 * Expected after the fix: every sustained single-key press escapes the
 * start pit (−1, 2) — pre-fix, A pinned at ≤0.40 from the pit floor.
 * Azimuth is measured the way the finding measured it: from
 * __wp1.tilt().inputParam with A held (atan2 + 180°, wrapped).
 *
 * Read-only against src/ — serves the prebuilt dist/ on :4186.
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
let base = `http://localhost:${PORT}`;
try {
  await new Promise((r, rej) => {
    srv.once("error", rej);
    srv.listen(PORT, () => r());
  });
  console.log(`serving dist on :${PORT}`);
} catch {
  // Port already bound (another preview of this run). The finding's repro
  // names :4186 explicitly — reuse it only if it serves THIS dist (the
  // hashed bundle name must match).
  srv.close();
  const served = await fetch(`${base}/index.html`).then((r) => r.text());
  const servedMain = served.match(/assets\/(main-[A-Za-z0-9_-]+\.js)/)?.[1];
  const diskMain = readFileSync(join(DIST, "index.html"), "utf8")
    .match(/assets\/(main-[A-Za-z0-9_-]+\.js)/)?.[1];
  if (servedMain !== diskMain) {
    console.log(`FATAL: :${PORT} serves ${servedMain}, dist has ${diskMain} — refusing`);
    process.exit(2);
  }
  console.log(`:${PORT} already serving THIS dist (${servedMain}) — reusing`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const wrap180 = (d) => ((d + 180) % 360 + 360) % 360 - 180;
// The start pit floor: TILT_RASTR.start ≈ (−0.999, 1.986), lattice (−1, 2).
const PIT = { x: -1, y: 2 };
const pitDist = (p) => Math.hypot(p.x - PIT.x, p.y - PIT.y);
// Escaped = reached a NEIGHBORING pit floor (lattice spacing 1). The stuck
// pre-fix observation was ≤0.40; crossing the ridge is >0.5, the next floor
// is ≥1.0 (interpit).
const escaped = (p) => pitDist(p) > 1.0;

const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

const st = () =>
  page.evaluate(() => {
    const t = window.__wp1.tilt();
    return {
      step: window.__wp1.step(),
      scene: window.__wp1.scene(),
      pos: { x: +t.pos.x.toFixed(4), y: +t.pos.y.toFixed(4) },
      vel: t.vel,
      input: t.input,
      inputParam: { x: +t.inputParam.x.toFixed(4), y: +t.inputParam.y.toFixed(4) },
      steps: t.steps, done: t.done, level: t.level,
      friction: t.friction,
    };
  });

/* ---------------- boot ?step=18, switch to Rastrigin ---------------- */
await page.goto(`${base}/?step=18`, { waitUntil: "load" });
await page.waitForTimeout(800);
for (let i = 0; i < 40; i++) {
  const a = await page.evaluate(() => ({
    locked: window.__wp1.locked(), animating: window.__wp1.animating(),
  }));
  if (!a.locked && !a.animating) break;
  await sleep(250);
}
check("boot: scene is tilt-a live", (await page.evaluate(() => window.__wp1.scene())) === "tilt-a");
await page.click('#tilt-levels button[data-level="rastr"]');
await sleep(800);
const rastr0 = await st();
check("boot: Rastrigin level live at start pit",
  rastr0.level === "rastr" && pitDist(rastr0.pos) < 0.05,
  `pos=${JSON.stringify(rastr0.pos)} friction=${rastr0.friction}`);
check("boot: default friction is the finding's c=1.2", rastr0.friction === 1.2, `c=${rastr0.friction}`);

/* ---------------- right-drag the camera to azimuth ≈ −45° ----------------
 * No attitude hook is exposed, so orbit like a player (right-drag) and
 * measure the achieved azimuth the way the finding did: hold A, read
 * inputParam, az = atan2(ip.y, ip.x)+180 wrapped. Nudge until |az+45|≤0.6°. */

const canvas = await page.locator("#stage canvas");
const box = await canvas.boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;

async function measureAz() {
  await page.keyboard.down("a");
  await sleep(160);
  const t = await st();
  await page.keyboard.up("a");
  await sleep(120);
  const az = wrap180((Math.atan2(t.inputParam.y, t.inputParam.x) * 180) / Math.PI + 180);
  const dom = Math.max(Math.abs(t.inputParam.x), Math.abs(t.inputParam.y));
  return { az, dom, t };
}

async function rightDrag(dxTotal) {
  // Slow small steps keep the release flick (azimVel EMA) negligible; the
  // measure loop re-reads the achieved azimuth after the glide settles.
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: "right" });
  const steps = Math.max(2, Math.ceil(Math.abs(dxTotal) / 12));
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(cx + (dxTotal * i) / steps, cy, { steps: 1 });
    await sleep(25);
  }
  await page.mouse.up({ button: "right" });
  await sleep(900); // glide damping settles
}

const TARGET = -45;
const TOL = 0.6;
let m = await measureAz();
let degPerPx = 0.25; // first-guess kOrbit ≈ 0.005 rad/px
let calDrag = null;
for (let i = 0; i < 9 && Math.abs(wrap180(m.az - TARGET)) > TOL; i++) {
  const need = wrap180(TARGET - m.az); // + = need az to increase
  let dx = -need / degPerPx;
  if (Math.abs(dx) > 400) dx = Math.sign(dx) * 400;
  await rightDrag(dx);
  const m2 = await measureAz();
  const got = wrap180(m2.az - m.az);
  if (Math.abs(dx) > 5 && Math.abs(got) > 0.5) degPerPx = Math.abs(got / dx);
  m = m2;
  console.log(`  orbit try ${i + 1}: az=${m.az.toFixed(2)}° dom=${m.dom.toFixed(3)} (dragged ${dx.toFixed(0)}px, ${degPerPx.toFixed(3)}°/px)`);
}
check("orbit: camera azimuth within ±0.6° of −45 (finding: −44.9/−45.6)",
  Math.abs(wrap180(m.az - TARGET)) <= TOL, `az=${m.az.toFixed(2)}°`);
check("orbit: dominant axis carries the FULL unit tilt while A held (the fix, live)",
  Math.abs(m.dom - 1) < 1e-3, `dom=${m.dom.toFixed(4)} inputParam=${JSON.stringify(m.t.inputParam)}`);

const shotDir = resolve("qa", "sweep2-tilt-rastr-fix");
mkdirSync(shotDir, { recursive: true });

/* ---------------- the repro: Restart, hold each key 5 s ---------------- */
const KEYS = ["a", "d", "w", "s"];
let allEscaped = true;
for (let i = 0; i < KEYS.length; i++) {
  const key = KEYS[i];
  await page.click("#tilt-restart");
  await sleep(500);
  const r0 = await st();
  const fresh = r0.steps < 240 && pitDist(r0.pos) < 0.05;
  if (!fresh) { check(`key ${key.toUpperCase()}: Restart gives a fresh run at the pit`, false, JSON.stringify(r0.pos)); allEscaped = false; continue; }

  let minPitDist = Infinity;
  const samples = [];
  await page.keyboard.down(key);
  for (let s = 0; s < 5; s++) {
    await sleep(1000);
    const t = await st();
    minPitDist = Math.min(minPitDist, pitDist(t.pos));
    samples.push(`t+${s + 1}s (${t.pos.x.toFixed(2)},${t.pos.y.toFixed(2)})`);
  }
  await page.keyboard.up(key);
  await sleep(1000); // coast + damping settle
  const fin = await st();
  const d = pitDist(fin.pos);
  const ok = escaped(fin.pos) || d > 1.0;
  allEscaped &&= ok;
  check(
    `key ${key.toUpperCase()} @ az ${m.az.toFixed(1)}°: 5 s hold ESCAPES the (−1,2) pit`,
    ok,
    `final=(${fin.pos.x.toFixed(3)}, ${fin.pos.y.toFixed(3)}) pitDist=${d.toFixed(3)} minDuring=${minPitDist.toFixed(3)} ip=(${fin.inputParam.x.toFixed(2)},${fin.inputParam.y.toFixed(2)}) [${samples.join("; ")}]`,
  );
  await page.screenshot({ path: join(shotDir, `0${i + 1}-az45-${key}-held5s.png`) });
}

console.log("----");
console.log(allEscaped && failures === 0 ? "RESULT: PASS — every key escapes at the diagonal azimuth" : `RESULT: FAIL (${failures} failing checks)`);
await browser.close();
srv.close();
process.exit(failures === 0 ? 0 : 1);
