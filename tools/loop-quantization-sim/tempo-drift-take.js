'use strict';

const { setPhaseQuantum, setTempoContinuous } = require('./link');
const W = require('./world');
const { makePair, readHeadError } = require('./read-head-lineup');

const kMasterBpm = 120.0;
const kTakeBeats = 4.0;
const kDriftedBpm = [120.0, 110.0, 124.0, 135.0, 150.0, 96.0];
const kLengthToleranceBeats = 0.02;
const kPhaseToleranceBeats = 0.05;
const kSettleMs = 2500;
const kWatchMs = 10000;
const kStepMs = 50;

function takeMsAt(bpm) {
  return Math.round((kTakeBeats * 60000) / bpm);
}

function run(inverted, curBpm) {
  setPhaseQuantum(128.0);
  const { session, a, b } = makePair(kMasterBpm);
  a.tempoScaleInverted = inverted;
  const step = n => { for (let i = 0; i < n; i++) { W.stepOneSample(a); W.stepOneSample(b); } };
  const nowMs = () => (a.t / W.SIM_SAMPLE_RATE) * 1000;

  step(W.msToSimSamples(370));
  W.onPadPress(a, 0); W.onPadRelease(a, 0);
  step(W.msToSimSamples(takeMsAt(kMasterBpm)));
  W.onPadPress(a, 0); W.onPadRelease(a, 0);
  step(W.msToSimSamples(500));

  if (curBpm !== kMasterBpm) {
    setTempoContinuous(session, curBpm, nowMs());
    step(W.msToSimSamples(kSettleMs));
  }

  W.onPadPress(a, 1); W.onPadRelease(a, 1);
  step(W.msToSimSamples(takeMsAt(curBpm)));
  W.onPadPress(a, 1); W.onPadRelease(a, 1);
  step(W.msToSimSamples(1000));

  const oneBeat = a.masterLenSamples / a.recordedBeats;
  const loopBeats = a.loopers[1].dsp.wlen / oneBeat;

  let worst = 0;
  for (let k = 0; k * kStepMs < kWatchMs; k++) {
    step(W.msToSimSamples(kStepMs));
    const e = readHeadError(a, session, 1);
    if (e !== null) worst = Math.max(worst, e);
  }
  return { loopBeats, worst };
}

function main() {
  let failed = 0;
  let legacyCaught = 0;
  console.log('tempo drift take: a take recorded while the mesh runs at another tempo');
  console.log(`  master at ${kMasterBpm} BPM, then a ${kTakeBeats}-beat take at each drifted tempo`);

  for (const bpm of kDriftedBpm) {
    const legacy = run(true, bpm);
    const fixed = run(false, bpm);
    if (legacy.worst > kPhaseToleranceBeats) legacyCaught++;
    console.log(`  at ${bpm} BPM: legacy ${legacy.loopBeats.toFixed(3)} beats (err ${legacy.worst.toFixed(3)})` +
      ` -> fixed ${fixed.loopBeats.toFixed(3)} beats (err ${fixed.worst.toFixed(3)})`);

    if (Math.abs(fixed.loopBeats - kTakeBeats) > kLengthToleranceBeats) {
      console.log(`    FAIL: fixed run produced ${fixed.loopBeats.toFixed(3)} beats, wanted ${kTakeBeats}`);
      failed++;
    }
    if (!(fixed.worst < kPhaseToleranceBeats)) {
      console.log(`    FAIL: fixed run, read head off by ${fixed.worst.toFixed(3)} beats at ${bpm} BPM`);
      failed++;
    }
  }

  if (legacyCaught === 0) {
    console.log('  FAIL: no drifted tempo trips the legacy math, so this gate no longer exercises the bug');
    failed++;
  }

  console.log(failed === 0 ? 'tempo drift take: PASS' : `tempo drift take: FAIL (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

if (require.main === module) main();
module.exports = { run };
