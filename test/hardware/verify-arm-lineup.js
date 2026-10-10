#!/usr/bin/env node
'use strict';
const net = require('net');
const dgram = require('dgram');
const { despikedSpread } = require('./lib/gridlock');

const [, , host, holdMsArg, watchMsArg, trialsArg] = process.argv;
if (!host) {
  console.error('usage: node verify-arm-lineup.js <host> [holdMs] [watchMs] [trials]');
  process.exit(2);
}
const holdMs = Number(holdMsArg || '2000');
const watchMs = Number(watchMsArg || '20000');
const trials = Number(trialsArg || '6');
const kSampleRate = 48000;
const kFineGridBeats = 0.125;
const kToleranceSamples = 16;
const kTearSamples = 16;
const kClearAllSettleMs = 1200;
const kPollMs = 150;
const kTrimSettleSkipMs = 6000;
const kMinPolls = 12;
const kStaggerMs = [0, 37, 74, 111, 148, 185, 222, 259];
const kMasterPad = 2;
const kTakePads = [3, 4, 5, 10, 11, 12, 13, 18];
const kClearAllNote = 0x5b;
const kAnchorBpm = 120;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wrap = (v, len) => ((v % len) + len) % len;
const center = (v, len) => wrap(v + len * 0.5, len) - len * 0.5;

function padLooper(note) {
  const row = Math.floor(note / 8);
  const col = note % 8;
  if (col < 2 || col > 5) return -1;
  return row * 4 + (col - 2);
}

function sendBytes(bytes) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port: 9401 }, () => {
      sock.write(Buffer.from(bytes), (err) => {
        if (err) return reject(err);
        sock.end();
      });
    });
    sock.setTimeout(5000);
    sock.on('timeout', () => { sock.destroy(); reject(new Error(`connect/write to ${host}:9401 timed out`)); });
    sock.on('close', resolve);
    sock.on('error', reject);
  });
}

const pressPad = (note) => sendBytes([0x90, note, 127]);
const releasePad = (note) => sendBytes([0x80, note, 0]);

function queryTelemetry() {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4');
    const timer = setTimeout(() => { sock.close(); reject(new Error('telemetry query timed out')); }, 3000);
    sock.on('message', (msg) => {
      clearTimeout(timer);
      sock.close();
      try { resolve(JSON.parse(msg.toString())); }
      catch (e) { reject(e); }
    });
    sock.on('error', (e) => { clearTimeout(timer); reject(e); });
    sock.send('status', 4445, host);
  });
}

function slopePerSecond(series) {
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const [x, y] of series) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
  const n = series.length;
  const denom = n * sxx - sx * sx;
  return denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
}

function deriveTempoQuantBeats(seconds, anchorBpm) {
  const anchor = anchorBpm > 1 ? anchorBpm : 120;
  let best = 16;
  let bestScore = Infinity;
  let bestInWindow = false;
  for (let beats = 1; beats <= 128; beats += 1) {
    const bpm = (60 * beats) / seconds;
    const inWindow = bpm >= anchor * 0.5 && bpm <= anchor * 2;
    const score = Math.abs(Math.log2(bpm / anchor));
    if ((inWindow && !bestInWindow) || (inWindow === bestInWindow && score < bestScore)) {
      best = beats;
      bestScore = score;
      bestInWindow = inWindow;
    }
  }
  return best;
}

function nearestNodeSamples(phase, masterLen, cell) {
  const off = wrap(phase, cell);
  const shift = off > cell * 0.5 ? cell - off : -off;
  return wrap(phase + shift, Math.max(1, masterLen));
}

function circularMean(values, period) {
  let sx = 0;
  let sy = 0;
  for (const v of values) {
    const a = (v / period) * 2 * Math.PI;
    sx += Math.cos(a);
    sy += Math.sin(a);
  }
  return wrap((Math.atan2(sy, sx) / (2 * Math.PI)) * period, period);
}

function despikeCentered(devs, tear) {
  const kept = [];
  let dropped = 0;
  for (let i = 0; i < devs.length; i++) {
    const near = [devs[i - 2], devs[i - 1], devs[i + 1], devs[i + 2]].filter((v) => v !== undefined);
    const isolated = near.length >= 2 && near.every((v) => Math.abs(devs[i] - v) > tear);
    if (isolated) dropped++;
    else kept.push(devs[i]);
  }
  return { kept, dropped };
}

async function pressRelease(note) {
  await pressPad(note);
  await releasePad(note);
}

async function settleWrapLen(looper, maxMs) {
  const start = Date.now();
  let last = null;
  let stable = 0;
  while (Date.now() - start < maxMs) {
    const t = await queryTelemetry();
    const w = t.loopers.wraplen[looper];
    if (w > 1 && w === last) {
      stable++;
      if (stable >= 3) return t;
    } else {
      stable = 0;
    }
    last = w;
    await sleep(150);
  }
  return queryTelemetry();
}

