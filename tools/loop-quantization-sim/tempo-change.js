'use strict';

const {
  createLinkSession, createLinkPeer, registerPeer, setPhaseQuantum, setTempoContinuous,
} = require('./link');
const {
  createWorld, stepOneSample, onPadPress, onPadRelease, msToSimSamples, SIM_SAMPLE_RATE,
} = require('./world');
const { readHeadError, makePair } = require('./read-head-lineup');

const kHoldMs = 2000;
const kStaggerMs = 700;
const kSettleMs = 3000;
const kWatchMs = 20000;
const kLateWindowMs = 5000;
const kStepMs = 50;
const kToleranceBeats = 0.05;
const kTempoChanges = [100.0, 140.0, 90.0];

function advancePair(a, b, samples) {
  for (let i = 0; i < samples; i++) { stepOneSample(a); stepOneSample(b); }
}

function circGap(a, b, period) {
  let d = (a - b) % period;
  if (d < 0) d += period;
  return Math.min(d, period - d);
}

function anchorBeats(w) {
  if (w.masterLenSamples <= 0 || w.recordedBeats < 1.0) return null;
  return (w.masterPhaseSamples / w.masterLenSamples) * w.recordedBeats;
}

function run(varispeedOnAnchor, newTempo) {
  setPhaseQuantum(128.0);
  const { session, a, b } = makePair(120.0);
  a.varispeedOnAnchor = varispeedOnAnchor;
  b.varispeedOnAnchor = varispeedOnAnchor;

  advancePair(a, b, msToSimSamples(370));

  onPadPress(a, 0); onPadRelease(a, 0);
  advancePair(a, b, msToSimSamples(kHoldMs));
  onPadPress(a, 0); onPadRelease(a, 0);
  advancePair(a, b, msToSimSamples(kStaggerMs));

  onPadPress(b, 0); onPadRelease(b, 0);
  advancePair(a, b, msToSimSamples(kHoldMs));
  onPadPress(b, 0); onPadRelease(b, 0);
  advancePair(a, b, msToSimSamples(kSettleMs));

  let worstBeforeA = 0;
  let worstBeforeB = 0;
  for (let k = 0; k * kStepMs < 2000; k++) {
    advancePair(a, b, msToSimSamples(kStepMs));
    const ea = readHeadError(a, session, 0);
    const eb = readHeadError(b, session, 0);
    if (ea !== null) worstBeforeA = Math.max(worstBeforeA, ea);
    if (eb !== null) worstBeforeB = Math.max(worstBeforeB, eb);
  }

  setTempoContinuous(session, newTempo, (a.t / SIM_SAMPLE_RATE) * 1000);

  let peakA = 0;
  let lateA = 0;
  let lateB = 0;
  let worstGap = 0;
  let elapsedMs = 0;
  for (let k = 0; k * kStepMs < kWatchMs; k++) {
    advancePair(a, b, msToSimSamples(kStepMs));
    elapsedMs += kStepMs;
    const ea = readHeadError(a, session, 0);
    const eb = readHeadError(b, session, 0);
    if (ea !== null) peakA = Math.max(peakA, ea);
    const pa = anchorBeats(a);
    const pb = anchorBeats(b);
    if (pa !== null && pb !== null) {
      worstGap = Math.max(worstGap, circGap(pa, pb, a.recordedBeats));
    }
    if (elapsedMs <= kWatchMs - kLateWindowMs) continue;
    if (ea !== null) lateA = Math.max(lateA, ea);
    if (eb !== null) lateB = Math.max(lateB, eb);
  }
  return {
    worstBeforeA, worstBeforeB, peakA, lateA, lateB, worstGap,
    beatsA: a.recordedBeats, beatsB: b.recordedBeats,
  };
}

function worstOver(varispeedOnAnchor) {
  const out = {
    worstBeforeA: 0, worstBeforeB: 0, peakA: 0, lateA: 0, lateB: 0, worstGap: 0, beatsA: 0,
  };
  for (const tempo of kTempoChanges) {
    const r = run(varispeedOnAnchor, tempo);
    out.worstBeforeA = Math.max(out.worstBeforeA, r.worstBeforeA);
    out.worstBeforeB = Math.max(out.worstBeforeB, r.worstBeforeB);
    out.peakA = Math.max(out.peakA, r.peakA);
    out.lateA = Math.max(out.lateA, r.lateA);
    out.lateB = Math.max(out.lateB, r.lateB);
    out.worstGap = Math.max(out.worstGap, r.worstGap);
    out.beatsA = r.beatsA;
  }
  return out;
}

function main() {
  let failed = 0;
  const legacy = worstOver(false);
  const fixed = worstOver(true);

  console.log('tempo change: loops recorded at 120 must stay locked when the mesh retunes');
  console.log(`  beats=${fixed.beatsA}, retuned to ${kTempoChanges.join('/')} BPM`);
  console.log(`  locked before:  A ${fixed.worstBeforeA.toFixed(3)} beats, B ${fixed.worstBeforeB.toFixed(3)} beats`);
  console.log(`  legacy (anchor ignores varispeed): settled A ${legacy.lateA.toFixed(3)} beats, B ${legacy.lateB.toFixed(3)} beats, gap ${legacy.worstGap.toFixed(3)}`);
  console.log(`  fixed  (anchor follows varispeed): settled A ${fixed.lateA.toFixed(3)} beats, B ${fixed.lateB.toFixed(3)} beats, gap ${fixed.worstGap.toFixed(3)}`);
  console.log(`  fixed transient at the retune: ${fixed.peakA.toFixed(3)} beats (5 Hz control-tick blind window)`);

  if (!(legacy.lateA > kToleranceBeats || legacy.lateB > kToleranceBeats)) {
    console.log('  FAIL: legacy run stayed locked, so this case does not exercise the varispeed anchor');
    failed++;
  }
  if (!(fixed.worstBeforeA < kToleranceBeats && fixed.worstBeforeB < kToleranceBeats)) {
    console.log('  FAIL: not locked before the tempo change, so the change is not isolated');
    failed++;
  }
  if (!(fixed.worstGap < kToleranceBeats)) {
    console.log('  FAIL: A/B anchors drifted ' + fixed.worstGap.toFixed(3) + ' beats apart');
    failed++;
  }
  if (!(fixed.lateA < kToleranceBeats)) {
    console.log('  FAIL: A never resettled, still off by ' + fixed.lateA.toFixed(3) + ' beats');
    failed++;
  }
  if (!(fixed.lateB < kToleranceBeats)) {
    console.log('  FAIL: B never resettled, still off by ' + fixed.lateB.toFixed(3) + ' beats');
    failed++;
  }

  console.log(failed === 0 ? 'tempo change: PASS' : `tempo change: FAIL (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

if (require.main === module) main();
module.exports = { run, worstOver, anchorBeats };
