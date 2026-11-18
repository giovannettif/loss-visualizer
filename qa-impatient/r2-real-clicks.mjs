/**
 * R2-REAL — real-pointer-event regression around the BRK-1 fix (the off-state
 * tour bar must not intercept): real Playwright clicks (hit-tested) on
 *  - the swarm dock restart/scrub at ~900px-ish window (the breaker's dead zone),
 *  - the tour controller bar buttons (Next/Back/Exit) while a tour runs,
 *  - the tour launch chip.
 * Plus: with NO tour running, a real click at the bar's location must reach
 * what's actually there (the dock), not an invisible strip.
 */
import { BASE, launch, waitReady, snapshot, ok } from "./driver.mjs";
const { browser, page } = await launch();

// ---- A) swarm dock at 900x620 (the breaker's repro viewport) ----
await page.setViewportSize({ width: 900, height: 620 });
await page.goto(BASE + "?step=21", { waitUntil: "load" });
await waitReady(page);
await page.waitForTimeout(3500);
let hit = await page.evaluate(() => {
  const r = document.querySelector("#swarm-replay-restart")?.getBoundingClientRect();
  if (!r) return null;
  const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  return { target: el?.id ?? el?.tagName, barOn: document.querySelector("#tour-bar")?.dataset.on };
});
console.log("restart hit-test:", JSON.stringify(hit));
ok(hit && hit.target === "swarm-replay-restart", "swarm restart button is the top element at 900x620 (no invisible strip)", JSON.stringify(hit));
let before = await page.evaluate(() => window.__wp1.swarm().time);
await page.locator("#swarm-replay-restart").click(); // real hit-tested click
await page.waitForTimeout(400);
let after = await page.evaluate(() => window.__wp1.swarm().time);
console.log("restart click: time", before, "->", after);
ok(after < before, "real click RESTARTS the swarm flight (was mouse-dead in round 1)", `${before} -> ${after}`);
const scrub = await page.locator("#swarm-scrub");
const sb = await scrub.boundingBox();
await page.mouse.click(sb.x + sb.width * 0.7, sb.y + sb.height / 2);
await page.waitForTimeout(400);
const scrubVal = await page.evaluate(() => window.__wp1.swarm().scrub);
ok(scrubVal > 0.55, "real mouse click on the swarm scrubber sets the flight position (was dead)", `scrub=${scrubVal}`);

// ---- B) tour bar real clicks (bar visible + on) ----
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(BASE + "?step=4", { waitUntil: "load" });
await waitReady(page);
await page.waitForTimeout(2500);
await page.locator('.rstep[data-active="true"] .tour-launch').click(); // real click on the chip
await page.waitForTimeout(2200);
let t = await page.evaluate(() => window.__wp1.tour());
ok(t.running && t.id === "s2", "tour chip real-click starts s2", JSON.stringify({ id: t.id, phase: t.phase }));
const nb = await page.locator("#tour-next").boundingBox();
await page.mouse.click(nb.x + nb.width / 2, nb.y + nb.height / 2);
await page.waitForTimeout(2000);
t = await page.evaluate(() => window.__wp1.tour());
ok(t.stepIndex === 1, "real click on Next advances one tour sentence", `i=${t.stepIndex}`);
const bb = await page.locator("#tour-back").boundingBox();
await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
await page.waitForTimeout(2000);
t = await page.evaluate(() => window.__wp1.tour());
ok(t.stepIndex === 0, "real click on Back goes back one", `i=${t.stepIndex}`);
await page.locator("#tour-exit").click();
await page.waitForTimeout(600);
t = await page.evaluate(() => window.__wp1.tour());
ok(!t.running, "real click on Exit ends the tour");
const barOn = await page.evaluate(() => document.querySelector("#tour-bar")?.dataset.on);
ok(barOn === "false", "bar off after exit");

// ---- C) off-state bar must not intercept: click the canvas center ----
await page.waitForTimeout(400);
const stage = await page.locator("#stage").boundingBox();
await page.mouse.click(stage.x + stage.width / 2, stage.y + stage.height / 2);
await page.waitForTimeout(400);
const elAtBar = await page.evaluate(() => {
  const bar = document.querySelector("#tour-bar").getBoundingClientRect();
  const el = document.elementFromPoint(bar.x + 40, bar.y + bar.height / 2);
  return { at: el?.id ?? el?.tagName ?? "?", barOn: document.querySelector("#tour-bar")?.dataset.on };
});
console.log("off-state bar zone hit:", JSON.stringify(elAtBar));
ok(elAtBar.at !== "tour-back" && elAtBar.at !== "tour-next", "no invisible tour button intercepts in the off state", JSON.stringify(elAtBar));
await browser.close();
console.log("R2-REAL done");
