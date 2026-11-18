/**
 * diag-s2-swarm-canyon-sweep.mjs — viewport sweep for S2-SWARM-PANEL-OCCLUDES-
 * CANYON: does computeSwarmNudge keep the canyon (0.7σ ellipse) clear of
 * #tilt-panel at every pane, and where it cannot, does the collapse fallback
 * fire? Normal and blind variants per viewport.
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, extname, resolve } from "node:path";
import { launchGL } from "./gl-launch.mjs";

const DIST = join(process.cwd(), "dist");
const PORT = 4188;
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
    return { overlap, nudge: s?.nudge, collapsed: s?.clustersCollapsed, panelRect: pr, canyon: box };
  });

const VPS = [
  [1024, 640], [1024, 600], [900, 620], [800, 600], [1280, 640], [1366, 700], [1024, 768], [1200, 800],
];

for (const [w, h] of VPS) {
  for (const blind of [false, true]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    page.on("pageerror", (e) => errs.push(`PAGEERROR ${e.message}`));
    await page.goto(`http://localhost:${PORT}/?step=21`, { waitUntil: "load" });
    await sleep(1200);
    if (blind) await page.locator("#swarm-blind").click();
    await sleep(9800);
    const st = await probe(page);
    const bad = st.overlap === null || st.overlap > 0;
    console.log(
      `${w}x${h} blind=${blind ? "Y" : "N"}  overlap=${st.overlap}  nudge=(${st.nudge?.x},${st.nudge?.y})  collapsed=${st.collapsed}${bad ? "   <-- OCCLUDED" : ""}`,
    );
    if (bad) await page.screenshot({ path: join(OUT, `sweep-${w}x${h}-${blind ? "blind" : "normal"}.png`) });
    await page.close();
  }
}
console.log("errs", errs);
await browser.close();
srv.close();
process.exit(0);
