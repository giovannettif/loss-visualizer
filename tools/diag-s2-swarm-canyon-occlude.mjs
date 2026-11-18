/**
 * diag-s2-swarm-canyon-occlude.mjs — S2-SWARM-PANEL-OCCLUDES-CANYON re-pro
 * on the CURRENT tree (which already carries computeSwarmNudge + the cluster
 * collapse fallback in director.ts, plus the canyonScreenBox/panelRect/nudge
 * diagnostics on __wp1.swarm()).
 *
 * Cases (the finding's repro, verbatim where it names one):
 *   A  1024x640  ?step=21  wait 11s                — k-1024x640-normal-end.png
 *   B  1600x900  ?step=21  blind ON, then Map view — f-blind-map.png
 *   C  1600x900  ?step=21  wait ~12s (iso control) — expected clean (canonical)
 *   D  1024x640  ?step=21  blind ON               — the h-1024x640 variant
 *
 * Per case: canyon∩panel overlap, applied nudge, clustersCollapsed, panel
 * rect, canyon screen box, pane rect. Read-only against src/ — serves dist/.
 */

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, extname, resolve } from "node:path";
import { launchGL } from "./gl-launch.mjs";

const DIST = join(process.cwd(), "dist");
const PORT = 4187;
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
console.log(`serving dist on :${PORT}`);

const OUT = resolve("qa/S2-SWARM-PANEL-OCCLUDES-CANYON");
mkdirSync(OUT, { recursive: true });

const browser = await launchGL(chromium);
const errs = [];

const probe = (page) =>
  page.evaluate(() => {
    const s = window.__wp1.swarm();
    const panel = document.querySelector("#tilt-panel");
    const r = panel?.getBoundingClientRect();
    const box = s?.canyonScreenBox ?? null;
    const pr = s?.panelRect ?? null;
    const overlap =
      box && pr
        ? Math.max(0, Math.min(box.r, pr.r) - Math.max(box.l, pr.l)) *
          Math.max(0, Math.min(box.b, pr.b) - Math.max(box.t, pr.t))
        : null;
    return {
      scene: window.__wp1.scene(),
      step: window.__wp1.step(),
      vp: `${innerWidth}x${innerHeight}`,
      animating: window.__wp1.animating(),
      locked: window.__wp1.locked(),
      swarm: s
        ? {
            playing: s.playing,
            time: +s.time.toFixed(2),
            settled: s.settled,
            blind: s.blind,
            arrived: s.arrived,
            minimaFound: s.minimaFound,
            nudge: s.nudge,
            clustersCollapsed: s.clustersCollapsed,
            canyonScreenBox: s.canyonScreenBox,
            panelRect: s.panelRect,
          }
        : null,
      overlap,
      panelMode: panel?.dataset.mode ?? null,
      panelClusters: panel?.dataset.clusters ?? "expanded(default)",
    };
  });

async function run(tag, vp, fn) {
  const page = await browser.newPage({ viewport: vp });
  page.on("pageerror", (e) => errs.push(`${tag} PAGEERROR ` + e.message));
  await page.goto(`http://localhost:${PORT}/?step=21`, { waitUntil: "load" });
  await fn(page);
  const st = await probe(page);
  console.log(`\n== ${tag} ==`);
  console.log(JSON.stringify(st, null, 1));
  await page.screenshot({ path: join(OUT, `${tag}.png`) });
  await page.close();
  return st;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A — the named repro: 1024x640, 11s.
await run("a-1024x640-11s", { width: 1024, height: 640 }, async (page) => {
  await sleep(11000);
});

// B — 1600x900 blind + Map view (p3.mjs recipe).
await run("b-1600x900-blind-map", { width: 1600, height: 900 }, async (page) => {
  await sleep(1200);
  await page.locator("#swarm-blind").click();
  await sleep(9500);
  await page.getByRole("button", { name: "Map view" }).click();
  await sleep(1500);
});

// C — 1600x900 normal iso control (canonical 21-swarm framing).
await run("c-1600x900-iso-12s", { width: 1600, height: 900 }, async (page) => {
  await sleep(12000);
});

// D — 1024x640 blind variant (the h-1024x640 shot).
await run("d-1024x640-blind", { width: 1024, height: 640 }, async (page) => {
  await sleep(1200);
  await page.locator("#swarm-blind").click();
  await sleep(9800);
});

console.log("\nerrs", errs);
await browser.close();
srv.close();
process.exit(0);
