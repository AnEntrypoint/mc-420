import fs from "node:fs";
const CORP = "/config/workspace/mc-420/test-audio-corpus/instruments/";
const SR = 48000, GAIN = 0.00707945784384138;
const HOLD = Math.round(0.035 * SR);
const pole = Math.exp(-1 / (0.003 * SR));
const readWav = (f) => { const b = fs.readFileSync(f); let off = 12; let d = null; while (off + 8 <= b.length) { const id = b.toString("ascii", off, off + 4), sz = b.readUInt32LE(off + 4); if (id === "data") { d = { s: off + 8, n: sz / 2 }; break; } off += 8 + sz + (sz & 1); } const x = new Float64Array(d.n); for (let i = 0; i < d.n; i++) x[i] = GAIN * b.readInt16LE(d.s + 2 * i) / 32768; return x; };
const gates = (x, lo) => {
  let env = 0, cur = 0, prop = 0, hc = 0, hp = 0;
  let curOn = 0, propOn = 0, changed = 0, n = 0;
  for (let i = 0; i < x.length; i++) {
    env = x[i] * x[i] * (1 - pole) + pole * env;
    const aboveHi = env > 1e-6, aboveLo = env > lo;
    hc = aboveHi ? Math.min(hc + 1, HOLD) : 0;
    hp = (aboveHi || aboveLo) ? Math.min(hp + 1, HOLD) : 0;
    const c = hc >= HOLD ? 1 : 0, p = hp >= HOLD ? 1 : 0;
    if (i > 0.3 * SR) { n++; curOn += c; propOn += p; if (c !== p) changed++; }
  }
  return { curFrac: curOn / n, propFrac: propOn / n, changedFrac: changed / n };
};
const files = ["piano_high_C7","crotale_high_C7","glockenspiel_high_C7","xylophone_run_C7B7","flute_high_C7","cello_low_sulC_A2","vocal_male_baritone_scale","marimba_mid_C5B5","marimba_roll_AM_C5B5","vocal_female_vibrato","clarinet_high_C6B6","soprano_sax_high_C6"];
const out = ["file\tcurrent_ready\tproposed_ready_lo1e-8\tchanged_frac"];
for (const f of files) {
  const x = readWav(CORP + f + ".wav");
  const r = gates(x, 1e-8);
  out.push([f, r.curFrac.toFixed(3), r.propFrac.toFixed(3), r.changedFrac.toFixed(3)].join("\t"));
}
console.log(out.join("\n"));
