#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const net = require('net');
const dgram = require('dgram');
const { spawn } = require('child_process');
const { performance } = require('perf_hooks');

const kRate = 48000;
const kChannels = 20;
const kMidiPort = 9401;
const kTelemPort = 4445;
const kPreRollMs = 1500;
const kTailMs = 1500;
const kWindowSamples = 48;
const kFloorWindows = 300;
const kOnsetDb = 10;
const kMinGapWindows = 60;
const kMaxLatencyMs = 1000;
const kKnown = new Set(['host', 'card', 'beepCh', 'recordNote', 'loopSeconds', 'outDir', 'waitFree', 'analyze', 'periodSamples']);
const kReleaseMs = 80;

const parseArgs = (argv) => {
  const out = {
    mode: 'check',
    host: '192.168.137.132',
    card: 'plughw:0,0',
    beepCh: 1,
    recordNote: -1,
    loopSeconds: 3,
    waitFree: 0,
    outDir: process.env.PRESS_LATENCY_OUT || path.join(process.cwd(), 'runs', 'press-latency'),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--check' || a === '--selftest' || a === '--run') { out.mode = a.slice(2); continue; }
    const key = a.replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (!kKnown.has(key)) throw new Error('unknown option ' + a);
    i += 1;
    out[key] = argv[i];
  }
  out.beepCh = Number(out.beepCh);
  out.recordNote = Number(out.recordNote);
  out.loopSeconds = Number(out.loopSeconds);
  out.waitFree = Number(out.waitFree);
  out.periodSamples = Number(out.periodSamples || 0);
  return out;
};

const opts = parseArgs(process.argv.slice(2));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cardIndex = (card) => {
  const m = /plughw:(\d+)/.exec(card);
  if (!m) throw new Error('card must be plughw:N,M, got ' + card);
  return Number(m[1]);
};

const readText = (file) => {
  try { return fs.readFileSync(file, 'utf8'); } catch (e) { return null; }
};

const parseState = (text) => text.trim().split('\n')[0].replace(/^state:\s*/i, '').trim().toLowerCase();

const captureState = (index) => {
  const text = readText('/proc/asound/card' + index + '/pcm0c/sub0/status');
  return text === null ? 'missing' : parseState(text);
};

const isFree = (state) => state === 'closed';

const cardName = (index) => {
  const text = readText('/proc/asound/cards') || '';
  const line = text.split('\n').find((l) => new RegExp('^\\s*' + index + '\\s+\\[').test(l));
  return line ? line.trim() : null;
};

const sendBytes = (bytes) => new Promise((resolve, reject) => {
  const sock = net.connect({ host: opts.host, port: kMidiPort }, () => {
    sock.write(Buffer.from(bytes), (err) => {
      if (err) return reject(err);
      sock.end();
    });
  });
  sock.setTimeout(5000);
  sock.on('timeout', () => { sock.destroy(); reject(new Error('MIDI write to ' + opts.host + ':' + kMidiPort + ' timed out')); });
  sock.on('close', resolve);
  sock.on('error', reject);
});

const telemetryOnce = (timeoutMs = 3000) => new Promise((resolve, reject) => {
  const sock = dgram.createSocket('udp4');
  const timer = setTimeout(() => { sock.close(); reject(new Error('telemetry query timed out')); }, timeoutMs);
  sock.on('message', (msg) => {
    clearTimeout(timer);
    sock.close();
    try { resolve(JSON.parse(msg.toString().replace(/(?<=[\[,:])(-?nan|-?inf)(?=[,\]}])/gi, 'null'))); }
    catch (e) { reject(e); }
  });
  sock.on('error', (e) => { clearTimeout(timer); reject(e); });
  sock.send('status', kTelemPort, opts.host);
});

const telemetryOrNull = async () => {
  try {
    const t = await telemetryOnce();
    return {
      grid_beat_index: t.grid_beat_index,
      master_phase_beats: t.master_phase_beats,
      master_len_samples: t.master_len_samples,
      recorded_beats: t.recorded_beats,
      at: new Date().toISOString(),
    };
  } catch (e) {
    return { error: e.message };
  }
};

const readChannel = (file, channels, index) => {
  const buf = fs.readFileSync(file);
  const frames = Math.floor(buf.length / (4 * channels));
  const out = new Float64Array(frames);
  for (let f = 0; f < frames; f += 1) out[f] = buf.readInt32LE((f * channels + index) * 4) / 2147483648;
  return out;
};

