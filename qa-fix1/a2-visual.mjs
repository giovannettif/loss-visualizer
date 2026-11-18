/**
 * a2-visual.mjs — FIX VERIFICATION for the visual findings: FA-1 (task-a map
 * fit panel vs b-labels), FA-2 (epi-a map bottom labels), FA-3 (fog-c corner
 * garble), and zoomed crops of the tilt board (contours/compass).
 */
import { chromium } from "playwright";
import { launchGL } from "../tools/gl-launch.mjs";
import { sleep, shot, OUT_DIR } from "./h.mjs";
import { resolve } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:4188";
const tag = process.argv[3] ?? "fix";
const browser = await launchGL(chromium);

async function mapShot(page, url, name, vp = { width: 1280, height: 800 }) {
  await page.setViewportSize(vp);
  await page.goto(`${BASE}${url}`, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
  await sleep(900);
  await shot(page, `${tag}-${name}-iso.png`);
  const mapBtn = page.locator(".lv-controls button", { hasText: "Map view" });
  if (await mapBtn.count()) {
    await mapBtn.first().click();
    await sleep(900);
    await shot(page, `${tag}-${name}-map.png`);
    const st = await page.evaluate(() => {
      const d = window.__wp1.debug();
      return { elev: d.viewAttitude.elevationDeg, zoom: d.viewAttitude.zoomRadius, minimapFog: d.minimapFog };
    });
    console.log(`[${tag}] ${name} map state:`, JSON.stringify(st));
  }
}

// FA-1: task-a Map view — b-labels must clear the fit panel now.
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  await mapShot(page, "/?shot=task-a", "task-a");
  // crop the strip right of the fit panel where the b labels should sit
  const panel = await page.locator("#fit-panel").boundingBox();
  if (panel) {
    await page.screenshot({
      path: resolve(OUT_DIR, `${tag}-task-a-map-leftstrip.png`),
      clip: { x: panel.x + panel.width - 20, y: panel.y, width: 260, height: panel.height + 40 },
    });
  }
  await page.close();
}

// FA-2: epi-a Map view at the finding's 900px-tall conditions and 1280x800
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  await mapShot(page, "/?shot=epi-a", "epi-a", { width: 1600, height: 900 });
  const stage = await page.locator("#stage-wrap").boundingBox();
  if (stage) {
    await page.screenshot({
      path: resolve(OUT_DIR, `${tag}-epi-a-map-bottom.png`),
      clip: { x: stage.x, y: stage.y + stage.height - 120, width: Math.min(stage.width, 900), height: 120 },
    });
  }
  await page.close();
}

// FA-3: fog-c reveal corner
{
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  await page.goto(`${BASE}/?shot=fog-c`, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
  await sleep(900);
  await shot(page, `${tag}-fog-c-reveal.png`);
  // zoom into the shared near corner (bottom-center of the pane)
  await page.screenshot({
    path: resolve(OUT_DIR, `${tag}-fog-c-corner.png`),
    clip: { x: 300, y: 560, width: 500, height: 260 },
  });
  await page.close();
}

await browser.close();
console.log(`[${tag}] visual verification done — shots in ${OUT_DIR}`);
