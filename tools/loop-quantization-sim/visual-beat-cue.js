'use strict';

const fs = require('fs');
const path = require('path');
const {
  createLinkWorld,
  beatAtTime,
  phaseAtTime,
  requestPhaseImpose,
  applyPendingPhaseImpose,
} = require('./link');

const kBpmSet = [60, 90, 120, 157.2, 180];
const kRecordedBeats = [3, 5, 6, 7];
const kRebaseModes = ['none', 'exact', 'snap'];
const kToleranceMs = 7;
const kInjectedDelayMs = 20;
const kBeatLeadMs = 30;
const kAssumedApcLatencyMs = 30;
const kPollCapMs = 100;
const kLinkQuantumBeats = 16;
const kCuesPerCase = 8;
const kRebaseAfterCue = 3;
const kRebaseDeltaBeats = 134;
const kOwnerBpm = 120;
const kOwnerRb = 3;
const kDeviceMidiSrc = path.resolve(__dirname, '..', '..', 'src', 'control', 'midi.cpp');

function deviceSourceChecks() {
  const src = fs.readFileSync(kDeviceMidiSrc, 'utf8');
  return [
    ['kBeatLeadMs is 30 ms', src.includes('constexpr int kBeatLeadMs = 30;')],
    ['leadOpen window uses kBeatLeadMs', src.includes('const int64_t leadMicros = static_cast<int64_t>(kBeatLeadMs) * 1000;') && src.includes('const bool leadOpen = nextBeatMicros - clock.nowMicros <= leadMicros;')],
    ['lead-open index maps to the upcoming beat', src.includes('const int colourBeat = leadOpen ? (clock.beatIndex + 1) % static_cast<int>(kLinkQuantum) : clock.beatIndex;')],
    ['beat pads refresh with the Link beat clock', src.includes('leds.refreshBeatPads(now, grid, beatPadClockFrom(link), ledWrite);')],
    ['flash mark publishes the colour beat at the flash start', src.includes('publishBeatPadMark(colourBeat, clock.nowMicros - flashStartMicros, clock.bpm, state.flash, state.background);')],
  ];
}

function timeOfBeat(session, beat) {
  return session.gridOriginTimeMs + ((beat - session.beatOriginBeat) * 60000) / session.tempo;
}

function pollWakeAtLead(originMs, nowMs) {
  let t = nowMs;
  for (let guard = 0; guard < 512; guard++) {
    const msToNext = Math.max(1, Math.min(kPollCapMs, Math.ceil(originMs - t)));
    const waitMs = Math.max(1, msToNext - kBeatLeadMs);
    t += waitMs;
    if (originMs - t <= kBeatLeadMs) return t;
  }
  return null;
}

function deviceLedIndex(session, pollMs, nextBeat, leadFlip) {
  const beat = Math.floor(beatAtTime(session, pollMs));
  const index = ((beat % kLinkQuantumBeats) + kLinkQuantumBeats) % kLinkQuantumBeats;
  const originMs = timeOfBeat(session, nextBeat);
  const leadOpen = originMs - pollMs <= kBeatLeadMs;
  return leadOpen && leadFlip ? (index + 1) % kLinkQuantumBeats : index;
}

