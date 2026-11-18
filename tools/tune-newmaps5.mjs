/**
 * tune-newmaps4.mjs — iteration 4 (final tuning pass).
 *
 * archipelago: confinement = bowl 0.02 (interior drainage) + sextic 1e-5·r⁶
 * (steep rim; kills ridge-flank pockets). Strait walls ON the ring (crest
 * r 6.55, covering the along-ring saddle), islands tangent-elongated.
 * canyonPeaks: peak centers at the summit station (dy ±1.05, P 15, s 0.6);
 * the west mouth stays peak-free so machines don't trap at the start.
 */
const DEG = Math.PI / 180;

const ARCHI_WELLS = [
  { name: "the deep atoll", x: -4.6, y: 3.9, depth: 9.6, a: 2.0, b: 0.9, thetaDeg: 50, global: true },
  { name: "the blue hole", x: 5.3, y: -4.6, depth: 8.0, a: 1.8, b: 0.8, thetaDeg: 49 },
  { name: "the lagoon", x: -5.9, y: -3.2, depth: 6.4, a: 2.0, b: 1.0, thetaDeg: -61 },
  { name: "the crater lake", x: 0.6, y: 6.2, depth: 5.2, a: 1.9, b: 0.85, thetaDeg: -6 },
  { name: "the tide pool", x: 2.2, y: 3.0, depth: 1.65, a: 0.7, b: 0.6, thetaDeg: 0 },
  { name: "the cove", x: 6.4, y: 1.6, depth: 4.6, a: 1.9, b: 0.7, thetaDeg: 104 },
  { name: "the skerry", x: -0.4, y: 0.0, depth: 0.5, a: 0.9, b: 0.75, thetaDeg: 25 },
  { name: "the bay", x: -0.8, y: -6.2, depth: 3.45, a: 2.0, b: 0.8, thetaDeg: -7 },
];
const ARCHI_RIDGES = [
  { x: -2.47, y: 6.06, h: 3.2, sL: 1.7, sW: 0.42, thetaDeg: 112 },
  { x: 4.35, y: 5.48, h: 3.0, sL: 1.7, sW: 0.42, thetaDeg: 49 },
  { x: 6.85, y: -1.60, h: 3.2, sL: 1.7, sW: 0.42, thetaDeg: -14 },
  { x: 2.47, y: -6.68, h: 3.0, sL: 1.7, sW: 0.42, thetaDeg: -69 },
  { x: -3.69, y: -5.33, h: 3.2, sL: 1.7, sW: 0.42, thetaDeg: 55 },
  { x: -6.53, y: 0.68, h: 3.4, sL: 1.7, sW: 0.42, thetaDeg: 174 },
];
const ARCHI_BOWL = 0.03;
const ARCHI_K = 1e-5;

