#!/usr/bin/env node

const fs = require('fs');
const net = require('net');
const dgram = require('dgram');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const kRate = 48000;
const kMidiPort = 9401;
const kTelemPort = 4445;
const kApcBtnShift = 0x62;
const kSustainCC = 64;
const kScanToneHz = 440;
const kWorkDir = path.join(os.tmpdir(), 'loopback-witness');

const args = process.argv.slice(2);
const opts = {
  host: '192.168.137.132',
  wav: '',
  semis: 0,
  seconds: 6,
  out: path.join(kWorkDir, 'capture.wav'),
  playCard: 'plughw:0,0',
  capCard: 'plughw:0,0',
  playChannels: 8,
  capChannels: 20,
  playCh: 6,
  capCh: -1,
  gain: 0.5,
  gate: true,
  scan: false,
};

for (let i = 0; i < args.length; i += 1) {
  const a = args[i];
  if (a === '--no-gate') { opts.gate = false; continue; }
  if (a === '--scan') { opts.scan = true; continue; }
  const key = a.replace(/^--/, '');
  const val = args[i + 1];
  if (val === undefined) { console.error(`[loopback-witness] missing value for ${a}`); process.exit(2); }
  i += 1;
  if (!(key in opts)) { console.error(`[loopback-witness] unknown flag ${a}`); process.exit(2); }
  if (typeof opts[key] === 'boolean') opts[key] = val === '1' || val === 'true';
  else if (typeof opts[key] === 'number') opts[key] = Number(val);
  else opts[key] = val;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sendBytes(bytes) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: opts.host, port: kMidiPort }, () => {
      sock.write(Buffer.from(bytes), (err) => {
        if (err) return reject(err);
        sock.end();
      });
    });
    sock.setTimeout(5000);
    sock.on('timeout', () => { sock.destroy(); reject(new Error(`write to ${opts.host}:${kMidiPort} timed out`)); });
    sock.on('close', resolve);
    sock.on('error', reject);
  });
}

const noteOn = (note, vel, ch) => sendBytes([0x90 | (ch & 0x0f), note, vel]);
const noteOff = (note, ch) => sendBytes([0x80 | (ch & 0x0f), note, 0]);
const cc = (controller, value, ch) => sendBytes([0xb0 | (ch & 0x0f), controller, value]);

function telemetry() {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4');
    const timer = setTimeout(() => { sock.close(); reject(new Error(`telemetry query to ${opts.host}:${kTelemPort} timed out`)); }, 3000);
    sock.on('message', (msg) => {
      clearTimeout(timer);
      sock.close();
      try { resolve(JSON.parse(msg.toString())); }
      catch (e) { reject(e); }
    });
    sock.on('error', (e) => { clearTimeout(timer); reject(e); });
    sock.send('status', kTelemPort, opts.host);
  });
}

const peakOf = (t) => (t && t.audio_peak ? t.audio_peak : {});

function readWav(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`${file} is not a RIFF/WAVE file`);
  }
  let fmt = null;
  let data = null;
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ') {
      fmt = {
        format: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        rate: buf.readUInt32LE(body + 4),
        bits: buf.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      data = buf.subarray(body, body + size);
    }
    off = body + size + (size & 1);
  }
  if (!fmt || !data) throw new Error(`${file} has no fmt/data chunk`);
  const frames = Math.floor(data.length / ((fmt.bits / 8) * fmt.channels));
  const mono = new Float32Array(frames);
  const bytesPer = fmt.bits / 8;
  for (let f = 0; f < frames; f += 1) {
    let sum = 0;
    for (let c = 0; c < fmt.channels; c += 1) {
      const p = f * bytesPer * fmt.channels + c * bytesPer;
      let v = 0;
      if (fmt.bits === 16) v = data.readInt16LE(p) / 32768;
      else if (fmt.bits === 24) v = ((data[p] | (data[p + 1] << 8) | (data[p + 2] << 16)) << 8 >> 8) / 8388608;
      else if (fmt.bits === 32 && fmt.format === 3) v = data.readFloatLE(p);
      else if (fmt.bits === 32) v = data.readInt32LE(p) / 2147483648;
      else throw new Error(`unsupported bit depth ${fmt.bits}`);
      sum += v;
    }
    mono[f] = sum / fmt.channels;
  }
  return { rate: fmt.rate, samples: mono };
}

