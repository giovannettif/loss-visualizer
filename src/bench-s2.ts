/**
 * bench-s2.ts — sub-step cost attribution for the §5 live rebuild
 * (SEC5-S2-REBUILD-COST-JANK). Every loop below is a verbatim copy of the
 * corresponding production loop:
 *   - terrain sample + attributes: LandscapeView.rebuildTerrain
 *   - contour isolines + lift:    LandscapeView.buildContourLines
 *   - minimap contours:           CompassMinimap.buildContours
 *   - race re-run:                director.labChecks (3 × 220 optimizer steps)
 * plus the two fix candidates measured in place:
 *   - gridN 48 vs 64
 *   - Viridis LUT (256 entries) vs per-vertex interpolateViridis+setStyle
 */
import { makeBowl, type Landscape, type Vec2 } from "./core/functions";
import { gd, momentum, adam, type OptimizerState } from "./core/optimizers";
import { scaleSequential } from "d3-scale";
import { interpolateViridis } from "d3-scale-chromatic";
import { contours as contourGrid } from "d3-contour";
import { Color, BufferGeometry, BufferAttribute, Vector3 } from "three";

/* ---- director.ts §5 constants (verbatim) ---- */
const LAB_ETA_GD = 0.13;
const LAB_ETA_M = 0.2;
const LAB_BETA = 0.9;
const LAB_ETA_A = 0.3;
const LAB_STEPS = 220;
const HEIGHT_FRACTION = 0.22; // LandscapeView terrain relief
const VIEW_CONTOUR_LEVELS = 14; // LandscapeView CONTOUR_LEVELS
const MAP_GRID_N = 60; // CompassMinimap GRID_N
const MAP_CONTOUR_LEVELS = 12; // CompassMinimap CONTOUR_LEVELS

const labBowl = (E: number, rotDeg: number): Landscape =>
  makeBowl(Math.sqrt(E), 1 / Math.sqrt(E), (rotDeg * Math.PI) / 180);

function labStart(bowl: Landscape): Vec2 {
  const l = Math.hypot(-0.94, 0.34);
  const dir = { x: -0.94 / l, y: 0.34 / l };
  const s = bowl.extent.xMax * 0.5;
  const ll = Math.hypot(dir.x, dir.y);
  return { x: (dir.x / ll) * s, y: (dir.y / ll) * s };
}

function runLabPath(bowl: Landscape, kind: "gd" | "mom" | "adam") {
  const opt =
    kind === "gd"
      ? gd(LAB_ETA_GD)
      : kind === "mom"
        ? momentum(LAB_ETA_M, LAB_BETA)
        : adam(LAB_ETA_A, 0.9, 0.999, 1e-8);
  const p0 = labStart(bowl);
  let state: OptimizerState = opt.initState(p0);
  const path: Vec2[] = [{ ...p0 }];
  const losses: number[] = [bowl.f(p0)];
  for (let i = 0; i < LAB_STEPS; i++) {
    state = opt.step(state, bowl.grad(state.pos));
    if (!Number.isFinite(state.pos.x) || !Number.isFinite(state.pos.y)) break;
    path.push({ ...state.pos });
    losses.push(bowl.f(state.pos));
  }
  return { path, losses };
}