const median = (values) => {
  const s = Array.from(values).sort((a, b) => a - b);
  return s.length ? s[s.length >> 1] : 0;
};

const detectOnsets = (samples) => {
  const count = Math.floor(samples.length / kWindowSamples);
  const env = new Float64Array(count);
  for (let w = 0; w < count; w += 1) {
    let acc = 0;
    const base = w * kWindowSamples;
    for (let i = 0; i < kWindowSamples; i += 1) acc += samples[base + i] * samples[base + i];
    env[w] = Math.sqrt(acc / kWindowSamples);
  }
  const floor = median(env.subarray(0, Math.min(kFloorWindows, count)));
  const threshold = Math.max(floor * 10 ** (kOnsetDb / 20), 1e-6);
  const onsets = [];
  let last = -kMinGapWindows;
  for (let w = 1; w < count; w += 1) {
    if (env[w] > threshold && env[w - 1] <= threshold && w - last >= kMinGapWindows) {
      onsets.push(w * kWindowSamples);
      last = w;
    }
  }
  return { floor, threshold, onsets };
};

const pressToBeep = (onsets, pressSample) => {
  const hit = onsets.find((s) => s >= pressSample);
  if (hit === undefined) return null;
  const latencyMs = ((hit - pressSample) / kRate) * 1000;
  return latencyMs <= kMaxLatencyMs ? { onsetSample: hit, latencyMs } : null;
};

const selfTest = () => {
  const checks = [];
  const check = (name, ok) => checks.push({ name, ok: !!ok });
  let seed = 12345;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const n = 8 * kRate;
  const x = new Float64Array(n);
  for (let i = 0; i < n; i += 1) x[i] = (rand() - 0.5) * 2e-4;
  const beeps = [{ press: 2.5, delayMs: 37.5 }, { press: 5.0, delayMs: 12.25 }];
  for (const b of beeps) {
    const start = Math.round((b.press * 1000 + b.delayMs) / 1000 * kRate);
    for (let i = 0; i < 0.1 * kRate && start + i < n; i += 1) x[start + i] += 0.2 * Math.sin(2 * Math.PI * 1000 * i / kRate);
  }
  const det = detectOnsets(x);
  check('detects the two synthetic beeps', det.onsets.length === 2);
  beeps.forEach((b, k) => {
    const hit = pressToBeep(det.onsets, Math.round(b.press * kRate));
    check('beep ' + (k + 1) + ' latency within 1.5 ms of ' + b.delayMs + ' ms', hit && Math.abs(hit.latencyMs - b.delayMs) <= 1.5);
  });
  const quiet = new Float64Array(n);
  for (let i = 0; i < n; i += 1) quiet[i] = (rand() - 0.5) * 2e-4;
  check('a noise-only channel yields no onsets', detectOnsets(quiet).onsets.length === 0);
  check('a press after the last beep finds none', pressToBeep(det.onsets, Math.round(7.9 * kRate)) === null);
  check('card state closed is free', isFree(parseState('closed')));
  check('card state RUNNING is busy', !isFree(parseState('state: RUNNING')));
  const failed = checks.filter((c) => !c.ok);
  checks.forEach((c) => console.log((c.ok ? 'PASS ' : 'FAIL ') + c.name));
  console.log('selftest: ' + checks.length + ' checks, ' + failed.length + ' failed');
  process.exitCode = failed.length ? 1 : 0;
};

const checkMode = async () => {
  const index = cardIndex(opts.card);
  const state = captureState(index);
  console.log(JSON.stringify({
    host: opts.host,
    card: opts.card,
    cardName: cardName(index),
    captureState: state,
    free: isFree(state),
    telemetry: await telemetryOrNull(),
  }, null, 2));
};

const waitFree = async (index, seconds) => {
  const until = Date.now() + seconds * 1000;
  let state = captureState(index);
  while (!isFree(state) && Date.now() < until) {
    await sleep(2000);
    state = captureState(index);
  }
  return state;
};