function resample(src, srcRate, dstRate, ratio) {
  const step = (srcRate / dstRate) * ratio;
  if (src.length === 0) return new Float32Array(0);
  const outLen = Math.max(1, Math.floor((src.length - 1) / step));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i += 1) {
    const pos = i * step;
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    const a = src[i0];
    const b = i0 + 1 < src.length ? src[i0 + 1] : a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

function tone(seconds, hz, amplitude) {
  const n = Math.round(seconds * kRate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) out[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / kRate);
  return out;
}

function tile(mono, frames) {
  if (mono.length === 0) return new Float32Array(frames);
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i += 1) out[i] = mono[i % mono.length];
  return out;
}

function writeInterleavedS32(file, mono, channels, target, gain) {
  const frames = mono.length;
  const buf = Buffer.alloc(frames * channels * 4);
  for (let f = 0; f < frames; f += 1) {
    let v = mono[f] * gain;
    if (v > 1) v = 1; else if (v < -1) v = -1;
    const s = Math.round(v * 2147483647);
    buf.writeInt32LE(s, (f * channels + target) * 4);
  }
  fs.writeFileSync(file, buf);
}

function writeWav16(file, samples, rate) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i += 1) {
    let v = samples[i];
    if (v > 1) v = 1; else if (v < -1) v = -1;
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  fs.writeFileSync(file, buf);
}

function deinterleave(raw, channels, index) {
  const frames = Math.floor(raw.length / (channels * 4));
  const out = new Float32Array(frames);
  for (let f = 0; f < frames; f += 1) out[f] = raw.readInt32LE((f * channels + index) * 4) / 2147483648;
  return out;
}

function stats(samples) {
  let peak = 0;
  let sumSq = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
    sumSq += samples[i] * samples[i];
  }
  const rms = samples.length ? Math.sqrt(sumSq / samples.length) : 0;
  return { peak, rms };
}

function estimateF0(samples, rate) {
  if (samples.length < 4096) return null;
  let bestAt = 0;
  let best = 0;
  const win = 8192;
  for (let i = 0; i + win < samples.length; i += 1024) {
    let e = 0;
    for (let j = i; j < i + win; j += 1) e += samples[j] * samples[j];
    if (e > best) { best = e; bestAt = i; }
  }
  const start = bestAt;
  const minLag = Math.floor(rate / 1000);
  const maxLag = Math.floor(rate / 60);
  let bestScore = Infinity;
  let bestLag = 0;
  for (let lag = minLag; lag <= maxLag && lag + start + win < samples.length; lag += 1) {
    let num = 0;
    let denA = 0;
    let denB = 0;
    for (let j = 0; j < win; j += 1) {
      const a = samples[start + j];
      const b = samples[start + j + lag];
      const d = a - b;
      num += d * d;
      denA += a * a;
      denB += b * b;
    }
    const den = denA + denB;
    if (den <= 0) continue;
    const score = num / den;
    if (score < bestScore) { bestScore = score; bestLag = lag; }
  }
  if (!bestLag || bestScore > 0.75) return null;
  return { hz: rate / bestLag, score: bestScore };
}

