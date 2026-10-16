import fs from "node:fs";
const S = "/tmp/claude-1000/-config-workspace-mc-420/552e4f18-f9c8-4f76-973c-a987b5ca102c/scratchpad/lk";
const tab = fs.readFileSync(S + "/table.tsv", "utf8").trim().split("\n").slice(1).map(l => l.split("\t"));
const trk = {};
const hdr = fs.readFileSync(S + "/table.tsv", "utf8").split("\n")[0].split("\t").slice(2);
for (const r of tab) hdr.forEach((v, i) => { (trk[v] ??= {})[r[0]] = +r[2 + i]; });
const lock = {};
const lr = fs.readFileSync(S + "/lock_results.tsv", "utf8").trim().split("\n").slice(1).map(l => l.split("\t"));
for (const r of lr) (lock[r[0]] ??= {})[r[1]] = { hz: +r[4], cents: +r[5], ncc: +r[6], trk: +r[3] };
const base = lock.base;
const target = (n) => 440 * Math.pow(2, (n - 69) / 12);
const note = {}; for (const r of tab) note[r[0]] = +r[1];
const variants = Object.keys(lock).filter(v => v !== "base");
const out = [];
for (const v of variants) {
  const L = lock[v], B = base;
  const g1 = L.sine_2093 && Math.abs(L.sine_2093.hz / 2093.005 - 1) <= 0.02;
  const d1000 = L.sine_1000 && B.sine_1000 ? Math.abs(L.sine_1000.hz / B.sine_1000.hz - 1) : NaN;
  const d440 = L.sine_440 && B.sine_440 ? Math.abs(L.sine_440.hz / B.sine_440.hz - 1) : NaN;
  const g2 = d1000 <= 0.005 && d440 <= 0.005;
  const ft = L.flute_trill_high_C7, ftb = B.flute_trill_high_C7;
  const g3 = ft && ftb && (Math.abs(ft.cents) - Math.abs(ftb.cents) <= 5) && ft.ncc >= ftb.ncc;
  const changed = [], worse = [];
  for (const n of Object.keys(L)) {
    if (!B[n] || isNaN(trk[v][n]) || isNaN(trk.base[n])) continue;
    const dt = Math.abs(trk[v][n] / trk.base[n] - 1);
    if (dt > 0.01) {
      changed.push(n + " trk " + trk.base[n].toFixed(1) + ">" + trk[v][n].toFixed(1) + " lock " + B[n].hz.toFixed(1) + "(" + B[n].cents.toFixed(1) + "," + B[n].ncc.toFixed(4) + ")>" + L[n].hz.toFixed(1) + "(" + L[n].cents.toFixed(1) + "," + L[n].ncc.toFixed(4) + ")");
      if (Math.abs(L[n].cents) - Math.abs(B[n].cents) > 5) worse.push(n);
    }
  }
  const admit = !!g1 && g2 && !!g3 && worse.length === 0;
  out.push("VARIANT " + v + " sine2093=" + (L.sine_2093 ? L.sine_2093.hz.toFixed(2) : "NA") + " (" + (L.sine_2093 ? L.sine_2093.cents.toFixed(1) : "") + "c) G1=" + !!g1 + " d1000=" + (d1000*100).toFixed(3) + "% d440=" + (d440*100).toFixed(3) + "% G2=" + g2 + " flute_trill=" + (ft ? ft.hz.toFixed(1) + "(" + ft.cents.toFixed(1) + "c,ncc " + ft.ncc.toFixed(4) + ")" : "NA") + " G3=" + !!g3 + " changed>1%=" + changed.length + " worse>5c=" + JSON.stringify(worse) + " ADMIT=" + admit);
  for (const c of changed) out.push("    " + c);
}
console.log(out.join("\n"));
