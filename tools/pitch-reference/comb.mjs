#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const src = flag("--src", "test-audio-corpus/instruments");
const only = flag("--only", "");
const seconds = Number(flag("--seconds", "6"));
const fmin = Number(flag("--fmin", "60"));
const fmax = Number(flag("--fmax", "1500"));
const stepPct = Number(flag("--grid", "0.005"));
const partials = Number(flag("--partials", "8"));
const within = Number(flag("--within", "3"));
const marginDb = Number(flag("--margin", "12"));
const phraseExtra = flag("--phrase", "");

const fftSize = 524288;

const readWav = (file) => {
  const b = fs.readFileSync(file);
  const fmtChunk = b.readUInt32LE(16);
  let off = 12 + 8 + fmtChunk;
  let data = null;
  let channels = 1;
  let rate = 48000;
  while (off + 8 <= b.length) {
    const id = b.toString("ascii", off, off + 4);
    const sz = b.readUInt32LE(off + 4);
    if (id === "fmt ") {
      channels = b.readUInt16LE(off + 10);
      rate = b.readUInt32LE(off + 12);
    }
    if (id === "data") { data = { s: off + 8, n: sz / 2 }; break; }
    off += 8 + sz + (sz & 1);
  }
  if (!data) return null;
  const n = Math.min(data.n, Math.floor(seconds * rate));
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (let c = 0; c < channels; c++) v += b.readInt16LE(data.s + 2 * (i * channels + c)) / 32768;
    x[i] = v / channels;
  }
  return { x, rate, seconds: n / rate };
};

const spectrum = (x, rate) => {
  const n = fftSize;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < x.length; i++) re[i] = x[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (x.length - 1)));
  for (let i = 0, j = 0; i < n; i++) {
    if (i < j) {
      const tr = re[j];
      re[j] = re[i];
      re[i] = tr;
      const ti = im[j];
      im[j] = im[i];
      im[i] = ti;
    }
    let m = n >> 1;
    while (m >= 1 && j & m) { j ^= m; m >>= 1; }
    j |= m;
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k];
        const ai = im[i + k];
        const br = re[i + k + len / 2];
        const bi = im[i + k + len / 2];
        const tr = br * cr - bi * ci;
        const ti = br * ci + bi * cr;
        re[i + k] = ar + tr;
        im[i + k] = ai + ti;
        re[i + k + len / 2] = ar - tr;
        im[i + k + len / 2] = ai - ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
  const pow = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) pow[i] = re[i] * re[i] + im[i] * im[i];
  return { pow, rate, binHz: rate / n };
};

const db = (p) => 10 * Math.log10(Math.max(1e-20, p));

const isPhrase = (f) => /_(run|scale|range|melody|trill)(_|\.)/.test(f)
  || phraseExtra.split(",").filter(Boolean).some((o) => f.includes(o));

const files = fs.readdirSync(src).filter((f) => f.endsWith(".wav")).sort()
  .filter((f) => (only ? only.split(",").some((o) => f.includes(o)) : true));

const rows = [];
for (const f of files) {
  const w = readWav(path.join(src, f));
  if (!w) { rows.push([f, "unreadable"]); continue; }
  if (isPhrase(f)) { rows.push([f, "excluded: phrase"]); continue; }
  const { pow, binHz } = spectrum(w.x, w.rate);
  const at = (hz) => {
    const b = Math.round(hz / binHz);
    return b >= 0 && b < pow.length ? pow[b] : 0;
  };
  const maxBin = Math.min(pow.length - 1, Math.floor(4000 / binHz));
  let peakHz = 0;
  let peakPow = 0;
  for (let b = Math.round(fmin / binHz); b <= maxBin; b++) if (pow[b] > peakPow) { peakPow = pow[b]; peakHz = b * binHz; }
  const band = [];
  for (let b = Math.round(fmin / binHz); b <= maxBin; b++) band.push(pow[b]);
  const sorted = band.slice().sort((a, c) => a - c);
  const floorPow = sorted[Math.floor(sorted.length / 2)];
  const floorGate = floorPow * Math.pow(10, marginDb / 10);

  const penalty = Math.pow(10, -marginDb / 10);
  const cands = [];
  for (let hz = fmin; hz <= fmax; hz *= 1 + stepPct) {
    let sum = 0;
    let miss = 0;
    if (at(hz) < floorGate) continue;
    for (let k = 1; k <= partials; k++) {
      const hzK = hz * k;
      if (hzK > 22000) break;
      const p = at(hzK);
      sum += p;
      if (p < floorGate) miss += 1;
    }
    cands.push([hz, sum * Math.pow(penalty, miss), miss]);
  }
  let bestPow = 0;
  for (const [, s] of cands) if (s > bestPow) bestPow = s;
  const gate = bestPow * Math.pow(10, -within / 10);
  let chosen = null;
  for (const [hz, s] of cands) if (s >= gate) { chosen = hz; break; }
  if (chosen === null) {
    rows.push([f, peakHz.toFixed(2), "none", "", "", "", "no candidate with energy at the fundamental"]);
    continue;
  }
  const missing = [];
  for (let k = 1; k <= partials; k++) if (at(chosen * k) < floorGate) missing.push(k);
  const lowMissing = missing.filter((k) => k <= 4).length;
  const certified = lowMissing === 0 && chosen > fmin * 1.01;
  const centsVsPeak = 1200 * Math.log2(chosen / peakHz);
  rows.push([
    f,
    peakHz.toFixed(2),
    chosen.toFixed(2),
    (db(bestPow) - db(cands.find((c) => c[0] === chosen)[1])).toFixed(2),
    cands.find((c) => c[0] === chosen)[2],
    centsVsPeak.toFixed(1),
    (db(at(chosen)) - db(floorPow)).toFixed(1),
    missing.length ? "H" + missing.join(",H") : "none",
    certified ? "certified" : "not certified",
  ]);
}

console.log("file peakHz combF0 belowBestDb missingP centsVsPeak f0vsFloorDb missing verdict");
for (const r of rows) console.log(r.join(" "));
