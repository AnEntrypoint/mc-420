#!/usr/bin/env node
'use strict';

const fs = require('fs');
const net = require('net');
const dgram = require('dgram');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const kHost = '192.168.137.132';
const kMidiPort = 9401;
const kTelemPort = 4445;
const kShift = 0x62;
const kSustainCC = 64;

const kRate = 48000;
const kBpm = 120;
const kBeatMs = 60000 / kBpm;
const kBeatsPerPattern = 4;
const kToneHz = 1000;
const kBurstMs = 10;
const kRampMs = 1;
const kAmplitude = 0.5;
const kEnvWindowMs = 1;
const kRefractoryMs = 300;
const kMinSnrDb = 10;
const kDefaultSeconds = 30;
const kSettleMs = 20;

function parseArgs(argv) {
  const opts = {
    seconds: kDefaultSeconds,
    workdir: path.join(os.tmpdir(), 'click-jitter'),
    analyze: '',
    selftest: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--selftest') opts.selftest = true;
    else if (a === '--analyze') opts.analyze = argv[++i];
    else if (a === '--seconds') opts.seconds = Number(argv[++i]);
    else if (a === '--workdir') opts.workdir = argv[++i];
    else throw new Error(`unknown flag ${a}`);
  }
  if (!(opts.seconds > 1)) throw new Error('--seconds must be above 1');
  return opts;
}

function writeWav16(file, samples, rate) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i += 1) {
    const v = Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767)));
    data.writeInt16LE(v, i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([header, data]));
}

function readWavMono(file) {
  const buf = fs.readFileSync(file);
  let off = 12;
  let fmt = null;
  let data = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ') {
      fmt = { channels: buf.readUInt16LE(body + 2), rate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    }
    if (id === 'data') data = buf.subarray(body, Math.min(buf.length, body + size));
    off = body + size + (size & 1);
  }
  if (!fmt || !data) throw new Error(`${file}: no fmt/data chunk`);
  const bytes = fmt.bits / 8;
  const frames = Math.floor(data.length / (bytes * fmt.channels));
  const out = new Float64Array(frames);
  for (let f = 0; f < frames; f += 1) {
    let sum = 0;
    for (let c = 0; c < fmt.channels; c += 1) {
      const p = (f * fmt.channels + c) * bytes;
      sum += fmt.bits === 16 ? data.readInt16LE(p) / 32768 : data.readInt32LE(p) / 2147483648;
    }
    out[f] = sum / fmt.channels;
  }
  return { rate: fmt.rate, samples: out };
}

function burstSamples() {
  const burst = Math.round((kBurstMs / 1000) * kRate);
  const ramp = Math.round((kRampMs / 1000) * kRate);
  const out = new Float64Array(burst);
  for (let n = 0; n < burst; n += 1) {
    let env = 1;
    if (n < ramp) env = 0.5 - 0.5 * Math.cos(Math.PI * n / ramp);
    if (n >= burst - ramp) env = 0.5 - 0.5 * Math.cos(Math.PI * (burst - n) / ramp);
    out[n] = kAmplitude * env * Math.sin(2 * Math.PI * kToneHz * n / kRate);
  }
  return out;
}

function placeBurst(out, burst, startSample) {
  for (let n = 0; n < burst.length && startSample + n < out.length; n += 1) {
    if (startSample + n >= 0) out[startSample + n] += burst[n];
  }
}

function clickPattern() {
  const frames = Math.round((kBeatMs * kBeatsPerPattern / 1000) * kRate);
  const out = new Float64Array(frames);
  const burst = burstSamples();
  for (let beat = 0; beat < kBeatsPerPattern; beat += 1) {
    placeBurst(out, burst, Math.round((beat * kBeatMs / 1000) * kRate));
  }
  return out;
}

function percentile(values, p) {
  const sorted = Float64Array.from(values).sort();
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[idx];
}

function trailingRms(x, win) {
  const env = new Float64Array(x.length);
  let acc = 0;
  for (let i = 0; i < x.length; i += 1) {
    acc += x[i] * x[i];
    if (i >= win) acc -= x[i - win] * x[i - win];
    env[i] = Math.sqrt(Math.max(0, acc) / Math.min(i + 1, win));
  }
  return env;
}

