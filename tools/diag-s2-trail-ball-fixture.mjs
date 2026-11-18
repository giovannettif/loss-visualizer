// src/core/functions.ts
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
    f(p) {
      return a11 * p.x * p.x + 2 * a12 * p.x * p.y + a22 * p.y * p.y;
    },
    grad(p) {
      return {
        x: 2 * (a11 * p.x + a12 * p.y),
        y: 2 * (a12 * p.x + a22 * p.y)
      };
    }
  };
}
var MULTI_WELL_WELLS = [
  { name: "the deep canyon", x: -1.6, y: 1.4, depth: 6, a: 1.25, b: 0.8, thetaDeg: 25 },
  { name: "the narrow spike", x: 2.6, y: -1.8, depth: 4.6, a: 0.55, b: 0.42, thetaDeg: 70 },
  { name: "the round cellar", x: -2.6, y: -2.4, depth: 3.2, a: 1, b: 1, thetaDeg: 0 },
  { name: "the long trough", x: 0.2, y: -2.9, depth: 2.4, a: 1.9, b: 0.55, thetaDeg: 15 },
  { name: "the broad bowl", x: 2.2, y: 2.2, depth: 2, a: 2, b: 1.5, thetaDeg: -12 },
  { name: "the dimple", x: -0.3, y: 0.1, depth: 1, a: 0.6, b: 0.6, thetaDeg: 40 }
];
var MW_BOWL = 0.05;
var MW_RIPPLE = 0.02;
var MW_RIPPLE_K = 1.6;
var MW_EXTENT = { xMin: -4, xMax: 4, yMin: -4, yMax: 4 };
var MW_DEG = Math.PI / 180;
function makeMultiWell(wells = MULTI_WELL_WELLS) {
  return {
    label: "Multi-well country",
    extent: { ...MW_EXTENT },
    f(p) {
      let v = MW_BOWL * (p.x * p.x + p.y * p.y) + MW_RIPPLE * Math.sin(MW_RIPPLE_K * p.x) * Math.sin(MW_RIPPLE_K * p.y);
      for (const w of wells) {
        const dx = p.x - w.x;
        const dy = p.y - w.y;
        const c = Math.cos(w.thetaDeg * MW_DEG);
        const s = Math.sin(w.thetaDeg * MW_DEG);
        const u = dx * c + dy * s;
        const t = -dx * s + dy * c;
        v -= w.depth * Math.exp(-(u * u) / (w.a * w.a) - t * t / (w.b * w.b));
      }
      return v;
    },
    grad(p) {
      let gx = MW_BOWL * 2 * p.x + MW_RIPPLE * MW_RIPPLE_K * Math.cos(MW_RIPPLE_K * p.x) * Math.sin(MW_RIPPLE_K * p.y);
      let gy = MW_BOWL * 2 * p.y + MW_RIPPLE * MW_RIPPLE_K * Math.sin(MW_RIPPLE_K * p.x) * Math.cos(MW_RIPPLE_K * p.y);
      for (const w of wells) {
        const dx = p.x - w.x;
        const dy = p.y - w.y;
        const c = Math.cos(w.thetaDeg * MW_DEG);
        const s = Math.sin(w.thetaDeg * MW_DEG);
        const u = dx * c + dy * s;
        const t = -dx * s + dy * c;
        const e = Math.exp(-(u * u) / (w.a * w.a) - t * t / (w.b * w.b));
        const dqx = 2 * u / (w.a * w.a) * c - 2 * t / (w.b * w.b) * s;
        const dqy = 2 * u / (w.a * w.a) * s + 2 * t / (w.b * w.b) * c;
        gx += w.depth * e * dqx;
        gy += w.depth * e * dqy;
      }
      return { x: gx, y: gy };
    }
  };
}
var multiWell = makeMultiWell();
var LEAST_SQUARES_POINTS = [
  { x: -3, y: -1.35 },
  { x: -2.4, y: -0.4 },
  { x: -1.8, y: -0.95 },
  { x: -1.2, y: 0.55 },
  { x: -0.6, y: 0.35 },
  { x: 0, y: 1.5 },
  { x: 0.6, y: 1.75 },
  { x: 1.2, y: 2.15 },
  { x: 1.8, y: 3.35 },
  { x: 2.4, y: 3.3 },
  { x: 3, y: 3.75 },
  { x: 3.6, y: 4.95 }
];
var leastSquares = {
  label: "Least squares (w, b)",
  extent: { xMin: -1, xMax: 3, yMin: -3, yMax: 5 },
  axes: ["w", "b"],
  f(p) {
    let sum = 0;
    for (const pt of LEAST_SQUARES_POINTS) {
      const r = p.x * pt.x + p.y - pt.y;
      sum += r * r;
    }
    return sum;
  },
  grad(p) {
    let gw = 0;
    let gb = 0;
    for (const pt of LEAST_SQUARES_POINTS) {
      const r = p.x * pt.x + p.y - pt.y;
      gw += 2 * pt.x * r;
      gb += 2 * r;
    }
    return { x: gw, y: gb };
  }
};
var defaultBowl = makeBowl(1, 0.02, Math.PI / 6);

