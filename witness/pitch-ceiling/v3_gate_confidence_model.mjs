import fs from "node:fs";
const CORP = "/config/workspace/mc-420/test-audio-corpus/instruments/";
const SR = 48000, GAIN = 0.00707945784384138, THR = 0.85, BLOCK = 64;
const HOLD = Math.round(0.035 * SR);
const readWav = (f) => { const b = fs.readFileSync(f); let off = 12; let d = null; while (off + 8 <= b.length) { const id = b.toString("ascii", off, off + 4), sz = b.readUInt32LE(off + 4); if (id === "data") { d = { s: off + 8, n: sz / 2 }; break; } off += 8 + sz + (sz & 1); } const x = new Float64Array(d.n); for (let i = 0; i < d.n; i++) x[i] = GAIN * b.readInt16LE(d.s + 2 * i) / 32768; return x; };
const oldGrid = [1581.12,1500.0,1423.02,1350.0,1272.79,1200.0,1095.45,1000.0,938.08,880.0,784.86,700.0,641.01,587.0,508.21,440.0,391.87,349.0,320.32,294.0,277.33,261.6,239.9,220.0,201.74,185.0,169.66,155.6,142.66,130.8,119.95,110.0,100.87,92.5,84.83,77.8,71.33,65.4,62.64,60.0];
const pole = (tau) => Math.exp(-1 / (tau * SR));
const pHi = pole(0.02), pLo = pole(0.01), pEnv = pole(0.003);
const run = (name) => {
  const x0 = readWav(CORP + name + ".wav");
  const hpA = Math.exp(-2 * Math.PI * 20 / SR);
  const x = new Float64Array(x0.length); let lp = 0;
  for (let n = 0; n < x0.length; n++) { lp = (1 - hpA) * x0[n] + hpA * lp; x[n] = x0[n] - lp; }
  const cands = oldGrid.map(f => ({ f, lag: Math.trunc(SR / f), tau: f >= 700 ? 0.02 : 0.01 }));
  const nC = cands.length;
  const num = new Float64Array(nC);
  let den01 = 0, den02 = 0, env = 0, hc = 0, hl = 0;
  let n = 0, cur = 0, prop = 0, changed = 0, blocks = 0;
  for (let i = 1; i < x.length; i++) {
    const xn = x[i];
    den01 = (1 - pLo) * xn * xn + pLo * den01;
    den02 = (1 - pHi) * xn * xn + pHi * den02;
    env = (1 - pEnv) * xn * xn + pEnv * env;
    for (let k = 0; k < nC; k++) { const c = cands[k]; const d = i - c.lag >= 0 ? x[i - c.lag] : 0; const p = c.tau === 0.02 ? pHi : pLo; num[k] = (1 - p) * xn * d + p * num[k]; }
    hc = env > 1e-6 ? Math.min(hc + 1, HOLD) : 0;
    hl = env > 1e-8 ? Math.min(hl + 1, HOLD) : 0;
    if (i % BLOCK === BLOCK - 1 && i > 0.3 * SR) {
      blocks++;
      const v = new Float64Array(nC);
      for (let k = 0; k < nC; k++) v[k] = num[k] / Math.max(1e-9, cands[k].tau === 0.02 ? den02 : den01);
      let confident = false;
      for (let k = 0; k + 2 < nC; k++) if (v[k + 1] >= THR && v[k + 1] >= v[k] && v[k + 1] >= v[k + 2]) { confident = true; break; }
      const c0 = hc >= HOLD ? 1 : 0;
      const lowReady = hl >= HOLD ? 1 : 0;
      const p1 = (c0 === 1 || (lowReady === 1 && confident)) ? 1 : 0;
      n++; cur += c0; prop += p1; if (c0 !== p1) changed++;
    }
  }
  return { cur: cur / n, prop: prop / n, changed: changed / n };
};
const files = ["piano_high_C7","crotale_high_C7","glockenspiel_high_C7","xylophone_run_C7B7","cello_low_sulC_A2","vocal_male_baritone_scale","marimba_mid_C5B5","marimba_roll_AM_C5B5","vocal_female_vibrato"];
const out = ["file\tcurrent_ready\tv3_ready\tchanged_frac"];
for (const f of files) { const r = run(f); out.push([f, r.cur.toFixed(3), r.prop.toFixed(3), r.changed.toFixed(3)].join("\t")); }
console.log(out.join("\n"));
