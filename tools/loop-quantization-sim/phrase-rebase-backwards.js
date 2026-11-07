'use strict';

const W = require('./world');
const {
  setPhaseQuantum, LINK_PHASE_QUANTUM,
  beatAtTime, phaseAtTime, requestPhaseImpose, applyPendingPhaseImpose,
} = require('./link');

const kPhraseBeats = 64.0;
const kCaptureQuantumBeats = 128.0;
const kSppUnitsPerBeat = 4;
const kSppWrap = 16384;
const kSppPhraseAlignment = 256;
const kTimelineOffsetMs = 200000;
const kBpmSet = [100, 120, 157.2];
const kRecordedBeats = [3, 4, 5, 6, 7, 8, 16, 64];
const kOriginBeats = [0, 16, 32, 48, 7, 1, 64, 128];
const kBackwardsDeltas = [-8, -64, -134];
const kForwardDeltas = [8, 64, 134];
const kWindowBeats = 128.0;
const kSampleBeats = 1.0;
const kCleanToleranceBeats = 1e-3;
const kSppToleranceUnits = kSampleBeats * kSppUnitsPerBeat + 1e-6;
const kOwnerBpm = 120;
const kOwnerRb = 3;
const kOwnerOriginBeat = 128;
const kOwnerDeltaBeats = -134;
const kEspGuardSha = '745d61a';

function beatMs(session, beats) { return (beats * 60000) / session.tempo; }

function timeForBeat(session, beat) {
  return session.gridOriginTimeMs + ((beat - session.beatOriginBeat) * 60000) / session.tempo;
}

function shippedPhraseBoundaryStep(baselineCaptured, lastNumber, currentNumber) {
  if (!baselineCaptured) return { crossed: false, lastNumber: currentNumber };
  if (currentNumber > lastNumber) return { crossed: true, lastNumber: currentNumber };
  if (currentNumber < lastNumber) return { crossed: false, lastNumber: currentNumber };
  return { crossed: false, lastNumber: lastNumber };
}

function staleHoldPhraseBoundaryStep(baselineCaptured, lastNumber, currentNumber) {
  if (!baselineCaptured) return { crossed: false, lastNumber: currentNumber };
  if (currentNumber > lastNumber) return { crossed: true, lastNumber: currentNumber };
  return { crossed: false, lastNumber: lastNumber };
}

function directionBlindStep(baselineCaptured, lastNumber, currentNumber) {
  if (!baselineCaptured) return { crossed: false, lastNumber: currentNumber };
  if (currentNumber !== lastNumber) return { crossed: true, lastNumber: currentNumber };
  return { crossed: false, lastNumber: lastNumber };
}

function guardFor(name) {
  if (name === 'stale-hold') return staleHoldPhraseBoundaryStep;
  if (name === 'direction-blind') return directionBlindStep;
  return shippedPhraseBoundaryStep;
}

function shippedGuardVectors() {
  const cases = [
    [false, 0, 7, false, 7],
    [true, 7, 8, true, 8],
    [true, 8, 11, true, 11],
    [true, 11, 11, false, 11],
    [true, 11, 6, false, 6],
    [true, 6, 7, true, 7],
    [true, 7, 8, true, 8],
    [true, 12, -5, false, -5],
    [true, -5, -4, true, -4],
    [true, -4, -9, false, -9],
    [true, -9, -9, false, -9],
  ];
  let failed = 0;
  for (const c of cases) {
    const step = shippedPhraseBoundaryStep(c[0], c[1], c[2]);
    if (step.crossed !== c[3] || step.lastNumber !== c[4]) failed++;
  }
  return { total: cases.length, failed };
}

function staleHoldVectors() {
  const cases = [
    [true, 11, 6, false, 11],
    [true, 12, -5, false, 12],
    [true, 12, 13, true, 13],
  ];
  let failed = 0;
  for (const c of cases) {
    const step = staleHoldPhraseBoundaryStep(c[0], c[1], c[2]);
    if (step.crossed !== c[3] || step.lastNumber !== c[4]) failed++;
  }
  return { total: cases.length, failed };
}

function phraseNumberAt(session, timeMs) {
  return Math.floor(beatAtTime(session, timeMs) / kPhraseBeats);
}