// src/core/optimizers.ts
function gd(lr) {
  return {
    name: "gd",
    initState(pos) {
      return { pos: { ...pos } };
    },
    step(state, grad) {
      return {
        pos: {
          x: state.pos.x - lr * grad.x,
          y: state.pos.y - lr * grad.y
        }
      };
    }
  };
}
function momentum(lr, beta) {
  return {
    name: "momentum",
    initState(pos) {
      return { pos: { ...pos }, velocity: { x: 0, y: 0 } };
    },
    step(state, grad) {
      const vPrev = state.velocity ?? { x: 0, y: 0 };
      const velocity = {
        x: beta * vPrev.x + grad.x,
        y: beta * vPrev.y + grad.y
      };
      return {
        pos: {
          x: state.pos.x - lr * velocity.x,
          y: state.pos.y - lr * velocity.y
        },
        velocity
      };
    }
  };
}
function adam(lr, beta1, beta2, eps) {
  return {
    name: "adam",
    initState(pos) {
      return { pos: { ...pos }, m: { x: 0, y: 0 }, v: { x: 0, y: 0 }, t: 0 };
    },
    step(state, grad) {
      const t = (state.t ?? 0) + 1;
      const mPrev = state.m ?? { x: 0, y: 0 };
      const vPrev = state.v ?? { x: 0, y: 0 };
      const m = {
        x: beta1 * mPrev.x + (1 - beta1) * grad.x,
        y: beta1 * mPrev.y + (1 - beta1) * grad.y
      };
      const v = {
        x: beta2 * vPrev.x + (1 - beta2) * grad.x * grad.x,
        y: beta2 * vPrev.y + (1 - beta2) * grad.y * grad.y
      };
      const bc1 = 1 - Math.pow(beta1, t);
      const bc2 = 1 - Math.pow(beta2, t);
      return {
        pos: {
          x: state.pos.x - lr * (m.x / bc1) / (Math.sqrt(v.x / bc2) + eps),
          y: state.pos.y - lr * (m.y / bc1) / (Math.sqrt(v.y / bc2) + eps)
        },
        m,
        v,
        t
      };
    }
  };
}

// src/view/palette.ts
var MANIM = {
  blue: 5817565,
  teal: 6082739,
  green: 8634727,
  yellow: 16044869,
  gold: 15772767,
  red: 16540245,
  purple: 10121900,
  /** Learner / ball identity color. */
  white: 16777215,
  /** Captions and secondary UI text. */
  greyText: 10134706,
  /** Page / viewport background. */
  background: 724240
};
var OPTIMIZER_COLORS = {
  gd: MANIM.red,
  momentum: MANIM.blue,
  adam: MANIM.yellow,
  learner: MANIM.white,
  custom: MANIM.purple
};