async function watchTake(looper, wlen, beatLen, masterLen) {
  await sleep(kTrimSettleSkipMs);
  const start = Date.now();
  const raw = [];
  const readSeries = [];
  const gridSeries = [];
  const readVsGrid = [];
  let prevRead = null;
  let prevGrid = null;
  let readOff = 0;
  let gridOff = 0;
  let firstRead = null;
  let firstMs = 0;
  let lastMs = 0;
  let last = null;
  while (Date.now() - start < watchMs) {
    const t = await queryTelemetry();
    last = t;
    const grid = t.master_phase_beats * beatLen;
    const read = t.loopers.readpos[looper];
    if (prevRead === null) {
      firstRead = read;
      firstMs = Date.now() - start;
    } else {
      if (read < prevRead - wlen * 0.5) readOff += wlen;
      else if (read > prevRead + wlen * 0.5) readOff -= wlen;
      if (grid < prevGrid - masterLen * 0.5) gridOff += masterLen;
      else if (grid > prevGrid + masterLen * 0.5) gridOff -= masterLen;
    }
    prevRead = read;
    prevGrid = grid;
    lastMs = Date.now() - start;
    raw.push(wrap(grid + gridOff - read, wlen));
    readSeries.push([(lastMs - firstMs) / 1000, read + readOff - firstRead]);
    gridSeries.push([(lastMs - firstMs) / 1000, grid + gridOff]);
    readVsGrid.push([grid + gridOff, read + readOff - firstRead]);
    await sleep(kPollMs);
  }
  let downbeat = circularMean(raw, wlen);
  let dropped = 0;
  let devs = raw.map((v) => center(v - downbeat, wlen));
  for (let pass = 0; pass < 2; pass++) {
    const d = despikeCentered(devs, kTearSamples);
    dropped = d.dropped;
    if (!d.kept.length) break;
    downbeat = wrap(downbeat + circularMean(d.kept.map((v) => v + wlen), wlen), wlen);
    devs = raw.map((v) => center(v - downbeat, wlen));
  }
  const spread = despikedSpread(devs, kToleranceSamples);
  const elapsed = (lastMs - firstMs) / 1000;
  const readRate = slopePerSecond(readSeries) / kSampleRate;
  const gridRate = slopePerSecond(gridSeries) / kSampleRate;
  const slip = slopePerSecond(readVsGrid);
  const bias = last.loopers.latencybias[looper] > 0 ? last.loopers.latencybias[looper] : last.latency_bias_samples;
  return { downbeat, spread, dropped, polls: raw.length, elapsed, readRate, gridRate, slip, bias };
}