function runCase(bpm, rb, rebaseMode, injectedDelayMs, leadFlip) {
  const { session, local, remote } = createLinkWorld(bpm);
  remote.connected = rebaseMode === 'exact';
  const rebaseSeqBefore = session.rebaseSeq;
  let rebaseSeqAfter = session.rebaseSeq;
  let nowMs = 0;
  const rows = [];
  for (let cue = 0; cue < kCuesPerCase; cue++) {
    if (cue === kRebaseAfterCue && rebaseMode !== 'none') {
      const atMs = nowMs;
      const currentBeat = beatAtTime(session, atMs);
      const targetBeat = rebaseMode === 'exact' ? currentBeat + kRebaseDeltaBeats : currentBeat;
      requestPhaseImpose(session, targetBeat, atMs, rb, local);
      applyPendingPhaseImpose(session);
      rebaseSeqAfter = session.rebaseSeq;
    }
    const nextBeat = Math.floor(beatAtTime(session, nowMs) + 1e-9) + 1;
    const originMs = timeOfBeat(session, nextBeat);
    if (!(originMs > nowMs)) return { ok: false, reason: 'beat origin did not advance' };
    const pollMs = pollWakeAtLead(originMs, nowMs);
    if (pollMs === null) return { ok: false, reason: 'poll never reached the lead window' };
    const sendMs = pollMs + injectedDelayMs;
    const rawLeadMs = originMs - sendMs;
    const schedulingErrorMs = sendMs - (originMs - kBeatLeadMs);
    const compensatedOnsetErrorMs = sendMs + kAssumedApcLatencyMs - originMs;
    const cueIndex = ((nextBeat % kLinkQuantumBeats) + kLinkQuantumBeats) % kLinkQuantumBeats;
    const ledIndex = deviceLedIndex(session, pollMs, nextBeat, leadFlip);
    const loopPhaseAtCue = phaseAtTime(session, originMs, rb);
    const expectedLoopPhase = ((nextBeat % rb) + rb) % rb;
    rows.push({ nextBeat, rawLeadMs, schedulingErrorMs, compensatedOnsetErrorMs, cueIndex, ledIndex, ledIndexOk: ledIndex === cueIndex, loopPhaseAtCue, expectedLoopPhase });
    nowMs = originMs;
  }
  const seqBumped = rebaseMode === 'none'
    ? rebaseSeqAfter === rebaseSeqBefore
    : rebaseSeqAfter === rebaseSeqBefore + 1;
  let maxSchedulingErrorMs = 0;
  let maxCompensatedOnsetErrorMs = 0;
  let indexOk = true;
  let ledIndexOk = true;
  let phaseOk = true;
  for (const row of rows) {
    maxSchedulingErrorMs = Math.max(maxSchedulingErrorMs, Math.abs(row.schedulingErrorMs));
    maxCompensatedOnsetErrorMs = Math.max(maxCompensatedOnsetErrorMs, Math.abs(row.compensatedOnsetErrorMs));
    if (row.cueIndex < 0 || row.cueIndex >= kLinkQuantumBeats) indexOk = false;
    if (!row.ledIndexOk) ledIndexOk = false;
    if (Math.abs(row.loopPhaseAtCue - row.expectedLoopPhase) > 1e-6) phaseOk = false;
  }
  return {
    ok: seqBumped && indexOk && ledIndexOk && phaseOk
      && maxSchedulingErrorMs <= kToleranceMs
      && maxCompensatedOnsetErrorMs <= kToleranceMs,
    seqBumped, indexOk, ledIndexOk, phaseOk, maxSchedulingErrorMs, maxCompensatedOnsetErrorMs,
  };
}

function runMatrix(injectedDelayMs, leadFlip) {
  const results = [];
  for (const bpm of kBpmSet) {
    for (const rb of kRecordedBeats) {
      for (const rebaseMode of kRebaseModes) {
        const result = runCase(bpm, rb, rebaseMode, injectedDelayMs, leadFlip);
        results.push({ bpm, rb, rebaseMode, result });
      }
    }
  }
  return results;
}

function summarize(results) {
  const passed = results.filter((entry) => entry.result.ok).length;
  const indexParityPassed = results.filter((entry) => entry.result.ledIndexOk).length;
  let maxSchedulingErrorMs = 0;
  let maxCompensatedOnsetErrorMs = 0;
  for (const entry of results) {
    maxSchedulingErrorMs = Math.max(maxSchedulingErrorMs, entry.result.maxSchedulingErrorMs);
    maxCompensatedOnsetErrorMs = Math.max(maxCompensatedOnsetErrorMs, entry.result.maxCompensatedOnsetErrorMs);
  }
  const broken = results.filter((entry) => !entry.result.seqBumped || !entry.result.indexOk || !entry.result.ledIndexOk || !entry.result.phaseOk);
  return { passed, indexParityPassed, total: results.length, maxSchedulingErrorMs, maxCompensatedOnsetErrorMs, broken: broken.length };
}

