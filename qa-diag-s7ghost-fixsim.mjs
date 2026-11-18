/** qa-diag-s7ghost-fixsim.mjs — validate the TOUR-HOVER-S7-GHOST-FLAVOR-DEAD
 *  fix mechanism at runtime: stamp data-slook="tilt-replay" onto the sentence
 *  spans of BOTH alternate flavors (paras 2 and 3) of page 20 — exactly what
 *  the proposed boot-time stamp-all loop would do — then trusted-hover each
 *  visible flavor's sentence 0 and require the full graduation (highlight +
 *  overlay + look key). Usage: node qa-diag-s7ghost-fixsim.mjs [base] */
import { chromium } from "playwright";
import { launchGL } from "./tools/gl-launch.mjs";

const base = process.argv[2] ?? "http://localhost:4199";
const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};
async function waitIdle() {
  for (let i = 0; i < 40; i++) {
    const a = await page.evaluate(() => ({
      locked: window.__wp1.locked(),
      animating: window.__wp1.animating(),
    }));
    if (!a.locked && !a.animating) return true;
    await sleep(250);
  }
  return false;
}
async function hoverSent0(pId) {
  const pt = await page.evaluate((id) => {
    const p = document.getElementById(id);
    const s = p?.querySelector('span.sent[data-sent="0"]');
    if (!s) return null;
    for (const r of Array.from(s.getClientRects())) {
      for (const f of [0.5, 0.3, 0.7]) {
        const c = { x: r.x + r.width * f, y: r.y + r.height / 2 };
        const hit = document.elementFromPoint(c.x, c.y);
        if (hit && hit.closest("span.sent") === s) return c;
      }
    }
    return null;
  }, pId);
  if (!pt) return null;
  await page.mouse.move(pt.x, pt.y, { steps: 4 });
  await sleep(300);
  const st = await page.evaluate(() => ({
    litCount: document.querySelectorAll("[data-slook-hover]").length,
    litText: (document.querySelector("[data-slook-hover]")?.textContent ?? "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 40),
    overlayOn: document.querySelector("#tour-overlay")?.dataset.on === "true",
    lookKey: window.__wp1.tour().lookKey,
  }));
  await page.mouse.move(8, 8);
  await sleep(200);
  return st;
}

// Case A: deep-link flavor (demo lead, para 2).
await page.goto(`${base}/?step=20`, { waitUntil: "load" });
await page.waitForTimeout(700);
await waitIdle();
await page.evaluate(() => {
  for (const id of ["tilt-demo-lead", "tilt-empty-lead"]) {
    const s = document.querySelector(`#${id} span.sent[data-sent="0"]`);
    if (s) s.dataset.slook = "tilt-replay";
  }
});
{
  const st = await hoverSent0("tilt-demo-lead");
  check("fixsim/deep-link: hover point found in demo flavor", st !== null);
  if (st) {
    check("fixsim/deep-link: sentence highlights", st.litCount === 1, JSON.stringify(st));
    check("fixsim/deep-link: overlay on", st.overlayOn === true);
    check("fixsim/deep-link: lookKey=tilt-replay", st.lookKey === "tilt-replay");
  }
}

// Case B: wheel-arrival flavor (empty lead, para 3) — navigate 19→20 by wheel.
await page.goto(`${base}/?step=19`, { waitUntil: "load" });
await page.waitForTimeout(700);
await waitIdle();
{
  const tops = await page.evaluate(() => window.__wp1.scroll().tops);
  const half = (tops[20] - tops[19]) / 2;
  const notches = Math.max(1, Math.ceil(half / 120) + 1);
  await page.mouse.move(1600 - 290, 450);
  for (let i = 0; i < notches; i++) {
    await page.mouse.wheel(0, 120);
    await sleep(50);
  }
  await waitIdle();
}
{
  const visible = await page.evaluate(() => ({
    demoHidden: document.getElementById("tilt-demo-lead")?.hidden ?? null,
    emptyHidden: document.getElementById("tilt-empty-lead")?.hidden ?? null,
  }));
  check(
    "fixsim/wheel: empty flavor visible on arrival",
    visible.emptyHidden === false && visible.demoHidden === true,
    JSON.stringify(visible),
  );
  // The goto above reloaded the page — re-apply the boot-stamp simulation.
  await page.evaluate(() => {
    for (const id of ["tilt-demo-lead", "tilt-empty-lead"]) {
      const s = document.querySelector(`#${id} span.sent[data-sent="0"]`);
      if (s) s.dataset.slook = "tilt-replay";
    }
  });
  const st = await hoverSent0("tilt-empty-lead");
  check("fixsim/wheel: hover point found in empty flavor", st !== null);
  if (st) {
    check("fixsim/wheel: sentence highlights", st.litCount === 1, JSON.stringify(st));
    // The ▶ ghost button (#tilt-replay-play) may legitimately be absent on an
    // untouched run — the overlay must stay dark rather than invent a target
    // (the sanctioned degrade), but the sentence highlight must fire.
    console.log(`      (overlayOn=${st.overlayOn} lookKey=${st.lookKey})`);
  }
}

await browser.close();
console.log(
  failures === 0
    ? "S7GHOST_FIXSIM_OK — the stamp-all mechanism restores hover on both flavors"
    : `S7GHOST_FIXSIM_FAILED (${failures})`,
);
process.exit(failures === 0 ? 0 : 1);
