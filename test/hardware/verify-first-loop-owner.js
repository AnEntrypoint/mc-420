#!/usr/bin/env node
const net = require('net');
const dgram = require('dgram');

const [, , host, holdMsArg] = process.argv;
if (!host) {
  console.error('usage: node verify-first-loop-owner.js <host> [holdMs]');
  process.exit(2);
}
const holdMs = Number(holdMsArg || '2000');
const kSampleRate = 48000;
const kTrimSettleMs = 6000;
const kWatchMs = 20000;
const kPollMs = 150;
const kLockToleranceSamples = 64;
const kRateTolerance = 5e-4;
const kLockRateTolerance = 5e-5;
const kClearAllSettleMs = 1200;

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

function deriveTempoQuantBeats(recordedSeconds, anchorBpm) {
  const anchor = (anchorBpm > 1) ? anchorBpm : 120;
  const candidates = [1, 2, 4, 8, 16, 32, 64, 128];
  let best = 16, bestScore = Infinity, bestInWindow = false;
  for (const beats of candidates) {
    const bpm = (60 * beats) / recordedSeconds;
    const inWindow = bpm >= anchor * 0.5 && bpm <= anchor * 2;
    const score = Math.abs(Math.log2(bpm / anchor));
    if ((inWindow && !bestInWindow) || (inWindow === bestInWindow && score < bestScore)) {
      best = beats; bestScore = score; bestInWindow = inWindow;
    }
  }
  return best;
}

async function settleWrapLen(looperIndex, maxMs) {
  let last = null, stableCount = 0;
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const t = await queryTelemetry();
    const w = t.loopers.wraplen[looperIndex];
    if (w === last) {
      stableCount++;
      if (stableCount >= 3) return t;
    } else {
      stableCount = 0;
    }
    last = w;
    await new Promise((r) => setTimeout(r, 150));
  }
  return queryTelemetry();
}

async function watchPlayback(wrapLen, beatLenSamples, beatsPerCycle) {
  await new Promise((r) => setTimeout(r, kTrimSettleMs));
  const first = await queryTelemetry();
  const loopStart = Date.now();
  const firstRead = first.loopers.readpos[0];
  const firstMaster = first.master_phase_beats;
  let prevRead = firstRead;
  let prevMaster = firstMaster;
  let readOffset = 0;
  let masterOffset = 0;
  let readWraps = 0;
  let masterWraps = 0;
  let firstLock = null;
  let lockMin = Infinity;
  let lockMax = -Infinity;
  const readSeries = [[0, 0]];
  const masterSeries = [[0, 0]];
  while (Date.now() - loopStart < kWatchMs) {
    const t = await queryTelemetry();
    const at = (Date.now() - loopStart) / 1000;
    const read = t.loopers.readpos[0];
    const master = t.master_phase_beats;
    if (read < prevRead - wrapLen * 0.5) { readWraps++; readOffset += wrapLen; }
    if (master < prevMaster - beatsPerCycle * 0.5) { masterWraps++; masterOffset += beatsPerCycle; }
    prevRead = read;
    prevMaster = master;
    readSeries.push([at, read + readOffset - firstRead]);
    masterSeries.push([at, (master + masterOffset - firstMaster) * beatLenSamples]);
    let lock = ((master * beatLenSamples - read) % wrapLen + wrapLen) % wrapLen;
    if (firstLock === null) firstLock = lock;
    let d = lock - firstLock;
    if (d > wrapLen * 0.5) d -= wrapLen;
    if (d < -wrapLen * 0.5) d += wrapLen;
    lockMin = Math.min(lockMin, d);
    lockMax = Math.max(lockMax, d);
    await new Promise((r) => setTimeout(r, kPollMs));
  }
  const last = await queryTelemetry();
  const elapsedSec = (Date.now() - loopStart) / 1000;
  return {
    elapsedSec,
    readWraps,
    readRate: slopePerSecond(readSeries) / kSampleRate,
    masterRate: slopePerSecond(masterSeries) / kSampleRate,
    lockSpread: lockMax - lockMin,
    finalEffSpeed: last.eff_speed,
    finalBpm: last.link.bpm,
  };
}

function slopePerSecond(series) {
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const [x, y] of series) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
  const n = series.length;
  const denom = n * sxx - sx * sx;
  return denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
}

