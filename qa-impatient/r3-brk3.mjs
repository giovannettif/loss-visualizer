/**
 * R3-BRK3 — during a RUNNING tour on the §7 swarm page, the dock transport
 * must be hit-testable and really clickable (the fix lifts the tour bar to
 * bottom:166px on the swarm page — page.css:2095-2097).
 * Viewports: 900×620 and 1280×800 (the breaker's repro sizes).
 */
import { BASE, launch, waitReady, ok, shot } from "./driver.mjs";
const { browser, page } = await launch();

for (const vp of [{ width: 900, height: 620 }, { width: 1280, height: 800 }]) {
  await page.setViewportSize(vp);
  await page.goto(BASE + "?step=21", { waitUntil: "load" });
  await waitReady(page);
  await page.waitForTimeout(3000);
  await page.locator('.rstep[data-active="true"] .tour-launch').click();
  await page.waitForTimeout(2500);
  let t = await page.evaluate(() => window.__wp1.tour());
  ok(t.running, `[${vp.width}] s7 tour running on the swarm page`, `phase=${t.phase}`);

  const hit = await page.evaluate(() => {
    const probe = (id) => {
      const r = document.querySelector(id)?.getBoundingClientRect();
      if (!r || r.width === 0) return `${id}:no-rect`;
      const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return `${id}:${el?.id ?? el?.tagName ?? "?"}`;
    };
    return {
      barBottom: Math.round(document.querySelector("#tour-bar").getBoundingClientRect().bottom),
      dockTop: Math.round(document.querySelector("#swarm-dock").getBoundingClientRect().top),
      hits: [probe("#swarm-replay-play"), probe("#swarm-replay-restart"), probe("#swarm-scrub")],
      barOn: document.querySelector("#tour-bar")?.dataset.on,
    };
  });
  console.log(`[${vp.width}x${vp.height}]`, JSON.stringify(hit));
  ok(hit.barOn === "true", `[${vp.width}] bar visible (running tour)`);
  ok(hit.barBottom < hit.dockTop, `[${vp.width}] tour bar sits ABOVE the dock (no overlap)`, `barBottom=${hit.barBottom} dockTop=${hit.dockTop}`);
  const bad = hit.hits.filter((h) => h.startsWith("tour-"));
  ok(bad.length === 0, `[${vp.width}] every dock transport element hit-tests to itself (not the bar)`, hit.hits.join(" "));

  // real clicks during the running tour: restart + scrub + pause
  const t0 = await page.evaluate(() => window.__wp1.swarm().time);
  await page.locator("#swarm-replay-restart").click();
  await page.waitForTimeout(200);
  const t1 = await page.evaluate(() => window.__wp1.swarm().time);
  ok(t1 < Math.max(t0 * 0.2, 0.8), `[${vp.width}] dock restart REALLY clicks during the tour`, `${t0.toFixed(2)} -> ${t1.toFixed(2)}`);
  const sb = await page.locator("#swarm-scrub").boundingBox();
  await page.mouse.click(sb.x + sb.width * 0.75, sb.y + sb.height / 2);
  await page.waitForTimeout(350);
  const sc = await page.evaluate(() => ({ scrub: window.__wp1.swarm().scrub, blind: window.__wp1.swarm().blind }));
  ok(Math.abs(sc.scrub - 0.75) < 0.15, `[${vp.width}] dock scrubber REALLY scrubs during the tour`, `scrub=${sc.scrub}`);
  ok(sc.blind === true, `[${vp.width}] scrub click during tour did not touch blind`, `blind=${sc.blind}`);
  await page.locator("#swarm-replay-play").click();
  await page.waitForTimeout(150);
  const paused = await page.evaluate(() => window.__wp1.swarm().playing);
  await page.locator("#swarm-replay-play").click(); // resume
  ok(paused === false, `[${vp.width}] dock pause REALLY clicks during the tour`, `playing=${paused}`);
  // tour still healthy after all the dock clicking
  t = await page.evaluate(() => window.__wp1.tour());
  ok(t.running, `[${vp.width}] tour still running after dock interaction`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  t = await page.evaluate(() => window.__wp1.tour());
  ok(!t.running, `[${vp.width}] Esc still exits after dock interaction`);
  await shot(page, `r3-brk3-${vp.width}`);
}
await browser.close();
console.log("R3-BRK3 done");
