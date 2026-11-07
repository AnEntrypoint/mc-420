'use strict';

const { setPhaseQuantum, beatAtTime, requestPhaseImpose, applyPendingPhaseImpose } = require('./link');
const W = require('./world');

const kRecordedBeats = [3, 5, 6, 7];
const kCaptureQuantumBeats = 128.0;
const kBpm = 120.0;
const kCaptureBeat = 10.0;
const kRebaseDeltaBeats = 134.0;
const kSettleBeat = 160.0;
const kCleanToleranceBeats = 1e-3;

function circularGap(a, b, period) {
  let d = (a - b) % period;
  if (d < 0) d += period;
  return Math.min(d, period - d);
}

function wrappedForward(from, to, period) {
  let d = (to - from) % period;
  if (d < 0) d += period;
  return d;
}

function makeWorld(rb, fixed) {
  setPhaseQuantum(kCaptureQuantumBeats);
  const w = W.createWorld({ looperCount: 4, initialLinkBpm: kBpm });
  w.loopPhaseCapture = fixed;
  w.absolutePhaseFold = false;
  w.recordedBpm = kBpm;
  w.recordedBeats = rb;
  w.link.remote.connected = true;
  const beatSamples = (60.0 / kBpm) * W.SIM_SAMPLE_RATE;
  w.masterLenSamples = rb * beatSamples;
  return { w, beatSamples };
}

function beatToMs(beat) {
  return (beat * 60000) / kBpm;
}

function gridPhase(session, tMs, rb) {
  const b = beatAtTime(session, tMs);
  return ((b % rb) + rb) % rb;
}

function freshSnapshotGap(rb, fixed, tMs) {
  const { w, beatSamples } = makeWorld(rb, fixed);
  const oneBeat = w.masterLenSamples / rb;
  w.t = W.msToSimSamples(tMs);
  W.refreshLinkSnapshot(w);
  const pos = W.linkTargetSamplesAt(w, tMs * 1000) / oneBeat;
  return circularGap(pos, gridPhase(w.link.session, tMs, rb), rb);
}

function measure(rb, fixed) {
  const { w, beatSamples } = makeWorld(rb, fixed);
  const oneBeat = w.masterLenSamples / rb;
  const t0Ms = beatToMs(kCaptureBeat);
  const t1Ms = beatToMs(kSettleBeat);
  w.t = W.msToSimSamples(t0Ms);
  W.refreshLinkSnapshot(w);
  const beforePos = W.linkTargetSamplesAt(w, t0Ms * 1000) / oneBeat;
  const beforeGrid = gridPhase(w.link.session, t0Ms, rb);
  const seqBefore = w.link.session.rebaseSeq || 0;
  const rebaseTarget = kCaptureBeat + kRebaseDeltaBeats;
  requestPhaseImpose(w.link.session, rebaseTarget, t0Ms, kCaptureQuantumBeats, w.link.local);
  applyPendingPhaseImpose(w.link.session);
  const seqAfter = w.link.session.rebaseSeq || 0;
  W.refreshLinkSnapshot(w);
  const afterPos = W.linkTargetSamplesAt(w, t0Ms * 1000) / oneBeat;
  const afterGrid = gridPhase(w.link.session, t0Ms, rb);
  w.t = W.msToSimSamples(t1Ms);
  W.refreshLinkSnapshot(w);
  const settledPos = W.linkTargetSamplesAt(w, t1Ms * 1000) / oneBeat;
  const settledGrid = gridPhase(w.link.session, t1Ms, rb);
  const beforeGap = circularGap(beforePos, beforeGrid, rb);
  const afterGap = circularGap(afterPos, afterGrid, rb);
  const settledGap = circularGap(settledPos, settledGrid, rb);
  const freshGap = freshSnapshotGap(rb, fixed, t1Ms);
  const expectedShift = wrappedForward(beforeGrid, afterGrid, rb);
  const actualShift = wrappedForward(beforePos, afterPos, rb);
  const shiftGap = circularGap(actualShift, expectedShift, rb);
  const forbiddenShift = ((-kRebaseDeltaBeats % rb) + rb) % rb;
  const forbiddenGap = circularGap(actualShift, forbiddenShift, rb);
  const rebaseHappened = seqAfter === seqBefore + 1;
  const clean = beforeGap <= kCleanToleranceBeats
    && afterGap <= kCleanToleranceBeats
    && settledGap <= kCleanToleranceBeats
    && freshGap <= kCleanToleranceBeats
    && shiftGap <= kCleanToleranceBeats
    && forbiddenGap > kCleanToleranceBeats
    && rebaseHappened;
  return { beforeGap, afterGap, settledGap, freshGap, shiftGap, forbiddenGap, rebaseHappened, clean };
}

function report(rb, r) {
  console.log(`  rb=${rb} before=${r.beforeGap.toFixed(4)}b after=${r.afterGap.toFixed(4)}b settled=${r.settledGap.toFixed(4)}b fresh=${r.freshGap.toFixed(4)}b shift=${r.shiftGap.toFixed(4)}b forbiddenGap=${r.forbiddenGap.toFixed(4)}b rebase=${r.rebaseHappened} ${r.clean ? `ok` : `FAIL`}`);
}

function main() {
  const noFix = process.argv.includes(`--no-fix`);
  let clean = 0;
  let shifted = 0;
  console.log(`phase capture 128 rebase: a rebase or fresh snapshot must not shift loopBeatPos by (-dBeat mod rb) (rb=${kRecordedBeats.join(`/`)}, dBeat=${kRebaseDeltaBeats})`);
  for (const rb of kRecordedBeats) {
    const r = measure(rb, !noFix);
    report(rb, r);
    if (r.clean) clean++;
    else shifted++;
  }
  if (noFix) {
    const verdict = shifted === kRecordedBeats.length
      ? `control FAIL (defect reproduced at ${shifted}/${kRecordedBeats.length} rb, exit 1 as required)`
      : `control FAIL (defect reproduced at only ${shifted}/${kRecordedBeats.length} rb, control is weak)`;
    console.log(`phase capture 128 rebase: ${verdict}`);
    process.exit(1);
  }
  console.log(shifted === 0
    ? `phase capture 128 rebase: PASS (${clean}/${kRecordedBeats.length} rb stay on the grid across a rebase and a fresh snapshot)`
    : `phase capture 128 rebase: FAIL (${shifted} rb shifted off the grid)`);
  process.exit(shifted === 0 ? 0 : 1);
}

if (require.main === module) main();
module.exports = { measure, circularGap, wrappedForward };