const runMode = async () => {
  if (!(opts.recordNote >= 0 && opts.recordNote <= 127)) throw new Error('--record-note N is required (the looper record pad note, 0..127); kApcBtnRec 0x5D is clip export and is not used');
  const index = cardIndex(opts.card);
  const state = await waitFree(index, opts.waitFree);
  if (!isFree(state)) throw new Error('card ' + opts.card + ' is busy (capture state: ' + state + '); not capturing');
  fs.mkdirSync(opts.outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const rawFile = path.join(opts.outDir, 'capture-' + stamp + '.raw');
  const seconds = (kPreRollMs + opts.loopSeconds * 1000 + kTailMs) / 1000;
  const before = await telemetryOrNull();
  const tSpawn = performance.now();
  const rec = spawn('arecord', ['-q', '-D', opts.card, '-t', 'raw', '-c', String(kChannels), '-f', 'S32_LE', '-r', String(kRate), '-d', String(Math.ceil(seconds)), rawFile], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  rec.stderr.on('data', (d) => { stderr += d; });
  const exited = new Promise((resolve, reject) => {
    rec.on('error', reject);
    rec.on('close', resolve);
  });
  await sleep(kPreRollMs);
  const pressTimes = [performance.now()];
  await sendBytes([0x90, opts.recordNote, 127]);
  await sleep(kReleaseMs);
  await sendBytes([0x90, opts.recordNote, 0]);
  await sleep(opts.loopSeconds * 1000 - kReleaseMs);
  pressTimes.push(performance.now());
  await sendBytes([0x90, opts.recordNote, 127]);
  await sleep(kReleaseMs);
  await sendBytes([0x90, opts.recordNote, 0]);
  const code = await exited;
  if (code !== 0) throw new Error('arecord exited ' + code + ': ' + stderr.trim());
  const after = await telemetryOrNull();
  const det = detectOnsets(readChannel(rawFile, kChannels, opts.beepCh));
  const presses = pressTimes.map((t, k) => {
    const sendSample = Math.round(((t - tSpawn) / 1000) * kRate);
    const beep = pressToBeep(det.onsets, sendSample);
    return { press: k + 1, sendSample, beepSample: beep ? beep.onsetSample : null, pressToBeepMs: beep ? beep.latencyMs : null };
  });
  const result = {
    host: opts.host,
    card: opts.card,
    beepCh: opts.beepCh,
    recordNote: opts.recordNote,
    loopSeconds: opts.loopSeconds,
    rawFile,
    floor: det.floor,
    threshold: det.threshold,
    onsetCount: det.onsets.length,
    presses,
    telemetryBefore: before,
    telemetryAfter: after,
    limits: [
      'press time is host performance.now() taken before the MIDI TCP connect; connect and write time is not subtracted',
      'the sample reference is the arecord spawn time; the spawn-to-first-frame delay is not calibrated',
      'onsets are found on 1 ms windows, so latency resolution is 1 ms',
      'telemetry lags by tens of ms, so the first-loop offset is a coarse cross-check only; the sample-exact offset must come from the capture',
    ],
  };
  const outFile = path.join(opts.outDir, 'press-latency-' + stamp + '.json');
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ outFile, onsetCount: det.onsets.length, presses }, null, 2));
};

const analyzeMode = () => {
  const bytes = fs.statSync(opts.analyze).size;
  const frames = Math.floor(bytes / (4 * kChannels));
  const samples = readChannel(opts.analyze, kChannels, opts.beepCh);
  let acc = 0;
  for (let i = 0; i < samples.length; i += 1) acc += samples[i] * samples[i];
  const det = detectOnsets(samples);
  const period = opts.periodSamples > 0 ? opts.periodSamples : 0;
  console.log(JSON.stringify({
    file: opts.analyze,
    bytes,
    frames,
    seconds: +(frames / kRate).toFixed(3),
    beepCh: opts.beepCh,
    rms: +Math.sqrt(acc / Math.max(1, frames)).toFixed(6),
    floor: det.floor,
    threshold: det.threshold,
    onsetCount: det.onsets.length,
    onsets: det.onsets.map((s) => ({
      ms: +((s / kRate) * 1000).toFixed(1),
      phaseMs: period ? +(((s % period) / kRate) * 1000).toFixed(1) : null,
    })),
  }, null, 2));
};

const main = async () => {
  if (opts.analyze) return analyzeMode();
  if (opts.mode === 'selftest') return selfTest();
  if (opts.mode === 'check') return checkMode();
  if (opts.mode === 'run') return runMode();
};

main().catch((e) => {
  console.error('press-latency: ' + e.message);
  process.exitCode = 2;
});
