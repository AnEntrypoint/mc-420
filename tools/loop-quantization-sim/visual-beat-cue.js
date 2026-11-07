'use strict';

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

function runCase(bpm, rb, rebaseMode, injectedDelayMs) {
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
    const loopPhaseAtCue = phaseAtTime(session, originMs, rb);
    const expectedLoopPhase = ((nextBeat % rb) + rb) % rb;
    rows.push({ nextBeat, rawLeadMs, schedulingErrorMs, compensatedOnsetErrorMs, cueIndex, loopPhaseAtCue, expectedLoopPhase });
    nowMs = originMs;
  }
  const seqBumped = rebaseMode === 'none'
    ? rebaseSeqAfter === rebaseSeqBefore
    : rebaseSeqAfter === rebaseSeqBefore + 1;
  let maxSchedulingErrorMs = 0;
  let maxCompensatedOnsetErrorMs = 0;
  let indexOk = true;
  let phaseOk = true;
  for (const row of rows) {
    maxSchedulingErrorMs = Math.max(maxSchedulingErrorMs, Math.abs(row.schedulingErrorMs));
    maxCompensatedOnsetErrorMs = Math.max(maxCompensatedOnsetErrorMs, Math.abs(row.compensatedOnsetErrorMs));
    if (row.cueIndex < 0 || row.cueIndex >= kLinkQuantumBeats) indexOk = false;
    if (Math.abs(row.loopPhaseAtCue - row.expectedLoopPhase) > 1e-6) phaseOk = false;
  }
  return {
    ok: seqBumped && indexOk && phaseOk
      && maxSchedulingErrorMs <= kToleranceMs
      && maxCompensatedOnsetErrorMs <= kToleranceMs,
    seqBumped, indexOk, phaseOk, maxSchedulingErrorMs, maxCompensatedOnsetErrorMs,
  };
}

function runMatrix(injectedDelayMs) {
  const results = [];
  for (const bpm of kBpmSet) {
    for (const rb of kRecordedBeats) {
      for (const rebaseMode of kRebaseModes) {
        const result = runCase(bpm, rb, rebaseMode, injectedDelayMs);
        results.push({ bpm, rb, rebaseMode, result });
      }
    }
  }
  return results;
}

function summarize(results) {
  const passed = results.filter((entry) => entry.result.ok).length;
  let maxSchedulingErrorMs = 0;
  let maxCompensatedOnsetErrorMs = 0;
  for (const entry of results) {
    maxSchedulingErrorMs = Math.max(maxSchedulingErrorMs, entry.result.maxSchedulingErrorMs);
    maxCompensatedOnsetErrorMs = Math.max(maxCompensatedOnsetErrorMs, entry.result.maxCompensatedOnsetErrorMs);
  }
  const broken = results.filter((entry) => !entry.result.seqBumped || !entry.result.indexOk || !entry.result.phaseOk);
  return { passed, total: results.length, maxSchedulingErrorMs, maxCompensatedOnsetErrorMs, broken: broken.length };
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
    lines.push(`  bpm=${bpm} cases=${subset.length} maxSoftwareSendError=${maxScheduling.toFixed(3)}ms maxCompensatedOnsetError=${maxOnset.toFixed(3)}ms`);
  }
  return lines;
}

function main() {
  const args = process.argv.slice(2);
  const mode = args.includes('--control') ? 'control'
    : args.includes('--assert-control') ? 'assert-control' : 'fixed';
  console.log('visual beat cue: software send stays on the Link beat grid');
  console.log(`  model: injected clock, ${kBeatLeadMs}ms kBeatLeadMs lead, ${kAssumedApcLatencyMs}ms ASSUMED APC latency, ${kPollCapMs}ms poll cap, ${kToleranceMs}ms gate`);
  console.log(`  coverage: bpm ${kBpmSet.join('/')}, rb ${kRecordedBeats.join('/')}, rebase ${kRebaseModes.join('/')}`);
  console.log('  the raw software send sits 30ms early by design; the gate is on the lead-compensated software cue onset');
  console.log('  this offline sim cannot measure the APC Key25 real latency or the end-to-end visual onset');

  if (mode === 'fixed') {
    const results = runMatrix(0);
    for (const line of perBpm(results)) console.log(line);
    const summary = summarize(results);
    console.log(`  fixed: ${summary.passed}/${summary.total} cases pass, maxSoftwareSendError=${summary.maxSchedulingErrorMs.toFixed(3)}ms maxCompensatedOnsetError=${summary.maxCompensatedOnsetErrorMs.toFixed(3)}ms broken=${summary.broken}`);
    const verdict = summary.passed === summary.total
      ? `visual beat cue: PASS (${summary.passed}/${summary.total} cases, max compensated onset error ${summary.maxCompensatedOnsetErrorMs.toFixed(3)}ms <= ${kToleranceMs}ms)`
      : `visual beat cue: FAIL (${summary.total - summary.passed}/${summary.total} cases outside the gate)`;
    console.log(verdict);
    process.exit(verdict.startsWith('visual beat cue: PASS') ? 0 : 1);
  }

  const results = runMatrix(kInjectedDelayMs);
  for (const line of perBpm(results)) console.log(line);
  const summary = summarize(results);
  console.log(`  control (+20ms): ${summary.total - summary.passed}/${summary.total} cases fail, maxCompensatedOnsetError=${summary.maxCompensatedOnsetErrorMs.toFixed(3)}ms`);
  const reproduced = summary.passed === 0;
  if (mode === 'assert-control') {
    const verdict = reproduced
      ? `visual beat cue: control correctly FAILS at ${summary.total}/${summary.total} cases (max compensated onset error ${summary.maxCompensatedOnsetErrorMs.toFixed(3)}ms > ${kToleranceMs}ms)`
      : `visual beat cue: control WEAK (${summary.passed}/${summary.total} cases passed the gate)`;
    console.log(verdict);
    process.exit(reproduced ? 0 : 1);
  }
  console.log(reproduced
    ? `control FAIL (defect reproduced at ${summary.total}/${summary.total} cases, exit 1 as required)`
    : `control WEAK (${summary.passed}/${summary.total} cases passed the gate)`);
  process.exit(1);
}

if (require.main === module) main();
module.exports = { runCase, runMatrix, summarize };
