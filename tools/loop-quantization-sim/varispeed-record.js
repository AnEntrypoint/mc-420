'use strict';

const { setPhaseQuantum } = require('./link');
const W = require('./world');
const { makePair } = require('./read-head-lineup');

const kMasterBpm = 120.0;
const kTakeMs = 2000;
const kManualSpeed = 0.5;
const kRateTolerance = 0.02;
const kHeadStartMs = 370;
const kSettleMs = 600;
const kPunchSettleMs = 400;
const kMeasureMs = 400;

function measureRate(w, looper, samples) {
  const period = Math.max(1, w.loopers[looper].dsp.wlen);
  const half = period * 0.5;
  let prev = w.loopers[looper].dsp.rpos;
  let acc = 0;
  for (let i = 0; i < samples; i++) {
    W.stepOneSample(w);
    const cur = w.loopers[looper].dsp.rpos;
    let d = cur - prev;
    while (d > half) d -= period;
    while (d < -half) d += period;
    acc += d;
    prev = cur;
  }
  return acc / samples;
}

function run(legacy) {
  setPhaseQuantum(128.0);
  const { a } = makePair(kMasterBpm);
  a.legacyBakeVarispeed = legacy;
  const step = n => { for (let i = 0; i < n; i++) W.stepOneSample(a); };

  step(W.msToSimSamples(kHeadStartMs));
  W.onPadPress(a, 0); W.onPadRelease(a, 0);
  step(W.msToSimSamples(kTakeMs));
  W.onPadPress(a, 0); W.onPadRelease(a, 0);
  step(W.msToSimSamples(kSettleMs));

  if (a.masterLenSamples <= 0) throw new Error('master loop never established');

  W.onPadPress(a, 2); W.onPadRelease(a, 2);
  step(W.msToSimSamples(kTakeMs));
  W.onPadPress(a, 2); W.onPadRelease(a, 2);
  step(W.msToSimSamples(kSettleMs));

  a.manualSpeedMul = kManualSpeed;
  step(W.msToSimSamples(kPunchSettleMs));

  W.onPadPress(a, 1); W.onPadRelease(a, 1);
  step(W.msToSimSamples(kTakeMs));
  W.onPadPress(a, 1); W.onPadRelease(a, 1);
  step(W.msToSimSamples(kSettleMs));

  const samples = W.msToSimSamples(kMeasureMs);
  const rateHeld = measureRate(a, 1, samples);

  a.manualSpeedMul = 1.0;
  step(W.msToSimSamples(kPunchSettleMs));

  const rateReleased = measureRate(a, 1, samples);
  const ratePlain = measureRate(a, 2, samples);

  const oneBeat = a.masterLenSamples / a.recordedBeats;
  return { rateHeld, rateReleased, ratePlain, beats: a.loopers[1].dsp.wlen / oneBeat };
}

function main() {
  let failed = 0;
  const legacy = run(true);
  const fixed = run(false);

  console.log('varispeed record: a take finished under a manual punch must keep that resample');
  console.log(`  master at ${kMasterBpm} BPM, punch ${kManualSpeed}x, ${kTakeMs}ms take`);
  console.log(`  legacy: held ${legacy.rateHeld.toFixed(4)} released ${legacy.rateReleased.toFixed(4)} plain ${legacy.ratePlain.toFixed(4)}`);
  console.log(`  fixed:  held ${fixed.rateHeld.toFixed(4)} released ${fixed.rateReleased.toFixed(4)} plain ${fixed.ratePlain.toFixed(4)}`);
  console.log(`  fixed take length ${fixed.beats.toFixed(3)} beats`);

  if (Math.abs(legacy.rateHeld - 1.0) > kRateTolerance || Math.abs(legacy.rateReleased - 2.0) > kRateTolerance) {
    console.log('  FAIL: legacy run no longer reproduces the bug, so this gate exercises nothing');
    failed++;
  }
  if (Math.abs(fixed.rateHeld - kManualSpeed) > kRateTolerance) {
    console.log(`  FAIL: punch held, take plays at ${fixed.rateHeld.toFixed(4)}, wanted ${kManualSpeed}`);
    failed++;
  }
  if (Math.abs(fixed.rateReleased - kManualSpeed) > kRateTolerance) {
    console.log(`  FAIL: punch released, take plays at ${fixed.rateReleased.toFixed(4)}, wanted ${kManualSpeed}`);
    failed++;
  }
  if (Math.abs(fixed.ratePlain - 1.0) > kRateTolerance) {
    console.log(`  FAIL: take recorded with no punch plays at ${fixed.ratePlain.toFixed(4)}, wanted 1.0000`);
    failed++;
  }

  console.log(failed === 0 ? 'varispeed record: PASS' : `varispeed record: FAIL (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

if (require.main === module) main();
module.exports = { run };
