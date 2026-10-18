import fs from "node:fs";
const S = "/tmp/claude-1000/-config-workspace-mc-420/552e4f18-f9c8-4f76-973c-a987b5ca102c/scratchpad/lowhz/lk";
const tl = fs.readFileSync(S + "/table.tsv", "utf8").trim().split("\n");
const vars = tl[0].split("\t").slice(2);
const trk = {};
for (const l of tl.slice(1)) { const r = l.split("\t"); vars.forEach((v, i) => { (trk[v] ??= {})[r[0]] = +r[2 + i]; }); }
const lock = {};
for (const l of fs.readFileSync(S + "/lock_results.tsv", "utf8").trim().split("\n").slice(1)) {
  const r = l.split("\t"); (lock[r[0]] ??= {})[r[1]] = { trk: +r[3], hz: +r[4], cents: +r[5], ncc: +r[6], note: +r[2] };
}
const B = lock.base, C = lock.cand;
const cd = (a, b) => 1200 * Math.log2(a / b);
const pct = (a, b) => (b === 0 ? (a === 0 ? 0 : Infinity) : Math.abs(a / b - 1) * 100);
const out = [];
const f = (x, n = 2) => (Number.isFinite(x) ? x.toFixed(n) : String(x));
const G = {};
const d440 = pct(C.sine_440.hz, B.sine_440.hz), d1000 = pct(C.sine_1000.hz, B.sine_1000.hz);
const t440 = pct(trk.cand.sine_440, trk.base.sine_440), t1000 = pct(trk.cand.sine_1000, trk.base.sine_1000);
G.g1 = d440 <= 0.5 && d1000 <= 0.5 && t440 <= 0.5 && t1000 <= 0.5;
out.push(`G1 sine440/1000 lock d=${f(d440, 3)}%/${f(d1000, 3)}% trk d=${f(t440, 3)}%/${f(t1000, 3)}% => ${G.g1}`);
for (const n of ["sine_110", "sine_220"]) out.push(`REPORT ${n} trk ${f(trk.base[n], 3)}>${f(trk.cand[n], 3)} lock ${f(B[n].hz, 3)}(${f(B[n].cents, 1)}c)>${f(C[n].hz, 3)}(${f(C[n].cents, 1)}c)`);
const s = "sine_55.69", tgt = 440 * Math.pow(2, (33 - 69) / 12);
const e55 = pct(trk.cand[s], 55.69);
const l55 = pct(C[s].hz, tgt);
G.g2 = e55 <= 2 && l55 <= 2;
out.push(`G2 sine55.69 trk base ${f(trk.base[s], 3)} cand ${f(trk.cand[s], 3)} (err ${f(e55, 3)}%); lock target ${f(tgt, 3)} base ${f(B[s].hz, 3)}(${f(B[s].cents, 1)}c) cand ${f(C[s].hz, 3)}(${f(C[s].cents, 1)}c ncc ${C[s].ncc}) err ${f(l55, 3)}% => ${G.g2}`);
const dC = cd(C.crotale_high_C7.hz, B.crotale_high_C7.hz), dM = cd(C.marimba_mid_C5B5.hz, B.marimba_mid_C5B5.hz);
G.g3 = Math.abs(dC) <= 5 && Math.abs(dM) <= 5;
out.push(`G3 crotale ${f(dC)}c (${f(B.crotale_high_C7.hz, 2)}>${f(C.crotale_high_C7.hz, 2)}) marimba_mid ${f(dM)}c (${f(B.marimba_mid_C5B5.hz, 2)}>${f(C.marimba_mid_C5B5.hz, 2)}) => ${G.g3}`);
const corpus = Object.keys(B).filter(n => !n.startsWith("sine_")).sort();
const moved = [], worse = [];
out.push("TABLE name | note | base trk/lock(cents,ncc) | cand trk/lock(cents,ncc) | d_lock_cents | d|cents|");
for (const n of corpus) {
  const dt = pct(trk.cand[n], trk.base[n]), dl = pct(C[n].hz, B[n].hz);
  const dcent = (B[n].hz > 0 && C[n].hz > 0) ? cd(C[n].hz, B[n].hz) : NaN;
  const dabs = Math.abs(C[n].cents) - Math.abs(B[n].cents);
  const mv = dt > 1 || dl > 1;
  const row = `${n} | ${B[n].note} | ${f(trk.base[n])}/${f(B[n].hz)}(${f(B[n].cents, 1)}c,${f(B[n].ncc, 4)}) | ${f(trk.cand[n])}/${f(C[n].hz)}(${f(C[n].cents, 1)}c,${f(C[n].ncc, 4)}) | ${f(dcent)} | ${f(dabs, 1)}${mv ? " MOVED" : ""}`;
  out.push(row);
  if (mv) moved.push(n);
  if (mv && dabs > 5) worse.push(n);
}
G.g4 = worse.length === 0;
out.push(`G4 moved(${moved.length}): ${moved.join(",") || "none"}; worse>5c: ${JSON.stringify(worse)} => ${G.g4}`);
for (const n of ["piano_low_A1", "balloon_pop_transient"]) out.push(`SEPARATE ${n} trk ${f(trk.base[n], 3)}>${f(trk.cand[n], 3)} lock ${f(B[n].hz, 3)}(${f(B[n].cents, 1)}c,ncc ${f(B[n].ncc, 4)})>${f(C[n].hz, 3)}(${f(C[n].cents, 1)}c,ncc ${f(C[n].ncc, 4)})`);
const pass = G.g1 && G.g2 && G.g3 && G.g4;
out.push(`DECISION ${pass ? "PASS" : "FAIL"} ${JSON.stringify(G)}`);
fs.writeFileSync(S + "/gate.txt", out.join("\n") + "\n");
console.log(out.join("\n"));
