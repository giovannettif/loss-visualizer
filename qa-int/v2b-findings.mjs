/**
 * qa-int/v2b-findings.mjs — follow-up probes fixing v2 script issues:
 *  - lab dock drag on lab-2 (correct __wp1.lab() field path: flat E/rot)
 *  - TILTFOG contour probe with a ball-avoiding clip + Rosenbrock swap minimap
 *  - RF-2 hero/footer occlusion probe (fixed reference order)
 */
import { chromium } from "playwright";
import { launchGL } from "../tools/gl-launch.mjs";
import { check, finish, sleep, appState, waitIdle, waitFor, shot, OUT_DIR } from "./h.mjs";
import { resolve } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:4184";
const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
const st = () => appState(page);

async function litFrac(clip, thr = 40) {
  const b64 = (await page.screenshot({ clip, type: "png" })).toString("base64");
  return page.evaluate(async ({ b64, thr }) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    const n = c.width * c.height;
    for (let i = 0; i < n; i++) {
      const lum = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];
      if (lum > thr) lit++;
    }
    return (lit / n) * 100;
  }, { b64, thr });
}

/** Terrain-only region: the canvas element is FULL-VIEWPORT (1600x900) with
 *  the reader pane + HUD panels drawn OVER it — clip to the visible terrain
 *  band only (right of the tilt panel, left of the reader, above the minimap,
 *  clear of the ball's glow at the start pose). */
async function terrainClip() {
  const cb = await page.locator("canvas.lv-canvas").boundingBox();
  const reader = await page.locator("#reader").boundingBox();
  const x0 = Math.max(cb.x + 430, cb.x + cb.width * 0.28);
  const x1 = reader.x - 60;
  const y0 = cb.y + cb.height * 0.16;
  const y1 = cb.y + cb.height * 0.60;
  return {
    x: Math.round(x0),
    y: Math.round(y0),
    width: Math.round(x1 - x0),
    height: Math.round(y1 - y0),
  };
}

/* ---- COPY-LAB-DOCK part 2: lab-2 dock drag (correct field path) ---- */
await page.goto(BASE + "/?step=14", { waitUntil: "load" });
await page.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
await waitIdle(page);
{
  const dockVisible = await page.evaluate(() =>
    document.querySelector("#lab-dock")?.dataset.visible === "true");
  const e0 = await page.evaluate(() => window.__wp1.lab()?.E ?? null);
  const knobBox = await page.locator("#lab-dock #elong-slider").boundingBox();
  const y = knobBox.y + knobBox.height / 2;
  await page.mouse.move(knobBox.x + knobBox.width * 0.9, y);
  await page.mouse.down();
  await page.mouse.move(knobBox.x + knobBox.width * 0.02, y, { steps: 8 });
  await page.mouse.up();
  await sleep(900); // the rebuild is debounced to input-idle
  const e1 = await page.evaluate(() => window.__wp1.lab()?.E ?? null);
  const a = await st();
  check("COPY-LAB-DOCK/RF-3: on lab-2 the dock is on stage and dragging λ1/λ2 in it live-reshapes the valley (E -> ~×1)",
    dockVisible && a?.step === 14 && e0 !== null && e1 !== null && e1 < e0 * 0.2,
    `step=${a?.step} dockVisible=${dockVisible} E ${e0?.toFixed(1)} -> ${e1?.toFixed(1)}`);
}

