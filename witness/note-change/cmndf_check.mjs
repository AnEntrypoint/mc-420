import fs from "node:fs";
const D = "/config/workspace/mc-420/docs/witness/note-change/";
const readWav = (f) => { const b = fs.readFileSync(f); let off = 12; let data = null; while (off + 8 <= b.length) { const id = b.toString("ascii", off, off + 4), sz = b.readUInt32LE(off + 4); if (id === "data") { data = { s: off + 8, n: sz / 2 }; break; } off += 8 + sz + (sz & 1); } const x = new Float64Array(data.n); for (let i = 0; i < data.n; i++) x[i] = b.readInt16LE(data.s + 2 * i) / 32768; return x; };
const SR = 48000, MIN = 16, MAX = 900, W = 1024, TH = 0.15;
const cmndf = (x, s0) => {
  const d = new Float64Array(MAX + 1); d[0] = 1;
  let run = 0;
  const diff = (tau) => { let acc = 0; for (let i = 0; i < W; i++) { const a = x[s0 + i], b = x[s0 + i + tau]; acc += (a - b) * (a - b); } return acc; };
  const dd = []; for (let tau = 1; tau <= MAX; tau++) dd[tau] = diff(tau);
  let cum = 0;
  for (let tau = 1; tau <= MAX; tau++) { cum += dd[tau]; d[tau] = cum > 0 ? dd[tau] * tau / cum : 1; }
  let tau = -1;
  for (let t = MIN; t < MAX; t++) { if (d[t] < TH) { while (t + 1 < MAX && d[t + 1] < d[t]) t++; tau = t; break; } }
  if (tau < 0) { let best = MIN; for (let t = MIN; t < MAX; t++) if (d[t] < d[best]) best = t; tau = best; }
  const a = d[tau - 1], b = d[tau], c = d[tau + 1];
  const den = 2 * (2 * b - a - c);
  const shift = den !== 0 ? (c - a) / den : 0;
  return SR / (tau + shift);
};
const out = [];
for (const c of ["note_change_harm", "note_change_inharm_freeFreeBeam", "note_change_inharm_quoted1x4x10"]) {
  const truth = JSON.parse(fs.readFileSync(D + c + ".truth.json", "utf8"));
  const x = readWav(D + c + ".wav");
  for (const s of truth.segments) {
    const frames = [];
    for (let t = s.t0 + 0.3; t + W / SR + 1200 / SR < s.t1; t += 0.05) {
      const s0 = Math.round(t * SR) + 0;
      const f = cmndf(x, s0 + MAX);
      frames.push(f);
    }
    frames.sort((p, q) => p - q);
    const med = frames[frames.length >> 1];
    out.push(c + "\t" + s.name + "\ttrue " + s.f.toFixed(2) + "\tcmndf_median " + med.toFixed(2) + "\tcents " + (1200 * Math.log2(med / s.f)).toFixed(1));
  }
}
console.log(out.join("\n"));
