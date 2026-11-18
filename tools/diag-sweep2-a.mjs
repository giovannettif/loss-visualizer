// Diagnostic (sweep-2 round 1): repro-level verification of the fix specs.
// Part A — layout, framing, §1–§5. Usage: node tools/diag-sweep2-a.mjs [base]
import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";
const base = process.argv[2] ?? "http://localhost:4185";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) fails += 1;
};
const browser = await launchGL(chromium);
async function open(path, w = 1600, h = 900) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(`${base}/${path}`, { waitUntil: "load" });
  await page.waitForFunction(() => { const b = document.querySelector("#boot"); return !b || b.dataset.done === "true"; }, null, { timeout: 15000 }).catch(() => {});
  await sleep(800);
  return page;
}
async function idle(page, ms = 12000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const a = await page.evaluate(() => window.__wp1.locked() || window.__wp1.animating());
    if (!a) break;
    await sleep(150);
  }
  await sleep(300);
}

/* S2-HERO-HUDLEFT-DEADZONE */
{
  const page = await open("");
  const hit = await page.evaluate(() => [document.elementFromPoint(100, 200)?.tagName, document.elementFromPoint(200, 400)?.tagName]);
  check("HUDLEFT: intro empty HUD column passes to the canvas", hit[0] === "CANVAS" && hit[1] === "CANVAS", JSON.stringify(hit));
  const bg = await page.evaluate(() => getComputedStyle(document.querySelector("#hero-overlay .kicker")).backgroundColor);
  check("EYEBROW: kicker has the dark pill", bg === "rgba(11, 13, 16, 0.7)", bg);
  await page.close();
}
/* fit drag still works in §1 inset */
{
  const page = await open("?step=1");
  await idle(page);
  const r = await page.locator("#fit-canvas").boundingBox();
  const f0 = await page.evaluate(() => window.__wp1.fit());
  // Find the fit line: scan a column for the grab cursor, then drag it.
  let moved = false;
  for (const fx of [0.5, 0.35, 0.65]) {
    for (let fy = 0.05; fy <= 0.95 && !moved; fy += 0.02) {
      await page.mouse.move(r.x + r.width * fx, r.y + r.height * fy);
      const cur = await page.evaluate(() => document.querySelector("#fit-canvas").style.cursor);
      if (cur !== "grab") continue;
      await page.mouse.down();
      await page.mouse.move(r.x + r.width * fx, r.y + r.height * fy - 30, { steps: 5 });
      await page.mouse.up();
      const f1 = await page.evaluate(() => window.__wp1.fit());
      moved = Math.abs(f1.w - f0.w) + Math.abs(f1.b - f0.b) > 1e-3;
    }
    if (moved) break;
  }
  check("HUDLEFT: §1 fit-line drag still works", moved);
  await page.close();
}
/* S2-HERO-RACE-CLIPPED-NARROW */
for (const [w, h] of [[1024, 768], [900, 700], [800, 600], [1600, 900]]) {
  const page = await open("", w, h);
  await page.keyboard.press("Space");
  await sleep(1800);
  let minX = Infinity, maxOver = -Infinity;
  let paneR = 0;
  for (let i = 0; i < 6; i++) {
    const p = await page.evaluate(() => window.__wp1.debug().viewPan);
    paneR = w - 2 * (await page.evaluate(() => window.__wp1.layout().frameX));
    minX = Math.min(minX, p.box.minX);
    maxOver = Math.max(maxOver, p.box.maxX - paneR);
    await sleep(1000);
  }
  check(`HERO-RACE ${w}x${h}: docked bowl inside the pane over 6s drift`, minX >= 12 - (w >= 1280 ? 999 : 0) && maxOver <= -12 + (w >= 1280 ? 999 : 0), `minX=${minX.toFixed(0)} maxX-paneR=${maxOver.toFixed(0)}`);
  await page.close();
}
/* S1 ball clear of HUD (task-c) + HUD stack */
for (const [w, h] of [[1280, 720], [1280, 800], [900, 700], [1366, 768], [1600, 900]]) {
  const page = await open("?step=3", w, h);
  await idle(page);
  await page.evaluate(() => window.__wp1.skip());
  await sleep(900);
  const r = await page.evaluate(() => {
    const b = window.__wp1.ballScreen();
    const el = b ? document.elementFromPoint(b.x, b.y) : null;
    const lv = document.querySelector("#loss-value").getBoundingClientRect();
    const lvTop = document.elementFromPoint(lv.left + lv.width / 2, lv.top + lv.height / 2);
    return { ball: b, hit: el?.tagName + "#" + (el?.id ?? ""), lossTop: lvTop?.id };
  });
  check(`S1 task-c ${w}x${h}: ball hit-tests to the canvas`, r.hit.startsWith("CANVAS"), JSON.stringify(r));
  check(`S1 HUD-STACK ${w}x${h}: loss value readable (not under the compass)`, r.lossTop === "loss-value", JSON.stringify(r.lossTop));
  await page.close();
}
/* S1-ADVANCE-SNAP + DRAG-VS-TWEEN */
{
  const page = await open("?step=1", 1440, 900);
  await idle(page);
  const b = await page.evaluate(() => window.__wp1.ballScreen());
  await page.mouse.move(b.x, b.y);
  await page.mouse.down();
  await page.mouse.move(b.x + 120, b.y - 60, { steps: 10 });
  await page.mouse.up();
  const hand = await page.evaluate(() => window.__wp1.fit());
  await page.keyboard.press("ArrowDown");
  const first = await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => res(window.__wp1.fit()))));
  check("S1-ADVANCE-SNAP: first post-advance frame keeps the hand fit", Math.abs(first.w - hand.w) < 0.05 && Math.abs(first.b - hand.b) < 0.05, `hand=${JSON.stringify(hand)} first=${JSON.stringify(first)}`);
  await page.close();
}
/* S2A-NARROW-FRAMING */
for (const [w, h] of [[1100, 800], [1000, 700], [1600, 900]]) {
  const page = await open("?step=5", w, h);
  await idle(page);
  const p = await page.evaluate(() => window.__wp1.debug().viewPan);
  const readerL = await page.evaluate(() => document.querySelector("#reader").getBoundingClientRect().left);
  check(`S2A-NARROW ${w}x${h}: gd-b terrain inside the pane`, p.box.minX >= 0 && p.box.maxX <= readerL + 1, `box=[${p.box.minX.toFixed(0)},${p.box.maxX.toFixed(0)}] reader=${readerL.toFixed(0)}`);
  await page.close();
}
/* MOM-B copy + MOM-APEX-RELIGHT-AFTER-SKIP */
{
  const page = await open("?step=9");
  await idle(page);
  const h2 = await page.evaluate(() => document.querySelector('.rstep[data-scene="mom-b"] h2').textContent);
  check("MOM-B-COPY: heading no longer pins 'Overshoot.'", h2 !== "Overshoot.", h2);
  await page.close();
  const p2 = await open("?step=8");
  await idle(p2);
  await p2.keyboard.press("ArrowDown");
  await sleep(150);
  await p2.evaluate(() => window.__wp1.skip());
  await sleep(1800); // the reader's scroll ease must settle (hover-to-look motion gate)
  const pre = await p2.evaluate(() => window.__wp1.mom());
  console.log("  mom state after skip:", JSON.stringify(pre).slice(0, 300));
  // hover the mom-apexes span
  const pt = await p2.evaluate(() => {
    const el = document.querySelector('.rstep[data-active="true"] [data-look="mom-apexes"]');
    const r = el.getBoundingClientRect();
    for (const fy of [0.15, 0.35, 0.55, 0.75, 0.95]) {
      for (const fx of [0.08, 0.3, 0.5, 0.7, 0.92]) {
        const x = r.left + r.width * fx, y = r.top + r.height * fy;
        const hit = document.elementFromPoint(x, y);
        if (hit && (hit === el || el.contains(hit))) return { x, y };
      }
    }
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await p2.mouse.move(400, 450);
  await sleep(200);
  await p2.mouse.move(pt.x, pt.y);
  await sleep(1000);
  const look = await p2.evaluate(() => window.__wp1.look());
  check("MOM-APEX-RELIGHT: hovering the span after Skip relights (scene dims + ring)", look.id === "mom-apexes" && look.sceneDim === true, JSON.stringify(look));
  await p2.close();
}
/* S2-ADAM-1/2 */
for (const sx of [false, true]) {
  const page = await open("?step=12");
  await idle(page);
  if (!sx) {
    // ×1: drag the steepness slider to its minimum
    await page.evaluate(() => { const s = document.querySelector("#steep-slider") ?? document.querySelector('.rstep[data-active="true"] input[type=range]'); if (s) { s.value = s.min; s.dispatchEvent(new Event("input", { bubbles: true })); } });
    await sleep(800);
  }
  const pt = await page.evaluate(() => window.__wp1.adam().point);
  await page.click("#play-btn");
  await sleep(50);
  await page.evaluate(() => document.querySelector("#replay-scrub") && (document.querySelector("#replay-scrub").value = "0", document.querySelector("#replay-scrub").dispatchEvent(new Event("input", { bubbles: true }))));
  await sleep(200);
  const ri = await page.evaluate(() => window.__wp1.replayInfo());
  const d0 = Math.hypot(ri.positions[0].x - pt.x, ri.positions[0].y - pt.y);
  const d1 = Math.hypot(ri.positions[1].x - pt.x, ri.positions[1].y - pt.y);
  check(`S2-ADAM-2 ${sx ? "×50" : "×min"}: both lanes start at the inspected point`, d0 < 1e-6 && d1 < 1e-6, `pt=${JSON.stringify(pt)} lanes=${JSON.stringify(ri.positions)}`);
  if (sx) {
    await page.evaluate(() => { const s = document.querySelector("#replay-scrub"); s.value = "1000"; s.dispatchEvent(new Event("input", { bubbles: true })); });
    await sleep(200);
    const end = await page.evaluate(() => window.__wp1.replayInfo());
    const gdEnd = end.positions[0];
    check("S2-ADAM-1 ×50: GD lane ends on the terrain rim (|x|,|y| ≤ 15)", Math.abs(gdEnd.x) <= 15 + 1e-6 && Math.abs(gdEnd.y) <= 15 + 1e-6, JSON.stringify(gdEnd));
  }
  await page.close();
}
/* SEC5 log toggle keeps replay; rebuild keeps camera; step-paced trail */
{
  const page = await open("?step=13");
  await idle(page);
  await page.click("#play-btn");
  await sleep(500);
  const a = await page.evaluate(() => window.__wp1.replayInfo());
  await page.evaluate(() => { const c = document.querySelector("#curves-log"); c.checked = !c.checked; c.dispatchEvent(new Event("change", { bubbles: true })); });
  await sleep(250);
  const b = await page.evaluate(() => window.__wp1.replayInfo());
  check("SEC5-LOGTOGGLE: replay survives the log toggle", b.lanes === 3 && b.playing === true && b.progress >= a.progress, `before=${a.lanes}/${a.playing}/${a.progress.toFixed(2)} after=${b.lanes}/${b.playing}/${b.progress.toFixed(2)}`);
  await sleep(9000);
  // camera keep across a rotation rebuild
  const c = await page.locator("canvas").first().boundingBox();
  await page.mouse.move(c.x + 400, c.y + 450);
  for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, -200); await sleep(120); }
  await sleep(900);
  const z0 = await page.evaluate(() => window.__wp1.debug().viewAttitude.zoomRadius);
  await page.focus("#rot-slider");
  await page.keyboard.press("ArrowRight");
  await sleep(700);
  const z1 = await page.evaluate(() => window.__wp1.debug().viewAttitude.zoomRadius);
  check("SEC5-REBUILD-RESETS-CAMERA: rotation rebuild keeps the user zoom", Math.abs(z1 - z0) < 1e-6, `z0=${z0} z1=${z1}`);
  await page.close();
}
/* S2CAM-HERO-POSE-LEAKS-INTO-S1 */
{
  const page = await open("");
  await page.keyboard.press("ArrowDown");
  await sleep(4000);
  await page.keyboard.press("ArrowDown");
  await sleep(2500);
  await idle(page);
  const a = await page.evaluate(() => window.__wp1.debug().viewAttitude);
  check("HERO-POSE: task-a lands at the isometric -60/35 after the hero drift", Math.abs(((a.azimuthDeg + 540) % 360) - 180 - -60) < 0.5 && Math.abs(a.elevationDeg - 35) < 0.5, `${a.azimuthDeg.toFixed(1)}/${a.elevationDeg.toFixed(1)}`);
  await page.close();
}
/* S2CAM-PRESET-DURING-TWEEN */
{
  const page = await open("?step=6");
  await idle(page);
  await page.keyboard.press("ArrowDown");
  await sleep(200);
  await page.click('.lv-btn[data-preset="map"]');
  await sleep(1500);
  const a = await page.evaluate(() => window.__wp1.debug().viewAttitude);
  const on = await page.evaluate(() => document.querySelector('.lv-btn[data-preset="map"]').dataset.active);
  check("PRESET-DURING-TWEEN: Map view wins over the step tween", Math.abs(a.elevationDeg - 90) < 0.5 && on === "true", `el=${a.elevationDeg.toFixed(1)} active=${on}`);
  await page.close();
}
/* S2CAM-PAN-BEHIND-HUD */
{
  const page = await open("?step=1");
  await idle(page);
  await page.mouse.move(700, 500);
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 300); await sleep(100); }
  await sleep(900);
  await page.mouse.move(700, 500);
  await page.mouse.down();
  await page.mouse.move(-200, -200, { steps: 20 });
  await page.mouse.up();
  await sleep(300);
  const p = await page.evaluate(() => window.__wp1.debug().viewPan);
  const hudR = await page.evaluate(() => document.querySelector("#fit-panel").getBoundingClientRect().right);
  check("PAN-BEHIND-HUD: a zoomed-out drag cannot park the box under the HUD column", p.box.minX >= hudR - 2, `box.minX=${p.box.minX.toFixed(0)} hudRight=${hudR.toFixed(0)}`);
  await page.close();
}
/* S2-FOOTER-REFLOW-WRAP */
for (const [w, h] of [[1600, 900], [1280, 720], [1024, 768]]) {
  const page = await open("?step=4", w, h);
  await idle(page);
  const idleH = await page.evaluate(() => document.querySelector("#reader-foot").getBoundingClientRect().height);
  await page.keyboard.press("ArrowDown");
  await sleep(350);
  const lockedH = await page.evaluate(() => ({ h: document.querySelector("#reader-foot").getBoundingClientRect().height, locked: window.__wp1.locked() }));
  await idle(page);
  const afterH = await page.evaluate(() => document.querySelector("#reader-foot").getBoundingClientRect().height);
  check(`FOOTER ${w}x${h}: footer height identical locked vs idle`, lockedH.locked && Math.abs(lockedH.h - afterH) < 0.5, `idle0=${idleH} locked=${lockedH.h} idle=${afterH}`);
  await page.close();
}
/* S2-SKIP-CROSSFADE-BLANK */
for (const [step, d] of [[7, 150], [3, 200], [12, 200], [20, 250]]) {
  const page = await open(`?step=${step}`, 1500, 900);
  await idle(page);
  await page.keyboard.press("ArrowDown");
  await sleep(d);
  await page.evaluate(() => window.__wp1.skip());
  await sleep(2500);
  const dbg = await page.evaluate(() => window.__wp1.debug());
  check(`SKIP-CROSSFADE ${step}+${d}ms: incoming terrain at rest (rise/opac > 0)`, dbg.rise > 0.01 && dbg.opac > 0.01 && dbg.swap === null, `rise=${dbg.rise} opac=${dbg.opac} swap=${dbg.swap}`);
  await page.close();
}

await browser.close();
console.log(fails === 0 ? "DIAG_A_OK" : `DIAG_A_FAILED (${fails})`);
