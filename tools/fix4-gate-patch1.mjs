// fix4-gate-patch1 — surgical gate-tour.mjs patch, block 0 + insert 0b.
// Every rule asserts an exact replacement count; any mismatch aborts with
// a nonzero exit and names the rule. Numbers in output are the reliable
// channel; run via: node tools/fix4-gate-patch1.mjs
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
  console.log(`RULE OK ${name}: ${n} replacement(s)`);
}

// R1: the shell copy expect — the chip label changed with FIX-4.
rule(
  "R1 shell expect",
  /\(note \?\? ""\)\.includes\("Tour this section"\) &&/,
  `(note ?? "").includes("Tour section") &&`,
  1,
);

// R2: block 0's per-step chip inventory + hero-chip count → the fixed
// entry chip check (hero hides the entry).
rule(
  "R2 block0 chips -> heroEntry",
  /  const chips = await page\.evaluate\(\(\) =>\n(?:.*\n)*?  check\("hero step carries no chip \(the intro is not a section\)", chipOnHero === 0\);\n/,
  `  // FIX-4: ONE fixed entry chip instead of per-step chips — on the hero
  // step (the intro is not a section) it must be absent or hidden.
  const heroEntry = await page.evaluate(() => {
    const el = document.querySelector("#tour-entry");
    return el
      ? { exists: true, hidden: el.hidden, label: (el.textContent ?? "").trim() }
      : { exists: false, hidden: true, label: "" };
  });
  check(
    "hero step: the tour entry is absent/hidden (the intro is not a section)",
    !heroEntry.exists || heroEntry.hidden === true,
    JSON.stringify(heroEntry),
  );
`,
  1,
);

// R3: insert the FIX-4a sweep block before section 1.
rule(
  "R3 insert 0b sweep",
  /\/\* ---------------- 1\. tourCheck: all nine tours resolve ---------------- \*\//,
  `/* ---------------- 0b. FIX-4a: the fixed bottom-center entry, per section --
 *
 * FIX-4 moved the tour entry OUT of the step prose into ONE fixed chip
 * pinned to the bottom-center of the canvas pane (the controller bar's
 * slot). Sweep every section step (1..26 — the hero is not a section) and
 * demand: visible, per-section label "▶ Tour section N" (N = tour order),
 * data-tour = the section's tour id, position:fixed, horizontally centered
 * on the canvas pane, near the viewport bottom — lifted to the sanctioned
 * 166px exactly on the §7 swarm page (BRK-3 twin, dock transport below).
 * The bare intro park ("/") hides it.
 */
{
  const SEC_OF_STEP = {
    1: "s1", 2: "s1", 3: "s1",
    4: "s2", 5: "s2", 6: "s2", 7: "s2",
    8: "s3", 9: "s3", 10: "s3",
    11: "s4", 12: "s4",
    13: "s5", 14: "s5",
    15: "s6", 16: "s6", 17: "s6",
    18: "s7", 19: "s7", 20: "s7", 21: "s7",
    22: "s8", 23: "s8",
    24: "s9", 25: "s9", 26: "s9",
  };
  const entryState = () =>
    page.evaluate(() => {
      const el = document.querySelector("#tour-entry");
      if (!el) return { exists: false };
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const reader = document.querySelector("#reader")?.getBoundingClientRect();
      const paneCx = reader ? (window.innerWidth - reader.width) / 2 : window.innerWidth / 2;
      return {
        exists: true,
        hidden: el.hidden,
        label: (el.textContent ?? "").trim(),
        tour: el.dataset.tour ?? null,
        pos: cs.position,
        cx: r.left + r.width / 2,
        paneCx,
        bottomGap: Math.round(window.innerHeight - r.bottom),
        dockLift:
          document.querySelector("#swarm-dock")?.dataset.visible === "true",
      };
    });

  await page.goto(\`\${base}/\`, { waitUntil: "load" });
  await sleep(1600);
  const intro = await entryState();
  check(
    "FIX-4a: the intro park hides the entry",
    !intro.exists || intro.hidden === true,
    JSON.stringify(intro),
  );

  let swept = 0;
  for (let k = 1; k <= 26; k++) {
    await page.goto(\`\${base}/?step=\${k}\`, { waitUntil: "load" });
    await sleep(1100);
    if (!(await waitIdle())) check(\`FIX-4a: ?step=\${k} entry unlocks\`, false, "still locked");
    const e = await entryState();
    const id = SEC_OF_STEP[k];
    const n = Number(id.slice(1));
    const wantGap = e.dockLift ? 166 : 16;
    const problems = [];
    if (!e.exists || e.hidden) problems.push("entry missing/hidden");
    if (e.tour !== id) problems.push(\`data-tour=\${e.tour} want \${id}\`);
    if (e.label !== \`▶ Tour section \${n}\`) problems.push(\`label=\${JSON.stringify(e.label)}\`);
    if (e.pos !== "fixed") problems.push(\`position=\${e.pos}\`);
    if (Math.abs(e.cx - e.paneCx) > 12) {
      problems.push(\`cx \${(e.cx - e.paneCx).toFixed(0)}px off pane center\`);
    }
    if (Math.abs(e.bottomGap - wantGap) > 24) {
      problems.push(\`bottomGap=\${e.bottomGap} want ~\${wantGap}\`);
    }
    check(\`FIX-4a: ?step=\${k} → \${id} chip fixed bottom-center, "Tour section \${n}"\`, problems.length === 0, problems.join("; "));
    if (problems.length === 0) swept += 1;
  }
  check("FIX-4a: sweep exercised all 26 section steps", swept === 26, \`swept=\${swept}\`);
}

/* ---------------- 1. tourCheck: all nine tours resolve ---------------- */`,
  1,
);

writeFileSync(p, s);
console.log("bytes:", orig.length, "->", s.length);
console.log("PATCH1_DONE");
