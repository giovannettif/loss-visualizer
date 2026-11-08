/**
 * Landscape library — pure TypeScript math, no DOM, no rendering dependencies.
 *
 * Every landscape exposes an objective f, its ANALYTIC gradient grad, and the
 * parameter-space extent the visualizations should draw. All functions here are
 * deterministic: no Math.random, no Date, no ambient state.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export interface Extent {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export interface Landscape {
  /** Human-readable name for UI labels. */
  readonly label: string;
  /** Parameter-space rectangle the views should cover. */
  readonly extent: Extent;
  /** Loss at a point in parameter space. */
  f(p: Vec2): number;
  /** Analytic gradient of f at p (must match finite differences to <1e-5 rel). */
  grad(p: Vec2): Vec2;
}

/* ------------------------------------------------------------------ */
/* Rotated elongated quadratic bowl: A = R diag(λ1, λ2) Rᵀ            */
/* ------------------------------------------------------------------ */

/**
 * f(z) = zᵀ A z with A = R diag(λ1, λ2) Rᵀ, R a rotation by `theta`.
 *
 * λ1 is the curvature along the first principal axis (the "steep wall"
 * direction when λ1 ≫ λ2), λ2 the curvature along the valley floor.
 * With f = zᵀAz, ∇f = 2Az — exact, no approximation.
 *
 * The matrix entries expand to:
 *   A = [[λ1 c² + λ2 s²,  (λ1 − λ2) s c],
 *        [(λ1 − λ2) s c,  λ1 s² + λ2 c²]]
 * so we never build R or diag explicitly.
 */
export function makeBowl(lambda1: number, lambda2: number, theta: number): Landscape {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const a11 = lambda1 * c * c + lambda2 * s * s;
  const a12 = (lambda1 - lambda2) * s * c;
  const a22 = lambda1 * s * s + lambda2 * c * c;

  // Show a few valley widths: the flat direction has curvature min(λ1, λ2),
  // whose natural length scale is 1/√λmin. Clamp for sanity at extreme ratios.
  const half = Math.min(15, Math.max(2, 3 / Math.sqrt(Math.min(lambda1, lambda2))));

  return {
    label: "Rotated bowl",
    extent: { xMin: -half, xMax: half, yMin: -half, yMax: half },
    f(p: Vec2): number {
      return a11 * p.x * p.x + 2 * a12 * p.x * p.y + a22 * p.y * p.y;
    },
    grad(p: Vec2): Vec2 {
      // ∇(zᵀAz) = 2Az
      return {
        x: 2 * (a11 * p.x + a12 * p.y),
        y: 2 * (a12 * p.x + a22 * p.y),
      };
    },
  };
}

/* ------------------------------------------------------------------ */
/* Parabola (warm-up for a later section)                             */
/* ------------------------------------------------------------------ */

export const parabola: Landscape = {
  label: "Parabola",
  extent: { xMin: -3, xMax: 3, yMin: -3, yMax: 3 },
  f(p: Vec2): number {
    return p.x * p.x + p.y * p.y;
  },
  grad(p: Vec2): Vec2 {
    return { x: 2 * p.x, y: 2 * p.y };
  },
};

/* ------------------------------------------------------------------ */
/* Rosenbrock (a = 1, b = 100)                                        */
/* ------------------------------------------------------------------ */

/** Classic banana valley: f(x,y) = (a − x)² + b (y − x²)². */
export const rosenbrock: Landscape = {
  label: "Rosenbrock",
  extent: { xMin: -2, xMax: 2, yMin: -1, yMax: 3 },
  f(p: Vec2): number {
    const dx = 1 - p.x; // a = 1
    const dy = p.y - p.x * p.x;
    return dx * dx + 100 * dy * dy; // b = 100
  },
  grad(p: Vec2): Vec2 {
    const dy = p.y - p.x * p.x;
    return {
      x: -2 * (1 - p.x) - 400 * p.x * dy,
      y: 200 * dy,
    };
  },
};

/* ------------------------------------------------------------------ */
/* Rastrigin (2D, A = 10)                                             */
/* ------------------------------------------------------------------ */

