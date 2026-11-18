/* Probe: is #swarm-scrub actually mouse-dead under the run-blind label?
   Measures the INPUT BY ID (the round-2 finding's probe used
   "#swarm-dock input", whose first match is the 13x13 blind CHECKBOX),
   hit-tests across the real track, and performs a real click. */
import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";
const base = process.argv[2] ?? "http://localhost:4173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await launchGL(chromium);
for (const [w, h] of [[1600, 900], [900, 620]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(`${base}/?step=21`, { waitUntil: "load" });
  await sleep(1500);
  for (let i = 0; i < 25; i++) {
    const a = await page.evaluate(() => ({ l: window.__wp1?.locked?.(), an: window.__wp1?.animating?.() }));
    if (!a.l && !a.an) break;
    await sleep(250);
  }
  const m = await page.evaluate(() => {
    const probe = {};
    for (const sel of ["#swarm-dock input", "#swarm-scrub", "#swarm-blind"]) {
      const el = document.querySelector(sel);
      const r = el.getBoundingClientRect();
      probe[sel] = { x: [Math.round(r.left), Math.round(r.right)], y: [Math.round(r.top), Math.round(r.bottom)], w: Math.round(r.width) };
    }
    // Also: what does querySelector("#swarm-dock input") actually match?
    probe.firstInputIs = document.querySelector("#swarm-dock input").id;
    // Hit-test across the REAL scrub track.
    const r = document.querySelector("#swarm-scrub").getBoundingClientRect();
    const hits = [0.2, 0.5, 0.8].map((f) => {
      const el = document.elementFromPoint(r.left + r.width * f, r.top + r.height / 2);
      return { f, hit: el ? (el.id || el.tagName) : "null" };
    });
    probe.hits = hits;
    const label = document.querySelector("#swarm-dock label").getBoundingClientRect();
    probe.label = { x: [Math.round(label.left), Math.round(label.right)], y: [Math.round(label.top), Math.round(label.bottom)] };
    const replay = document.querySelector("#swarm-replay").getBoundingClientRect();
    probe.replay = { y: [Math.round(replay.top), Math.round(replay.bottom)] };
    return probe;
  });
  console.log(`--- ${w}x${h}`);
  console.log(JSON.stringify(m, null, 1));
  // A real click at 70% of the REAL scrub track.
  const st0 = await page.evaluate(() => ({ blind: window.__wp1.swarm()?.blind, scrub: window.__wp1.swarm()?.scrub }));
  const box = await page.locator("#swarm-scrub").boundingBox();
  await page.mouse.click(box.x + box.width * 0.7, box.y + box.height / 2);
  await sleep(400);
  const st1 = await page.evaluate(() => ({ blind: window.__wp1.swarm()?.blind, scrub: window.__wp1.swarm()?.scrub }));
  console.log(`click-at-70%: blind ${st0.blind}->${st1.blind} scrub ${st0.scrub?.toFixed(2)}->${st1.scrub?.toFixed(2)}`);
  await page.close();
}
await browser.close();
