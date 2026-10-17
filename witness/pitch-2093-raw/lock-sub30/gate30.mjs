import fs from "node:fs";
const S = "/tmp/claude-1000/-config-workspace-mc-420/552e4f18-f9c8-4f76-973c-a987b5ca102c/scratchpad/lk";
const lines = fs.readFileSync(S + "/table.tsv", "utf8").trim().split("\n");
const vars = lines[0].split("\t").slice(2);
const rows = lines.slice(1).map(l => l.split("\t"));
const trk = {};
for (const r of rows) vars.forEach((v, i) => { (trk[v] ??= {})[r[0]] = +r[2 + i]; });
const lr = fs.readFileSync(S + "/lock_results.tsv", "utf8").trim().split("\n").slice(1).map(l => l.split("\t"));
const lock = {};
for (const r of lr) (lock[r[0]] ??= {})[r[1]] = { trk: +r[3], hz: +r[4], cents: +r[5], ncc: +r[6] };
const B = lock.base;
const cdiff = (a, b) => 1200 * Math.log2(a / b);
const corpus = Object.keys(B).filter(n => !n.startsWith("sine_"));
const report = [];
const summary = [];
for (const v of vars.filter(x => x !== "base")) {
  const L = lock[v];
  const g1d = (L.sine_2093.hz / 2093.005 - 1) * 100;
  const g1 = Math.abs(g1d) <= 2;
  const d1000 = Math.abs(L.sine_1000.hz / B.sine_1000.hz - 1) * 100;
  const d440 = Math.abs(L.sine_440.hz / B.sine_440.hz - 1) * 100;
  const g2 = d1000 <= 0.5 && d440 <= 0.5;
  const dC = cdiff(L.crotale_high_C7.hz, B.crotale_high_C7.hz);
  const dM = cdiff(L.marimba_mid_C5B5.hz, B.marimba_mid_C5B5.hz);
  const g3 = Math.abs(dC) <= 5 && Math.abs(dM) <= 5;
  const moved = [], worse = [];
  for (const n of corpus) {
    const dt = Math.abs(trk[v][n] / trk.base[n] - 1) * 100;
    const dl = Math.abs(L[n].hz / B[n].hz - 1) * 100;
    if (!(dt > 1 || dl > 1)) continue;
    const dc = Math.abs(L[n].cents) - Math.abs(B[n].cents);
    moved.push(n + " trk " + trk.base[n].toFixed(2) + ">" + trk[v][n].toFixed(2) + " lock " + B[n].hz.toFixed(2) + "(" + B[n].cents.toFixed(1) + "c,ncc " + B[n].ncc.toFixed(4) + ")>" + L[n].hz.toFixed(2) + "(" + L[n].cents.toFixed(1) + "c,ncc " + L[n].ncc.toFixed(4) + ")");
    if (dc > 5) worse.push(n);
  }
  const g4 = worse.length === 0;
  const admit = g1 && g2 && g3 && g4;
  summary.push([v, L.sine_2093.hz.toFixed(2), g1d.toFixed(3), d1000.toFixed(3), d440.toFixed(3), dC.toFixed(2), dM.toFixed(2), ft(L), moved.length, worse.join(","), g1, g2, g3, g4, admit].join("\t"));
  report.push("== " + v + " ADMIT=" + admit + " G1=" + g1 + " G2=" + g2 + " G3=" + g3 + " G4=" + g4);
  report.push("  sine_2093 " + L.sine_2093.hz.toFixed(3) + " (" + g1d.toFixed(3) + "%)  sine_1000 d=" + d1000.toFixed(3) + "%  sine_440 d=" + d440.toFixed(3) + "%");
  report.push("  crotale lock delta " + dC.toFixed(2) + "c  marimba_mid lock delta " + dM.toFixed(2) + "c");
  for (const m of moved) report.push("   " + m);
  report.push("  worse>5c: " + JSON.stringify(worse));
}
function ft(L) { return "flute_trill " + L.flute_trill_high_C7.hz.toFixed(1) + "(" + L.flute_trill_high_C7.cents.toFixed(1) + "c) vs base " + B.flute_trill_high_C7.hz.toFixed(1) + "(" + B.flute_trill_high_C7.cents.toFixed(1) + "c)"; }
fs.writeFileSync(S + "/gate.txt", report.join("\n") + "\n");
fs.writeFileSync(S + "/summary.tsv", "variant\tsine2093_hz\tsine2093_pct\td1000_pct\td440_pct\tcrotale_cents\tmarimba_cents\tflute\tmoved_n\tworse\tG1\tG2\tG3\tG4\tADMIT\n" + summary.join("\n") + "\n");
console.log(report.join("\n"));
