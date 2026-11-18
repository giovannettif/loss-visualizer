import { chromium } from "playwright";
import { launchGL } from "./tools/gl-launch.mjs";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
const DIST = join(process.cwd(), "dist");
const PORT = 4220;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff" };
const srv = createServer((req, res) => {
  let p = req.url.split("?")[0];
  if (p === "/" || p === "") p = "/index.html";
  const file = join(DIST, p);
  if (!existsSync(file)) { res.writeHead(404).end("no"); return; }
  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => srv.listen(PORT, () => r(srv)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(`http://localhost:${PORT}/?step=2`, { waitUntil: "load" });
await sleep(1500);
for (;;) {
  const a = await page.evaluate(() => ({ l: window.__wp1?.locked?.(), an: window.__wp1?.animating?.() }));
  if (!a.l && !a.an) break;
  await sleep(200);
}
await page.hover('.rstep[data-active="true"] .sent[data-slook="needle"]');
await sleep(600);
const out = await page.evaluate(() => {
  const cv = document.querySelector("#minimap-canvas");
  const r = cv.getBoundingClientRect();
  const g = cv.getContext("2d");
  const img = g.getImageData(0, 0, cv.width, cv.height).data;
  const at = (vx, vy) => {
    const x = Math.round(vx - r.left), y = Math.round(vy - r.top);
    const k = (y * cv.width + x) * 4;
    return [img[k], img[k + 1], img[k + 2]];
  };
  // Scan every near-white pixel and cluster them into blobs (coarse grid).
  const whites = [];
  for (let y = 0; y < cv.height; y++) {
    for (let x = 0; x < cv.width; x++) {
      const k = (y * cv.width + x) * 4;
      if (img[k] >= 240 && img[k + 1] >= 240 && img[k + 2] >= 240) whites.push([x, y]);
    }
  }
  // Group by 12px grid cells.
  const cells = new Map();
  for (const [x, y] of whites) {
    const key = `${Math.round(x / 12)},${Math.round(y / 12)}`;
    cells.set(key, (cells.get(key) ?? 0) + 1);
  }
  return {
    canvasRect: { l: r.left, t: r.top, w: r.width, h: r.height },
    anchor: window.__wp1.lookPoint("needle"),
    whiteCells: [...cells.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
    atAnchor: at(76, 734),
    atScan: at(64, 649),
  };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
srv.close();
