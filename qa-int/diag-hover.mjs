/** diag-hover.mjs — probe why pointer hover does not light a look span. */
import { chromium } from "playwright";
import { launchGL } from "../tools/gl-launch.mjs";
import { sleep } from "./h.mjs";

const BASE = process.argv[2] ?? "http://localhost:4184";
const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(BASE + "/?step=2", { waitUntil: "load" });
await page.waitForFunction(() => !!window.__wp1 && !document.querySelector("#boot"));
await sleep(1500);

// instrument: capture pointerover/out + the gate inputs (read-only probe)
await page.evaluate(() => {
  window.__diag = { events: [], gates: [] };
  const body = document.querySelector("#reader-body");
  const snap = () => ({
    t: Math.round(performance.now()),
    locked: window.__wp1.locked(),
    animating: window.__wp1.animating(),
    scroll: window.__wp1.scroll(),
    look: window.__wp1.look().id,
  });
  body.addEventListener("pointerover", (e) => {
    window.__diag.events.push({
      kind: "over",
      trusted: e.isTrusted,
      target: (e.target.tagName ?? "?") + "." + (e.target.className?.toString?.().slice(0, 24) ?? ""),
      look: e.target.closest?.("[data-look]")?.dataset.look ?? null,
      sent: e.target.closest?.(".sent")?.dataset?.slook ?? null,
      at: snap(),
    });
    window.__diag.gates.push(snap());
  }, true); // capture to see everything under #reader-body
  window.addEventListener("pointermove", (e) => {
    window.__diag.events.push({ kind: "move", trusted: e.isTrusted, x: e.clientX, y: e.clientY });
  });
});

const target = await page.evaluate(() => {
  for (const el of document.querySelectorAll('.rstep[data-active="true"] .look[data-look]')) {
    if (!el.closest(".sent[data-slook]")) {
      const r = el.getBoundingClientRect();
      return { key: el.dataset.look, x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
  }
  return null;
});
console.log("target:", JSON.stringify(target));
const rb = await page.locator("#reader").boundingBox();
await page.mouse.move(rb.x + rb.width * 0.5, rb.y + rb.height - 30);
await sleep(900);
await page.mouse.move(target.x, target.y, { steps: 4 });
await sleep(500);
const out = await page.evaluate(() => ({
  events: window.__diag.events.slice(0, 30),
  lookNow: window.__wp1.look(),
  overCount: window.__diag.events.filter((e) => e.kind === "over").length,
  trustedMoves: window.__diag.events.filter((e) => e.kind === "move" && e.trusted).length,
}));
console.log(JSON.stringify(out, null, 1));
await browser.close();
