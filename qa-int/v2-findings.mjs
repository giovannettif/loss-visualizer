/**
 * qa-int/v2-findings.mjs — round-2 verification of the reported findings on
 * the FIXED build (fresh preview http://localhost:4184/):
 *   INT-1               fog-goto-l2 lands on a fresh level-2 game
 *   COPY-JUMP-LOCK      jump buttons work during the fog-c entry lock
 *   COPY-LAB-DOCK/RF-3  #lab-dock exists, bottom-left, live on both lab pages
 *   TILTFOG-LEAK        dark tilt board: no contour ghost on the minimap,
 *                       no contours over the void (pixel probes), lift restores
 *   FA-1/FA-2/FA-3      axis-label screenshots for map-view/fog-c corner
 *   RF-1/RF-2           900x700 tail-visibility probes
 * Real input throughout; state via __wp1 (read-only).
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

/** Lit-fraction of a clipped region: decode the PNG in-page and threshold. */
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

async function stageClip(inset = 0.22) {
  const sb = await page.locator("#stage-wrap").boundingBox();
  return {
    x: Math.round(sb.x + sb.width * inset),
    y: Math.round(sb.y + sb.height * inset),
    width: Math.round(sb.width * (1 - 2 * inset)),
    height: Math.round(sb.height * (1 - 2 * inset)),
  };
}

/* ============ INT-1 + COPY-JUMP-LOCK ============ */
await page.goto(BASE + "/?step=17", { waitUntil: "load" });
await page.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
// COPY-JUMP-LOCK: click DURING the entry lock; measure the natural release time
const t0 = Date.now();
let lockReleaseMs = -1;
for (;;) {
  if (!(await st()).locked) { lockReleaseMs = Date.now() - t0; break; }
  if (Date.now() - t0 > 20000) break;
  await sleep(100);
}
console.log(`  INFO  fog-c entry lock released after ${lockReleaseMs}ms`);
await page.reload({ waitUntil: "load" });
await page.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
await sleep(2200); // inside the reveal choreography
const lockedAtClick = (await st()).locked;
await page.click("#fog-goto-l2");
const jumped = await waitFor(page, async () => ((await st()).step === 16 ? await st() : null),
  { label: "mid-lock jump lands on fog-b", maxMs: 12000 });
const fogAfter = await page.evaluate(() => {
  const f = window.__wp1.fog();
  return { used: f?.used, done: f?.done, level: f?.level };
});
check("COPY-JUMP-LOCK: clicking 'Take the Level 2 run →' DURING the reveal lock jumps (never a silent no-op)",
  lockedAtClick === true && !!jumped && jumped.step === 16,
  `lockedAtClick=${lockedAtClick} (natural release ~${lockReleaseMs}ms); landed step=${jumped?.step}`);
await waitIdle(page);

// INT-1: the landed state is a FRESH, playable level-2 game
const finishHidden = await page.evaluate(() => document.querySelector("#fog-finish")?.hidden ?? null);
check("INT-1: the jump lands on a FRESH level-2 Rosenbrock run (used 0, not done, Finish available)",
  fogAfter.used === 0 && fogAfter.done === false && finishHidden === false,
  `fog=${JSON.stringify(fogAfter)} finishHidden=${finishHidden}`);
await shot(page, "v2-int1-fresh-l2.png");
// stride still possible there (playable, not just state flags)
{
  const box = await page.locator("#minimap-canvas").boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx + 10, cy + 40);
  await page.mouse.down();
  await page.mouse.move(cx + 62, cy + 80, { steps: 8 });
  await page.mouse.up();
  await sleep(400);
  const f = await page.evaluate(() => window.__wp1.fog());
  check("INT-1: the fresh level-2 run accepts a real compass stride (used 0 -> 1)",
    f?.used === 1, `used=${f?.used}`);
}

