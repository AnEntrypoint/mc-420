import fs from "node:fs";
const D = "/config/workspace/mc-420/docs/witness/note-change/";
const SR = 48000, GAIN = 0.00707945784384138;
const readWav = (f) => { const b = fs.readFileSync(f); let off = 12; let d = null; while (off + 8 <= b.length) { const id = b.toString("ascii", off, off + 4), sz = b.readUInt32LE(off + 4); if (id === "data") { d = { s: off + 8, n: sz / 2 }; break; } off += 8 + sz + (sz & 1); } const x = new Float64Array(d.n); for (let i = 0; i < d.n; i++) x[i] = GAIN * b.readInt16LE(d.s + 2 * i) / 32768; return x; };
const pole = Math.exp(-1 / (0.01 * SR));
const run = (x, a, b, L) => { const out = new Float64Array(b - a); let y = 0; for (let n = a; n < b; n++) { const p = x[n] * x[n - L]; y = p * (1 - pole) + pole * y; out[n - a] = y; } return out; };
const energy = (x, a, b) => { const out = new Float64Array(b - a); let y = 0; for (let n = a; n < b; n++) { const p = x[n] * x[n]; y = p * (1 - pole) + pole * y; out[n - a] = y; } return out; };
const refine = (cLo, cMid, cHi, K, L0) => { const denom = cLo - 2 * cMid + cHi; const safe = Math.abs(denom) < 1e-6 ? 1e-6 : denom; let delta = 0.5 * (cLo - cHi) / safe; delta = Math.max(-1, Math.min(1, delta)); const d2 = Math.abs(denom) < 1e-6 ? 0 : delta; return SR / Math.max(1, L0 + d2 * K); };
const res = [];
for (const c of ["note_change_harm", "note_change_inharm_freeFreeBeam", "note_change_inharm_quoted1x4x10"]) {
  const truth = JSON.parse(fs.readFileSync(D + c + ".truth.json", "utf8"));
  const x = readWav(D + c + ".wav");
  for (const s of truth.segments) {
    const a = Math.round((s.t0 + 0.0) * SR), b = Math.round(s.t1 * SR);
    const L0 = Math.round(SR / s.f);
    const en = energy(x, a, b);
    const row = [c, s.name];
    for (const K of [1, 2, 4, 8, 16]) {
      const lo = run(x, a, b, L0 - K), mid = run(x, a, b, L0), hi = run(x, a, b, L0 + K);
      const fs2 = [];
      for (let n = Math.round(0.3 * SR); n < b - a; n += Math.round(0.05 * SR)) {
        const cl = lo[n] / Math.max(1e-9, en[n]), cm = mid[n] / Math.max(1e-9, en[n]), ch = hi[n] / Math.max(1e-9, en[n]);
        fs2.push(refine(cl, cm, ch, K, L0));
      }
      fs2.sort((p, q) => p - q);
      const med = fs2[fs2.length >> 1];
      row.push("K" + K + "=" + (1200 * Math.log2(med / s.f)).toFixed(1));
    }
    res.push(row.join("\t"));
  }
}
console.log(res.join("\n"));
