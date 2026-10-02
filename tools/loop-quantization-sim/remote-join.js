'use strict';

const {
  createLinkSession, createLinkPeer, registerPeer, setPhaseQuantum,
  LINK_PHASE_QUANTUM, phaseAtTime,
} = require('./link');
const {
  createWorld, stepOneSample, onPadPress, onPadRelease, msToSimSamples, SIM_SAMPLE_RATE,
} = require('./world');
const { runAllInvariants } = require('./invariants');

const kRemoteBarBeats = 16.0;
const kControlTickSamples = SIM_SAMPLE_RATE / 5;
const kLaunchBarToleranceBeats = 0.5;
const kJoinBpm = 120.0;
const kHoldMs = 2000;
const kSettleMs = 2000;

function nowMs(w) {
  return (w.t / SIM_SAMPLE_RATE) * 1000;
}

function monotonicStamp() {
  return (Number(process.hrtime.bigint()) / 1e9).toFixed(3);
}

function fmod(x, y) {
  const r = x % y;
  return r < 0 ? r + y : r;
}

function barPhaseAt(session, timeMs) {
  return phaseAtTime(session, timeMs, kRemoteBarBeats);
}

function barPhaseOfSnapshot(ls) {
  return fmod(ls.beatPhaseMicroBeats / 1e6, kRemoteBarBeats);
}

function beatsToBarPhase(session, timeMs, targetBeats) {
  let d = targetBeats - barPhaseAt(session, timeMs);
  while (d < 0) d += kRemoteBarBeats;
  return d;
}

function msPerBeat(session) {
  return 60000 / session.tempo;
}

function phraseBeatAt(w) {
  if (w.masterLenSamples <= 0) return null;
  return (w.masterPhaseSamples / w.masterLenSamples) * Math.max(1, w.recordedBeats);
}

function circularGap(a, b, period) {
  let d = fmod(a - b, period);
  return Math.min(d, period - d);
}

function initRemoteTransport(w, stalePhaseResetOnArm) {
  w.remote = {
    lastSeenRemotePlaying: false,
    remoteStartPending: false,
    lastRemotePhaseMicroBeats: 0,
    stalePhaseResetOnArm,
    armLog: [],
    launchLog: [],
  };
}

function applyRemoteTransport(w) {
  const rt = w.remote;
  const ls = w.linkSnapHeld;
  if (!ls || !ls.synced) return;

  const remotePlaying = ls.playing === true;
  if (remotePlaying !== rt.lastSeenRemotePlaying) {
    rt.lastSeenRemotePlaying = remotePlaying;
    if (remotePlaying === w.lastPublishedPlaying) return;
    if (remotePlaying) {
      rt.remoteStartPending = true;
      if (rt.stalePhaseResetOnArm) rt.lastRemotePhaseMicroBeats = -1;
      rt.armLog.push({
        t: w.t,
        nowMs: nowMs(w),
        barPhaseBeats: barPhaseOfSnapshot(ls),
        stalePhaseBeats: rt.lastRemotePhaseMicroBeats / 1e6,
      });
    } else {
      for (const lp of w.loopers) {
        if (!lp.playing) continue;
        lp.playing = false;
        lp.ps_play = 0;
      }
      rt.remoteStartPending = false;
      w.lastPublishedPlaying = false;
    }
    return;
  }

  if (!rt.remoteStartPending) return;
  if (ls.quantumMicroBeats <= 0) return;

  const remotePhaseBeats = ls.beatPhaseMicroBeats / 1e6;
  const remotePhaseBar = Math.round(fmod(remotePhaseBeats, kRemoteBarBeats) * 1e6);
  const wrappedPastQuantumStart = remotePhaseBar < rt.lastRemotePhaseMicroBeats;
  rt.lastRemotePhaseMicroBeats = remotePhaseBar;
  if (!wrappedPastQuantumStart) return;

  rt.remoteStartPending = false;
  for (const lp of w.loopers) {
    if (!lp.hasContent || lp.playing) continue;
    lp.playing = true;
    lp.ps_play = 1;
  }
  w.lastPublishedPlaying = true;
  rt.launchLog.push({
    t: w.t,
    nowMs: nowMs(w),
    barPhaseBeats: fmod(remotePhaseBeats, kRemoteBarBeats),
    phraseBeat: phraseBeatAt(w),
  });
}

function makeJoinPair() {
  const session = createLinkSession(kJoinBpm);
  const peerA = createLinkPeer('A', session);
  const peerB = createLinkPeer('B', session);
  registerPeer(peerA);
  registerPeer(peerB);
  const a = createWorld({ looperCount: 4, initialLinkBpm: kJoinBpm });
  const b = createWorld({ looperCount: 4, initialLinkBpm: kJoinBpm });
  a.link = { session, local: peerA, remote: peerB };
  b.link = { session, local: peerB, remote: peerA };
  return { session, a, b };
}

function stepPair(a, b) {
  const tickDue = (b.t % kControlTickSamples === 0);
  stepOneSample(a);
  stepOneSample(b);
  if (tickDue) applyRemoteTransport(b);
}

function advancePairMs(a, b, ms) {
  const n = msToSimSamples(ms);
  for (let i = 0; i < n; i++) stepPair(a, b);
}

function advancePairToBarPhase(a, b, targetBeats) {
  const beats = beatsToBarPhase(a.link.session, nowMs(a), targetBeats);
  advancePairMs(a, b, beats * msPerBeat(a.link.session));
}

