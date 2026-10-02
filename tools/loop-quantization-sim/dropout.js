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
const kDropoutMs = 3000;
const kWatchMs = 25000;
const kStepMs = 50;
const kToleranceBeats = 0.05;
const kNewTempo = 100.0;

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

function run(resnapOnReconnect) {
  setPhaseQuantum(128.0);
  const { session, peerA, peerB, a, b } = makePair(120.0);
  a.resnapOnReconnect = resnapOnReconnect;
  b.resnapOnReconnect = resnapOnReconnect;

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

  peerA.connected = false;
  peerB.connected = false;
  setTempoContinuous(session, kNewTempo, (a.t / SIM_SAMPLE_RATE) * 1000);
  advancePair(a, b, msToSimSamples(kDropoutMs));

  peerA.connected = true;
  peerB.connected = true;

  let settledMs = Infinity;
  let worst = 0;
  let worstGap = 0;
  let elapsedMs = 0;
  for (let k = 0; k * kStepMs < kWatchMs; k++) {
    advancePair(a, b, msToSimSamples(kStepMs));
    elapsedMs += kStepMs;
    const ea = readHeadError(a, session, 0);
    const eb = readHeadError(b, session, 0);
    if (ea !== null) worst = Math.max(worst, ea);
    if (eb !== null) worst = Math.max(worst, eb);
    const pa = anchorBeats(a);
    const pb = anchorBeats(b);
    if (pa !== null && pb !== null) {
      worstGap = Math.max(worstGap, circGap(pa, pb, a.recordedBeats));
    }
    if (settledMs === Infinity && ea !== null && ea < kToleranceBeats
        && eb !== null && eb < kToleranceBeats) settledMs = elapsedMs;
  }
  return { settledMs, worst, worstGap, worstBeforeA, worstBeforeB, beatsA: a.recordedBeats };
}

function main() {
  let failed = 0;
  const legacy = run(false);
  const fixed = run(true);

  console.log('dropout: mesh retunes while the link is down, then reconnects');
  console.log(`  beats=${fixed.beatsA}, blackout ${kDropoutMs}ms at ${kNewTempo} BPM`);
  console.log(`  locked before:  A ${fixed.worstBeforeA.toFixed(3)} beats, B ${fixed.worstBeforeB.toFixed(3)} beats`);
  console.log(`  legacy (no re-snap on reconnect): settled after ${legacy.settledMs} ms, worst ${legacy.worst.toFixed(3)} beats, gap ${legacy.worstGap.toFixed(3)}`);
  console.log(`  fixed  (re-snaps on reconnect):   settled after ${fixed.settledMs} ms, worst ${fixed.worst.toFixed(3)} beats, gap ${fixed.worstGap.toFixed(3)}`);

  if (!(fixed.worstBeforeA < kToleranceBeats && fixed.worstBeforeB < kToleranceBeats)) {
    console.log('  FAIL: not locked before the dropout, so the reconnect is not isolated');
    failed++;
  }
  if (!(legacy.settledMs > 5000)) {
    console.log('  FAIL: legacy run settled quickly, so this case does not exercise the re-snap');
    failed++;
  }
  if (!(fixed.settledMs <= 1000)) {
    console.log('  FAIL: fixed run still took ' + fixed.settledMs + ' ms to resettle');
    failed++;
  }
  if (!(fixed.worstGap < kToleranceBeats)) {
    console.log('  FAIL: A/B anchors drifted ' + fixed.worstGap.toFixed(3) + ' beats apart');
    failed++;
  }

  console.log(failed === 0 ? 'dropout: PASS' : `dropout: FAIL (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

if (require.main === module) main();
module.exports = { run, anchorBeats };
