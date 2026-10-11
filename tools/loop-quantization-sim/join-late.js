'use strict';

const { readHeadError } = require('./read-head-lineup');

const { createLinkSession, createLinkPeer, registerPeer, setPhaseQuantum, beatAtTime } = require('./link');
const {
  createWorld, stepOneSample, onPadPress, onPadRelease, msToSimSamples, SIM_SAMPLE_RATE,
} = require('./world');

const kHoldMs = 2000;
const kStaggerMs = 500;
const kWatchMs = 60000;
const kStepMs = 100;
const kToleranceBeats = 0.05;
const kGapToleranceBeats = 0.25;
const kImposeWindowMs = 500;
const kSettleMsMax = 1000;

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
  return { session, peerA, peerB, a, b };
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

function sessionBeat(session, w) {
  return beatAtTime(session, (w.t / SIM_SAMPLE_RATE) * 1000);
}

function runLatePair(joinSnap) {
  setPhaseQuantum(128.0);
  const { session, peerA, peerB, a, b } = makeLatePair(120.0);
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
  const baseSeq = session.rebaseSeq || 0;
  let settledMs = Infinity;
  let settledGap = 0;
  let transientGap = 0;
  let settledReadA = 0;
  let settledReadB = 0;
  let transientReadA = 0;
  let transientReadB = 0;
  let rebaseAtMs = null;
  let rebaseFromBeat = null;
  let rebaseToBeat = null;
  let rebaseSeqFrom = null;
  let rebaseSeqTo = null;
  let prevBeat = sessionBeat(session, a);
  let elapsedMs = 0;
  for (let k = 0; k * kStepMs < kWatchMs; k++) {
    advancePair(a, b, msToSimSamples(kStepMs));
    elapsedMs += kStepMs;
    const nowBeat = sessionBeat(session, a);
    const seq = session.rebaseSeq || 0;
    if (rebaseAtMs === null && seq !== baseSeq) {
      rebaseAtMs = elapsedMs;
      rebaseFromBeat = prevBeat;
      rebaseToBeat = nowBeat;
      rebaseSeqFrom = baseSeq;
      rebaseSeqTo = seq;
    }
    prevBeat = nowBeat;
    const pa = beatPhase(a);
    const pb = beatPhase(b);
    if (pa === null || pb === null) continue;
    const gap = circularGap(pa, pb, period);
    if (settledMs === Infinity && gap < kToleranceBeats) settledMs = elapsedMs;
    const ra = readHeadError(a, session, 0);
    const rb = readHeadError(b, session, 0);
    if (elapsedMs >= kImposeWindowMs) {
      settledGap = Math.max(settledGap, gap);
      if (ra !== null) settledReadA = Math.max(settledReadA, ra);
      if (rb !== null) settledReadB = Math.max(settledReadB, rb);
    } else {
      transientGap = Math.max(transientGap, gap);
      if (ra !== null) transientReadA = Math.max(transientReadA, ra);
      if (rb !== null) transientReadB = Math.max(transientReadB, rb);
    }
  }
  return {
    settledMs, settledGap, transientGap,
    settledReadA, settledReadB, transientReadA, transientReadB,
    rebaseAtMs, rebaseFromBeat, rebaseToBeat, rebaseSeqFrom, rebaseSeqTo,
    joinPhaseA, joinPhaseB, beatsA: a.recordedBeats, beatsB: b.recordedBeats,
  };
}

function reportRun(label, r) {
  const jump = r.rebaseAtMs === null
    ? 'no forceBeatAtTime landed, transient is unexplained'
    : `beat ${r.rebaseFromBeat.toFixed(3)} -> ${r.rebaseToBeat.toFixed(3)} (rebaseSeq ${r.rebaseSeqFrom} -> ${r.rebaseSeqTo}) landed ${r.rebaseAtMs} ms after B finish`;
  console.log(`  ${label}: settled from ${kImposeWindowMs} ms on: gap ${r.settledGap.toFixed(3)} beats, read A ${r.settledReadA.toFixed(3)} beats, read B ${r.settledReadB.toFixed(3)} beats`);
  console.log(`  ${label}: transient under ${kImposeWindowMs} ms:  gap ${r.transientGap.toFixed(3)} beats, read A ${r.transientReadA.toFixed(3)} beats, read B ${r.transientReadB.toFixed(3)} beats`);
  console.log(`  ${label}: re-base: ${jump}`);
}

function checkRun(label, r) {
  let bad = 0;
  if (!(r.settledMs <= kSettleMsMax)) {
    console.log(`  FAIL: ${label} took ${r.settledMs} ms to settle`);
    bad++;
  }
  if (!(r.settledGap < kGapToleranceBeats)) {
    console.log(`  FAIL: ${label} settled gap ${r.settledGap.toFixed(3)} beats`);
    bad++;
  }
  if (!(r.settledReadA < kToleranceBeats)) {
    console.log(`  FAIL: ${label} A read head settled off by ${r.settledReadA.toFixed(3)} beats`);
    bad++;
  }
  if (!(r.settledReadB < kToleranceBeats)) {
    console.log(`  FAIL: ${label} B read head settled off by ${r.settledReadB.toFixed(3)} beats`);
    bad++;
  }
  if (r.rebaseAtMs === null) {
    console.log(`  FAIL: ${label} transient is not explained by a re-base, no forceBeatAtTime landed`);
    bad++;
  } else if (!(r.rebaseAtMs <= kImposeWindowMs)) {
    console.log(`  FAIL: ${label} re-base landed at ${r.rebaseAtMs} ms, past the ${kImposeWindowMs} ms impose window`);
    bad++;
  }
  return bad;
}

function main() {
  let failed = 0;
  const legacy = runLatePair(false);
  const fixed = runLatePair(true);

  console.log('late join: A records and plays standalone, then B connects and records');
  console.log(`  beats=${fixed.beatsA}/${fixed.beatsB}`);
  console.log(`  legacy (no snap on join): settled after ${legacy.settledMs} ms`);
  console.log(`  fixed  (snap on join):    settled after ${fixed.settledMs} ms`);
  reportRun('legacy', legacy);
  reportRun('fixed ', fixed);

  failed += checkRun('legacy', legacy);
  failed += checkRun('fixed ', fixed);

  console.log(failed === 0 ? 'late join: PASS' : `late join: FAIL (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

if (require.main === module) main();
module.exports = { runLatePair, makeLatePair };
