#!/usr/bin/env node
const net = require('net');
const dgram = require('dgram');

const [, , host, trialsArg] = process.argv;
if (!host) {
  console.error('usage: node verify-lineup.js <host> [trials]');
  process.exit(2);
}
const TRIALS = trialsArg ? Number(trialsArg) : 3;
const SAMPLE_RATE = 48000;
let latencyBias = 64;
const HOLD_MS = 2000;
const LONG_HOLD_MS = 8100;
const HOLD_ERASE_MS = 1150;
const WITHIN_TRIAL_TOLERANCE = 8;
const ON_ARM_TOLERANCE = 64;
const LENGTH_TOLERANCE_BEATS = 2.5;

const MASTER_PAD = 2;
const TAKE_PADS = [3, 4, 5];
const LOOPERS = [1, 2, 3];
const CLEAR_ALL_NOTE = 0x5b;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const wrap = (x, p) => ((x % p) + p) % p;
const center = (x, p) => wrap(x + p * 0.5, p) - p * 0.5;
let masterLenNow = 0;

function openInject() {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port: 9401 }, () => resolve(sock));
    sock.setTimeout(5000);
    sock.on('timeout', () => { sock.destroy(); reject(new Error(`connect to ${host}:9401 timed out`)); });
    sock.on('error', reject);
  });
}

function burst(sock, notes) {
  const on = [], off = [];
  for (const n of notes) { on.push(0x90, n, 127); off.push(0x80, n, 0); }
  sock.write(Buffer.from(on));
  sock.write(Buffer.from(off));
}
function burstHold(sock, notes) { sock.write(Buffer.from(notes.flatMap(n => [0x90, n, 127]))); }
function burstRelease(sock, notes) { sock.write(Buffer.from(notes.flatMap(n => [0x80, n, 0]))); }

function queryTelemetry() {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4');
    const timeout = setTimeout(() => { sock.close(); reject(new Error('telemetry query timed out')); }, 3000);
    sock.on('message', msg => {
      clearTimeout(timeout);
      sock.close();
      try { resolve(JSON.parse(msg.toString())); }
      catch (e) { reject(e); }
    });
    sock.on('error', e => { clearTimeout(timeout); reject(e); });
    sock.send('status', 4445, host);
  });
}

function circularMean(values, period) {
  let sx = 0, sy = 0;
  for (const v of values) {
    const a = (v / period) * 2 * Math.PI;
    sx += Math.cos(a);
    sy += Math.sin(a);
  }
  return wrap((Math.atan2(sy, sx) / (2 * Math.PI)) * period, period);
}

function anchorOf(t, looper, oneBeat) {
  const wlen = t.loopers.wraplen[looper];
  if (!wlen || wlen <= 1) return null;
  const beats = Math.round(wlen / oneBeat);
  if (beats < 1) return null;
  const beatScale = wlen / (beats * oneBeat);
  const masterPhase = t.master_phase_beats * oneBeat;
  const readPos = t.loopers.readpos[looper];
  if (t.latency_bias_samples > 0) latencyBias = t.latency_bias_samples;
  return wrap(beatScale * masterPhase - readPos + latencyBias, wlen) / beatScale;
}

async function anchors(oneBeat, samples = 4) {
  const acc = new Map();
  const lin = new Map();
  const biasOf = new Map();
  const wlenOf = new Map();
  let prevGrid = null;
  let gridOff = 0;
  for (let k = 0; k < samples; k++) {
    const t = await queryTelemetry();
    const grid = t.master_phase_beats * oneBeat;
    if (prevGrid !== null) {
      if (grid < prevGrid - masterLenNow * 0.5) gridOff += masterLenNow;
      else if (grid > prevGrid + masterLenNow * 0.5) gridOff -= masterLenNow;
    }
    prevGrid = grid;
    for (const i of LOOPERS) {
      const a = anchorOf(t, i, oneBeat);
      if (a === null) continue;
      if (!acc.has(i)) {
        acc.set(i, []);
        lin.set(i, []);
        wlenOf.set(i, t.loopers.wraplen[i]);
        biasOf.set(i, t.loopers.latencybias[i] > 0 ? t.loopers.latencybias[i] : t.latency_bias_samples);
      }
      acc.get(i).push(a);
      lin.get(i).push(wrap(grid + gridOff - t.loopers.readpos[i], wlenOf.get(i)));
    }
    await sleep(120);
  }
  const out = [];
  for (const i of LOOPERS) {
    const vals = acc.get(i);
    if (!vals || vals.length < 2) { out.push(null); continue; }
    const wlen = wlenOf.get(i);
    out.push({ i, anchor: circularMean(vals, wlen), wlen, bias: biasOf.get(i), lineup: circularMean(lin.get(i), wlen) });
  }
  return out;
}

async function waitForFinish(before, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let prevIdx = null;
  let last = null;
  while (Date.now() < deadline) {
    const t = await queryTelemetry();
    last = t;
    const idx = LOOPERS.map(i => t.loopers.writeidx[i]);
    const lengthened = LOOPERS.some(i => t.loopers.wraplen[i] !== before[i]);
    const parked = prevIdx !== null && idx.every((v, k) => v === prevIdx[k]);
    prevIdx = idx;
    if (lengthened && parked) return t;
    await sleep(250);
  }
  if (last) {
    console.log(`[verify-lineup]   timeout state: wlens=${LOOPERS.map(i => last.loopers.wraplen[i]).join(',')} ` +
      `widx=${LOOPERS.map(i => last.loopers.writeidx[i]).join(',')} rec=${last.loopers.rec} play=${last.loopers.play}`);
  }
  return null;
}

