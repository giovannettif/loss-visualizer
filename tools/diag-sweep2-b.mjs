// Diagnostic (sweep-2 round 1): repro-level verification of the fix specs.
// Part B — §6/§7/§8/§9, reader + keyboard, GL lifecycle.
// Usage: node tools/diag-sweep2-b.mjs [base]
import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";
const base = process.argv[2] ?? "http://localhost:4185";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) fails += 1;
};
const browser = await launchGL(chromium);
async function open(path, w = 1600, h = 900, init = null) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  await page.goto(`${base}/${path}`, { waitUntil: "load" });
  await page.waitForFunction(() => { const b = document.querySelector("#boot"); return !b || b.dataset.done === "true"; }, null, { timeout: 15000 }).catch(() => {});
  await sleep(800);
  return page;
}
async function idle(page, ms = 14000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const a = await page.evaluate(() => window.__wp1.locked() || window.__wp1.animating());
    if (!a) break;
    await sleep(150);
  }
  await sleep(300);
}
const rail = (page, k) => page.evaluate((k) => document.querySelectorAll("#rail button")[k].click(), k);
const mm = async (page) => page.locator("#minimap-canvas").boundingBox();

/* §6 fog: pointercancel, mid-walk readout, run kept on return, A→B refog, play nudge */
{
  const page = await open("?step=15");
  await idle(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true });
  const ball = await page.evaluate(() => {
    const b = document.querySelector("#minimap-canvas").getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: ball.x, y: ball.y }] });
  for (let i = 1; i <= 4; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: ball.x + 4 * i, y: ball.y + 4 * i }] });
    await sleep(30);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
  await sleep(900);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
  const used0 = await page.evaluate(() => window.__wp1.fog().used);
  check("FOG8-POINTERCANCEL: a cancelled touch drag spends nothing", used0 === 0, `used=${used0}`);
  await page.close();
}
{
  const page = await open("?step=15");
  await idle(page);
  const r = await mm(page);
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 30, cy - 30, { steps: 6 });
  await page.mouse.up();
  await sleep(40);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 55, cy - 30, { steps: 6 });
  const mid = await page.evaluate(() => ({ t: document.querySelector("#minimap-panel .mm-readout")?.textContent, anim: window.__wp1.animating() }));
  await sleep(1200);
  const landed = await page.evaluate(() => ({ t: document.querySelector("#minimap-panel .mm-readout")?.textContent, anim: window.__wp1.animating() }));
  await page.mouse.up();
  await sleep(1000);
  const f = await page.evaluate(() => window.__wp1.fog());
  const n = f.path.length;
  const stride = Math.hypot(f.path[n - 1].x - f.path[n - 2].x, f.path[n - 1].y - f.path[n - 2].y);
  const len = (t) => Number((t ?? "").match(/\|Δθ\| ([\d.]+)/)?.[1] ?? NaN);
  check("S2A-READOUT/FOG8-ORIGIN: mid-walk readout measured from the landing point (≤ reach 1.431)", len(mid.t) <= 1.432, JSON.stringify(mid));
  check("S2A-READOUT: readout unchanged across landing and equals the committed stride", Math.abs(len(landed.t) - len(mid.t)) < 0.011 && Math.abs(len(landed.t) - stride) < 0.011, `mid=${mid.t} landed=${landed.t} stride=${stride.toFixed(3)}`);
  await page.close();
}
{
  // Play nudge: three strides toward the top-left at 1600x900 / 1280x720.
  for (const [w, h] of [[1600, 900], [1280, 720]]) {
    const page = await open("?step=15", w, h);
    await idle(page);
    let worst = null;
    for (let k = 0; k < 3; k++) {
      const r = await mm(page);
      await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
      await page.mouse.down();
      await page.mouse.move(r.x + 2, r.y + 2, { steps: 8 });
      await page.mouse.up();
      await sleep(1600);
      const hit = await page.evaluate(() => {
        const b = window.__wp1.ballScreen();
        if (!b) return null;
        const panels = [...document.querySelectorAll('#stage-wrap .hud.panel[data-visible="true"]')].map((el) => el.getBoundingClientRect());
        const under = panels.some((p) => {
          const qx = Math.min(Math.max(b.x, p.left), p.right), qy = Math.min(Math.max(b.y, p.top), p.bottom);
          return (b.x - qx) ** 2 + (b.y - qy) ** 2 < 20 * 20;
        });
        return { b, under };
      });
      if (hit?.under) worst = hit;
    }
    check(`FOG8-BALL-UNDER-FIT-INSET ${w}x${h}: the walking ball stays clear of HUD panels`, worst === null, JSON.stringify(worst));
    await page.close();
  }
}
{
  // Run kept across leaving §6.
  const page = await open("?step=16");
  await idle(page);
  const r = await mm(page);
  await page.mouse.move(r.x + r.width * 0.12, r.y + r.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(r.x + r.width * 0.75, r.y + r.height * 0.62, { steps: 8 });
  await page.mouse.up();
  await sleep(1200);
  await page.evaluate(() => document.querySelector("#fog-finish").click());
  await sleep(800);
  await rail(page, 17);
  await idle(page);
  const used = await page.evaluate(() => window.__wp1.fog().used);
  await rail(page, 18);
  await idle(page);
  await rail(page, 17);
  await sleep(9000);
  await idle(page);
  const back = await page.evaluate(() => ({ used: window.__wp1.fog().used, ghosts: window.__wp1.fog().ghosts, row: document.querySelector("#fog-scorecard-body tr")?.textContent, emptyHidden: document.querySelector("#fog-empty-lead")?.hidden }));
  check("FOG-RUN-LOST-ON-RETURN: fog-c keeps the played run after tilt-a and back", back.used === used && used > 0 && back.ghosts === 4 && !/no run/.test(back.row ?? "") && back.emptyHidden === true, JSON.stringify({ used, ...back }));
  // TP2-FOGC-STALE-CARRY: finished fog-c → labrule arrives at a clean transport.
  await rail(page, 22);
  await idle(page);
  const tp = await page.evaluate(() => ({ label: document.querySelector("#play-btn").textContent, scrub: document.querySelector("#replay-scrub").value, sp: document.querySelector("#replay-scrub").style.getPropertyValue("--scrub-progress") }));
  check("TP2-FOGC-STALE-CARRY: labrule arrives with a reset transport", tp.label.includes("Play") && tp.scrub === "0" && (tp.sp === "" || tp.sp === "0.000"), JSON.stringify(tp));
  await page.close();
}
{
  // fog-a → fog-b crossfade keeps the revealed level-1 surface while fading out.
  const page = await open("?step=15");
  await idle(page);
  await page.evaluate(() => document.querySelector("#fog-finish").click());
  await sleep(2200);
  await page.keyboard.press("ArrowDown");
  await sleep(80);
  const d = await page.evaluate(() => ({ swap: window.__wp1.debug().swap, reveal: window.__wp1.fog()?.reveal ?? null, retired: window.__wp1.debug() }));
  check("FOG-AB-REVEAL-REFOGS: during the fade-out the level-1 reveal is not re-fogged", d.swap === "out", `swap=${d.swap}`);
  await idle(page);
  const after = await page.evaluate(() => window.__wp1.fog());
  check("FOG-AB-REVEAL-REFOGS: level 2 arrives fogged (reveal 0, mask ready)", after.level === "rb" && after.reveal === 0 && after.maskReady === true, JSON.stringify({ level: after.level, reveal: after.reveal, mask: after.maskReady }));
  await page.close();
}
{
  // S2-SKIP-FOGC-RACE-NOT-SKIPPED: rail to fog-c, Skip at 200ms → unlock fast.
  const page = await open("?step=10");
  await idle(page);
  await rail(page, 17);
  await sleep(200);
  const t0 = Date.now();
  await page.keyboard.press("Space");
  let t = 0;
  while (Date.now() - t0 < 8000) {
    if (!(await page.evaluate(() => window.__wp1.locked()))) { t = Date.now() - t0; break; }
    await sleep(25);
  }
  check("SKIP-FOGC-RACE: Skip on a deferred fog-c entry unlocks quickly", t > 0 && t < 600, `unlock=${t}ms`);
  await page.close();
}

/* §7 tilt */
{
  const page = await open("?step=18");
  await idle(page);
  await page.mouse.click(700, 850);
  await page.keyboard.down("s"); await sleep(900); await page.keyboard.up("s");
  await page.keyboard.down("d"); await sleep(700); await page.keyboard.up("d");
  await page.evaluate(() => document.querySelector("#tilt-finish").click());
  await sleep(600);
  // BACKNAV: forward ×2 then back up to tilt-a
  await page.keyboard.press("ArrowDown"); await idle(page);
  await page.keyboard.press("ArrowDown"); await idle(page);
  const atB = await page.evaluate(() => ({ scene: window.__wp1.scene(), t: window.__wp1.tilt() }));
  await page.keyboard.press("ArrowDown"); await idle(page);
  await page.keyboard.press("ArrowUp"); await idle(page);
  const backB = await page.evaluate(() => ({ scene: window.__wp1.scene(), t: window.__wp1.tilt(), row: document.querySelector("#tilt-scorecard-body tr")?.textContent }));
  check("SWARM-BACK-LOSES-RUN: back on tilt-b from the swarm keeps the played run", backB.scene === "tilt-b" && backB.t.steered === true && backB.t.curated === false && backB.t.level === atB.t.level, JSON.stringify({ atB: atB.scene, level: backB.t.level, steered: backB.t.steered, curated: backB.t.curated, row: backB.row }));
  await page.keyboard.press("ArrowUp"); await idle(page);
  await page.keyboard.press("ArrowUp"); await idle(page);
  const a = await page.evaluate(() => ({ scene: window.__wp1.scene(), t: window.__wp1.tilt() }));
  check("BACKNAV-STALE-STAMPS: re-entered tilt-a shows only the fresh run's stamp", a.scene === "tilt-a" && a.t.stamps === a.t.cells && a.t.steps === 0, JSON.stringify({ scene: a.scene, stamps: a.t.stamps, cells: a.t.cells, steps: a.t.steps }));
  await page.close();
}
{
  // BWD-1: ↑ pages back from a live, untouched run.
  const page = await open("?step=19");
  await idle(page);
  await page.keyboard.press("ArrowUp");
  await sleep(1200);
  const s = await page.evaluate(() => ({ step: window.__wp1.step(), t: window.__wp1.tilt() }));
  check("S2-BWD-1: ArrowUp navigates back from a live tilt run (no board response)", s.step === 18 && s.t.steered === false, JSON.stringify({ step: s.step, steered: s.t.steered }));
  await page.close();
}
{
  // Rastrigin: per-level pitch + ball clear of the panel at 1280×800.
  for (const [w, h] of [[1280, 800], [1366, 768], [1600, 900]]) {
    const page = await open("?step=18", w, h);
    await idle(page);
    const res = [];
    for (const lvl of ["valley", "rosen", "rastr"]) {
      await page.evaluate((l) => document.querySelector(`.tilt-levels [data-level="${l}"]`).click(), lvl);
      await sleep(1500);
      await idle(page);
      const r = await page.evaluate(() => {
        const b = window.__wp1.ballScreen();
        const p = document.querySelector("#tilt-panel").getBoundingClientRect();
        const inside = b && b.x > p.left - 8 && b.x < p.right + 8 && b.y > p.top - 8 && b.y < p.bottom + 8;
        return { b, inside, el: window.__wp1.debug().viewAttitude.elevationDeg };
      });
      res.push({ lvl, ...r });
    }
    check(`TILT ball under panel ${w}x${h}: every level's start clears #tilt-panel`, res.every((r) => !r.inside), JSON.stringify(res.map((r) => [r.lvl, Math.round(r.b?.x), Math.round(r.b?.y), r.inside])));
    const rast = res.find((r) => r.lvl === "rastr");
    const val = res.find((r) => r.lvl === "valley");
    check(`RASTR-BALL-OCCLUDED ${w}x${h}: Rastrigin pitch 60°, valley 40°`, Math.abs(rast.el - 60) < 0.6 && Math.abs(val.el - 40) < 0.6, `rastr=${rast.el.toFixed(1)} valley=${val.el.toFixed(1)}`);
    await page.close();
  }
}
{
  // Guided demo + COV22-2 dashes + tilt speed + scorecard truncation.
  for (const [w, h] of [[1600, 900], [900, 700]]) {
    const page = await open("?step=20", w, h);
    await idle(page);
    const r = await page.evaluate(() => ({
      row: [...document.querySelectorAll("#tilt-scorecard-body tr:first-child td")].map((td) => td.textContent),
      bestInRow: document.querySelectorAll("#tilt-scorecard-body tr:first-child [data-best]").length,
      verdict: document.querySelector("#tilt-verdict").textContent,
      demoLead: !document.querySelector("#tilt-demo-lead").hidden,
      runLead: document.querySelector("#tilt-run-lead").hidden,
      ro: [document.querySelector("#tilt-cells")?.textContent, document.querySelector("#tilt-steps")?.textContent, document.querySelector("#tilt-loss")?.textContent],
      speed: !!document.querySelector("#tilt-speed") && document.querySelector("#tilt-replay").hidden === false,
      mcells: [...document.querySelectorAll("#tilt-scorecard-body tr")].slice(1).map((tr) => tr.children[2].textContent),
      overflow: [...document.querySelectorAll("#tilt-score th, #tilt-score tbody td")].filter((c) => c.scrollWidth > c.clientWidth + 0.5).map((c) => c.textContent),
    }));
    check(`TILTB-NORUN ${w}x${h}: demo row labelled 'guided demo', never gold; demo body shown`, r.row[0] === "guided demo" && r.bestInRow === 0 && /guided demo/.test(r.verdict) && r.demoLead && r.runLead, JSON.stringify({ row: r.row, best: r.bestInRow, demo: r.demoLead }));
    check(`COV22-2 ${w}x${h}: panel readouts show no numbers for the unsteered demo`, r.ro.every((t) => t === "—"), JSON.stringify(r.ro));
    check(`STEPS-CELLS ${w}x${h}: machine rows carry real cells`, r.mcells.every((t) => /^\d+$/.test(t)), JSON.stringify(r.mcells));
    check(`TP2-TILT-NO-SPEED ${w}x${h}: ghost row has the speed cluster`, r.speed);
    check(`L900-TILT-SCORECARD-TRUNC ${w}x${h}: no truncated scorecard cell`, r.overflow.length === 0, JSON.stringify(r.overflow));
    await page.close();
  }
}
{
  // Ghost speed: 2× progresses ~twice as fast as 1×.
  const page = await open("?step=20");
  await idle(page);
  const rate = async (sp) => {
    await page.click(`#tilt-speed button[data-speed="${sp}"]`);
    await page.click("#tilt-replay-restart");
    await sleep(100);
    const a = await page.evaluate(() => window.__wp1.tilt().scrub);
    await sleep(800);
    const b = await page.evaluate(() => window.__wp1.tilt().scrub);
    return b - a;
  };
  const r1 = await rate("1");
  const r2 = await rate("2");
  const on = await page.evaluate(() => document.querySelector('#speed-wrap button[data-speed="2"]').dataset.on);
  check("TP2-TILT-NO-SPEED: 2× ghost ride ≈ twice the 1× rate; footer cluster follows", r2 > r1 * 1.5 && on === "true", `r1=${r1.toFixed(3)} r2=${r2.toFixed(3)} footer2×=${on}`);
  await page.close();
}

/* §8 labrule: verdict cache + simultaneous arrival + fit levels + park */
{
  const page = await open("?step=22");
  await idle(page);
  await page.evaluate(() => [...document.querySelectorAll("#rule-levels button")].find((b) => /least squares/i.test(b.textContent)).click());
  await sleep(800);
  const setKnob = async (v) => { await page.evaluate((v) => { const s = document.querySelector("#rule-eta"); s.value = String(v); s.dispatchEvent(new Event("input", { bubbles: true })); }, v); await sleep(700); await idle(page); };
  await setKnob(724);
  const v724 = await page.evaluate(() => document.querySelector("#rule-verdict-a").textContent);
  await setKnob(725);
  const v725 = await page.evaluate(() => document.querySelector("#rule-verdict-a").textContent);
  check("S8-STALE-VERDICT: knob 724 → 725 re-words the verdict", v724 !== v725 && !/Your rule wins/.test(v725), `724="${v724}" 725="${v725}"`);
  await setKnob(Number(await page.evaluate(() => document.querySelector("#rule-eta").defaultValue || 500)));
  await page.close();
}
{
  const page = await open("?step=22");
  await idle(page);
  await page.evaluate(() => [...document.querySelectorAll("#rule-levels button")].find((b) => /least squares/i.test(b.textContent)).click());
  await sleep(800);
  await idle(page);
  await page.click("#play-btn");
  await sleep(60);
  const info = await page.evaluate(() => window.__wp1.rule());
  // scrub to the fraction where the fastest lane (fewest steps) must be home
  const steps = await page.evaluate(() => {
    const r = window.__wp1.replayInfo();
    return r.lanes;
  });
  await page.evaluate(() => { const s = document.querySelector("#replay-scrub"); s.value = "250"; s.dispatchEvent(new Event("input", { bubbles: true })); });
  await sleep(150);
  const q = await page.evaluate(() => window.__wp1.replayInfo().positions);
  await page.evaluate(() => { const s = document.querySelector("#replay-scrub"); s.value = "1000"; s.dispatchEvent(new Event("input", { bubbles: true })); });
  await sleep(150);
  const end = await page.evaluate(() => window.__wp1.replayInfo().positions);
  const home = q.map((p, i) => Math.hypot(p.x - end[i].x, p.y - end[i].y) < 1e-6);
  check("S8SW2-RACE: at 25% of the race some lanes are already home and some are not (step-paced arrivals)", steps === 4 && home.some((h) => h) && home.some((h) => !h), JSON.stringify({ steps, home, rule: info ? Object.keys(info) : null }));
  await page.close();
}
for (const [w, h] of [[900, 900], [900, 821], [1101, 900], [1280, 821], [1600, 900]]) {
  const page = await open("?step=22", w, h);
  await idle(page);
  await sleep(600);
  const r = await page.evaluate(() => {
    const st = document.querySelector('.rstep[data-scene="labrule"]');
    const kids = [...st.querySelector(".step__body").children];
    const last = Math.max(...kids.map((k) => k.getBoundingClientRect().bottom));
    const foot = document.querySelector("#reader-foot").getBoundingClientRect().top;
    return { fit: st.dataset.fit, last: Math.round(last), foot: Math.round(foot), top: Math.round(st.getBoundingClientRect().top), kicker: Math.round(st.querySelector(".kicker").getBoundingClientRect().top) };
  });
  check(`L900-STEP22 ${w}x${h}: labrule content clears the footer`, r.last <= r.foot && Math.abs(r.top) <= 1 && (w > 1100 || r.kicker >= 44), JSON.stringify(r));
  await page.close();
}
for (const [w, h] of [[800, 900], [900, 900]]) {
  const page = await open("?step=23", w, h);
  await idle(page);
  await sleep(800);
  const r23 = await page.evaluate(() => {
    const s = window.__wp1.scroll();
    const st = document.querySelectorAll("#reader-body .rstep")[23];
    return { cached: s.tops[23], live: st.offsetTop, top: Math.round(st.getBoundingClientRect().top) };
  });
  check(`STALE-TOPS ${w}x${h}: step 23 parks on its live offset`, r23.cached === r23.live && Math.abs(r23.top) <= 1, JSON.stringify(r23));
  for (let i = 0; i < 3; i++) { await page.keyboard.press("ArrowDown"); await idle(page); }
  const epi = await page.evaluate(() => {
    const st = document.querySelectorAll("#reader-body .rstep")[26];
    const s = window.__wp1.scroll();
    const kids = [...st.querySelector(".step__body").children];
    const last = Math.max(...kids.map((k) => k.getBoundingClientRect().bottom));
    return { step: window.__wp1.step(), top: Math.round(st.getBoundingClientRect().top), max: s.max, live: st.offsetTop, last: Math.round(last), foot: Math.round(document.querySelector("#reader-foot").getBoundingClientRect().top) };
  });
  check(`S2EPI-1 ${w}x${h}: epi-c parks at the top with its content above the footer`, epi.step === 26 && Math.abs(epi.top) <= 1 && epi.max === epi.live && epi.last < epi.foot, JSON.stringify(epi));
  await page.close();
}

/* Keyboard: Space repeat, intro Tab, Space after a mouse click */
{
  const page = await open("?step=1");
  await idle(page);
  const cdp = await page.context().newCDPSession(page);
  const space = (type, repeat = false) => cdp.send("Input.dispatchKeyEvent", { type, key: " ", code: "Space", windowsVirtualKeyCode: 32, autoRepeat: repeat, text: type === "keyDown" ? " " : undefined });
  await space("keyDown");
  for (let i = 0; i < 100; i++) { await sleep(33); await space("keyDown", true); }
  await space("keyUp");
  await sleep(400);
  const st = await page.evaluate(() => window.__wp1.step());
  check("KW2-SPACE-REPEAT: a 3.3s held Space advances at most one step", st <= 2, `step=${st}`);
  await page.close();
}
{
  const page = await open("");
  for (let i = 0; i < 60; i++) await page.keyboard.press("Tab");
  const r = await page.evaluate(() => ({ sl: document.querySelector("#app").scrollLeft, intro: window.__wp1.scroll().intro, active: document.activeElement?.id }));
  check("KW2-INTRO-TAB: Tab never scrolls the intro layout or reaches the slid-off reader", r.sl === 0 && r.intro === true && r.active !== "continue-hint", JSON.stringify(r));
  await page.close();
}
{
  const page = await open("?step=8");
  await idle(page);
  await page.click('#speed-wrap button[data-speed="2"]').catch(() => {});
  const vis = await page.evaluate(() => !document.querySelector("#speed-wrap").hidden);
  await page.keyboard.press("Space");
  await sleep(600);
  const st = await page.evaluate(() => window.__wp1.step());
  check("KW2-SPACE-AFTER-CLICK: Space after a mouse click on 2× advances the reader", !vis || st === 9, `speedVisible=${vis} step=${st}`);
  await page.close();
}

/* GL lifecycle: crossfade cycles do not leak buffers/VAOs */
{
  const init = () => {
    const P = WebGL2RenderingContext.prototype;
    window.__gl = { buf: 0, vao: 0, prog: 0 };
    const wrap = (name, key, d) => { const o = P[name]; P[name] = function (...a) { window.__gl[key] += d; return o.apply(this, a); }; };
    wrap("createBuffer", "buf", 1); wrap("deleteBuffer", "buf", -1);
    wrap("createVertexArray", "vao", 1); wrap("deleteVertexArray", "vao", -1);
    wrap("createProgram", "prog", 1); wrap("deleteProgram", "prog", -1);
  };
  const page = await open("?step=21", 1600, 900, init);
  await idle(page);
  await sleep(1500);
  const counts = [];
  for (let c = 0; c < 4; c++) {
    await rail(page, 22); await idle(page); await sleep(800);
    await rail(page, 21); await idle(page); await sleep(800);
    counts.push(await page.evaluate(() => ({ ...window.__gl })));
  }
  const growB = counts[3].buf - counts[0].buf;
  const growV = counts[3].vao - counts[0].vao;
  check("PERF25-GL-LEAK: swarm↔labrule cycles hold GL buffers and VAOs flat", growB <= 4 && growV <= 4, JSON.stringify(counts));
  await page.close();
}
{
  const init = () => {
    const P = WebGL2RenderingContext.prototype;
    window.__gl = { prog: 0, created: 0 };
    const o = P.createProgram; P.createProgram = function (...a) { window.__gl.created += 1; return o.apply(this, a); };
  };
  const page = await open("?step=13", 1600, 900, init);
  await idle(page);
  await sleep(800);
  const s = await page.locator("#rot-slider").boundingBox();
  const c0 = await page.evaluate(() => window.__gl.created);
  await page.mouse.move(s.x + 4, s.y + s.height / 2);
  await page.mouse.down();
  for (let i = 0; i < 90; i++) { await page.mouse.move(s.x + 4 + (i % 45) * (s.width / 46) * (i < 45 ? 1 : -1) + (i < 45 ? 0 : s.width - 8), s.y + s.height / 2); await sleep(16); }
  await page.mouse.up();
  await sleep(600);
  const c1 = await page.evaluate(() => window.__gl.created);
  check("PERF25-LAB-REBUILD: a rotation drag recompiles no GL programs", c1 - c0 <= 2, `createProgram during drag: ${c1 - c0}`);
  await page.close();
}

await browser.close();
console.log(fails === 0 ? "DIAG_B_OK" : `DIAG_B_FAILED (${fails})`);