function analyze(samples, rate) {
  const win = Math.max(1, Math.round((kEnvWindowMs / 1000) * rate));
  const env = trailingRms(samples, win);
  const floor = percentile(env, 0.5);
  const peak = percentile(env, 0.99);
  const snrDb = floor > 0 && peak > 0 ? 20 * Math.log10(peak / floor) : 0;
  const valid = snrDb >= kMinSnrDb;
  const threshold = floor + 0.5 * (peak - floor);
  const refractory = Math.round((kRefractoryMs / 1000) * rate);
  const onsetsSamples = [];
  let lastOn = -refractory;
  for (let i = 1; i < env.length; i += 1) {
    if (env[i - 1] < threshold && env[i] >= threshold && i - lastOn >= refractory) {
      onsetsSamples.push(i);
      lastOn = i;
    }
  }
  const onsetsMs = onsetsSamples.map((s) => (s / rate) * 1000);
  const captureMs = (samples.length / rate) * 1000;
  const intervals = [];
  for (let k = 1; k < onsetsMs.length; k += 1) intervals.push(onsetsMs[k] - onsetsMs[k - 1]);
  const dev = intervals.map((v) => v - kBeatMs);
  const mean = dev.length ? dev.reduce((a, b) => a + b, 0) / dev.length : NaN;
  const stdev = dev.length > 1 ? Math.sqrt(dev.reduce((a, b) => a + (b - mean) ** 2, 0) / (dev.length - 1)) : NaN;
  const absDev = dev.map((v) => Math.abs(v));
  const maxAbs = absDev.length ? Math.max(...absDev) : NaN;
  const p99 = absDev.length ? percentile(absDev, 0.99) : NaN;
  let expected = 0;
  if (onsetsMs.length) {
    const t0 = onsetsMs[0];
    const usable = captureMs - kSettleMs - t0;
    expected = usable >= 0 ? Math.floor(usable / kBeatMs) + 1 : 0;
  }
  return {
    valid,
    snrDb,
    onsets: onsetsMs.length,
    expected,
    missed: Math.max(0, expected - onsetsMs.length),
    extra: Math.max(0, onsetsMs.length - expected),
    firstOnsetMs: onsetsMs.length ? onsetsMs[0] : null,
    intervals: dev.length,
    meanMs: mean,
    stdevMs: stdev,
    maxAbsMs: maxAbs,
    p99AbsMs: p99,
  };
}

function fmt(v, digits = 3) {
  return Number.isFinite(v) ? v.toFixed(digits) : 'n/a';
}

function report(label, r) {
  console.log(`[click-jitter] ${label}`);
  console.log(`[click-jitter] onsets ${r.onsets} expected ${r.expected} (missed ${r.missed}, extra ${r.extra}), first onset at ${fmt(r.firstOnsetMs, 1)} ms into capture`);
  console.log(`[click-jitter] inter-onset deviation from ${fmt(kBeatMs, 3)} ms over ${r.intervals} intervals: mean ${fmt(r.meanMs)} ms, stdev ${fmt(r.stdevMs)} ms, max |dev| ${fmt(r.maxAbsMs)} ms, p99 |dev| ${fmt(r.p99AbsMs)} ms`);
  console.log(`[click-jitter] same-run SNR peak/floor ${fmt(r.snrDb, 1)} dB (need ${kMinSnrDb} dB): ${r.valid ? 'VALID' : 'INVALID'}`);
  console.log(`[click-jitter] json ${JSON.stringify(r)}`);
}

function synthCapture(seconds, offsetMs, shiftClickIndex, shiftMs) {
  const out = new Float64Array(Math.round(seconds * kRate));
  const burst = burstSamples();
  const clicks = Math.floor((seconds * 1000 - offsetMs) / kBeatMs) + 1;
  for (let k = 0; k < clicks; k += 1) {
    const extra = k === shiftClickIndex ? shiftMs : 0;
    placeBurst(out, burst, Math.round(((offsetMs + k * kBeatMs + extra) / 1000) * kRate));
  }
  return out;
}

function selfTest() {
  const cases = [
    { name: 'clean 30 s train, no shift', x: synthCapture(30, 700, -1, 0), expectValid: true, maxAbsAtMost: 0.001, expectOnsets: 59 },
    { name: 'one click late by 3 ms', x: synthCapture(30, 700, 20, 3), expectValid: true, maxAbsNear: 3, tolMs: 0.05, expectOnsets: 59 },
    { name: 'silence (negative control)', x: new Float64Array(30 * kRate), expectValid: false, expectOnsets: 0 },
  ];
  let failed = 0;
  for (const c of cases) {
    const r = analyze(c.x, kRate);
    let ok = r.valid === c.expectValid && r.onsets === c.expectOnsets;
    if (c.maxAbsAtMost !== undefined) ok = ok && r.maxAbsMs <= c.maxAbsAtMost;
    if (c.maxAbsNear !== undefined) ok = ok && Math.abs(r.maxAbsMs - c.maxAbsNear) <= c.tolMs;
    if (!ok) failed += 1;
    console.log(`[click-jitter] selftest ${c.name}: onsets ${r.onsets}/${c.expectOnsets} valid ${r.valid} max |dev| ${fmt(r.maxAbsMs, 4)} ms -> ${ok ? 'PASS' : 'FAIL'}`);
  }
  console.log(`[click-jitter] selftest ${failed === 0 ? 'PASS' : 'FAIL'} (${cases.length - failed}/${cases.length})`);
  return failed === 0 ? 0 : 1;
}

