'use strict';

const W = require('./world');
const L = require('./link');

const kPeerBpm = 157.2;
const kHoldMs = 2000;
const kAcquireLeadMs = 150;
const kMaxLeadMs = 200;

function instrument(w) {
  const calls = { imposeTempo: 0, setTempoWrites: 0 };
  const originalImpose = w.link.local.imposeTempo;
  w.link.local.imposeTempo = function (bpm, atTimeMs) {
    calls.imposeTempo++;
    return originalImpose.call(this, bpm, atTimeMs);
  };
  let tempo = w.link.session.tempo;
  Object.defineProperty(w.link.session, 'tempo', {
    configurable: true,
    enumerable: true,
    get() { return tempo; },
    set(value) { calls.setTempoWrites++; tempo = value; },
  });
  return calls;
}

function run(holdStaleSnapshot) {
  L.setPhaseQuantum(L.LINK_PHASE_QUANTUM);
  const w = W.createWorld({ looperCount: 4, initialLinkBpm: kPeerBpm });
  w.link.remote.connected = true;
  W.refreshLinkSnapshot(w);
  const staleSnapshot = Object.assign({}, w.linkSnapHeld, {
    peers: 1,
    synced: true,
    bpm: kPeerBpm,
    phaseValid: true,
  });
  w.link.remote.connected = false;
  w.legacyAdoptLinkTempo = holdStaleSnapshot;
  if (holdStaleSnapshot) {
    w.link.local.audioRead = () => staleSnapshot;
    w.linkSnapHeld = staleSnapshot;
  }
  const calls = instrument(w);
  W.onPadPress(w, 0);
  W.onPadRelease(w, 0);
  const recordStartT = w.loopers[0].recordStartT;
  const finishT = w.t + W.msToSimSamples(kHoldMs);
  const acquireT = finishT - W.msToSimSamples(kAcquireLeadMs);
  while (w.t < acquireT) W.stepOneSample(w);
  w.link.remote.connected = true;
  while (w.t < finishT) W.stepOneSample(w);
  const finishAt = w.t;
  const snapshotPeersAtGate = w.linkSnapHeld.peers;
  const snapshotSyncedAtGate = w.linkSnapHeld.synced;
  W.onPadPress(w, 0);
  W.onPadRelease(w, 0);
  W.advance(w, W.msToSimSamples(50));
  return {
    calls,
    leadMs: ((finishAt - acquireT) / W.SIM_SAMPLE_RATE) * 1000,
    acquireAfterRecordMs: ((acquireT - recordStartT) / W.SIM_SAMPLE_RATE) * 1000,
    connectedAtFinish: w.link.remote.connected,
    snapshotPeersAtGate,
    snapshotSyncedAtGate,
    masterLen: w.masterLenSamples,
    recordedBpm: w.recordedBpm,
    sessionTempo: w.link.session.tempo,
  };
}

function assert(condition, label) {
  console.log(`  ${label}: ${condition ? 'ok' : 'FAIL'}`);
  return condition ? 0 : 1;
}

function main() {
  const control = process.argv.includes('--control');
  const r = run(!control);
  console.log('join race tempo authority: peer acquired during the first take within 200 ms of FINISH');
  console.log(`  acquire-to-FINISH lead: ${r.leadMs.toFixed(1)} ms; peer connected at FINISH: ${r.connectedAtFinish}`);
  console.log(`  stale peerCount snapshot at gate: peers=${r.snapshotPeersAtGate} synced=${r.snapshotSyncedAtGate}`);
  console.log(`  imposeTempo calls: ${r.calls.imposeTempo}; setTempo writes: ${r.calls.setTempoWrites}; session tempo: ${r.sessionTempo.toFixed(2)}`);
  console.log(`  take finished: masterLen=${r.masterLen} recordedBpm=${r.recordedBpm.toFixed(2)}`);
  let failed = 0;
  failed += assert(r.leadMs > 0 && r.leadMs <= kMaxLeadMs, 'peer acquisition within 200 ms of FINISH');
  failed += assert(r.acquireAfterRecordMs > 0, 'peer acquisition after record press');
  failed += assert(r.connectedAtFinish === true, 'peer present at FINISH');
  failed += assert(r.snapshotPeersAtGate > 0 && r.snapshotSyncedAtGate === true, 'stale peerCount held at tempo-authority gate');
  failed += assert(r.masterLen > 0 && r.recordedBpm > 1, 'first take finished');
  failed += assert(r.calls.imposeTempo === 0 && r.calls.setTempoWrites === 0, 'device does not call setTempo or imposeTempo for that take');
  failed += assert(Math.abs(r.sessionTempo - kPeerBpm) < 1e-9, 'session tempo unchanged');
  if (control) {
    console.log(failed === 0 ? 'join race tempo authority: FAIL control unexpectedly passed' : `join race tempo authority: FAIL control exits 1 (${failed} failed assertion(s))`);
  } else {
    console.log('join race tempo authority: new case passes by construction on the locked world model; FAIL control runs with --control');
    console.log(failed === 0 ? 'join race tempo authority: PASS' : `join race tempo authority: FAIL (${failed})`);
  }
  process.exit(failed === 0 ? 0 : 1);
}

if (require.main === module) main();
module.exports = { run };
