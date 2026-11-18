/**
 * T2b — auto-repeat guard probe. Headless CDP does not synthesize OS
 * auto-repeat, so the repeat path is exercised with synthetic keydowns
 (repeat:true — the same property a real OS repeat carries) plus rapid
 * press-cycling. The app handlers do not gate on isTrusted.
 */
import { BASE, launch, waitReady, snapshot, ok } from "./driver.mjs";

const { browser, page } = await launch();
await page.goto(BASE + "?step=10", { waitUntil: "load" });
await waitReady(page);
await page.waitForTimeout(2500);
let s = await snapshot(page);
console.log("start:", s.step);

// --- synthetic OS-repeat: 25 keydown events with repeat:true, key never released ---
const rep = (key) => page.evaluate((k) => {
  let n = 0;
  const fire = () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: k, code: k === " " ? "Space" : k, repeat: true, bubbles: true, cancelable: true }));
    n++;
    if (n < 25) setTimeout(fire, 33); // ~30Hz like a real OS repeat
  };
  fire();
  return new Promise((res) => setTimeout(() => res(window.__wp1.step()), 1200));
}, key);

const downStep = await rep("ArrowDown");
await page.waitForTimeout(1000);
s = await snapshot(page);
console.log("synthetic repeat ArrowDown:", downStep, "settled:", s.step);
ok(s.step === 11, "ArrowDown synthetic auto-repeat advances exactly ONE step (guard swallows repeats)", `start=10 settled=${s.step}`);

const spaceStep = await rep(" ");
await page.waitForTimeout(1000);
s = await snapshot(page);
console.log("synthetic repeat Space:", spaceStep, "settled:", s.step);
ok(s.step === 12, "Space synthetic auto-repeat advances exactly ONE step", `start=11 settled=${s.step}`);

const upStep = await rep("ArrowUp");
await page.waitForTimeout(1000);
s = await snapshot(page);
console.log("synthetic repeat ArrowUp:", upStep, "settled:", s.step, "(started at 12)");
ok(s.step === 11, "ArrowUp synthetic auto-repeat goes back exactly ONE step",
  `start=12 settled=${s.step} ${s.step !== 11 ? `<<< SAILS: walked 12->${s.step}` : ""}`);

// --- rapid physical press-cycling (down/up 20x, ~60ms apart) ---
await page.evaluate(() => { document.querySelectorAll("#rail button")[4].click(); });
await page.waitForTimeout(2500);
const cyc = await page.evaluate(async () => {
  const fire = (type, k) => window.dispatchEvent(new KeyboardEvent(type, { key: k, code: k === " " ? "Space" : k, bubbles: true, cancelable: true }));
  const steps = [];
  for (let i = 0; i < 20; i++) {
    fire("keydown", "ArrowDown"); fire("keyup", "ArrowDown");
    steps.push(window.__wp1.step());
    await new Promise((r) => setTimeout(r, 60));
  }
  await new Promise((r) => setTimeout(r, 1200));
  return { steps, final: window.__wp1.step(), locked: window.__wp1.locked() };
});
console.log("rapid cycling steps:", cyc.steps.join(","));
console.log("rapid cycling final:", cyc.final, "locked:", cyc.locked);
ok(cyc.final === 5, "20 rapid ArrowDown presses land exactly one step forward", `final=${cyc.final}`);
ok(!cyc.locked, "no stuck lock after rapid cycling");

// --- rapid BACKWARD cycling (the impatient reader flipping back) ---
const cycB = await page.evaluate(async () => {
  const fire = (type, k) => window.dispatchEvent(new KeyboardEvent(type, { key: k, code: k, bubbles: true, cancelable: true }));
  const steps = [];
  for (let i = 0; i < 20; i++) {
    fire("keydown", "ArrowUp"); fire("keyup", "ArrowUp");
    steps.push(window.__wp1.step());
    await new Promise((r) => setTimeout(r, 60));
  }
  await new Promise((r) => setTimeout(r, 1200));
  return { steps, final: window.__wp1.step(), locked: window.__wp1.locked() };
});
console.log("rapid back steps:", cycB.steps.join(","));
ok(cycB.final === 0, "20 rapid ArrowUp presses walk back to step 0 (one per press)", `final=${cycB.final}`);
ok(!cycB.locked, "no stuck lock after backward cycling");

// --- end-consistency ---
s = await snapshot(page);
ok(s.railCurrent === s.step && s.activeInert, "rail/inert consistent after cycling");
ok(s.scroll.parked, "parked at step 0", `y=${s.scroll.y} top0=${s.scroll.tops[0]}`);
await browser.close();
console.log("T2b done");