/** f(x,y) = A·n + x² + y² − A (cos 2πx + cos 2πy), n = 2, A = 10. */
export const rastrigin: Landscape = {
  label: "Rastrigin",
  extent: { xMin: -5, xMax: 5, yMin: -5, yMax: 5 },
  f(p: Vec2): number {
    return (
      20 +
      p.x * p.x +
      p.y * p.y -
      10 * (Math.cos(2 * Math.PI * p.x) + Math.cos(2 * Math.PI * p.y))
    );
  },
  grad(p: Vec2): Vec2 {
    return {
      x: 2 * p.x + 20 * Math.PI * Math.sin(2 * Math.PI * p.x),
      y: 2 * p.y + 20 * Math.PI * Math.sin(2 * Math.PI * p.y),
    };
  },
};

/* ------------------------------------------------------------------ */
/* Multi-well country (§7 swarm showcase)                              */
/* ------------------------------------------------------------------ */

/**
 * One hardcoded well of the multi-well landscape: a rotated anisotropic
 * Gaussian pit — `depth` sets how low it goes, `a`/`b` how wide it sits
 * along/beside its `thetaDeg`-rotated axes, so basins differ in DEPTH,
 * WIDTH and SHAPE (some shallow and wide, some narrow and deep).
 */
export interface WellSpec {
  name: string;
  x: number;
  y: number;
  depth: number;
  a: number;
  b: number;
  thetaDeg: number;
}

/**
 * The six wells of the swarm showcase (all constants literal — the same
 * determinism contract as LEAST_SQUARES_POINTS):
 *
 *   deep canyon   — THE global basin: deepest, moderately wide, tilted.
 *   narrow spike  — deep but tiny footprint: catches only balls that
 *                   almost fall straight in.
 *   round cellar  — honest middle-depth bowl.
 *   long trough   — shallow elongated banana-like groove.
 *   broad bowl    — shallow but huge: hoards runners at a mediocre loss.
 *   dimple        — barely a dent, right next to the canyon's rim: that a
 *                   dozen balls end here anyway IS the basins story.
 */
export const MULTI_WELL_WELLS: ReadonlyArray<WellSpec> = [
  { name: "the deep canyon", x: -1.6, y: 1.4, depth: 6.0, a: 1.25, b: 0.8, thetaDeg: 25 },
  { name: "the narrow spike", x: 2.6, y: -1.8, depth: 4.6, a: 0.55, b: 0.42, thetaDeg: 70 },
  { name: "the round cellar", x: -2.6, y: -2.4, depth: 3.2, a: 1.0, b: 1.0, thetaDeg: 0 },
  { name: "the long trough", x: 0.2, y: -2.9, depth: 2.4, a: 1.9, b: 0.55, thetaDeg: 15 },
  { name: "the broad bowl", x: 2.2, y: 2.2, depth: 2.0, a: 2.0, b: 1.5, thetaDeg: -12 },
  { name: "the dimple", x: -0.3, y: 0.1, depth: 1.0, a: 0.6, b: 0.6, thetaDeg: 40 },
];

/** Gentle containment bowl + ripple amplitudes (hand-tuned, literal). */
const MW_BOWL = 0.05;
const MW_RIPPLE = 0.02;
const MW_RIPPLE_K = 1.6;
const MW_EXTENT = { xMin: -4, xMax: 4, yMin: -4, yMax: 4 };
const MW_DEG = Math.PI / 180;

/**
 * Builds the multi-well landscape:
 *
 *   f(p) = MW_BOWL·‖p‖²                      (gentle rim, keeps edges high)
 *        + MW_RIPPLE·sin(k·x)·sin(k·y)       (the gentle ripple)
 *        − Σᵢ depthᵢ·exp(−uᵢ²/aᵢ² − tᵢ²/bᵢ²) (the wells, u/t = p rotated)
 *
 * Every term is analytic; ∇f is exact (checked against central differences
 * to <1e-5 rel in math.test.ts, like every other landscape here). With the
 * default wells the landscape has EXACTLY six local minima — one per well —
 * at visibly different depths (−5.81, −4.30, −2.58, −1.98, −1.55, −1.09),
 * so swarm clusters end at clearly unequal final losses.
 */