function sppUnitsAt(session, timeMs) {
  let units = (beatAtTime(session, timeMs) * kSppUnitsPerBeat) % kSppWrap;
  if (units < 0) units += kSppWrap;
  return units;
}

function sppOffGrid(units) {
  const rest = units % kSppPhraseAlignment;
  return Math.min(rest, kSppPhraseAlignment - rest) > kSppToleranceUnits;
}

function circularGap(a, b, period) {
  let d = (a - b) % period;
  if (d < 0) d += period;
  return Math.min(d, period - d);
}

function loopGap(w, session, timeMs, rb) {
  w.t = W.msToSimSamples(timeMs);
  const exactMs = (w.t / W.SIM_SAMPLE_RATE) * 1000;
  W.refreshLinkSnapshot(w);
  const pos = W.linkTargetSamplesAt(w, exactMs * 1000) / (w.masterLenSamples / rb);
  return circularGap(pos, phaseAtTime(session, exactMs, rb), rb);
}

function expectedForwardBoundaries(originBeat) {
  return Math.floor((originBeat + kWindowBeats) / kPhraseBeats)
    - Math.floor((originBeat - 2 * kSampleBeats) / kPhraseBeats);
}

function runCase(bpm, rb, originBeat, delta, guardName) {
  setPhaseQuantum(kCaptureQuantumBeats);
  const w = W.createWorld({ looperCount: 4, initialLinkBpm: bpm });
  const session = w.link.session;
  session.gridOriginTimeMs = kTimelineOffsetMs;
  w.link.remote.connected = true;
  w.loopPhaseCapture = true;
  w.absolutePhaseFold = false;
  w.recordedBpm = bpm;
  w.recordedBeats = rb;
  w.masterLenSamples = rb * (60.0 / bpm) * W.SIM_SAMPLE_RATE;

  const t0Ms = timeForBeat(session, originBeat);
  const preMs = t0Ms - 2 * beatMs(session, 1);
  const endMs = t0Ms + beatMs(session, kWindowBeats);
  const stepMs = beatMs(session, kSampleBeats);
  const seqBefore = session.rebaseSeq || 0;
  const stepFn = guardFor(guardName);
  let baselineCaptured = false;
  let lastNumber = 0;
  let prevPhrase = null;
  let forward = 0;
  let forwardAfterRebase = 0;
  let postRebaseIncreases = 0;
  let decreaseEmissions = 0;
  let falseAtRebase = 0;
  let forwardOffGrid = 0;
  let backwardsPhraseJump = 0;
  let rebaseDone = false;
  let rebaseSeqAfter = seqBefore;
  let atRebase = false;

  for (let t = preMs; t <= endMs + 1e-9; t += stepMs) {
    atRebase = false;
    if (!rebaseDone && t >= t0Ms - 1e-9) {
      if (delta !== 0) {
        requestPhaseImpose(session, beatAtTime(session, t0Ms) + delta, t0Ms, kCaptureQuantumBeats, w.link.local);
        applyPendingPhaseImpose(session);
      }
      rebaseDone = true;
      rebaseSeqAfter = session.rebaseSeq || 0;
      atRebase = true;
    }
    const current = phraseNumberAt(session, t);
    const jumped = prevPhrase !== null && current < prevPhrase;
    if (jumped) backwardsPhraseJump++;
    if (rebaseDone && !atRebase && prevPhrase !== null && current > prevPhrase) postRebaseIncreases++;
    const step = stepFn(baselineCaptured, lastNumber, current);
    if (step.crossed) {
      if (current > lastNumber || !baselineCaptured) {
        forward++;
        if (rebaseDone && !atRebase) forwardAfterRebase++;
        if (!atRebase && sppOffGrid(sppUnitsAt(session, t))) forwardOffGrid++;
      } else {
        decreaseEmissions++;
        if (atRebase) falseAtRebase++;
      }
    }
    baselineCaptured = true;
    lastNumber = step.lastNumber;
    prevPhrase = current;
  }

  const gap1 = loopGap(w, session, t0Ms + beatMs(session, 8), rb);
  const gap2 = loopGap(w, session, t0Ms + beatMs(session, kWindowBeats), rb);
  const maxGap = Math.max(gap1, gap2);
  const rebaseOk = delta === 0 ? rebaseSeqAfter === seqBefore : rebaseSeqAfter === seqBefore + 1;
  const expectedForward = delta === 0 ? expectedForwardBoundaries(originBeat) : null;
  const resumedOk = delta >= 0
    ? true
    : postRebaseIncreases >= 1 && forwardAfterRebase === postRebaseIncreases;
  const countOk = (expectedForward === null || forward === expectedForward) && resumedOk;
  const clean = rebaseOk && countOk && decreaseEmissions === 0 && falseAtRebase === 0
    && forwardOffGrid === 0 && maxGap <= kCleanToleranceBeats;
  return {
    clean, rebaseOk, countOk, resumedOk, forward, forwardAfterRebase, postRebaseIncreases,
    decreaseEmissions, falseAtRebase, forwardOffGrid, backwardsPhraseJump, maxGap, expectedForward,
  };
}

