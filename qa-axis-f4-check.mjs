// F4 constant check: normal equations on leastSquares must reproduce the
// shipped constants w* = 0.9094 / b* = 1.3064 / L* = 1.4246 (COPY-PLAN F4).
import { leastSquares, LEAST_SQUARES_POINTS } from "./src/core/functions.ts";
const n = LEAST_SQUARES_POINTS.length;
let Sxx = 0, Sx = 0, Sb = n, Sxy = 0, Sy = 0;
for (const p of LEAST_SQUARES_POINTS) {
  Sxx += p.x * p.x; Sx += p.x; Sxy += p.x * p.y; Sy += p.y;
}
// (X^T X) w* = X^T y  with X rows [x, 1]
const det = Sxx * Sb - Sx * Sx;
const w = (Sb * Sxy - Sx * Sy) / det;
const b = (Sxx * Sy - Sx * Sxy) / det;
console.log("closed form w* =", w.toFixed(4), "b* =", b.toFixed(4));
console.log("shipped        w* = 0.9094 b* = 1.3064");
console.log("L* at closed form =", leastSquares.f({ x: w, y: b }).toFixed(4), "(shipped L* = 1.4246)");
console.log("grad at w*:", leastSquares.grad({ x: w, y: b }));
