'use strict';

const { createLinkSession, createLinkPeer, registerPeer, setPhaseQuantum } = require('./link');
const {
  createWorld, stepOneSample, onPadPress, onPadRelease, msToSimSamples,
} = require('./world');

const kHoldMs = 2000;
const kStaggerMs = 500;
const kWatchMs = 60000;
const kStepMs = 100;
const kToleranceBeats = 0.05;

function makeLatePair(bpm) {
  const session = createLinkSession(bpm);
  const peerA = createLinkPeer('A', session);
  const peerB = createLinkPeer('B', session);
  registerPeer(peerA);
  registerPeer(peerB);
  peerA.connected = false;
  peerB.connected = false;
  const a = createWorld({ looperCount: 4, initialLinkBpm: bpm });
  const b = createWorld({ looperCount: 4, initialLinkBpm: bpm });
  a.link = { session, local: peerA, remote: peerB };
  b.link = { session, local: peerB, remote: peerA };
  return { peerA, peerB, a, b };
}

function advancePair(a, b, samples) {
  for (let i = 0; i < samples; i++) { stepOneSample(a); stepOneSample(b); }
}

function beatPhase(w) {
  if (w.masterLenSamples <= 0) return null;
  const beats = Math.max(1, w.recordedBeats);
  return (w.masterPhaseSamples / w.masterLenSamples) * beats;
}

function circularGap(a, b, period) {
  let d = (a - b) % period;
  if (d < 0) d += period;
  return Math.min(d, period - d);
}

function runLatePair(joinSnap) {
  setPhaseQuantum(128.0);
  const { peerA, peerB, a, b } = makeLatePair(120.0);
  a.joinSnapEnabled = joinSnap;
  b.joinSnapEnabled = joinSnap;

  advancePair(a, b, msToSimSamples(300));

  onPadPress(a, 0); onPadRelease(a, 0);
  advancePair(a, b, msToSimSamples(kHoldMs));
  onPadPress(a, 0); onPadRelease(a, 0);
  advancePair(a, b, msToSimSamples(kStaggerMs));

  peerA.connected = true;
  peerB.connected = true;
  advancePair(a, b, msToSimSamples(200));

  const joinPhaseA = beatPhase(a);
  const joinPhaseB = beatPhase(b);

  onPadPress(b, 0); onPadRelease(b, 0);
  advancePair(a, b, msToSimSamples(kHoldMs));
  onPadPress(b, 0); onPadRelease(b, 0);

  const period = Math.max(1, Math.min(a.recordedBeats, b.recordedBeats));
  let settledMs = Infinity;
  let worst = 0;
  let elapsedMs = 0;
  for (let k = 0; k * kStepMs < kWatchMs; k++) {
    advancePair(a, b, msToSimSamples(kStepMs));
    elapsedMs += kStepMs;
    const pa = beatPhase(a);
    const pb = beatPhase(b);
    if (pa === null || pb === null) continue;
    const gap = circularGap(pa, pb, period);
    worst = Math.max(worst, gap);
    if (settledMs === Infinity && gap < kToleranceBeats) settledMs = elapsedMs;
  }
  return { settledMs, worst, joinPhaseA, joinPhaseB, beatsA: a.recordedBeats, beatsB: b.recordedBeats };
}

function main() {
  let failed = 0;
  const legacy = runLatePair(false);
  const fixed = runLatePair(true);

  console.log(`late join: A records and plays standalone, then B connects and records`);
  console.log(`  beats=${fixed.beatsA}/${fixed.beatsB}`);
  console.log(`  legacy (no snap on join): settled after ${legacy.settledMs} ms, worst gap ${legacy.worst.toFixed(3)} beats`);
  console.log(`  fixed  (snap on join):    settled after ${fixed.settledMs} ms, worst gap ${fixed.worst.toFixed(3)} beats`);

  if (!(legacy.settledMs > 5000)) {
    console.log('  FAIL: legacy run settled quickly, so this case does not reproduce the slow crawl');
    failed++;
  }
  if (!(fixed.settledMs <= 1000)) {
    console.log('  FAIL: fixed run still took ' + fixed.settledMs + ' ms to settle');
    failed++;
  }
  if (!(fixed.worst < 0.25)) {
    console.log('  FAIL: fixed run peaked at ' + fixed.worst.toFixed(3) + ' beats of drift');
    failed++;
  }

  console.log(failed === 0 ? 'late join: PASS' : `late join: FAIL (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

if (require.main === module) main();
module.exports = { runLatePair, makeLatePair };
