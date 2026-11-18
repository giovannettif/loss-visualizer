/**
 * verify-copy-layout.mjs — browser verification for the cycle-A copy and
 * layout fixes:
 *   copy-gdc-osc-gloss      §2 step 6 threshold gloss reads correctly
 *   copy-fogc-local-min     §6 step 17 drops the false "local minimum" claim
 *   copy-labrulea-four-parts §8 step 22 softened parts claim
 *   copy-labruleb-slowest   §8 step 23 no false "slowest machine" claim
 *   GP-3 caption            §8 step 22 caption defuses the dials-off DNF
 *   cov-hover-to-look       Overview documents hover-to-look
 *   layout-foot-hint        continue ↓ inside the reader at 900×900/900×700
 *   layout-panel-overlap    no HUD/compass overlaps at the flagged sizes
 *                           AND still clean at 1280/1440
 */

import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";

const base = process.argv[2] ?? "http://localhost:4185";
let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitIdle(page) {
  for (let i = 0; i < 60; i++) {
    const a = await page.evaluate(() => ({
      locked: window.__wp1?.locked?.() ?? false,
      animating: window.__wp1?.animating?.() ?? false,
    }));
    if (!a.locked && !a.animating) return true;
    await sleep(250);
  }
  return false;
}

const browser = await launchGL(chromium);

/* ---------------- copy checks ---------------- */
{
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

  const stepText = async (step) => {
    await page.goto(`${base}/?step=${step}`, { waitUntil: "load" });
    await waitIdle(page);
    return page.evaluate(() => {
      const active = document.querySelector('.rstep[data-active="true"]');
      return active ? active.textContent.replace(/\s+/g, " ") : "";
    });
  };

  // §2 gd-c: the gloss must use the largest Hessian eigenvalue — f = zᵀAz ⇒
  // Hessian 2A, λmax = 2λ₁ = 2, oscillation past 1/λmax = 0.5 and divergence
  // past 2/λmax = 1 (the live regimeOf thresholds). COPY-PLAN §2.7 rewrote
  // the sentence (R3) to "λmax is the steepest curvature the landscape has"
  // and moved the thresholds into stacked .frac spans (§3 F3) — the frac
  // markup renders "1/λmax" as flat text "1λmax", so the assert reads the
  // phrase + the numeric anchors instead of the slash form.
  const gdC = await stepText(6);
  check(
    "copy-gdc-osc-gloss: λmax thresholds (oscillate/diverge), λmax = steepest curvature, η = 0.5/1",
    gdC.includes("λmax") && gdC.includes("λmax = 2") &&
      gdC.includes("steepest curvature the landscape has") &&
      gdC.includes("thresholds sit at η = 0.5 and η = 1") &&
      !gdC.includes("largest curvature") &&
      !gdC.includes("half the largest curvature") && !gdC.includes("half of 1/λ₁"),
    gdC.slice(0, 200),
  );
  check(
    "copy-gdc-symbol: curvature not written as L (L is the loss)",
    !gdC.includes("1/L") && !gdC.includes("2/L") && !/L = 2/.test(gdC),
  );
  check(
    "copy-gdc-osc-gloss: old 'half the largest curvature' appositive gone",
    !gdC.includes("half the largest curvature"),
  );

  // §6 fog-c: no false local-minimum claim; the moral matches Rosenbrock
  // (slow progress ≠ convergence — it has ONE stationary point, so no local
  // optimum is ever reached and "local vs global" would be a non-sequitur).
  const fogC = await stepText(17);
  check(
    "copy-fogc-local-min: 'found a local minimum' claim removed",
    !fogC.includes("you found a local minimum"),
  );
  check(
    "copy-fogc-local-min: honest replacement present",
    fogC.includes("felt final") &&
      // Case-insensitive: the shipped copy (COPY-PLAN §2.15 final) reads
      // "...a minimum at all: slow progress is not arrival." — lowercase
      // after the colon; the old expectation demanded a capitalized variant
      // the copy never shipped.
      fogC.toLowerCase().includes("slow progress is not arrival") &&
      !fogC.toLowerCase().includes("local optimality is not global optimality"),
    fogC.slice(fogC.indexOf("The gold marker"), fogC.indexOf("The gold marker") + 260),
  );

  // §8 step A (22): softened four-parts claim + new caption.
  const step22 = await stepText(22);
  check(
    "copy-labrulea-four-parts: overclaim softened",
    step22.includes("Every optimizer you have met is a bet about landscape structure") &&
      step22.includes("exact combinations of the four parts") &&
      !step22.includes("Every optimizer on this page is a combination of four parts"),
  );
  check(
    "GP-3: caption rewritten (plain GD at your η; machines run their own)",
    step22.includes("plain GD") && step22.includes("at whatever") && step22.includes("hand-tuned"),
    step22.slice(step22.indexOf("turn every part off"), step22.indexOf("turn every part off") + 200),
  );

  // §8 step B (23): momentum no longer 'the slowest machine on Rosenbrock'.
  const step23 = await stepText(23);
  check(
    "copy-labruleb-slowest: false 'slowest machine' claim removed",
    !step23.includes("the slowest machine on Rosenbrock"),
  );
  check(
    "copy-labruleb-slowest: true ranking present (momentum converged, GD never landed)",
    step23.includes("did converge, while GD never landed"),
  );

  // Overview (the hero step): hover-to-look documented.
  const hero = await page.evaluate(() => {
    const el = document.querySelector('.rstep[data-scene="hero"]');
    return el ? el.textContent.replace(/\s+/g, " ") : "";
  });
  check(
    "cov-hover-to-look: Overview documents dotted phrases (hover/Tab)",
    hero.includes("dotted phrases") && hero.includes("Tab"),
    hero.slice(hero.indexOf("From the next step"), hero.indexOf("From the next step") + 170),
  );
  await page.close();
}

