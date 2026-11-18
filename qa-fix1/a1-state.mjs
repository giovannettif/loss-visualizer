/**
 * a1-state.mjs — FIX VERIFICATION for the round-1 state findings:
 * COPY-LAB-DOCK, COPY-JUMP-LOCK, INT-1, TILTFOG-* (state halves), RF-1, RF-2.
 */
import { chromium } from "playwright";
import { launchGL } from "../tools/gl-launch.mjs";
import { sleep, shot, appState, waitIdle, check, finish, OUT_DIR } from "./h.mjs";
import { resolve } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:4188";
const tag = process.argv[3] ?? "fix";
const browser = await launchGL(chromium);

// ---- 1. COPY-LAB-DOCK / FA-7 / RF-3
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  for (const step of [13, 14]) {
    await page.goto(`${BASE}/?step=${step}`, { waitUntil: "load" });
    await page.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
    await waitIdle(page);
    await sleep(400);
    const r = await page.evaluate(() => {
      const dock = document.querySelector("#lab-dock");
      const sliders = document.querySelector("#lab-sliders");
      const checklist = document.querySelector("#lab-checklist");
      const dr = dock?.getBoundingClientRect();
      const stage = document.querySelector("#stage-wrap")?.getBoundingClientRect();
      const mm = document.querySelector("#minimap-panel")?.getBoundingClientRect();
      const reader = document.querySelector("#reader")?.getBoundingClientRect();
      return {
        scene: window.__wp1.scene(),
        step: window.__wp1.step(),
        dockVisible: dock?.getAttribute("data-visible"),
        dockRect: dr ? { x: Math.round(dr.x), y: Math.round(dr.y), w: Math.round(dr.width), h: Math.round(dr.height) } : null,
        stageBottom: stage ? Math.round(stage.bottom) : null,
        slidersInDock: !!sliders?.closest("#lab-dock"),
        checklistInDock: !!checklist?.closest("#lab-dock"),
        slidersInRstep: !!document.querySelector(".rstep #lab-sliders"),
        compass: mm ? { x: Math.round(mm.x), y: Math.round(mm.y), right: Math.round(mm.right) } : null,
        compassTopRight: mm && reader ? mm.right <= reader.left && reader.left - mm.right <= 20 && mm.y < 100 : null,
        slidersOnScreen: sliders ? sliders.getBoundingClientRect().top < innerHeight && sliders.getBoundingClientRect().bottom > 0 : false,
      };
    });
    check(`lab-dock visible on lab page ${step}`, r.dockVisible === "true" && r.slidersInDock && r.checklistInDock && !r.slidersInRstep, JSON.stringify(r));
    check(`lab-dock bottom-left of the pane (page ${step})`, r.dockRect && r.stageBottom && Math.abs(r.dockRect.y + r.dockRect.h - r.stageBottom) < 40 && r.dockRect.x < 40, JSON.stringify(r.dockRect));
    check(`sliders on screen on lab page ${step}`, r.slidersOnScreen === true, JSON.stringify(r));
    check(`compass re-docked top-right on lab page ${step}`, r.compassTopRight === true, JSON.stringify(r.compass));
    await shot(page, `${tag}-lab-${step}.png`);
  }
  // and hidden off the lab scene
  await page.goto(`${BASE}/?step=11`, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
  await waitIdle(page);
  const hidden = await page.evaluate(() => document.querySelector("#lab-dock")?.getAttribute("data-visible"));
  check("lab-dock hidden off the lab scene", hidden === "false", `data-visible=${hidden}`);
  await page.close();
}

