import fs from "node:fs";
const CORP = "/config/workspace/mc-420/test-audio-corpus/instruments/";
const SR = 48000, GAIN = 0.00707945784384138, W = 1024, MIN = 16, MAX = 900, TH = 0.15;
const readWav = (f) => { const b = fs.readFileSync(f); let off = 12; let d = null; while (off + 8 <= b.length) { const id = b.toString("ascii", off, off + 4), sz = b.readUInt32LE(off + 4); if (id === "data") { d = { s: off + 8, n: sz / 2 }; break; } off += 8 + sz + (sz & 1); } const x = new Float64Array(d.n); for (let i = 0; i < d.n; i++) x[i] = GAIN * b.readInt16LE(d.s + 2 * i) / 32768; return x; };
const diff = (x, s0, tau) => { let acc = 0; for (let i = 0; i < W; i++) { const a = x[s0 + i], b = x[s0 + i + tau]; acc += (a - b) * (a - b); } return acc; };
const estimate = (x, s0, mode) => {
  const dd = new Float64Array(MAX + 1);
  for (let tau = 1; tau <= MAX; tau++) dd[tau] = diff(x, s0, tau);
  const d = new Float64Array(MAX + 1); d[0] = 1; let cum = 0;
  for (let tau = 1; tau <= MAX; tau++) { cum += dd[tau]; d[tau] = cum > 0 ? dd[tau] * tau / cum : 1; }
  if (mode === "maxcorr") {
    let best = MIN; for (let t = MIN; t < MAX; t++) if (d[t] < d[best]) best = t;
    return SR / best;
  }
  let tau = -1;
  for (let t = MIN; t < MAX - 1; t++) { if (d[t] < TH) { while (t + 1 < MAX && d[t + 1] < d[t]) t++; tau = t; break; } }
  if (tau < 0) return NaN;
  const a = d[tau - 1], b = d[tau], c = d[tau + 1];
  const den = 2 * (2 * b - a - c);
  const shift = den !== 0 ? (c - a) / den : 0;
  return SR / (tau + shift);
};
const cases = [["flute_high_C7", 2093.0], ["piano_high_C7", 2093.0], ["trumpet_low_A3", 220.0], ["soprano_sax_high_C6", 1046.5], ["piano_mid_C4", 261.63]];
const out = ["file\ttrue_hz\tmode\tmedian_hz\tcents\tfrac_within_25c\tn"];
for (const [name, truth] of cases) {
  const x = readWav(CORP + name + ".wav");
  for (const mode of ["maxcorr", "firstmin"]) {
    const vals = [];
    for (let s0 = Math.round(0.3 * SR); s0 + W + MAX + 2 < x.length; s0 += Math.round(0.02 * SR)) {
      const f = estimate(x, s0, mode);
      if (!isNaN(f)) vals.push(f);
    }
    vals.sort((p, q) => p - q);
    const med = vals.length ? vals[vals.length >> 1] : NaN;
    const within = vals.filter(f => Math.abs(1200 * Math.log2(f / truth)) <= 25).length / Math.max(1, vals.length);
    out.push([name, truth.toFixed(1), mode, med.toFixed(2), (1200 * Math.log2(med / truth)).toFixed(1), within.toFixed(3), vals.length].join("\t"));
  }
}
console.log(out.join("\n"));