async function main() {
  console.log(`[first-owner] target=${host} hold=${holdMs}ms -- the first take owns the tempo and must repeat exactly`);
  await pressPad(0x5b);
  await releasePad(0x5b);
  await new Promise((r) => setTimeout(r, kClearAllSettleMs));

  const pre = await queryTelemetry();
  const preBpm = (pre.link && pre.link.bpm > 1) ? pre.link.bpm : 0;
  const peers = pre.link ? pre.link.peers : 0;
  console.log(`[first-owner] before the take: link bpm=${preBpm.toFixed(2)} peers=${peers} synced=${!!pre.link.synced}`);

  await pressPad(2);
  await releasePad(2);
  await new Promise((r) => setTimeout(r, holdMs));
  await pressPad(2);
  await releasePad(2);
  const t = await settleWrapLen(0, 8000);

  const wrapLen = t.loopers.wraplen[0];
  const wrapLenSeconds = wrapLen / kSampleRate;
  const beats = deriveTempoQuantBeats(wrapLenSeconds, preBpm);
  const derivedBpm = (60 * beats) / wrapLenSeconds;
  const postBpm = t.link.bpm;
  const effSpeed = t.eff_speed;
  const performedSamples = (holdMs / 1000) * kSampleRate;

  console.log(`[first-owner] take: ${wrapLen} samples (${(wrapLenSeconds * 1000).toFixed(0)}ms), performed ~${performedSamples.toFixed(0)} samples`);
  console.log(`[first-owner] derived: ${beats} beats @ ${derivedBpm.toFixed(2)} bpm`);
  console.log(`[first-owner] after the take: link bpm=${postBpm.toFixed(2)} eff_speed=${effSpeed.toFixed(4)} peers=${t.link.peers}`);

  let failed = 0;
  const fail = (msg) => { console.log(`[first-owner]   FAIL: ${msg}`); failed++; };

  if (Math.abs(wrapLen - performedSamples) > 0.25 * kSampleRate) {
    fail(`take length ${wrapLen} is not the performed ${performedSamples.toFixed(0)} samples (truncated or doubled)`);
  }
  if (Math.abs(postBpm - derivedBpm) > Math.max(0.5, derivedBpm * 0.01)) {
    fail(`session is at ${postBpm.toFixed(2)} bpm, not the loop's ${derivedBpm.toFixed(2)} bpm`);
  }
  if (peers > 0 && Math.abs(preBpm - derivedBpm) < 1.0) {
    console.log(`[first-owner]   note: session was already at ${preBpm.toFixed(2)} bpm, so this run cannot show the move -- a previous take took ownership and the peer kept it`);
  }
  if (peers === 0) {
    console.log('[first-owner]   note: no Link peer connected, ownership untested (tempo still follows the take)');
  }
  if (Math.abs(effSpeed - 1.0) > 1e-3) {
    fail(`eff_speed ${effSpeed.toFixed(4)} resamples the take instead of repeating it at natural pitch`);
  }

  const beatLenSamples = (60 / postBpm) * kSampleRate;
  const beatsPerCycle = wrapLen / beatLenSamples;
  const watch = await watchPlayback(wrapLen, beatLenSamples, beatsPerCycle);
  const rateErrCents = 1200 * Math.log2(watch.readRate);
  const lockRatio = watch.masterRate / watch.readRate;
  console.log(`[first-owner] watched ${watch.elapsedSec.toFixed(1)}s: ${watch.readWraps} repeats, read rate ${watch.readRate.toFixed(7)} (${rateErrCents.toFixed(3)} cents), grid/read ${lockRatio.toFixed(7)}`);
  if (Math.abs(watch.readRate - 1.0) > kRateTolerance) {
    fail(`read head runs at ${watch.readRate.toFixed(7)} (${rateErrCents.toFixed(2)} cents off) -- the take resamples instead of repeating`);
  }
  if (Math.abs(lockRatio - 1.0) > kLockRateTolerance) {
    fail(`read head and master grid run at different rates (${lockRatio.toFixed(7)}) -- ${((lockRatio - 1) * wrapLen).toFixed(1)} samples of slip per repeat`);
  }
  console.log(`[first-owner] grid-lock spread ${watch.lockSpread.toFixed(1)} samples over the watch, session ends at ${watch.finalBpm.toFixed(2)} bpm eff ${watch.finalEffSpeed.toFixed(4)}`);
  if (watch.lockSpread > kLockToleranceSamples) {
    fail(`read head jumped ${watch.lockSpread.toFixed(1)} samples against the master grid`);
  }
  if (Math.abs(watch.finalBpm - derivedBpm) > Math.max(0.5, derivedBpm * 0.01)) {
    fail(`after ${watch.elapsedSec.toFixed(1)}s the session is back at ${watch.finalBpm.toFixed(2)} bpm -- a peer re-asserted its own tempo`);
  }

  console.log(`[first-owner] ${failed === 0 ? 'PASS' : `FAIL (${failed})`}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[first-owner] error:', err.message);
  process.exit(1);
});
