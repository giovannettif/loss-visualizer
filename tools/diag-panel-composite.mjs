// Follow-up: verify the composite model at sample points.
// A = alpha*P + (1-alpha)*T with P=(13,16,20), alpha=0.88 => predict T from A, compare to actual B.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const a = readFileSync("shots/_diag_panel/with-panels.png").toString("base64");
const b = readFileSync("shots/_diag_panel/panels-hidden.png").toString("base64");
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu"] });
const page = await browser.newPage();
await page.goto("about:blank");
const out = await page.evaluate(async ({ a, b }) => {
  const load = (b64) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = "data:image/png;base64," + b64; });
  const [ia, ib] = await Promise.all([load(a), load(b)]);
  const c = document.createElement("canvas"); c.width = ia.width; c.height = ia.height;
  const ctx = c.getContext("2d");
  const grab = async (img) => { ctx.clearRect(0,0,c.width,c.height); ctx.drawImage(img,0,0); return ctx.getImageData(0,0,c.width,c.height).data; };
  const da = await grab(ia), db = await grab(ib);
  const px = (d,x,y) => { const i=(y*c.width+x)*4; return [d[i],d[i+1],d[i+2]]; };
  const P = [13,16,20], alpha = 0.88;
  const pts = [[300,404],[300,440],[330,350],[242,386],[280,300]];
  return pts.map(([x,y]) => {
    const A = px(da,x,y), T = px(db,x,y);
    const pred = P.map((p,k)=>Math.round(alpha*p+(1-alpha)*T[k]));
    const back = A.map((v,k)=>Math.round((v-alpha*P[k])/(1-alpha))); // implied terrain from A
    return { x, y, panelA: A, terrainBehindB: T, predictedA: pred, impliedTerrain: back, err: A.map((v,k)=>v-pred[k]) };
  });
}, { a, b });
console.log(JSON.stringify(out, null, 1));
await browser.close();
