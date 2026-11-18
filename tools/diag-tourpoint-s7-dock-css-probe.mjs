/**
 * diag-tourpoint-s7-dock-css-probe.mjs — validates the fix's CSS path for
 * TOUR-POINT-S7-BLINDTOGGLE-DOCK: with class "hud panel" + data-spot="true"
 * on #swarm-dock, does the shared spotlight glow (page.css .hud.panel[data-spot])
 * apply, and does the generic panel anchor land on the toggle row?
 * Runtime-only class/data mutation in the live page — src/ untouched.
 */
import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";

const DIST = join(process.cwd(), "dist");
const PORT = 4234;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const srv = createServer((req, res) => {
  let p = req.url.split("?")[0];
  if (p === "/" || p === "") p = "/index.html";
  const file = join(DIST, p);
  if (!existsSync(file)) { res.writeHead(404).end("no"); return; }
  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r, rej) => { srv.once("error", rej); srv.listen(PORT, () => r()); });

const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(`http://localhost:${PORT}/?step=21`, { waitUntil: "load" });
await new Promise((r) => setTimeout(r, 2200));

const out = await page.evaluate(async () => {
  const dock = document.querySelector("#swarm-dock");
  if (!dock) return { error: "no dock" };
  const before = getComputedStyle(dock).boxShadow;
  // The fix, applied at runtime: opt the dock into the panel machinery.
  dock.classList.add("panel");
  dock.dataset.spot = "true";
  const stage = document.querySelector("#stage-wrap");
  stage.setAttribute("data-scene-focus", "true");
  await new Promise((r) => setTimeout(r, 600)); // let the transition play
  const after = getComputedStyle(dock).boxShadow;
  const border = getComputedStyle(dock).borderColor;
  const r = dock.getBoundingClientRect();
  // The generic panel anchor (director.ts panelPoint): left + 0.42w, mid-height.
  const anchor = { x: Math.round(r.left + r.width * 0.42), y: Math.round(r.top + r.height / 2) };
  const blind = document.querySelector("#swarm-blind").getBoundingClientRect();
  const dToBlind = Math.round(Math.hypot(anchor.x - (blind.left + blind.width / 2), anchor.y - (blind.top + blind.height / 2)));
  return {
    boxShadowBefore: before, boxShadowAfter: after, borderColor: border,
    glowApplied: after !== before && after !== "none",
    anchor, blindRect: { x: Math.round(blind.left), y: Math.round(blind.top) },
    dToBlindCenter: dToBlind,
    visible: dock.dataset.visible,
  };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
srv.close();
console.log("DONE");
