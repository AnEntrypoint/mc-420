#!/usr/bin/env node
const net = require('net');
const dgram = require('dgram');

const [, , host, beatsArg, holdMsArg] = process.argv;
if (!host) {
  console.error('usage: node verify-recorded-beats-declobber.js <host> [targetBeats] [holdMs]');
  process.exit(2);
}

const kSampleRate = 48000;
const kTargetBeats = Number(beatsArg || '8');
const kFirstTakeAnchorBpm = 120;
const kPressMs = 150;
const kClearAllSettleMs = 2500;
const kWatchMs = 22000;
const kPollMs = 150;
const kTrimSettleMs = 6000;

let holdMsOverride = holdMsArg ? Number(holdMsArg) : 0;

function sendBytes(bytes) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port: 9401 }, () => {
      sock.write(Buffer.from(bytes), (err) => {
        if (err) return reject(err);
        sock.end();
      });
    });
    sock.setTimeout(5000);
    sock.on('timeout', () => { sock.destroy(); reject(new Error('midi inject timed out')); });
    sock.on('close', resolve);
    sock.on('error', reject);
  });
}

const pressPad = (note) => sendBytes([0x90, note, 127]);
const releasePad = (note) => sendBytes([0x80, note, 0]);

async function tapPad(note) {
  await pressPad(note);
  await new Promise((r) => setTimeout(r, kPressMs));
  await releasePad(note);
}

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
    sock.on('error', (e) => { clearTimeout(timer); sock.close(); reject(e); });
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

function slopePerSecond(series) {
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const [x, y] of series) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
  const n = series.length;
  const denom = n * sxx - sx * sx;
  return denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
}

