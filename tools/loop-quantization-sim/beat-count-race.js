'use strict';

const { createLinkSession, createLinkPeer, registerPeer, setPhaseQuantum } = require('./link');
const {
  createWorld, stepOneSample, onPadPress, onPadRelease, msToSimSamples, SIM_SAMPLE_RATE,
} = require('./world');

const kHoldMs = 2000;
const kWatchMs = 40000;
const kStepMs = 50;
const kToleranceBeats = 0.05;

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
  return { a, b };
}

function advancePair(a, b, samples) {
  for (let i = 0; i < samples; i++) { stepOneSample(a); stepOneSample(b); }
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
  const { a, b } = makePair(120.0);
  a.beatsGuessEnabled = legacy;
  a.deferBeatsWrite = true;

  advancePair(a, b, msToSimSamples(300 + offsetMs));
  onPadPress(a, 0); onPadRelease(a, 0);
  advancePair(a, b, msToSimSamples(kHoldMs));
  onPadPress(a, 0); onPadRelease(a, 0);

  let settledMs = Infinity;
  let worst = 0;
  let elapsedMs = 0;
  for (let k = 0; k * kStepMs < kWatchMs; k++) {
    advancePair(a, b, msToSimSamples(kStepMs));
    elapsedMs += kStepMs;
    const want = trueTargetBeats(a);
    if (want === null) continue;
    const oneBeat = a.masterLenSamples / Math.max(1.0, a.recordedBeats);
    const have = a.masterPhaseSamples / oneBeat;
    const err = circularGap(have, want, a.recordedBeats);
    worst = Math.max(worst, err);
    if (settledMs === Infinity && err < kToleranceBeats) settledMs = elapsedMs;
  }
  return { settledMs, worst, beats: a.recordedBeats };
}

const kOffsets = [0, 1000, 2000, 3000, 4000, 5000, 6000, 7000];

function sweep(legacy) {
  let worst = 0;
  let settledMax = 0;
  let beats = 0;
  for (const off of kOffsets) {
    const r = runRace(legacy, off);
    worst = Math.max(worst, r.worst);
    settledMax = Math.max(settledMax, r.settledMs);
    beats = r.beats;
  }
  return { worst, settledMs: settledMax, beats };
}

function main() {
  let failed = 0;
  const legacy = sweep(true);
  const fixed = sweep(false);

  console.log('beat-count race: master_len lands before recorded_beats, audio thread preempts');
  console.log(`  beats=${fixed.beats}  phases swept=${kOffsets.length}`);
  console.log(`  legacy (folds on guessed 16 beats): settled after ${legacy.settledMs} ms, worst ${legacy.worst.toFixed(3)} beats`);
  console.log(`  fixed  (no target until beats real): settled after ${fixed.settledMs} ms, worst ${fixed.worst.toFixed(3)} beats`);

  if (!(legacy.worst > 0.25)) {
    console.log('  FAIL: legacy run never diverged, so this case does not reproduce the bug');
    failed++;
  }
  if (!(legacy.settledMs > 5000)) {
    console.log('  FAIL: legacy run recovered quickly, so this case does not reproduce the slow crawl');
    failed++;
  }
  if (!(fixed.settledMs <= 1000)) {
    console.log('  FAIL: fixed run still took ' + fixed.settledMs + ' ms to settle');
    failed++;
  }
  if (!(fixed.worst < 0.25)) {
    console.log('  FAIL: fixed run peaked at ' + fixed.worst.toFixed(3) + ' beats of error');
    failed++;
  }

  console.log(failed === 0 ? 'beat-count race: PASS' : `beat-count race: FAIL (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

if (require.main === module) main();
module.exports = { runRace, makePair };
