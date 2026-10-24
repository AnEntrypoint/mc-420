'use strict';

const W = require('./world');

const kBlock = 64 / 100;
const kLandingToleranceSamples = 1;
const kImpulseOffsetSamples = 48;
const kFolds = [0, 0.5, 1];
const kStaleExtra = 3;

function landingFor(foldFraction, measuredExtra, trueExtra) {
  const w = W.createWorld({ looperCount: 4, initialLinkBpm: 120.0 });
  w.foldFraction = foldFraction;
  w.resampleMeasuredExtra = measuredExtra;
  W.advance(w, W.msToSimSamples(300));
  W.onPadPress(w, 0); W.onPadRelease(w, 0);
  W.advance(w, W.msToSimSamples(500));
  W.onPadPress(w, 0); W.onPadRelease(w, 0);
  W.advance(w, W.msToSimSamples(300));
  const phraseSamples = w.masterLenSamples;
  const inputT = w.t + kImpulseOffsetSamples;
  const physicalDelay = kBlock + foldFraction * trueExtra;
  w.inputImpulse = { at: inputT + Math.round(physicalDelay), amp: 1 };
  W.onPadPress(w, 1); W.onPadRelease(w, 1);
  W.advance(w, phraseSamples);
  W.onPadPress(w, 1); W.onPadRelease(w, 1);
  const finishT = w.t;
  const bias = w.loopers[1].ps_latencybias;
  let replayT = null;
  for (let i = 0; i < 2 * phraseSamples && replayT === null; i++) {
    const t = w.t;
    const out = W.stepOneSample(w)[1].out;
    if (t >= finishT && out > 0.5) replayT = t;
  }
  return {
    bias,
    inputT,
    gridT: inputT + phraseSamples,
    replayT,
    landing: replayT === null ? NaN : replayT - (inputT + phraseSamples),
  };
}

function main() {
  let failed = 0;
  console.log('resample impulse landing: an input impulse through the fold path replays on the master grid');
  console.log('  units: sim samples (one sim sample = 100 device samples); reference = input sample + one phrase');
  for (const f of kFolds) {
    const r = landingFor(f, kBlock, kBlock);
    const ok = Math.abs(r.landing) <= kLandingToleranceSamples;
    console.log(`  fold ${f}: bias ${r.bias.toFixed(4)}, input ${r.inputT}, grid ${r.gridT}, replay ${r.replayT}, landing ${r.landing} ${ok ? 'ok' : 'FAIL'}`);
    if (!ok) failed++;
  }
  const stale = landingFor(1, kBlock + kStaleExtra, kBlock);
  const caught = Math.abs(stale.landing) > kLandingToleranceSamples;
  console.log(`  stale measurement (fold extra off by ${kStaleExtra}): landing ${stale.landing} ${caught ? 'ok: the case catches it' : 'FAIL: the case cannot catch a stale measurement'}`);
  if (!caught) failed++;
  console.log(failed === 0 ? 'resample impulse landing: PASS' : `resample impulse landing: FAIL (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

if (require.main === module) main();
module.exports = { landingFor };
