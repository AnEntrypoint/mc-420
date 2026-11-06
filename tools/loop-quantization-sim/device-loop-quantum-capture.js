'use strict';

const fs = require('fs');
const path = require('path');
const { LINK_QUANTUM, LINK_PHASE_QUANTUM } = require('./link');
const simCase = require('./phase-capture-128-fold');

const kSrcRoot = path.resolve(__dirname, '..', '..', 'src');
const kRecordedBeats = [3, 5, 6, 7];
const kHorizonBeats = 288.0;
const kStepBeats = 0.25;
const kToleranceBeats = 1e-3;

function readSrc(rel) {
  return fs.readFileSync(path.join(kSrcRoot, rel), 'utf8');
}

function parseConst(text, name) {
  const re = new RegExp('constexpr\\s+double\\s+' + name + '\\s*=\\s*([0-9]+(?:\\.[0-9]+)?)');
  const m = text.match(re);
  if (!m) throw new Error('missing constexpr double ' + name);
  return Number(m[1]);
}

function circularGap(a, b, period) {
  let d = (a - b) % period;
  if (d < 0) d += period;
  return Math.min(d, period - d);
}

function wrap(value, period) {
  return ((value % period) + period) % period;
}

function measure(rb, phaseQuantum, useLoopQuantum) {
  let maxMismatch = 0;
  let misplaced = 0;
  let turnarounds = 0;
  let prevExpected = null;
  let prevPos = null;
  const wrapThreshold = -kStepBeats * 2;
  for (let beat = kStepBeats; beat <= kHorizonBeats; beat += kStepBeats) {
    const expected = wrap(beat, rb);
    const pos = useLoopQuantum ? wrap(beat, rb) : wrap(wrap(beat, phaseQuantum), rb);
    const mismatch = circularGap(pos, expected, rb);
    if (mismatch > maxMismatch) maxMismatch = mismatch;
    const gridWrap = prevExpected !== null && expected - prevExpected < wrapThreshold;
    const posWrap = prevPos !== null && pos - prevPos < wrapThreshold;
    if (posWrap) turnarounds++;
    if (gridWrap !== posWrap) misplaced++;
    prevPos = pos;
    prevExpected = expected;
  }
  return { maxMismatch, misplaced, turnarounds };
}

function clean(r) {
  return r.maxMismatch <= kToleranceBeats && r.misplaced === 0 && r.turnarounds > 0;
}

function main() {
  const bridgeH = readSrc('link/link_bridge.h');
  const bridgeCpp = readSrc('link/link_bridge.cpp');
  const audioThread = readSrc('dsp/audio_thread.cpp');
  const phaseQuantum = parseConst(bridgeH, 'kLinkPhaseQuantumBeats');
  const transportQuantum = parseConst(bridgeH, 'kLinkQuantum');

  let failed = 0;
  console.log('device loop-quantum capture: src/link/link_bridge.h kLinkPhaseQuantumBeats=' + phaseQuantum.toFixed(1) + ' kLinkQuantum=' + transportQuantum.toFixed(1));

  const checks = [
    ['the sim models the shipped 128-beat phase quantum', phaseQuantum === LINK_PHASE_QUANTUM],
    ['the sim models the shipped 16-beat transport quantum', transportQuantum === LINK_QUANTUM],
    ['link_bridge.cpp captures the 128-beat phase', /phaseAtTime\(now,\s*kLinkPhaseQuantumBeats\)/.test(bridgeCpp)],
    ['link_bridge.cpp publishes loopPhaseMicroBeats from a loop-quantum capture', /loopPhaseMicroBeats\s*=\s*\(int64_t\)\(state\.phaseAtTime\(now,\s*(?:loopQuantum|captureQuantum)\)/.test(bridgeCpp)],
    ['link_bridge.cpp never leaves the loop-quantum capture absent', !/loopQuantumBeats\s*=\s*0\.0/.test(bridgeCpp)],
    ['audio_thread.cpp reads loopPhaseMicroBeats for loopBeatPos', /loopPhaseMicroBeats\s*\/\s*1e6/.test(audioThread)],
    ['audio_thread.cpp no longer folds the 128-beat capture at rb', !/linkQuantumFrac|linkBeatWithinQuantum/.test(audioThread)],
    ['audio_thread.cpp folds at recordedBeatsShared, not at 128 or 16', /std::fmod\(beats,\s*\(double\)recordedBeatsShared\)/.test(audioThread)],
  ];
  for (const check of checks) {
    console.log('  ' + (check[1] ? 'ok  ' : 'FAIL') + ' ' + check[0]);
    if (!check[1]) failed++;
  }

  for (const rb of kRecordedBeats) {
    const divides = phaseQuantum % rb === 0;
    const oldFold = measure(rb, phaseQuantum, false);
    const loopCapture = measure(rb, phaseQuantum, true);
    const simBefore = simCase.measure(rb, false);
    const simAfter = simCase.measure(rb, true);
    const oldFails = !clean(oldFold);
    const newPasses = clean(loopCapture);
    const simOk = !simCase.clean(simBefore) && simCase.clean(simAfter);
    const ok = !divides && oldFails && newPasses && simOk;
    console.log('  rb=' + rb + ' 128%rb=' + (phaseQuantum % rb)
      + ' old128fold mismatch=' + oldFold.maxMismatch.toFixed(4) + 'b misplaced=' + oldFold.misplaced + ' ' + (oldFails ? 'FAIL' : 'ok')
      + ' loopQuantum mismatch=' + loopCapture.maxMismatch.toFixed(4) + 'b misplaced=' + loopCapture.misplaced + ' ' + (newPasses ? 'PASS' : 'FAIL')
      + ' sim before=' + simBefore.maxMismatch.toFixed(4) + 'b/' + simBefore.misplaced + ' after=' + simAfter.maxMismatch.toFixed(4) + 'b/' + simAfter.misplaced + ' ' + (simOk ? 'ok' : 'FAIL'));
    if (!ok) failed++;
  }

  console.log(failed === 0
    ? 'device loop-quantum capture: PASS (old 128-fold FAIL, loop-quantum capture PASS)'
    : 'device loop-quantum capture: FAIL (' + failed + ')');
  process.exit(failed === 0 ? 0 : 1);
}

if (require.main === module) main();
module.exports = { measure, clean, parseConst };