function archiF(p) {
  const r2 = p.x * p.x + p.y * p.y;
  let v = ARCHI_BOWL * r2 + ARCHI_K * r2 * r2 * r2;
  for (const w of ARCHI_WELLS) {
    const dx = p.x - w.x, dy = p.y - w.y;
    const c = Math.cos(w.thetaDeg * DEG), s = Math.sin(w.thetaDeg * DEG);
    const u = dx * c + dy * s, t = -dx * s + dy * c;
    v -= w.depth * Math.exp(-(u * u) / (w.a * w.a) - (t * t) / (w.b * w.b));
  }
  for (const r of ARCHI_RIDGES) {
    const dx = p.x - r.x, dy = p.y - r.y;
    const c = Math.cos(r.thetaDeg * DEG), s = Math.sin(r.thetaDeg * DEG);
    const u = dx * c + dy * s, t = -dx * s + dy * c;
    v += r.h * Math.exp(-(u * u) / (r.sL * r.sL) - (t * t) / (r.sW * r.sW));
  }
  return v;
}
function archiGrad(p) {
  const r2 = p.x * p.x + p.y * p.y;
  const k6 = 6 * ARCHI_K * r2 * r2;
  let gx = ARCHI_BOWL * 2 * p.x + k6 * p.x, gy = ARCHI_BOWL * 2 * p.y + k6 * p.y;
  for (const w of ARCHI_WELLS) {
    const dx = p.x - w.x, dy = p.y - w.y;
    const c = Math.cos(w.thetaDeg * DEG), s = Math.sin(w.thetaDeg * DEG);
    const u = dx * c + dy * s, t = -dx * s + dy * c;
    const e = w.depth * Math.exp(-(u * u) / (w.a * w.a) - (t * t) / (w.b * w.b));
    const dqx = ((2 * u) / (w.a * w.a)) * c - ((2 * t) / (w.b * w.b)) * s;
    const dqy = ((2 * u) / (w.a * w.a)) * s + ((2 * t) / (w.b * w.b)) * c;
    gx += e * dqx; gy += e * dqy;
  }
  for (const r of ARCHI_RIDGES) {
    const dx = p.x - r.x, dy = p.y - r.y;
    const c = Math.cos(r.thetaDeg * DEG), s = Math.sin(r.thetaDeg * DEG);
    const u = dx * c + dy * s, t = -dx * s + dy * c;
    const e = r.h * Math.exp(-(u * u) / (r.sL * r.sL) - (t * t) / (r.sW * r.sW));
    const dqx = ((2 * u) / (r.sL * r.sL)) * c - ((2 * t) / (r.sW * r.sW)) * s;
    const dqy = ((2 * u) / (r.sL * r.sL)) * s + ((2 * t) / (r.sW * r.sW)) * c;
    gx -= e * dqx; gy -= e * dqy;
  }
  return { x: gx, y: gy };
}

const CANYON = { a: 2.6, b: 6, c: 1.5, wind: 1.5, windK: 1.05, parab: 0.15 };
const CANYON_PEAKS = [
  { x: -1.3, y: -0.165, p: 15, s: 0.6 },
  { x: 1.85, y: 2.961, p: 15, s: 0.6 },
  { x: 1.2, y: 0.594, p: 15, s: 0.6 },
];
function canyonPath(x) { return CANYON.wind * Math.sin(CANYON.windK * x) + CANYON.parab * x * x; }
function canyonPathD(x) { return CANYON.wind * CANYON.windK * Math.cos(CANYON.windK * x) + 2 * CANYON.parab * x; }
function canyonDy(p) { return p.y - canyonPath(p.x); }
function canyonF(p) {
  const dx = CANYON.a - p.x;
  const dy = canyonDy(p);
  let v = dx * dx + CANYON.b * dy * dy + CANYON.c * dy * dy * dy * dy;
  for (const k of CANYON_PEAKS) {
    const ex = p.x - k.x, ey = p.y - k.y;
    v += k.p * Math.exp(-(ex * ex + ey * ey) / (k.s * k.s));
  }
  return v;
}
function canyonGrad(p) {
  const dy = canyonDy(p);
  const g1 = canyonPathD(p.x);
  const wallD = 2 * CANYON.b * dy + 4 * CANYON.c * dy * dy * dy;
  let gx = -2 * (CANYON.a - p.x) - wallD * g1;
  let gy = wallD;
  for (const k of CANYON_PEAKS) {
    const ex = p.x - k.x, ey = p.y - k.y;
    const e = k.p * Math.exp(-(ex * ex + ey * ey) / (k.s * k.s));
    gx -= e * ((2 * ex) / (k.s * k.s));
    gy -= e * ((2 * ey) / (k.s * k.s));
  }
  return { x: gx, y: gy };
}

