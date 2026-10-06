#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DSP_CLI = path.join(__dirname, '..', '..', 'tools', 'dsp-cli', 'dsp_cli.exe');

function readWavMono(file) {
  const b = fs.readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`${file} is not RIFF/WAVE`);
  }
  let off = 12;
  let fmt = null;
  let data = null;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4);
    const size = b.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ') {
      fmt = { format: b.readUInt16LE(body), channels: b.readUInt16LE(body + 2), rate: b.readUInt32LE(body + 4), bits: b.readUInt16LE(body + 14) };
    } else if (id === 'data') {
      data = b.subarray(body, body + size);
    }
    off = body + size + (size % 2);
  }
  if (!fmt || !data) throw new Error(`${file}: no fmt/data chunk`);
  if (fmt.format !== 1) throw new Error(`${file}: need PCM`);
  const bytes = fmt.bits / 8;
  const frames = Math.floor(data.length / bytes / fmt.channels);
  const out = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let c = 0; c < fmt.channels; c++) {
      const o = (i * fmt.channels + c) * bytes;
      if (fmt.bits === 16) s += data.readInt16LE(o) / 32768;
      else if (fmt.bits === 32) s += data.readInt32LE(o) / 2147483648;
      else if (fmt.bits === 24) s += ((data[o] | (data[o + 1] << 8) | (data[o + 2] << 16)) << 8 >> 8) / 8388608;
      else throw new Error(`${file}: unsupported bits ${fmt.bits}`);
    }
    out[i] = s / fmt.channels;
  }
  return { sig: out, rate: fmt.rate };
}

function writeWavMono16(file, sig, rate) {
  const buf = Buffer.alloc(sig.length * 2);
  for (let i = 0; i < sig.length; i++) {
    const v = Math.max(-1, Math.min(1, sig[i]));
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
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(buf.length, 40);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([h, buf]));
}

function normalize(sig, mode, target) {
  let ref = 0;
  if (mode === 'peak') {
    for (let i = 0; i < sig.length; i++) ref = Math.max(ref, Math.abs(sig[i]));
  } else {
    let acc = 0;
    for (let i = 0; i < sig.length; i++) acc += sig[i] * sig[i];
    ref = Math.sqrt(acc / Math.max(1, sig.length));
  }
  if (ref === 0) return new Float64Array(sig.length);
  const g = target / ref;
  const out = new Float64Array(sig.length);
  for (let i = 0; i < sig.length; i++) out[i] = sig[i] * g;
  return out;
}

function glitches(file, threshold, minGapMs) {
  let out = '';
  try {
    out = execFileSync(DSP_CLI, ['--glitch-check', file, `threshold=${threshold}`, `minGapMs=${minGapMs}`], { stdio: 'pipe' }).toString();
  } catch (e) {
    out = e.stdout ? e.stdout.toString() : '';
  }
  const m = out.match(/glitches=(\d+)/);
  return m ? Number(m[1]) : NaN;
}

const [, , inWav, modeArg, threshArg, gapArg] = process.argv;
if (!inWav) {
  console.error('usage: node glitch-normalize.js <wav> [peak|rms] [threshold] [minGapMs]');
  process.exit(2);
}
const mode = modeArg || 'peak';
const target = mode === 'rms' ? 0.1 : 1.0;
const threshold = Number(threshArg || '0.25');
const minGapMs = Number(gapArg || '5');

const { sig, rate } = readWavMono(inWav);
const norm = normalize(sig, mode, target);
const keep = process.env.KEEP_NORM === '1';
const tmp = path.join(path.dirname(inWav), `.norm-${path.basename(inWav)}`);
writeWavMono16(tmp, norm, rate);
const n = glitches(tmp, threshold, minGapMs);
console.log(`glitch,${path.basename(inWav)},norm=${mode}${target},threshold=${threshold},minGapMs=${minGapMs},glitches=${n}`);
if (keep) console.log(`kept ${tmp}`);
else fs.rmSync(tmp);