function sendMidi(bytes) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: kHost, port: kMidiPort }, () => sock.end(Buffer.from(bytes)));
    sock.setTimeout(5000);
    sock.on('timeout', () => { sock.destroy(); reject(new Error(`midi write to ${kHost}:${kMidiPort} timed out`)); });
    sock.on('close', resolve);
    sock.on('error', reject);
  });
}

function telemetry(timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4');
    const timer = setTimeout(() => { sock.close(); reject(new Error(`telemetry query to ${kHost}:${kTelemPort} timed out`)); }, timeoutMs);
    sock.on('message', (msg) => {
      clearTimeout(timer);
      sock.close();
      try { resolve(JSON.parse(msg.toString().replace(/(?<=[\[,:])(-?nan|-?inf)(?=[,\]}])/gi, 'null'))); }
      catch (e) { reject(e); }
    });
    sock.on('error', (e) => { clearTimeout(timer); reject(e); });
    sock.send('status', kTelemPort, kHost);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function engageMonitor() {
  await sendMidi([0x90, kShift, 127]);
  await sleep(400);
  const before = await telemetry();
  if ((before.sustain_cmd || 0) < 0.5) {
    await sendMidi([0xb0, kSustainCC, 127]);
    await sleep(300);
    await sendMidi([0xb0, kSustainCC, 0]);
    await sleep(300);
  }
  const after = await telemetry();
  if ((after.sustain_cmd || 0) < 0.5) throw new Error('sustain latch did not open with SHIFT held');
  return { sustainBefore: before.sustain_cmd, sustainAfter: after.sustain_cmd, monitorMode: after.monitor_mode };
}

async function releaseMonitor() {
  await sendMidi([0x80, kShift, 0]);
}

async function runLive(opts) {
  if (!fs.existsSync(opts.workdir)) fs.mkdirSync(opts.workdir, { recursive: true });
  const clickWav = path.join(opts.workdir, 'click-120bpm-1khz.wav');
  const captureWav = path.join(opts.workdir, `capture-${Date.now()}.wav`);
  writeWav16(clickWav, clickPattern(), kRate);
  const witness = path.join(__dirname, 'loopback-witness.js');
  let gate;
  try {
    gate = await engageMonitor();
    console.log(`[click-jitter] SHIFT held, sustain_cmd ${gate.sustainBefore} -> ${gate.sustainAfter}, monitor_mode ${gate.monitorMode}`);
    const run = spawnSync(process.execPath, [witness, '--wav', clickWav, '--seconds', String(opts.seconds), '--out', captureWav, '--no-gate'], {
      stdio: 'inherit',
      timeout: (opts.seconds + 180) * 1000,
    });
    if (run.status !== 0) {
      console.log(`[click-jitter] loopback-witness exited ${run.status} (${run.error ? run.error.message : 'no error'})`);
      return 1;
    }
  } finally {
    await releaseMonitor().catch((e) => console.log(`[click-jitter] SHIFT release failed: ${e.message}`));
  }
  const cap = readWavMono(captureWav);
  const r = analyze(cap.samples, cap.rate);
  report(`round trip through loopback-witness, ${opts.seconds} s at ${kBpm} BPM, SHIFT held, capture ${captureWav}`, r);
  return r.valid ? 0 : 1;
}

function runAnalyze(file) {
  const cap = readWavMono(file);
  const r = analyze(cap.samples, cap.rate);
  report(`offline analysis of ${file}`, r);
  return r.valid ? 0 : 1;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.selftest) return selfTest();
  if (opts.analyze) return runAnalyze(opts.analyze);
  return runLive(opts);
}

Promise.resolve(main()).then((code) => { process.exitCode = code; }, (err) => {
  console.error(`[click-jitter] error: ${err.message}`);
  process.exitCode = 1;
});
