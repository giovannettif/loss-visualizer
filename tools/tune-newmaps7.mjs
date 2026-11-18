/**
 * tune-newmaps7.mjs — canyon B=8 (no quartic) retune: peaks are true 2D
 * summits; tilt gravity/machines + rule-lab benchmark for the new walls.
 */
const A = 2.6, B = 8, W = 1.5, K = 1.05, PAR = 0.15;
const PK = [
  { x: -1.3, y: -0.3145, p: 15, s: 0.6 },
  { x: 1.85, y: 2.811, p: 15, s: 0.6 },
];
const g = (x) => W * Math.sin(K * x) + PAR * x * x;
const gD = (x) => W * K * Math.cos(K * x) + 2 * PAR * x;
function F(px, py) {
  const dx = A - px, dy = py - g(px);
  let v = dx * dx + B * dy * dy;
  for (const k of PK) {
    const ex = px - k.x, ey = py - k.y;
    v += k.p * Math.exp(-(ex * ex + ey * ey) / (k.s * k.s));
  }
  return v;
}
function G(px, py) {
  const dy = py - g(px), g1 = gD(px), wd = 2 * B * dy;
  let gx = -2 * (A - px) - wd * g1, gy = wd;
  for (const k of PK) {
    const ex = px - k.x, ey = py - k.y;
    const e = k.p * Math.exp(-(ex * ex + ey * ey) / (k.s * k.s));
    gx -= (e * 2 * ex) / (k.s * k.s);
    gy -= (e * 2 * ey) / (k.s * k.s);
  }
  return [gx, gy];
}

// peaks: fixed-length climb stays local + stationary
for (const c of PK) {
  let x = c.x, y = c.y;
  for (let i = 0; i < 400; i++) {
    const [gx, gy] = G(x, y);
    const gn = Math.hypot(gx, gy);
    if (gn < 0.02) break;
    x += (0.01 * gx) / gn; y += (0.01 * gy) / gn;
  }
  const [gx, gy] = G(x, y);
  console.log(`peak (${c.x},${c.y}): summit (${x.toFixed(3)},${y.toFixed(3)}) d=${Math.hypot(x - c.x, y - c.y).toFixed(3)} |g|=${Math.hypot(gx, gy).toFixed(4)} height-over-floor ${(F(x, y) - F(c.x, g(c.x))).toFixed(1)}`);
}
// floor / walls
{
  let maxFloor = -Infinity;
  for (let i = 0; i <= 118; i++) maxFloor = Math.max(maxFloor, F(-2.95 + (i / 118) * 5.75, g(-2.95 + (i / 118) * 5.75)));
  console.log(`floor max ${maxFloor.toFixed(2)}`);
  for (const x of [-2, -1, 0, 1, 2]) {
    for (const side of [1, -1]) {
      const v = F(x, g(x) + side * 1.6);
      if (v <= 20) console.log(`  WALL LOW at x=${x} side=${side}: ${v.toFixed(1)}`);
    }
  }
  console.log("  wall check done");
}
// GD descent checks: from mid-canyon (past the P3 pocket?) + from the mouth
{
  let p = [1.5, g(1.5)];
  for (let i = 0; i < 20000; i++) { const [gx, gy] = G(p[0], p[1]); p[0] -= 0.001 * gx; p[1] -= 0.001 * gy; }
  console.log(`GD 20k from (1.5,g): (${p[0].toFixed(3)},${p[1].toFixed(3)}) f=${F(p[0], p[1]).toFixed(3)} d=${Math.hypot(p[0] - 2.6, p[1] - g(2.6)).toFixed(3)}`);
  let q = [-2.9, g(-2.9)];
  for (let i = 0; i < 30000; i++) { const [gx, gy] = G(q[0], q[1]); q[0] -= 0.001 * gx; q[1] -= 0.001 * gy; }
  console.log(`GD 30k from mouth: (${q[0].toFixed(3)},${q[1].toFixed(3)}) f=${F(q[0], q[1]).toFixed(3)}`);
}

