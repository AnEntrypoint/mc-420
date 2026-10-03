'use strict';

const {
  createLinkSession, createLinkPeer, registerPeer, setPhaseQuantum, beatAtTime,
} = require('./link');
const {
  createWorld, stepOneSample, onPadPress, onPadRelease, msToSimSamples, SIM_SAMPLE_RATE,
} = require('./world');

const kHoldMs = 2000;
const kStaggerMs = 700;
const kWatchMs = 20000;
const kStepMs = 50;
const kToleranceBeats = 0.05;
const kLeadOffsetsMs = [370, 610, 1130, 1790];

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
  return { session, peerA, peerB, a, b };
}

function advancePair(a, b, samples) {
  for (let i = 0; i < samples; i++) { stepOneSample(a); stepOneSample(b); }
}

function circGap(a, b, period) {
  let d = (a - b) % period;
  if (d < 0) d += period;
  return Math.min(d, period - d);
}

function readHeadError(w, session, looper) {
  if (w.masterLenSamples <= 0 || w.recordedBeats < 1.0) return null;
  const lp = w.loopers[looper];
  const dsp = lp.dsp;
  const oneBeat = w.masterLenSamples / w.recordedBeats;
  const loopBeatLen = oneBeat * dsp.beatScale;
  const loopBeats = Math.max(0.125, dsp.wlen / loopBeatLen);
  const rsmBeats = dsp.rsm / oneBeat;
  const originBeats = w.masterLooper === looper ? rsmBeats
    : (lp.armBeatAbs === null ? rsmBeats : lp.armBeatAbs);
  const contentBeat = originBeats + dsp.rpos / loopBeatLen;
  const nowBeats = beatAtTime(session, (w.t / SIM_SAMPLE_RATE) * 1000);
  return circGap(contentBeat, nowBeats, loopBeats);
}

function run(phaseLock, leadMs) {
  setPhaseQuantum(128.0);
  const { session, a, b } = makePair(120.0);
  a.phaseLockEnabled = phaseLock;
  b.phaseLockEnabled = phaseLock;

  advancePair(a, b, msToSimSamples(leadMs));

  onPadPress(a, 0); onPadRelease(a, 0);
  advancePair(a, b, msToSimSamples(kHoldMs));
  onPadPress(a, 0); onPadRelease(a, 0);
  advancePair(a, b, msToSimSamples(kStaggerMs));

  onPadPress(b, 0); onPadRelease(b, 0);
  advancePair(a, b, msToSimSamples(kHoldMs));
  onPadPress(b, 0); onPadRelease(b, 0);
  advancePair(a, b, msToSimSamples(500));

  let worstA = 0;
  let worstB = 0;
  for (let k = 0; k * kStepMs < kWatchMs; k++) {
    advancePair(a, b, msToSimSamples(kStepMs));
    const ea = readHeadError(a, session, 0);
    const eb = readHeadError(b, session, 0);
    if (ea !== null) worstA = Math.max(worstA, ea);
    if (eb !== null) worstB = Math.max(worstB, eb);
  }
  return { worstA, worstB, beatsA: a.recordedBeats, beatsB: b.recordedBeats };
}

function worstOver(phaseLock) {
  let worstA = 0;
  let worstB = 0;
  let beats = 0;
  for (const leadMs of kLeadOffsetsMs) {
    const r = run(phaseLock, leadMs);
    worstA = Math.max(worstA, r.worstA);
    worstB = Math.max(worstB, r.worstB);
    beats = r.beatsA;
  }
  return { worstA, worstB, beats };
}

function main() {
  let failed = 0;
  const legacy = worstOver(false);
  const fixed = worstOver(true);

  console.log('read-head lineup: each loop must sound the material belonging at this grid instant');
  console.log(`  beats=${fixed.beats}, lead offsets=${kLeadOffsetsMs.join('/')}ms`);
  console.log(`  legacy (no phase lock): A ${legacy.worstA.toFixed(3)} beats, B ${legacy.worstB.toFixed(3)} beats`);
  console.log(`  fixed  (phase lock):    A ${fixed.worstA.toFixed(3)} beats, B ${fixed.worstB.toFixed(3)} beats`);

  if (!(legacy.worstA > kToleranceBeats || legacy.worstB > kToleranceBeats)) {
    console.log('  FAIL: legacy run tracked the grid, so this case does not exercise the read head');
    failed++;
  }
  if (!(fixed.worstA < kToleranceBeats)) {
    console.log('  FAIL: fixed run, A read head off by ' + fixed.worstA.toFixed(3) + ' beats');
    failed++;
  }
  if (!(fixed.worstB < kToleranceBeats)) {
    console.log('  FAIL: fixed run, B read head off by ' + fixed.worstB.toFixed(3) + ' beats');
    failed++;
  }

  console.log(failed === 0 ? 'read-head lineup: PASS' : `read-head lineup: FAIL (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

if (require.main === module) main();
module.exports = { run, worstOver, makePair, readHeadError };
