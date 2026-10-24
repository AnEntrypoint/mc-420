'use strict';

const W = require('./world');

const kBpm = 120.0;
const kMasterHoldMs = 2000;
const kSettleMs = 30000;
const kStepMs = 50;
const kLengthToleranceBeats = 2.0;
const kPhraseToleranceBeats = 0.02;
const kExactBeats = { 1: 1, 2: 2, 3.4: 4 };
const kCutCases = [
  [2000, 2.5, 2, 'phrase 4: +0.5 past the half takes the half'],
  [2000, 3.5, 4, 'phrase 4: +1.5 past the half takes the phrase'],
  [2000, 4.5, 4, 'phrase 4: +0.5 past the phrase takes the phrase'],
  [2000, 6.0, 4, 'phrase 4: far-extend capped at one phrase'],
  [4000, 4.5, 4, 'phrase 8: +0.5 past the half takes the half'],
  [4000, 5.5, 8, 'phrase 8: +1.5 past the half takes the phrase'],
];
const kTakeBeats = [
  1.0, 2.0, 3.4, 4.0, 4.6, 5.5, 8.0, 12.0, 14.0, 16.0, 16.4, 17.2, 18.0,
  19.0, 20.0, 21.5, 24.0, 32.5, 40.7, 64.3,
];

function advance(w, ms) {
  const n = W.msToSimSamples(ms);
  for (let i = 0; i < n; i++) W.stepOneSample(w);
}

function run(legacy, takeBeats, masterMs = kMasterHoldMs) {
  const w = W.createWorld({ looperCount: 4, initialLinkBpm: kBpm });
  w.legacyFinishAnchor = legacy;

  advance(w, 300);
  W.onPadPress(w, 0); W.onPadRelease(w, 0);
  advance(w, masterMs);
  W.onPadPress(w, 0); W.onPadRelease(w, 0);
  advance(w, 1200);

  W.onPadPress(w, 1); W.onPadRelease(w, 1);
  advance(w, (takeBeats * 60000) / kBpm);
  W.onPadPress(w, 1); W.onPadRelease(w, 1);

  const lp = w.loopers[1];
  for (let k = 0; k * kStepMs < kSettleMs; k++) {
    advance(w, kStepMs);
    if (lp.finishTargetPending === 0 && !lp.recording) break;
  }
  advance(w, kStepMs);

  const oneBeat = w.masterLenSamples / Math.max(1, w.recordedBeats);
  const loopBeatLen = oneBeat * lp.dsp.beatScale;
  return {
    loopBeats: lp.dsp.wlen / loopBeatLen,
    samples: lp.dsp.wlen,
    oneBeat,
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
    const exactBeats = kExactBeats[beats];
    if (exactBeats !== undefined && Math.abs(fixed.samples - exactBeats * fixed.oneBeat) > 1) {
      console.log(`    FAIL: fixed loop is ${fixed.samples.toFixed(2)} samples, expected ${(exactBeats * fixed.oneBeat).toFixed(2)} (${exactBeats} beats)`);
      failed++;
    }
    const longTake = beats >= 2 * fixed.phraseBeats;
    if (longTake) {
      if (!(fixedOff <= fixed.phraseBeats)) {
        console.log(`    FAIL: fixed run off by ${fixedOff.toFixed(3)} beats, tolerance one phrase (${fixed.phraseBeats})`);
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

  for (const [masterMs, beats, expected, label] of kCutCases) {
    const fixed = run(false, beats, masterMs);
    const ok = fixed.pending === 0 && Math.abs(fixed.samples - expected * fixed.oneBeat) <= 1;
    console.log(`  cut ${label}: take ${beats} -> ${fixed.loopBeats.toFixed(3)} beats (want ${expected}) ${ok ? 'ok' : 'FAIL'}`);
    if (!ok) failed++;
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