async function settleWrapLen(maxMs) {
  let last = null, stableCount = 0;
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const t = await queryTelemetry();
    const w = t.loopers.wraplen[0];
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

async function watchGrid(beatLenSamples, beatsPerCycle) {
  await new Promise((r) => setTimeout(r, kTrimSettleMs));
  const series = [];
  let maxIndex = -1;
  const loopStart = Date.now();
  let prevMaster = null;
  let masterOffset = 0;
  let wraps = 0;
  const first = await queryTelemetry();
  const firstMaster = first.master_phase_beats;
  prevMaster = firstMaster;
  while (Date.now() - loopStart < kWatchMs) {
    const t = await queryTelemetry();
    const at = (Date.now() - loopStart) / 1000;
    const master = t.master_phase_beats;
    if (master < prevMaster - beatsPerCycle * 0.5) { wraps++; masterOffset += beatsPerCycle; }
    prevMaster = master;
    series.push([at, master + masterOffset - firstMaster]);
    if (typeof t.grid_beat_index === 'number' && t.grid_beat_index > maxIndex) maxIndex = t.grid_beat_index;
    await new Promise((r) => setTimeout(r, kPollMs));
  }
  const last = await queryTelemetry();
  return {
    elapsedSec: (Date.now() - loopStart) / 1000,
    wraps,
    beatsPerSec: slopePerSecond(series),
    maxGridBeatIndex: maxIndex,
    finalRecordedBeats: last.recorded_beats,
    finalMasterLen: last.master_len_samples,
    finalBpm: last.link.bpm,
    finalEffSpeed: last.eff_speed,
  };
}

async function main() {
  console.log(`[declobber] target=${host} targetBeats=${kTargetBeats}`);
  await tapPad(0x5b);
  await new Promise((r) => setTimeout(r, kClearAllSettleMs));

  let pre = await queryTelemetry();
  let linkBpm = pre.link.bpm > 1 ? pre.link.bpm : 0;
  if (linkBpm < 1) {
    for (let i = 0; i < 20 && linkBpm < 1; i++) {
      await new Promise((r) => setTimeout(r, 300));
      pre = await queryTelemetry();
      linkBpm = pre.link.bpm > 1 ? pre.link.bpm : 0;
    }
  }
  console.log(`[declobber] pre-take: peers=${pre.link.peers} synced=${!!pre.link.synced} bpm=${linkBpm.toFixed(3)} recorded_beats=${pre.recorded_beats} master_len=${pre.master_len_samples}`);
  if (!pre.link.synced || pre.link.peers < 1) {
    console.log('[declobber]   NOTE: no Link peer -- the pin this test looks for never armed');
  }

  const holdMs = holdMsOverride > 0 ? holdMsOverride : Math.round((60000 * kTargetBeats) / kFirstTakeAnchorBpm);
  console.log(`[declobber] holding pad 2 for ${holdMs}ms = ${kTargetBeats} beats at ${kFirstTakeAnchorBpm} bpm`);

  await tapPad(2);
  await new Promise((r) => setTimeout(r, holdMs));
  await tapPad(2);

  const t = await settleWrapLen(8000);
  const masterLen = t.master_len_samples;
  const recordedBeats = t.recorded_beats;
  const takeSeconds = masterLen / kSampleRate;
  const expectedBeats = deriveTempoQuantBeats(takeSeconds, kFirstTakeAnchorBpm);
  const publishedBeatLen = t.groove ? t.groove.beat_len_samples : 0;
  const basisBeatLen = masterLen / recordedBeats;
  const pinnedBeatLen = masterLen / 4;
  const pinnedMlbBeats = 4;
  const sessionBeatLen = ((60 / t.link.bpm) * kSampleRate);

  console.log(`[declobber] take: master_len_samples=${masterLen} (${(takeSeconds * 1000).toFixed(0)}ms) wraplen[0]=${t.loopers.wraplen[0]} eff_speed=${t.eff_speed.toFixed(4)}`);
  console.log(`[declobber] published: recorded_beats=${recordedBeats} groove.beat_len_samples=${publishedBeatLen.toFixed(2)}`);
  console.log(`[declobber] basis: master_len/recorded_beats = ${masterLen}/${recordedBeats} = ${basisBeatLen.toFixed(2)} samples/beat`);
  console.log(`[declobber] expected beats from deriveTempoQuant(${takeSeconds.toFixed(4)}s, anchor ${kFirstTakeAnchorBpm.toFixed(3)}) = ${expectedBeats}`);
  console.log(`[declobber] if pinned to 4: beat_len would be ${pinnedBeatLen.toFixed(2)} samples/beat (${(pinnedBeatLen - basisBeatLen).toFixed(2)} off), MLB would be ${(pinnedMlbBeats * sessionBeatLen / 64).toFixed(2)} blocks vs ${(masterLen / 64).toFixed(2)}`);

  let failed = 0;
  const fail = (msg) => { console.log(`[declobber]   FAIL: ${msg}`); failed++; };

  if (Math.abs(recordedBeats - kTargetBeats) > 0.5) {
    fail(`recorded_beats is ${recordedBeats}, expected ${kTargetBeats} for this take`);
  }
  if (recordedBeats === 4 && kTargetBeats !== 4) {
    fail(`recorded_beats is exactly 4 -- the Link-synced 4-beat pin is still clobbering the real value`);
  }
  if (Math.abs(publishedBeatLen - basisBeatLen) > 1.0) {
    fail(`groove.beat_len_samples ${publishedBeatLen.toFixed(2)} is not master_len/recorded_beats ${basisBeatLen.toFixed(2)}`);
  }

  const watch = await watchGrid(basisBeatLen, recordedBeats);
  const beatsPerSecFromBasis = kSampleRate / basisBeatLen;
  console.log(`[declobber] watched ${watch.elapsedSec.toFixed(1)}s: ${watch.wraps} grid wraps, ${watch.beatsPerSec.toFixed(4)} beats/s vs basis ${beatsPerSecFromBasis.toFixed(4)} beats/s`);
  console.log(`[declobber] max grid_beat_index seen = ${watch.maxGridBeatIndex} (a ${watch.finalRecordedBeats}-beat grid tops out at ${watch.finalRecordedBeats - 1}; a pinned 4-beat grid tops out at 3)`);
  console.log(`[declobber] end: recorded_beats=${watch.finalRecordedBeats} master_len=${watch.finalMasterLen} bpm=${watch.finalBpm.toFixed(3)} eff_speed=${watch.finalEffSpeed.toFixed(4)}`);

  if (watch.finalRecordedBeats !== recordedBeats) {
    fail(`recorded_beats drifted ${recordedBeats} -> ${watch.finalRecordedBeats} during the watch`);
  }
  if (watch.maxGridBeatIndex >= 0) {
    console.log(`[declobber]   info: grid_beat_index folds at ${watch.maxGridBeatIndex + 1} steps, independent of recorded_beats`);
  }
  if (Math.abs(watch.beatsPerSec - beatsPerSecFromBasis) > beatsPerSecFromBasis * 0.002) {
    fail(`grid runs at ${watch.beatsPerSec.toFixed(4)} beats/s but the published basis says ${beatsPerSecFromBasis.toFixed(4)}`);
  }

  console.log(`[declobber] ${failed === 0 ? 'PASS' : `FAIL (${failed})`}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[declobber] error:', err.message);
  process.exit(1);
});
