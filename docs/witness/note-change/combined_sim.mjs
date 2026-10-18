import fs from "node:fs";
const D = new URL(".", import.meta.url).pathname;
const SR = 48000, GAIN = 0.00707945784384138, BLOCK = 64;
const readWav = (f) => { const b = fs.readFileSync(f); let off = 12; let d = null; while (off + 8 <= b.length) { const id = b.toString("ascii", off, off + 4), sz = b.readUInt32LE(off + 4); if (id === "data") { d = { s: off + 8, n: sz / 2 }; break; } off += 8 + sz + (sz & 1); } const x = new Float64Array(d.n); for (let i = 0; i < d.n; i++) x[i] = GAIN * b.readInt16LE(d.s + 2 * i) / 32768; return x; };
const pole = Math.exp(-1 / (0.01 * SR));
const parab = (cLo, cMid, cHi) => { const denom = cLo - 2 * cMid + cHi; if (Math.abs(denom) < 1e-6) return 0; return Math.max(-1, Math.min(1, 0.5 * (cLo - cHi) / denom)); };
const K = 16;
const smoothWide = (x, a, b, L0) => {
  const lo = new Float64Array(b - a), mid = new Float64Array(b - a), hi = new Float64Array(b - a), en = new Float64Array(b - a);
  let yl = 0, ym = 0, yh = 0, ye = 0;
  for (let n = a; n < b; n++) { const xn = x[n]; yl = xn * x[n - (L0 - K)] * (1 - pole) + pole * yl; ym = xn * x[n - L0] * (1 - pole) + pole * ym; yh = xn * x[n - (L0 + K)] * (1 - pole) + pole * yh; ye = xn * xn * (1 - pole) + pole * ye; lo[n - a] = yl; mid[n - a] = ym; hi[n - a] = yh; en[n - a] = ye; }
  return { lo, mid, hi, en };
};
const runCombined = (x, a, b, gf) => {
  const L0 = Math.trunc(SR / gf);
  const w = smoothWide(x, a, b, L0);
  let Lw = null;
  const est = [];
  let L = null;
  let yLo = 0, yMid = 0, yHi = 0, yE = 0;
  for (let n = a; n < b; n++) {
    const k = n - a;
    if (k % BLOCK === BLOCK - 1) {
      if (L === null) {
        const e = Math.max(1e-9, w.en[k]);
        const dlt = parab(w.lo[k] / e, w.mid[k] / e, w.hi[k] / e);
        L = Math.round(L0 + dlt * K);
      } else {
        const e = Math.max(1e-9, yE);
        const dlt = parab(yLo / e, yMid / e, yHi / e);
        if (dlt >= 0.5) L += 1; else if (dlt <= -0.5) L -= 1;
      }
    }
    if (L !== null) {
      const xn = x[n];
      yLo = xn * x[n - (L - 1)] * (1 - pole) + pole * yLo;
      yMid = xn * x[n - L] * (1 - pole) + pole * yMid;
      yHi = xn * x[n - (L + 1)] * (1 - pole) + pole * yHi;
      yE = xn * xn * (1 - pole) + pole * yE;
    }
    if (k % BLOCK === BLOCK - 1 && L !== null && k > 0.3 * SR) est.push(SR / L);
  }
  est.sort((p, q) => p - q);
  return est[est.length >> 1];
};
const out = [];
for (const c of ["note_change_harm", "note_change_inharm_quoted1x4x10", "note_change_inharm_freeFreeBeam"]) {
  const truth = JSON.parse(fs.readFileSync(D + c + ".truth.json", "utf8"));
  const x = readWav(D + c + ".wav");
  for (const s of truth.segments) {
    const a = Math.round(s.t0 * SR), b = Math.round(s.t1 * SR);
    for (const gf of [s.f, 508.21, 587.0, 440.0, 641.01]) {
      const m = runCombined(x, a, b, gf);
      out.push([c, s.name, "start " + gf.toFixed(0), "combined " + (1200 * Math.log2(m / s.f)).toFixed(1)].join("\t"));
    }
  }
}
console.log(out.join("\n"));
