/**
 * T6 — §7 tilt live run vs the reader keys. The impatient player holds WASD
 * and hammers ↓ mid-run. Contract (QA S2-BWD-1): ↑/↓ ALWAYS page the reader,
 * even during a live run; WASD/←→ steer only. And (QA KW-4): a key still
 * physically held when the run ENDS stays swallowed — its OS auto-repeat
 * must not sail the reader.
 */
import { BASE, launch, waitReady, snapshot, ok, shot } from "./driver.mjs";

const { browser, page } = await launch();
await page.goto(BASE + "?step=18", { waitUntil: "load" });
await waitReady(page);
await page.waitForTimeout(3000);
let s = await snapshot(page);
console.log("boot tilt-a:", JSON.stringify({ step: s.step, scene: s.scene, tilt: s.tilt, locked: s.locked }));

const tilt = () => page.evaluate(() => window.__wp1.tilt());

// --- start steering: hold W 800ms (real key events) ---
await page.keyboard.down("w");
await page.waitForTimeout(800);
const mid = await tilt();
await page.keyboard.up("w");
await page.waitForTimeout(300);
console.log("after W hold:", JSON.stringify(mid));
ok(mid && (mid.cells > 1 || mid.steps > 0), "live run responds to W (steering counted)", JSON.stringify({ cells: mid.cells, steps: mid.steps }));
ok(mid && mid.steered === true, "run flagged steered");

// --- ArrowDown MID-RUN must page the reader (S2-BWD-1) ---
await page.keyboard.down("d"); // steering while we navigate
await page.keyboard.press("ArrowDown");
await page.waitForTimeout(200);
const midNav = await snapshot(page);
await page.keyboard.up("d");
console.log("mid-run ArrowDown:", JSON.stringify({ step: midNav.step, locked: midNav.locked }));
ok(midNav.step === 19, "ArrowDown pages EVEN during a live tilt run", `step=${midNav.step}`);
await page.waitForTimeout(2000);
s = await snapshot(page);

// --- ArrowUp back to 18 mid-scene; then re-steer works (no stuck input) ---
await page.keyboard.press("ArrowUp");
await page.waitForTimeout(1500);
s = await snapshot(page);
ok(s.step === 18, "ArrowUp pages back", `step=${s.step}`);
await page.keyboard.down("s");
await page.waitForTimeout(500);
const re = await tilt();
await page.keyboard.up("s");
console.log("re-steer on 18:", JSON.stringify({ cells: re.cells, steps: re.steps, steered: re.steered }));
ok(re.steps > 0 || re.cells > mid.cells, "steering works after paging away and back (no stuck key state)");

// --- KW-4: hold W, click Finish mid-hold, keep holding (auto-repeat sim via rapid synthetic repeats), release; then ArrowDown = exactly one page ---
const runBefore = await tilt();
console.log("run before finish:", JSON.stringify({ cells: runBefore.cells, steps: runBefore.steps, done: runBefore.done }));
await page.keyboard.down("w");
await page.waitForTimeout(120);
await page.evaluate(() => document.querySelector("#tilt-finish")?.click());
// the run just ended under a held W: fire synthetic W repeats (what the OS would do) + a few ArrowDowns
const post = await page.evaluate(async () => {
  const fire = (k) => window.dispatchEvent(new KeyboardEvent("keydown", { key: k, code: k.length === 1 ? k : k, bubbles: true, cancelable: true }));
  const stepsSeen = [];
  for (let i = 0; i < 8; i++) {
    fire("w"); // held-key auto-repeat while the run is over
    await new Promise((r) => setTimeout(r, 40));
    stepsSeen.push(window.__wp1.step());
  }
  fire("ArrowDown");
  await new Promise((r) => setTimeout(r, 300));
  stepsSeen.push(window.__wp1.step());
  return { stepsSeen: stepsSeen.join(","), tilt: window.__wp1.tilt() };
});
await page.keyboard.up("w");
await page.waitForTimeout(1500);
let s3 = await snapshot(page);
console.log("KW4 probe:", JSON.stringify({ stepsSeen: post.stepsSeen, tilt: { done: post.tilt.done, cells: post.tilt.cells, steps: post.tilt.steps } }));
console.log("final step:", s3.step);
ok(post.tilt.done === true, "Finish ended the run mid-hold");
ok(s3.step === 19, "one fresh ArrowDown after run end advances exactly once (held W repeats swallowed, did NOT sail)", `step=${s3.step} seen=${post.stepsSeen}`);

// --- blur edge: page hidden keys cleared (window blur clears heldTiltKeys) ---
await page.keyboard.down("a");
await page.evaluate(() => window.dispatchEvent(new Event("blur")));
await page.keyboard.up("a");
await page.waitForTimeout(300);
const afterBlur = await tilt();
console.log("after blur:", JSON.stringify({ input: afterBlur.input }));
ok(Math.abs(afterBlur.input.x) + Math.abs(afterBlur.input.y) === 0, "window blur clears stuck tilt input");

await shot(page, "t6-tilt-end");
await browser.close();
console.log("T6 done");
