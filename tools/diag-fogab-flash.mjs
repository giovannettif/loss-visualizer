// Throwaway diagnostic for F26-FOG-AB-FLASH:
// captures a CDP screencast across the fog-a -> fog-b step change (?step=15,
// ArrowDown) and counts bright (luma>60) pixels per frame, replicating the
// finding's metric. Also samples __wp1 state mid-"out" stage.
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";

const PORT = process.env.PORT ?? "4192";
mkdirSync("shots/_diag_fogab", { recursive: true });

const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(`http://localhost:${PORT}/?step=15`, { waitUntil: "load" });
await page.waitForFunction(() => window.__wp1 && window.__wp1.debug().swap === null && !window.__wp1.animating(), null, { timeout: 15000 });
await page.waitForTimeout(400);

const rest = {
  fog: await page.evaluate(() => window.__wp1.fog()),
  debug: await page.evaluate(() => window.__wp1.debug()),
};
console.log("REST:", JSON.stringify({ level: rest.fog.level, maskReady: rest.fog.maskReady, scene: rest.debug.scene, built: rest.debug.built, swap: rest.debug.swap, opac: rest.debug.opac }));

// Bright-pixel counter: decode a PNG inside the page, count luma>60 pixels.
async function brightCount(pngB64) {
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const luma = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      if (luma > 60) n++;
    }
    return n;
  }, pngB64);
}

// Screencast across the step change.
const cdp = await page.context().newCDPSession(page);
const frames = [];
cdp.on("Page.screencastFrame", (ev) => {
  frames.push({ ts: ev.metadata.timestamp, b64: ev.data });
  cdp.send("Page.screencastFrameAck", { sessionId: ev.sessionId }).catch(() => {});
});
await cdp.send("Page.startScreencast", { format: "png", everyNthFrame: 1 });
await page.keyboard.press("ArrowDown");
await page.waitForTimeout(1800);
try { await cdp.send("Page.stopScreencast"); } catch {}
cdp.removeAllListeners("Page.screencastFrame");

// Mid-out-stage state probe (fresh load; sample ~60ms after the keypress).
await page.goto(`http://localhost:${PORT}/?step=15`, { waitUntil: "load" });
await page.waitForFunction(() => window.__wp1 && window.__wp1.debug().swap === null && !window.__wp1.animating(), null, { timeout: 15000 });
await page.waitForTimeout(400);
const midState = await page.evaluate(async () => {
  const snap = () => ({
    t: performance.now(),
    scene: window.__wp1.debug().scene,
    built: window.__wp1.debug().built,
    swap: window.__wp1.debug().swap,
    opac: window.__wp1.debug().opac,
    maskReady: window.__wp1.fog().maskReady,
    level: window.__wp1.fog().level,
  });
  const t0 = performance.now();
  const key = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true });
  dispatchEvent(key);
  const samples = [];
  for (let i = 0; i < 10; i++) {
    samples.push(snap());
    await new Promise((r) => setTimeout(r, 60));
  }
  return { t0, samples };
});
console.log("MID-OUT SAMPLES (60ms apart):");
for (const s of midState.samples) {
  console.log(`  +${Math.round(s.t - midState.t0)}ms scene=${s.scene} built=${s.built} swap=${s.swap} opac=${s.opac.toFixed(3)} maskReady=${s.maskReady} fogLevel=${s.level}`);
}

// Score every captured frame.
const counts = [];
for (const f of frames) {
  counts.push({ ts: f.ts, bright: await brightCount(f.b64) });
}
const baseline = counts.slice(0, 3).reduce((a, b) => Math.min(a, b.bright), Infinity);
const peak = counts.reduce((a, b) => (b.bright > a.bright ? b : a), counts[0]);
const above = counts.filter((c) => c.bright > Math.max(2000, baseline * 10));
console.log(`FRAMES: ${counts.length}, baseline(min first3)=${baseline}, peak=${peak.bright}`);
console.log(`frames >2000 bright: ${above.length ? `${above.length}, from +${Math.round((above[0].ts - counts[0].ts) * 1000)}ms to +${Math.round((above[above.length - 1].ts - counts[0].ts) * 1000)}ms` : "none"}`);
console.log("TIMELINE (frame#, ms, bright):");
counts.forEach((c, i) => {
  if (c.bright > baseline * 3 || i % 6 === 0) console.log(`  f${String(i).padStart(3)} +${Math.round((c.ts - counts[0].ts) * 1000)}ms  ${c.bright}`);
});

// Save baseline + peak frames for visual reference.
const baseF = counts.findIndex((c) => c.bright === baseline);
writeFileSync("shots/_diag_fogab/baseline.png", Buffer.from(frames[Math.min(baseF, 2)].b64, "base64"));
writeFileSync("shots/_diag_fogab/peak.png", Buffer.from(frames[counts.indexOf(peak)].b64, "base64"));
console.log("saved shots/_diag_fogab/baseline.png, peak.png");
await browser.close();
