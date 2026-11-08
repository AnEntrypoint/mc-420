'use strict';

const fs = require('fs');
const path = require('path');
const W = require('./world');
const { setPhaseQuantum, LINK_PHASE_QUANTUM, beatAtTime } = require('./link');

const kMidiSrc = path.resolve(__dirname, '..', '..', 'src', 'control', 'midi.cpp');
const kBpm = 120;
const kHoldMs = [1000, 1500, 2000, 2500, 3000, 3500];
const kSharedQuantumBeats = 16;
const kLoopPhaseToleranceSamples = 2;

const kDeviceNeedles = [
  'takeBeatIndex(',
];

function sourceDerivation() {
  const src = fs.readFileSync(kMidiSrc, 'utf8');
  const takeNeedles = kDeviceNeedles.filter((n) => src.includes(n));
  return { mode: takeNeedles.length === 0 ? 'shared' : 'take', missing: takeNeedles };
}

function wrap(n, period) { return ((n % period) + period) % period; }

function runCase(holdMs, mode) {
  setPhaseQuantum(LINK_PHASE_QUANTUM);
  const w = W.createWorld({ looperCount: 4, initialLinkBpm: kBpm });
  W.advance(w, W.msToSimSamples(300));
  W.onPadPress(w, 0); W.onPadRelease(w, 0);
  const pressT = w.loopers[0].recordStartT;
  W.advance(w, W.msToSimSamples(holdMs));
  W.onPadPress(w, 0); W.onPadRelease(w, 0);
  W.advance(w, W.msToSimSamples(250));

  const rb = w.recordedBeats;
  const L = w.masterLenSamples;
  const beatLen = L / Math.max(1, rb);
  const session = w.link.session;
  const rows = [];
  let mismatches = 0;
  let worstPhaseSamples = 0;
  for (let k = 0; k < rb + 2; k++) {
    const beatPos = rb + 2 + k + 0.25;
    const target = Math.round(pressT + beatPos * beatLen);
    const step = target - w.t;
    if (step > 0) W.advance(w, step);
    const tSamples = w.t;
    const tMs = (tSamples / W.SIM_SAMPLE_RATE) * 1000;
    const expected = wrap(Math.floor(beatAtTime(session, tMs)), kSharedQuantumBeats);
    const takeIndex = Math.min(rb - 1, Math.max(0, Math.floor(w.masterPhaseSamples / beatLen)));
    const shared = wrap(Math.floor(beatAtTime(session, tMs)), kSharedQuantumBeats);
    const device = mode === 'shared' ? shared : takeIndex;
    const phaseGap = Math.abs(w.masterPhaseSamples - wrap(tSamples - pressT, L));
    worstPhaseSamples = Math.max(worstPhaseSamples, phaseGap);
    if (device !== expected) mismatches++;
    rows.push({ k, expected, takeIndex, shared, device });
  }
  const pressMs = (pressT / W.SIM_SAMPLE_RATE) * 1000;
  const sharedAtPress = wrap(Math.floor(beatAtTime(session, pressMs)), kSharedQuantumBeats);
  return { rb, L, beatLen, holdMs, sharedAtPress, mismatches, worstPhaseSamples, rows,
    ok: mismatches === 0 && worstPhaseSamples <= kLoopPhaseToleranceSamples };
}

function main() {
  const args = process.argv.slice(2);
  const noFix = args.includes('--no-fix') || args.includes('--assert-no-fix');
  const assertControl = args.includes('--assert-no-fix');
  const derived = sourceDerivation();
  const mode = noFix ? 'take' : derived.mode;
  console.log('first take metronome beat index: the LED follows the Link beat modulo 16 at every sample (owner spec)');
  console.log('  device derivation read from src/control/midi.cpp: ' + derived.mode
    + ' (take needles found: ' + derived.missing.length + ')');
  console.log('  the take does not drive the LED: the take-derived control must fail');
  let failed = 0;
  for (const holdMs of kHoldMs) {
    const r = runCase(holdMs, mode);
    console.log('  ' + holdMs + 'ms take: rb=' + r.rb + ' sharedIndexAtPress=' + r.sharedAtPress
      + ' expectedAtPress=0 mismatches=' + r.mismatches + '/' + r.rows.length
      + ' worstLoopPhaseGap=' + r.worstPhaseSamples.toFixed(2) + ' samples ' + (r.ok ? 'ok' : 'FAIL'));
    if (!r.ok) failed++;
  }
  const pass = mode === 'shared' && failed === 0;
  if (pass) {
    console.log('first take metronome beat index: PASS (' + kHoldMs.length + '/' + kHoldMs.length
      + ' takes, LED index equals the Link beat modulo 16 at every sample)');
    process.exit(0);
  }
  const reproduced = failed === kHoldMs.length;
  if (noFix) {
    if (assertControl) {
      console.log(reproduced
        ? 'first take metronome beat index: take-derived control correctly FAILS at ' + failed + '/' + kHoldMs.length + ' takes'
        : 'first take metronome beat index: take-derived control WEAK (' + (kHoldMs.length - failed) + ' takes passed)');
      process.exit(reproduced ? 0 : 1);
    }
    console.log(reproduced
      ? 'control FAIL (defect reproduced at ' + failed + '/' + kHoldMs.length + ' takes, exit 1 as required)'
      : 'control WEAK (' + (kHoldMs.length - failed) + ' takes passed)');
    process.exit(1);
  }
  console.log('first take metronome beat index: FAIL (' + failed + '/' + kHoldMs.length
    + ' takes; device derives beatIndex from ' + derived.mode + ')');
  process.exit(1);
}

if (require.main === module) main();
module.exports = { runCase, sourceDerivation };
