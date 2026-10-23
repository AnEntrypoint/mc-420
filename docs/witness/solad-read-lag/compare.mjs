import { readFileSync } from "node:fs";
import path from "node:path";

const dir = path.join(import.meta.dirname ?? new URL(".", import.meta.url).pathname);
const load = (tag) => {
  const rows = readFileSync(path.join(dir, `results-${tag}.csv`), "utf8").trim().split("\n").slice(1);
  const m = new Map();
  for (const r of rows) {
    const c = r.split(",");
    m.set(`${c[0]}|${c[1]}`, {
      gapMin: +c[2], gapMean: +c[3], gapMax: +c[4], measured: +c[5],
      effRate: +c[6], splices: +c[7], emergency: +c[8], clamped: +c[9],
      peakStep: +c[10], rms: +c[11], glitches: +c[12],
    });
  }
  return m;
};

const base = load("base");
const tags = process.argv.slice(2);
let bad = 0;
for (const tag of tags) {
  const v = load(tag);
  const g0 = [], gl = { up: [], down: [] }, emg = [], clm = [], cents = [];
  let totalBase = 0, totalV = 0;
  for (const [k, b] of base) {
    const c = v.get(k);
    if (!c) { console.log(`${tag} MISSING ${k}`); bad++; continue; }
    const [, semis] = k.split("|");
    totalBase += b.glitches; totalV += c.glitches;
    if (semis === "0") g0.push(c.gapMean);
    if (c.glitches > b.glitches) gl.up.push(`${k} ${b.glitches}->${c.glitches}`);
    if (c.emergency > b.emergency) emg.push(`${k} ${b.emergency}->${c.emergency}`);
    if (c.clamped > b.clamped) clm.push(`${k} ${b.clamped}->${c.clamped}`);
    if (b.measured > 0 && c.measured > 0) {
      const ce = 1200 * Math.log2(c.measured / b.measured);
      if (Math.abs(ce) > 5) cents.push(`${k} ${ce.toFixed(1)}c (${b.measured}->${c.measured})`);
    }
  }
  const mean0 = g0.reduce((a, x) => a + x, 0) / g0.length;
  const R1 = mean0 <= 48 ? "PASS" : "FAIL";
  const R2 = gl.up.length === 0 && totalV <= totalBase ? "PASS" : "FAIL";
  const R3 = emg.length === 0 && clm.length === 0 ? "PASS" : "FAIL";
  const R4 = cents.length === 0 ? "PASS" : "FAIL";
  if (R1 === "FAIL" || R2 === "FAIL" || R3 === "FAIL" || R4 === "FAIL") bad++;
  console.log(`\n=== ${tag} ===`);
  console.log(`R1 semis=0 gapMean mean=${mean0.toFixed(2)} (base 64.00) -> ${R1}`);
  console.log(`R2 glitches base=${totalBase} ${tag}=${totalV} -> ${R2}`);
  if (gl.up.length) console.log(`   glitch regressions: ${gl.up.join("; ")}`);
  console.log(`R3 emergency/clamped -> ${R3}`);
  if (emg.length) console.log(`   emergency: ${emg.join("; ")}`);
  if (clm.length) console.log(`   clamped: ${clm.slice(0, 10).join("; ")}${clm.length > 10 ? ` (+${clm.length - 10} more)` : ""}`);
  console.log(`R4 pitch within 5c of base -> ${R4}`);
  if (cents.length) console.log(`   moved: ${cents.slice(0, 10).join("; ")}${cents.length > 10 ? ` (+${cents.length - 10} more)` : ""}`);
}
process.exit(bad ? 1 : 0);