const H = 1e-6;
function fdCheck(name, f, grad, points) {
  let worst = 0, bad = 0;
  for (const p of points) {
    const fd = {
      x: (f({ x: p.x + H, y: p.y }) - f({ x: p.x - H, y: p.y })) / (2 * H),
      y: (f({ x: p.x, y: p.y + H }) - f({ x: p.x, y: p.y - H })) / (2 * H),
    };
    const an = grad(p);
    for (const k of ["x", "y"]) {
      const err = Math.abs(fd[k] - an[k]) / Math.max(1, Math.abs(an[k]));
      worst = Math.max(worst, err);
      if (err >= 1e-5) { bad += 1; console.log(`  FD FAIL ${name} (${p.x},${p.y}) ${k}`); }
    }
  }
  console.log(`${name}: FD worst ${worst.toExponential(2)}${bad ? ` BAD=${bad}` : ""}`);
}
function multiStartMinima(f, grad, half, grid, lr, iters, cluster) {
  const mins = [];
  for (let ix = 0; ix < grid; ix++) {
    for (let iy = 0; iy < grid; iy++) {
      let x = -half + (ix / (grid - 1)) * 2 * half;
      let y = -half + (iy / (grid - 1)) * 2 * half;
      for (let i = 0; i < iters; i++) {
        const g = grad({ x, y });
        x -= lr * g.x; y -= lr * g.y;
      }
      const fv = f({ x, y });
      const near = mins.find((m) => Math.hypot(m.x - x, m.y - y) < cluster);
      if (!near) mins.push({ x, y, f: fv });
    }
  }
  return mins;
}
function segMax(f, a, b, skip = 0.2, n = 65) {
  let maxV = -Infinity;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const s = skip + (u * (d - 2 * skip)) / d;
    if (s < skip || d - s < skip) continue;
    const v = f({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
    if (v > maxV) maxV = v;
  }
  return maxV;
}

console.log("== archipelago v4 ==");
fdCheck("archi", archiF, archiGrad, [
  { x: -4.6, y: 3.9 }, { x: 5.3, y: -4.6 }, { x: -5.9, y: -3.2 }, { x: 0.6, y: 6.2 },
  { x: 2.2, y: 3.0 }, { x: 6.4, y: 1.6 }, { x: -0.4, y: 0 }, { x: -0.8, y: -6.2 },
  { x: -2.47, y: 6.06 }, { x: 4.35, y: 5.48 }, { x: 6.85, y: -1.60 },
  { x: 2.47, y: -6.68 }, { x: -3.69, y: -5.33 }, { x: -6.53, y: 0.68 },
  { x: 0, y: 0 }, { x: 8.5, y: 8.5 },
]);
{
  const floors = ARCHI_WELLS.map((w) => ({ name: w.name, f: archiF({ x: w.x, y: w.y }) })).sort((a, b) => a.f - b.f);
  let prev = null, minGap = 99;
  for (const fl of floors) {
    const gap = prev !== null ? fl.f - prev : null;
    if (gap !== null) minGap = Math.min(minGap, gap);
    console.log(`  ${fl.name.padEnd(16)} ${fl.f.toFixed(3)}${gap !== null ? `  gap ${gap.toFixed(3)}` : ""}`);
    prev = fl.f;
  }
  console.log(`  min gap ${minGap.toFixed(3)}`);
}
{
  const mins = multiStartMinima(archiF, archiGrad, 8.85, 19, 0.01, 4000, 0.35);
  console.log(`minima: ${mins.length} (want 8)`);
  for (const m of mins.sort((a, b) => a.f - b.f)) {
    let owner = "EXTRA";
    for (const w of ARCHI_WELLS) if (Math.hypot(m.x - w.x, m.y - w.y) < 0.6) owner = w.name;
    if (owner === "EXTRA" || mins.length !== 8) console.log(`  (${m.x.toFixed(2)}, ${m.y.toFixed(2)}) f=${m.f.toFixed(3)}  ${owner}`);
  }
  for (const w of ARCHI_WELLS) {
    const nearest = mins.reduce((a, b) => Math.hypot(b.x - w.x, b.y - w.y) < Math.hypot(a.x - w.x, a.y - w.y) ? b : a);
    const d = Math.hypot(nearest.x - w.x, nearest.y - w.y);
    if (d >= 0.35) console.log(`  DRIFT ${w.name}: ${d.toFixed(3)}`);
  }
}
{
  const pairs = [[0, 3], [3, 5], [5, 1], [1, 7], [7, 2], [2, 0]];
  for (const [i, j] of pairs) {
    const a = ARCHI_WELLS[i], b = ARCHI_WELLS[j];
    const mx = segMax(archiF, { x: a.x, y: a.y }, { x: b.x, y: b.y });
    const low = Math.max(archiF({ x: a.x, y: a.y }), archiF({ x: b.x, y: b.y }));
    console.log(`  ${a.name} ↔ ${b.name}: wall +${(mx - low).toFixed(2)} ${mx - low >= 1.5 ? "OK" : "LOW"}`);
  }
}

console.log("== canyon v4 ==");
const gMin = { x: CANYON.a, y: canyonPath(CANYON.a) };
console.log(`min (${gMin.x}, ${gMin.y.toFixed(6)}) f=${canyonF(gMin).toFixed(4)} |grad|=${Math.hypot(canyonGrad(gMin).x, canyonGrad(gMin).y).toExponential(2)}`);
fdCheck("canyon", canyonF, canyonGrad, [
  gMin, { x: -2.9, y: canyonPath(-2.9) }, { x: -1.5, y: canyonPath(-1.5) }, { x: 0, y: 0 },
  { x: 1.5, y: canyonPath(1.5) }, ...CANYON_PEAKS,
  { x: 0.5, y: 2.5 }, { x: -2.0, y: 2.0 }, { x: 3.3, y: -3.2 }, { x: -3.2, y: -3.3 }, { x: 0.4, y: 3.2 },
]);
{
  // hill-climb from each peak center: the summit must be within 0.3 of it
  for (const k of CANYON_PEAKS) {
    let p = { x: k.x, y: k.y };
    for (let i = 0; i < 60; i++) {
      const g = canyonGrad(p);
      p = { x: p.x + 0.002 * g.x, y: p.y + 0.002 * g.y };
    }
    const d = Math.hypot(p.x - k.x, p.y - k.y);
    const floorBelow = canyonF({ x: k.x, y: canyonPath(k.x) });
    console.log(`peak (${k.x},${k.y}): summit drifted ${d.toFixed(3)} ${d < 0.3 ? "OK" : "FAR"}; height above floor ${ (canyonF(p) - floorBelow).toFixed(1) }; path hump ${ (canyonF({ x: k.x, y: canyonPath(k.x) }) - (canyonF({ x: k.x, y: canyonPath(k.x) }) - k.p * Math.exp(-((k.y - canyonPath(k.x)) ** 2) / (k.s * k.s)))).toFixed(2) }`);
  }
}
{
  let maxFloor = -Infinity, maxAt = null;
  for (let i = 0; i <= 120; i++) {
    const x = -2.95 + (i / 120) * 5.75;
    const v = canyonF({ x, y: canyonPath(x) });
    if (v > maxFloor) { maxFloor = v; maxAt = x; }
  }
  const walls = [0.8, 1.2, 1.6].map((d) => {
    const v = Math.max(
      canyonF({ x: 0, y: canyonPath(0) + d }), canyonF({ x: -1.0, y: canyonPath(-1.0) - d }),
      canyonF({ x: 2.0, y: canyonPath(2.0) + d }),
    );
    return `dy=${d}: ${v.toFixed(1)}`;
  });
  console.log(`floor max ${maxFloor.toFixed(2)} at x=${maxAt.toFixed(2)}; walls ${walls.join("  ")}`);
}
{
  let p = { x: -2.9, y: canyonPath(-2.9) };
  for (let i = 0; i < 30000; i++) {
    const g = canyonGrad(p);
    p = { x: p.x - 0.001 * g.x, y: p.y - 0.001 * g.y };
  }
  console.log(`GD(0.001) 30k from mouth: (${p.x.toFixed(3)}, ${p.y.toFixed(3)}) f=${canyonF(p).toFixed(3)} dist ${Math.hypot(p.x - gMin.x, p.y - gMin.y).toFixed(3)}`);
}

/* ---------------- tilt ---------------- */
const TILT_DT = 1 / 120, TILT_SETTLE_SUBSTEPS = 45, TILT_SETTLE_SPEED = 0.25, WALL_BOUNCE = 0.38;
const SWARM_FRICTION = 0.9, SWARM_MAX_SUBSTEPS = 3600, SWARM_CAPTURE_Q = 0.5;
function tiltDiag(level) { const e = level.landscape.extent; return Math.hypot(e.xMax - e.xMin, e.yMax - e.yMin); }
function clampAbs(v, m) { return v > m ? m : v < -m ? -m : v; }
function tiltStep(level, run, input, friction) {
  if (run.done) return;
  const g = level.landscape.grad(run.pos);
  const ax = -g.x * level.gravity + input.x * level.tiltAccel - friction * run.vel.x;
  const ay = -g.y * level.gravity + input.y * level.tiltAccel - friction * run.vel.y;
  run.vel.x = clampAbs(run.vel.x + ax * TILT_DT, level.vmax);
  run.vel.y = clampAbs(run.vel.y + ay * TILT_DT, level.vmax);
  run.pos.x += run.vel.x * TILT_DT;
  run.pos.y += run.vel.y * TILT_DT;
  const e = level.landscape.extent;
  if (run.pos.x < e.xMin) { run.pos.x = e.xMin; run.vel.x = Math.abs(run.vel.x) * WALL_BOUNCE; }
  else if (run.pos.x > e.xMax) { run.pos.x = e.xMax; run.vel.x = -Math.abs(run.vel.x) * WALL_BOUNCE; }
  if (run.pos.y < e.yMin) { run.pos.y = e.yMin; run.vel.y = Math.abs(run.vel.y) * WALL_BOUNCE; }
  else if (run.pos.y > e.yMax) { run.pos.y = e.yMax; run.vel.y = -Math.abs(run.vel.y) * WALL_BOUNCE; }
  run.steps += 1;
  const gl = Math.hypot(g.x, g.y), vl = Math.hypot(run.vel.x, run.vel.y);
  if (vl >= TILT_SETTLE_SPEED) run.launched = true;
  if (gl < level.settleGrad && vl < TILT_SETTLE_SPEED && (run.launched || !run.requireLaunch)) {
    run.rest += 1;
    if (run.rest >= TILT_SETTLE_SUBSTEPS) { run.done = true; run.settled = true; }
  } else run.rest = 0;
}
function tiltInit(level, start, requireLaunch) {
  return { pos: { ...start }, vel: { x: 0, y: 0 }, steps: 0, rest: 0, done: false, settled: false, launched: false, requireLaunch };
}
function halton(index, base) { let f = 1, r = 0, i = index; while (i > 0) { f /= base; r += f * (i % base); i = Math.floor(i / base); } return r; }
function swarmStarts(level) {
  const e = level.landscape.extent;
  const mx = (e.xMax - e.xMin) / 2, my = (e.yMax - e.yMin) / 2, cx = (e.xMin + e.xMax) / 2, cy = (e.yMin + e.yMax) / 2;
  const out = [];
  for (let i = 1; i <= 100; i++) out.push({ x: cx + (halton(i, 2) * 2 - 1) * mx * 0.82, y: cy + (halton(i, 3) * 2 - 1) * my * 0.82 });
  return out;
}
function swarmBasinOf(p, wells) {
  let best = -1, bestQ = SWARM_CAPTURE_Q;
  for (let i = 0; i < wells.length; i++) {
    const w = wells[i];
    const dx = p.x - w.x, dy = p.y - w.y;
    const c = Math.cos((w.thetaDeg * Math.PI) / 180), s = Math.sin((w.thetaDeg * Math.PI) / 180);
    const u = dx * c + dy * s, t = -dx * s + dy * c;
    const q = Math.sqrt((u * u) / (w.a * w.a) + (t * t) / (w.b * w.b));
    if (q < bestQ) { bestQ = q; best = i; }
  }
  return best;
}
const ARCHI_EXT = { xMin: -9, xMax: 9, yMin: -9, yMax: 9 };
const TILT_ARCHI = {
  landscape: { extent: ARCHI_EXT, f: archiF, grad: archiGrad, wells: ARCHI_WELLS },
  start: { x: -7.4, y: -6.4 }, goal: { x: -4.6, y: 3.9 }, goalFrac: 0.03,
  gravity: 2, tiltAccel: 18, vmax: 10, settleGrad: 0.1, cellFrac: 0.04,
};
function tiltCuratedRun(level, friction) {
  const run = tiltInit(level, level.start, false);
  const cap = Math.round(40 / TILT_DT);
  const clamp11 = (v) => (v > 1 ? 1 : v < -1 ? -1 : v);
  while (run.steps < cap && !run.done) {
    const t = run.steps * TILT_DT;
    const dx = level.goal.x - run.pos.x, dy = level.goal.y - run.pos.y;
    const l = Math.hypot(dx, dy) || 1;
    const input = l < tiltDiag(level) * 0.04 ? { x: 0, y: 0 } : (() => {
      const wobble = 0.3 * Math.sin((2 * Math.PI * t) / 1.7);
      return { x: clamp11(dx / l - (dy / l) * wobble), y: clamp11(dy / l + (dx / l) * wobble) };
    })();
    tiltStep(level, run, input, friction);
  }
  return run;
}
function gd(lr) { return { lr, initState(p) { return { pos: { ...p } }; }, step(s, g) { return { pos: { x: s.pos.x - lr * g.x, y: s.pos.y - lr * g.y } }; } }; }
function momentum(lr, beta) {
  return {
    lr,
    initState(p) { return { pos: { ...p }, velocity: { x: 0, y: 0 } }; },
    step(s, g) {
      const v = { x: beta * s.velocity.x + g.x, y: beta * s.velocity.y + g.y };
      return { pos: { x: s.pos.x - lr * v.x, y: s.pos.y - lr * v.y }, velocity: v };
    },
  };
}
function adam(lr, b1, b2, eps) {
  return {
    lr,
    initState(p) { return { pos: { ...p }, m: { x: 0, y: 0 }, v: { x: 0, y: 0 }, t: 0 }; },
    step(s, g) {
      const t = s.t + 1;
      const m = { x: b1 * s.m.x + (1 - b1) * g.x, y: b1 * s.m.y + (1 - b1) * g.y };
      const v = { x: b2 * s.v.x + (1 - b2) * g.x * g.x, y: b2 * s.v.y + (1 - b2) * g.y * g.y };
      const bc1 = 1 - Math.pow(b1, t), bc2 = 1 - Math.pow(b2, t);
      return { pos: { x: s.pos.x - (lr * (m.x / bc1)) / (Math.sqrt(v.x / bc2) + eps), y: s.pos.y - (lr * (m.y / bc1)) / (Math.sqrt(v.y / bc2) + eps) }, m, v, t };
    },
  };
}
function runMachine(level, opt, grad) {
  let s = opt.initState(level.start);
  const e = level.landscape.extent, m = 1.05;
  let end = { ...level.start }, escaped = false;
  for (let i = 0; i < 400; i++) {
    s = opt.step(s, grad(s.pos));
    if (!Number.isFinite(s.pos.x) || !Number.isFinite(s.pos.y)) { escaped = true; break; }
    if (s.pos.x < e.xMin * m || s.pos.x > e.xMax * m || s.pos.y < e.yMin * m || s.pos.y > e.yMax * m) { escaped = true; break; }
    end = { ...s.pos };
  }
  const gE = grad(end);
  return { end, escaped, settled: !escaped && Math.hypot(gE.x, gE.y) < level.settleGrad, loss: level.landscape.f(end), basin: swarmBasinOf(end, level.landscape.wells ?? []), reached: Math.hypot(end.x - level.goal.x, end.y - level.goal.y) < tiltDiag(level) * level.goalFrac };
}

console.log("== tilt archi v4 ==");
{
  const run = tiltCuratedRun(TILT_ARCHI, 1.2);
  console.log(`curated: steps=${run.steps} settled=${run.settled} end=(${run.pos.x.toFixed(2)},${run.pos.y.toFixed(2)}) d=${Math.hypot(run.pos.x - TILT_ARCHI.goal.x, run.pos.y - TILT_ARCHI.goal.y).toFixed(3)}`);
  for (const [nm, opt] of [["gd 0.04", gd(0.04)], ["mom 0.06", momentum(0.06, 0.9)], ["adam 0.15", adam(0.15, 0.9, 0.999, 1e-8)]]) {
    const r = runMachine(TILT_ARCHI, opt, archiGrad);
    console.log(`  ${nm.padEnd(10)} loss ${r.loss.toFixed(2)} settled=${r.settled} reached=${r.reached} basin=${r.basin >= 0 ? ARCHI_WELLS[r.basin].name : "open"} end=(${r.end.x.toFixed(1)},${r.end.y.toFixed(1)})`);
  }
}
console.log("== swarm archi v4 ==");
{
  const wells = ARCHI_WELLS;
  const ends = [];
  for (const start of swarmStarts(TILT_ARCHI)) {
    const run = tiltInit(TILT_ARCHI, start, true);
    const g0 = archiGrad(start);
    if (Math.hypot(g0.x, g0.y) < TILT_ARCHI.settleGrad && swarmBasinOf(start, wells) >= 0) { run.done = true; run.settled = true; run.launched = true; }
    while (run.steps < SWARM_MAX_SUBSTEPS && !run.done) tiltStep(TILT_ARCHI, run, { x: 0, y: 0 }, SWARM_FRICTION);
    if (!run.done && Math.hypot(run.vel.x, run.vel.y) < TILT_SETTLE_SPEED) {
      const ge = archiGrad(run.pos);
      if (Math.hypot(ge.x, ge.y) < TILT_ARCHI.settleGrad && swarmBasinOf(run.pos, wells) >= 0) { run.done = true; run.settled = true; }
    }
    ends.push({ p: { ...run.pos }, basin: swarmBasinOf(run.pos, wells), settled: run.settled, steps: run.steps });
  }
  const settled = ends.filter((e) => e.settled).length;
  const openSettled = ends.filter((e) => e.settled && e.basin < 0).length;
  const m2 = new Map();
  for (const e of ends) {
    if (!e.settled || e.basin < 0) continue;
    const c = m2.get(e.basin) ?? { n: 0, sum: 0 };
    c.n += 1; c.sum += archiF(e.p);
    m2.set(e.basin, c);
  }
  const rows = [...m2.entries()].map(([b, c]) => ({ name: wells[b].name, n: c.n, mean: c.sum / c.n })).sort((a, b) => a.mean - b.mean);
  console.log(`settled ${settled}/100, open-ground settled ${openSettled}, basins ${m2.size}/8`);
  for (const r of rows) console.log(`  ${r.name.padEnd(16)} n=${r.n}  mean ${r.mean.toFixed(2)}`);
  const ms = rows.map((r) => r.mean);
  if (ms.length) console.log(`spread ${(Math.max(...ms) - Math.min(...ms)).toFixed(2)}`);
  console.log(`unsettled: ${ends.filter((e) => !e.settled).length === 0 ? "none" : ends.filter((e) => !e.settled).map((e) => `(${e.p.x.toFixed(1)},${e.p.y.toFixed(1)},${e.steps})`).join(" ")}`);
}

console.log("== tilt canyon v4 ==");
const CANYON_EXT = { xMin: -3.4, xMax: 3.6, yMin: -3.4, yMax: 3.6 };
const TILT_CANYON = {
  landscape: { extent: CANYON_EXT, f: canyonF, grad: canyonGrad },
  start: { x: -2.9, y: canyonPath(-2.9) }, goal: gMin, goalFrac: 0.05,
  gravity: 0.04, tiltAccel: 6, vmax: 4, settleGrad: 0.9, cellFrac: 0.05,
};
{
  const run = tiltCuratedRun(TILT_CANYON, 1.2);
  const d = Math.hypot(run.pos.x - gMin.x, run.pos.y - gMin.y);
  console.log(`curated: steps=${run.steps} end=(${run.pos.x.toFixed(2)},${run.pos.y.toFixed(2)}) d=${d.toFixed(3)} ${d < Math.hypot(7, 7) * 0.05 ? "REACHED" : "SHORT"} settled=${run.settled}`);
  for (const [nm, opt] of [
    ["gd 0.001", gd(0.001)], ["gd 0.002", gd(0.002)],
    ["mom 0.002", momentum(0.002, 0.9)], ["mom 0.004", momentum(0.004, 0.9)],
    ["adam 0.05", adam(0.05, 0.9, 0.999, 1e-8)], ["adam 0.08", adam(0.08, 0.9, 0.999, 1e-8)],
  ]) {
    const r = runMachine(TILT_CANYON, opt, canyonGrad);
    const d = Math.hypot(r.end.x - gMin.x, r.end.y - gMin.y);
    console.log(`  ${nm.padEnd(10)} loss ${r.loss.toFixed(2)} settled=${r.settled} reached=${r.reached} end=(${r.end.x.toFixed(2)},${r.end.y.toFixed(2)}) d=${d.toFixed(2)}`);
  }
}

/* ---------------- rule lab ---------------- */
const GAMMA = 0.999, CEPS = 1e-8;
function customRule(cfg) {
  return {
    initState(p) { return { pos: { ...p }, velocity: { x: 0, y: 0 }, sq: { x: 0, y: 0 }, t: 0 }; },
    step(s, g) {
      const t = s.t + 1;
      const velocity = { x: cfg.beta * s.velocity.x + g.x, y: cfg.beta * s.velocity.y + g.y };
      const sq = { x: GAMMA * s.sq.x + (1 - GAMMA) * g.x * g.x, y: GAMMA * s.sq.y + (1 - GAMMA) * g.y * g.y };
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
function runRule(f, grad, opt, start, threshold, maxSteps = 400) {
  let s = opt.initState(start);
  let steps = null, end = { ...start };
  for (let i = 1; i <= maxSteps; i++) {
    s = opt.step(s, grad(s.pos));
    if (!Number.isFinite(s.pos.x) || !Number.isFinite(s.pos.y)) break;
    end = { ...s.pos };
    if (f(s.pos) < threshold) { steps = i; break; }
  }
  return { steps, final: f(end), end };
}
const CFG = { lr: 0.5, beta: 0.9, normalize: true, clip: 0.35 };
function tuneRule(name, f, grad, start, threshold, gdList, momList, adamList) {
  console.log(`-- ${name}: start (${start.x},${start.y}) f=${f(start).toFixed(2)} threshold ${threshold}`);
  const rc = runRule(f, grad, customRule(CFG), start, threshold);
  console.log(`  custom: ${rc.steps ?? "DNF"} (final ${rc.final.toFixed(3)} end (${rc.end.x.toFixed(2)},${rc.end.y.toFixed(2)}))`);
  for (const [k, list] of [["gd", gdList], ["mom", momList], ["adam", adamList]]) {
    for (const lr of list) {
      const opt = k === "gd" ? gd(lr) : k === "mom" ? momentum(lr, 0.9) : adam(lr, 0.9, 0.999, 1e-8);
      const r = runRule(f, grad, opt, start, threshold);
      console.log(`  ${k} ${lr}: ${r.steps ?? "DNF"} (final ${r.final.toFixed(3)} end (${r.end.x.toFixed(2)},${r.end.y.toFixed(2)}))`);
    }
  }
}

console.log('== rule lab archi v5 ==');
tuneRule('archi (3.4,1.6) th-1.6', archiF, archiGrad, { x: 3.4, y: 1.6 }, -1.6, [0.01, 0.02, 0.03], [0.03, 0.05, 0.08], [0.08, 0.12, 0.18]);
tuneRule('archi (3.4,1.6) th-3.0', archiF, archiGrad, { x: 3.4, y: 1.6 }, -3.0, [0.01, 0.03], [0.05, 0.09], [0.12, 0.2]);
console.log('== rule lab canyon v5 ==');
tuneRule('canyon th2.0', canyonF, canyonGrad, TILT_CANYON.start, 2.0, [0.001, 0.002], [0.004, 0.008, 0.015], [0.05, 0.1, 0.15]);
