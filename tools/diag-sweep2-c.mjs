// Diagnostic (sweep-2 round 1): repro-level verification, part C —
// swarm framing / blind entry, §1 drag during rise, COV22-1 captions,
// gd-a spotlight ring. Usage: node tools/diag-sweep2-c.mjs [base]
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
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.goto(`${base}/${path}`, { waitUntil: "load" });
  await page.waitForFunction(() => { const b = document.querySelector("#boot"); return !b || b.dataset.done === "true"; }, null, { timeout: 15000 }).catch(() => {});
  await sleep(800);
  return page;
}
async function idle(page, ms = 14000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const a = await page.evaluate(() => window.__wp1.locked() || window.__wp1.animating());
    if (!a) break;
    await sleep(150);
  }
  await sleep(300);
}
const overlap = (a, b) => a && b && Math.min(a.r, b.r) - Math.max(a.l, b.l) > 0 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 0;

/* S2-SWARM-PANEL-OCCLUDES-CANYON */
for (const [w, h, map] of [[1024, 640, false], [1600, 900, false], [1600, 900, true], [1024, 640, true]]) {
  const page = await open("?step=21", w, h);
  await idle(page);
  if (map) {
    await page.click('.lv-btn[data-preset="map"]');
  }
  await sleep(11000);
  const st = await page.evaluate(() => window.__wp1.swarm());
  const readerL = await page.evaluate(() => document.querySelector("#reader").getBoundingClientRect().left);
  const cb = st.canyonScreenBox;
  const pr = st.panelRect;
  const inPane = cb && cb.l >= 0 && cb.r <= readerL && cb.t >= 0 && cb.b <= h;
  check(`SWARM-CANYON ${w}x${h}${map ? " map" : ""}: canyon clear of #tilt-panel and inside the pane`, !overlap(cb, pr) && inPane, JSON.stringify({ cb: cb && Object.fromEntries(Object.entries(cb).map(([k, v]) => [k, Math.round(v)])), panelBottom: Math.round(pr?.b), nudge: st.nudge, collapsed: st.clustersCollapsed }));
  await page.close();
}

/* S2-SWARM-BLIND-ENTRY-UNFOGGED: colored fraction through the crossfade */
{
  const page = await open("?step=21");
  await idle(page);
  await page.evaluate(() => { const t = document.querySelector("#swarm-blind"); t.checked = true; t.dispatchEvent(new Event("change", { bubbles: true })); });
  await sleep(300);
  await page.keyboard.press("ArrowUp");
  await sleep(2500);
  await idle(page);
  await page.keyboard.press("ArrowDown");
  const fr = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 2700) {
    const buf = await page.screenshot({ clip: { x: 0, y: 0, width: 1000, height: 900 } });
    const frac = await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = "data:image/png;base64," + b64;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = 250; c.height = 225;
      const x = c.getContext("2d");
      x.drawImage(img, 0, 0, 250, 225);
      const d = x.getImageData(0, 0, 250, 225).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
        if (mx - mn > 60 && mx > 90) n += 1;
      }
      return n / (250 * 225);
    }, buf.toString("base64"));
    fr.push([Date.now() - t0, +frac.toFixed(3)]);
  }
  // Samples before ~600ms are the OUTGOING (unfogged) tilt-b terrain fading
  // out; after that the incoming blind swarm terrain must stay dark (the
  // late growth is the balls' own paint).
  check("SWARM-BLIND-ENTRY: the incoming blind terrain never shows unfogged color", fr.filter(([t]) => t >= 600).every(([, f]) => f < 0.1) && fr.filter(([t]) => t >= 600 && t <= 2000).every(([, f]) => f < 0.01), JSON.stringify(fr));
  await page.close();
}

/* S1-DRAG-VS-TWEEN: drag the inset during task-b's entry tweens */
{
  const page = await open("?step=1", 1440, 900);
  await idle(page);
  await page.keyboard.press("ArrowDown");
  await sleep(300);
  const r = await page.locator("#fit-canvas").boundingBox();
  let grab = null;
  for (let fy = 0.05; fy <= 0.95 && !grab; fy += 0.02) {
    await page.mouse.move(r.x + r.width * 0.5, r.y + r.height * fy);
    if ((await page.evaluate(() => document.querySelector("#fit-canvas").style.cursor)) === "grab") grab = r.y + r.height * fy;
  }
  let followed = false;
  if (grab !== null) {
    await page.mouse.down();
    const samples = [];
    for (let i = 1; i <= 6; i++) {
      await page.mouse.move(r.x + r.width * 0.5, grab - i * 8);
      await sleep(60);
      samples.push(await page.evaluate(() => window.__wp1.fit().b));
    }
    await page.mouse.up();
    await sleep(1500);
    const final = await page.evaluate(() => window.__wp1.fit().b);
    followed = samples.every((v, i) => i === 0 || v >= samples[i - 1] - 1e-9) && Math.abs(final - samples[samples.length - 1]) < 1e-6;
    console.log("  samples", JSON.stringify(samples), "final", final);
  }
  check("S1-DRAG-VS-TWEEN: a drag during the entry tweens is never overwritten", grab !== null && followed);
  await page.close();
}

