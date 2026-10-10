'use strict';

const W = require('./world');

const kBpm = 120.0;
const kMasterHoldMs = 2000;
const kSettleMs = 30000;
const kStepMs = 50;
const kLengthToleranceBeats = 2.0;
const kPhraseToleranceBeats = 0.02;
const kTakeBeats = [
  1.0, 2.0, 3.4, 4.0, 4.6, 5.5, 8.0, 12.0, 14.0, 16.0, 16.4, 17.2, 18.0,
  19.0, 20.0, 21.5, 24.0, 32.5, 40.7, 64.3,
];

function advance(w, ms) {
  const n = W.msToSimSamples(ms);
  for (let i = 0; i < n; i++) W.stepOneSample(w);
}

function run(legacy, takeBeats) {
  const w = W.createWorld({ looperCount: 4, initialLinkBpm: kBpm });
  w.legacyFinishAnchor = legacy;

  advance(w, 300);
  W.onPadPress(w, 0); W.onPadRelease(w, 0);
  advance(w, kMasterHoldMs);
  W.onPadPress(w, 0); W.onPadRelease(w, 0);
  advance(w, 1200);

  W.onPadPress(w, 1); W.onPadRelease(w, 1);
  advance(w, (takeBeats * 60000) / kBpm);
  W.onPadPress(w, 1); W.onPadRelease(w, 1);

  const lp = w.loopers[1];
  for (let k = 0; k * kStepMs < kSettleMs; k++) {
    if (lp.finishTargetPending === 0 && !lp.recording) break;
    advance(w, kStepMs);
  }

  const oneBeat = w.masterLenSamples / Math.max(1, w.recordedBeats);
  const loopBeatLen = oneBeat * lp.dsp.beatScale;
  return {
    loopBeats: lp.dsp.wlen / loopBeatLen,
    phraseBeats: Math.max(1, w.recordedBeats),
    pending: lp.finishTargetPending,
  };
}

function main() {
  let failed = 0;
  let legacyCaught = 0;
  console.log('long take quantize: a long take must land on the phrase grid, never double itself');
  console.log(`  master ${kMasterHoldMs}ms at ${kBpm} BPM, takes ${kTakeBeats.join('/')} beats`);

  for (const beats of kTakeBeats) {
    const legacy = run(true, beats);
    const fixed = run(false, beats);
    const legacyOff = Math.abs(legacy.loopBeats - beats);
    const fixedOff = Math.abs(fixed.loopBeats - beats);
    if (legacyOff > kLengthToleranceBeats) legacyCaught++;
    console.log(`  ${String(beats).padStart(5)} beats: legacy ${legacy.loopBeats.toFixed(3)} (off ${legacyOff.toFixed(3)})` +
      ` -> fixed ${fixed.loopBeats.toFixed(3)} (off ${fixedOff.toFixed(3)})`);

    if (fixed.pending !== 0) {
      console.log(`    FAIL: take never settled, pending=${fixed.pending}`);
      failed++;
    }
    const longTake = beats >= 2 * fixed.phraseBeats;
    if (longTake) {
      if (!(fixedOff <= kLengthToleranceBeats + 0.05)) {
        console.log(`    FAIL: fixed run off by ${fixedOff.toFixed(3)} beats, tolerance ${kLengthToleranceBeats}`);
        failed++;
      }
      const phraseErr = Math.abs(fixed.loopBeats / fixed.phraseBeats - Math.round(fixed.loopBeats / fixed.phraseBeats));
      if (!(phraseErr <= kPhraseToleranceBeats * fixed.phraseBeats)) {
        console.log(`    FAIL: fixed run ${fixed.loopBeats.toFixed(3)} beats is not a whole number of ${fixed.phraseBeats}-beat phrases`);
        failed++;
      }
    } else if (fixedOff > legacyOff + kPhraseToleranceBeats) {
      console.log(`    FAIL: take shorter than two phrases moved further off the performed length (${legacyOff.toFixed(3)} -> ${fixedOff.toFixed(3)})`);
      failed++;
    }
  }

  if (legacyCaught === 0) {
    console.log('  FAIL: no take trips the legacy math, so this gate no longer exercises the bug');
    failed++;
  }

  console.log(failed === 0 ? 'long take quantize: PASS' : `long take quantize: FAIL (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

if (require.main === module) main();
module.exports = { run };
