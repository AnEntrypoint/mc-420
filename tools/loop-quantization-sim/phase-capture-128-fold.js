'use strict';

const { setPhaseQuantum, beatAtTime } = require('./link');
const W = require('./world');

const kRecordedBeats = [3, 5, 6, 7];
const kCaptureQuantumBeats = 128.0;
const kBpm = 120.0;
const kHorizonBeats = 288.0;
const kStepSamples = 12;
const kCleanToleranceBeats = 1e-3;

function circularGap(a, b, period) {
  let d = (a - b) % period;
  if (d < 0) d += period;
  return Math.min(d, period - d);
}

function makeWorld(rb, fixed) {
  setPhaseQuantum(kCaptureQuantumBeats);
  const w = W.createWorld({ looperCount: 4, initialLinkBpm: kBpm });
  w.loopPhaseCapture = false;
  w.absolutePhaseFold = fixed;
  w.recordedBpm = kBpm;
  w.recordedBeats = rb;
  const beatSamples = (60.0 / kBpm) * W.SIM_SAMPLE_RATE;
  w.masterLenSamples = rb * beatSamples;
  return { w, beatSamples };
}

function measure(rb, fixed) {
  const { w, beatSamples } = makeWorld(rb, fixed);
  const oneBeat = w.masterLenSamples / rb;
  const stepBeats = kStepSamples / beatSamples;
  const horizon = W.msToSimSamples((kHorizonBeats * 60000) / kBpm);
  const wrapThreshold = -stepBeats * 2;
  let prevPos = null;
  let prevExpected = null;
  let maxMismatch = 0;
  let turnarounds = 0;
  let misplaced = 0;
  let worstTurnaround = 0;
  let lastBeat = 0;
  for (let t = kStepSamples; t <= horizon; t += kStepSamples) {
    w.t = t;
    W.refreshLinkSnapshot(w);
    const timeMs = (t / W.SIM_SAMPLE_RATE) * 1000;
    const target = W.linkTargetSamplesAt(w, timeMs * 1000);
    if (target === null) continue;
    const pos = target / oneBeat;
    const beat = beatAtTime(w.link.session, timeMs);
    const expected = ((beat % rb) + rb) % rb;
    lastBeat = beat;
    const mismatch = circularGap(pos, expected, rb);
    if (mismatch > maxMismatch) maxMismatch = mismatch;
    const gridWrap = prevExpected !== null && expected - prevExpected < wrapThreshold;
    const posWrap = prevPos !== null && pos - prevPos < wrapThreshold;
    if (posWrap) turnarounds++;
    if (gridWrap !== posWrap) {
      misplaced++;
      if (posWrap) {
        const phrase = Math.round(beat / rb) * rb;
        const off = Math.abs(beat - phrase);
        if (off > worstTurnaround) worstTurnaround = off;
      }
    }
    prevPos = pos;
    prevExpected = expected;
  }
  return { maxMismatch, turnarounds, misplaced, worstTurnaround, lastBeat };
}

function clean(r) {
  return r.maxMismatch <= kCleanToleranceBeats
    && r.misplaced === 0
    && r.turnarounds > 0
    && r.lastBeat >= kCaptureQuantumBeats;
}

function report(label, rb, r) {
  console.log(`  rb=${rb} ${label.padEnd(27)} mismatch=${r.maxMismatch.toFixed(4)}b turnarounds=${r.turnarounds} misplaced=${r.misplaced} off=${r.worstTurnaround.toFixed(4)}b horizon=${r.lastBeat.toFixed(1)}b ${clean(r) ? 'ok' : 'FAIL'}`);
}

function main() {
  const noFix = process.argv.includes('--no-fix');
  let failed = 0;
  console.log(`phase capture 128 fold: a ${kCaptureQuantumBeats}-beat phase capture folded at rb must turn around at the phrase boundary (rb=${kRecordedBeats.join('/')})`);
  for (const rb of kRecordedBeats) {
    if (kCaptureQuantumBeats % rb === 0) {
      console.log(`  rb=${rb} FAIL: rb divides ${kCaptureQuantumBeats}, case proves nothing`);
      failed++;
      continue;
    }
    const before = measure(rb, false);
    report('before: fold 128 at rb', rb, before);
    if (noFix) {
      if (!clean(before)) {
        console.log(`  rb=${rb} FAIL: current fold misplaces the turnaround`);
        failed++;
      }
    } else {
      const after = measure(rb, true);
      report('after: loop-quantum capture', rb, after);
      if (clean(before)) {
        console.log(`  rb=${rb} FAIL: current fold is already clean, case proves nothing`);
        failed++;
      }
      if (!clean(after)) {
        console.log(`  rb=${rb} FAIL: loop-quantum capture still misplaces the turnaround`);
        failed++;
      }
    }
  }
  const verdict = failed !== 0
    ? `phase capture 128 fold: FAIL (${failed})`
    : (noFix
      ? 'phase capture 128 fold: PASS'
      : 'phase capture 128 fold: PASS (before fold FAIL, after loop-quantum capture PASS)');
  console.log(verdict);
  process.exit(failed === 0 ? 0 : 1);
}

if (require.main === module) main();
module.exports = { measure, clean };
