#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const [, , freqArg, outArg] = process.argv;
const freq = Number(freqArg || '220');
const out = outArg || path.join(__dirname, '..', '..', '.witness', 'inject', `burst${Math.round(freq)}.wav`);

const RATE = 48000;
const SECS = 8;
const BURST_START = 3.0;
const BURST_SECS = 0.4;
const HARMONICS = 8;
const TONE_PEAK = 0.45;
const BURST_PEAK = 0.55;

const n = RATE * SECS;
const sig = new Float64Array(n);
let seed = 12345;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return (seed / 0x7fffffff) * 2 - 1;
};

const burstFrom = Math.round(BURST_START * RATE);
const burstTo = burstFrom + Math.round(BURST_SECS * RATE);

for (let i = 0; i < n; i++) {
  let v = 0;
  for (let h = 1; h <= HARMONICS; h++) {
    v += Math.sin((2 * Math.PI * freq * h * i) / RATE) / h;
  }
  sig[i] = (v / 1.6) * TONE_PEAK;
}
for (let i = burstFrom; i < burstTo && i < n; i++) {
  const env = Math.sin((Math.PI * (i - burstFrom)) / (burstTo - burstFrom));
  sig[i] += rnd() * BURST_PEAK * env;
}

let peak = 0;
for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(sig[i]));
const norm = peak > 0 ? 0.9 / peak : 0;

const buf = Buffer.alloc(n * 2);
for (let i = 0; i < n; i++) {
  const v = Math.max(-1, Math.min(1, sig[i] * norm));
  buf.writeInt16LE(Math.round(v * 32767), i * 2);
}

const h = Buffer.alloc(44);
h.write('RIFF', 0);
h.writeUInt32LE(36 + buf.length, 4);
h.write('WAVE', 8);
h.write('fmt ', 12);
h.writeUInt32LE(16, 16);
h.writeUInt16LE(1, 20);
h.writeUInt16LE(1, 22);
h.writeUInt32LE(RATE, 24);
h.writeUInt32LE(RATE * 2, 28);
h.writeUInt16LE(2, 32);
h.writeUInt16LE(16, 34);
h.write('data', 36);
h.writeUInt32LE(buf.length, 40);

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.concat([h, buf]));
console.log(`[gen-burst] ${freq}Hz x${HARMONICS} ${SECS}s + noise burst ${BURST_START}..${BURST_START + BURST_SECS}s -> ${out}`);
