'use strict';

const W = require('./world');
const { setPhaseQuantum, LINK_PHASE_QUANTUM, beatAtTime, LINK_QUANTUM } = require('./link');
const { makeJoinPair, advancePairMs, initRemoteTransport } = require('./remote-join');

const kSettleMs = 1500;
const kToleranceBeats = 1e-3;
const kTempoToleranceBpm = 0.5;
const kLengthToleranceSamples = 2;
const kCases = [
  { holdMs: 966, beats: 2 },
  { holdMs: 1450, beats: 3 },
  { holdMs: 1900, beats: 4 },
];

function circularGap(a, b, period) {
  const d = ((a - b) % period + period) % period;
  return Math.min(d, period - d);
}

function firstTakeOnNetwork(holdMs, legacyPeerGate) {
  setPhaseQuantum(LINK_PHASE_QUANTUM);
  const { session, a, b } = makeJoinPair();
  a.legacyPeerGate = legacyPeerGate;
  initRemoteTransport(b, true);
  advancePairMs(a, b, 300);
  W.onPadPress(a, 0); W.onPadRelease(a, 0);
  const pressT = a.loopers[0].recordStartT;
  advancePairMs(a, b, holdMs);
  W.onPadPress(a, 0); W.onPadRelease(a, 0);
  advancePairMs(a, b, kSettleMs);
  const recorded = a.recordedBeats;
  const pressBeat = beatAtTime(session, (pressT / W.SIM_SAMPLE_RATE) * 1000);
  return {
    recorded,
    pressBeat,
    gap: circularGap(pressBeat, recorded, LINK_QUANTUM),
    sessionBpm: session.tempo,
    expectedBpm: recorded * 60000 / holdMs,
    loopSamples: a.masterLenSamples,
    expectedSamples: holdMs * W.SIM_SAMPLE_RATE / 1000,
  };
}

function main() {
  const legacyPeerGate = process.argv.includes('--legacy-peer-gate');
  let failed = 0;
  console.log('first take phrase turnaround: sits one loop before the record press (Link beat at press = loop length mod ' + LINK_QUANTUM + ')');
  console.log('  first loop owns the tempo with a peer present: session tempo = beats*60/recorded seconds, loop length = recorded length' + (legacyPeerGate ? ' (LEGACY PEER GATE)' : ''));
  for (const c of kCases) {
    const r = firstTakeOnNetwork(c.holdMs, legacyPeerGate);
    const beatsOk = r.recorded === c.beats;
    const gapOk = r.gap <= kToleranceBeats;
    const tempoOk = Math.abs(r.sessionBpm - r.expectedBpm) <= kTempoToleranceBpm;
    const lengthOk = Math.abs(r.loopSamples - r.expectedSamples) <= kLengthToleranceSamples;
    const ok = beatsOk && gapOk && tempoOk && lengthOk;
    console.log('  ' + c.beats + '-beat first take (' + c.holdMs + ' ms): recorded ' + r.recorded + ' beats, Link beat at press ' + r.pressBeat.toFixed(4)
      + ' gap ' + r.gap.toFixed(4) + ' beats, session tempo ' + r.sessionBpm.toFixed(3) + ' vs take tempo ' + r.expectedBpm.toFixed(3)
      + ', loop ' + r.loopSamples + ' vs recorded ' + r.expectedSamples.toFixed(0) + ' samples ' + (ok ? 'ok' : 'FAIL'));
    if (!ok) failed++;
  }
  if (legacyPeerGate) {
    console.log(failed > 0
      ? 'first take phrase turnaround: legacy peer-gate control FAILS at ' + failed + '/' + kCases.length + ' takes (tempo not owned, loop quantized)'
      : 'first take phrase turnaround: legacy peer-gate control WEAK (passed at all takes)');
    process.exit(failed > 0 ? 1 : 0);
  }
  console.log(failed === 0 ? 'first take phrase turnaround: PASS' : 'first take phrase turnaround: FAIL (' + failed + ')');
  process.exit(failed === 0 ? 0 : 1);
}

if (require.main === module) main();
module.exports = { firstTakeOnNetwork };
