// Diagnostic — L900-LABRULE-STEP22-UNDERFOLD (reverify).
// Repro from the finding: http://<base>/?step=22 at 900x900, plain load, no
// interaction; the §8 "Assemble an update rule." step must fit entirely
// above the transport footer. Measures at t≈2s and t≈5s (the scoreboard /
// verdict text fills in asynchronously), plus the rest of the narrow-but-tall
// band (≤1100 wide, 821–960 tall) and a landscape-pill re-run probe.
// Usage: node tools/diag-labrule-step22-underfold.mjs [base]
import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";
import { mkdirSync } from "node:fs";
const base = process.argv[2] ?? "http://localhost:4182";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync("qa/L900-LABRULE-STEP22-REVERIFY", { recursive: true });
let fails = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) fails += 1;
};

const MEASURE = () => {
  const step = document.querySelector('.rstep[data-active="true"]');
  const body = step?.querySelector(".step__body");
  const foot = document.querySelector("#reader-foot");
  const readerBody = document.querySelector("#reader-body");
  const h2 = step?.querySelector("h2")?.textContent ?? "";
  const bodyRect = body?.getBoundingClientRect();
  const stepRect = step?.getBoundingClientRect();
  const footRect = foot?.getBoundingClientRect();
  // Deepest text element bottom inside the step body (leaf blocks).
  let deepest = null;
  for (const el of body?.querySelectorAll("p,table,.kicker,h2") ?? []) {
    const r = el.getBoundingClientRect();
    if (!deepest || r.bottom > deepest.bottom) deepest = { tag: el.tagName, cls: el.className, bottom: r.bottom, text: (el.textContent ?? "").slice(0, 60) };
  }
  // Elements clipped below the viewport or under the footer overlay.
  const clipped = [];
  for (const el of body?.querySelectorAll("p,table,.kicker,h2") ?? []) {
    const r = el.getBoundingClientRect();
    if (r.bottom > footRect.top + 0.5 || r.bottom > innerHeight + 0.5) {
      clipped.push({ tag: el.tagName, cls: el.className, bottom: Math.round(r.bottom), footTop: Math.round(footRect.top), vh: innerHeight });
    }
  }
  return {
    h2,
    fit: step?.dataset.fit,
    scene: step?.dataset.scene,
    innerW: innerWidth,
    innerH: innerHeight,
    park: readerBody?.clientHeight,
    stepOffsetH: step?.offsetHeight,
    bodyTop: bodyRect ? Math.round(bodyRect.top) : null,
    bodyBottom: bodyRect ? Math.round(bodyRect.bottom) : null,
    footTop: footRect ? Math.round(footRect.top) : null,
    footH: footRect ? Math.round(footRect.height) : null,
    deepest,
    clipped,
  };
};

const browser = await launchGL(chromium);

// --- the named repro: ?step=22 at 900x900, plain load, no interaction ---
{
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  await page.goto(`${base}/?step=22`, { waitUntil: "load" });
  await page.waitForFunction(() => {
    const b = document.querySelector("#boot");
    return !b || b.dataset.done === "true";
  }, null, { timeout: 20000 }).catch(() => {});
  await sleep(2000);
  const t2 = await page.evaluate(MEASURE);
  console.log("t=2s:", JSON.stringify(t2, null, 1));
  await sleep(3000);
  const t5 = await page.evaluate(MEASURE);
  console.log("t=5s:", JSON.stringify(t5, null, 1));
  for (const [tag, m] of [["t2", t2], ["t5", t5]]) {
    check(`STEP22-PLAIN 900x900 ${tag}: active step is labrule 'Assemble an update rule.'`,
      m.scene === "labrule" && /Assemble an update rule/.test(m.h2), `scene=${m.scene} h2="${m.h2}"`);
    check(`STEP22-PLAIN 900x900 ${tag}: step height fits the park`, m.stepOffsetH <= m.park, `step=${m.stepOffsetH} park=${m.park} fit=${m.fit}`);
    check(`STEP22-PLAIN 900x900 ${tag}: deepest text above the footer top`, m.deepest && m.deepest.bottom <= m.footTop + 0.5, `deepestBottom=${m.deepest?.bottom?.toFixed(1)} footTop=${m.footTop}`);
    check(`STEP22-PLAIN 900x900 ${tag}: no step text clipped by viewport/footer`, m.clipped.length === 0, JSON.stringify(m.clipped));
  }
  await page.screenshot({ path: "qa/L900-LABRULE-STEP22-REVERIFY/v-step22-plain-900x900.png" });
  await page.close();
}

// --- the rest of the narrow-but-tall band the finding names ---
for (const [w, h] of [[900, 821], [1000, 900], [1100, 960], [900, 960]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(`${base}/?step=22`, { waitUntil: "load" });
  await page.waitForFunction(() => {
    const b = document.querySelector("#boot");
    return !b || b.dataset.done === "true";
  }, null, { timeout: 20000 }).catch(() => {});
  await sleep(5000);
  const m = await page.evaluate(MEASURE);
  check(`STEP22 ${w}x${h}: step height fits the park`, m.stepOffsetH <= m.park, `step=${m.stepOffsetH} park=${m.park} fit=${m.fit}`);
  check(`STEP22 ${w}x${h}: no step text clipped by viewport/footer`, m.clipped.length === 0, JSON.stringify(m.clipped));
  await page.screenshot({ path: `qa/L900-LABRULE-STEP22-REVERIFY/v-step22-${w}x${h}.png` });
  await page.close();
}

// --- pill-switch probe: scoreboard/verdict rewrite must re-pick the fit ---
{
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  await page.goto(`${base}/?step=22`, { waitUntil: "load" });
  await page.waitForFunction(() => {
    const b = document.querySelector("#boot");
    return !b || b.dataset.done === "true";
  }, null, { timeout: 20000 }).catch(() => {});
  await sleep(5000);
  for (const lvl of ["ls", "bowl"]) {
    try {
      await page.click(`#rule-levels button[data-level="${lvl}"]`, { timeout: 4000 });
    } catch (e) {
      check(`STEP22-PILLSWITCH 900x900: click ${lvl}`, false, String(e).slice(0, 120));
      continue;
    }
    await sleep(4000); // benchmark re-run + refit
    const m = await page.evaluate(MEASURE);
    check(`STEP22-PILLSWITCH 900x900 (${lvl}): fit re-picked, no text clipped after re-run`,
      m.clipped.length === 0 && m.stepOffsetH <= m.park, `fit=${m.fit} step=${m.stepOffsetH} park=${m.park} clipped=${JSON.stringify(m.clipped)}`);
  }
  await page.close();
}

await browser.close();
console.log(fails === 0 ? "DIAG_L900_STEP22_OK" : `DIAG_L900_STEP22_FAILED (${fails})`);
process.exit(fails === 0 ? 0 : 1);
