'use strict';

const {
  createLinkSession, createLinkPeer, registerPeer, setPhaseQuantum,
} = require('./link');
const {
  createWorld, stepOneSample, onPadPress, onPadRelease, msToSimSamples, SIM_SAMPLE_RATE,
} = require('./world');

const kHoldMs = 2000;
const kJumpBeats = 1.0;
const kJumpSettleMs = 250;
const kWatchMs = 12000;
const kStepMs = 50;
const kCycleTolerance = 1e-6;
const kDriftToleranceSamples = 8;
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

function shiftSessionPhase(session, beats) {
  session.gridOriginTimeMs -= (beats / session.tempo) * 60000;
}

function cyclesPerRepeat(w, looper) {
  const dsp = w.loopers[looper].dsp;
  const scale = dsp.beatScale || 1.0;
  return dsp.wlen / (scale * Math.max(1, w.masterLenSamples));
}

function wholeCyclesError(w, looper) {
  const c = cyclesPerRepeat(w, looper);
  return Math.abs(c - Math.round(c));
}

function readPos(w, looper) {
  return w.loopers[looper].dsp.rpos;
}

function run(leadMs) {
  setPhaseQuantum(128.0);
  const { session, a, b } = makePair(120.0);
  a.phaseLockEnabled = true;
  b.phaseLockEnabled = true;

  advancePair(a, b, msToSimSamples(leadMs));

  onPadPress(a, 0); onPadRelease(a, 0);
  advancePair(a, b, msToSimSamples(kHoldMs));
  onPadPress(a, 0); onPadRelease(a, 0);
  advancePair(a, b, msToSimSamples(600));
  const trimAtFinish0 = a.linkPhaseTrim;

  onPadPress(a, 1); onPadRelease(a, 1);
  advancePair(a, b, msToSimSamples(kHoldMs - kJumpSettleMs));
  shiftSessionPhase(session, kJumpBeats);
  advancePair(a, b, msToSimSamples(kJumpSettleMs));
  onPadPress(a, 1); onPadRelease(a, 1);
  const trimAtFinish1 = a.linkPhaseTrim;

  advancePair(a, b, msToSimSamples(400));

  const err0 = wholeCyclesError(a, 0);
  const err1 = wholeCyclesError(a, 1);
  const wrapLen = a.loopers[0].dsp.wlen;

  let prev0 = readPos(a, 0);
  let prev1 = readPos(a, 1);
  let unwrapped0 = prev0;
  let unwrapped1 = prev1;
  let driftMin = Infinity;
  let driftMax = -Infinity;
  for (let k = 0; k * kStepMs < kWatchMs; k++) {
    advancePair(a, b, msToSimSamples(kStepMs));
    const r0 = readPos(a, 0);
    const r1 = readPos(a, 1);
    if (r0 < prev0 - wrapLen * 0.5) unwrapped0 += wrapLen;
    if (r1 < prev1 - wrapLen * 0.5) unwrapped1 += wrapLen;
    prev0 = r0;
    prev1 = r1;
    const drift = (unwrapped0 + r0) - (unwrapped1 + r1);
    driftMin = Math.min(driftMin, drift);
    driftMax = Math.max(driftMax, drift);
  }

  return {
    err0,
    err1: Math.max(err1, wholeCyclesError(a, 1)),
    trimAtFinish0,
    trimAtFinish1,
    cycles1: cyclesPerRepeat(a, 1),
    drift: driftMax - driftMin,
    wlen0: a.loopers[0].dsp.wlen,
    wlen1: a.loopers[1].dsp.wlen,
    scale0: a.loopers[0].dsp.beatScale,
    scale1: a.loopers[1].dsp.beatScale,
  };
}

function worstOver() {
  const worst = { err0: 0, err1: 0, trim0: 0, trim1: 0, drift: 0, cycles1: 0, wlen0: 0, wlen1: 0, scale0: 0, scale1: 0 };
  for (const leadMs of kLeadOffsetsMs) {
    const r = run(leadMs);
    worst.err0 = Math.max(worst.err0, r.err0);
    worst.err1 = Math.max(worst.err1, r.err1);
    worst.trim0 = Math.max(worst.trim0, Math.abs(r.trimAtFinish0));
    worst.trim1 = Math.max(worst.trim1, Math.abs(r.trimAtFinish1));
    worst.drift = Math.max(worst.drift, r.drift);
    worst.cycles1 = r.cycles1;
    worst.wlen0 = r.wlen0;
    worst.wlen1 = r.wlen1;
    worst.scale0 = r.scale0;
    worst.scale1 = r.scale1;
  }
  return worst;
}

function main() {
  const w = worstOver();
  let failed = 0;
  console.log('two-take rate lock: takes finished at different phase-trim values must stay lined up');
  console.log(`  lead offsets=${kLeadOffsetsMs.join('/')}ms, session phase jumped ${kJumpBeats} beat before the second FINISH`);
  console.log(`  trim at the two finishes: ${w.trim0.toExponential(2)} / ${w.trim1.toExponential(2)}`);
  console.log(`  latched beat scale:       ${w.scale0.toFixed(9)} / ${w.scale1.toFixed(9)}`);
  console.log(`  take lengths: ${w.wlen0} / ${w.wlen1} samples`);
  console.log(`  second take repeats every ${w.cycles1.toFixed(9)} grid cycles`);
  console.log(`  read heads drifted ${w.drift.toFixed(1)} samples apart over ${(kWatchMs / 1000).toFixed(0)}s`);

  if (!(w.trim1 > 1e-3)) {
    console.log(`  FAIL: the trim only reached ${w.trim1.toExponential(2)} at the second finish, so this case does not exercise the latch`);
    failed++;
  }
  if (!(w.err0 < kCycleTolerance)) {
    console.log(`  FAIL: the first take repeats every ${w.err0.toExponential(2)} of a grid cycle off a whole number`);
    failed++;
  }
  if (!(w.err1 < kCycleTolerance)) {
    console.log(`  FAIL: the second take repeats every ${w.cycles1.toFixed(9)} grid cycles -- ${w.err1.toExponential(2)} off a whole number, so it slides out of phrase`);
    failed++;
  }
  if (!(w.scale0 > 0) || Math.abs(w.scale1 - w.scale0) > 1e-9) {
    console.log(`  FAIL: the two takes latched different beat scales (${w.scale0.toFixed(9)} vs ${w.scale1.toFixed(9)}) at one tempo -- the phase trim leaked into the ratio`);
    failed++;
  }
  if (Math.abs(w.wlen1 - w.wlen0) > 0.02 * Math.max(w.wlen0, w.wlen1)) {
    console.log(`  FAIL: two takes held for the same ${kHoldMs}ms came back ${w.wlen0} and ${w.wlen1} samples -- the trim moved the FINISH anchor tier`);
    failed++;
  }
  if (!(w.drift < kDriftToleranceSamples)) {
    console.log(`  FAIL: the two read heads drifted ${w.drift.toFixed(1)} samples apart -- they do not share a rate`);
    failed++;
  }

  console.log(failed === 0 ? 'two-take rate lock: PASS' : `two-take rate lock: FAIL (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

if (require.main === module) main();
module.exports = { run, worstOver, makePair, cyclesPerRepeat };
