/**
 * tune-rule.mjs — scratch tuner for §8's constants (WP-D).
 *
 * Mirrors src/core/functions.ts + the customRule semantics EXACTLY (plain JS
 * copy, same arithmetic) so the curated config / thresholds / machine ηs are
 * picked from data, not guesses. The final constants are re-verified against
 * the REAL TypeScript core by src/scenes/ruleLab.test.ts.
 *
 * Usage: node tools/tune-rule.mjs
 */

/* ---------------- landscapes (verbatim from functions.ts) ---------------- */

function makeBowl(lambda1, lambda2, theta) {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const a11 = lambda1 * c * c + lambda2 * s * s;
  const a12 = (lambda1 - lambda2) * s * c;
  const a22 = lambda1 * s * s + lambda2 * c * c;
  const half = Math.min(15, Math.max(2, 3 / Math.sqrt(Math.min(lambda1, lambda2))));
  return {
    label: "Rotated bowl",
    extent: { xMin: -half, xMax: half, yMin: -half, yMax: half },
    f(p) { return a11 * p.x * p.x + 2 * a12 * p.x * p.y + a22 * p.y * p.y; },
    grad(p) { return { x: 2 * (a11 * p.x + a12 * p.y), y: 2 * (a12 * p.x + a22 * p.y) }; },
  };
}

const LEAST_SQUARES_POINTS = [
  { x: -3.0, y: -1.35 }, { x: -2.4, y: -0.4 }, { x: -1.8, y: -0.95 },
  { x: -1.2, y: 0.55 }, { x: -0.6, y: 0.35 }, { x: 0.0, y: 1.5 },
  { x: 0.6, y: 1.75 }, { x: 1.2, y: 2.15 }, { x: 1.8, y: 3.35 },
  { x: 2.4, y: 3.3 }, { x: 3.0, y: 3.75 }, { x: 3.6, y: 4.95 },
];

const rosenbrock = {
  label: "Rosenbrock",
  extent: { xMin: -2, xMax: 2, yMin: -1, yMax: 3 },
  f(p) { const dx = 1 - p.x; const dy = p.y - p.x * p.x; return dx * dx + 100 * dy * dy; },
  grad(p) {
    const dy = p.y - p.x * p.x;
    return { x: -2 * (1 - p.x) - 400 * p.x * dy, y: 200 * dy };
  },
};

const leastSquares = {
  label: "Least squares (w, b)",
  extent: { xMin: -1, xMax: 3, yMin: -3, yMax: 5 },
  f(p) {
    let sum = 0;
    for (const pt of LEAST_SQUARES_POINTS) { const r = p.x * pt.x + p.y - pt.y; sum += r * r; }
    return sum;
  },
  grad(p) {
    let gw = 0; let gb = 0;
    for (const pt of LEAST_SQUARES_POINTS) {
      const r = p.x * pt.x + p.y - pt.y;
      gw += 2 * pt.x * r; gb += 2 * r;
    }
    return { x: gw, y: gb };
  },
};

const defaultBowl = makeBowl(1, 0.02, Math.PI / 6);

/* ---------------- optimizers (verbatim semantics from optimizers.ts) ----- */

function gd(lr) {
  return {
    name: "gd",
    initState(pos) { return { pos: { ...pos } }; },
    step(s, g) {
      return { pos: { x: s.pos.x - lr * g.x, y: s.pos.y - lr * g.y } };
    },
  };
}

function momentum(lr, beta) {
  return {
    name: "momentum",
    initState(pos) { return { pos: { ...pos }, velocity: { x: 0, y: 0 } }; },
    step(s, g) {
      const vPrev = s.velocity ?? { x: 0, y: 0 };
      const velocity = { x: beta * vPrev.x + g.x, y: beta * vPrev.y + g.y };
      return {
        pos: { x: s.pos.x - lr * velocity.x, y: s.pos.y - lr * velocity.y },
        velocity,
      };
    },
  };
}

function adam(lr, beta1, beta2, eps) {
  return {
    name: "adam",
    initState(pos) { return { pos: { ...pos }, m: { x: 0, y: 0 }, v: { x: 0, y: 0 }, t: 0 }; },
    step(s, g) {
      const t = (s.t ?? 0) + 1;
      const mPrev = s.m ?? { x: 0, y: 0 };
      const vPrev = s.v ?? { x: 0, y: 0 };
      const m = { x: beta1 * mPrev.x + (1 - beta1) * g.x, y: beta1 * mPrev.y + (1 - beta1) * g.y };
      const v = {
        x: beta2 * vPrev.x + (1 - beta2) * g.x * g.x,
        y: beta2 * vPrev.y + (1 - beta2) * g.y * g.y,
      };
      const bc1 = 1 - Math.pow(beta1, t);
      const bc2 = 1 - Math.pow(beta2, t);
      return {
        pos: {
          x: s.pos.x - (lr * (m.x / bc1)) / (Math.sqrt(v.x / bc2) + eps),
          y: s.pos.y - (lr * (m.y / bc1)) / (Math.sqrt(v.y / bc2) + eps),
        },
        m, v, t,
      };
    },
  };
}