function runMatrix(guardName) {
  const rows = [];
  const deltas = guardName === 'shipped'
    ? [...kBackwardsDeltas, ...kForwardDeltas, 0]
    : kBackwardsDeltas;
  for (const bpm of kBpmSet) {
    for (const rb of kRecordedBeats) {
      for (const originBeat of kOriginBeats) {
        for (const delta of deltas) {
          rows.push({ bpm, rb, originBeat, delta, result: runCase(bpm, rb, originBeat, delta, guardName) });
        }
      }
    }
  }
  return rows;
}

function summarize(rows) {
  const clean = rows.filter((r) => r.result.clean).length;
  let maxGap = 0;
  let totalDecrease = 0;
  let totalFalseAtRebase = 0;
  let totalOffGrid = 0;
  let totalJumps = 0;
  let totalHeldBack = 0;
  let jumpCases = 0;
  let cleanJumpCases = 0;
  for (const r of rows) {
    maxGap = Math.max(maxGap, r.result.maxGap);
    totalDecrease += r.result.decreaseEmissions;
    totalFalseAtRebase += r.result.falseAtRebase;
    totalOffGrid += r.result.forwardOffGrid;
    totalJumps += r.result.backwardsPhraseJump;
    if (!r.result.resumedOk) totalHeldBack++;
    if (r.result.backwardsPhraseJump > 0) {
      jumpCases++;
      if (r.result.clean) cleanJumpCases++;
    }
  }
  return { clean, total: rows.length, maxGap, totalDecrease, totalFalseAtRebase, totalOffGrid, totalJumps, totalHeldBack, jumpCases, cleanJumpCases };
}

function perBpm(rows) {
  const lines = [];
  for (const bpm of kBpmSet) {
    const subset = rows.filter((r) => r.bpm === bpm);
    const s = summarize(subset);
    lines.push('  bpm=' + bpm + ' cases=' + s.total + ' clean=' + s.clean + ' jumpCases=' + s.jumpCases + ' decrease=' + s.totalDecrease + ' falseAtRebase=' + s.totalFalseAtRebase + ' offGrid=' + s.totalOffGrid + ' heldBack=' + s.totalHeldBack + ' maxGap=' + s.maxGap.toFixed(6) + 'b');
  }
  return lines;
}

