/**
 * verify-cycleb.mjs — targeted browser verification for cycle B round 1:
 *   student-1  fog-c with a scrolled-through run stages an honest empty-run
 *              reveal (no trap narrative, no fake ghost); a played run keeps
 *              the full four-ghost reveal
 *   student-2  tilt attract pose frozen at 0 steps until first key; Restart
 *              run resets a steered run; unsteered tilt-b verdict honest
 *   swarm      playing flips false once every ball parks; blind rewind re-arms
 *   critic-gdd live gd-d stages four curated lanes; Play rides 4 lanes
 *   critic-labrule-clip  scorecard clears the footer at 1280×720 / 1100×700
 *   critic-tilt-verdict  no "and … and" in the tilt verdict
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

/* ---------------- student-2: tilt attract freeze + restart ---------------- */
{
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  await page.goto(`${base}/?step=18`, { waitUntil: "load" });
  await waitIdle(page);
  await sleep(400);
  const t0 = await page.evaluate(() => window.__wp1.tilt());
  await sleep(2500);
  const t1 = await page.evaluate(() => window.__wp1.tilt());
  check(
    "student-2: attract pose frozen — 0 steps before any keypress, still 0 after 2.5s",
    t0.steps === 0 && t1.steps === 0 && !t1.steered,
    `steps at entry=${t0.steps} after 2.5s=${t1.steps} steered=${t1.steered} (was 216→585)`,
  );
  check(
    "student-2: Restart hidden while unsteered",
    await page.evaluate(() => document.querySelector("#tilt-restart")?.hidden ?? true),
  );

  // First real input: physics begins.
  await page.keyboard.down("d");
  await sleep(700);
  const t2 = await page.evaluate(() => window.__wp1.tilt());
  await page.keyboard.up("d");
  check(
    "student-2: first keypress starts the ride",
    t2.steered === true && t2.steps > 30,
    `steered=${t2.steered} steps=${t2.steps}`,
  );
  check(
    "student-2: Restart visible on a steered live run",
    await page.evaluate(() => document.querySelector("#tilt-restart")?.hidden === false),
  );

  // Restart zeroes everything.
  await page.evaluate(() => document.querySelector("#tilt-restart").click());
  await sleep(400);
  const t3 = await page.evaluate(() => window.__wp1.tilt());
  check(
    "student-2: Restart resets to a fresh frozen run",
    t3.steps === 0 && t3.cells === 1 && !t3.steered && Math.hypot(t3.vel.x, t3.vel.y) < 0.01,
    `steps=${t3.steps} cells=${t3.cells} steered=${t3.steered}`,
  );

  // Rail to tilt-b without ever playing: honest verdict, "you (no run)" row.
  await page.evaluate(() => document.querySelectorAll("#rail button")[20].click());
  await waitIdle(page);
  await sleep(800);
  const verdict = await page.evaluate(() => ({
    v: document.querySelector("#tilt-verdict")?.textContent ?? "",
    row: document.querySelector("#tilt-scorecard-body tr")?.textContent ?? "",
    done: window.__wp1.tilt().done,
  }));
  check(
    "student-2: unsteered tilt-b verdict is honest",
    verdict.v.includes("never tilted") && verdict.row.includes("you (no run)"),
    `verdict="${verdict.v.slice(0, 90)}…" row="${verdict.row.slice(0, 40)}"`,
  );

  // Back on tilt-a: full-press run → finish → "all three optimizers".
  await page.evaluate(() => document.querySelectorAll("#rail button")[18].click());
  await waitIdle(page);
  await sleep(400);
  await page.keyboard.down("d");
  await sleep(900);
  await page.keyboard.up("d");
  await page.evaluate(() => document.querySelector("#tilt-finish").click());
  await sleep(400);
  const v2 = await page.evaluate(() => document.querySelector("#tilt-verdict")?.textContent ?? "");
  check(
    "critic-tilt-verdict: all-three case reads 'all three optimizers reached a minimum'",
    v2.includes("all three optimizers reached a minimum") && !v2.includes("and momentum and"),
    `verdict="${v2.slice(0, 110)}…"`,
  );
  await page.close();
}

