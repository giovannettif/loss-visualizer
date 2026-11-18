// Judge evidence runner: pixel scans + zoomed crops into _judge_crops/
import fs from 'node:fs';
import { decodePNG, crop, encodePNG, scan, px } from './qa-judge-png.mjs';

const S = 'shots/';
const OUT = 'shots/_judge_crops/';
fs.mkdirSync(OUT, { recursive: true });

function cropTo(src, x0, y0, x1, y1, scale, name) {
  const img = decodePNG(S + src);
  const c = crop(img, x0, y0, Math.min(x1, img.w), Math.min(y1, img.h), scale);
  fs.writeFileSync(OUT + name, encodePNG(c));
  console.log(`crop ${name} <- ${src} [${x0},${y0},${x1},${y1}] x${scale} -> ${c.w}x${c.h}`);
}

// ---- 1. §2 minimap: scan for §8 purple #9A72AC (154,114,172) ±12 and lavender needle #C9A6DD
const PURPLE = [154, 114, 172], LAV = [201, 166, 221], RED = [252, 98, 85], WHITE = [255, 255, 255];
for (const [file, x0, y0, x1, y1] of [
  ['37-minimap-gdb-arrows.png', 14, 600, 200, 890],
  ['08-gd-b.png', 14, 600, 200, 890],
  ['09-gd-c.png', 14, 600, 200, 890],
  ['07-gd-a.png', 14, 600, 200, 890],
]) {
  const img = decodePNG(S + file);
  const p = scan(img, x0, y0, x1, y1, PURPLE, 12);
  const l = scan(img, x0, y0, x1, y1, LAV, 20);
  const r = scan(img, x0, y0, x1, y1, RED, 30);
  console.log(`${file} minimap[${x0},${y0},${x1},${y1}] #9A72AC±12=${p.count} lavender#C9A6DD±20=${l.count} red±30=${r.count}`);
  if (p.count) console.log('  purple samples', JSON.stringify(p.samples));
  if (l.samples.length) console.log('  lavender sample', JSON.stringify(l.samples.slice(0, 3)));
}

// ---- 2. label colors: fog reveal/trap marker labels + swarm/momentum trail colors
{
  const a = decodePNG(S + '18-fog-c.png');
  console.log('18-fog-c trap label px', JSON.stringify(px(a, 470, 371)), JSON.stringify(px(a, 560, 371)), JSON.stringify(px(a, 700, 371)));
  const b = decodePNG(S + '20-fog-c-live.png');
  console.log('20-fog-c-live label px', JSON.stringify(px(b, 545, 371)), JSON.stringify(px(b, 600, 371)), JSON.stringify(px(b, 660, 371)));
  const c = decodePNG(S + '11-mom-a.png');
  console.log('11-mom-a dot px', JSON.stringify(px(c, 522, 390)), JSON.stringify(px(c, 400, 434)), JSON.stringify(px(c, 440, 433)));
  const d = decodePNG(S + '15-lab.png');
  console.log('15-lab trail px (mom blue?)', JSON.stringify(px(d, 490, 470)), JSON.stringify(px(d, 520, 460)));
  const e = decodePNG(S + '07-gd-a.png');
  console.log('07-gd-a needle px', JSON.stringify(px(e, 100, 700)), JSON.stringify(px(e, 106, 703)));
}

// ---- 3. crops for flagged/verify regions
cropTo('33-tour-s2-end.png', 240, 780, 800, 895, 2, 'c1-tour-end-bottom.png');
cropTo('diag-s8-beatclaim-1-entry.png', 1020, 8, 1600, 60, 3, 'c2-diag-s8-eyebrow-chip.png');
cropTo('22-labrule.png', 1020, 105, 1600, 150, 3, 'c3-labrule-eyebrow-canonical.png');
cropTo('13-adam-a.png', 1040, 555, 1550, 615, 2, 'c4-adam-caption.png');
cropTo('07-gd-a.png', 1040, 500, 1550, 625, 2, 'c5-gda-caption.png');
cropTo('23-epi-a.png', 1040, 590, 1550, 650, 2, 'c6-epi-caption.png');
cropTo('17-fog-b.png', 1040, 525, 1550, 575, 2, 'c7-fogb-caption.png');
cropTo('11-mom-a.png', 320, 360, 580, 480, 3, 'c8-mom-a-dots.png');
cropTo('18-fog-c.png', 430, 355, 810, 395, 3, 'c9-fogc-gold-label.png');
cropTo('20-fog-c-live.png', 505, 355, 730, 395, 3, 'c10-fogc-live-label.png');
cropTo('09-gd-c.png', 1050, 280, 1550, 475, 2, 'c11-gdc-fracs.png');
cropTo('02-task-a.png', 1050, 425, 1550, 525, 2, 'c12-task-sum.png');
cropTo('23-epi-a.png', 1050, 430, 1550, 585, 2, 'c13-epi-f4.png');
cropTo('15-lab.png', 14, 700, 360, 890, 2, 'c14-lab-dock.png');
cropTo('37-minimap-gdb-arrows.png', 10, 595, 205, 895, 3, 'c15-minimap-arrows.png');
cropTo('26-fogswarm-live.png', 400, 690, 640, 760, 3, 'c16-tour-entry-chip.png');
console.log('done');
