import fs from "node:fs";
const D = "/config/workspace/mc-420/docs/witness/note-change/";
const SR = 48000, GAIN = 0.00707945784384138;
const readWav = (f) => { const b = fs.readFileSync(f); let off = 12; let d = null; while (off + 8 <= b.length) { const id = b.toString("ascii", off, off + 4), sz = b.readUInt32LE(off + 4); if (id === "data") { d = { s: off + 8, n: sz / 2 }; break; } off += 8 + sz + (sz & 1); } const x = new Float64Array(d.n); for (let i = 0; i < d.n; i++) x[i] = GAIN * b.readInt16LE(d.s + 2 * i) / 32768; return x; };
const pole = Math.exp(-1 / (0.01 * SR));
const run = (x, a, b, L) => { const out = new Float64Array(b - a); let y = 0; for (let n = a; n < b; n++) { const p = x[n] * x[n - L]; y = p * (1 - pole) + pole * y; out[n - a] = y; } return out; };
const energy = (x, a, b) => { const out = new Float64Array(b - a); let y = 0; for (let n = a; n < b; n++) { const p = x[n] * x[n]; y = p * (1 - pole) + pole * y; out[n - a] = y; } return out; };
const refine = (cLo, cMid, cHi, K, L0) => { const denom = cLo - 2 * cMid + cHi; const safe = Math.abs(denom) < 1e-6 ? 1e-6 : denom; let delta = 0.5 * (cLo - cHi) / safe; delta = Math.max(-1, Math.min(1, delta)); const d2 = Math.abs(denom) < 1e-6 ? 0 : delta; return SR / Math.max(1, L0 + d2 * K); };
const grid = [1581.12,1500,1423.02,1350,1272.79,1200,1095.45,1000,938.08,880,784.86,700,641.01,587.0,508.21,440,391.87,349,320.32,294,277.33,261.6,239.9,220,201.74,185,169.66,155.6,142.66,130.8,119.95,110,100.87,92.5,84.83,77.8,71.33,65.4,62.64,60];
const out = [];
for (const c of ["note_change_harm", "note_change_inharm_quoted1x4x10", "note_change_inharm_freeFreeBeam"]) {
  const truth = JSON.parse(fs.readFileSync(D + c + ".truth.json", "utf8"));
  const x = readWav(D + c + ".wav");
  const s = truth.segments[0];
  const a = Math.round(s.t0 * SR), b = Math.round(s.t1 * SR);
  const en = energy(x, a, b);
  for (const gf of [s.f, 508.21, 587.0, 440.0, 641.01]) {
    const L0 = Math.trunc(SR / gf);
    const row = [c, s.name, "start " + gf.toFixed(1) + " (" + (1200 * Math.log2(gf / s.f)).toFixed(0) + "c)"];
    for (const K of [1, 4, 8, 16]) {
      const lo = run(x, a, b, L0 - K), mid = run(x, a, b, L0), hi = run(x, a, b, L0 + K);
      const v = [];
      for (let n = Math.round(0.3 * SR); n < b - a; n += Math.round(0.05 * SR)) v.push(refine(lo[n] / Math.max(1e-9, en[n]), mid[n] / Math.max(1e-9, en[n]), hi[n] / Math.max(1e-9, en[n]), K, L0));
      v.sort((p, q) => p - q);
      row.push("K" + K + "=" + (1200 * Math.log2(v[v.length >> 1] / s.f)).toFixed(1));
    }
    out.push(row.join("\t"));
  }
}
console.log(out.join("\n"));
