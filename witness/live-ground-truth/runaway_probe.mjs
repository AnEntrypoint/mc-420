import fs from "node:fs";
const CORP = "/config/workspace/mc-420/test-audio-corpus/instruments/";
const SR = 48000, GAIN = 0.00707945784384138, W = 1024, MIN = 11, MAX = 900, TH = 0.85;
const readWav = (f) => { const b = fs.readFileSync(f); let off = 12; let d = null; while (off + 8 <= b.length) { const id = b.toString("ascii", off, off + 4), sz = b.readUInt32LE(off + 4); if (id === "data") { d = { s: off + 8, n: sz / 2 }; break; } off += 8 + sz + (sz & 1); } const x = new Float64Array(d.n); for (let i = 0; i < d.n; i++) x[i] = GAIN * b.readInt16LE(d.s + 2 * i) / 32768; return x; };
const corrs = (x, s0) => { let den = 0; for (let i = 0; i < W; i++) den += x[s0 + i] * x[s0 + i]; const r = new Float64Array(MAX + 2); for (let L = MIN - 1; L <= MAX + 1; L++) { let num = 0; for (let i = 0; i < W; i++) num += x[s0 + i] * x[s0 + i - L]; r[L] = den > 0 ? num / den : 0; } return r; };
const files = ["cello_low_sulC_A2", "vocal_male_baritone_scale", "flute_high_C7", "piano_high_C7", "soprano_sax_high_C6", "trumpet_low_A3", "piano_mid_C4"];
const out = ["file\tframes\thigh_pick_frac(lag<30)\thigh_r_median\tlow_pick_r_median"];
for (const name of files) {
  const x = readWav(CORP + name + ".wav");
  let n = 0, hi = 0; const hr = [], lr = [];
  for (let s0 = Math.round(0.3 * SR); s0 + W + MAX + 2 < x.length; s0 += Math.round(0.02 * SR)) {
    const r = corrs(x, s0);
    n++;
    let pick = -1;
    for (let L = MIN; L <= MAX; L++) if (r[L] >= TH && r[L] >= r[L - 1] && r[L] >= r[L + 1]) { pick = L; break; }
    if (pick < 0) continue;
    if (pick < 30) { hi++; hr.push(r[pick]); } else lr.push(r[pick]);
  }
  const med = (v) => { if (!v.length) return "NA"; const w = v.slice().sort((a, b) => a - b); return w[w.length >> 1].toFixed(4); };
  out.push([name, n, (hi / n).toFixed(3), med(hr), med(lr)].join("\t"));
}
console.log(out.join("\n"));