function perBpm(results) {
  const lines = [];
  for (const bpm of kBpmSet) {
    const subset = results.filter((entry) => entry.bpm === bpm);
    let maxOnset = 0;
    let maxScheduling = 0;
    for (const entry of subset) {
      maxOnset = Math.max(maxOnset, entry.result.maxCompensatedOnsetErrorMs);
      maxScheduling = Math.max(maxScheduling, entry.result.maxSchedulingErrorMs);
    }
    lines.push('  bpm=' + bpm + ' cases=' + subset.length + ' maxSoftwareSendError=' + maxScheduling.toFixed(3) + 'ms maxCompensatedOnsetError=' + maxOnset.toFixed(3) + 'ms');
  }
  return lines;
}

function ownerOneStepCase() {
  const { session } = createLinkWorld(kOwnerBpm);
  const nowMs = 0;
  const nextBeat = Math.floor(beatAtTime(session, nowMs) + 1e-9) + 1;
  const originMs = timeOfBeat(session, nextBeat);
  const pollMs = pollWakeAtLead(originMs, nowMs);
  const cueIndex = ((nextBeat % kLinkQuantumBeats) + kLinkQuantumBeats) % kLinkQuantumBeats;
  const withFlip = deviceLedIndex(session, pollMs, nextBeat, true);
  const withoutFlip = deviceLedIndex(session, pollMs, nextBeat, false);
  return {
    bpm: kOwnerBpm, rb: kOwnerRb, cueIndex, withFlip, withoutFlip,
    gapBeats: ((cueIndex - withoutFlip) + kLinkQuantumBeats) % kLinkQuantumBeats,
    loopPhaseAtCue: phaseAtTime(session, originMs, kOwnerRb),
    expectedLoopPhase: ((nextBeat % kOwnerRb) + kOwnerRb) % kOwnerRb,
    parityFixed: withFlip === cueIndex,
    parityOneStep: withoutFlip === cueIndex,
  };
}