/** The §8 custom rule — the semantics the TS core will implement. */
const CUSTOM_GAMMA = 0.999;
const CUSTOM_EPS = 1e-8;
function customRule(cfg) {
  return {
    name: "custom",
    initState(pos) {
      return { pos: { ...pos }, velocity: { x: 0, y: 0 }, sq: { x: 0, y: 0 }, t: 0 };
    },
    step(s, g) {
      const t = (s.t ?? 0) + 1;
      const vPrev = s.velocity ?? { x: 0, y: 0 };
      const velocity = { x: cfg.beta * vPrev.x + g.x, y: cfg.beta * vPrev.y + g.y };
      const sPrev = s.sq ?? { x: 0, y: 0 };
      const sq = {
        x: CUSTOM_GAMMA * sPrev.x + (1 - CUSTOM_GAMMA) * g.x * g.x,
        y: CUSTOM_GAMMA * sPrev.y + (1 - CUSTOM_GAMMA) * g.y * g.y,
      };
      let ux, uy;
      if (cfg.normalize) {
        const bc = 1 - Math.pow(CUSTOM_GAMMA, t);
        ux = velocity.x / (Math.sqrt(sq.x / bc) + CUSTOM_EPS);
        uy = velocity.y / (Math.sqrt(sq.y / bc) + CUSTOM_EPS);
      } else {
        ux = velocity.x; uy = velocity.y;
      }
      let dx = -cfg.lr * ux;
      let dy = -cfg.lr * uy;
      if (cfg.clip != null && cfg.clip > 0) {
        const len = Math.hypot(dx, dy);
        if (len > cfg.clip) { dx *= cfg.clip / len; dy *= cfg.clip / len; }
      }
      return { pos: { x: s.pos.x + dx, y: s.pos.y + dy }, velocity, sq, t };
    },
  };
}

/* ---------------- benchmark harness (as ruleLab.ts will run it) ---------- */

function runOn(landscape, start, opt, threshold, maxSteps) {
  let state = opt.initState(start);
  const path = [{ ...start }];
  const losses = [landscape.f(start)];
  let stepsToConverge = null;
  for (let i = 1; i <= maxSteps; i++) {
    state = opt.step(state, landscape.grad(state.pos));
    if (!Number.isFinite(state.pos.x) || !Number.isFinite(state.pos.y)) break;
    path.push({ ...state.pos });
    const L = landscape.f(state.pos);
    losses.push(L);
    if (stepsToConverge === null && L < threshold) { stepsToConverge = i; break; }
  }
  return {
    steps: stepsToConverge,
    finalLoss: losses[losses.length - 1],
    pathLen: path.length,
  };
}

/* ---------------- levels ------------------------------------------------- */

const LEVELS = {
  bowl: { landscape: defaultBowl, start: { x: -11, y: 9.5 } },
  rosen: { landscape: rosenbrock, start: { x: -1.2, y: 1.44 } },
  ls: { landscape: leastSquares, start: { x: 0.2, y: 0.5 } },
};

function scan(label, levelId, threshold, machines, cfgs) {
  const lv = LEVELS[levelId];
  console.log(`\n=== ${label} · threshold ${threshold} · start (${lv.start.x}, ${lv.start.y}) · f0=${lv.landscape.f(lv.start).toPrecision(4)}`);
  for (const [name, opt] of machines) {
    const r = runOn(lv.landscape, lv.start, opt, threshold, 400);
    console.log(
      `  ${name.padEnd(28)} steps=${String(r.steps ?? "DNF").padEnd(4)} final=${r.finalLoss.toPrecision(4)}`,
    );
  }
  for (const [tag, cfg] of cfgs) {
    const r = runOn(lv.landscape, lv.start, customRule(cfg), threshold, 400);
    console.log(
      `  custom[${tag.padEnd(30)}] steps=${String(r.steps ?? "DNF").padEnd(4)} final=${r.finalLoss.toPrecision(4)}`,
    );
  }
}

const machinesBowl = [
  ["GD η=0.13", gd(0.13)],
  ["momentum η=0.2 β=0.9", momentum(0.2, 0.9)],
  ["Adam η=0.3", adam(0.3, 0.9, 0.999, 1e-8)],
];
const machinesRosen = [
  ["GD η=0.001", gd(0.001)],
  ["momentum η=0.001 β=0.9", momentum(0.001, 0.9)],
  ["Adam η=0.05", adam(0.05, 0.9, 0.999, 1e-8)],
];
const machinesLS = [
  ["GD η=0.008", gd(0.008)],
  ["momentum η=0.006 β=0.9", momentum(0.006, 0.9)],
  ["Adam η=0.1", adam(0.1, 0.9, 0.999, 1e-8)],
];

const cfgs = [
  ["η.5 β.9 norm clip.25", { lr: 0.5, beta: 0.9, normalize: true, clip: 0.25 }],
  ["η.5 β.9 norm clip.35", { lr: 0.5, beta: 0.9, normalize: true, clip: 0.35 }],
];

scan("bowl", "bowl", 0.5, machinesBowl, cfgs);
scan("rosen", "rosen", 1.0, machinesRosen, cfgs);
scan("ls", "ls", 1.5, machinesLS, cfgs);
