/**
 * qa-kicker-chip-clearance — pixel probe for the corner-chip collision.
 *
 * Visits EVERY step (?step=N, 0-based) at 1600x900 and measures, on real
 * screenshot pixels, the separation between step ink and the corner chip
 * "You Can't See the Loss <n> / <N>" (#reader-chip):
 *
 *   - INK IN THE CHIP'S ROW BAND (generic: any step ink — eyebrow, h2, a
 *     table — sharing rows with the chip must be >= MIN_GAP px left of the
 *     chip's left border). The ink edge is the rightmost pixel with
 *     luminance > INK_LUM in the band, scanned inside the reader column,
 *     left of the chip; the chip edge is the DOM border-box left of
 *     #reader-chip (its 1px border paints exactly there).
 *   - FIRST LINE FULLY BELOW THE CHIP: when a step's kicker sits entirely
 *     under the chip, the vertical gap kicker.top - chip.bottom must also
 *     be >= MIN_GAP (catches near-misses one row under the chip).
 *
 * Ink threshold: text-dim #9aa4b2 has luminance ~163; panel bg #0b0c0f ~12;
 * the hairline chip border over bg ~31 — text ink separates cleanly at 60.
 *
 * Usage: node tools/qa-kicker-chip-clearance.mjs [baseUrl] [--save-all]
 * Exit 0 iff every step passes.
 */
import { chromium } from "playwright";
import { launchGL } from "./gl-launch.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { SHOT_TARGETS } from "./shots.mjs";

const base = process.argv[2] && !process.argv[2].startsWith("--")
  ? process.argv[2]
  : "http://localhost:4173";
const SAVE_ALL = process.argv.includes("--save-all");
const MIN_GAP = 12; // px — the finding's bar
const INK_LUM = 60; // 0-255
const VIEW = { width: 1600, height: 900 };

const outDir = resolve("qa/KW1-KICKER-CHIP-CLEARANCE");
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures += 1;
};

const browser = await launchGL(chromium);
const page = await browser.newPage({ viewport: VIEW });
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

async function bootUrl(url) {
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(
    () => {
      const b = document.querySelector("#boot");
      return !b || b.dataset.done === "true";
    },
    null,
    { timeout: 30000 },
  );
  await sleep(1800); // entry snap
}

const boot = (n) => bootUrl(`${base}/?step=${n}`);

/** DOM-side measurements for the active step. */
async function measure() {
  return page.evaluate(() => {
    const chip = document.querySelector("#reader-chip");
    const step = document.querySelector('.rstep[data-active="true"]');
    const reader = document.querySelector("#reader");
    if (!chip || !step || !reader) return { error: "missing nodes" };
    const cr = chip.getBoundingClientRect();
    const rr = reader.getBoundingClientRect();
    const cs = getComputedStyle(chip);
    const chipVisible =
      cs.visibility !== "hidden" && Number(cs.opacity) > 0.5 && cr.width > 4;
    const kicker = step.querySelector(".kicker");
    const kr = kicker?.getBoundingClientRect() ?? null;
    return {
      chip: {
        left: cr.left,
        right: cr.right,
        top: cr.top,
        bottom: cr.bottom,
        visible: chipVisible,
      },
      readerLeft: rr.left,
      kicker: kr
        ? {
            top: kr.top,
            bottom: kr.bottom,
            text: (kicker.textContent ?? "").trim().slice(0, 48),
          }
        : null,
      scene: step.dataset.scene ?? "(none)",
    };
  });
}

/** Pixel-side: rightmost ink x in the chip's row band, left of the chip. */
async function inkScan(m) {
  const bandTop = Math.max(0, Math.floor(m.chip.top));
  const bandBottom = Math.min(VIEW.height, Math.ceil(m.chip.bottom));
  const clip = {
    x: Math.floor(m.readerLeft),
    y: bandTop,
    width: Math.floor(m.chip.left) - Math.floor(m.readerLeft),
    height: bandBottom - bandTop,
  };
  if (clip.width <= 0 || clip.height <= 0) return { inkRight: null };
  const buf = await page.screenshot({ clip });
  const b64 = buf.toString("base64");
  return page.evaluate(async (payload) => {
    const img = new Image();
    img.src = "data:image/png;base64," + payload.b64;
    await img.decode();
    const cv = document.createElement("canvas");
    cv.width = img.naturalWidth;
    cv.height = img.naturalHeight;
    const ctx = cv.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, cv.width, cv.height).data;
    const lum = (i) =>
      0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    let inkRight = null;
    for (let y = 0; y < cv.height; y++) {
      for (let x = cv.width - 1; x >= 0; x--) {
        if (inkRight !== null && x <= inkRight) break;
        if (lum((y * cv.width + x) * 4) > payload.inkLum) {
          inkRight = Math.max(inkRight ?? -1, x);
          break;
        }
      }
    }
    return { inkRight: inkRight === null ? null : inkRight + payload.clipX };
  }, { b64, clipX: clip.x });
}

const gaps = [];

/** Shared measurement + verdict for the currently loaded state. */
async function probeState(label, cropName) {
  let m = await measure();
  if (m.error) {
    check(label, false, m.error);
    return;
  }
  if (m.scene === "labrule") {
    await sleep(3000); // scoreboard / verdict text fills in late, refits the step
    m = await measure();
  }
  const labelFull = `${label} (${m.scene})${m.kicker ? ` "${m.kicker.text}"` : ""}`;
  if (!m.chip.visible) {
    check(labelFull, true, "chip hidden — nothing to separate");
    return;
  }
  const chipLeftPx = Math.round(m.chip.left);
  const scan = await inkScan(m);
  let ok = true;
  const notes = [];
  if (scan.inkRight !== null) {
    const gapH = chipLeftPx - (scan.inkRight + 1);
    gaps.push(gapH);
    notes.push(`band ink: inkRight=${scan.inkRight} chipLeft=${chipLeftPx} gapH=${gapH}px`);
    if (gapH < MIN_GAP) ok = false;
  } else {
    notes.push("no step ink in the chip's row band");
  }
  if (m.kicker && m.kicker.top >= m.chip.bottom) {
    const gapV = Math.round(m.kicker.top - m.chip.bottom);
    gaps.push(gapV);
    notes.push(`kicker fully below chip: gapV=${gapV}px`);
    if (gapV < MIN_GAP) ok = false;
  }
  if (SAVE_ALL || !ok) {
    const buf = await page.screenshot({
      clip: { x: m.readerLeft, y: 0, width: VIEW.width - m.readerLeft, height: 64 },
    });
    writeFileSync(resolve(outDir, `${cropName}.png`), buf);
  }
  check(labelFull, ok, notes.join("; "));
}

await boot(1);
const nSteps = await page.evaluate(() => document.querySelectorAll(".rstep").length);
console.log(`steps on page: ${nSteps}; viewport 1600x900; bar >= ${MIN_GAP}px`);

for (let n = 0; n < nSteps; n++) {
  await boot(n);
  await probeState(`step ${n}`, `step${String(n).padStart(2, "0")}`);
}

console.log("\n--- canonical shot states (tools/shots.mjs capture list) ---");
for (const [url, file] of SHOT_TARGETS) {
  await bootUrl(url);
  await probeState(`shot ${file}`, `shot-${file.replace(/\.png$/, "")}`);
}

await browser.close();
const minGap = gaps.length ? Math.min(...gaps) : null;
console.log(
  `\nmin measured gap across steps: ${minGap === null ? "n/a" : minGap + "px"}`,
);
console.log(failures === 0 ? `ALL_PASS (bar ${MIN_GAP}px)` : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
