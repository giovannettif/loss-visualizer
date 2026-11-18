/**
 * R3-DOCK — the swarm dock transport after the scrub-label-overlap fix.
 *  a) geometry + hit-test across the #swarm-scrub track at 900×620 and
 *     1600×900 (the student's repro sizes): no point on the track may
 *     resolve to the blind label;
 *  b) real clicks at 20/50/80% scrub the flight (not toggle blind);
 *  c) real click on the blind LABEL still toggles the checkbox;
 *  d) restart button real click still restarts (BRK-1 regression).
 */
import { BASE, launch, waitReady, ok, shot } from "./driver.mjs";
const { browser, page } = await launch();

for (const vp of [{ width: 900, height: 620 }, { width: 1600, height: 900 }]) {
  await page.setViewportSize(vp);
  await page.goto(BASE + "?step=21", { waitUntil: "load" });
  await waitReady(page);
  await page.waitForTimeout(3500);
  const geo = await page.evaluate(() => {
    const r = (id) => document.querySelector(id)?.getBoundingClientRect();
    const scrub = r("#swarm-scrub");
    const label = document.querySelector("#swarm-blind")?.closest("label")?.getBoundingClientRect();
    const samples = [];
    if (scrub) {
      for (const f of [0.1, 0.2, 0.35, 0.5, 0.65, 0.8, 0.9]) {
        const x = scrub.x + scrub.width * f;
        const y = scrub.y + scrub.height / 2;
        const el = document.elementFromPoint(x, y);
        samples.push(`${Math.round(f * 100)}%:${el?.id ?? el?.tagName ?? "?"}`);
      }
    }
    return {
      scrub: scrub ? { x: Math.round(scrub.x), y: Math.round(scrub.y), w: Math.round(scrub.width), h: Math.round(scrub.height) } : null,
      label: label ? { x: Math.round(label.x), y: Math.round(label.y), w: Math.round(label.width), h: Math.round(label.height) } : null,
      samples,
      barOn: document.querySelector("#tour-bar")?.dataset.on,
    };
  });
  console.log(`[${vp.width}x${vp.height}] dock geometry:`, JSON.stringify(geo));
  ok(geo.scrub && geo.scrub.w > 60, `[${vp.width}] scrubber has real width (not a 13px collapse)`, `w=${geo.scrub?.w}`);
  const hitsLabel = geo.samples.some((s) => s.endsWith("swarm-blind"));
  ok(!hitsLabel, `[${vp.width}] no point on the scrub track resolves to the blind checkbox`, geo.samples.join(" "));

  // real clicks at 20/50/80%: scrub must change, blind must NOT flip
  const before = await page.evaluate(() => ({ scrub: window.__wp1.swarm().scrub, blind: window.__wp1.swarm().blind, time: window.__wp1.swarm().time }));
  for (const f of [0.2, 0.5, 0.8]) {
    const sb = await page.locator("#swarm-scrub").boundingBox();
    await page.mouse.click(sb.x + sb.width * f, sb.y + sb.height / 2);
    await page.waitForTimeout(350);
  }
  const after = await page.evaluate(() => ({ scrub: window.__wp1.swarm().scrub, blind: window.__wp1.swarm().blind }));
  console.log(`[${vp.width}] clicks:`, JSON.stringify({ before, after }));
  ok(after.blind === before.blind, `[${vp.width}] scrub clicks did NOT toggle the blind checkbox`, `blind ${before.blind} -> ${after.blind}`);
  ok(Math.abs(after.scrub - 0.8) < 0.12 || Math.abs(after.scrub - before.scrub) > 0.05, `[${vp.width}] scrub clicks moved the flight position`, `scrub ${before.scrub.toFixed(2)} -> ${after.scrub.toFixed(2)}`);

  // real click on the blind LABEL still toggles the checkbox
  const blindBefore = await page.evaluate(() => window.__wp1.swarm().blind);
  await page.locator("#swarm-blind").click({ trial: false, force: false });
  await page.waitForTimeout(600);
  const blindAfter = await page.evaluate(() => window.__wp1.swarm().blind);
  ok(blindAfter !== blindBefore, `[${vp.width}] blind checkbox still toggles by real click`, `${blindBefore} -> ${blindAfter}`);
  await page.locator("#swarm-blind").click(); // restore
  await page.waitForTimeout(400);

  // restart still works by real click (BRK-1 regression)
  const t0 = await page.evaluate(() => window.__wp1.swarm().time);
  await page.locator("#swarm-replay-restart").click();
  await page.waitForTimeout(400);
  const t1 = await page.evaluate(() => window.__wp1.swarm().time);
  ok(t1 < t0, `[${vp.width}] restart button real click restarts the flight`, `${t0.toFixed(2)} -> ${t1.toFixed(2)}`);
  await shot(page, `r3-dock-${vp.width}`);
}
await browser.close();
console.log("R3-DOCK done");