/* ---------------- student-1: fog-c with a scrolled-through run ---------------- */
{
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  // Scroll straight through fog-a/fog-b without touching the compass.
  await page.goto(`${base}/?step=17`, { waitUntil: "load" });
  await waitIdle(page);
  await page.evaluate(() => document.querySelectorAll("#rail button")[17].click());
  await waitIdle(page);
  await sleep(800);
  const fog = await page.evaluate(() => ({
    state: window.__wp1.fog(),
    verdict: document.querySelector("#fog-verdict")?.textContent ?? "",
    row: document.querySelector("#fog-scorecard-body tr")?.textContent ?? "",
    runLeadHidden: document.querySelector("#fog-run-lead")?.hidden ?? null,
    emptyLeadHidden: document.querySelector("#fog-empty-lead")?.hidden ?? null,
    trapHidden: document.querySelector("#fog-trap-note")?.hidden ?? null,
    emptyNoteHidden: document.querySelector("#fog-empty-verdict-note")?.hidden ?? null,
  }));
  check(
    "student-1: untouched run reaches fog-c with used=0",
    fog.state?.used === 0 && fog.state?.done === true,
    `used=${fog.state?.used} done=${fog.state?.done}`,
  );
  check(
    "student-1: scorecard row reads 'you (no run)' and verdict is honest",
    fog.row.includes("you (no run)") && fog.verdict.includes("never took a measurement"),
    `row="${fog.row}" verdict="${fog.verdict.slice(0, 70)}…"`,
  );
  check(
    "student-1: narrative swapped (played-run copy hidden, empty-run copy shown)",
    fog.runLeadHidden === true &&
      fog.emptyLeadHidden === false &&
      fog.trapHidden === true &&
      fog.emptyNoteHidden === false,
    `runLead=${fog.runLeadHidden} emptyLead=${fog.emptyLeadHidden} trap=${fog.trapHidden} emptyNote=${fog.emptyNoteHidden}`,
  );
  check(
    "student-1: no fake player ghost — three machine lanes staged",
    fog.state?.ghosts === 3,
    `ghosts=${fog.state?.ghosts} (played runs keep 4)`,
  );

  // Now play for real: three committed strides → the full four-ghost reveal.
  await page.evaluate(() => document.querySelectorAll("#rail button")[16].click());
  await waitIdle(page);
  await sleep(500);
  const mm = await page.locator("#minimap-canvas").boundingBox();
  const drag = async (fx, fy, tx, ty) => {
    await page.mouse.move(mm.x + mm.width * fx, mm.y + mm.height * fy);
    await page.mouse.down();
    await page.mouse.move(mm.x + mm.width * tx, mm.y + mm.height * ty, { steps: 8 });
    await page.mouse.up();
    await sleep(700);
  };
  await drag(0.12, 0.3, 0.75, 0.62);
  await drag(0.2, 0.35, 0.72, 0.6);
  await drag(0.25, 0.4, 0.7, 0.58);
  await page.evaluate(() => document.querySelector("#fog-finish").click());
  await sleep(900);
  await page.evaluate(() => document.querySelectorAll("#rail button")[17].click());
  await waitIdle(page);
  await sleep(600);
  const played = await page.evaluate(() => ({
    state: window.__wp1.fog(),
    verdict: document.querySelector("#fog-verdict")?.textContent ?? "",
    row: document.querySelector("#fog-scorecard-body tr")?.textContent ?? "",
    trapHidden: document.querySelector("#fog-trap-note")?.hidden ?? null,
  }));
  check(
    "student-1: a played run keeps the four-ghost reveal + played-run narrative",
    played.state?.used === 3 &&
      played.state?.ghosts === 4 &&
      played.row.includes("you (manual run)") &&
      played.trapHidden === false,
    `used=${played.state?.used} ghosts=${played.state?.ghosts} row="${played.row}" trapHidden=${played.trapHidden}`,
  );
  await page.close();
}