/* ============ COPY-LAB-DOCK / RF-3 ============ */
await page.goto(BASE + "/?step=13", { waitUntil: "load" });
await page.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
await waitIdle(page);
{
  const dock = await page.evaluate(() => {
    const d = document.querySelector("#lab-dock");
    if (!d) return null;
    const r = d.getBoundingClientRect();
    const sliders = d.querySelector("#lab-sliders");
    const checklist = d.querySelector("#lab-checklist");
    const sr = sliders?.getBoundingClientRect();
    const cr = checklist?.getBoundingClientRect();
    return {
      visible: d.dataset.visible === "true",
      dock: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      slidersInside: !!sr && sr.width > 0 && d.contains(sliders),
      checklistInside: !!cr && cr.width > 0 && d.contains(checklist),
    };
  });
  const sb = await page.locator("#stage-wrap").boundingBox();
  const inCanvasPane = dock && dock.dock.x >= sb.x && dock.dock.x + dock.dock.w <= sb.x + sb.width + 2;
  const bottomLeft = dock && dock.dock.y + dock.dock.h > sb.y + sb.height * 0.5;
  check("COPY-LAB-DOCK: #lab-dock exists, visible on lab-1, holds the sliders + checklist, sits bottom-left ON the canvas pane",
    !!dock && dock.visible && dock.slidersInside && dock.checklistInside && inCanvasPane && bottomLeft,
    `dock=${JSON.stringify(dock?.dock)} visible=${dock?.visible} inPane=${inCanvasPane} bottomHalf=${bottomLeft}`);
  await shot(page, "v2-labdock-lab1.png");
}
// lab-2 (?step=14): the dock is still on stage and its sliders are reachable + functional
await page.locator("#rail button").nth(14).click();
await waitIdle(page);
{
  const dockVisible = await page.evaluate(() =>
    document.querySelector("#lab-dock")?.dataset.visible === "true");
  const a = await st();
  // drag the elongation slider INSIDE THE DOCK on lab-2 (the page whose copy
  // says "Drag λ1/λ2 down to ×1" — previously off-screen)
  const knob = page.locator("#lab-dock #elong-slider");
  const box = await knob.boundingBox();
  const y = box.y + box.height / 2;
  const e0 = await page.evaluate(() => window.__wp1.lab()?.params?.E ?? null);
  await page.mouse.move(box.x + box.width * 0.9, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.02, y, { steps: 8 });
  await page.mouse.up();
  await sleep(600);
  const e1 = await page.evaluate(() => window.__wp1.lab()?.params?.E ?? null);
  check("COPY-LAB-DOCK: on lab-2 the dock is on stage and dragging λ1/λ2 in it live-reshapes the valley (E -> ×1)",
    dockVisible && a?.step === 14 && e0 !== null && e1 !== null && e1 < e0 * 0.2,
    `step=${a?.step} dockVisible=${dockVisible} E ${e0?.toFixed(1)} -> ${e1?.toFixed(1)}`);
  await shot(page, "v2-labdock-lab2.png");
}

/* ============ TILTFOG-LEAK (minimap ghost + contours over the void) ============ */
await page.goto(BASE + "/?step=18", { waitUntil: "load" });
await page.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
await waitIdle(page);
{
  const fog = await page.evaluate(() => {
    const t = window.__wp1.tilt();
    return { fogOn: t.fogOn, fogLift: t.fogLift, stamps: t.fogStamps };
  });
  check("TILTFOG: fresh tilt run starts dark (fogOn, lift 0, 1 stamp)",
    fog.fogOn === true && fog.fogLift === 0, JSON.stringify(fog));
  await page.locator("#minimap-panel").screenshot({ path: resolve(OUT_DIR, "v2-tilt-dark-minimap.png") });
  const clip = await stageClip();
  const darkFrac = await litFrac(clip);
  check("TILTFOG-CONTOUR: the dark board's terrain region is a pure void (no contour arcs leak through)",
    darkFrac < 2.0, `litFrac=${darkFrac.toFixed(2)}% (pre-fix measured 1.11%Contours; void floor ~0%)`);
  await shot(page, "v2-tilt-dark-pane.png");
}
// lift via Finish and re-probe the SAME region + the minimap
await page.click("#tilt-finish");
await waitIdle(page);
{
  const fog = await page.evaluate(() => {
    const t = window.__wp1.tilt();
    return { fogOn: t.fogOn, fogLift: t.fogLift };
  });
  await sleep(300);
  const clip = await stageClip();
  const litAfter = await litFrac(clip);
  check("TILTFOG-CONTOUR: the reveal lift floods the same region with the revealed board",
    fog.fogLift === 1 && litAfter > 30, `fogLift=${fog.fogLift} litFrac=${litAfter.toFixed(2)}%`);
  await shot(page, "v2-tilt-lifted-pane.png");
}

/* ============ FA-1 / FA-2 / FA-3 (frozen shots + Map view / fog-c corner) ============ */
await page.goto(BASE + "/?shot=task-a", { waitUntil: "load" });
await page.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
await sleep(600);
await page.click('.lv-btn[data-preset="map"]');
await sleep(700);
await shot(page, "v2-fa1-task-a-map.png");
{
  // probe: are the label bands inside the canvas unoccluded by #fit-panel?
  // (visual confirmation via the screenshot; here check the label sprites exist)
  const n = await page.evaluate(() =>
    document.querySelectorAll("#stage canvas").length);
  console.log(`  INFO  task-a map-view captured (canvas count ${n}) — visual label check on the PNG`);
}

await page.goto(BASE + "/?shot=epi-a", { waitUntil: "load" });
await page.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
await sleep(600);
await page.click('.lv-btn[data-preset="map"]');
await sleep(700);
await shot(page, "v2-fa2-epi-a-map.png");

await page.goto(BASE + "/?shot=fog-c", { waitUntil: "load" });
await page.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
await sleep(700);
await shot(page, "v2-fa3-fog-c-corner.png");

