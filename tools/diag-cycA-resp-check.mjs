/* Cycle-A round-1 response checks at the repro viewport (900x900):
   RESP-TOURBAR-900 — the tour bar's controls stay inside the pill and clear
   of the reader pane; RESP-SWARM-STEP-900 — the swarm step fits the pane. */
import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";

const base = process.argv[2] ?? "http://localhost:4173";
let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await launchGL(chromium);

for (const width of [900, 1000, 1100]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.goto(`${base}/?step=13`, { waitUntil: "load" });
  await sleep(2000);
  for (let i = 0; i < 25; i++) {
    const a = await page.evaluate(() => ({ l: window.__wp1.locked(), an: window.__wp1.animating() }));
    if (!a.l && !a.an) break;
    await sleep(300);
  }
  await page.locator('.rstep[data-active="true"] .tour-launch').click();
  await sleep(1500); // bar fades in
  const m = await page.evaluate(() => {
    const pill = document.querySelector("#tour-bar-full").getBoundingClientRect();
    const cs = getComputedStyle(document.querySelector("#tour-bar-full"));
    const kids = [...document.querySelector("#tour-bar-full").children]
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { id: el.id, l: r.left, r: r.right, w: r.width };
      })
      .filter((k) => k.w > 0); // display:none children report a 0x0 rect at (0,0)
    const reader = document.querySelector("#reader").getBoundingClientRect();
    const autoCS = getComputedStyle(document.querySelector("#tour-auto"));
    return {
      pill: { l: pill.left, r: pill.right },
      readerLeft: reader.left,
      wrap: cs.flexWrap,
      overflow: cs.overflow,
      kids,
      autoDisplay: autoCS.display,
      labelOverflow: getComputedStyle(document.querySelector("#tour-bar-label")).textOverflow,
    };
  });
  const rightmost = Math.max(...m.kids.map((k) => k.r));
  const insidePill = m.kids.every((k) => k.l >= m.pill.l - 0.5 && k.r <= m.pill.r + 0.5);
  check(
    `RESP-TOURBAR-900 w=${width}: all controls inside the pill chrome`,
    insidePill,
    `pill=${m.pill.l.toFixed(1)}..${m.pill.r.toFixed(1)} rightmostChild=${rightmost.toFixed(1)} wrap=${m.wrap}`,
  );
  check(
    `RESP-TOURBAR-900 w=${width}: nothing crosses the reader pane`,
    rightmost <= m.readerLeft,
    `rightmost=${rightmost.toFixed(1)} reader.left=${m.readerLeft.toFixed(1)}`,
  );
  check(
    `RESP-TOURBAR-900 w=${width}: Auto hidden at <=1100, label can shrink`,
    (width <= 1100 ? m.autoDisplay === "none" : true) && m.labelOverflow === "ellipsis",
    `auto=${m.autoDisplay} labelOverflow=${m.labelOverflow}`,
  );
  await page.close();
}

{
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  await page.goto(`${base}/?step=21`, { waitUntil: "load" });
  await sleep(2000);
  for (let i = 0; i < 25; i++) {
    const a = await page.evaluate(() => ({ l: window.__wp1.locked(), an: window.__wp1.animating() }));
    if (!a.l && !a.an) break;
    await sleep(300);
  }
  const s = await page.evaluate(() => {
    const step = document.querySelector('.rstep[data-active="true"]').getBoundingClientRect();
    const pane = document.querySelector("#reader-body").getBoundingClientRect();
    const cap = [...document.querySelectorAll('.rstep[data-active="true"] p.caption')].pop().getBoundingClientRect();
    const chip = document.querySelector('.rstep[data-active="true"] .tour-launch').getBoundingClientRect();
    return { stepH: step.height, paneH: pane.height, capBottom: cap.bottom, chipBottom: chip.bottom, vh: innerHeight };
  });
  check(
    "RESP-SWARM-STEP-900: the swarm step fits the 900px pane on arrival",
    s.stepH <= s.paneH + 1,
    `stepH=${s.stepH.toFixed(1)} paneH=${s.paneH}`,
  );
  check(
    "RESP-SWARM-STEP-900: closing caption + tour chip above the fold",
    s.capBottom <= s.vh && s.chipBottom <= s.vh,
    `capBottom=${s.capBottom.toFixed(1)} chipBottom=${s.chipBottom.toFixed(1)} vh=${s.vh}`,
  );
  await page.close();
}

await browser.close();
console.log(failures === 0 ? "ALL_PASS" : `FAILURES: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