// ---- 2 + 3. COPY-JUMP-LOCK + INT-1
{
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  await page.goto(`${BASE}/?step=17`, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
  // wait for the mid-lock window where the button IS visible
  const clickedDuringLock = await page.evaluate(async () => {
    const t0 = Date.now();
    for (;;) {
      const b = document.querySelector("#fog-goto-l2");
      const vis = b && !b.closest("p")?.hidden && b.getBoundingClientRect().height > 0;
      if (vis && window.__wp1.locked()) {
        const bb = b.getBoundingClientRect();
        return { ok: true, x: bb.x + bb.width / 2, y: bb.y + bb.height / 2, locked: true };
      }
      if (!window.__wp1.locked() || Date.now() - t0 > 12000) return { ok: false, locked: window.__wp1.locked() };
      await new Promise((r) => setTimeout(r, 100));
    }
  });
  if (clickedDuringLock.ok) {
    await page.mouse.click(clickedDuringLock.x, clickedDuringLock.y);
    await sleep(1200);
    const mid = await page.evaluate(() => {
      const f = window.__wp1.fog();
      return { step: window.__wp1.step(), scene: window.__wp1.scene(), used: f?.used, done: f?.done, finishHidden: document.querySelector("#fog-finish")?.hidden };
    });
    check(
      "jump click DURING the entry lock navigates (no silent no-op)",
      mid.step === 16 && mid.scene === "fog-b",
      JSON.stringify(mid),
    );
    check(
      "the landed fog-b run is FRESH and playable (empty run not restored)",
      mid.used === 0 && mid.done === false && mid.finishHidden === false,
      JSON.stringify(mid),
    );
    await shot(page, `${tag}-fogjump-midlock-landing.png`);
  } else {
    check("jump button visible while locked (mid-lock window)", false, JSON.stringify(clickedDuringLock));
  }
  await page.close();
}

// ---- 3b. INT-1 via the unlocked path too (regression guard)
{
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  await page.goto(`${BASE}/?step=17`, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
  await waitIdle(page);
  await sleep(300);
  const bb = await page.locator("#fog-goto-l2").boundingBox().catch(() => null);
  if (bb) {
    await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await sleep(1200);
    const after = await page.evaluate(() => {
      const f = window.__wp1.fog();
      return { step: window.__wp1.step(), scene: window.__wp1.scene(), used: f?.used, done: f?.done, finishHidden: document.querySelector("#fog-finish")?.hidden };
    });
    check(
      "unlocked jump lands a fresh playable level-2 run",
      after.step === 16 && after.used === 0 && after.done === false && after.finishHidden === false,
      JSON.stringify(after),
    );
  } else {
    check("unlocked jump button present", false, "no box");
  }
  // wheel-back from fog-b to fog-a then forward: fog-a→fog-b stays a fresh game
  await page.close();
}

// ---- 4 + 5. TILTFOG minimap ghost + contour leak
{
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  await page.goto(`${BASE}/?step=18`, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
  await waitIdle(page);
  await sleep(600);
  const st = await page.evaluate(() => ({
    scene: window.__wp1.scene(),
    minimapFog: window.__wp1.debug().minimapFog,
    contourRevealK: window.__wp1.debug().contourRevealK,
    tilt: window.__wp1.tilt(),
  }));
  check("tilt dark board: compass in fog mode", st.minimapFog === true, JSON.stringify(st));
  check("tilt dark board: contourRevealK gated to 0", st.contourRevealK === 0, JSON.stringify(st));
  await shot(page, `${tag}-tilt-dark-full.png`);
  const mm = await page.locator("#minimap-panel").boundingBox();
  if (mm) await page.screenshot({ path: resolve(OUT_DIR, `${tag}-tilt-dark-minimap.png`), clip: mm });

  // contour-leak pixel probe over the same mid band as the baseline shot
  const probe = await page.evaluate(() => {
    const cv = document.querySelector("#stage canvas");
    if (!cv) return null;
    const w = cv.width, h = cv.height;
    const off = document.createElement("canvas");
    off.width = w; off.height = h;
    const g = off.getContext("2d");
    g.drawImage(cv, 0, 0);
    const img = g.getImageData(0, 0, w, h).data;
    let lit = 0, total = 0;
    for (let y = Math.floor(h * 0.1); y < Math.floor(h * 0.9); y += 2) {
      for (let x = Math.floor(w * 0.1); x < Math.floor(w * 0.55); x += 2) {
        const i = (y * w + x) * 4;
        const lum = 0.2126 * img[i] + 0.7152 * img[i + 1] + 0.0722 * img[i + 2];
        if (lum > 18) lit++;
        total++;
      }
    }
    return { litFracPct: +((lit / total) * 100).toFixed(2) };
  });
  check("tilt dark board: contour-dense region at the void floor (<0.5% lit)", probe !== null && probe.litFracPct < 0.5, JSON.stringify(probe));

  // level 2: re-arm on the swap
  await page.click('#tilt-levels button[data-level="rosen"]');
  await sleep(1000);
  const rosen = await page.evaluate(() => ({
    minimapFog: window.__wp1.debug().minimapFog,
    contourRevealK: window.__wp1.debug().contourRevealK,
  }));
  check("tilt rosen dark board: fog re-arms (compass blind, contours 0)", rosen.minimapFog === true && rosen.contourRevealK === 0, JSON.stringify(rosen));
  await shot(page, `${tag}-tilt-rosen-dark-full.png`);
  const mm2 = await page.locator("#minimap-panel").boundingBox();
  if (mm2) await page.screenshot({ path: resolve(OUT_DIR, `${tag}-tilt-rosen-dark-minimap.png`), clip: mm2 });

  // the reveal beat: Finish lifts everything
  const fin = await page.locator("#tilt-finish").boundingBox().catch(() => null);
  if (fin && !(await page.evaluate(() => document.querySelector("#tilt-finish")?.hidden))) {
    await page.mouse.click(fin.x + fin.width / 2, fin.y + fin.height / 2);
    await sleep(900);
    const lifted = await page.evaluate(() => ({
      minimapFog: window.__wp1.debug().minimapFog,
      contourRevealK: window.__wp1.debug().contourRevealK,
      done: window.__wp1.tilt().done,
    }));
    check("finish lifts the compass fog (ghost returns at the reveal)", lifted.minimapFog === false, JSON.stringify(lifted));
    check("finish restores contours to 1", lifted.contourRevealK === 1, JSON.stringify(lifted));
    await shot(page, `${tag}-tilt-rosen-lifted.png`);
  } else {
    check("finish button present on rosen board", false, "hidden or no box");
  }

  // no leak into the neighbours: walk to tilt-b then back to the lab scene? — tilt-b first
  await page.goto(`${BASE}/?step=20`, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
  await waitIdle(page);
  await sleep(400);
  const tb = await page.evaluate(() => ({
    scene: window.__wp1.scene(),
    minimapFog: window.__wp1.debug().minimapFog,
    contourRevealK: window.__wp1.debug().contourRevealK,
  }));
  check("tilt-b: compass fog torn down (map reads whole)", tb.minimapFog === false && tb.contourRevealK === 1, JSON.stringify(tb));
  await page.close();
}

// ---- RF-1: epi-c at 900×700
{
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  await page.goto(`${BASE}/?step=26`, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
  await waitIdle(page);
  await sleep(400);
  const r = await page.evaluate(() => {
    const body = document.querySelector("#reader-body");
    const step = document.querySelectorAll(".rstep")[26];
    const sr = step.getBoundingClientRect();
    const foot = document.querySelector("#reader-foot")?.getBoundingClientRect();
    const chip = step.querySelector(".tour-launch")?.getBoundingClientRect();
    // last text line bottom within the step
    let lastBottom = 0;
    for (const el of step.querySelectorAll(".step__body p, .step__body li")) {
      const b = el.getBoundingClientRect();
      if (b.bottom > lastBottom) lastBottom = b.bottom;
    }
    return {
      stepH: Math.round(sr.height),
      park: body.clientHeight,
      fits: sr.height <= body.clientHeight,
      lastTextBottom: Math.round(lastBottom),
      footTop: foot ? Math.round(foot.top) : null,
      tailClear: foot ? lastBottom <= foot.top : null,
      chipVisible: chip ? chip.top < 700 && chip.height > 0 : false,
      scroll: window.__wp1.scroll(),
    };
  });
  check("epi-c @900x700: step fits the park view", r.fits === true, JSON.stringify({ stepH: r.stepH, park: r.park }));
  check("epi-c @900x700: credits tail clears the footer", r.tailClear === true, JSON.stringify({ lastTextBottom: r.lastTextBottom, footTop: r.footTop }));
  check("epi-c @900x700: tour chip visible", r.chipVisible === true, JSON.stringify({}));
  // v5-LAST preserved: wheel past the park is a no-op
  const b = await page.locator("#reader").boundingBox();
  await page.mouse.move(b.x + b.width * 0.55, b.y + b.height * 0.5);
  for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, 160); await sleep(80); }
  await sleep(600);
  const after = await page.evaluate(() => ({ step: window.__wp1.step(), y: Math.round(window.__wp1.scroll().y), target: Math.round(window.__wp1.scroll().target), park: Math.round(window.__wp1.scroll().tops[26]) }));
  check("epi-c @900x700: forward wheel past the park stays parked (v5-LAST)", after.step === 26 && Math.abs(after.y - after.park) <= 2, JSON.stringify(after));
  await shot(page, `${tag}-rf1-epic-900x700.png`);
  await page.close();
}

// ---- RF-2: hero docked at 900×700
{
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  await page.goto(`${BASE}/`, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
  await sleep(300);
  await page.keyboard.press("Space");
  await sleep(1400);
  const r = await page.evaluate(() => {
    const foot = document.querySelector("#reader-foot")?.getBoundingClientRect();
    let lastBottom = 0;
    let lastText = "";
    for (const el of document.querySelectorAll('.rstep[data-active="true"] .step__body *')) {
      const b = el.getBoundingClientRect();
      if (b.height > 0 && b.bottom > lastBottom) { lastBottom = b.bottom; lastText = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(-50); }
    }
    return { step: window.__wp1.step(), footTop: foot ? Math.round(foot.top) : null, lastTextBottom: Math.round(lastBottom), lastText, clear: foot ? lastBottom <= foot.top : null };
  });
  check("hero docked @900x700: caption clears the footer", r.clear === true, JSON.stringify(r));
  await shot(page, `${tag}-rf2-hero-900x700.png`);
  await page.close();
}

await browser.close();
finish(`a1-state [${tag}]`);
