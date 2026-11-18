/**
 * diag-s2-trail-ball-fixture — numeric model of the §5 lab replay lanes
 * (QA SEC5-S2-REPLAY-TRAIL-LEAD). Uses the REAL production code paths:
 *   lanes  = labChecks(LAB_E_DEFAULT=50, LAB_ROT_DEFAULT=30)  (director.ts)
 *   old    = ball samplePath(path, f) (arc length) + trail round(f·segments) (index)
 *   new    = replayLanePose: s=min(f·maxSteps, steps); ball samplePathAtStep(s),
 *            trail setStep → tip = path[floor(s)]
 * Prints one JSON document on stdout.
 */
import { labChecks } from "../src/scenes/director";
import {
  samplePath,
  samplePathAtStep,
  cumulativeLengths,
} from "../src/view/trajectoryPlayer";

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

/** Fractional STEP index whose arc length reaches fraction p of the total. */
const arcStepAt = (path: readonly { x: number; y: number }[], p: number) => {
  const { total, cum } = cumulativeLengths(path);
  const d = p * total;
  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i++;
  return i - 1 + (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
};

const { gdPath, momPath, adamPath } = labChecks(50, 30);
const lanes = [
  { name: "gd", path: gdPath },
  { name: "mom", path: momPath },
  { name: "adam", path: adamPath },
];
const maxSteps = Math.max(...lanes.map((l) => l.path.length - 1));

const out: Record<string, unknown> = {
  maxSteps,
  arcConcentration: lanes.map((l) => {
    const n = l.path.length - 1;
    const { total, cum } = cumulativeLengths(l.path);
    return {
      name: l.name,
      steps: n,
      totalArc: Math.round(total * 1000) / 1000,
      first10pctStepsArcShare:
        Math.round((cum[Math.floor(n * 0.1)] / total) * 1000) / 1000,
    };
  }),
  samples: [] as unknown[],
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
    (out.samples as unknown[]).push({
      f,
      name: l.name,
      steps: n,
      new_s: Math.round(s * 1000) / 1000,
      new_tipIdx: tipIdx,
      new_ball: {
        x: Math.round(newBall.x * 1e5) / 1e5,
        y: Math.round(newBall.y * 1e5) / 1e5,
      },
      new_ball_to_tip: Math.round(dist(newBall, newTip) * 1e4) / 1e4,
      new_tip_leads_steps: Math.round((s - tipIdx) * 1000) / 1000,
      old_ball: {
        x: Math.round(oldBall.x * 1e5) / 1e5,
        y: Math.round(oldBall.y * 1e5) / 1e5,
      },
      old_ball_at_step: Math.round(oldBallStep * 100) / 100,
      old_tipIdx: oldTipIdx,
      old_ball_to_tip: Math.round(dist(oldBall, oldTip) * 1e4) / 1e4,
      old_tip_leads_steps: Math.round((oldTipIdx - oldBallStep) * 100) / 100,
      arrival_f_new: Math.round((n / maxSteps) * 1000) / 1000,
    });
  }
}
console.log(JSON.stringify(out, null, 1));
