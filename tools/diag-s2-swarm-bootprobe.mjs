// One-off boot probe: what does ?step=21 at 1024x640 actually render?
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { launchGL } from "./gl-launch.mjs";

const DIST = join(process.cwd(), "dist");
const PORT = 4190;
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

const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
const msgs = [];
page.on("console", (m) => msgs.push(m.type() + ": " + m.text()));
page.on("pageerror", (e) => msgs.push("PAGEERROR: " + e.message));
page.on("requestfailed", (r) => msgs.push("REQFAIL: " + r.url()));
await page.goto(`http://localhost:${PORT}/?step=21`, { waitUntil: "load" });
for (let k = 0; k < 10; k++) {
  await page.waitForTimeout(1000);
  const st = await page.evaluate(() => ({
    swarmBlind: !!document.querySelector("#swarm-blind"),
    boot: document.querySelector("#boot")?.textContent?.slice(0, 80) ?? null,
    appChildren: document.querySelector("#app")?.children.length ?? -1,
    wp1: typeof window.__wp1,
    rsteps: document.querySelectorAll("#reader-body .rstep").length,
  }));
  console.log(k, JSON.stringify(st));
  if (st.swarmBlind) break;
}
console.log(msgs.slice(0, 20).join("\n"));
await browser.close();
srv.close();
process.exit(0);
