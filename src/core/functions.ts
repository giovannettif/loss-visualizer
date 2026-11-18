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
  /** Display names for the two parameter axes (the compass labels them).
   *  Defaults to ["x", "y"] for the test landscapes; least squares is
   *  ["w", "b"] (QA copy-symbol-drift). */
  readonly axes?: readonly [string, string];
  /** The landscape's well list, when its basins-of-attraction story is told
   *  by named wells (the §7 swarm maps). Every consumer (swarmBasinOf, the
   *  cluster scorecard, the canyon framing) reads THIS, never a hardcoded
   *  module constant — so any well-list landscape works as a swarm map.
   *  Order is deepest-first, and the `global`-flagged well is the true
   *  global basin (several wells may tie as global minima, Himmelblau). */
  readonly wells?: ReadonlyArray<WellSpec>;
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
  /** True for THE global basin (gold cluster row, canyon framing). Several
   *  wells may carry it when the landscape has several global minima
   *  (Himmelblau's four pits all reach f = 0). */
  global?: boolean;
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
  { name: "the deep canyon", x: -1.6, y: 1.4, depth: 6.0, a: 1.25, b: 0.8, thetaDeg: 25, global: true },
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

/** Tuning for a well country beyond the §7 default (all literal). */
export interface MultiWellTuning {
  extent?: Extent;
  /** Gentle containment bowl coefficient (the rim). */
  bowl?: number;
  ripple?: number;
  rippleK?: number;
  label?: string;
}

/**
 * Builds a multi-well landscape (the §7 swarm family):
 *
 *   f(p) = bowl·‖p‖²                         (gentle rim, keeps edges high)
 *        + ripple·sin(k·x)·sin(k·y)          (the gentle ripple)
 *        − Σᵢ depthᵢ·exp(−uᵢ²/aᵢ² − tᵢ²/bᵢ²) (the wells, u/t = p rotated)
 *
 * Every term is analytic; ∇f is exact (checked against central differences
 * to <1e-5 rel in math.test.ts, like every other landscape here). With the
 * default wells the landscape has EXACTLY six local minima — one per well —
 * at visibly different depths (−5.81, −4.30, −2.58, −1.98, −1.55, −1.09),
 * so swarm clusters end at clearly unequal final losses. The built landscape
 * carries its `wells` list so every basin consumer can generalize.
 */