function runFirstJoin(stalePhaseResetOnArm) {
  setPhaseQuantum(LINK_PHASE_QUANTUM);
  const { session, a, b } = makeJoinPair();
  initRemoteTransport(b, stalePhaseResetOnArm);

  onPadPress(a, 0);
  onPadRelease(a, 0);
  advancePairMs(a, b, kHoldMs);
  onPadPress(a, 0);
  onPadRelease(a, 0);
  advancePairMs(a, b, 9000);

  return { session, a, b };
}

function runRepeatJoin(stalePhaseResetOnArm) {
  setPhaseQuantum(LINK_PHASE_QUANTUM);
  const { session, a, b } = makeJoinPair();
  initRemoteTransport(b, stalePhaseResetOnArm);

  onPadPress(a, 0);
  onPadRelease(a, 0);
  advancePairMs(a, b, kHoldMs);
  onPadPress(a, 0);
  onPadRelease(a, 0);

  onPadPress(b, 0);
  onPadRelease(b, 0);
  advancePairMs(a, b, kHoldMs);
  onPadPress(b, 0);
  onPadRelease(b, 0);

  advancePairToBarPhase(a, b, 12.0);
  onPadPress(a, 0);
  onPadRelease(a, 0);

  advancePairToBarPhase(a, b, 3.0);
  onPadPress(a, 0);
  onPadRelease(a, 0);

  advancePairMs(a, b, 9000);
  return { session, a, b };
}

function settleGap(a, b) {
  advancePairMs(a, b, kSettleMs);
  const pa = phraseBeatAt(a);
  const pb = phraseBeatAt(b);
  if (pa === null || pb === null) return NaN;
  return circularGap(pa, pb, Math.max(1, a.recordedBeats));
}

function main() {
  const regression = process.argv.includes('--no-stale-phase-reset');
  const stalePhaseResetOnArm = !regression;
  let failed = 0;

  console.log(`remote join: stale-phase reset on arm = ${stalePhaseResetOnArm ? 'ENABLED (matches 50bacfb)' : 'DISABLED (regression of 50bacfb)'}`);

  const first = runFirstJoin(stalePhaseResetOnArm);
  const firstLaunch = first.b.remote.launchLog[0];
  console.log(`[first join]  t=${monotonicStamp()} arms=${first.b.remote.armLog.length} launches=${first.b.remote.launchLog.length}`);
  if (!firstLaunch) {
    console.log('  FAIL: the joining device never resolved its first remote START');
    failed++;
  } else {
    const armBeats = first.b.remote.armLog.length ? first.b.remote.armLog[0].barPhaseBeats : NaN;
    console.log(`  launched at bar phase ${firstLaunch.barPhaseBeats.toFixed(3)} beats (armed at ${armBeats.toFixed(3)}, tolerance ${kLaunchBarToleranceBeats})`);
    if (!(firstLaunch.barPhaseBeats < kLaunchBarToleranceBeats)) {
      console.log(`  FAIL: first join launched mid-bar at ${firstLaunch.barPhaseBeats.toFixed(3)} beats`);
      failed++;
    }
  }

  const repeat = runRepeatJoin(stalePhaseResetOnArm);
  const launch = repeat.b.remote.launchLog[repeat.b.remote.launchLog.length - 1];
  const arm = repeat.b.remote.armLog[repeat.b.remote.armLog.length - 1];
  console.log(`[repeat join] t=${monotonicStamp()} arms=${repeat.b.remote.armLog.length} launches=${repeat.b.remote.launchLog.length}`);
  if (!launch) {
    console.log('  FAIL: the joined device never launched on the repeat remote START');
    failed++;
  } else {
    console.log(`  armed at bar phase ${arm.barPhaseBeats.toFixed(3)} beats with stale phase ${arm.stalePhaseBeats.toFixed(3)} beats, launched at ${launch.barPhaseBeats.toFixed(3)} beats (tolerance ${kLaunchBarToleranceBeats})`);
    if (!(launch.barPhaseBeats < kLaunchBarToleranceBeats)) {
      console.log(`  FAIL: joined device resumed mid-bar at ${launch.barPhaseBeats.toFixed(3)} beats instead of waiting for the 16-beat boundary`);
      failed++;
    }
    if (!repeat.b.loopers[0].playing) {
      console.log('  FAIL: joined device had content but never resumed playback');
      failed++;
    }
    const gap = settleGap(repeat.a, repeat.b);
    console.log(`  A/B phrase gap after settle = ${gap.toFixed(3)} beats (A phrase=${phraseBeatAt(repeat.a).toFixed(3)}, B phrase=${phraseBeatAt(repeat.b).toFixed(3)}, beats=${repeat.a.recordedBeats})`);
  }

  const violations = [
    ...runAllInvariants(repeat.a).map((v) => ({ device: 'A', ...v })),
    ...runAllInvariants(repeat.b).map((v) => ({ device: 'B', ...v })),
  ];
  for (const v of violations) {
    console.log(`  invariant violation on ${v.device}: ${v.message}`);
    failed++;
  }

  console.log(failed === 0 ? 'remote join: PASS' : `remote join: FAIL (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

if (require.main === module) main();

module.exports = {
  runFirstJoin, runRepeatJoin, applyRemoteTransport, initRemoteTransport,
  makeJoinPair, advancePairMs, barPhaseAt, phraseBeatAt,
};
