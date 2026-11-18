// Diagnostic (sweep-2, S2-HERO-HUDLEFT-DEADZONE): is the invisible #hud-left
// stack a pointer/wheel dead zone in the hero, and does the working-tree fix
// (pointer-events:none on the container, auto on visible children) clear it?
// Runs the same probe twice on one served build:
//   A  as-served          (page.css:248-250 fix present)
//   B  HEAD-equivalent CSS injected (#hud-left{pointer-events:auto} — the
//      BackupPlan1 rule had no pointer-events), reproducing the finding.
import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";

const base = process.argv[2] ?? "http://localhost:4339";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

const browser = await launchGL(chromium);

async function probe(tag, { simulateHead }) {
  console.log(`\n===== ${tag} =====`);
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto(`${base}/`, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__wp1, null, { timeout: 30000 });
  await sleep(4500); // intro choreography settle (cdp-intro convention: 4s+)
  if (simulateHead) {
    await page.addStyleTag({ content: "#hud-left{pointer-events:auto !important;}" });
    await sleep(200);
  }

  const panPx = () => page.evaluate(() => window.__wp1.debug().viewPan.px);
  const intro = () => page.evaluate(() => window.__wp1.scroll().intro);
  const zoom = () => page.evaluate(() => window.__wp1.debug().viewAttitude.zoomRadius);
  const near = (a, b, tol) => Math.abs(a - b) <= tol;

  /* 1. geometry + hit tests: the stack keeps its layout box while empty */
  const geom = await page.evaluate(() => {
    const hud = document.getElementById("hud-left");
    const r = hud.getBoundingClientRect();
    const kids = ["fit-panel", "loss-panel"].map((id) => {
      const el = document.getElementById(id);
      const cs = getComputedStyle(el);
      const kr = el.getBoundingClientRect();
      return { id, dataVisible: el.dataset.visible, visibility: cs.visibility, opacity: cs.opacity, w: Math.round(kr.width), h: Math.round(kr.height) };
    });
    const hit = (x, y) => {
      const e = document.elementFromPoint(x, y);
      return e ? `${e.tagName.toLowerCase()}#${e.id || "-"}${e.className && typeof e.className === "string" ? "." + e.className.split(" ").join(".") : ""}` : "null";
    };
    return {
      rect: { x: r.x, y: r.y, w: Math.round(r.width), h: Math.round(r.height) },
      containerPointerEvents: getComputedStyle(hud).pointerEvents,
      kids,
      hitDead1: hit(100, 200),
      hitDead2: hit(200, 400),
      hitControl: hit(800, 750),
    };
  });
  console.log("geom:", JSON.stringify(geom));
  check(`${tag}: #hud-left box ~342x412 at (14,62)`, near(geom.rect.x, 14, 2) && near(geom.rect.y, 62, 2) && near(geom.rect.w, 342, 6) && near(geom.rect.h, 412, 6), JSON.stringify(geom.rect));
  check(`${tag}: both left panels hidden`, geom.kids.every((k) => k.dataVisible === "false"), JSON.stringify(geom.kids));
  check(`${tag}: boot is intro/hero`, await intro() === true, `intro=${await intro()}`);

  /* 2. pan drag in the dead zone vs control */
  const p0 = await panPx();
  await page.mouse.move(150, 250);
  await page.mouse.down();
  await page.mouse.move(450, 250, { steps: 12 });
  await page.mouse.up();
  await sleep(400);
  const p1 = await panPx();
  check(`${tag}: dead-zone drag pans ${simulateHead ? "(HEAD: must NOT)" : "(fix: must)"}`, simulateHead ? near(p1.x, p0.x, 5) : near(p1.x, p0.x - 300, 40), `px.x ${p0.x} -> ${p1.x}`);
  await page.mouse.move(800, 750);
  await page.mouse.down();
  await page.mouse.move(1100, 750, { steps: 12 });
  await page.mouse.up();
  await sleep(400);
  const p2 = await panPx();
  check(`${tag}: control drag pans -300`, near(p2.x, p1.x - 300, 40), `px.x ${p1.x} -> ${p2.x}`);

  /* 3. click-to-dock in the dead zone vs control */
  await page.mouse.click(150, 250);
  await sleep(2500);
  const introAfterDead = await intro();
  check(`${tag}: dead-zone click docks ${simulateHead ? "(HEAD: must NOT)" : "(fix: must)"}`, simulateHead ? introAfterDead === true : introAfterDead === false, `intro=${introAfterDead}`);
  await page.mouse.click(800, 800);
  await sleep(2500);
  const introAfterCtl = await intro();
  check(`${tag}: control click docks`, introAfterCtl === false, `intro=${introAfterCtl}`);

  /* 4. docked wheel zoom in the dead zone vs control */
  await page.mouse.move(150, 250);
  const z0 = await zoom();
  await page.mouse.wheel(0, -120);
  await sleep(1300);
  const z1 = await zoom();
  check(`${tag}: docked dead-zone wheel zooms ${simulateHead ? "(HEAD: must NOT)" : "(fix: must)"}`, simulateHead ? near(z1, z0, 0.01) : z1 < z0 - 0.5, `zoomRadius ${z0} -> ${z1}`);
  await page.mouse.move(800, 600);
  await page.mouse.wheel(0, -120);
  await sleep(1300);
  const z2 = await zoom();
  check(`${tag}: docked control wheel zooms`, z2 < z1 - 0.5, `zoomRadius ${z1} -> ${z2}`);

  await page.close();
}

const a = await probe("A as-served (working-tree fix)", { simulateHead: false });
const b = await probe("B HEAD-equivalent CSS (finding repro)", { simulateHead: true });

await browser.close();
console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURES"}`);
process.exit(failures === 0 ? 0 : 1);