function main() {
  const args = process.argv.slice(2);
  const has = (flag) => args.includes(flag);
  const mode = has('--assert-no-index-fix') ? 'assert-no-index-fix'
    : has('--assert-control') ? 'assert-control'
    : has('--no-index-fix') ? 'no-index-fix'
    : has('--control') ? 'control' : 'fixed';
  const leadFlip = !(mode === 'no-index-fix' || mode === 'assert-no-index-fix');
  const injectedDelayMs = (mode === 'control' || mode === 'assert-control') ? kInjectedDelayMs : 0;
  const checks = deviceSourceChecks();
  const sourceOk = checks.every((c) => c[1]);
  const owner = ownerOneStepCase();
  console.log('visual beat cue: software send stays on the Link beat grid');
  console.log('  model: injected clock, ' + kBeatLeadMs + 'ms kBeatLeadMs lead, ' + kAssumedApcLatencyMs + 'ms ASSUMED APC latency, ' + kPollCapMs + 'ms poll cap, ' + kToleranceMs + 'ms gate');
  console.log('  coverage: bpm ' + kBpmSet.join('/') + ', rb ' + kRecordedBeats.join('/') + ', rebase ' + kRebaseModes.join('/'));
  console.log('  the raw software send sits 30ms early by design; the gate is on the lead-compensated software cue onset');
  console.log('  index gate: sim cueIndex equals src/control/midi.cpp leadOpen (index+1)%16 at the 30ms wake');
  console.log('  this offline sim cannot measure the APC Key25 real latency or the end-to-end visual onset');
  for (const c of checks) console.log('  device source: ' + (c[1] ? 'ok  ' : 'FAIL') + ' ' + c[0]);
  console.log('  owner grid bpm=' + owner.bpm + ' rb=' + owner.rb + ' cueIndex=' + owner.cueIndex + ' ledWithFlip=' + owner.withFlip + ' ledWithoutFlip=' + owner.withoutFlip + ' oneStepGap=' + owner.gapBeats + ' beat');

  const results = runMatrix(injectedDelayMs, leadFlip);
  for (const line of perBpm(results)) console.log(line);
  const summary = summarize(results);

  if (mode === 'fixed') {
    console.log('  fixed: ' + summary.passed + '/' + summary.total + ' cases pass, maxSoftwareSendError=' + summary.maxSchedulingErrorMs.toFixed(3) + 'ms maxCompensatedOnsetError=' + summary.maxCompensatedOnsetErrorMs.toFixed(3) + 'ms broken=' + summary.broken + ' indexParity=' + summary.indexParityPassed + '/' + summary.total);
    const pass = summary.passed === summary.total && summary.indexParityPassed === summary.total && sourceOk
      && owner.parityFixed && !owner.parityOneStep && owner.gapBeats === 1
      && Math.abs(owner.loopPhaseAtCue - owner.expectedLoopPhase) <= 1e-6;
    const verdict = pass
      ? 'visual beat cue: PASS (' + summary.passed + '/' + summary.total + ' cases, max compensated onset error ' + summary.maxCompensatedOnsetErrorMs.toFixed(3) + 'ms <= ' + kToleranceMs + 'ms, device LED index parity ' + summary.indexParityPassed + '/' + summary.total + ')'
      : 'visual beat cue: FAIL (' + (summary.total - summary.passed) + '/' + summary.total + ' cases outside the gate)';
    console.log(verdict);
    process.exit(pass ? 0 : 1);
  }

  if (mode === 'no-index-fix' || mode === 'assert-no-index-fix') {
    const reproduced = summary.passed === 0 && summary.indexParityPassed === 0 && owner.gapBeats === 1 && !owner.parityOneStep;
    console.log('  one-step-behind control: ' + (summary.total - summary.passed) + '/' + summary.total + ' cases fail, indexParity=' + summary.indexParityPassed + '/' + summary.total);
    if (mode === 'assert-no-index-fix') {
      const verdict = reproduced
        ? 'visual beat cue: one-step control correctly FAILS at ' + summary.total + '/' + summary.total + ' cases (LED index one beat behind the cue grid at bpm=' + owner.bpm + ' rb=' + owner.rb + ')'
        : 'visual beat cue: one-step control WEAK (' + summary.passed + '/' + summary.total + ' cases passed)';
      console.log(verdict);
      process.exit(reproduced ? 0 : 1);
    }
    console.log(reproduced
      ? 'control FAIL (one-step lag reproduced at ' + summary.total + '/' + summary.total + ' cases, exit 1 as required)'
      : 'control WEAK (' + summary.passed + '/' + summary.total + ' cases passed)');
    process.exit(1);
  }

  console.log('  control (+20ms): ' + (summary.total - summary.passed) + '/' + summary.total + ' cases fail, maxCompensatedOnsetError=' + summary.maxCompensatedOnsetErrorMs.toFixed(3) + 'ms');
  const reproduced = summary.passed === 0;
  if (mode === 'assert-control') {
    const verdict = reproduced
      ? 'visual beat cue: control correctly FAILS at ' + summary.total + '/' + summary.total + ' cases (max compensated onset error ' + summary.maxCompensatedOnsetErrorMs.toFixed(3) + 'ms > ' + kToleranceMs + 'ms)'
      : 'visual beat cue: control WEAK (' + summary.passed + '/' + summary.total + ' cases passed the gate)';
    console.log(verdict);
    process.exit(reproduced ? 0 : 1);
  }
  console.log(reproduced
    ? 'control FAIL (defect reproduced at ' + summary.total + '/' + summary.total + ' cases, exit 1 as required)'
    : 'control WEAK (' + summary.passed + '/' + summary.total + ' cases passed the gate)');
  process.exit(1);
}

if (require.main === module) main();
module.exports = { runCase, runMatrix, summarize, deviceSourceChecks, deviceLedIndex, ownerOneStepCase };
