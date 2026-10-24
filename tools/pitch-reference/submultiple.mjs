#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const file = flag("--wav", "");
const seconds = Number(flag("--seconds", "6"));
const peakHz = Number(flag("--peak", "0"));
const lo = Number(flag("--lo", "200"));
const hi = Number(flag("--hi", "240"));
const margin = Number(flag("--margin", "12"));
const step = Number(flag("--step", "0.02"));
if (!file) {
  console.error("usage: node tools/pitch-reference/submultiple.mjs --wav <f.wav> [--peak <hz>] [--lo 200] [--hi 240] [--margin 12] [--step 0.02] [--seconds 6]");
  process.exit(2);
}

const b = fs.readFileSync(file);
const fmtChunk = b.readUInt32LE(16);
let off = 12 + 8 + fmtChunk;
let data = null;
let channels = 1;
let rate = 48000;
let bits = 16;
while (off + 8 <= b.length) {
  const id = b.toString("ascii", off, off + 4);
  const sz = b.readUInt32LE(off + 4);
  if (id === "fmt ") {
    channels = b.readUInt16LE(off + 10);
    rate = b.readUInt32LE(off + 12);
    bits = b.readUInt16LE(off + 22);
  }
  if (id === "data") { data = { s: off + 8, n: sz / (bits / 8) }; break; }
  off += 8 + sz + (sz & 1);
}
if (!data) { console.error("no data chunk"); process.exit(2); }

const n = Math.min(data.n, Math.floor(seconds * rate));
const x = new Float64Array(n);
for (let i = 0; i < n; i++) {
  let v = 0;
  for (let c = 0; c < channels; c++) {
    const p = data.s + (bits / 8) * (i * channels + c);
    v += b.readInt16LE(p) / 32768;
  }
  x[i] = v / channels;
}
const winSize = 16384;
const winCount = Math.max(1, Math.floor(n / winSize));

const powAt = (hz) => {
  const w = (2 * Math.PI * hz) / rate;
  const coeff = 2 * Math.cos(w);
  let total = 0;
  for (let k = 0; k < winCount; k++) {
    let s1 = 0;
    let s2 = 0;
    const end = Math.min(n, (k + 1) * winSize);
    for (let i = k * winSize; i < end; i++) {
      const s0 = x[i] + coeff * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
    const re = s1 - s2 * Math.cos(w);
    const im = s2 * Math.sin(w);
    total += (re * re + im * im) / (winSize * winSize);
  }
  return total / winCount;
};
const magAt = (hz) => Math.sqrt(Math.max(0, powAt(hz)));
const db = (m) => 20 * Math.log10(Math.max(1e-12, m));

const sweep = (from, to, st) => {
  const out = [];
  for (let hz = from; hz <= to + 1e-9; hz += st) out.push([hz, magAt(hz)]);
  return out;
};

const wide = [];
for (let hz = 40; hz <= 4000; hz *= 1.005) wide.push([hz, magAt(hz)]);
let gPeakHz = 0;
let gPeakMag = 0;
for (const [hz, m] of wide) if (m > gPeakMag) { gPeakMag = m; gPeakHz = hz; }
const refPeakHz = peakHz > 0 ? peakHz : gPeakHz;
let refPeakMag = magAt(refPeakHz);
for (let d = -1.0; d <= 1.0; d += 0.05) {
  const m = magAt(refPeakHz + d);
  if (m > refPeakMag) { refPeakMag = m; }
}

const band = sweep(lo, hi, step);
const mags = band.map((p) => p[1]).slice().sort((a, c) => a - c);
const floorMag = mags[Math.floor(mags.length / 2)];
const peaks = [];
for (let i = 2; i < band.length - 2; i++) {
  const m = band[i][1];
  if (m >= band[i - 1][1] && m >= band[i + 1][1] && m > band[i - 2][1] && m > band[i + 2][1]) peaks.push(band[i]);
}
const clearing = peaks.filter((p) => db(p[1]) >= db(refPeakMag) - margin && db(p[1]) >= db(floorMag) + margin);

console.log("file " + path.basename(file) + " rate " + rate + " ch " + channels + " seconds " + (n / rate).toFixed(2));
console.log("global peak " + gPeakHz.toFixed(2) + " Hz  " + db(gPeakMag).toFixed(1) + " dB");
console.log("given peak  " + refPeakHz.toFixed(2) + " Hz  " + db(refPeakMag).toFixed(1) + " dB");
console.log("band floor  " + db(floorMag).toFixed(1) + " dB  (median of " + lo + "-" + hi + " Hz)");
console.log("band peaks: " + (peaks.length === 0 ? "none" : ""));
for (const [hz, m] of peaks) {
  const relPeak = db(m) - db(refPeakMag);
  const relFloor = db(m) - db(floorMag);
  const ok = relPeak >= -margin && relFloor >= margin;
  console.log("  " + hz.toFixed(2) + " Hz  " + db(m).toFixed(1) + " dB  vs peak " + relPeak.toFixed(1) + " dB  vs floor +" + relFloor.toFixed(1) + " dB  " + (ok ? "clears" : "rejected"));
}
console.log("clearing candidates in band: " + clearing.length);
console.log("sub-multiples of the given peak:");
for (let k = 2; k <= 8; k++) {
  const f = refPeakHz / k;
  const inBand = f >= lo && f <= hi;
  const m = inBand ? magAt(f) : 0;
  const near = clearing.length === 1 ? clearing[0][0] : 0;
  let harm = "";
  if (near > 0 && Math.abs(f - near) < 3) {
    const ratio = refPeakHz / near;
    harm = "  peak/f0 " + ratio.toFixed(4) + "  cents err " + (1200 * Math.log2(refPeakHz / (near * Math.round(ratio)))).toFixed(1);
  }
  console.log("  /" + k + " = " + f.toFixed(3) + " Hz" + (inBand ? "  in band  " + db(m).toFixed(1) + " dB" : "  out of band") + harm);
}
const ladderHz = clearing.length === 1 ? clearing[0][0] : (band.length ? band.reduce((a, p) => (p[1] > a[1] ? p : a), band[0])[0] : 0);
if (ladderHz > 0) {
  console.log("harmonic ladder at " + ladderHz.toFixed(2) + " Hz:");
  for (let k = 1; k <= 8; k++) {
    const hz = ladderHz * k;
    const m = hz > 22000 ? 0 : magAt(hz);
    console.log("  H" + k + " " + hz.toFixed(1) + " Hz  " + db(m).toFixed(1) + " dB  vs peak " + (db(m) - db(refPeakMag)).toFixed(1) + " dB");
  }
  const missing = [];
  for (let k = 1; k <= 6; k++) if (db(magAt(ladderHz * k)) < db(floorMag) + margin) missing.push(k);
  console.log("partials below floor+" + margin + " dB: " + (missing.length ? "H" + missing.join(",H") : "none"));
}
if (clearing.length === 1) {
  const f0 = clearing[0][0];
  console.log("verdict: exactly one sub-multiple clears -> reference " + f0.toFixed(2) + " Hz");
} else {
  console.log("verdict: " + (clearing.length === 0 ? "no" : clearing.length) + " sub-multiple(s) clear -> file stays excluded");
}