/* tilt */
const TILT_DT = 1 / 120, TILT_SETTLE_SUBSTEPS = 45, TILT_SETTLE_SPEED = 0.25, WALL_BOUNCE = 0.38;
function clampAbs(v, m) { return v > m ? m : v < -m ? -m : v; }
const EXT = { xMin: -3.4, xMax: 3.6, yMin: -3.4, yMax: 3.6 };
const diag = Math.hypot(7, 7);
const LVL = {
  landscape: { extent: EXT, grad: (p) => { const [x, y] = G(p.x, p.y); return { x, y }; }, f: (p) => F(p.x, p.y) },
  start: { x: -2.9, y: 1.1168362202947417 }, goal: { x: 2.6, y: 1.6141042163886286 }, goalFrac: 0.05,
  gravity: 0.08, tiltAccel: 8, vmax: 4, settleGrad: 0.9,
};
function tiltStep(run, input, friction) {
  if (run.done) return;
  const gr = LVL.landscape.grad(run.pos);
  const ax = -gr.x * LVL.gravity + input.x * LVL.tiltAccel - friction * run.vel.x;
  const ay = -gr.y * LVL.gravity + input.y * LVL.tiltAccel - friction * run.vel.y;
  run.vel.x = clampAbs(run.vel.x + ax * TILT_DT, LVL.vmax);
  run.vel.y = clampAbs(run.vel.y + ay * TILT_DT, LVL.vmax);
  run.pos.x += run.vel.x * TILT_DT; run.pos.y += run.vel.y * TILT_DT;
  const e = EXT;
  if (run.pos.x < e.xMin) { run.pos.x = e.xMin; run.vel.x = Math.abs(run.vel.x) * WALL_BOUNCE; }
  else if (run.pos.x > e.xMax) { run.pos.x = e.xMax; run.vel.x = -Math.abs(run.vel.x) * WALL_BOUNCE; }
  if (run.pos.y < e.yMin) { run.pos.y = e.yMin; run.vel.y = Math.abs(run.vel.y) * WALL_BOUNCE; }
  else if (run.pos.y > e.yMax) { run.pos.y = e.yMax; run.vel.y = -Math.abs(run.vel.y) * WALL_BOUNCE; }
  run.steps += 1;
  const gl = Math.hypot(gr.x, gr.y), vl = Math.hypot(run.vel.x, run.vel.y);
  if (gl < LVL.settleGrad && vl < TILT_SETTLE_SPEED) { run.rest += 1; if (run.rest >= TILT_SETTLE_SUBSTEPS) { run.done = true; run.settled = true; } }
  else run.rest = 0;
}
{
  const run = { pos: { ...LVL.start }, vel: { x: 0, y: 0 }, steps: 0, rest: 0, done: false, settled: false };
  const clamp11 = (v) => (v > 1 ? 1 : v < -1 ? -1 : v);
  const cap = 40 / TILT_DT;
  while (run.steps < cap && !run.done) {
    const t = run.steps * TILT_DT;
    const dx = LVL.goal.x - run.pos.x, dy = LVL.goal.y - run.pos.y;
    const l = Math.hypot(dx, dy) || 1;
    const input = l < diag * 0.04 ? { x: 0, y: 0 } : (() => {
      const wobble = 0.3 * Math.sin((2 * Math.PI * t) / 1.7);
      return { x: clamp11(dx / l - (dy / l) * wobble), y: clamp11(dy / l + (dx / l) * wobble) };
    })();
    tiltStep(run, input, 1.2);
  }
  const d = Math.hypot(run.pos.x - LVL.goal.x, run.pos.y - LVL.goal.y);
  console.log(`tilt curated: steps=${run.steps} settled=${run.settled} end=(${run.pos.x.toFixed(2)},${run.pos.y.toFixed(2)}) d=${d.toFixed(3)} ${d < diag * 0.05 ? "REACHED" : "SHORT"}`);
}
function gd(lr) { return { initState(p) { return { pos: { ...p } }; }, step(s, gr) { return { pos: { x: s.pos.x - lr * gr.x, y: s.pos.y - lr * gr.y } }; } }; }
function momentum(lr, beta) {
  return {
    initState(p) { return { pos: { ...p }, velocity: { x: 0, y: 0 } }; },
    step(s, gr) {
      const v = { x: beta * s.velocity.x + gr.x, y: beta * s.velocity.y + gr.y };
      return { pos: { x: s.pos.x - lr * v.x, y: s.pos.y - lr * v.y }, velocity: v };
    },
  };
}
function adam(lr, b1, b2, eps) {
  return {
    initState(p) { return { pos: { ...p }, m: { x: 0, y: 0 }, v: { x: 0, y: 0 }, t: 0 }; },
    step(s, gr) {
      const t = s.t + 1;
      const m = { x: b1 * s.m.x + (1 - b1) * gr.x, y: b1 * s.m.y + (1 - b1) * gr.y };
      const v = { x: b2 * s.v.x + (1 - b2) * gr.x * gr.x, y: b2 * s.v.y + (1 - b2) * gr.y * gr.y };
      const bc1 = 1 - Math.pow(b1, t), bc2 = 1 - Math.pow(b2, t);
      return { pos: { x: s.pos.x - (lr * (m.x / bc1)) / (Math.sqrt(v.x / bc2) + eps), y: s.pos.y - (lr * (m.y / bc1)) / (Math.sqrt(v.y / bc2) + eps) }, m, v, t };
    },
  };
}
{
  for (const [nm, opt] of [["gd 0.001", gd(0.001)], ["gd 0.002", gd(0.002)], ["gd 0.004", gd(0.004)], ["mom 0.002", momentum(0.002, 0.9)], ["mom 0.004", momentum(0.004, 0.9)], ["mom 0.008", momentum(0.008, 0.9)], ["adam 0.05", adam(0.05, 0.9, 0.999, 1e-8)], ["adam 0.08", adam(0.08, 0.9, 0.999, 1e-8)]]) {
    let s = opt.initState(LVL.start);
    const m = 1.05;
    let end = { ...LVL.start }, escaped = false;
    for (let i = 0; i < 400; i++) {
      s = opt.step(s, LVL.landscape.grad(s.pos));
      if (!Number.isFinite(s.pos.x) || !Number.isFinite(s.pos.y)) { escaped = true; break; }
      if (s.pos.x < EXT.xMin * m || s.pos.x > EXT.xMax * m || s.pos.y < EXT.yMin * m || s.pos.y > EXT.yMax * m) { escaped = true; break; }
      end = { ...s.pos };
    }
    const gr = LVL.landscape.grad(end);
    const d = Math.hypot(end.x - LVL.goal.x, end.y - LVL.goal.y);
    console.log(`  tilt ${nm.padEnd(10)} loss ${F(end.x, end.y).toFixed(2)} escaped=${escaped} settled=${!escaped && Math.hypot(gr.x, gr.y) < LVL.settleGrad} reached=${d < diag * 0.05} end=(${end.x.toFixed(2)},${end.y.toFixed(2)})`);
  }
}