function main() {
  const args = process.argv.slice(2);
  const has = (flag) => args.includes(flag);
  const guardName = has('--stale-hold') ? 'stale-hold'
    : (has('--no-fix') || has('--control')) ? 'direction-blind' : 'shipped';
  const mode = has('--assert-stale-hold') ? 'assert-stale-hold'
    : has('--assert-control') ? 'assert-control'
    : guardName === 'shipped' ? 'fixed' : 'control';
  const vectors = guardName === 'stale-hold' ? staleHoldVectors() : shippedGuardVectors();
  const owner = runCase(kOwnerBpm, kOwnerRb, kOwnerOriginBeat, kOwnerDeltaBeats, 'shipped');
  const ownerStale = runCase(kOwnerBpm, kOwnerRb, kOwnerOriginBeat, kOwnerDeltaBeats, 'stale-hold');
  console.log('phrase rebase backwards: a backwards phrase-number jump must not emit a false phrase boundary');
  console.log('  fixed arm mirrors esp main ' + kEspGuardSha + ' (rebased 1755ba6) main/phrase_boundary_guard.h stepPhraseBoundary');
  console.log('  a backwards rebase re-adopts the lower phrase number so the next forward boundary is NOT held back');
  console.log('  shipped guard host vectors: ' + (vectors.total - vectors.failed) + '/' + vectors.total + ' pass');
  console.log('  coverage: bpm ' + kBpmSet.join('/') + ', rb ' + kRecordedBeats.join('/') + ', origins ' + kOriginBeats.join('/') + ', deltas ' + [...kBackwardsDeltas, ...kForwardDeltas, 0].join('/'));
  console.log('  phrase ' + kPhraseBeats + ' beats, capture ' + kCaptureQuantumBeats + ', SPP alignment ' + kSppPhraseAlignment + ' units, window ' + kWindowBeats + ' beats');
  console.log('  owner grid bpm=' + kOwnerBpm + ' rb=' + kOwnerRb + ' origin=' + kOwnerOriginBeat + ' delta=' + kOwnerDeltaBeats + ': shipped resumedOk=' + owner.resumedOk + ' postRebaseIncreases=' + owner.postRebaseIncreases + ' forwardAfterRebase=' + owner.forwardAfterRebase + '; staleHold resumedOk=' + ownerStale.resumedOk + ' forwardAfterRebase=' + ownerStale.forwardAfterRebase);
  console.log('  model-level only: sim beatAtTime is absolute/linear; ESP Link beatAtTime is phase-encoded');
  console.log('  on-device verification is held until an owner-approved quiet window');

  const fixed = guardName === 'shipped';
  const rows = runMatrix(guardName);
  for (const line of perBpm(rows)) console.log(line);
  const s = summarize(rows);
  console.log('  ' + guardName + ': ' + s.clean + '/' + s.total + ' clean, jumpCases=' + s.jumpCases + ' backwardsJumps=' + s.totalJumps + ' decrease=' + s.totalDecrease + ' falseAtRebase=' + s.totalFalseAtRebase + ' offGrid=' + s.totalOffGrid + ' heldBack=' + s.totalHeldBack + ' maxGap=' + s.maxGap.toFixed(6) + 'b');

  if (mode === 'fixed') {
    const pass = vectors.failed === 0 && s.clean === s.total && s.totalJumps > 0
      && s.totalHeldBack === 0 && owner.resumedOk === true && ownerStale.resumedOk === false;
    const verdict = pass
      ? 'phrase rebase backwards: PASS (' + s.clean + '/' + s.total + ' cases, shipped guard vectors ' + vectors.total + '/' + vectors.total + ', ' + s.jumpCases + ' backwards phrase-jump cases quiet, forward boundaries resumed after every rebase, max loopBeatPos gap ' + s.maxGap.toFixed(6) + 'b)'
      : 'phrase rebase backwards: FAIL (' + (s.total - s.clean) + '/' + s.total + ' cases outside the gate, heldBack=' + s.totalHeldBack + ', ownerStaleResumed=' + ownerStale.resumedOk + ')';
    console.log(verdict);
    process.exit(pass ? 0 : 1);
  }

  const staleHold = guardName === 'stale-hold';
  const reproduced = staleHold
    ? s.cleanJumpCases === 0 && s.jumpCases > 0 && s.totalHeldBack === s.jumpCases && ownerStale.resumedOk === false
    : s.cleanJumpCases === 0 && s.jumpCases > 0 && s.totalFalseAtRebase > 0;
  if (mode === 'assert-stale-hold' || mode === 'assert-control') {
    const verdict = reproduced
      ? (staleHold
          ? 'phrase rebase backwards: stale-hold control correctly FAILS at ' + s.totalHeldBack + '/' + s.total + ' rebase cases (forward boundaries held back after the rebase)'
          : 'phrase rebase backwards: control correctly FAILS at ' + s.jumpCases + '/' + s.jumpCases + ' backwards phrase-jump cases (' + s.totalFalseAtRebase + ' false boundaries)')
      : 'phrase rebase backwards: control WEAK (' + s.clean + '/' + s.total + ' cases passed the gate)';
    console.log(verdict);
    process.exit(reproduced ? 0 : 1);
  }
  console.log(reproduced
    ? 'control FAIL (defect reproduced at ' + s.total + '/' + s.total + ' cases, exit 1 as required)'
    : 'control WEAK (' + s.clean + '/' + s.total + ' cases passed the gate)');
  process.exit(1);
}

if (require.main === module) main();
module.exports = { shippedPhraseBoundaryStep, staleHoldPhraseBoundaryStep, directionBlindStep, runCase, runMatrix, summarize };
