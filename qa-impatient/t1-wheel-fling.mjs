/**
 * T1 — the full-page fast wheel fling: intro → as far as the wheel gets,
 * then a second burst to the last step. Impatient-user contract:
 *  - never sticks (locked must clear, wheel must keep working),
 *  - one boundary crossing per wheel gesture (the KW-8 guard),
 *  - final state consistent: parked on the last step, no dead stretch past
 *    the last park, reader count + rail + scene agree with the step index.
 */
import { BASE, launch, waitReady, snapshot, ok, shot } from "./driver.mjs";

const { browser, page } = await launch();
await page.goto(BASE, { waitUntil: "load" });
await waitReady(page);

const s0 = await snapshot(page);
console.log("boot:", JSON.stringify({ intro: s0.scroll.intro, step: s0.step }));

// park the cursor over the CANVAS first (in intro mode the window handler
// owns the wheel; the reader itself is translated off-screen at x>=1440).
await page.mouse.move(600, 450);

// --- gesture 1: dock the reader (one big fling from the intro) ---
await page.mouse.wheel(0, 3000);
await page.waitForTimeout(700);
let s = await snapshot(page);
ok(s.step === 0 && !s.scroll.intro, "fling #1 docks the reader on step 0",
  `step=${s.step} intro=${s.scroll.intro}`);

// once docked the reader owns x >= 864: park the cursor over the reader text
const reader = await page.locator("#reader").boundingBox();
const rx = reader.x + reader.width / 2;
const ry = reader.y + reader.height / 2;
await page.mouse.move(rx, ry);

// --- gesture 2: continuous fast fling ~2.5s (150 notches @ ~15ms) ---
const seen = new Set([s.step]);
let stuckChecks = 0;
for (let i = 0; i < 150; i++) {
  await page.mouse.wheel(0, 120);
  if (i % 25 === 24) {
    await page.waitForTimeout(60); // tiny breath so it is not literally one event stream
  } else {
    await page.waitForTimeout(14);
  }
}
// gesture boundary: let the wheel go idle > 180ms
await page.waitForTimeout(500);
s = await snapshot(page);
seen.add(s.step);
console.log("after burst A:", JSON.stringify({ step: s.step, locked: s.locked, parked: s.scroll.parked, target: s.scroll.target, top: s.scroll.tops[s.step] }));

// during the burst the guard should have limited crossings: assert it did not
// run to the last step in one gesture (one crossing per gesture).
ok(s.step < 26, "one gesture does NOT sail to the last step", `landed step=${s.step}`);

// --- burst B and C: keep flinging until the last step ---
for (let round = 0; round < 40 && s.step < 26; round++) {
  for (let i = 0; i < 20; i++) {
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(12);
  }
  await page.waitForTimeout(260); // gesture boundary
  s = await snapshot(page);
  seen.add(s.step);
  if (s.locked) stuckChecks++;
  if (round > 30) break;
}
await page.waitForTimeout(900);
s = await snapshot(page);
console.log("final:", JSON.stringify(s, null, 1));
console.log("steps seen:", [...seen].join(","));

ok(s.step === 26, "flinging reaches the LAST step (26)", `step=${s.step}`);
ok(!s.locked, "lock released at the last step");
ok(!s.animating, "director idle at the last step");
ok(s.scroll.parked, "document parked on the last step's top", `y=${s.scroll.y} target=${s.scroll.target} top=${s.scroll.tops[26]}`);
ok(s.scroll.atSnap, "target snapped to the last park");
ok(s.countText === "27 / 27", "reader count reads 27 / 27", s.countText);
ok(s.railCurrent === 26, "rail highlight on tick 27", `railCurrent=${s.railCurrent}`);
ok(s.activeInert, "only the active step is active (inert discipline)");
ok(s.hintHidden === true, "continue hint hidden at the last step");
ok(s.skipHidden === true, "skip button hidden when unlocked");

// dead-zone check: hard wheel FORWARD at the last step must stay parked.
for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, 400); await page.waitForTimeout(10); }
await page.waitForTimeout(700);
s = await snapshot(page);
ok(s.step === 26 && s.scroll.parked && s.scroll.y === s.scroll.tops[26],
  "forward wheel at last step stays parked (no dead stretch)",
  `y=${s.scroll.y} maxScroll=${s.scroll.max} top26=${s.scroll.tops[26]}`);

await shot(page, "t1-final-last-step");
await browser.close();
console.log("T1 done");