/* COV22-1 captions */
{
  const page = await open("?step=15");
  await idle(page);
  const a = await page.evaluate(() => ({ fit: document.querySelector("#fit-caption-act")?.textContent, fog: document.querySelector("#fog-caption")?.textContent }));
  const r = await page.locator("#fit-canvas").boundingBox();
  const f0 = await page.evaluate(() => window.__wp1.fog().point);
  let grabCursor = false;
  for (let fy = 0.05; fy <= 0.95; fy += 0.05) {
    await page.mouse.move(r.x + r.width * 0.5, r.y + r.height * fy);
    if ((await page.evaluate(() => document.querySelector("#fit-canvas").style.cursor)) === "grab") grabCursor = true;
  }
  check("COV22-1 fog-a: fit inset is read-only (no grab cursor) and says so", !grabCursor && a.fit === "tracks your current point", JSON.stringify(a));
  await page.evaluate(() => document.querySelector("#fog-finish").click());
  await sleep(500);
  const done = await page.evaluate(() => document.querySelector("#fog-caption")?.textContent);
  check("COV22-1 fog-a after Finish: fog caption reads read-only", /read-only/.test(done ?? ""), done);
  await page.close();
  const p3 = await open("?step=1");
  await idle(p3);
  const t = await p3.evaluate(() => document.querySelector("#fit-caption-act")?.textContent);
  check("COV22-1 §1: inset still says drag", t === "drag the line or its ends", t);
  await p3.close();
}

/* S2B26-GDA-RING-BURIED: hover "current point" on gd-a — ring stays lit */
{
  const page = await open("?step=4", 1500, 900);
  await idle(page);
  const pt = await page.evaluate(() => {
    const el = document.querySelector('.rstep[data-active="true"] [data-look="ball"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    for (const fy of [0.3, 0.5, 0.7]) for (const fx of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const x = r.left + r.width * fx, y = r.top + r.height * fy;
      const hit = document.elementFromPoint(x, y);
      if (hit && (hit === el || el.contains(hit))) return { x, y };
    }
    return { x: r.left + 4, y: r.top + r.height / 2 };
  });
  if (pt) {
    await page.mouse.move(400, 450);
    await sleep(200);
    await page.mouse.move(pt.x, pt.y);
    await sleep(2500);
    const look = await page.evaluate(() => window.__wp1.look());
    const b = await page.evaluate(() => window.__wp1.ballScreen());
    const clip = { x: Math.round(b.x - 60), y: Math.round(b.y - 60), width: 120, height: 120 };
    const on = (await page.screenshot({ clip })).toString("base64");
    await page.mouse.move(8, 8);
    await sleep(1300);
    const off = (await page.screenshot({ clip })).toString("base64");
    const bright = await page.evaluate(async ([a64, b64]) => {
      const load = async (s) => { const img = new Image(); img.src = "data:image/png;base64," + s; await img.decode(); const c = document.createElement("canvas"); c.width = 120; c.height = 120; const x = c.getContext("2d"); x.drawImage(img, 0, 0); return x.getImageData(0, 0, 120, 120).data; };
      const A = await load(a64), B = await load(b64);
      // ring pixels: brighter with the look ON than OFF, outside the ball
      let n = 0;
      for (let y = 0; y < 120; y++) for (let xx = 0; xx < 120; xx++) {
        const r = Math.hypot(xx - 60, y - 60);
        if (r < 16) continue;
        const i = (y * 120 + xx) * 4;
        if (A[i] + A[i + 1] + A[i + 2] - (B[i] + B[i + 1] + B[i + 2]) > 90) n += 1;
      }
      return n;
    }, [on, off]);
    check("GDA-RING-BURIED: the look ring around the drifting gd-a ball stays visible", look.ring === true && bright > 60, `ring=${look.ring} ringPx(on−off)=${bright}`);
  } else {
    check("GDA-RING-BURIED: look span found", false);
  }
  await page.close();
}

await browser.close();
console.log(fails === 0 ? "DIAG_C_OK" : `DIAG_C_FAILED (${fails})`);
