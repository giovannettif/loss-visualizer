import { chromium } from "playwright";
import { launchGL } from "./tools/gl-launch.mjs";
const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
const dataUrl = "data:image/png;base64," + (await import("node:fs")).readFileSync("qa-minimap-dump.png").toString("base64");
await page.setContent(`<img id="im" src="${dataUrl}" style="image-rendering:pixelated;width:560px;height:880px">`);
await sleep(300);
await page.screenshot({ path: "qa-minimap-zoom.png" });
await browser.close();
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
