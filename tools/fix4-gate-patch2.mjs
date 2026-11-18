// fix4-gate-patch2 — §1 gate choreography (FIX-4c) + §1-tail back-during-gate.
import { readFileSync, writeFileSync } from "node:fs";

const p = "tools/gate-tour.mjs";
let s = readFileSync(p, "utf8");
const orig = s;

function rule(name, re, replacement, expected) {
  const m = s.match(re);
  const n = m === null ? 0 : m.length;
  if (n !== expected) {
    console.error(`RULE FAIL ${name}: matched ${n}, expected ${expected}`);
    process.exit(1);
  }
  s = s.replace(re, replacement);
  console.log(`RULE OK ${name}: ${n}`);
}

// A: the swallowed-Next/Space block → the FIX-4 gate matrix (waits; Back
// no-ops only at the head; Next skips; Back re-enters + re-arms; the
// inset drag still releases).
rule(
  "A §1 swallowed block -> gate matrix",
  /  \/\/ The gate PAUSES: no auto-advance \(Auto is OFF\), and Next\/Space\/clicks\n(?:.*\n)*?  check\("§1 Space during a gate is swallowed", s0c\?\.stepIndex === 0 && s0c\?\.gate === true, JSON\.stringify\(s0c\)\);\n/,
  `  // The gate WAITS: no auto-advance while Auto is off — and FIX-4 says a
  // waiting gate can never trap. The matrix: Back no-ops only at the
  // playlist head; Next (and Space) POLITELY SKIP — disarm + advance;
  // Back reverses INTO the gate sentence and the gate RE-ARMS; the
  // visitor's own action releases it on its own.
  await sleep(1200);
  const sHold = await tourState();
  check(
    "§1 gate waits (no auto-advance while Auto is off)",
    sHold?.stepIndex === 0 && sHold?.gate === true,
    JSON.stringify(sHold),
  );

  await page.locator("#tour-back").click();
  await sleep(300);
  const sHead = await tourState();
  check(
    "§1 Back at the playlist head is a no-op (gate still armed)",
    sHead?.stepIndex === 0 && sHead?.gate === true,
    JSON.stringify(sHead),
  );

  // FIX-4c: Next politely SKIPS the gate.
  await page.locator("#tour-next").click();
  const sSkip = await waitTour(
    (s) => s.phase === "active" && s.stepIndex === 1 && s.gate === false,
    6000,
    "§1 Next skips the gate",
  );
  check(
    "§1 Next during a gate SKIPS it (disarm + advance)",
    sSkip?.stepIndex === 1 && sSkip?.gate === false,
    JSON.stringify(sSkip),
  );

  // Back reverses into the gate sentence; arriving fresh, the gate re-arms.
  await page.locator("#tour-back").click();
  const sBack = await waitTour(
    (s) => s.phase === "active" && s.stepIndex === 0 && s.gate === true,
    6000,
    "§1 back into the gate",
  );
  check(
    "§1 Back reverses into the gate sentence and re-arms it",
    sBack?.stepIndex === 0 && sBack?.gate === true,
    JSON.stringify(sBack),
  );
`,
  1,
);

// B: the plain-click check now runs while parked on the RE-ARMED gate
// (stepIndex 0) — update its comment to match the new choreography.
rule(
  "B plain-click comment",
  /  \/\/ v2 CLICK DOES NOTHING: a plain click on reader text advances neither the\n  \/\/ tour nor the reader\.\n/,
  `  // v2 CLICK DOES NOTHING: a plain click on reader text advances neither
  // the tour nor the reader (parked on the re-armed gate sentence).
`,
  1,
);

// C: §1 tail — insert the canonical BACK-DURING-GATE beat at the ball gate.
rule(
  "C ball-gate Back beat",
  /  check\("§1 back on the ball gate", s3\?\.stepIndex === 3 && s3\?\.gateKind === "fitMoved", JSON\.stringify\(s3\)\);\n/,
  `  check("§1 back on the ball gate", s3?.stepIndex === 3 && s3?.gateKind === "fitMoved", JSON.stringify(s3));

  // FIX-4c regression (the trap the user hit): Back DURING an open gate
  // must always work — reverse to the previous sentence and disarm the
  // gate (no reader lock left behind).
  await page.locator("#tour-back").click();
  const sBackGate = await waitTour(
    (s) => s.phase === "active" && s.stepIndex === 2 && s.gate === false,
    8000,
    "§1 Back during the gate",
  );
  const aBackGate = await appState();
  check(
    "FIX-4c: Back during an open gate reverses + disarms it (→ task-b, no lock)",
    sBackGate?.stepIndex === 2 && sBackGate?.gate === false &&
      aBackGate.scene === "task-b" && aBackGate.locked === false,
    \`tour=\${JSON.stringify(sBackGate)} app=\${JSON.stringify(aBackGate)}\`,
  );

  // Forward again: the gate re-arms on fresh arrival, and the ball drag
  // (the visitor's action) releases it into the tour's completion.
  await page.locator("#tour-next").click();
  const s3b = await waitTour(
    (s) => s.phase === "active" && s.stepIndex === 3 && s.gate === true,
    15000,
    "§1 gate re-arm",
  );
  check("§1 the ball gate re-arms on fresh arrival", s3b?.stepIndex === 3 && s3b?.gate === true, JSON.stringify(s3b));
`,
  1,
);

writeFileSync(p, s);
console.log("bytes:", orig.length, "->", s.length);
console.log("PATCH2_DONE");