/* ---------------- layout checks ---------------- */
{
  const probe = async (width, height, step, name) => {
    const page = await browser.newPage({ viewport: { width, height } });
    page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
    await page.goto(`${base}/?step=${step}`, { waitUntil: "load" });
    await waitIdle(page);
    await sleep(1200); // let HUD layout settle (entry animation)
    const r = await page.evaluate(() => {
      const box = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return b.width === 0 && b.height === 0 ? null : { x: b.x, y: b.y, r: b.right, b: b.bottom, w: b.width, h: b.height };
      };
      const inter = (a, b) =>
        !a || !b ? 0 : Math.max(0, Math.min(a.r, b.r) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.y, b.y));
      const vis = (sel) => document.querySelector(sel)?.dataset.visible === "true";
      const b = (sel) => (vis(sel) ? box(sel) : null);
      const fitP = b("#fit-panel");
      const mmP = b("#minimap-panel");
      const fogP = b("#fog-panel");
      const tiltP = b("#tilt-panel");
      return {
        vw: innerWidth,
        hint: box("#continue-hint"),
        hintHidden: document.querySelector("#continue-hint")?.hidden ?? true,
        fit: fitP,
        fitVisible: vis("#fit-panel"),
        mm: mmP,
        fog: fogP,
        tilt: tiltP,
        interFitMM: inter(fitP, mmP),
        interTiltMM: inter(tiltP, mmP),
        interFogMM: inter(fogP, mmP),
        // pointer interception at the fit canvas's right edge (the drag
        // handle) — only meaningful when the fit inset is actually shown
        hit: (() => {
          const fp = document.querySelector("#fit-panel");
          if (fp?.dataset.visible !== "true") return null;
          const fc = document.querySelector("#fit-canvas");
          if (!fc) return null;
          const b = fc.getBoundingClientRect();
          if (b.width === 0) return null;
          const el = document.elementFromPoint(b.right - 6, b.top + b.height / 2);
          return el ? el.id || el.tagName : "none";
        })(),
      };
    });
    const inside = r.hint && !r.hintHidden ? r.hint.r <= r.vw + 0.5 : true; // only when the hint shows
    check(
      `${name}: continue ↓ inside the viewport (or not shown)`,
      inside,
      r.hintHidden ? "hint hidden this state" : `right=${r.hint?.r?.toFixed(0)} vw=${r.vw}`,
    );
    if (r.fit && r.mm) {
      check(`${name}: fit panel does not overlap the compass`, r.interFitMM === 0, `overlap=${r.interFitMM.toFixed(0)}px² fit=[${r.fit.x?.toFixed(0)},${r.fit.r?.toFixed(0)}] mm=[${r.mm.x?.toFixed(0)},${r.mm.r?.toFixed(0)}]`);
    }
    if (r.tilt && r.mm && r.tilt.y < r.mm.b && r.mm.y < r.tilt.b) {
      check(`${name}: tilt panel does not overlap the compass`, r.interTiltMM === 0, `overlap=${r.interTiltMM.toFixed(0)}px²`);
    }
    if (r.fog && r.mm && r.fog.y < r.mm.b && r.mm.y < r.fog.b) {
      check(`${name}: fog panel does not overlap the compass`, r.interFogMM === 0, `overlap=${r.interFogMM.toFixed(0)}px²`);
    }
    if (r.hit !== null) {
      check(`${name}: fit canvas right edge not intercepted`, r.hit === "fit-canvas", `elementFromPoint=${r.hit}`);
    } else {
      console.log(`NOTE  ${name}: fit inset not visible — hit test skipped`);
    }
    await page.close();
  };

  // The flagged repros from the finding:
  await probe(900, 900, 6, "layout 900x900 step6 gd-c");
  await probe(900, 700, 15, "layout 900x700 step15 fog-a");
  await probe(900, 900, 20, "layout 900x900 step20 tilt-b");
  await probe(900, 700, 18, "layout 900x700 step18 tilt-a");
  await probe(900, 700, 22, "layout 900x700 step22 labrule");
  // Regression: the wide sizes were clean before and must stay clean.
  await probe(1280, 800, 15, "layout 1280x800 step15 fog-a");
  await probe(1440, 900, 20, "layout 1440x900 step20 tilt-b");
  await browser.close();
}

console.log(failures === 0 ? "VERIFY_COPY_LAYOUT_OK" : `VERIFY_COPY_LAYOUT_FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