/* rule lab */
const GAMMA = 0.999, CEPS = 1e-8;
function customRule(cfg) {
  return {
    initState(p) { return { pos: { ...p }, velocity: { x: 0, y: 0 }, sq: { x: 0, y: 0 }, t: 0 }; },
    step(s, gr) {
      const t = s.t + 1;
      const velocity = { x: cfg.beta * s.velocity.x + gr.x, y: cfg.beta * s.velocity.y + gr.y };
      const sq = { x: GAMMA * s.sq.x + (1 - GAMMA) * gr.x * gr.x, y: GAMMA * s.sq.y + (1 - GAMMA) * gr.y * gr.y };
      let ux, uy;
      if (cfg.normalize) {
        const bc = 1 - Math.pow(GAMMA, t);
        ux = velocity.x / (Math.sqrt(sq.x / bc) + CEPS);
        uy = velocity.y / (Math.sqrt(sq.y / bc) + CEPS);
      } else { ux = velocity.x; uy = velocity.y; }
      let dx = -cfg.lr * ux, dy = -cfg.lr * uy;
      if (cfg.clip != null && cfg.clip > 0) {
        const len = Math.hypot(dx, dy);
        if (len > cfg.clip) { dx *= cfg.clip / len; dy *= cfg.clip / len; }
      }
      return { pos: { x: s.pos.x + dx, y: s.pos.y + dy }, velocity, sq, t };
    },
  };
}
function runRule(opt, threshold) {
  let s = opt.initState(LVL.start);
  let steps = null, end = { ...LVL.start };
  for (let i = 1; i <= 400; i++) {
    s = opt.step(s, LVL.landscape.grad(s.pos));
    if (!Number.isFinite(s.pos.x) || !Number.isFinite(s.pos.y)) break;
    end = { ...s.pos };
    if (F(end.x, end.y) < threshold) { steps = i; break; }
  }
  return { steps, final: F(end.x, end.y), end };
}
const CFG = { lr: 0.5, beta: 0.9, normalize: true, clip: 0.35 };
for (const th of [2.0, 3.0]) {
  console.log(`-- rule canyon threshold ${th}`);
  const rc = runRule(customRule(CFG), th);
  console.log(`  custom: ${rc.steps ?? "DNF"} (final ${rc.final.toFixed(3)})`);
  for (const [nm, opt] of [
    ["gd 0.001", gd(0.001)], ["gd 0.002", gd(0.002)],
    ["mom 0.002", momentum(0.002, 0.9)], ["mom 0.004", momentum(0.004, 0.9)], ["mom 0.008", momentum(0.008, 0.9)],
    ["adam 0.05", adam(0.05, 0.9, 0.999, 1e-8)], ["adam 0.1", adam(0.1, 0.9, 0.999, 1e-8)],
  ]) {
    const r = runRule(opt, th);
    console.log(`  ${nm.padEnd(10)} ${r.steps ?? "DNF"} (final ${r.final.toFixed(3)})`);
  }
}
