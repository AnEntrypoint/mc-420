import fs from "node:fs";
const CORP = "/config/workspace/mc-420/test-audio-corpus/instruments/";
const SR = 48000, GAIN = 0.00707945784384138, THR = 0.85, BLOCK = 64;
const readWav = (f) => { const b = fs.readFileSync(f); let off = 12; let d = null; while (off + 8 <= b.length) { const id = b.toString("ascii", off, off + 4), sz = b.readUInt32LE(off + 4); if (id === "data") { d = { s: off + 8, n: sz / 2 }; break; } off += 8 + sz + (sz & 1); } const x = new Float64Array(d.n); for (let i = 0; i < d.n; i++) x[i] = GAIN * b.readInt16LE(d.s + 2 * i) / 32768; return x; };
const topOld = 1581.12, r = 1.0545;
const above = []; for (let k = 1; k <= 19; k++) above.push(+(topOld * Math.pow(r, k)).toFixed(2));
const oldGrid = [1581.12,1500.0,1423.02,1350.0,1272.79,1200.0,1095.45,1000.0,938.08,880.0,784.86,700.0,641.01,587.0,508.21,440.0,391.87,349.0,320.32,294.0,277.33,261.6,239.9,220.0,201.74,185.0,169.66,155.6,142.66,130.8,119.95,110.0,100.87,92.5,84.83,77.8,71.33,65.4,62.64,60.0];
const G = [above[18], ...above.slice(0, 18).reverse(), ...oldGrid];
const cands = G.map(f => ({ f, lag: Math.trunc(SR / f), high: f >= topOld, tau: f >= 700 ? 0.02 : 0.01 }));
const pole = (tau) => Math.exp(-1 / (tau * SR));
const pHi = pole(0.02), pLo = pole(0.01);
const run = (name) => {
  const x0 = readWav(CORP + name + ".wav");
  const hpA = Math.exp(-2 * Math.PI * 20 / SR);
  const x = new Float64Array(x0.length); let lp = 0;
  for (let n = 0; n < x0.length; n++) { lp = (1 - hpA) * x0[n] + hpA * lp; x[n] = x0[n] - lp; }
  const nC = cands.length;
  const num = new Float64Array(nC), numPrev = new Float64Array(nC);
  let den02 = 0, den01 = 0;
  const v = new Float64Array(nC);
  const picks = [];
  const pw = (c) => (c.tau === 0.02 ? pHi : pLo);
  let blocks = 0, highPick = 0, anyHighPass = 0, top = 0;
  for (let n = 1; n < x.length; n++) {
    const xn = x[n];
    den02 = (1 - pHi) * xn * xn + pHi * den02;
    den01 = (1 - pLo) * xn * xn + pLo * den01;
    for (let k = 0; k < nC; k++) {
      const c = cands[k];
      const L = c.lag;
      const d = n - L >= 0 ? x[n - L] : 0;
      const p = c.tau === 0.02 ? pHi : pLo;
      num[k] = (1 - p) * xn * d + p * num[k];
    }
    if (n % BLOCK === BLOCK - 1 && n > 0.3 * SR) {
      blocks++;
      for (let k = 0; k < nC; k++) {
        const den = Math.max(1e-9, cands[k].tau === 0.02 ? den02 : den01);
        v[k] = num[k] / den;
      }
      let pick = 60.0; let found = false;
      for (let i = 0; i + 2 < nC; i++) {
        const a = v[i], b = v[i + 1], c2 = v[i + 2];
        if (v[i + 1] >= THR && v[i + 1] >= a && v[i + 1] >= c2) { pick = cands[i + 1].f; found = true; break; }
      }
      if (found && pick >= topOld) highPick++;
      if (v[0] >= THR) anyHighPass++;
      if (blocks === 1) top = v[0];
      picks.push(pick);
    }
  }
  const sorted = picks.slice().sort((p, q) => p - q);
  return { name, blocks, highPickFrac: (highPick / blocks).toFixed(3), topCandPassFrac: (anyHighPass / blocks).toFixed(3), medianPick: sorted[sorted.length >> 1] };
};
const out = ["file\tblocks\thigh_pick_frac\ttop_candidate_passes_frac\tmedian_pick_hz"];
for (const name of ["cello_low_sulC_A2", "vocal_male_baritone_scale", "flute_high_C7", "piano_high_C7", "trumpet_low_A3", "soprano_sax_high_C6"]) {
  const q = run(name);
  out.push([q.name, q.blocks, q.highPickFrac, q.topCandPassFrac, q.medianPick].join("\t"));
}
console.log(out.join("\n"));
