import { chromium } from "playwright";
import { launchGL } from "./tools/gl-launch.mjs";
import { createServer } from "node:http";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join, extname } from "node:path";
const DIST = join(process.cwd(), "dist");
const PORT = 4221;
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
  // Row profiles: list pixels ≥200 on the dot row (y=110 canvas-local) and
  // the mystery row (y=25 canvas-local), plus dpr facts.
  const g = cv.getContext("2d");
  const img = g.getImageData(0, 0, cv.width, cv.height).data;
  const prof = (y) => {
    const out = [];
    for (let x = 0; x < cv.width; x++) {
      const k = (y * cv.width + x) * 4;
      if (img[k] >= 200) out.push([x, img[k], img[k + 1], img[k + 2]]);
    }
    return out;
  };
  return {
    dpr: window.devicePixelRatio,
    cvW: cv.width,
    cvH: cv.height,
    cssW: r.width,
    anchor: window.__wp1.lookPoint("needle"),
    row110: prof(110),
    row25: prof(25),
    data: cv.toDataURL("image/png"),
  };
});
writeFileSync("qa-minimap-dump.png", Buffer.from(out.data.split(",")[1], "base64"));
delete out.data;
console.log(JSON.stringify(out));
await browser.close();
srv.close();
