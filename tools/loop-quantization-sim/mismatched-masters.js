'use strict';

const { setPhaseQuantum } = require('./link');
const W = require('./world');
const { makePair, readHeadError } = require('./read-head-lineup');

const kToleranceBeats = 0.05;
const kWatchMs = 20000;
const kStepMs = 50;
const kHoldPairs = [[2000, 2000], [2000, 4000], [4000, 2000], [1000, 4000]];

function advancePair(a, b, n) {
  for (let i = 0; i < n; i++) { W.stepOneSample(a); W.stepOneSample(b); }
}

function run(phaseLock, aMs, bMs) {
  setPhaseQuantum(128.0);
  const { session, a, b } = makePair(120.0);
  a.phaseLockEnabled = phaseLock;
  b.phaseLockEnabled = phaseLock;
  advancePair(a, b, W.msToSimSamples(370));

  W.onPadPress(a, 0); W.onPadRelease(a, 0);
  advancePair(a, b, W.msToSimSamples(aMs));
  W.onPadPress(a, 0); W.onPadRelease(a, 0);
  advancePair(a, b, W.msToSimSamples(500));

  W.onPadPress(b, 0); W.onPadRelease(b, 0);
  advancePair(a, b, W.msToSimSamples(bMs));
  W.onPadPress(b, 0); W.onPadRelease(b, 0);
  advancePair(a, b, W.msToSimSamples(500));

  let worstA = 0;
  let worstB = 0;
  for (let k = 0; k * kStepMs < kWatchMs; k++) {
    advancePair(a, b, W.msToSimSamples(kStepMs));
    const ea = readHeadError(a, session, 0);
    const eb = readHeadError(b, session, 0);
    if (ea !== null) worstA = Math.max(worstA, ea);
    if (eb !== null) worstB = Math.max(worstB, eb);
  }
  return { worstA, worstB, beatsA: a.recordedBeats, beatsB: b.recordedBeats };
}

function main() {
  let failed = 0;
  console.log('mismatched masters: two devices each establish their own phrase length');
  console.log('  each device is asserted against absolute grid time, not against its peer,');
  console.log('  because mismatched phrase lengths make an A/B gap meaningless.');

  for (const [aMs, bMs] of kHoldPairs) {
    const legacy = run(false, aMs, bMs);
    const fixed = run(true, aMs, bMs);
    const label = `  A ${aMs}ms (${fixed.beatsA} beats) / B ${bMs}ms (${fixed.beatsB} beats)`;
    console.log(`${label}: legacy A ${legacy.worstA.toFixed(3)} B ${legacy.worstB.toFixed(3)}` +
      ` -> fixed A ${fixed.worstA.toFixed(3)} B ${fixed.worstB.toFixed(3)}`);

    if (!(legacy.worstA > kToleranceBeats || legacy.worstB > kToleranceBeats)) {
      console.log('    FAIL: legacy run tracked the grid, so this case does not exercise the anchor');
      failed++;
    }
    if (!(fixed.worstA < kToleranceBeats)) {
      console.log(`    FAIL: fixed run, A read head off by ${fixed.worstA.toFixed(3)} beats`);
      failed++;
    }
    if (!(fixed.worstB < kToleranceBeats)) {
      console.log(`    FAIL: fixed run, B read head off by ${fixed.worstB.toFixed(3)} beats`);
      failed++;
    }
  }

  console.log(failed === 0 ? 'mismatched masters: PASS' : `mismatched masters: FAIL (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

if (require.main === module) main();
module.exports = { run };
