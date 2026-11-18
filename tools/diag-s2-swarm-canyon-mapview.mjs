/**
 * diag-s2-swarm-canyon-mapview.mjs — Map-view variant stress for S2-SWARM-
 * PANEL-OCCLUDES-CANYON: the finding's f-blind-map repro at additional pane
 * sizes (1024x640 blind+Map is the worst case: tall panel, wide map).
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, extname, resolve } from "node:path";
import { launchGL } from "./gl-launch.mjs";

const DIST = join(process.cwd(), "dist");
const PORT = 4197;
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

const OUT = resolve("qa/S2-SWARM-PANEL-OCCLUDES-CANYON");
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await launchGL(chromium);
const errs = [];

const probe = (page) =>
  page.evaluate(() => {
    const s = window.__wp1.swarm();
    const box = s?.canyonScreenBox ?? null;
    const pr = s?.panelRect ?? null;
    const overlap =
      box && pr
        ? Math.max(0, Math.min(box.r, pr.r) - Math.max(box.l, pr.l)) *
          Math.max(0, Math.min(box.b, pr.b) - Math.max(box.t, pr.t))
        : null;
    return { overlap, nudge: s?.nudge, collapsed: s?.clustersCollapsed };
  });

for (const [w, h, blind] of [
  [1024, 640, true], [1024, 640, false], [1280, 720, true], [900, 620, true],
]) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    let page = null;
    try {
      console.log(`case ${w}x${h} blind=${blind} attempt ${attempt}`);
      page = await browser.newPage({ viewport: { width: w, height: h } });
      page.on("pageerror", (e) => errs.push(`PAGEERROR ${e.message}`));
      await page.goto(`http://localhost:${PORT}/?step=21`, { waitUntil: "load" });
      await page.waitForSelector("#swarm-blind", { state: "attached", timeout: 8000 });
      const mounted = await page.evaluate(() => document.querySelectorAll("#reader-body .rstep").length);
      if (!mounted) throw new Error(`boot failed: 0 rsteps (port squatted or GL dead)`);
      await sleep(1200);
      if (blind) {
        for (let k = 0; k < 5 && !(await page.evaluate(() => document.querySelector("#swarm-blind")?.checked)); k++) {
          await page.evaluate(() => document.querySelector("#swarm-blind")?.click());
          await sleep(400);
        }
      }
      await sleep(9500);
      await page.getByRole("button", { name: "Map view" }).click();
      await sleep(1500);
      const st = await probe(page);
      const bad = st.overlap === null || st.overlap > 0;
      console.log(
        `RESULT ${w}x${h} blind=${blind ? "Y" : "N"} Map  overlap=${st.overlap}  nudge=(${st.nudge?.x},${st.nudge?.y})  collapsed=${st.collapsed}${bad ? "   <-- OCCLUDED" : ""}`,
      );
      await page.screenshot({ path: join(OUT, `map-${w}x${h}-${blind ? "blind" : "normal"}.png`) });
      await page.close();
      break;
    } catch (e) {
      console.log(`case ${w}x${h} blind=${blind} attempt ${attempt} failed: ${String(e).slice(0, 120)}`);
      try {
        const dump = await page.evaluate(() => ({
          url: location.href,
          ready: document.readyState,
          title: document.title,
          boot: document.querySelector("#boot")?.textContent?.slice(0, 120) ?? null,
          bodyHead: document.body.innerText.slice(0, 200).replace(/\n+/g, " | "),
          rsteps: document.querySelectorAll("#reader-body .rstep").length,
          wp1: typeof window.__wp1,
        }));
        console.log("  page state:", JSON.stringify(dump));
        await page.screenshot({ path: join(OUT, `fail-${w}x${h}-${blind ? "blind" : "normal"}-${attempt}.png`) });
      } catch (e2) {
        console.log("  (page gone: " + String(e2).slice(0, 80) + ")");
      }
      await page.close().catch(() => {});
      if (attempt === 3) errs.push(`GAVE-UP ${w}x${h} blind=${blind}`);
    }
  }
}
console.log("errs", errs);
await browser.close();
srv.close();
process.exit(0);
