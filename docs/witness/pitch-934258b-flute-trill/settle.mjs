import fs from "node:fs";
const S = process.argv[2];
const out = {};
for (const v of ["base", "new"]) {
  const rows = fs.readFileSync(`${S}/${v}/trace_${v}.txt`, "utf8").trim().split("\n").map(l => l.trim().split(/\s+/).map(Number));
  const T = rows[rows.length - 1][0];
  const lastHalf = rows.filter(([t, hz]) => t > T / 2 && hz > 0).map(([, hz]) => hz).sort((a, b) => a - b);
  const med = (a) => { const n = a.length; return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2; };
  const s = med(lastHalf);
  const n0 = Math.round(69 + 12 * Math.log2(s / 440));
  out[v] = { duration: T, nonzeroLastHalf: lastHalf.length, min: lastHalf[0], max: lastHalf[lastHalf.length - 1], settled: s.toFixed(4), heldNote: n0, heldHz: (440 * 2 ** ((n0 - 69) / 12)).toFixed(3), exactNoteFloat: (69 + 12 * Math.log2(s / 440)).toFixed(4) };
}
console.log(JSON.stringify(out, null, 1));
