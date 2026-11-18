/**
 * diag-momb-copy.mjs — MOM-B-COPY-PINNED reproduction at the finding's scales.
 *
 * ?step=9 (mom-b, §3 Overshoot): read the H2/caption/slider/readout/regime,
 * then drag #beta-slider-b to 0 and 0.75 (the finding's two drags) and again
 * at the momRegimeOf thresholds — does any static copy still pin a value the
 * live slider can change, and do the caption's claimed thresholds match the
 * chip the code actually shows?
 *
 * Read-only against src/ — serves the freshly built dist/ on 4199.
 */

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, extname, resolve } from "node:path";

const DIST = join(process.cwd(), "dist");
const PORT = 4199;
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff",
};

const srv = createServer((req, res) => {
  let p = req.url.split("?")[0];
  if (p === "/" || p === "") p = "/index.html";
  const file = join(DIST, p);
  if (!existsSync(file)) { res.writeHead(404).end("no"); return; }
  res.writeHead(200, { "content-type": MIME[extname(file) ?? ""] ?? "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => srv.listen(PORT, () => r(srv)));
console.log(`serving dist on :${PORT}`);

const OUT = resolve("shots/_diag_momb_copy");
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fails = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) fails += 1;
};

const browser = await launch();
async function launch() {
  const { chromium } = await import("playwright");
  const { launchGL } = await import("./gl-launch.mjs");
  return launchGL(chromium);
}

const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(`http://localhost:${PORT}/?step=9`, { waitUntil: "load" });
await page.waitForFunction(
  () => { const b = document.querySelector("#boot"); return !b || b.dataset.done === "true"; },
  null, { timeout: 15000 },
).catch(() => {});
await sleep(800);
// drain the step's entry animation before reading
for (let i = 0; i < 90; i++) {
  const a = await page.evaluate(() => window.__wp1?.locked?.() || window.__wp1?.animating?.()).catch(() => true);
  if (!a) break;
  await sleep(150);
}
await sleep(300);

const readUi = () => page.evaluate(() => ({
  scene: document.querySelector('.rstep[data-active="true"]')?.dataset.scene ?? "none",
  h2: document.querySelector('.rstep[data-scene="mom-b"] h2')?.textContent?.trim() ?? "",
  caption: document.querySelector('.rstep[data-scene="mom-b"] .caption')?.textContent?.replace(/\s+/g, " ").trim() ?? "",
  slider: document.querySelector("#beta-slider-b")?.value ?? "",
  readout: document.querySelector("#beta-value-b")?.textContent?.trim() ?? "",
  regime: document.querySelector("#beta-regime-b")?.textContent?.trim() ?? "",
  regimeData: document.querySelector("#beta-regime-b")?.dataset.regime ?? "",
  momAslider: document.querySelector("#beta-slider")?.value ?? "",
}));

const setBeta = (v) => page.evaluate((v) => {
  const s = document.querySelector("#beta-slider-b");
  s.value = String(v);
  s.dispatchEvent(new Event("input", { bubbles: true }));
}, v);

const st0 = await readUi();
console.log("initial:", JSON.stringify(st0, null, 2));
check("STEP9 lands on mom-b", st0.scene === "mom-b", `scene=${st0.scene}`);
check("caption no longer pins the live beta as a current-state claim",
  /starts at/.test(st0.caption) && !/^here\s*β\s*=\s*0\.97/.test(st0.caption),
  `caption="${st0.caption}"`);

const shot = (n) => page.screenshot({ path: join(OUT, n), fullPage: false });

// the finding's repro: drag to 0
await setBeta(0);
await sleep(600);
const s0 = await readUi();
console.log("after drag to 0:", JSON.stringify(s0));
check("drag to 0: slider+readout move to 0.00", s0.slider === "0" && s0.readout === "0.00",
  `slider=${s0.slider} readout=${s0.readout}`);
check("drag to 0: regime chip flips to zigzag", s0.regime === "zigzag" && s0.regimeData === "zigzag",
  `regime=${s0.regime}/${s0.regimeData}`);
check("drag to 0: mom-a slider mirrors (syncBetaUi)", s0.momAslider === "0", `momA=${s0.momAslider}`);
check("drag to 0: caption makes no current-β claim it now contradicts",
  !new RegExp(`β\\s*=\\s*${s0.readout}`).test(s0.caption.replace(/^.*?starts at /, "")) ||
  /starts at/.test(s0.caption),
  `caption="${s0.caption}"`);
await shot("50-mom-b-after-drag0.png");

// the finding's second drag: 0.75
await setBeta(750);
await sleep(600);
const s75 = await readUi();
console.log("after drag to 0.75:", JSON.stringify(s75));
check("drag to 0.75: regime = glide (momRegimeOf: <0.85 glide)",
  s75.regime === "glide" && s75.readout === "0.75",
  `regime=${s75.regime} readout=${s75.readout}`);
await shot("51-mom-b-beta075.png");

// caption's claimed thresholds vs the chip the code actually shows
const rows = [[240, "zigzag"], [250, "glide"], [840, "glide"], [850, "overshoot"], [970, "overshoot"]];
for (const [v, want] of rows) {
  await setBeta(v);
  await sleep(350);
  const s = await readUi();
  check(`threshold ${v}→${(v / 1000).toFixed(2)}: chip=${want}`, s.regime === want, `got=${s.regime}`);
}
await setBeta(970);
await sleep(400);
await shot("52-mom-b-back-097.png");

await browser.close();
srv.close();
console.log(fails === 0 ? "ALL PASS" : `${fails} FAIL`);
process.exit(fails === 0 ? 0 : 1);
