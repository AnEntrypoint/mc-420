'use strict';

const { createLinkSession, createLinkPeer, registerPeer, setPhaseQuantum } = require('./link');
const {
  createWorld, stepOneSample, onPadPress, onPadRelease, msToSimSamples,
} = require('./world');

const kStaggerMs = 700;

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

function beatPhase(w) {
  if (w.masterLenSamples <= 0) return null;
  const beats = Math.max(1, w.recordedBeats);
  return (w.masterPhaseSamples / w.masterLenSamples) * beats;
}

function beatGcd(a, b) {
  let x = Math.max(1, Math.round(a));
  let y = Math.max(1, Math.round(b));
  while (y > 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return Math.max(1, x);
}

function circularGap(a, b, period) {
  let d = (a - b) % period;
  if (d < 0) d += period;
  return Math.min(d, period - d);
}

function runPair(opts) {
  const holdMs = opts.holdMs;
  const holdMsB = opts.holdMsB === undefined ? holdMs : opts.holdMsB;
  const staggerMs = opts.staggerMs === undefined ? kStaggerMs : opts.staggerMs;
  setPhaseQuantum(opts.phaseQuantum === undefined ? 128.0 : opts.phaseQuantum);
  const { a, b } = makeSharedPair(120.0);
  a.phaseLockEnabled = opts.phaseLock !== false;
  b.phaseLockEnabled = opts.phaseLock !== false;
  a.loopPhaseCapture = opts.loopPhaseCapture !== false;
  b.loopPhaseCapture = opts.loopPhaseCapture !== false;

  onPadPress(a, 0); onPadRelease(a, 0);
  advancePair(a, b, msToSimSamples(holdMs));
  onPadPress(a, 0); onPadRelease(a, 0);
  advancePair(a, b, msToSimSamples(staggerMs));

  onPadPress(b, 0); onPadRelease(b, 0);
  advancePair(a, b, msToSimSamples(holdMsB));
  onPadPress(b, 0); onPadRelease(b, 0);
  advancePair(a, b, msToSimSamples(500));

  const period = beatGcd(a.recordedBeats, b.recordedBeats);
  let worst = 0;
  let samples = 0;
  for (let k = 0; k < 40; k++) {
    advancePair(a, b, msToSimSamples(100));
    const pa = beatPhase(a);
    const pb = beatPhase(b);
    if (pa === null || pb === null) return { worst: NaN, samples };
    worst = Math.max(worst, circularGap(pa, pb, period));
    samples += msToSimSamples(100);
  }
  return { worst, samples, period, beatsA: a.recordedBeats, beatsB: b.recordedBeats };
}

function main() {
  let failed = 0;
  setPhaseQuantum(128.0);

  for (const holdMs of [2000, 1500, 2600]) {
    const legacy = runPair({ holdMs, phaseLock: false, loopPhaseCapture: false });
    const fixed = runPair({ holdMs, phaseLock: true });

    const legacyBad = !(legacy.worst < 0.25);
    const fixedGood = fixed.worst < 0.05;

    console.log(`hold ${holdMs}ms  beats=${fixed.beatsA}/${fixed.beatsB}  shared grid=${fixed.period} beats`);
    console.log(`  legacy (trim not applied to anchor): worst gap = ${legacy.worst.toFixed(3)} beats`);
    console.log(`  fixed  (trim + idle/creation snap):  worst gap = ${fixed.worst.toFixed(3)} beats`);

    if (!legacyBad) {
      console.log('  FAIL: legacy run converged, so this test does not reproduce the bug');
      failed++;
    }
    if (!fixedGood) {
      console.log('  FAIL: fixed run still off by ' + fixed.worst.toFixed(3) + ' beats');
      failed++;
    }
  }

  for (const asym of [[4000, 1000, 700], [1000, 4000, 700], [2000, 500, 700], [2600, 1300, 1100]]) {
    const holdA = asym[0];
    const holdB = asym[1];
    const stagger = asym[2];
    const legacy = runPair({ holdMs: holdA, holdMsB: holdB, staggerMs: stagger, phaseLock: false, loopPhaseCapture: false });
    const fixed = runPair({ holdMs: holdA, holdMsB: holdB, staggerMs: stagger, phaseLock: true });

    console.log(`asymmetric hold ${holdA}ms/${holdB}ms  beats=${fixed.beatsA}/${fixed.beatsB}  shared grid=${fixed.period} beats`);
    console.log(`  legacy (trim not applied to anchor): worst gap = ${legacy.worst.toFixed(3)} beats`);
    console.log(`  fixed  (trim + idle/creation snap):  worst gap = ${fixed.worst.toFixed(3)} beats`);

    if (fixed.beatsA === fixed.beatsB) {
      console.log('  FAIL: both takes quantized to the same length, case proves nothing');
      failed++;
    }
    if (!(legacy.worst > 0.25)) {
      console.log('  FAIL: legacy run converged, so this case does not reproduce the bug');
      failed++;
    }
    if (!(fixed.worst < 0.05)) {
      console.log('  FAIL: fixed run still off by ' + fixed.worst.toFixed(3) + ' beats');
      failed++;
    }
  }

  const longHoldMs = 15000;
  const longStaggerMs = 5000;
  const longLegacy = runPair({ holdMs: longHoldMs, staggerMs: longStaggerMs, phaseLock: true, phaseQuantum: 16.0, loopPhaseCapture: false });
  const longFixed = runPair({ holdMs: longHoldMs, staggerMs: longStaggerMs, phaseLock: true, phaseQuantum: 128.0 });
  const longPeriod = Math.max(1, longFixed.beatsA);

  console.log(`hold ${longHoldMs}ms beats=${longFixed.beatsA}/${longFixed.beatsB} (loop longer than the 16-beat Link quantum)`);
  console.log(`  legacy (phase captured at quantum 16):  worst gap = ${longLegacy.worst.toFixed(3)} beats`);
  console.log(`  fixed  (phase captured at quantum 128): worst gap = ${longFixed.worst.toFixed(3)} beats`);

  if (longFixed.beatsA <= 16.0) {
    console.log('  FAIL: long take did not quantize past the 16-beat quantum, test proves nothing');
    failed++;
  }
  if (!(longLegacy.worst > 1.0)) {
    console.log('  FAIL: quantum-16 run converged, so this test does not reproduce the bug');
    failed++;
  }
  if (!(longFixed.worst < 0.05)) {
    console.log('  FAIL: quantum-128 run still off by ' + longFixed.worst.toFixed(3) + ' beats');
    failed++;
  }

  setPhaseQuantum(128.0);
  console.log(failed === 0 ? 'two-device sync: PASS' : `two-device sync: FAIL (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

if (require.main === module) main();
module.exports = { runPair, makeSharedPair };