// src/view/trajectoryPlayer.ts
function cumulativeLengths(path) {
  const cum = [0];
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
    cum.push(total);
  }
  return { total, cum };
}
var smooth = (u) => u * u * (3 - 2 * u);
function samplePath(path, p) {
  if (path.length === 0) return { x: 0, y: 0 };
  if (path.length === 1) return { ...path[0] };
  const { total, cum } = cumulativeLengths(path);
  if (total <= 1e-9) return { ...path[0] };
  const d = Math.min(1, Math.max(0, p)) * total;
  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i++;
  const seg = cum[i] - cum[i - 1] || 1;
  const u = smooth(Math.min(1, Math.max(0, (d - cum[i - 1]) / seg)));
  const a = path[i - 1];
  const b = path[i];
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
}
function samplePathAtStep(path, s) {
  if (path.length === 0) return { x: 0, y: 0 };
  const n = path.length - 1;
  if (n === 0 || s >= n) return { ...path[n] };
  const sc = Math.max(0, s);
  const i = Math.min(Math.floor(sc), n - 1);
  const u = smooth(sc - i);
  const a = path[i];
  const b = path[i + 1];
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
}

// src/scenes/heroRace.ts
var SPECS = [
  { opt: gd(0.2), color: OPTIMIZER_COLORS.gd, steps: 70, duration: 6.6 },
  { opt: momentum(0.045, 0.9), color: OPTIMIZER_COLORS.momentum, steps: 70, duration: 4.8 },
  { opt: adam(0.2, 0.9, 0.999, 1e-8), color: OPTIMIZER_COLORS.adam, steps: 70, duration: 3.4 }
];

// src/scenes/fogGame.ts
function lsArgmin() {
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const pt of LEAST_SQUARES_POINTS) {
    n += 1;
    sx += pt.x;
    sy += pt.y;
    sxx += pt.x * pt.x;
    sxy += pt.x * pt.y;
  }
  const det = n * sxx - sx * sx;
  const w = (n * sxy - sx * sy) / det;
  const b = (sy - w * sx) / n;
  return { x: w, y: b };
}
var FOG_LS = {
  id: "ls",
  name: "least squares",
  ordinal: "1",
  landscape: leastSquares,
  start: { x: 0.2, y: 0.5 },
  budget: 10,
  reachFrac: 0.16,
  stampFrac: 0.07,
  globalMin: lsArgmin()
};
var FOG_RB_CANNED_RUN = [
  { x: -1.2, y: 1.44 },
  { x: -0.8, y: 0.64 },
  { x: -0.4, y: 0.16 },
  { x: 0, y: 0 },
  { x: 0.4, y: 0.16 }
];
var FOG_RB_CURATED_MID = FOG_RB_CANNED_RUN.slice(0, 4);

// src/scenes/tiltGame.ts
var TILT_DT = 1 / 120;

