'use strict';

const W = require('./world');
const { setPhaseQuantum } = require('./link');
const { makePair } = require('./read-head-lineup');

const kHoldMs = 2000;
const kFineGridBeats = 0.125;

function armOnFineGridBoundary(pressOffset) {
  setPhaseQuantum(128.0);
  const { session, a, b } = makePair(120.0);
  const stepOne = () => { W.stepOneSample(a); W.stepOneSample(b); };
  const step = n => { for (let i = 0; i < n; i++) stepOne(); };

  step(W.msToSimSamples(370));
  W.onPadPress(a, 0); W.onPadRelease(a, 0);
  step(W.msToSimSamples(kHoldMs));
  W.onPadPress(a, 0); W.onPadRelease(a, 0);
  step(W.msToSimSamples(500));

  const oneBeat = a.masterLenSamples / a.recordedBeats;
  const fineGrid = Math.max(1.0, kFineGridBeats * oneBeat);

  let guard = 0;
  while (guard++ < 200000) {
    const cur = a.masterPhaseSamples;
    if (Math.floor((cur + 1) / fineGrid) !== Math.floor(cur / fineGrid)) break;
    stepOne();
  }
  step(Math.max(0, pressOffset));

  W.onPadPress(a, 1);
  let arms = 0;
  let rsmAtArm = null;
  let widxAfterSecondArm = null;
  for (let i = 0; i < W.msToSimSamples(kHoldMs); i++) {
    const res = W.stepOneSample(a);
    W.stepOneSample(b);
    if (res[1].armEdge) {
      arms++;
      if (rsmAtArm === null) rsmAtArm = res[1].rsm;
      else if (widxAfterSecondArm === null) widxAfterSecondArm = res[1].widx;
    }
  }
  return { arms, rsmAtArm, widxAfterSecondArm, oneBeat, fineGrid };
}

function main() {
  let failed = 0;
  console.log('arm boundary: a rec press landing on a fine-grid boundary must arm exactly once');
  console.log('  a second arm re-zeroes widx and re-anchors rsm one fine grid late,');
  console.log('  and rsm feeds absPos directly, so it shifts the read head.');

  for (const offset of [0, 1, 2]) {
    const r = armOnFineGridBoundary(offset);
    const lateBy = r.rsmAtArm === null ? null : (r.rsmAtArm / r.oneBeat);
    console.log(`  press offset ${offset}: arms=${r.arms} rsmAtArm=${lateBy === null ? 'n/a' : lateBy.toFixed(4) + ' beats'}` +
      (r.widxAfterSecondArm !== null ? ` widxAfterSecondArm=${r.widxAfterSecondArm}` : ''));
    if (r.arms !== 1) {
      console.log(`    FAIL: armed ${r.arms} times at press offset ${offset}`);
      failed++;
    }
    if (r.rsmAtArm === null) {
      console.log(`    FAIL: never armed at press offset ${offset}`);
      failed++;
    }
  }

  console.log(failed === 0 ? 'arm boundary: PASS' : `arm boundary: FAIL (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

if (require.main === module) main();
module.exports = { armOnFineGridBoundary };