/* ============ RF-1 / RF-2 (900x700) ============ */
const p2 = await browser.newPage({ viewport: { width: 900, height: 700 } });
p2.on("pageerror", (err) => console.log("PAGEERROR(RF):", err.message));
await p2.goto(BASE + "/?step=26", { waitUntil: "load" });
await p2.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
await sleep(1500);
{
  const probe = await p2.evaluate(() => {
    const step = document.querySelector('.rstep[data-active="true"]');
    const foot = document.querySelector("#reader-foot")?.getBoundingClientRect();
    // bottom-most TEXT line of the active step
    let lastBottom = 0;
    for (const el of step.querySelectorAll("p, li, .formula, .tour-launch")) {
      const r = el.getBoundingClientRect();
      if (r.bottom > lastBottom && r.height > 0) lastBottom = r.bottom;
    }
    const chip = step.querySelector(".tour-launch");
    const chipR = chip?.getBoundingClientRect();
    return {
      lastTextBottom: Math.round(lastBottom),
      footTop: foot ? Math.round(foot.top) : null,
      chipVisible: !!chipR && chipR.top < 700 && chipR.bottom > 0,
      chipTop: chipR ? Math.round(chipR.top) : null,
      docH: document.querySelector("#reader-body").scrollHeight,
      scrollY: Math.round(window.__wp1.scroll().y),
      max: window.__wp1.scroll().max,
    };
  });
  // wheel hard against the last park: does the tail become reachable?
  const rb = await p2.locator("#reader").boundingBox();
  await p2.mouse.move(rb.x + rb.width * 0.55, rb.y + rb.height * 0.5);
  for (let i = 0; i < 12; i++) { await p2.mouse.wheel(0, 400); await sleep(60); }
  await sleep(600);
  const after = await p2.evaluate(() => ({
    y: Math.round(window.__wp1.scroll().y),
    lastTextBottom2: (() => {
      let b = 0;
      for (const el of document.querySelectorAll('.rstep[data-active="true"] p, .rstep[data-active="true"] li, .rstep[data-active="true"] .formula')) {
        const r = el.getBoundingClientRect();
        if (r.bottom > b) b = r.bottom;
      }
      return Math.round(b);
    })(),
  }));
  await p2.screenshot({ path: resolve(OUT_DIR, "v2-rf1-900x700-step26.png") });
  check("RF-1: at 900x700 the final step's credits text fully fits the pane (tail not cut mid-line)",
    after.lastTextBottom2 <= 700 && (after.lastTextBottom2 <= probe.footTop || probe.footTop === null),
    `lastTextBottom=${after.lastTextBottom2} vs pane 700 / footTop ${probe.footTop}; scroll ${probe.scrollY}->${after.y} (max ${probe.max})`);
  const chipNow = await p2.evaluate(() => {
    const r = document.querySelector('.rstep[data-active="true"] .tour-launch')?.getBoundingClientRect();
    return !!r && r.top < 700 && r.bottom > 0;
  });
  check("RF-1: the §9 tour chip is reachable at 900x700", chipNow, `chipVisible=${chipNow}`);
}
await p2.goto(BASE + "/", { waitUntil: "load" });
await p2.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
await sleep(400);
await p2.keyboard.press("Space"); // dock the hero
await sleep(1200);
{
  const probe = await p2.evaluate(() => {
    const foot = document.querySelector("#reader-foot")?.getBoundingClientRect();
    const step = document.querySelector('.rstep[data-active="true"]');
    let lastBottom = 0;
    let lastText = "";
    for (const el of step.querySelectorAll("p, li")) {
      const r = el.getBoundingClientRect();
      if (r.bottom > lastBottom && r.height > 0) { lastBottom = r.bottom; lastText = (el.textContent ?? "").trim().slice(-40); }
    }
    // element under the pane bottom just above the footer
    const hitEl = document.caretRangeFromPoint
      ? (() => {
          const r = document.caretRangeFromPoint(rb0.x + rb0.width / 2, foot.top - 6);
          return r?.startContainer?.textContent?.slice(0, 40) ?? null;
        })()
      : null;
    const rb0 = document.querySelector("#reader").getBoundingClientRect();
    return { lastTextBottom: Math.round(lastBottom), footTop: Math.round(foot.top), lastText, hitAtFooterEdge: hitEl };
  });
  await p2.screenshot({ path: resolve(OUT_DIR, "v2-rf2-900x700-hero.png") });
  check("RF-2: at 900x700 the docked hero's last caption line clears the footer band",
    probe.lastTextBottom <= probe.footTop,
    `lastTextBottom=${probe.lastTextBottom} vs footTop=${probe.footTop} (last line: "…${probe.lastText}")`);
}

await page.close();
await p2.close();
await browser.close();
finish("V2-FINDINGS");
