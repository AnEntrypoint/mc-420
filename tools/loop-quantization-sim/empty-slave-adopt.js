'use strict';

const W = require('./world');
const { setPhaseQuantum, LINK_PHASE_QUANTUM, beatAtTime, LINK_QUANTUM } = require('./link');
const { makeJoinPair, advancePairMs, initRemoteTransport } = require('./remote-join');

const kHoldMs = 2000;
const kSettleMs = 1500;
const kTickMs = 250;
const kOriginToleranceBeats = 1e-3;
const kPhaseToleranceBeats = 0.02;

function circularGap(a, b, period) {
  const d = ((a - b) % period + period) % period;
  return Math.min(d, period - d);
}

function main() {
  setPhaseQuantum(LINK_PHASE_QUANTUM);
  const { session, a, b } = makeJoinPair();
  initRemoteTransport(b, true);
  b.adoptsPeerOrigin = true;

  advancePairMs(a, b, 300);
  W.onPadPress(a, 0); W.onPadRelease(a, 0);
  const pressA = a.loopers[0].recordStartT;
  advancePairMs(a, b, kHoldMs);
  W.onPadPress(a, 0); W.onPadRelease(a, 0);
  const finishA = a.t;
  advancePairMs(a, b, kTickMs);

  const originAtPublish = circularGap(beatAtTime(session, (pressA / W.SIM_SAMPLE_RATE) * 1000), 0, LINK_QUANTUM);
  const bpmSeenByB = b.linkSnapHeld.bpm;
  const syncedB = b.linkSnapHeld.synced;
  const adoptOk = syncedB && Math.abs(bpmSeenByB - a.recordedBpm) < 0.05 && originAtPublish <= kOriginToleranceBeats;

  advancePairMs(a, b, 1000);
  W.onPadPress(b, 0); W.onPadRelease(b, 0);
  const pressB = b.loopers[0].recordStartT;
  advancePairMs(a, b, kHoldMs);
  W.onPadPress(b, 0); W.onPadRelease(b, 0);
  advancePairMs(a, b, kSettleMs);

  const originAfterOwnTake = circularGap(beatAtTime(session, (pressA / W.SIM_SAMPLE_RATE) * 1000), 0, LINK_QUANTUM);
  const keepOk = originAfterOwnTake <= kOriginToleranceBeats;

  const beatsB = b.recordedBeats || a.recordedBeats;
  const P = Math.max(1, a.recordedBeats);
  const linkPhaseBeats = ((beatAtTime(session, (b.t / W.SIM_SAMPLE_RATE) * 1000) % P) + P) % P;
  const lenB = b.masterLenSamples;
  const expectedB = (linkPhaseBeats / P) * lenB;
  const phaseGapBeats = b.masterLenSamples > 0 ? circularGap(b.masterPhaseSamples, expectedB, lenB) / (lenB / P) : NaN;
  const phaseOk = phaseGapBeats <= kPhaseToleranceBeats;

  let failed = 0;
  console.log('empty slave adopts the peer origin and keeps it');
  console.log(`  publish: B sees bpm ${bpmSeenByB.toFixed(3)} (A ${a.recordedBpm.toFixed(3)}), synced ${syncedB}, origin gap ${originAtPublish.toFixed(5)} beats ${adoptOk ? 'ok' : 'FAIL'}`);
  console.log(`  own later take: origin gap after B's take ${originAfterOwnTake.toFixed(5)} beats ${keepOk ? 'ok' : 'FAIL'}`);
  console.log(`  B loop phase vs Link grid: ${Number.isFinite(phaseGapBeats) ? phaseGapBeats.toFixed(3) : 'n/a'} beats (tolerance ${kPhaseToleranceBeats}) ${phaseOk ? 'ok' : 'FAIL'}`);
  if (!adoptOk) failed++;
  if (!keepOk) failed++;
  if (!phaseOk) failed++;
  console.log(failed === 0 ? 'empty slave adopt: PASS' : `empty slave adopt: FAIL (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

if (require.main === module) main();
module.exports = { main };
