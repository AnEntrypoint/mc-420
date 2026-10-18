import fs from "node:fs";
const D = "/config/workspace/mc-420/docs/witness/note-change/";
const SR = 48000, GAIN = 0.00707945784384138;
const readWav = (f) => { const b = fs.readFileSync(f); let off = 12; let d = null; while (off + 8 <= b.length) { const id = b.toString("ascii", off, off + 4), sz = b.readUInt32LE(off + 4); if (id === "data") { d = { s: off + 8, n: sz / 2 }; break; } off += 8 + sz + (sz & 1); } const x = new Float64Array(d.n); for (let i = 0; i < d.n; i++) x[i] = GAIN * b.readInt16LE(d.s + 2 * i) / 32768; return x; };
const pole = Math.exp(-1 / (0.01 * SR));
const runLag = (x, a, b, L) => { const out = new Float64Array(b - a); let y = 0; for (let n = a; n < b; n++) { const p = x[n] * x[n - L]; y = p * (1 - pole) + pole * y; out[n - a] = y; } return out; };
const energy = (x, a, b) => { const out = new Float64Array(b - a); let y = 0; for (let n = a; n < b; n++) { const p = x[n] * x[n]; y = p * (1 - pole) + pole * y; out[n - a] = y; } return out; };
const parab = (cLo, cMid, cHi) => { const denom = cLo - 2 * cMid + cHi; if (Math.abs(denom) < 1e-6) return 0; return Math.max(-1, Math.min(1, 0.5 * (cLo - cHi) / denom)); };
const passes = (x, a, b, en, L0, K, frames) => { const lo = runLag(x, a, b, L0 - K), mid = runLag(x, a, b, L0), hi = runLag(x, a, b, L0 + K); return frames.map(n => L0 + parab(lo[n] / Math.max(1e-9, en[n]), mid[n] / Math.max(1e-9, en[n]), hi[n] / Math.max(1e-9, en[n])) * K); };
const grid = [508.21, 587.0, 440.0, 641.01];
const out = [];
for (const c of ["note_change_harm", "note_change_inharm_quoted1x4x10", "note_change_inharm_freeFreeBeam"]) {
  const truth = JSON.parse(fs.readFileSync(D + c + ".truth.json", "utf8"));
  const x = readWav(D + c + ".wav");
  for (const s of truth.segments.slice(0, 2)) {
    const a = Math.round(s.t0 * SR), b = Math.round(s.t1 * SR);
    const en = energy(x, a, b);
    const frames = []; for (let n = Math.round(0.3 * SR); n < b - a; n += Math.round(0.05 * SR)) frames.push(n);
    for (const gf of grid) {
      const L0 = Math.trunc(SR / gf);
      const p1 = passes(x, a, b, en, L0, 16, frames);
      const p2 = frames.map((n, i) => { const L = Math.round(p1[i]); const lo = runLag(x, a, b, L - 1), mid = runLag(x, a, b, L), hi = runLag(x, a, b, L + 1); return L + parab(lo[n] / Math.max(1e-9, en[n]), mid[n] / Math.max(1e-9, en[n]), hi[n] / Math.max(1e-9, en[n])); });
      const med = (v) => { const w = v.slice().sort((p, q) => p - q); return w[w.length >> 1]; };
      const f1 = SR / med(p1), f2 = SR / med(p2);
      out.push([c, s.name, "start " + gf.toFixed(0), "one-pass " + (1200 * Math.log2(f1 / s.f)).toFixed(1), "two-pass " + (1200 * Math.log2(f2 / s.f)).toFixed(1)].join("\t"));
    }
  }
}
console.log(out.join("\n"));