export function makeMultiWell(
  wells: ReadonlyArray<WellSpec> = MULTI_WELL_WELLS,
  tuning: MultiWellTuning = {},
): Landscape {
  const bowl = tuning.bowl ?? MW_BOWL;
  const ripple = tuning.ripple ?? MW_RIPPLE;
  const rippleK = tuning.rippleK ?? MW_RIPPLE_K;
  const extent = tuning.extent ?? MW_EXTENT;
  return {
    label: tuning.label ?? "Multi-well country",
    extent: { ...extent },
    wells,
    f(p: Vec2): number {
      let v =
        bowl * (p.x * p.x + p.y * p.y) +
        ripple * Math.sin(rippleK * p.x) * Math.sin(rippleK * p.y);
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
        bowl * 2 * p.x +
        ripple * rippleK * Math.cos(rippleK * p.x) * Math.sin(rippleK * p.y);
      let gy =
        bowl * 2 * p.y +
        ripple * rippleK * Math.sin(rippleK * p.x) * Math.cos(rippleK * p.y);
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

/** The §7 swarm's default landscape instance (built from the default wells). */
export const multiWell: Landscape = makeMultiWell();

/* ------------------------------------------------------------------ */
/* Multi-well LARGE — a wider, busier country for the §7 swarm picker  */
/* ------------------------------------------------------------------ */

/**
 * Nine wells over ±6.5 (all constants literal — same determinism contract as
 * MULTI_WELL_WELLS), deepest-first, varied in depth/width/orientation. The
 * classic cast scales up and three new characters join:
 *
 *   great rift    — THE global basin: deepest, wide, tilted.
 *   needle        — deep but tiny footprint: catches near-vertical falls.
 *   vault         — honest middle-depth round cellar.
 *   fjord         — shallow elongated groove hugging the south rim.
 *   crescent      — tilted banana groove, new.
 *   prairie bowl  — shallow but huge: hoards runners at a mediocre loss.
 *   pothole       — small dent ON the flat origin patch (the dimple story,
 *                   again — without it the too-quiet plain settles balls).
 *   kettle        — round, mid-shallow, new.
 *   scratch       — barely a scratch near the east rim, new.
 */
export const MULTI_WELL_LARGE_WELLS: ReadonlyArray<WellSpec> = [
  { name: "the great rift", x: -2.4, y: 2.6, depth: 7.5, a: 1.5, b: 0.9, thetaDeg: 30, global: true },
  { name: "the needle", x: 4.4, y: -3.4, depth: 6.3, a: 0.5, b: 0.38, thetaDeg: 75 },
  { name: "the vault", x: -4.6, y: -4.0, depth: 5.5, a: 1.05, b: 1.05, thetaDeg: 0 },
  { name: "the fjord", x: 0.8, y: -5.0, depth: 4.4, a: 2.6, b: 0.6, thetaDeg: 12 },
  { name: "the crescent", x: -4.2, y: 0.4, depth: 3.6, a: 2.1, b: 0.7, thetaDeg: -40 },
  { name: "the prairie bowl", x: 4.2, y: 3.2, depth: 2.9, a: 2.2, b: 1.7, thetaDeg: -15 },
  { name: "the pothole", x: 0.5, y: -0.45, depth: 2.3, a: 0.85, b: 0.85, thetaDeg: 40 },
  { name: "the kettle", x: 1.0, y: 4.6, depth: 1.6, a: 0.95, b: 0.95, thetaDeg: 0 },
  { name: "the scratch", x: 5.0, y: -0.4, depth: 1.0, a: 0.55, b: 0.55, thetaDeg: 10 },
];

/** The LARGE swarm map's landscape instance (wells ride on the landscape). */
export const multiWellLarge: Landscape = makeMultiWell(MULTI_WELL_LARGE_WELLS, {
  extent: { xMin: -6.5, xMax: 6.5, yMin: -6.5, yMax: 6.5 },
  label: "Multi-well large",
});

/* ------------------------------------------------------------------ */
/* Himmelblau — the classic four-equal-global-minima polynomial        */
/* ------------------------------------------------------------------ */

/**
 * f(x,y) = (x² + y − 11)² + (x + y² − 7)²
 *
 * ∇f:  ∂x = 4x(x² + y − 11) + 2(x + y² − 7)
 *      ∂y = 2(x² + y − 11) + 4y(x + y² − 7)
 *
 * Exactly FOUR minima, all GLOBAL (f = 0 at each) — the canonical counter-
 * story to the multi-well countries: same rule, four equally good answers.
 * The two saddles between them sit at f ≈ 6–10. The extent clips the quartic
 * rim just wide enough to hold every basin (minima reach radius ≈ 5.0).
 *
 * `wells` carries the four basins as metadata for the §7 swarm plumbing
 * (capture classification + cluster rows): depth 0 (f is the exact
 * polynomial, not a Gaussian sum), round capture ellipses ≈ the flat floor's
 * radius, and ALL FOUR flagged `global` — that is the section's point.
 */
export const HIMMELBLAU_WELLS: ReadonlyArray<WellSpec> = [
  { name: "the (3, 2) pit", x: 3, y: 2, depth: 0, a: 0.9, b: 0.9, thetaDeg: 0, global: true },
  { name: "the (\u22122.8, 3.1) pit", x: -2.805118087, y: 3.131312518, depth: 0, a: 0.9, b: 0.9, thetaDeg: 0, global: true },
  { name: "the (\u22123.8, \u22123.3) pit", x: -3.779310254, y: -3.283185992, depth: 0, a: 0.9, b: 0.9, thetaDeg: 0, global: true },
  { name: "the (3.6, \u22121.8) pit", x: 3.58442834, y: -1.848126527, depth: 0, a: 0.9, b: 0.9, thetaDeg: 0, global: true },
];

/** The classic Himmelblau surface, exact polynomial + exact gradient. */
export const himmelblau: Landscape = {
  label: "Himmelblau",
  extent: { xMin: -5.5, xMax: 5.5, yMin: -5.5, yMax: 5.5 },
  wells: HIMMELBLAU_WELLS,
  f(p: Vec2): number {
    const a = p.x * p.x + p.y - 11;
    const b = p.x + p.y * p.y - 7;
    return a * a + b * b;
  },
  grad(p: Vec2): Vec2 {
    const a = p.x * p.x + p.y - 11;
    const b = p.x + p.y * p.y - 7;
    return {
      x: 4 * p.x * a + 2 * b,
      y: 2 * a + 4 * p.y * b,
    };
  },
};

/* ------------------------------------------------------------------ */
/* ARCHIPELAGO — a ridge-walled basin country on a bigger map         */
/* (§7 tilt level 4 + §7 swarm picker + §8 workbench)                  */
/* ------------------------------------------------------------------ */

/**
 * One positive gaussian RIDGE of the archipelago: a wall of height `h`
 * running along `thetaDeg` through (x, y) — long by `sL`, narrow by `sW`.
 * Ridges are the archipelago's point: real terrain between basins, so the
 * tilt game has walls to steer through (they are NOT just empty space).
 */
export interface RidgeSpec {
  x: number;
  y: number;
  /** Wall height (loss units above the surrounding plain). */
  h: number;
  /** Gaussian sigma along the wall's long axis. */
  sL: number;
  /** Gaussian sigma across it (the steep direction). */
  sW: number;
  thetaDeg: number;
}

/**
 * The eight island basins (all constants literal — the same determinism
 * contract as LEAST_SQUARES_POINTS), ordered deepest-first by their true
 * floors: −8.03, −5.33, −4.13, −3.45, −2.47, −1.68, −1.14, −0.50. The six
 * ring islands are elongated ALONG the ring (tangent-aligned ellipses); the
 * skerry and tide pool share the sheltered interior plain.
 */
export const ARCHIPELAGO_WELLS: ReadonlyArray<WellSpec> = [
  { name: "the deep atoll", x: -4.6, y: 3.9, depth: 9.6, a: 2.0, b: 0.9, thetaDeg: 50, global: true },
  { name: "the blue hole", x: 5.3, y: -4.6, depth: 8.0, a: 1.8, b: 0.8, thetaDeg: 49 },
  { name: "the lagoon", x: -5.9, y: -3.2, depth: 6.4, a: 2.0, b: 1.0, thetaDeg: -61 },
  { name: "the crater lake", x: 0.6, y: 6.2, depth: 5.2, a: 1.9, b: 0.85, thetaDeg: -6 },
  { name: "the cove", x: 6.4, y: 1.6, depth: 4.6, a: 1.9, b: 0.7, thetaDeg: 104 },
  { name: "the bay", x: -0.8, y: -6.2, depth: 3.45, a: 2.0, b: 0.8, thetaDeg: -7 },
  { name: "the tide pool", x: 2.2, y: 3.0, depth: 1.65, a: 0.7, b: 0.6, thetaDeg: 0 },
  { name: "the skerry", x: -0.4, y: 0.0, depth: 0.5, a: 0.9, b: 0.75, thetaDeg: 25 },
];

/**
 * Six strait walls, one on each arc between neighboring ring islands
 * (crest radius ≈ 6.5, aligned RADIALLY so they block along-the-ring
 * travel; the interior route past their inner tips stays open — the
 * steered way from the south rim to the deep atoll). Constants literal.
 */
export const ARCHIPELAGO_RIDGES: ReadonlyArray<RidgeSpec> = [
  { x: -2.47, y: 6.06, h: 3.2, sL: 1.7, sW: 0.42, thetaDeg: 112 },
  { x: 4.35, y: 5.48, h: 3.0, sL: 1.7, sW: 0.42, thetaDeg: 49 },
  { x: 6.85, y: -1.6, h: 3.2, sL: 1.7, sW: 0.42, thetaDeg: -14 },
  { x: 2.47, y: -6.68, h: 3.0, sL: 1.7, sW: 0.42, thetaDeg: -69 },
  { x: -3.69, y: -5.33, h: 3.2, sL: 1.7, sW: 0.42, thetaDeg: 55 },
  { x: -6.53, y: 0.68, h: 3.4, sL: 1.7, sW: 0.42, thetaDeg: 174 },
];

/** Gentle interior drainage bowl (keeps the quiet plain creeping inward). */
const ARCHI_BOWL = 0.03;
/** Sextic confinement rim k·(x²+y²)³: flat mid-map, steep at the edge — the
 *  ridge tails can never balance it into hanging pockets (tuned: the pure
 *  quadratic bowl of the multi-well countries left flank pockets beside
 *  every wall; the sextic's slope at r ≥ 7 dwarfs any wall tail). */
const ARCHI_RIM_K = 1e-5;
const ARCHI_EXTENT: Extent = { xMin: -9, xMax: 9, yMin: -9, yMax: 9 };

/**
 * f(p) = bowl·‖p‖² + k·‖p‖⁶                      (drain + confinement rim)
 *      − Σᵢ depthᵢ·exp(−uᵢ²/aᵢ² − tᵢ²/bᵢ²)       (the island wells)
 *      + Σⱼ hⱼ·exp(−uⱼ²/sLⱼ² − tⱼ²/sWⱼ²)         (the strait ridges)
 * Every term is analytic; ∇f is exact (FD-checked to <1e-5 rel in
 * math.test.ts). With these literals the landscape has EXACTLY eight local
 * minima — one per well, at clearly different depths — and every straight
 * line between neighboring basins crosses a wall ≥ 4 units above both.
 */
export const archipelago: Landscape = {
  label: "Archipelago",
  extent: { ...ARCHI_EXTENT },
  wells: ARCHIPELAGO_WELLS,
  f(p: Vec2): number {
    const r2 = p.x * p.x + p.y * p.y;
    let v = ARCHI_BOWL * r2 + ARCHI_RIM_K * r2 * r2 * r2;
    for (const w of ARCHIPELAGO_WELLS) {
      const dx = p.x - w.x;
      const dy = p.y - w.y;
      const c = Math.cos(w.thetaDeg * MW_DEG);
      const s = Math.sin(w.thetaDeg * MW_DEG);
      const u = dx * c + dy * s;
      const t = -dx * s + dy * c;
      v -= w.depth * Math.exp(-(u * u) / (w.a * w.a) - (t * t) / (w.b * w.b));
    }
    for (const r of ARCHIPELAGO_RIDGES) {
      const dx = p.x - r.x;
      const dy = p.y - r.y;
      const c = Math.cos(r.thetaDeg * MW_DEG);
      const s = Math.sin(r.thetaDeg * MW_DEG);
      const u = dx * c + dy * s;
      const t = -dx * s + dy * c;
      v += r.h * Math.exp(-(u * u) / (r.sL * r.sL) - (t * t) / (r.sW * r.sW));
    }
    return v;
  },
  grad(p: Vec2): Vec2 {
    const r2 = p.x * p.x + p.y * p.y;
    const k6 = 6 * ARCHI_RIM_K * r2 * r2; // ∇(k·r⁶) = 6k·r⁴·p
    let gx = ARCHI_BOWL * 2 * p.x + k6 * p.x;
    let gy = ARCHI_BOWL * 2 * p.y + k6 * p.y;
    for (const w of ARCHIPELAGO_WELLS) {
      const dx = p.x - w.x;
      const dy = p.y - w.y;
      const c = Math.cos(w.thetaDeg * MW_DEG);
      const s = Math.sin(w.thetaDeg * MW_DEG);
      const u = dx * c + dy * s;
      const t = -dx * s + dy * c;
      const e = w.depth * Math.exp(-(u * u) / (w.a * w.a) - (t * t) / (w.b * w.b));
      const dqx = ((2 * u) / (w.a * w.a)) * c - ((2 * t) / (w.b * w.b)) * s;
      const dqy = ((2 * u) / (w.a * w.a)) * s + ((2 * t) / (w.b * w.b)) * c;
      gx += e * dqx;
      gy += e * dqy;
    }
    for (const r of ARCHIPELAGO_RIDGES) {
      const dx = p.x - r.x;
      const dy = p.y - r.y;
      const c = Math.cos(r.thetaDeg * MW_DEG);
      const s = Math.sin(r.thetaDeg * MW_DEG);
      const u = dx * c + dy * s;
      const t = -dx * s + dy * c;
      const e = r.h * Math.exp(-(u * u) / (r.sL * r.sL) - (t * t) / (r.sW * r.sW));
      const dqx = ((2 * u) / (r.sL * r.sL)) * c - ((2 * t) / (r.sW * r.sW)) * s;
      const dqy = ((2 * u) / (r.sL * r.sL)) * s + ((2 * t) / (r.sW * r.sW)) * c;
      gx -= e * dqx;
      gy -= e * dqy;
    }
    return { x: gx, y: gy };
  },
};

/* ------------------------------------------------------------------ */
/* CANYON PEAKS — one long winding valley past three tall peaks       */
/* (§7 tilt level 5 + §8 workbench)                                    */
/* ------------------------------------------------------------------ */

/** The canyon's literal shaping constants (same determinism contract;
 *  exported so the §function card prints exactly these). */
export const CANYON_A = 2.6; // the drain target: the minimum's x (the "sea gate")
export const CANYON_B = 8; // the wall steepness (the (y − g(x))² coefficient)
export const CANYON_WIND = 1.5; // the S-winding amplitude
export const CANYON_WIND_K = 1.05; // the S-winding frequency
export const CANYON_PARAB = 0.15; // the gentle parabolic drift of the path
const CANYON_EXTENT: Extent = { xMin: -3.4, xMax: 3.6, yMin: -3.4, yMax: 3.6 };

/** The canyon floor's path g(x) = WIND·sin(WIND_K·x) + PARAB·x² — bigger and
 *  twice as twisted as Rosenbrock's y = x²: one navigable groove winding
 *  from the high west mouth (f ≈ 30) down to the east gate. The constants
 *  are exported so the §function card's printed g(x) can never drift from
 *  the terrain (the same contract as ARCHIPELAGO_WELLS). */
function canyonPath(x: number): number {
  return CANYON_WIND * Math.sin(CANYON_WIND_K * x) + CANYON_PARAB * x * x;
}

/** The two literal peaks beside the path (x, y, height p, width s). Each
 *  stands 0.9 units off the floor at an x where the path is level-ish
 *  (|g′| small), so each is a REAL 2D local summit (verified in
 *  math.test.ts: the gradient climb from the center stays on the peak)
 *  while leaving a ≥ 1-unit navigable pass between it and the groove.
 *  Exported for the function card's summit count. */
export const CANYON_PEAKS: ReadonlyArray<{ x: number; y: number; p: number; s: number }> = [
  { x: -1.3, y: -0.3145, p: 15, s: 0.6 },
  { x: 1.85, y: 2.811, p: 15, s: 0.6 },
];

/**
 * f(x, y) = (A − x)² + B·(y − g(x))² + Σ peaks
 * (peaks: p·exp(−((x−px)² + (y−py)²)/s²)).
 *
 * ∇f exact: ∂x = −2(A−x) − 2B·dy·g′(x) − Σ p·e·2(x−px)/s² and
 * ∂y = 2B·dy − Σ p·e·2(y−py)/s², with dy = y − g(x). The walls rise to 72
 * at the extent edge — one long navigable floor (f ≤ 31 along the whole
 * groove), dramatic sides. The GLOBAL minimum sits at (A, g(A)) ≈
 * (2.6, 1.6141): both partials vanish there by construction (dy = 0 and
 * A − x = 0; the peak tails bend the true floor by < 0.1).
 */
export const canyonPeaks: Landscape = {
  label: "Canyon peaks",
  extent: { ...CANYON_EXTENT },
  f(p: Vec2): number {
    const dx = CANYON_A - p.x;
    const dy = p.y - canyonPath(p.x);
    let v = dx * dx + CANYON_B * dy * dy;
    for (const k of CANYON_PEAKS) {
      const ex = p.x - k.x;
      const ey = p.y - k.y;
      v += k.p * Math.exp(-(ex * ex + ey * ey) / (k.s * k.s));
    }
    return v;
  },
  grad(p: Vec2): Vec2 {
    const dy = p.y - canyonPath(p.x);
    const g1 = canyonPathD(p.x);
    const wallD = 2 * CANYON_B * dy;
    let gx = -2 * (CANYON_A - p.x) - wallD * g1;
    let gy = wallD;
    for (const k of CANYON_PEAKS) {
      const ex = p.x - k.x;
      const ey = p.y - k.y;
      const e = k.p * Math.exp(-(ex * ex + ey * ey) / (k.s * k.s));
      gx -= (e * 2 * ex) / (k.s * k.s);
      gy -= (e * 2 * ey) / (k.s * k.s);
    }
    return { x: gx, y: gy };
  },
};

function canyonPathD(x: number): number {
  return CANYON_WIND * CANYON_WIND_K * Math.cos(CANYON_WIND_K * x) + 2 * CANYON_PARAB * x;
}

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
  axes: ["w", "b"],
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
  multiWell,
  multiWellLarge,
  himmelblau,
  archipelago,
  canyonPeaks,
];
