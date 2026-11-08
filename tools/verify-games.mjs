/**
 * verify-games.mjs — browser verification for the cycle-A game/logic fixes:
 *   GP-1  tilt runs end by themselves + Finish pulse cue when near-still
 *   GP-2  Rastrigin press = nudge (not a 5-unit launch)
 *   GP-3  dials-off scoreboard shows "diverged", not "Infinity"
 *   fogc-speed-clock  2×/0.5× keep scrub bar, label and ball motion in sync
 */

import { chromium } from "playwright";

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

const browser = await chromium.launch();

/* ---------------- GP-1: valley tap → auto-settle + cue ---------------- */
{
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  await page.goto(`${base}/?step=18`, { waitUntil: "load" });
  await waitIdle(page);
  await sleep(500);

  check("GP-1: scene is tilt-a on the valley", await page.evaluate(() => {
    const t = window.__wp1.tilt();
    return window.__wp1.scene() === "tilt-a" && t.level === "valley";
  }));

  // An 80ms tap, then hands off: the run must end by itself.
  await page.keyboard.down("w");
  await sleep(80);
  await page.keyboard.up("w");
  const t0 = Date.now();
  let done = false;
  let finalState = null;
  while (Date.now() - t0 < 20000) {
    finalState = await page.evaluate(() => window.__wp1.tilt());
    if (finalState.done) { done = true; break; }
    await sleep(250);
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  check(
    "GP-1: valley 80ms tap ends the run by itself",
    done && finalState?.settled === true,
    `done=${finalState?.done} settled=${finalState?.settled} |v|=${finalState ? Math.hypot(finalState.vel.x, finalState.vel.y).toFixed(3) : "?"} after ${secs}s`,
  );

  // The Finish pulse cue: hold 'w' on the fresh run — the ball pins against
  // the far slope near-still (|v| < 0.2, needle NOT quiet) → after ~3s the
  // Finish button must carry the pulse cue while the run is still live.
  const fresh = await page.evaluate(() => window.__wp1.tilt());
  check("GP-1: fresh run after advance (scorecard accepted)", fresh.hasRun, `steps=${fresh?.steps}`);

  // GP-1 cue scenario lives on Rosenbrock: holding 'w' pins the ball against
  // the banana's steepening wall (gravity·|∇f| outgrows tiltAccel) — the ball
  // sits near-still (|v| < 0.35) on LOUD ground, so it can't settle and the
  // Finish pulse is the escape. (On the valley a held key accelerates the
  // ball across; the pin is a Rosenbrock/Rastrigin shape.)
  await page.click('#tilt-levels button[data-level="rosen"]');
  await sleep(600);
  const rosen = await page.evaluate(() => window.__wp1.tilt());
  check("GP-1: level 2 (Rosenbrock) live", rosen.level === "rosen", `level=${rosen?.level}`);
  await page.keyboard.down("w");
  // The ball rides to the extent border (~5s) and parks against it; the cue
  // fires ~3s after the near-still state begins.
  await sleep(10000);
  const cue = await page.evaluate(() => ({
    cue: document.querySelector("#tilt-finish")?.dataset.cue ?? null,
    tilt: window.__wp1.tilt(),
  }));
  check(
    "GP-1: Finish button pulses while pinned near-still & unsettled",
    cue.cue === "pulse" && !cue.tilt.done && Math.hypot(cue.tilt.vel.x, cue.tilt.vel.y) < 0.35,
    `cue=${cue.cue} done=${cue.tilt.done} |v|=${Math.hypot(cue.tilt.vel.x, cue.tilt.vel.y).toFixed(3)}`,
  );
  await page.keyboard.up("w");

  // GP-2 also rides on this scene pass: switch to Rastrigin.
  await page.click('#tilt-levels button[data-level="rastr"]');
  await sleep(600);
  const rastr = await page.evaluate(() => window.__wp1.tilt());
  check("GP-2: level 3 (Rastrigin) live", rastr.level === "rastr", `level=${rastr?.level}`);

  // Hold 'w' 250ms — must NOT fly ~5 units (was the repro); allow ≤ 1.5.
  await page.keyboard.down("w");
  await sleep(250);
  const held = await page.evaluate(() => window.__wp1.tilt());
  await page.keyboard.up("w");
  const moved = Math.hypot(held.pos.x - rastr.pos.x, held.pos.y - rastr.pos.y);
  check(
    "GP-2: 250ms Rastrigin hold is a nudge",
    moved > 0.1 && moved <= 1.5,
    `moved=${moved.toFixed(2)} (was ~5), |v|=${Math.hypot(held.vel.x, held.vel.y).toFixed(2)}`,
  );

  // While the ball is pinned near-still (|v| < 0.35, needle loud), the Finish
  // button should pulse after ~3s — verified on Rosenbrock above. Here the
  // Rastrigin tap must simply settle after release (the slide-back ring-down
  // takes ~7s; allow 14s).
  await sleep(14000);
  const cueCleared = await page.evaluate(() => {
    const t = window.__wp1.tilt();
    return { cue: document.querySelector("#tilt-finish")?.dataset.cue ?? null, done: t.done };
  });
  check(
    "GP-1/GP-2: after the nudge the Rastrigin run settles (no 25s hang)",
    cueCleared.done === true,
    `done=${cueCleared.done} cue=${cueCleared.cue}`,
  );
  await page.close();
}

/* ---------------- GP-3: dials-off scoreboard ---------------- */
{
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  await page.goto(`${base}/?step=22`, { waitUntil: "load" });
  await waitIdle(page);
  await sleep(400);
  // β = 0, normalize off, clip off — the GP-3 repro.
  await page.evaluate(() => {
    const set = (sel, v) => {
      const el = document.querySelector(sel);
      el.value = String(v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    set("#rule-beta", 0);
    set("#rule-clip", 0);
    const norm = document.querySelector("#rule-norm");
    norm.checked = false;
    norm.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await sleep(800);
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll("#rule-score-body-a tr")].map((tr) =>
      tr.textContent.replace(/\s+/g, " ").trim(),
    ),
  );
  const custom = rows.find((r) => r.startsWith("your rule")) ?? "";
  const gd = rows.find((r) => r.startsWith("GD")) ?? "";
  check(
    "GP-3: parts-off row reads 'diverged', not 'Infinity'",
    custom.includes("diverged") && !custom.includes("Infinity"),
    custom || "no rows",
  );
  check(
    "GP-3: GD row still shows a step count (machine η ≠ dial η)",
    /\d+/.test(gd.replace("GD", "")),
    gd || "no GD row",
  );
  await page.close();
}

/* ---------------- fogc-speed-clock: transport speed vs ghost race ---------------- */
{
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  await page.goto(`${base}/?step=16`, { waitUntil: "load" });
  await waitIdle(page);
  await sleep(300);

  // Play the blind run: three committed arrow drags on the compass minimap,
  // then Finish. (Drags on the minimap canvas surface; long strides commit.)
  const mm = await page.locator("#minimap-canvas").boundingBox();
  check("fog: minimap visible for arrow drawing", mm !== null && mm.width > 50);
  const dragArrow = async (fx, fy, tx, ty) => {
    await page.mouse.move(mm.x + mm.width * fx, mm.y + mm.height * fy);
    await page.mouse.down();
    await page.mouse.move(mm.x + mm.width * tx, mm.y + mm.height * ty, { steps: 8 });
    await page.mouse.up();
    await sleep(700); // the walk animation commits the step
  };
  await dragArrow(0.12, 0.3, 0.75, 0.62);
  await dragArrow(0.2, 0.35, 0.72, 0.6);
  await dragArrow(0.25, 0.4, 0.7, 0.58);
  const fogMid = await page.evaluate(() => window.__wp1.fog());
  check("fog: strides committed (path grew)", fogMid && fogMid.pathLen >= 3, `pathLen=${fogMid?.pathLen} used=${fogMid?.used}`);
  await page.evaluate(() => document.querySelector("#fog-finish").click());
  await sleep(1200);

  // To the reveal step (fog-c) via the rail, then wait for the cinematic.
  await page.evaluate(() => {
    const rail = document.querySelectorAll("#rail button");
    rail[17].click();
  });
  await waitIdle(page);
  // Wait for the ghost race to finish on its own (1×).
  let played = false;
  for (let i = 0; i < 80; i++) {
    const f = await page.evaluate(() => window.__wp1.fog());
    if (f && !f.ghostsPlaying) { played = true; break; }
    await sleep(250);
  }
  check("fog: ghost race launched and drained at 1×", played);

  // ↻ Replay then 2×: race must end with scrub at 1000 AND Play must relaunch.
  await page.locator("#replay-btn").click();
  await sleep(400);
  await page.locator('#speed-wrap button[data-speed="2"]').click();
  await sleep(300);
  const started = await page.evaluate(() => window.__wp1.fog());
  check("fog: replay running at 2×", started?.ghostsPlaying === true);
  const t0 = Date.now();
  let ended = null;
  while (Date.now() - t0 < 20000) {
    ended = await page.evaluate(() => ({
      playing: window.__wp1.fog()?.ghostsPlaying ?? false,
      scrub: Number(document.querySelector("#replay-scrub")?.value ?? -1),
      label: document.querySelector("#play-btn")?.textContent ?? "",
    }));
    if (!ended.playing) break;
    await sleep(120);
  }
  const wall = ((Date.now() - t0) / 1000).toFixed(1);
  check(
    "fog-c 2×: race ends with the scrub bar full",
    ended?.scrub === 1000,
    `scrub=${ended?.scrub} label="${ended?.label}" after ${wall}s at 2×`,
  );
  await sleep(1200);
  const settledState = await page.evaluate(() => ({
    scrub: Number(document.querySelector("#replay-scrub")?.value ?? -1),
    label: document.querySelector("#play-btn")?.textContent ?? "",
  }));
  check(
    "fog-c 2×: end state holds (no frozen 68% bar)",
    settledState.scrub === 1000,
    `scrub=${settledState.scrub} label="${settledState.label}"`,
  );
  // The dead-Play bug: clicking ▶ after the race must RELAUNCH from the top
  // (before the fix it hit the resume branch and nothing moved).
  await page.locator("#play-btn").click();
  await sleep(800);
  const relaunched = await page.evaluate(() => ({
    playing: window.__wp1.fog()?.ghostsPlaying ?? false,
    scrub: Number(document.querySelector("#replay-scrub")?.value ?? -1),
  }));
  check(
    "fog-c 2×: ▶ after the race relaunches from the top",
    relaunched.playing === true && relaunched.scrub < 900,
    `playing=${relaunched.playing} scrub=${relaunched.scrub}`,
  );
  await page.waitForFunction(() => (window.__wp1.fog()?.ghostsPlaying ?? false) === false, null, { timeout: 25000 }).catch(() => {});
  await sleep(300);

  // 0.5×: the bar must never read 1000 while balls are still rolling.
  await page.locator("#replay-btn").click();
  await sleep(300);
  await page.locator('#speed-wrap button[data-speed="05"]').count().then(async (n) => {
    if (!n) await page.locator('#speed-wrap button[data-speed="0.5"]').click();
    else await page.locator('#speed-wrap button[data-speed="05"]').click();
  });
  await sleep(300);
  let bad = 0;
  let samples = 0;
  const t1 = Date.now();
  while (Date.now() - t1 < 40000) {
    const s = await page.evaluate(() => ({
      playing: window.__wp1.fog()?.ghostsPlaying ?? false,
      scrub: Number(document.querySelector("#replay-scrub")?.value ?? -1),
    }));
    samples += 1;
    if (s.playing && s.scrub >= 1000) bad += 1;
    if (!s.playing && s.scrub >= 1000) break;
    await sleep(200);
  }
  const s2 = await page.evaluate(() => ({
    playing: window.__wp1.fog()?.ghostsPlaying ?? false,
    scrub: Number(document.querySelector("#replay-scrub")?.value ?? -1),
  }));
  check(
    "fog-c 0.5×: bar never fills while balls still roll, fills at the end",
    bad === 0 && !s2.playing && s2.scrub === 1000,
    `badSamples=${bad}/${samples} end scrub=${s2.scrub} playing=${s2.playing}`,
  );
  await page.close();
}

await browser.close();
console.log(failures === 0 ? "VERIFY_GAMES_OK" : `VERIFY_GAMES_FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