export function makeMultiWell(wells: ReadonlyArray<WellSpec> = MULTI_WELL_WELLS): Landscape {
  return {
    label: "Multi-well country",
    extent: { ...MW_EXTENT },
    f(p: Vec2): number {
      let v =
        MW_BOWL * (p.x * p.x + p.y * p.y) +
        MW_RIPPLE * Math.sin(MW_RIPPLE_K * p.x) * Math.sin(MW_RIPPLE_K * p.y);
      for (const w of wells) {
        const dx = p.x - w.x;
        const dy = p.y - w.y;
        const c = Math.cos(w.thetaDeg * MW_DEG);
        const s = Math.sin(w.thetaDeg * MW_DEG);
        const u = dx * c + dy * s;
        const t = -dx * s + dy * c;
        v -= w.depth * Math.exp(-(u * u) / (w.a * w.a) - (t * t) / (w.b * w.b));
      }
      return v;
    },
    grad(p: Vec2): Vec2 {
      let gx =
        MW_BOWL * 2 * p.x +
        MW_RIPPLE * MW_RIPPLE_K * Math.cos(MW_RIPPLE_K * p.x) * Math.sin(MW_RIPPLE_K * p.y);
      let gy =
        MW_BOWL * 2 * p.y +
        MW_RIPPLE * MW_RIPPLE_K * Math.sin(MW_RIPPLE_K * p.x) * Math.cos(MW_RIPPLE_K * p.y);
      for (const w of wells) {
        const dx = p.x - w.x;
        const dy = p.y - w.y;
        const c = Math.cos(w.thetaDeg * MW_DEG);
        const s = Math.sin(w.thetaDeg * MW_DEG);
        const u = dx * c + dy * s;
        const t = -dx * s + dy * c;
        const e = Math.exp(-(u * u) / (w.a * w.a) - (t * t) / (w.b * w.b));
        const dqx = ((2 * u) / (w.a * w.a)) * c - ((2 * t) / (w.b * w.b)) * s;
        const dqy = ((2 * u) / (w.a * w.a)) * s + ((2 * t) / (w.b * w.b)) * c;
        gx += w.depth * e * dqx;
        gy += w.depth * e * dqy;
      }
      return { x: gx, y: gy };
    },
  };
}

/** The §7 swarm's landscape instance (built from the hardcoded wells). */
export const multiWell: Landscape = makeMultiWell();

/* ------------------------------------------------------------------ */
/* Least squares on 12 hardcoded noisy points (§1 tie-back anchor)    */
/* ------------------------------------------------------------------ */

/**
 * The §1 dataset: 12 (x, y) points scattered around the line y = 0.9x + 1.4.
 * LITERALLY hardcoded constants — deterministic by construction; the noise
 * pattern is fixed forever so every trajectory and screenshot reproduces.
 * (No Math.random anywhere in this codebase's math core.)
 */
export const LEAST_SQUARES_POINTS: ReadonlyArray<{ x: number; y: number }> = [
  { x: -3.0, y: -1.35 },
  { x: -2.4, y: -0.4 },
  { x: -1.8, y: -0.95 },
  { x: -1.2, y: 0.55 },
  { x: -0.6, y: 0.35 },
  { x: 0.0, y: 1.5 },
  { x: 0.6, y: 1.75 },
  { x: 1.2, y: 2.15 },
  { x: 1.8, y: 3.35 },
  { x: 2.4, y: 3.3 },
  { x: 3.0, y: 3.75 },
  { x: 3.6, y: 4.95 },
];

/**
 * L(w, b) = Σᵢ (w·xᵢ + b − yᵢ)²  — the exact §1 loss surface.
 * ∂L/∂w = Σ 2xᵢ(w·xᵢ + b − yᵢ),  ∂L/∂b = Σ 2(w·xᵢ + b − yᵢ).
 */
export const leastSquares: Landscape = {
  label: "Least squares (w, b)",
  extent: { xMin: -1, xMax: 3, yMin: -3, yMax: 5 },
  f(p: Vec2): number {
    let sum = 0;
    for (const pt of LEAST_SQUARES_POINTS) {
      const r = p.x * pt.x + p.y - pt.y; // w·xᵢ + b − yᵢ
      sum += r * r;
    }
    return sum;
  },
  grad(p: Vec2): Vec2 {
    let gw = 0;
    let gb = 0;
    for (const pt of LEAST_SQUARES_POINTS) {
      const r = p.x * pt.x + p.y - pt.y;
      gw += 2 * pt.x * r;
      gb += 2 * r;
    }
    return { x: gw, y: gb };
  },
};

/* ------------------------------------------------------------------ */
/* Registry for menus / debug page                                    */
/* ------------------------------------------------------------------ */

/** Default bowl for §2–§5: curvature ratio 50, rotated 30° (the PLAN's trap). */
export const defaultBowl: Landscape = makeBowl(1, 0.02, Math.PI / 6);

export const NAMED_LANDSCAPES: ReadonlyArray<Landscape> = [
  defaultBowl,
  parabola,
  rosenbrock,
  rastrigin,
  leastSquares,
];