/* ---------------- swarm-never-ends ---------------- */
{
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  await page.goto(`${base}/?step=21`, { waitUntil: "load" });
  await waitIdle(page);
  const early = await page.evaluate(() => window.__wp1.swarm());
  check(
    "swarm: flight starts playing",
    early?.playing === true,
    `playing=${early?.playing} time=${early?.time}`,
  );
  // Wait past the completion cutoff (last delay 1.43s + ride 7s = 8.43s).
  await sleep(11000);
  const parked = await page.evaluate(() => window.__wp1.swarm());
  check(
    "swarm: playing flips false once every ball is parked",
    parked?.playing === false && parked.time >= 8.43,
    `playing=${parked?.playing} time=${parked?.time?.toFixed(2)}`,
  );
  // The finale can still re-run: blind toggle rewinds and re-arms.
  await page.evaluate(() => {
    const t = document.querySelector("#swarm-blind");
    t.checked = true;
    t.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await sleep(500);
  const rearmed = await page.evaluate(() => window.__wp1.swarm());
  check(
    "swarm: blind rewind re-arms the flight",
    rearmed?.playing === true && rearmed.time < 1.5,
    `playing=${rearmed?.playing} time=${rearmed?.time?.toFixed(2)}`,
  );
  await page.close();
}

/* ---------------- critic-gdd: four curated lanes ---------------- */
{
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  // LIVE entry (no ?shot): the failing repro. The static stage carries the
  // four curated trails — probed through hover-to-look (the copy's own
  // data-look="trail-gd" span spotlights the whole family).
  await page.goto(`${base}/?step=7`, { waitUntil: "load" });
  await waitIdle(page);
  await sleep(500);
  await page.locator('.rstep[data-active="true"] span[data-look="trail-gd"]').hover();
  await sleep(400);
  const look = await page.evaluate(() => window.__wp1.look());
  check(
    "critic-gdd: live gd-d stages the four-lane family (hover-to-look keeps 4 trails)",
    look?.keptTrails === 4 && look?.active === true,
    `keptTrails=${look?.keptTrails} active=${look?.active} id=${look?.id}`,
  );
  await page.mouse.move(10, 10);
  await page.locator("#play-btn").click();
  await sleep(1500);
  const riding = await page.evaluate(() => window.__wp1.replayInfo());
  check(
    "critic-gdd: Play rides all four lanes (four ball positions)",
    riding?.playing === true && riding?.positions?.length === 4,
    `playing=${riding?.playing} positions=${JSON.stringify(riding?.positions)}`,
  );
  await page.waitForFunction(() => Number(document.querySelector("#replay-scrub")?.value ?? 0) >= 999, null, { timeout: 30000 }).catch(() => {});
  await page.screenshot({ path: "qa/critic-fix/gdd-live-four-lanes.png" });
  check("critic-gdd: screenshot captured", true, "qa/critic-fix/gdd-live-four-lanes.png");
  // Frozen shot also stages the family (same rebuild path).
  await page.goto(`${base}/?shot=gd-d`, { waitUntil: "load" });
  await sleep(1500);
  await page.locator('.rstep[data-active="true"] span[data-look="trail-gd"]').hover();
  await sleep(400);
  const frozenLook = await page.evaluate(() => window.__wp1.look());
  check(
    "critic-gdd: frozen ?shot=gd-d also stages the four lanes",
    frozenLook?.keptTrails === 4,
    `keptTrails=${frozenLook?.keptTrails}`,
  );
  await page.close();
}

/* ---------------- critic-labrule-clip ---------------- */
{
  for (const [w, h] of [[1280, 720], [1100, 700], [1280, 800]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
    await page.goto(`${base}/?step=22`, { waitUntil: "load" });
    await waitIdle(page);
    await sleep(600);
    const r = await page.evaluate(() => {
      const rows = [...document.querySelectorAll("#rule-score-body-a tr")];
      const foot = document.querySelector("#reader-foot")?.getBoundingClientRect();
      const body = document.querySelector("#rule-score-body-a")?.closest(".rstep");
      const lastRowBottom = Math.max(...rows.map((row) => row.getBoundingClientRect().bottom));
      const caption = [...(body?.querySelectorAll("p.caption") ?? [])];
      const captionBottom = Math.max(0, ...caption.map((p) => p.getBoundingClientRect().bottom));
      return { footTop: foot?.top, lastRowBottom, captionBottom, rows: rows.length };
    });
    check(
      `critic-labrule-clip: ${w}×${h} scorecard rows clear the footer`,
      r.lastRowBottom <= r.footTop + 0.5,
      `lastRowBottom=${r.lastRowBottom?.toFixed(0)} footTop=${r.footTop?.toFixed(0)} rows=${r.rows}`,
    );
    check(
      `critic-labrule-clip: ${w}×${h} captions clear the footer`,
      r.captionBottom <= r.footTop + 0.5,
      `captionBottom=${r.captionBottom?.toFixed(0)} footTop=${r.footTop?.toFixed(0)}`,
    );
    await page.screenshot({ path: `qa/critic-fix/labrule-${w}x${h}.png` });
    await page.close();
  }
}

await browser.close();
console.log(failures === 0 ? "VERIFY_CYCLEB_OK" : `VERIFY_CYCLEB_FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
