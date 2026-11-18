// probe-rail — MY OWN drive verifying the rebuilt rail on the BUILT site:
// ~3/4 panel height; clicks at ARBITRARY fractions between dashes (not just
// the gate's 30/70/50) always land on the nearer step; hover highlights the
// nearest tick; screenshot for the record.
import { chromium } from "playwright";
import { launchGL } from "./tools/gl-launch.mjs";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const base = "http://localhost:4173";
mkdirSync("qa-rail-shots", { recursive: true });

const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) fails += 1;
};

await page.goto(`${base}/?step=10`, { waitUntil: "load" });
await sleep(1800);
for (;;) {
  const a = await page.evaluate(() => ({ l: window.__wp1?.locked?.(), an: window.__wp1?.animating?.() }));
  if (!a.l && !a.an) break;
  await sleep(200);
}

const geo = await page.evaluate(() => {
  const railR = document.querySelector("#rail").getBoundingClientRect();
  const ticks = [...document.querySelectorAll("#rail button")].map((b) => {
    const r = b.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, h: r.height, cx: r.left + r.width / 2 };
  });
  return { railH: railR.height, vh: window.innerHeight, ticks };
});
check(
  "rail spans ~3/4 of the reader panel (0.72–0.78 of vh)",
  geo.railH / geo.vh >= 0.72 && geo.railH / geo.vh <= 0.78,
  `railH=${geo.railH} vh=${geo.vh} frac=${(geo.railH / geo.vh).toFixed(3)}`,
);
const pitch = (geo.ticks[1].top - geo.ticks[0].top).toFixed(1);
check(
  "tick cells generous + contiguous",
  geo.ticks.every((t, i) => t.h >= 14 && (i === 0 || Math.abs(t.top - geo.ticks[i - 1].bottom) <= 1)),
  `cellH≈${geo.ticks[0].h.toFixed(1)}px pitch=${pitch}px n=${geo.ticks.length}`,
);

// Clicks at ARBITRARY fractions between dash centers 11|12 (the reader
// feels nearest-DASH semantics; cells split at the midpoint).
const cA = geo.ticks[11].top + geo.ticks[11].h / 2;
const cB = geo.ticks[12].top + geo.ticks[12].h / 2;
const x = geo.ticks[11].cx;
async function clickAt(y) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
  await sleep(150);
  const during = await page.evaluate(() => window.__wp1.step());
  await page.evaluate(() => window.__wp1.skip());
  await sleep(700);
  const after = await page.evaluate(() => window.__wp1.step());
  return { during, after };
}
for (const [f, want] of [[0.15, 11], [0.4, 11], [0.6, 12], [0.85, 12], [0.5, [11, 12]]]) {
  const r = await clickAt(cA + (cB - cA) * f);
  const ok = Array.isArray(want) ? want.includes(r.after) : r.after === want;
  check(
    `between-tick click at ${(f * 100).toFixed(0)}% of dash-center span lands on ${Array.isArray(want) ? "11 or 12" : want}`,
    ok === true,
    `during=${r.during} after=${r.after}`,
  );
}

// Hover highlight at an arbitrary between-dash point + clearing.
await page.mouse.move(x, cA + (cB - cA) * 0.8);
await sleep(150);
const near = await page.evaluate(() =>
  [...document.querySelectorAll("#rail button")]
    .map((b, i) => (b.hasAttribute("data-near") ? i : -1))
    .filter((i) => i >= 0),
);
check("hovering between dashes highlights the nearest tick", near.length === 1 && (near[0] === 11 || near[0] === 12), `near=${JSON.stringify(near)}`);
await page.mouse.move(80, 80);
await sleep(150);
const nearAfter = await page.evaluate(() =>
  [...document.querySelectorAll("#rail button")].filter((b) => b.hasAttribute("data-near")).length,
);
check("leaving the rail clears the highlight", nearAfter === 0, `near=${nearAfter}`);

await page.evaluate(() => window.__wp1.skip());
await sleep(600);
await page.screenshot({ path: resolve("qa-rail-shots", "41-rail-rebuilt.png") });

await browser.close();
console.log(fails === 0 ? "PROBE_ALL_PASS" : `PROBE_FAILURES: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