/* ---- rebuildTerrain core (verbatim loop shape, LandscapeView.ts:1426-1571) ---- */
function terrainPass(fn: Landscape, n: number, useLut: boolean, lut: number[][] | null) {
  const size = n + 1;
  const { xMin, xMax, yMin, yMax } = fn.extent;
  const dx = (xMax - xMin) / n;
  const dy = (yMax - yMin) / n;
  const cx = (xMin + xMax) / 2;
  const cy = (yMin + yMax) / 2;

  const heights = new Float64Array(size * size);
  let hMin = Infinity;
  let hMax = -Infinity;
  for (let j = 0; j < size; j++) {
    const py = yMin + j * dy;
    for (let i = 0; i < size; i++) {
      const h = fn.f({ x: xMin + i * dx, y: py });
      heights[j * size + i] = h;
      if (h < hMin) hMin = h;
      if (h > hMax) hMax = h;
    }
  }
  const hRange = Math.max(hMax - hMin, 1e-9);
  const heightWorld = HEIGHT_FRACTION * ((xMax - xMin) + (yMax - yMin)) / 2;
  const hScale = heightWorld / hRange;

  const count = size * size;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const glows = new Float32Array(count);
  const heightAttr = new Float32Array(count);
  const uvs = new Float32Array(count * 2);

  const viridis = scaleSequential(interpolateViridis);
  const colorScratch = new Color();
  const spanX = Math.max(xMax - xMin, 1e-9);
  const spanY = Math.max(yMax - yMin, 1e-9);

  for (let j = 0; j < size; j++) {
    const py = yMin + j * dy;
    for (let i = 0; i < size; i++) {
      const px = xMin + i * dx;
      const idx = j * size + i;
      const t = Math.min(Math.max((heights[idx] - hMin) / hRange, 0), 1);
      const tc = Math.sqrt(t);

      positions[idx * 3 + 0] = px - cx;
      positions[idx * 3 + 1] = t * heightWorld;
      positions[idx * 3 + 2] = -(py - cy);
      uvs[idx * 2 + 0] = (px - xMin) / spanX;
      uvs[idx * 2 + 1] = (py - yMin) / spanY;

      const g = fn.grad({ x: px, y: py });
      const nx = -g.x * hScale;
      const nz = g.y * hScale;
      const len = Math.hypot(nx, 1, nz);
      normals[idx * 3 + 0] = nx / len;
      normals[idx * 3 + 1] = 1 / len;
      normals[idx * 3 + 2] = nz / len;

      if (useLut && lut) {
        // LUT candidate: 256-entry pre-parsed Viridis, nearest index.
        const c = lut[(tc * 255) | 0];
        colors[idx * 3 + 0] = c[0];
        colors[idx * 3 + 1] = c[1];
        colors[idx * 3 + 2] = c[2];
      } else {
        // Production path: d3 string interpolate + sRGB parse per vertex.
        colorScratch.setStyle(viridis(tc));
        colors[idx * 3 + 0] = colorScratch.r;
        colors[idx * 3 + 1] = colorScratch.g;
        colors[idx * 3 + 2] = colorScratch.b;
      }

      glows[idx] = Math.pow(1 - tc, 2.2);
      heightAttr[idx] = t;
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(positions, 3));
  geo.setAttribute("normal", new BufferAttribute(normals, 3));
  geo.setAttribute("aColor", new BufferAttribute(colors, 3));
  return { heights, hMin, hRange, geo };
}

/* ---- buildContourLines (verbatim, LandscapeView.ts:1703-1798) ---- */
function contourPass(fn: Landscape, heights: Float64Array, n: number, hMin: number, hRange: number) {
  const size = n + 1;
  const { xMin, xMax, yMin, yMax } = fn.extent;
  const dx = (xMax - xMin) / n;
  const dy = (yMax - yMin) / n;
  const cx = (xMin + xMax) / 2;
  const cy = (yMin + yMax) / 2;

  const levels: number[] = [];
  for (let i = 1; i <= VIEW_CONTOUR_LEVELS; i++) {
    levels.push(hMin + (hRange * i) / (VIEW_CONTOUR_LEVELS + 1));
  }
  const polys = contourGrid().size([size, size]).thresholds(levels)(
    heights as unknown as number[],
  );

  const pts: number[] = [];
  const nrmAttr: number[] = [];
  const hAttr: number[] = [];
  const scratch = new Vector3();
  const nrm = new Vector3();
  const heightWorld = HEIGHT_FRACTION * ((xMax - xMin) + (yMax - yMin)) / 2;
  const lift = Math.hypot(xMax - xMin, yMax - yMin) * 0.004;

  const worldAt = (gx: number, gy: number, out: Vector3) => {
    const px = xMin + (gx - 0.5) * dx;
    const py = yMin + (gy - 0.5) * dy;
    const t = Math.min(Math.max((fn.f({ x: px, y: py }) - hMin) / hRange, 0), 1);
    out.set(px - cx, t * heightWorld, -(py - cy));
    // surfaceNormal: grad + normalize (LandscapeView.surfaceNormal shape)
    const g = fn.grad({ x: px, y: py });
    const s = heightWorld / hRange;
    const nxx = -g.x * s;
    const nzz = g.y * s;
    const len = Math.hypot(nxx, 1, nzz);
    nrm.set(nxx / len, 1 / len, nzz / len);
    return { n: nrm, h: t };
  };

  let endpoints = 0;
  const onBorder = (v: number) =>
    Math.abs(v - 0) < 1e-6 || Math.abs(v - size) < 1e-6;
  for (const poly of polys) {
    for (const polygon of poly.coordinates) {
      for (const ring of polygon) {
        for (let i = 0; i < ring.length - 1; i++) {
          const a = ring[i];
          const b = ring[i + 1];
          if ((onBorder(a[0]) || onBorder(a[1])) && (onBorder(b[0]) || onBorder(b[1]))) {
            continue;
          }
          endpoints += 2;
          const pa = worldAt(a[0], a[1], scratch);
          pts.push(scratch.x + pa.n.x * lift, scratch.y + pa.n.y * lift, scratch.z + pa.n.z * lift);
          nrmAttr.push(pa.n.x, pa.n.y, pa.n.z);
          hAttr.push(pa.h);
          const pb = worldAt(b[0], b[1], scratch);
          pts.push(scratch.x + pb.n.x * lift, scratch.y + pb.n.y * lift, scratch.z + pb.n.z * lift);
          nrmAttr.push(pb.n.x, pb.n.y, pb.n.z);
          hAttr.push(pb.h);
        }
      }
    }
  }
  return { endpoints, ptsLen: pts.length };
}

/* ---- CompassMinimap.buildContours (verbatim, CompassMinimap.ts:472-512) ---- */
function minimapPass(fn: Landscape) {
  const size = MAP_GRID_N + 1;
  const { xMin, xMax, yMin, yMax } = fn.extent;
  const dx = (xMax - xMin) / MAP_GRID_N;
  const dy = (yMax - yMin) / MAP_GRID_N;

  const values = new Array<number>(size * size);
  let hMin = Infinity;
  let hMax = -Infinity;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const v = fn.f({ x: xMin + i * dx, y: yMin + j * dy });
      values[j * size + i] = v;
      if (v < hMin) hMin = v;
      if (v > hMax) hMax = v;
    }
  }
  const levels: number[] = [];
  for (let i = 1; i <= MAP_CONTOUR_LEVELS; i++) {
    levels.push(hMin + ((hMax - hMin) * i) / (MAP_CONTOUR_LEVELS + 1));
  }
  const polys = contourGrid().size([size, size]).thresholds(levels)(values);
  let segs = 0;
  for (const poly of polys) {
    for (const polygon of poly.coordinates) {
      for (const ring of polygon) segs += ring.length - 1;
    }
  }
  return segs;
}