/* ---- TILTFOG refined: dark void (ball-free clip) + Rosenbrock swap minimap ---- */
await page.goto(BASE + "/?step=18", { waitUntil: "load" });
await page.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
await waitIdle(page);
{
  const clip = await terrainClip();
  const darkFrac = await litFrac(clip);
  check("TILTFOG-CONTOUR: the dark board's terrain region (ball-free crop) is a pure void",
    darkFrac < 2.0, `litFrac=${darkFrac.toFixed(2)}% (round-1 buggy measure: 1.11% contours over the void floor)`);
}
// Rosenbrock level swap on a FRESH dark run: minimap must stay bare
await page.click('#tilt-levels button[data-level="rosen"]');
await sleep(1200);
{
  const fog = await page.evaluate(() => {
    const t = window.__wp1.tilt();
    return { fogOn: t.fogOn, fogLift: t.fogLift, stamps: t.fogStamps, level: t.level };
  });
  await page.locator("#minimap-panel").screenshot({ path: resolve(OUT_DIR, "v2-tilt-rosen-dark-minimap.png") });
  const clip = await terrainClip();
  const darkFracRosen = await litFrac(clip);
  check("TILTFOG: Rosenbrock swap re-arms the dark board (fogOn, 1 stamp) and its terrain stays a void",
    fog.fogOn === true && fog.fogLift === 0 && fog.stamps === 1 && darkFracRosen < 2.0,
    `fog=${JSON.stringify(fog)} litFrac=${darkFracRosen.toFixed(2)}%`);
}
// lift and re-probe the SAME region: the reveal must flood it
await page.click("#tilt-finish");
await waitIdle(page);
{
  const fog = await page.evaluate(() => {
    const t = window.__wp1.tilt();
    return { fogOn: t.fogOn, fogLift: t.fogLift };
  });
  await sleep(300);
  const clip = await terrainClip();
  const litAfter = await litFrac(clip);
  check("TILTFOG-CONTOUR: the lift floods the same terrain region (contours revealed with the map)",
    fog.fogLift === 1 && litAfter > 20, `fogLift=${fog.fogLift} litFrac=${litAfter.toFixed(2)}%`);
  await page.locator("#minimap-panel").screenshot({ path: resolve(OUT_DIR, "v2-tilt-rosen-lifted-minimap.png") });
}

/* ---- RF-2: 900x700 docked hero footer occlusion ---- */
const p2 = await browser.newPage({ viewport: { width: 900, height: 700 } });
p2.on("pageerror", (err) => console.log("PAGEERROR(RF):", err.message));
await p2.goto(BASE + "/", { waitUntil: "load" });
await p2.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
await sleep(500);
await p2.keyboard.press("Space"); // dock the hero
await sleep(1400);
{
  const probe = await p2.evaluate(() => {
    const rb0 = document.querySelector("#reader").getBoundingClientRect();
    const foot = document.querySelector("#reader-foot")?.getBoundingClientRect();
    const step = document.querySelector('.rstep[data-active="true"]');
    let lastBottom = 0;
    let lastText = "";
    for (const el of step.querySelectorAll("p, li")) {
      const r = el.getBoundingClientRect();
      if (r.bottom > lastBottom && r.height > 0) {
        lastBottom = r.bottom;
        lastText = (el.textContent ?? "").trim().slice(-40);
      }
    }
    const hitAtFooterEdge = document.caretRangeFromPoint
      ? (() => {
          const r = document.caretRangeFromPoint(rb0.x + rb0.width / 2, foot.top - 6);
          const t = r?.startContainer?.textContent ?? "";
          return { fromFooter: !!(r?.startContainer?.parentElement?.closest("#reader-foot")), text: t.slice(0, 40) };
        })()
      : null;
    return { lastTextBottom: Math.round(lastBottom), footTop: Math.round(foot.top), lastText, hitAtFooterEdge };
  });
  await p2.screenshot({ path: resolve(OUT_DIR, "v2-rf2-900x700-hero.png") });
  check("RF-2: at 900x700 the docked hero's last caption line clears the footer band (no overlay)",
    probe.lastTextBottom <= probe.footTop,
    `lastTextBottom=${probe.lastTextBottom} vs footTop=${probe.footTop} (last line: "…${probe.lastText}")`);
  console.log(`  INFO  caret at footer edge resolves to: ${JSON.stringify(probe.hitAtFooterEdge)}`);
}

await page.close();
p2.close().catch(() => {});
await browser.close();
finish("V2B-FINDINGS");