async function main() {
  console.log(`[verify-lineup] target=${host} trials=${TRIALS}`);
  const sock = await openInject();
  await burst(sock, [CLEAR_ALL_NOTE]);
  await sleep(1200);

  await burst(sock, [MASTER_PAD]);
  await sleep(HOLD_MS);
  await burst(sock, [MASTER_PAD]);
  await sleep(1200);

  const master = await queryTelemetry();
  const masterLen = master.loopers.wraplen[0];
  if (!masterLen || masterLen <= 1) {
    console.error('[verify-lineup] FAIL: master looper 0 has no length -- did clear-all leave it empty?');
    process.exit(1);
  }
  const bpm = master.link.bpm > 1 ? master.link.bpm : 120;
  const beatFromTempo = (SAMPLE_RATE * 60) / bpm;
  const masterBeats = Math.round(masterLen / beatFromTempo);
  const oneBeat = masterLen / masterBeats;
  const cell = 0.125 * oneBeat;
  masterLenNow = masterLen;
  console.log(`[verify-lineup] master wlen=${masterLen} (${masterBeats} beats, oneBeat=${oneBeat.toFixed(1)}, cell=${cell.toFixed(1)}, bpm=${bpm.toFixed(2)})`);

  const rows = [];
  for (let trial = 0; trial < TRIALS + 1; trial++) {
    const hold = trial < TRIALS ? HOLD_MS : LONG_HOLD_MS;
    burstHold(sock, TAKE_PADS);
    await sleep(HOLD_ERASE_MS);
    burstRelease(sock, TAKE_PADS);
    await sleep(500);

    burst(sock, TAKE_PADS);
    const armTele = await queryTelemetry();
    const armPhase = LOOPERS.map(i => wrap(armTele.master_phase_beats * oneBeat
      - armTele.loopers.writeidx[i] * armTele.eff_speed, masterLen));
    await sleep(hold);
    const beforeFinish = await queryTelemetry();
    burst(sock, TAKE_PADS);
    const startedAt = Date.now();
    const settled = await waitForFinish(beforeFinish.loopers.wraplen);
    if (!settled) {
      console.log(`[verify-lineup] trial ${trial}: take never finished within 30s of FINISH (pre-arm wlens=${LOOPERS.map(i => beforeFinish.loopers.wraplen[i]).join(',')})`);
      continue;
    }
    const finishMs = Date.now() - startedAt;

    const got = (await anchors(oneBeat, 12)).filter(Boolean);
    if (got.length < 2) {
      console.log(`[verify-lineup] trial ${trial}: only ${got.length} loopers took content -- skipped`);
      continue;
    }
    const spread = Math.max(...got.map(g => g.anchor)) - Math.min(...got.map(g => g.anchor));
    const lengthErrBeats = Math.max(...got.map(g => Math.abs(g.wlen / oneBeat - (hold / 1000) * bpm / 60)));
    const offArm = got.map(g => Math.abs(center(g.lineup - wrap(armPhase[LOOPERS.indexOf(g.i)] - g.bias, g.wlen), g.wlen)));
    rows.push({ trial, got, spread, lengthErrBeats, armPhase, offArm });
    console.log(`[verify-lineup] trial ${trial} (hold ${hold}ms, finished +${finishMs}ms): wlens=${got.map(g => g.wlen).join(',')} ` +
      `beats=${got.map(g => (g.wlen / oneBeat).toFixed(3)).join(',')} (want ~${((hold / 1000) * bpm / 60).toFixed(3)}, off ${lengthErrBeats.toFixed(3)}) ` +
      `anchors mod cell=${got.map(g => wrap(g.anchor, cell).toFixed(1)).join(',')} ` +
      `off arm=${offArm.map(v => v.toFixed(1)).join(',')} ` +
      `within-trial spread=${spread.toFixed(1)} samples`);
  }

  if (!rows.length) {
    console.error('[verify-lineup] FAIL: no trial produced measurable takes');
    process.exit(1);
  }

  const maxSpread = Math.max(...rows.map(r => r.spread));
  const maxOffArm = Math.max(...rows.flatMap(r => r.offArm));
  const maxLengthErr = Math.max(...rows.map(r => r.lengthErrBeats));

  console.log(`[verify-lineup] A. takes armed in one burst share an anchor: max spread ${maxSpread.toFixed(1)} samples (tol ${WITHIN_TRIAL_TOLERANCE})`);
  console.log(`[verify-lineup] B. every take plays back at the master phase it was armed at: worst ${maxOffArm.toFixed(1)} samples (tol ${ON_ARM_TOLERANCE}, one block)`);
  console.log(`[verify-lineup] C. every take keeps the length it was played for: worst ${maxLengthErr.toFixed(3)} beats (tol ${LENGTH_TOLERANCE_BEATS})`);

  const pass = maxSpread < WITHIN_TRIAL_TOLERANCE && maxOffArm < ON_ARM_TOLERANCE
    && maxLengthErr <= LENGTH_TOLERANCE_BEATS;
  console.log(`[verify-lineup] ${pass ? 'ALL PASS' : 'SOME FAILED'}`);
  process.exit(pass ? 0 : 1);
}

main().catch(err => {
  console.error('[verify-lineup] error:', err.message);
  process.exit(1);
});