async function main() {
  console.log(`[arm-lineup] target=${host} hold=${holdMs}ms watch=${watchMs}ms trials=${trials}`);
  await pressRelease(kClearAllNote);
  await sleep(kClearAllSettleMs);

  await pressRelease(kMasterPad);
  await sleep(holdMs);
  await pressRelease(kMasterPad);
  const master = await settleWrapLen(0, 12000);
  const masterLen = master.master_len_samples > 0 ? master.master_len_samples : master.loopers.wraplen[0];
  if (!masterLen || masterLen <= 1) {
    console.log('[arm-lineup] FAIL: no master take landed');
    process.exit(1);
  }
  const masterBeats = deriveTempoQuantBeats(masterLen / kSampleRate, kAnchorBpm);
  const beatLen = masterLen / masterBeats;
  const cell = beatLen * kFineGridBeats;
  console.log(`[arm-lineup] master ${masterLen.toFixed(0)} smp = ${masterBeats} beats -> beat ${beatLen.toFixed(1)}, 1/8 cell ${cell.toFixed(1)} smp (${(cell / kSampleRate * 1000).toFixed(1)}ms)`);
  console.log(`[arm-lineup] telemetry recorded_beats=${master.recorded_beats}, groove beat ${master.groove.beat_len_samples.toFixed(1)}, eff ${master.eff_speed.toFixed(5)}, peers ${master.link.peers}`);

  const rows = [];
  for (let trial = 0; trial < trials; trial++) {
    const pad = kTakePads[trial % kTakePads.length];
    const looper = padLooper(pad);
    await sleep(kStaggerMs[trial % kStaggerMs.length]);
    await pressRelease(pad);
    const arm = await queryTelemetry();
    const armPhaseSamples = wrap(arm.master_phase_beats * beatLen - arm.loopers.writeidx[looper] * arm.eff_speed, masterLen);
    const nodePhaseSamples = nearestNodeSamples(armPhaseSamples, masterLen, cell);
    await sleep(Math.max(0, holdMs - 250));
    await pressRelease(pad);
    const settled = await settleWrapLen(looper, 12000);
    const wlen = settled.loopers.wraplen[looper];
    if (!wlen || wlen <= 1) {
      console.log(`[arm-lineup] trial ${trial}: looper${looper} never took content -- skipped`);
      continue;
    }
    const watch = await watchTake(looper, wlen, beatLen, masterLen);
    if (watch.polls < kMinPolls) {
      console.log(`[arm-lineup] trial ${trial}: only ${watch.polls} polls -- skipped`);
      continue;
    }
    const errMaterial = center(watch.downbeat - wrap(armPhaseSamples - watch.bias, wlen), wlen);
    const errGrid = center(watch.downbeat - wrap(nodePhaseSamples - watch.bias, wlen), wlen);
    const ratioOct = Math.log2(wlen / masterLen);
    rows.push({ trial, looper, armPhaseSamples, nodePhaseSamples, wlen, errMaterial, errGrid, watch, ratioOct });
    console.log(`[arm-lineup] trial ${trial} looper${looper}: arm ${(armPhaseSamples / beatLen).toFixed(4)} beats (${(wrap(armPhaseSamples, cell) / cell).toFixed(3)} into cell), node ${(nodePhaseSamples / beatLen).toFixed(4)}, wlen ${wlen}, bias ${watch.bias.toFixed(1)}`);
    console.log(`[arm-lineup]   downbeat ${(watch.downbeat / beatLen).toFixed(4)} beats | off MATERIAL ${errMaterial.toFixed(1)} smp (${(errMaterial / kSampleRate * 1000).toFixed(2)}ms, ${(errMaterial / cell).toFixed(3)} cells) | off GRID ${errGrid.toFixed(1)} smp (${(errGrid / cell).toFixed(3)} cells)`);
    console.log(`[arm-lineup]   spread ${watch.spread.spread.toFixed(1)} smp over ${watch.elapsed.toFixed(1)}s, ${watch.dropped} torn dropped, rate ${watch.readRate.toFixed(7)} grid ${watch.gridRate.toFixed(7)} slip ${watch.slip.toFixed(7)}`);
  }

  if (!rows.length) {
    console.log('[arm-lineup] FAIL: no trial produced a measurable take');
    process.exit(1);
  }
  const absMat = rows.map((r) => Math.abs(r.errMaterial));
  const absGrid = rows.map((r) => Math.abs(r.errGrid));
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const maxMaterial = Math.max(...absMat);
  const meanMaterial = mean(absMat);
  const maxGrid = Math.max(...absGrid);
  const meanGrid = mean(absGrid);
  const maxSpread = Math.max(...rows.map((r) => r.watch.spread.spread));
  const maxSlip = Math.max(...rows.map((r) => Math.abs(r.watch.slip - 1.0)));
  const badRatio = rows.filter((r) => Math.abs(r.ratioOct - Math.round(r.ratioOct)) > 0.02).length;

  console.log(`[arm-lineup] A. plays where captured: max ${maxMaterial.toFixed(1)} smp / ${(maxMaterial / kSampleRate * 1000).toFixed(2)}ms, mean ${meanMaterial.toFixed(1)} smp / ${(meanMaterial / kSampleRate * 1000).toFixed(2)}ms (tol ${kToleranceSamples})`);
  console.log(`[arm-lineup] B. plays on 1/8 grid node: max ${maxGrid.toFixed(1)} smp / ${(maxGrid / kSampleRate * 1000).toFixed(2)}ms, mean ${meanGrid.toFixed(1)} smp / ${(meanGrid / kSampleRate * 1000).toFixed(2)}ms`);
  console.log(`[arm-lineup] C. downbeat stability: worst spread ${maxSpread.toFixed(1)} smp, worst slip ${maxSlip.toFixed(7)}, non-power-of-2 lengths ${badRatio}`);

  let failed = 0;
  const fail = (m) => { console.log(`[arm-lineup]   FAIL: ${m}`); failed++; };
  if (maxMaterial > kToleranceSamples) fail(`the take returns ${maxMaterial.toFixed(1)} samples from where it was captured`);
  if (maxSpread > kToleranceSamples) fail(`the downbeat wandered ${maxSpread.toFixed(1)} samples`);
  if (maxSlip > 5e-5) fail(`the read head slips ${maxSlip.toFixed(7)} against the master grid`);
  if (badRatio > 0) fail(`${badRatio} takes came back a non-power-of-2 length against the master`);

  console.log(`[arm-lineup] ${failed === 0 ? 'PASS' : `FAIL (${failed})`}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[arm-lineup] error:', err.message);
  process.exit(1);
});
