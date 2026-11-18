// Which GL backend does each Playwright launch config actually get?
import { chromium } from "playwright";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function probe(label, args) {
  const browser = await chromium.launch(args ? { args } : {});
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto(`http://localhost:4193/debug.html`, { waitUntil: "load" });
  await sleep(1500);
  const info = await page.evaluate(() => {
    const c = document.querySelector("canvas");
    const gl = c && (c.getContext("webgl2") || c.getContext("webgl"));
    if (!gl) return { gl: false };
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      gl: true,
      vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    };
  });
  console.log(label, JSON.stringify(info));
  await browser.close();
}
await probe("DEFAULT-LAUNCH:", null);
await probe("SWIFTSHADER-LAUNCH:", ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu"]);
