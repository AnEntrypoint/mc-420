'use strict';

const { createLinkSession, createLinkPeer, registerPeer, setPhaseQuantum, beatAtTime } = require('./link');
const {
  createWorld, stepOneSample, onPadPress, onPadRelease, msToSimSamples, SIM_SAMPLE_RATE,
} = require('./world');

const kStaggerMs = 700;
const kSettleMs = 500;
const kWatchStepMs = 100;
const kWatchTotalMs = 120000;
const kCaptureQuantumBeats = 128.0;
const kFoldHoldBeats = 0.05;
const kFoldBugBeats = 0.25;

function makeSharedPair(initialBpm) {
  const session = createLinkSession(initialBpm);
  const peerA = createLinkPeer('A', session);
  const peerB = createLinkPeer('B', session);
  registerPeer(peerA);
  registerPeer(peerB);
  const a = createWorld({ looperCount: 4, initialLinkBpm: initialBpm });
  const b = createWorld({ looperCount: 4, initialLinkBpm: initialBpm });
  a.link = { session, local: peerA, remote: peerB };
  b.link = { session, local: peerB, remote: peerA };
  return { session, a, b };
}

function advancePair(a, b, samples) {
  for (let i = 0; i < samples; i++) { stepOneSample(a); stepOneSample(b); }
}

function nowMs(w) {
  return (w.t / SIM_SAMPLE_RATE) * 1000;
}

function beatPhase(w) {
  if (w.masterLenSamples <= 0 || w.recordedBeats < 1.0) return null;
  const beats = w.recordedBeats;
  return (w.masterPhaseSamples / w.masterLenSamples) * beats;
}

function circularGap(a, b, period) {
  let d = (a - b) % period;
  if (d < 0) d += period;
  return Math.min(d, period - d);
}

function gridError(w, session) {
  const p = beatPhase(w);
  if (p === null) return null;
  const beats = w.recordedBeats;
  const grid = ((beatAtTime(session, nowMs(w)) % beats) + beats) % beats;
  return circularGap(p, grid, beats);
}

function runFoldPair(opts) {
  const holdMs = opts.holdMs;
  setPhaseQuantum(opts.phaseQuantum === undefined ? kCaptureQuantumBeats : opts.phaseQuantum);
  const { session, a, b } = makeSharedPair(120.0);
  a.phaseLockEnabled = true;
  b.phaseLockEnabled = true;
  a.loopPhaseCapture = opts.loopPhaseCapture !== false;
  b.loopPhaseCapture = opts.loopPhaseCapture !== false;

  onPadPress(a, 0); onPadRelease(a, 0);
  advancePair(a, b, msToSimSamples(holdMs));
  onPadPress(a, 0); onPadRelease(a, 0);
  advancePair(a, b, msToSimSamples(kStaggerMs));

  onPadPress(b, 0); onPadRelease(b, 0);
  advancePair(a, b, msToSimSamples(holdMs));
  onPadPress(b, 0); onPadRelease(b, 0);
  advancePair(a, b, msToSimSamples(kSettleMs));

  const steps = Math.round(kWatchTotalMs / kWatchStepMs);
  let worstA = 0;
  let worstB = 0;
  let maxBeat = 0;
  for (let k = 0; k < steps; k++) {
    advancePair(a, b, msToSimSamples(kWatchStepMs));
    const ea = gridError(a, session);
    const eb = gridError(b, session);
    if (ea !== null && ea > worstA) worstA = ea;
    if (eb !== null && eb > worstB) worstB = eb;
    const nb = beatAtTime(session, nowMs(a));
    if (nb > maxBeat) maxBeat = nb;
  }
  return {
    worstA, worstB, maxBeat,
    beatsA: a.recordedBeats, beatsB: b.recordedBeats,
    label: opts.label,
  };
}

function main() {
  let failed = 0;
  console.log('[second-master: a second world creates its own master and re-imposes origin at phase 0; the device has no empty-slave adoption] loop-quantum fold');
  setPhaseQuantum(kCaptureQuantumBeats);

  for (const holdMs of [1500, 3000, 15000]) {
    const loopFold = runFoldPair({ holdMs, loopPhaseCapture: true, label: 'loop-quantum capture' });
    const quantum128 = runFoldPair({ holdMs, loopPhaseCapture: false, phaseQuantum: 128.0, label: '128-beat capture folded at rb' });
    const quantum16 = runFoldPair({ holdMs, loopPhaseCapture: false, phaseQuantum: 16.0, label: '16-beat capture folded at rb' });

    const beats = loopFold.beatsA;
    console.log(`hold ${holdMs}ms  beats=${loopFold.beatsA}/${loopFold.beatsB}  watched to beat ${loopFold.maxBeat.toFixed(1)}`);
    for (const r of [loopFold, quantum128, quantum16]) {
      console.log(`  ${r.label.padEnd(30)} A ${r.worstA.toFixed(3)} beats, B ${r.worstB.toFixed(3)} beats`);
    }

    if (loopFold.beatsA !== beats || loopFold.beatsB !== beats) {
      console.log('  FAIL: the two takes quantized to different lengths, grid is ambiguous');
      failed++;
    }
    if (kCaptureQuantumBeats % beats === 0) {
      console.log('  FAIL: rb divides the 128-beat capture quantum, case proves nothing');
      failed++;
    }
    if (!(loopFold.maxBeat > kCaptureQuantumBeats)) {
      console.log(`  FAIL: watch only reached beat ${loopFold.maxBeat.toFixed(1)}, never crossed the 128-beat capture quantum`);
      failed++;
    }
    if (!(loopFold.worstA < kFoldHoldBeats) || !(loopFold.worstB < kFoldHoldBeats)) {
      console.log(`  FAIL: loop-quantum fold off by A ${loopFold.worstA.toFixed(3)} / B ${loopFold.worstB.toFixed(3)} beats`);
      failed++;
    }
    if (!(Math.max(quantum128.worstA, quantum128.worstB) > kFoldBugBeats)) {
      console.log('  FAIL: 128-beat fold tracked the grid, so this case does not reproduce the fold bug');
      failed++;
    }
    if (!(Math.max(quantum16.worstA, quantum16.worstB) > kFoldBugBeats)) {
      console.log('  FAIL: 16-beat fold tracked the grid, so this case does not reproduce the fold bug');
      failed++;
    }
  }

  setPhaseQuantum(kCaptureQuantumBeats);
  console.log(failed === 0 ? 'loop-quantum fold: PASS' : `loop-quantum fold: FAIL (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

if (require.main === module) main();
module.exports = { runFoldPair, makeSharedPair };
