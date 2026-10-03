'use strict';

const { setPhaseQuantum } = require('./link');
const { readHeadError } = require('./read-head-lineup');
const {
  createWorld, stepOneSample, onPadPress, onPadRelease, msToSimSamples,
  snapshotWriteIdx, effSpeedNow,
} = require('./world');

const kPeerBpm = 157.2;
const kHoldMs = [1500, 2000, 3000];
const kWatchMs = 12000;
const kStepMs = 25;
const kToleranceBeats = 0.02;
const kToleranceSamples = 8;

function run(legacy, holdMs) {
  setPhaseQuantum(128.0);
  const w = createWorld({ looperCount: 4, initialLinkBpm: kPeerBpm });
  w.legacyAdoptLinkTempo = legacy;
  w.link.remote.connected = true;
  w.link.session.tempo = kPeerBpm;

  for (let i = 0; i < msToSimSamples(kHoldMs[0]); i++) stepOneSample(w);

  onPadPress(w, 0);
  onPadRelease(w, 0);
  for (let i = 0; i < msToSimSamples(holdMs); i++) stepOneSample(w);
  const performedSamples = snapshotWriteIdx(w, 0);
  onPadPress(w, 0);
  onPadRelease(w, 0);
  for (let i = 0; i < msToSimSamples(500); i++) stepOneSample(w);

  const lp = w.loopers[0];
  const wlen = lp.dsp.wlen;
  let prev = lp.dsp.rpos;
  const wrapTimes = [];
  let worstGridErr = 0;
  for (let k = 0; k * kStepMs < kWatchMs; k++) {
    for (let s = 0; s < msToSimSamples(kStepMs); s++) {
      stepOneSample(w);
      const cur = w.loopers[0].dsp.rpos;
      if (cur < prev - wlen * 0.5) wrapTimes.push(w.t);
      prev = cur;
    }
    const err = readHeadError(w, w.link.session, 0);
    if (err !== null) worstGridErr = Math.max(worstGridErr, err);
  }

  let period = 0;
  if (wrapTimes.length >= 2) {
    period = (wrapTimes[wrapTimes.length - 1] - wrapTimes[0]) / (wrapTimes.length - 1);
  }
  return {
    performedSamples,
    masterLen: w.masterLenSamples,
    wrapped: w.loopers[0].dsp.wlen,
    recordedBpm: w.recordedBpm,
    recordedBeats: w.recordedBeats,
    sessionTempo: w.link.session.tempo,
    effSpeed: effSpeedNow(w),
    period,
    worstGridErr,
  };
}

function main() {
  let failed = 0;
  console.log('first loop tempo owner: the first take sets the tempo and repeats exactly');
  console.log(`  peer (ticker) starts the session at ${kPeerBpm} bpm`);
  for (const holdMs of kHoldMs) {
    const legacy = run(true, holdMs);
    const fixed = run(false, holdMs);
    console.log(`  take ${holdMs}ms: performed ${legacy.performedSamples} samples (${(legacy.performedSamples / 480).toFixed(1)}ms)`);
    console.log(`    legacy (adopts the peer tempo): masterLen ${legacy.masterLen} bpm ${legacy.recordedBpm.toFixed(2)} beats ${legacy.recordedBeats}`
      + ` session ${legacy.sessionTempo.toFixed(2)} eff ${legacy.effSpeed.toFixed(4)} repeat ${legacy.period.toFixed(1)} (off ${(legacy.period - legacy.performedSamples).toFixed(1)})`);
    console.log(`    fixed  (owns the tempo):         masterLen ${fixed.masterLen} bpm ${fixed.recordedBpm.toFixed(2)} beats ${fixed.recordedBeats}`
      + ` session ${fixed.sessionTempo.toFixed(2)} eff ${fixed.effSpeed.toFixed(4)} repeat ${fixed.period.toFixed(1)} (off ${(fixed.period - fixed.performedSamples).toFixed(1)})`);

    if (Math.abs(legacy.period - legacy.performedSamples) < kToleranceSamples) {
      console.log('    FAIL: legacy run already repeated the performed length, so this case proves nothing');
      failed++;
    }
    if (Math.abs(fixed.period - fixed.performedSamples) > kToleranceSamples) {
      console.log(`    FAIL: fixed repeat period off by ${(fixed.period - fixed.performedSamples).toFixed(1)} samples`);
      failed++;
    }
    if (Math.abs(fixed.effSpeed - 1.0) > 1e-6) {
      console.log(`    FAIL: fixed playback resamples (eff ${fixed.effSpeed.toFixed(6)})`);
      failed++;
    }
    if (Math.abs(fixed.sessionTempo - fixed.recordedBpm) > 0.01) {
      console.log(`    FAIL: session at ${fixed.sessionTempo.toFixed(2)} does not follow the loop's ${fixed.recordedBpm.toFixed(2)} bpm`);
      failed++;
    }
    if (Math.abs(fixed.recordedBpm - kPeerBpm) < 1.0) {
      console.log('    FAIL: fixed tempo matches the peer anyway, so ownership is untested');
      failed++;
    }
    if (!(fixed.worstGridErr < kToleranceBeats)) {
      console.log(`    FAIL: fixed read head off the shared grid by ${fixed.worstGridErr.toFixed(3)} beats`);
      failed++;
    }
  }
  console.log(failed === 0 ? 'first loop tempo owner: PASS' : `first loop tempo owner: FAIL (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

if (require.main === module) main();
module.exports = { run };
