#!/usr/bin/env node
const net = require('net');
const dgram = require('dgram');

const argv = process.argv.slice(2);
const keep = argv.includes('--keep');
const flags = argv.filter((a) => a.startsWith('--'));
const posArgs = argv.filter((a) => !a.startsWith('--'));
const [host, holdMsArg, noteArg, watchMsArg] = posArgs;
if (!host) {
  console.error('usage: node watch-take.js <host> [holdMs] [padNote] [watchMs] [--keep]');
  process.exit(2);
}
const holdMs = Number(holdMsArg || '2000');
const padNote = Number(noteArg || '2');
const watchMs = Number(watchMsArg || '20000');
const looper = padNote - 2;
const kSampleRate = 48000;
const kFineGridBeats = 0.125;
const kClearAllSettleMs = 1200;
const kPollMs = 100;
const kTrimSettleSkipMs = 6000;
const kMinPolls = 12;
const kRateTolerance = 5e-4;
const kSlipTolerance = 5e-5;
void flags;

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

const wrap = (v, len) => ((v % len) + len) % len;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function slopePerSecond(series) {
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const [x, y] of series) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
  const n = series.length;
  const denom = n * sxx - sx * sx;
  return denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
}

function deriveTempoQuantBeats(seconds, anchorBpm) {
  const anchor = anchorBpm > 1 ? anchorBpm : 120;
  const candidates = [1, 2, 4, 8, 16, 32, 64, 128];
  let best = 16;
  let bestScore = Infinity;
  let bestInWindow = false;
  for (const beats of candidates) {
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

function nearestNodeSamples(masterPhaseSamples, masterLenSamples, cell) {
  const cellOffset = wrap(masterPhaseSamples, cell);
  const shift = cellOffset > cell * 0.5 ? cell - cellOffset : -cellOffset;
  return wrap(masterPhaseSamples + shift, Math.max(1, masterLenSamples));
}

async function main() {
  console.log(`[watch-take] target=${host} looper${looper} hold=${holdMs}ms watch=${watchMs}ms${keep ? ' (keeping existing content)' : ''}`);
  if (!keep) {
    await pressPad(0x5b);
    await releasePad(0x5b);
    await sleep(kClearAllSettleMs);
  }

  const base = await queryTelemetry();
  console.log(`[watch-take] session ${base.link.bpm.toFixed(2)} bpm peers=${base.link.peers} eff=${base.eff_speed.toFixed(4)} bias=${base.latency_bias_samples.toFixed(1)}`);

  const armPress = Date.now();
  await pressPad(padNote);
  await releasePad(padNote);
  const arm = await queryTelemetry();
  const armPhaseBeats = arm.master_phase_beats;
  const armWriteIdx = arm.loopers.writeidx[looper];
  const writeIdxAfterArmReset = 0;
  const looperHadContentBeforeArm = ((base.loopers.play >> looper) & 1) === 1;
  console.log(`[watch-take] ARM: grid beat ${armPhaseBeats.toFixed(3)}, writeidx ${armWriteIdx.toFixed(0)}`);

  const holdStart = Date.now();
  while (Date.now() - holdStart < holdMs) {
    await queryTelemetry();
    await sleep(kPollMs);
  }
  const holdActualMs = Date.now() - armPress;
  await pressPad(padNote);
  await releasePad(padNote);
  const postFinish = await queryTelemetry();
  const writeIdxAtFinish = postFinish.loopers.writeidx[looper];
  const takeSamples = writeIdxAtFinish - writeIdxAfterArmReset;
  console.log(`[watch-take] FINISH after ${holdActualMs}ms; write index ${writeIdxAtFinish.toFixed(0)} having started at ${writeIdxAfterArmReset.toFixed(0)} -> the take wrote ${takeSamples.toFixed(0)} samples`);

  const samples = [];
  const watchStart = Date.now();
  let lastWlen = -1;
  let wlen = 0;
  while (Date.now() - watchStart < watchMs) {
    const t = await queryTelemetry();
    const w = t.loopers.wraplen[looper];
    if (w === lastWlen) wlen = w;
    lastWlen = w;
    samples.push({
      ms: Date.now() - watchStart,
      readpos: t.loopers.readpos[looper],
      masterPhase: t.master_phase_beats,
      eff: t.eff_speed,
      bpm: t.link.bpm,
      bias: t.latency_bias_samples,
      masterWlen: t.loopers.wraplen[0],
    });
    await sleep(kPollMs);
  }

  if (!wlen) {
    console.log('[watch-take] FAIL: no take landed');
    process.exit(1);
  }
  const last = samples[samples.length - 1];
  const bias = last.bias;
  const looper0Playing = ((base.loopers.play >> 0) & 1) === 1;
  const masterLenSamples = (looper === 0 || !looper0Playing) ? wlen : last.masterWlen;
  const anchorBpm = 120;
  const beats = deriveTempoQuantBeats(masterLenSamples / kSampleRate, anchorBpm);
  const beatLenSamples = masterLenSamples / beats;
  const cellSamples = beatLenSamples * kFineGridBeats;
  const lengthVsTake = wlen / takeSamples;

  console.log(`[watch-take] wraplen ${wlen.toFixed(0)} samples (${(wlen / kSampleRate * 1000).toFixed(0)}ms) vs take ${takeSamples.toFixed(0)} -> ${lengthVsTake.toFixed(4)}x`);
  console.log(`[watch-take] master ${masterLenSamples.toFixed(0)} samples = ${beats} beats -> beat ${beatLenSamples.toFixed(1)} samples, grid cell ${cellSamples.toFixed(1)}`);
  console.log(`[watch-take] after the take: ${last.bpm.toFixed(2)} bpm eff ${last.eff.toFixed(4)}`);

  const gridExisted = base.loopers.play !== 0;
  const armPhaseSamples = armPhaseBeats * beatLenSamples - armWriteIdx * arm.eff_speed;
  console.log(`[watch-take] ARM phase ${armPhaseBeats.toFixed(3)} beats -> ${(armPhaseSamples / beatLenSamples).toFixed(3)} at the arm edge (${(armWriteIdx / kSampleRate * 1000).toFixed(0)}ms of take already written)`);
  const rsmExpected = nearestNodeSamples(armPhaseSamples, masterLenSamples, cellSamples);
  const expectedDownbeatSamples = wrap(rsmExpected - bias, wlen);

  let minL = Infinity;
  let maxL = -Infinity;
  let sumL = 0;
  let n = 0;
  let wraps = 0;
  let firstRead = null;
  let firstMs = 0;
  let lastMs = 0;
  let prevRead = null;
  let prevGrid = null;
  let masterWraps = 0;
  let readOff = 0;
  let gridOff = 0;
  const readSeries = [];
  const gridSeries = [];
  const readAgainstGridPerPoll = [];
  for (const s of samples) {
    const grid = s.masterPhase * beatLenSamples;
    if (s.ms < kTrimSettleSkipMs) { prevRead = s.readpos; prevGrid = grid; continue; }
    if (firstRead === null) {
      firstRead = s.readpos;
      firstMs = s.ms;
    } else {
      if (s.readpos < prevRead - wlen * 0.5) { wraps++; readOff += wlen; }
      if (grid < prevGrid - masterLenSamples * 0.5) { masterWraps++; gridOff += masterLenSamples; }
      else if (grid > prevGrid + masterLenSamples * 0.5) { masterWraps--; gridOff -= masterLenSamples; }
    }
    prevRead = s.readpos;
    prevGrid = grid;
    lastMs = s.ms;
    readSeries.push([(s.ms - firstMs) / 1000, s.readpos + readOff - firstRead]);
    gridSeries.push([(s.ms - firstMs) / 1000, grid + gridOff]);
    readAgainstGridPerPoll.push([grid + gridOff, s.readpos + readOff - firstRead]);
    const L = wrap(grid + masterWraps * masterLenSamples - s.readpos, wlen);
    minL = Math.min(minL, L);
    maxL = Math.max(maxL, L);
    sumL += L;
    n++;
  }
  const meanL = n ? sumL / n : 0;
  if (n < kMinPolls) {
    console.error(`[watch-take] FAIL: only ${n} polls left after skipping ${kTrimSettleSkipMs}ms of grid settling -- pass a watchMs above 12000`);
    process.exit(1);
  }
  const offFromExpected = wrap(meanL - expectedDownbeatSamples + wlen * 0.5, wlen) - wlen * 0.5;
  const elapsedSec = (lastMs - firstMs) / 1000;
  const readRate = slopePerSecond(readSeries) / kSampleRate;
  const gridRate = slopePerSecond(gridSeries) / kSampleRate;
  const gridSlip = slopePerSecond(readAgainstGridPerPoll);

  console.log(`[watch-take] downbeat at ${(meanL / beatLenSamples).toFixed(4)} beats into the loop (spread ${(maxL - minL).toFixed(1)} samples)`);
  console.log(`[watch-take] ARM anchor expects the downbeat at ${(expectedDownbeatSamples / beatLenSamples).toFixed(4)} beats`);
  console.log(`[watch-take] phrase offset: ${offFromExpected.toFixed(1)} samples (${(offFromExpected / kSampleRate * 1000).toFixed(2)}ms, ${(offFromExpected / cellSamples).toFixed(3)} cells)`);
  console.log(`[watch-take] read rate ${readRate.toFixed(7)} (${(1200 * Math.log2(readRate)).toFixed(3)} cents), ${wraps} wraps in ${elapsedSec.toFixed(1)}s over ${readSeries.length} polls`);
  console.log(`[watch-take] grid rate ${gridRate.toFixed(7)} (${(1200 * Math.log2(gridRate)).toFixed(3)} cents), read/grid slip ${gridSlip.toFixed(7)}`);

  let failed = 0;
  const fail = (msg) => { console.log(`[watch-take]   FAIL: ${msg}`); failed++; };
  if (looperHadContentBeforeArm) {
    fail(`looper${looper} was still playing ${base.loopers.wraplen[looper]} samples at ARM -- not a clean slate`);
  }
  const gridRatioOct = Math.log2(wlen / masterLenSamples);
  if (Math.abs(gridRatioOct - Math.round(gridRatioOct)) > 0.02) {
    fail(`the take came back ${(wlen / masterLenSamples).toFixed(4)}x the master phrase -- not a whole number of grid tiers`);
  }
  if (lengthVsTake < 0.5 || lengthVsTake > 2.0) {
    fail(`the take came back ${lengthVsTake.toFixed(4)}x the length it recorded`);
  }
  if (gridExisted) {
    if (Math.abs(offFromExpected / cellSamples) > 0.5) {
      fail(`the loop downbeat sits ${(offFromExpected / cellSamples).toFixed(2)} grid cells from the ARM anchor`);
    }
  } else {
    console.log('[watch-take]   note: no grid at ARM (first take) -- the take defines the grid, anchor unchecked');
  }
  if (maxL - minL > cellSamples) {
    fail(`the downbeat wandered ${(maxL - minL).toFixed(1)} samples against the master grid`);
  }
  if (Math.abs(readRate - 1.0) > kRateTolerance) {
    fail(`the loop runs at ${readRate.toFixed(7)} of natural speed -- it resamples`);
  }
  if (Math.abs(gridSlip - 1.0) > kSlipTolerance) {
    fail(`the read head slips ${((gridSlip - 1.0) * wlen).toFixed(1)} samples per repeat against the master grid`);
  }

  console.log(`[watch-take] ${failed === 0 ? 'PASS' : `FAIL (${failed})`}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[watch-take] error:', err.message);
  process.exit(1);
});
