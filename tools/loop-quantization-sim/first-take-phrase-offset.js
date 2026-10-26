'use strict';

const W = require('./world');
const { setPhaseQuantum, LINK_PHASE_QUANTUM, beatAtTime, LINK_QUANTUM } = require('./link');
const { makeJoinPair, advancePairMs, initRemoteTransport } = require('./remote-join');

const kSettleMs = 1500;
const kToleranceBeats = 1e-3;
const kCases = [
  { holdMs: 1000, beats: 2 },
  { holdMs: 1500, beats: 3 },
  { holdMs: 2000, beats: 4 },
];

function circularGap(a, b, period) {
  const d = ((a - b) % period + period) % period;
  return Math.min(d, period - d);
}

function firstTakeOnNetwork(holdMs) {
  setPhaseQuantum(LINK_PHASE_QUANTUM);
  const { session, a, b } = makeJoinPair();
  initRemoteTransport(b, true);
  advancePairMs(a, b, 300);
  W.onPadPress(a, 0); W.onPadRelease(a, 0);
  const pressT = a.loopers[0].recordStartT;
  advancePairMs(a, b, holdMs);
  W.onPadPress(a, 0); W.onPadRelease(a, 0);
  advancePairMs(a, b, kSettleMs);
  const recorded = a.recordedBeats;
  const pressBeat = beatAtTime(session, (pressT / W.SIM_SAMPLE_RATE) * 1000);
  return { recorded, pressBeat, gap: circularGap(pressBeat, recorded, LINK_QUANTUM) };
}

function main() {
  let failed = 0;
  console.log(`first take phrase turnaround: sits one loop before the record press (Link beat at press = loop length mod ${LINK_QUANTUM})`);
  for (const c of kCases) {
    const r = firstTakeOnNetwork(c.holdMs);
    const ok = r.recorded === c.beats && r.gap <= kToleranceBeats;
    console.log(`  ${c.beats}-beat first take: recorded ${r.recorded} beats, Link beat at press ${r.pressBeat.toFixed(4)}, gap to ${c.beats} ${ok ? 'ok' : 'FAIL'} (${r.gap.toFixed(4)} beats)`);
    if (!ok) failed++;
  }
  console.log(failed === 0 ? 'first take phrase turnaround: PASS' : `first take phrase turnaround: FAIL (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

if (require.main === module) main();
module.exports = { firstTakeOnNetwork };
