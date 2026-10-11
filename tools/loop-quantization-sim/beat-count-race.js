'use strict';

const { createLinkSession, createLinkPeer, registerPeer, setPhaseQuantum, beatAtTime } = require('./link');
const {
  createWorld, stepOneSample, onPadPress, onPadRelease, msToSimSamples, SIM_SAMPLE_RATE,
} = require('./world');

const kHoldMs = 2000;
const kWatchMs = 40000;
const kStepMs = 50;
const kToleranceBeats = 0.05;
const kGapToleranceBeats = 0.25;
const kImposeWindowMs = 500;
const kSettleMsMax = 1000;

function makePair(bpm) {
  const session = createLinkSession(bpm);
  const peerA = createLinkPeer('A', session);
  const peerB = createLinkPeer('B', session);
  registerPeer(peerA);
  registerPeer(peerB);
  const a = createWorld({ looperCount: 4, initialLinkBpm: bpm });
  const b = createWorld({ looperCount: 4, initialLinkBpm: bpm });
  a.link = { session, local: peerA, remote: peerB };
  b.link = { session, local: peerB, remote: peerA };
  return { session, a, b };
}

function advancePair(a, b, samples) {
  for (let i = 0; i < samples; i++) { stepOneSample(a); stepOneSample(b); }
}

function sessionBeat(session, w) {
  return beatAtTime(session, (w.t / SIM_SAMPLE_RATE) * 1000);
}

function trueTargetBeats(w) {
  const s = w.linkSnapHeld;
  if (!s || !s.phaseValid || !(s.quantumMicroBeats > 0) || !(s.captureMicros > 0)) return null;
  const beats = w.recordedBeats;
  if (!(beats >= 1.0) || w.masterLenSamples <= 0) return null;
  const nowMicros = (w.t / SIM_SAMPLE_RATE) * 1e6;
  let elapsed = nowMicros - s.captureMicros;
  if (elapsed < 0) elapsed = 0;
  if (elapsed > 4e6) elapsed = 4e6;
  const phaseMicroBeats = s.beatPhaseMicroBeats + elapsed * (s.bpm / 60.0);
  let frac = phaseMicroBeats / s.quantumMicroBeats;
  frac -= Math.floor(frac);
  const linkBeat = frac * (s.quantumMicroBeats / 1e6);
  const loopBeatPos = ((linkBeat % beats) + beats) % beats;
  return loopBeatPos;
}

function circularGap(a, b, period) {
  let d = (a - b) % period;
  if (d < 0) d += period;
  return Math.min(d, period - d);
}

function runRace(legacy, offsetMs) {
  setPhaseQuantum(128.0);
  const { session, a, b } = makePair(120.0);
  a.beatsGuessEnabled = legacy;
  a.deferBeatsWrite = true;

  advancePair(a, b, msToSimSamples(300 + offsetMs));
  onPadPress(a, 0); onPadRelease(a, 0);
  advancePair(a, b, msToSimSamples(kHoldMs));
  onPadPress(a, 0); onPadRelease(a, 0);

  const baseSeq = session.rebaseSeq || 0;
  let settledMs = Infinity;
  let settledWorst = 0;
  let transientWorst = 0;
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
    const want = trueTargetBeats(a);
    if (want === null) continue;
    const oneBeat = a.masterLenSamples / Math.max(1.0, a.recordedBeats);
    const have = a.masterPhaseSamples / oneBeat;
    const err = circularGap(have, want, a.recordedBeats);
    if (elapsedMs >= kImposeWindowMs) {
      settledWorst = Math.max(settledWorst, err);
      if (settledMs === Infinity && err < kToleranceBeats) settledMs = elapsedMs;
    } else {
      transientWorst = Math.max(transientWorst, err);
    }
  }
  return {
    settledMs, settledWorst, transientWorst,
    rebaseAtMs, rebaseFromBeat, rebaseToBeat, rebaseSeqFrom, rebaseSeqTo,
    beats: a.recordedBeats,
  };
}

const kOffsets = [0, 1000, 2000, 3000, 4000, 5000, 6000, 7000];

function sweep(legacy) {
  let settledWorst = 0;
  let transientWorst = 0;
  let settledMax = 0;
  let rebaseMax = 0;
  let beats = 0;
  let missing = 0;
  let sample = null;
  for (const off of kOffsets) {
    const r = runRace(legacy, off);
    settledWorst = Math.max(settledWorst, r.settledWorst);
    transientWorst = Math.max(transientWorst, r.transientWorst);
    settledMax = Math.max(settledMax, r.settledMs);
    if (r.rebaseAtMs === null) missing++;
    else rebaseMax = Math.max(rebaseMax, r.rebaseAtMs);
    beats = r.beats;
    if (sample === null && r.rebaseAtMs !== null) sample = r;
  }
  return { settledWorst, transientWorst, settledMs: settledMax, rebaseMax, missing, beats, sample };
}

function reportRun(label, r) {
  const jump = r.sample === null
    ? 'no forceBeatAtTime landed in any phase, transient is unexplained'
    : `beat ${r.sample.rebaseFromBeat.toFixed(3)} -> ${r.sample.rebaseToBeat.toFixed(3)} (rebaseSeq ${r.sample.rebaseSeqFrom} -> ${r.sample.rebaseSeqTo}) landed ${r.rebaseMax} ms after A finish, worst over ${kOffsets.length} phases`;
  console.log(`  ${label}: settled from ${kImposeWindowMs} ms on: worst ${r.settledWorst.toFixed(3)} beats, settled after ${r.settledMs} ms`);
  console.log(`  ${label}: transient under ${kImposeWindowMs} ms:  worst ${r.transientWorst.toFixed(3)} beats`);
  console.log(`  ${label}: re-base: ${jump}`);
}

function checkRun(label, r) {
  let bad = 0;
  if (!(r.settledMs <= kSettleMsMax)) {
    console.log(`  FAIL: ${label} run still took ${r.settledMs} ms to settle`);
    bad++;
  }
  if (!(r.settledWorst < kGapToleranceBeats)) {
    console.log(`  FAIL: ${label} run peaked at ${r.settledWorst.toFixed(3)} beats of settled error`);
    bad++;
  }
  if (r.missing > 0) {
    console.log(`  FAIL: ${label} transient is not explained by a re-base in ${r.missing} of ${kOffsets.length} phases`);
    bad++;
  } else if (!(r.rebaseMax <= kImposeWindowMs)) {
    console.log(`  FAIL: ${label} re-base landed at ${r.rebaseMax} ms, past the ${kImposeWindowMs} ms impose window`);
    bad++;
  }
  return bad;
}

function main() {
  let failed = 0;
  const legacy = sweep(true);
  const fixed = sweep(false);

  console.log('beat-count race: master_len lands before recorded_beats, audio thread preempts');
  console.log(`  beats=${fixed.beats}  phases swept=${kOffsets.length}`);
  reportRun('legacy', legacy);
  reportRun('fixed ', fixed);

  failed += checkRun('legacy', legacy);
  failed += checkRun('fixed ', fixed);

  console.log(failed === 0 ? 'beat-count race: PASS' : `beat-count race: FAIL (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

if (require.main === module) main();
module.exports = { runRace, makePair };