// src/scenes/director.ts
var GD_START = { x: -11, y: 9.5 };
var VALLEY_TOWARD_ORIGIN = { x: 0.5, y: -0.8660254 };
var DRIFT_B = { x: GD_START.x + 7 * VALLEY_TOWARD_ORIGIN.x, y: GD_START.y + 7 * VALLEY_TOWARD_ORIGIN.y };
var DRIFT_PERIOD = 12;
var ETA_MIN = 2e-3;
var ETA_MAX = 2;
var ETA_MID = Math.sqrt(ETA_MIN * ETA_MAX);
var GD_A_FROZEN_DRIFT_T = 0.38 * DRIFT_PERIOD;
var GD_B_FROZEN_USER_TIP = {
  x: GD_START.x + 8 * VALLEY_TOWARD_ORIGIN.x,
  y: GD_START.y + 8 * VALLEY_TOWARD_ORIGIN.y
};
var MOM_BOWL = makeBowl(1, 0.02, -Math.PI / 5);
var MOM_START = (() => {
  const ux = Math.cos(-Math.PI / 5);
  const uy = Math.sin(-Math.PI / 5);
  return { x: -6 * ux + 10 * -uy, y: -6 * uy + 10 * ux };
})();
var ADAM_POINT = (() => {
  const c = Math.cos(Math.PI / 6);
  const s = Math.sin(Math.PI / 6);
  return { x: 1.5 * c + 9 * -s, y: 1.5 * s + 9 * c };
})();
var LAB_ETA_GD = 0.13;
var LAB_ETA_M = 0.2;
var LAB_BETA = 0.9;
var LAB_ETA_A = 0.3;
var LAB_STEPS = 220;
var LAB_ADAM_INV_MAX = 1.6;
var LAB_START_DIR = (() => {
  const l = Math.hypot(-0.94, 0.34);
  return { x: -0.94 / l, y: 0.34 / l };
})();
function labBowl(E, rotDeg) {
  return makeBowl(Math.sqrt(E), 1 / Math.sqrt(E), rotDeg * Math.PI / 180);
}
function labStart(bowl) {
  const s = bowl.extent.xMax * 0.5;
  const l = Math.hypot(LAB_START_DIR.x, LAB_START_DIR.y);
  return { x: LAB_START_DIR.x / l * s, y: LAB_START_DIR.y / l * s };
}
function runLabPath(bowl, kind) {
  const opt = kind === "gd" ? gd(LAB_ETA_GD) : kind === "mom" ? momentum(LAB_ETA_M, LAB_BETA) : adam(LAB_ETA_A, 0.9, 0.999, 1e-8);
  const p0 = labStart(bowl);
  let state = opt.initState(p0);
  const e = bowl.extent;
  const m = 1.05;
  const path = [{ ...p0 }];
  const losses = [bowl.f(p0)];
  for (let i = 0; i < LAB_STEPS; i++) {
    state = opt.step(state, bowl.grad(state.pos));
    if (!Number.isFinite(state.pos.x) || !Number.isFinite(state.pos.y)) break;
    path.push({ ...state.pos });
    losses.push(bowl.f(state.pos));
    if (state.pos.x < e.xMin * m || state.pos.x > e.xMax * m || state.pos.y < e.yMin * m || state.pos.y > e.yMax * m) {
      break;
    }
  }
  return { path, losses };
}
function meanEarlyStep(path) {
  const n = Math.min(3, path.length - 1);
  let sum = 0;
  for (let i = 1; i <= n; i++) {
    sum += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  }
  return sum / n;
}
var labAdamRef = 0;
function labAdamEarlyRef() {
  if (labAdamRef === 0) labAdamRef = meanEarlyStep(runLabPath(labBowl(1, 0), "adam").path);
  return labAdamRef;
}
function labChecks(E, rotDeg) {
  const bowl = labBowl(E, rotDeg);
  const ux = Math.cos(rotDeg * Math.PI / 180);
  const uy = Math.sin(rotDeg * Math.PI / 180);
  const across = (p) => p.x * ux + p.y * uy;
  const g = runLabPath(bowl, "gd");
  const m = runLabPath(bowl, "mom");
  const a = runLabPath(bowl, "adam");
  const gc = g.path.map(across);
  let gdFlips = 0;
  for (let i = 2; i < gc.length; i++) {
    if ((gc[i] - gc[i - 1]) * (gc[i - 1] - gc[i - 2]) < 0 && Math.abs(gc[i - 1]) > 0.3) {
      gdFlips += 1;
    }
  }
  const mc = m.path.map(across);
  let momOvershoot = 0;
  for (let i = 1; i < mc.length; i++) {
    if (mc[i - 1] * mc[i] < 0) {
      for (let j = i; j < mc.length; j++) {
        momOvershoot = Math.max(momOvershoot, Math.abs(mc[j]) / (Math.abs(mc[0]) || 1));
      }
      break;
    }
  }
  const r = meanEarlyStep(a.path) / labAdamEarlyRef();
  const adamInvariant = Math.max(r, 1 / r);
  return {
    gdFlips,
    momOvershoot,
    adamInvariant,
    zigzag: gdFlips >= 3,
    overshoot: momOvershoot > 1.15,
    invariant: adamInvariant < LAB_ADAM_INV_MAX,
    gdPath: g.path,
    momPath: m.path,
    adamPath: a.path,
    gdLosses: g.losses,
    momLosses: m.losses,
    adamLosses: a.losses
  };
}
function leastSquaresArgmin() {
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const pt of LEAST_SQUARES_POINTS) {
    n += 1;
    sx += pt.x;
    sy += pt.y;
    sxx += pt.x * pt.x;
    sxy += pt.x * pt.y;
  }
  const det = n * sxx - sx * sx;
  const w = (n * sxy - sx * sy) / det;
  const b = (sy - w * sx) / n;
  return { x: w, y: b };
}
var TILT_STAMP_RINGS = 4;
var TILT_STAMP_SEGS = 20;
var TILT_STAMP_V = 1 + TILT_STAMP_RINGS * TILT_STAMP_SEGS;
var TILT_STAMP_I = 3 * (TILT_STAMP_SEGS + 2 * TILT_STAMP_SEGS * (TILT_STAMP_RINGS - 1));
var ARGMIN = leastSquaresArgmin();