function run(cmd, cmdArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, cmdArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${cmdArgs.join(' ')} exited ${code}: ${err.trim()}`));
    });
  });
}

const playRaw = (file, channels) => run('aplay', ['-q', '-D', opts.playCard, '-t', 'raw', '-c', String(channels), '-f', 'S32_LE', '-r', String(kRate), file]);

const captureRaw = (file, channels, seconds) => run('arecord', ['-q', '-D', opts.capCard, '-t', 'raw', '-c', String(channels), '-f', 'S32_LE', '-r', String(kRate), '-d', String(seconds), file]);

async function ensureGate() {
  const before = await telemetry();
  if ((before.sustain_cmd || 0) >= 0.5) return { before, toggled: false };
  await noteOn(kApcBtnShift, 127, 0);
  await sleep(400);
  await cc(kSustainCC, 127, 1);
  await sleep(300);
  await cc(kSustainCC, 0, 1);
  await sleep(300);
  await noteOff(kApcBtnShift, 0);
  await sleep(400);
  return { before, toggled: true };
}

async function withGate(active, fn) {
  if (!active) return fn();
  const state = await ensureGate();
  const after = await telemetry();
  console.log(`[loopback-witness] gate: sustain_cmd ${state.before.sustain_cmd} -> ${after.sustain_cmd} (${state.toggled ? 'latched by SHIFT+sustain' : 'already latched'})`);
  if ((after.sustain_cmd || 0) < 0.5) throw new Error('sustain latch did not open -- no passthrough');
  return fn();
}

async function scanPlayChannel() {
  if (!fs.existsSync(kWorkDir)) fs.mkdirSync(kWorkDir, { recursive: true });
  const results = [];
  const toneBuf = tone(1.5, kScanToneHz, 0.6);
  for (let ch = 0; ch < opts.playChannels; ch += 1) {
    const file = path.join(kWorkDir, `scan-play-${ch}.raw`);
    writeInterleavedS32(file, toneBuf, opts.playChannels, ch, opts.gain);
    const playing = playRaw(file, opts.playChannels);
    await sleep(250);
    let maxIn = 0;
    for (let i = 0; i < 8; i += 1) {
      const t = await telemetry();
      maxIn = Math.max(maxIn, peakOf(t).in || 0);
      await sleep(120);
    }
    await playing;
    await sleep(200);
    results.push({ ch, maxIn });
    console.log(`[loopback-witness] play ch ${ch}: audio_peak.in max ${maxIn}`);
  }
  results.sort((a, b) => b.maxIn - a.maxIn);
  return results;
}

async function scanCaptureChannel(playCh) {
  if (!fs.existsSync(kWorkDir)) fs.mkdirSync(kWorkDir, { recursive: true });
  const seconds = 4;
  const toneBuf = tile(tone(0.5, kScanToneHz, 0.6), Math.round(seconds * kRate));
  const playFile = path.join(kWorkDir, 'scan-cap-play.raw');
  const capFile = path.join(kWorkDir, 'scan-cap.raw');
  writeInterleavedS32(playFile, toneBuf, opts.playChannels, playCh, opts.gain);
  const rows = [];
  await withGate(true, async () => {
    const capturing = captureRaw(capFile, opts.capChannels, seconds);
    await sleep(300);
    await playRaw(playFile, opts.playChannels);
    await capturing;
  });
  const raw = fs.readFileSync(capFile);
  for (let ch = 0; ch < opts.capChannels; ch += 1) {
    const s = stats(deinterleave(raw, opts.capChannels, ch));
    rows.push({ ch, peak: s.peak, rms: s.rms });
    console.log(`[loopback-witness] capture ch ${ch}: peak ${s.peak.toFixed(6)} rms ${s.rms.toFixed(6)}`);
  }
  rows.sort((a, b) => b.rms - a.rms);
  return rows;
}

async function main() {
  if (!fs.existsSync(kWorkDir)) fs.mkdirSync(kWorkDir, { recursive: true });
  console.log(`[loopback-witness] host=${opts.host} play=${opts.playCard} ch${opts.playCh}/${opts.playChannels} cap=${opts.capCard} ch${opts.capCh}/${opts.capChannels}`);

  if (opts.scan) {
    const play = await scanPlayChannel();
    const bestPlay = play[0].maxIn > 0.00011 ? play[0].ch : -1;
    console.log(`[loopback-witness] best playback channel: ${bestPlay} (audio_peak.in ${play[0].maxIn})`);
    if (bestPlay < 0) {
      console.log('[loopback-witness] no playback channel produced input at the client -- check wiring');
      process.exit(1);
    }
    const cap = await scanCaptureChannel(bestPlay);
    console.log(`[loopback-witness] best capture channel: ${cap[0].ch} (rms ${cap[0].rms.toFixed(6)})`);
    return;
  }

  if (!opts.wav) {
    console.error('usage: node loopback-witness.js --wav <file> [--semis N] [--no-gate] [--seconds N] [--out file] [--play-ch N] [--cap-ch N] [--scan]');
    process.exit(2);
  }

  const source = readWav(opts.wav);
  const ratio = Math.pow(2, opts.semis / 12);
  const shifted = resample(source.samples, source.rate, kRate, ratio);
  const frames = Math.round(opts.seconds * kRate);
  const program = tile(shifted, frames);
  const playFile = path.join(kWorkDir, 'play.raw');
  const capFile = path.join(kWorkDir, 'capture.raw');
  writeInterleavedS32(playFile, program, opts.playChannels, opts.playCh, opts.gain);

  const before = await telemetry();
  const srcStats = stats(program);
  console.log(`[loopback-witness] source ${opts.wav} ${source.rate}Hz ${(source.samples.length / source.rate).toFixed(2)}s -> ${opts.semis >= 0 ? '+' : ''}${opts.semis} semis (${ratio.toFixed(5)}x), play peak ${srcStats.peak.toFixed(4)} rms ${srcStats.rms.toFixed(4)}`);
  console.log(`[loopback-witness] before: audio_peak.in ${peakOf(before).in} out ${peakOf(before).out} xruns ${before.xruns} sustain_gate ${before.sustain_gate}`);

  let polling = true;
  const during = { in: 0, out: 0, xruns: 0, polls: 0 };
  const pollLoop = (async () => {
    while (polling) {
      try {
        const t = await telemetry();
        during.in = Math.max(during.in, peakOf(t).in || 0);
        during.out = Math.max(during.out, peakOf(t).out || 0);
        during.xruns = Math.max(during.xruns, t.xruns || 0);
        during.polls += 1;
      } catch (e) { during.polls += 1; }
      await sleep(150);
    }
  })();

  await withGate(opts.gate, async () => {
    const capturing = captureRaw(capFile, opts.capChannels, opts.seconds);
    await sleep(300);
    await playRaw(playFile, opts.playChannels);
    await capturing;
  });
  polling = false;
  await pollLoop;

  const after = await telemetry();
  const raw = fs.readFileSync(capFile);
  const all = [];
  for (let ch = 0; ch < opts.capChannels; ch += 1) {
    const s = stats(deinterleave(raw, opts.capChannels, ch));
    all.push({ ch, peak: s.peak, rms: s.rms });
  }
  const ranked = all.slice().sort((a, b) => b.rms - a.rms);
  const pick = opts.capCh >= 0 ? all[opts.capCh] : ranked[0];
  const captured = deinterleave(raw, opts.capChannels, pick.ch);
  const outStats = stats(captured);
  writeWav16(opts.out, captured, kRate);
  const f0 = estimateF0(captured, kRate);

  console.log(`[loopback-witness] during (max of ${during.polls} polls): audio_peak.in ${during.in} out ${during.out} xruns ${during.xruns}`);
  console.log(`[loopback-witness] after: audio_peak.in ${peakOf(after).in} out ${peakOf(after).out} xruns ${after.xruns} sustain_cmd ${after.sustain_cmd} fold ${after.resample_fold ? after.resample_fold.sum : 0}`);
  console.log(`[loopback-witness] loudest capture channels: ${ranked.slice(0, 4).map((r) => `ch${r.ch} rms ${r.rms.toFixed(6)}`).join(' | ')}`);
  console.log(`[loopback-witness] capture ch ${pick.ch}: ${captured.length} samples (${(captured.length / kRate).toFixed(2)}s) peak ${outStats.peak.toFixed(6)} rms ${outStats.rms.toFixed(6)}`);
  const db = outStats.rms > 0 && srcStats.rms > 0 ? 20 * Math.log10(outStats.rms / srcStats.rms) : 0;
  console.log(`[loopback-witness] loop gain ${db.toFixed(2)} dB (capture rms vs played rms)`);
  console.log(`[loopback-witness] f0 ${f0 ? `${f0.hz.toFixed(2)} Hz (score ${f0.score.toFixed(3)})` : 'not detected'}`);
  console.log(`[loopback-witness] wrote ${opts.out}`);
}

main().catch((err) => {
  console.error('[loopback-witness] error:', err.message);
  process.exit(1);
});
