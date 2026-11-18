/**
 * b1-state.mjs — BASELINE state probes for the copy/interaction findings
 * (COPY-LAB-DOCK, COPY-JUMP-LOCK, INT-1, RF-1). Run against the built dist.
 */
import { chromium } from "playwright";
import { launchGL } from "../tools/gl-launch.mjs";
import { sleep, shot, appState, waitIdle, OUT_DIR } from "./h.mjs";
import { resolve } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:4188";
const tag = process.argv[3] ?? "base";
const browser = await launchGL(chromium);

// ---- 1. COPY-LAB-DOCK: lab-1 copy says "dock (bottom-left)" but sliders live in the reader
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  await page.goto(`${BASE}/?step=13`, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
  await waitIdle(page);
  const r = await page.evaluate(() => {
    const sliders = document.querySelector("#lab-sliders");
    const checklist = document.querySelector("#lab-checklist");
    const reader = document.querySelector("#reader");
    const sr = sliders?.getBoundingClientRect();
    const rr = reader?.getBoundingClientRect();
    return {
      hasLabDock: !!document.querySelector("#lab-dock"),
      slidersInReaderStep: !!sliders?.closest(".rstep"),
      checklistInReaderStep: !!checklist?.closest(".rstep"),
      sliders: sr ? { x: Math.round(sr.x), y: Math.round(sr.y), w: Math.round(sr.width) } : null,
      readerX: rr ? Math.round(rr.x) : null,
      dockVisible: document.querySelector("#lab-dock")?.getAttribute("data-visible") ?? null,
    };
  });
  console.log(`[${tag}] LAB-DOCK:`, JSON.stringify(r));
  await shot(page, `${tag}-lab-1.png`);
  await page.close();
}

// ---- 2/3. COPY-JUMP-LOCK + INT-1: the fog-c empty-reveal jump button
{
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  await page.goto(`${BASE}/?step=17`, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));

  // 2. click DURING the entry lock: the button must not be a silent no-op.
  // Wait until locked (the fog-c reveal locks), then click early.
  await page.waitForFunction(() => window.__wp1?.locked() === true, { timeout: 10000 }).catch(() => {});
  const lockInfo = await page.evaluate(() => ({ locked: window.__wp1.locked(), step: window.__wp1.step(), scene: window.__wp1.scene() }));
  console.log(`[${tag}] JUMP-LOCK pre-click state:`, JSON.stringify(lockInfo));
  if (lockInfo.locked) {
    const btn = page.locator("#fog-goto-l2");
    const bb = await btn.boundingBox();
    if (bb) {
      await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
      await sleep(700);
      const mid = await page.evaluate(() => ({ step: window.__wp1.step(), scene: window.__wp1.scene(), locked: window.__wp1.locked() }));
      console.log(`[${tag}] JUMP-LOCK mid-lock click result:`, JSON.stringify(mid));
    } else {
      console.log(`[${tag}] JUMP-LOCK: #fog-goto-l2 has no box`);
    }
  }
  // let the lock drain naturally
  await waitIdle(page);
  const revealed = await page.evaluate(() => ({
    step: window.__wp1.step(),
    scene: window.__wp1.scene(),
    fog: (() => { const f = window.__wp1.fog(); return { used: f?.used, done: f?.done }; })(),
    emptyLeadVisible: !document.querySelector("#fog-empty-lead")?.hidden,
  }));
  console.log(`[${tag}] INT-1 at reveal:`, JSON.stringify(revealed));

  // 3. INT-1: click after the lock drains — where does it land?
  const btn = page.locator("#fog-goto-l2").first();
  if (!(await page.evaluate(() => document.querySelector("#fog-empty-lead")?.hidden))) {
    const bb = await btn.boundingBox();
    if (bb) {
      await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
      await sleep(1500);
      const after = await page.evaluate(() => {
        const f = window.__wp1.fog();
        return {
          step: window.__wp1.step(),
          scene: window.__wp1.scene(),
          fog: { used: f?.used, done: f?.done },
          finishHidden: document.querySelector("#fog-finish")?.hidden ?? null,
          fogCaption: document.querySelector("#fog-caption")?.textContent?.trim() ?? null,
        };
      });
      console.log(`[${tag}] INT-1 after unlocked click:`, JSON.stringify(after));
      await shot(page, `${tag}-fogjump-landing.png`);
    }
  }
  await page.close();
}

// ---- 4. RF-1: step 26 (epi-c) at 900×700 — tail unreachable
{
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  await page.goto(`${BASE}/?step=26`, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
  await waitIdle(page);
  const r = await page.evaluate(() => {
    const body = document.querySelector("#reader-body");
    const step = document.querySelectorAll(".rstep")[26];
    const lastText = step?.querySelector(".step__body")?.lastElementChild;
    const lr = lastText?.getBoundingClientRect();
    const foot = document.querySelector("#reader-foot")?.getBoundingClientRect();
    return {
      docScrollHeight: body?.scrollHeight,
      clientH: body?.clientHeight,
      scrollY: window.__wp1.scroll().y,
      max: window.__wp1.scroll().max,
      stepBottomDoc: step ? Math.round(step.offsetTop + step.offsetHeight) : null,
      lastTextBottomViewport: lr ? Math.round(lr.bottom) : null,
      footTop: foot ? Math.round(foot.top) : null,
    };
  });
  console.log(`[${tag}] RF-1 (epi-c @900x700):`, JSON.stringify(r));
  // wheel down hard: does the tail become reachable?
  for (let i = 0; i < 8; i++) {
    const b = await page.locator("#reader").boundingBox();
    await page.mouse.move(b.x + b.width * 0.55, b.y + b.height * 0.5);
    await page.mouse.wheel(0, 160);
    await sleep(90);
  }
  await sleep(800);
  const after = await page.evaluate(() => ({ y: Math.round(window.__wp1.scroll().y), max: window.__wp1.scroll().max, step: window.__wp1.step() }));
  console.log(`[${tag}] RF-1 after wheeling:`, JSON.stringify(after));
  await shot(page, `${tag}-rf1-epic-900x700.png`);
  await page.close();
}

// ---- 5. RF-2: hero docked at 900×700 — footer occludes the last caption line
{
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  await page.goto(`${BASE}/`, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
  await sleep(300);
  await page.keyboard.press("Space"); // dock the reader on step 0
  await sleep(1200);
  const r = await page.evaluate(() => {
    const foot = document.querySelector("#reader-foot")?.getBoundingClientRect();
    // bottom-most text line of the active step
    let lastBottom = 0;
    let lastText = "";
    for (const el of document.querySelectorAll('.rstep[data-active="true"] .step__body *')) {
      const b = el.getBoundingClientRect();
      if (b.height > 0 && b.bottom > lastBottom) { lastBottom = b.bottom; lastText = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(-60); }
    }
    return {
      step: window.__wp1.step(),
      footTop: foot ? Math.round(foot.top) : null,
      footH: foot ? Math.round(foot.height) : null,
      lastTextBottom: Math.round(lastBottom),
      lastText: lastText,
      overlapped: foot && lastBottom > foot.top,
    };
  });
  console.log(`[${tag}] RF-2 (hero docked @900x700):`, JSON.stringify(r));
  await shot(page, `${tag}-rf2-hero-900x700.png`);
  await page.close();
}

await browser.close();
console.log(`[${tag}] done — shots in ${OUT_DIR}`);
