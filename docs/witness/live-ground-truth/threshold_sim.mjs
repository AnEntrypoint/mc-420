import fs from "node:fs";
const CORP = "/config/workspace/mc-420/test-audio-corpus/instruments/";
const SR = 48000, GAIN = 0.00707945784384138, W = 1024, MIN = 16, MAX = 900;
const TS = [0.5, 0.6, 0.7, 0.8, 0.85];
const readWav = (f) => { const b = fs.readFileSync(f); let off = 12; let d = null; while (off + 8 <= b.length) { const id = b.toString("ascii", off, off + 4), sz = b.readUInt32LE(off + 4); if (id === "data") { d = { s: off + 8, n: sz / 2 }; break; } off += 8 + sz + (sz & 1); } const x = new Float64Array(d.n); for (let i = 0; i < d.n; i++) x[i] = GAIN * b.readInt16LE(d.s + 2 * i) / 32768; return x; };
const corrs = (x, s0) => { let den = 0; for (let i = 0; i < W; i++) den += x[s0 + i] * x[s0 + i]; const r = new Float64Array(MAX + 2); for (let L = MIN - 1; L <= MAX + 1; L++) { let num = 0; for (let i = 0; i < W; i++) num += x[s0 + i] * x[s0 + i - L]; r[L] = den > 0 ? num / den : 0; } return r; };
const pick = (r, T) => { for (let L = MIN; L <= MAX; L++) { if (r[L] >= T && r[L] >= r[L - 1] && r[L] >= r[L + 1]) { const a = r[L - 1], b = r[L], c = r[L + 1]; const den = a - 2 * b + c; const sh = Math.abs(den) > 1e-9 ? 0.5 * (a - c) / den : 0; return SR / (L + Math.max(-0.5, Math.min(0.5, sh))); } } return NaN; };
const cases = [["flute_high_C7", 2093.0], ["piano_high_C7", 2093.0], ["trumpet_low_A3", 220.0], ["soprano_sax_high_C6", 1046.5], ["piano_mid_C4", 261.63]];
const out = ["file\ttrue_hz\tthreshold\tmedian_hz\tcents\tfrac_within_25c\tfrac_unpicked\tn"];
for (const [name, truth] of cases) {
  const x = readWav(CORP + name + ".wav");
  const frames = [];
  for (let s0 = Math.round(0.3 * SR); s0 + W + MAX + 2 < x.length; s0 += Math.round(0.02 * SR)) frames.push(corrs(x, s0));
  for (const T of TS) {
    const vals = frames.map(r => pick(r, T));
    const ok = vals.filter(f => !isNaN(f));
    ok.sort((p, q) => p - q);
    const med = ok.length ? ok[ok.length >> 1] : NaN;
    const within = ok.filter(f => Math.abs(1200 * Math.log2(f / truth)) <= 25).length / Math.max(1, vals.length);
    out.push([name, truth.toFixed(1), T.toFixed(2), med.toFixed(2), (1200 * Math.log2(med / truth)).toFixed(1), within.toFixed(3), (vals.length - ok.length) / vals.length].map(String).join("\t"));
  }
}
console.log(out.join("\n"));