// tools/diag-s2-trail-ball-fixture.ts
var dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
var arcStepAt = (path, p) => {
  const { total, cum } = cumulativeLengths(path);
  const d = p * total;
  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i++;
  return i - 1 + (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
};
var { gdPath, momPath, adamPath } = labChecks(50, 30);
var lanes = [
  { name: "gd", path: gdPath },
  { name: "mom", path: momPath },
  { name: "adam", path: adamPath }
];
var maxSteps = Math.max(...lanes.map((l) => l.path.length - 1));
var out = {
  maxSteps,
  arcConcentration: lanes.map((l) => {
    const n = l.path.length - 1;
    const { total, cum } = cumulativeLengths(l.path);
    return {
      name: l.name,
      steps: n,
      totalArc: Math.round(total * 1e3) / 1e3,
      first10pctStepsArcShare: Math.round(cum[Math.floor(n * 0.1)] / total * 1e3) / 1e3
    };
  }),
  samples: []
};
for (const f of [0.1, 0.5]) {
  for (const l of lanes) {
    const n = l.path.length - 1;
    const s = Math.min(f * maxSteps, n);
    const tipIdx = Math.min(Math.floor(s), n);
    const newBall = samplePathAtStep(l.path, s);
    const newTip = l.path[tipIdx];
    const oldBall = samplePath(l.path, f);
    const oldTipIdx = Math.round(f * n);
    const oldTip = l.path[oldTipIdx];
    const oldBallStep = arcStepAt(l.path, f);
    out.samples.push({
      f,
      name: l.name,
      steps: n,
      new_s: Math.round(s * 1e3) / 1e3,
      new_tipIdx: tipIdx,
      new_ball: {
        x: Math.round(newBall.x * 1e5) / 1e5,
        y: Math.round(newBall.y * 1e5) / 1e5
      },
      new_ball_to_tip: Math.round(dist(newBall, newTip) * 1e4) / 1e4,
      new_tip_leads_steps: Math.round((s - tipIdx) * 1e3) / 1e3,
      old_ball: {
        x: Math.round(oldBall.x * 1e5) / 1e5,
        y: Math.round(oldBall.y * 1e5) / 1e5
      },
      old_ball_at_step: Math.round(oldBallStep * 100) / 100,
      old_tipIdx: oldTipIdx,
      old_ball_to_tip: Math.round(dist(oldBall, oldTip) * 1e4) / 1e4,
      old_tip_leads_steps: Math.round((oldTipIdx - oldBallStep) * 100) / 100,
      arrival_f_new: Math.round(n / maxSteps * 1e3) / 1e3
    });
  }
}
console.log(JSON.stringify(out, null, 1));