/* ---- harness ---- */
const out = (s: string) => ((document.getElementById("out") as HTMLPreElement).textContent += s + "\n");

function bench(label: string, runs: number, fn: () => void): number[] {
  const ms: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    ms.push(performance.now() - t0);
  }
  ms.sort((a, b) => a - b);
  const med = ms[(runs / 2) | 0];
  const max = ms[ms.length - 1];
  out(`${label.padEnd(52)} p50=${med.toFixed(2)}ms  max=${max.toFixed(2)}ms`);
  return ms;
}

// Viridis LUT (256 entries, pre-parsed to linear rgb like setStyle would).
const LUT: number[][] = (() => {
  const viridis = scaleSequential(interpolateViridis);
  const c = new Color();
  const lut: number[][] = [];
  for (let i = 0; i < 256; i++) {
    c.setStyle(viridis(i / 255));
    lut.push([c.r, c.g, c.b]);
  }
  return lut;
})();

const E = 50;
const ROT = 30;
const fn = labBowl(E, ROT);
const runs = 24;

out(`§5 rebuild bench — labBowl(E=${E}, rot=${ROT}), ${runs} runs each\n`);
bench("terrain  gridN=64  prod colors", runs, () => terrainPass(fn, 64, false, null));
bench("terrain  gridN=64  LUT colors ", runs, () => terrainPass(fn, 64, true, LUT));
bench("terrain  gridN=48  prod colors", runs, () => terrainPass(fn, 48, false, null));
bench("terrain  gridN=48  LUT colors ", runs, () => terrainPass(fn, 48, true, LUT));
{
  const { heights, hMin, hRange } = terrainPass(fn, 64, false, null);
  const r = bench("contours gridN=64 (d3 + lift)", runs, () =>
    contourPass(fn, heights, 64, hMin, hRange),
  );
  const cp = contourPass(fn, heights, 64, hMin, hRange);
  out(`${"  ↳ endpoints".padEnd(52)} ${cp.endpoints} (pts ${cp.ptsLen})  p50=${r[(runs / 2) | 0].toFixed(2)}ms`);
  const h48 = terrainPass(fn, 48, false, null);
  bench("contours gridN=48 (d3 + lift)", runs, () =>
    contourPass(fn, h48.heights, 48, h48.hMin, h48.hRange),
  );
}
bench("minimap contours (61² grid, 12 lvl)", runs, () => minimapPass(fn));
bench("labChecks race re-run (3×220 steps)", runs, () => {
  runLabPath(fn, "gd");
  runLabPath(fn, "mom");
  runLabPath(fn, "adam");
});
{
  // Full production sequence, as the onFrame throttle lands it:
  bench("FULL rebuild gridN=64 prod (terr+cont+map+race)", 12, () => {
    const t = terrainPass(fn, 64, false, null);
    contourPass(fn, t.heights, 64, t.hMin, t.hRange);
    minimapPass(fn);
    runLabPath(fn, "gd");
    runLabPath(fn, "mom");
    runLabPath(fn, "adam");
  });
  bench("FULL rebuild gridN=48+LUT (fix candidate)", 12, () => {
    const t = terrainPass(fn, 48, true, LUT);
    contourPass(fn, t.heights, 48, t.hMin, t.hRange);
    minimapPass(fn);
    runLabPath(fn, "gd");
    runLabPath(fn, "mom");
    runLabPath(fn, "adam");
  });
}
out("\ndone");
