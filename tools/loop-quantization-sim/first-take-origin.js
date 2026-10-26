'use strict';

const W = require('./world');
const { setPhaseQuantum, LINK_PHASE_QUANTUM, beatAtTime, LINK_QUANTUM } = require('./link');
const { makeJoinPair, advancePairMs, initRemoteTransport } = require('./remote-join');

const kBpm = 120.0;
const kHoldMs = 2000;
const kSettleMs = 1500;
const kToleranceSamples = 2;
const kToleranceBeats = 1e-3;
const kPhaseToleranceBeats = 0.02;

function circularGap(a, b, period) {
  const d = ((a - b) % period + period) % period;
  return Math.min(d, period - d);
}

function standalone() {
  const w = W.createWorld({ looperCount: 4, initialLinkBpm: kBpm });
  W.advance(w, W.msToSimSamples(300));
  W.onPadPress(w, 0); W.onPadRelease(w, 0);
  const pressT = w.loopers[0].recordStartT;
  W.advance(w, W.msToSimSamples(kHoldMs));
  W.onPadPress(w, 0); W.onPadRelease(w, 0);
  W.advance(w, W.msToSimSamples(kSettleMs));

  const L = w.masterLenSamples;
  let worst = 0;
  for (let k = 0; k < 20; k++) {
    const expected = ((w.t - pressT) % L + L) % L;
    worst = Math.max(worst, circularGap(w.masterPhaseSamples, expected, L));
    W.advance(w, W.msToSimSamples(50));
  }
  return { worst, L, pressT };
}

function ticker() {
  setPhaseQuantum(LINK_PHASE_QUANTUM);
  const { session, a, b } = makeJoinPair();
  initRemoteTransport(b, true);
  advancePairMs(a, b, 300);
  W.onPadPress(a, 0); W.onPadRelease(a, 0);
  const pressT = a.loopers[0].recordStartT;
  advancePairMs(a, b, kHoldMs);
  W.onPadPress(a, 0); W.onPadRelease(a, 0);
  advancePairMs(a, b, kSettleMs);

  const pressMs = (pressT / W.SIM_SAMPLE_RATE) * 1000;
  const beatAtPress = beatAtTime(session, pressMs);
  const L = a.masterLenSamples;
  const P = Math.max(1, a.recordedBeats);
  const nowMs = (a.t / W.SIM_SAMPLE_RATE) * 1000;
  const linkPhase = ((beatAtTime(session, nowMs) % P) + P) % P;
  const phaseGapBeats = L > 0 ? circularGap(a.masterPhaseSamples, (linkPhase / P) * L, L) / (L / P) : NaN;
  return { gap: circularGap(beatAtPress, P, LINK_QUANTUM), beatAtPress, phaseGapBeats, P };
}

function holder() {
  setPhaseQuantum(LINK_PHASE_QUANTUM);
  const { session, a, b } = makeJoinPair();
  initRemoteTransport(b, true);
  b.link.local.connected = false;
  advancePairMs(a, b, 300);
  W.onPadPress(b, 0); W.onPadRelease(b, 0);
  const pressB = b.loopers[0].recordStartT;
  advancePairMs(a, b, kHoldMs);
  W.onPadPress(b, 0); W.onPadRelease(b, 0);
  advancePairMs(a, b, 1000);
  b.link.local.connected = true;
  advancePairMs(a, b, 500);
  W.onPadPress(a, 0); W.onPadRelease(a, 0);
  const pressA = a.loopers[0].recordStartT;
  advancePairMs(a, b, kHoldMs);
  W.onPadPress(a, 0); W.onPadRelease(a, 0);
  advancePairMs(a, b, kSettleMs);

  const L = b.masterLenSamples;
  const expectedB = ((b.t - pressA) % L + L) % L;
  const oldOriginOffset = circularGap(pressB % L, pressA % L, L) / L;
  const gap = L > 0 ? circularGap(b.masterPhaseSamples, expectedB, L) / (L / Math.max(1, b.recordedBeats)) : NaN;
  const phrase = Math.max(1, b.recordedBeats);
  const pressedBeatA = beatAtTime(session, (pressA / W.SIM_SAMPLE_RATE) * 1000);
  return { gap, oldOriginOffset, originGap: circularGap(pressedBeatA, a.recordedBeats, phrase), L, recordedBeats: phrase, hasPhrase: L > 0 };
}

function main() {
  let failed = 0;
  console.log('first take origin: the master grid starts on the record-press sample');

  const h = holder();
  const hMoved = h.oldOriginOffset > 0.05;
  const hOriginTolBeats = kToleranceSamples * Math.max(1, h.recordedBeats) / h.L;
  const hOk = h.hasPhrase && hMoved && h.gap <= kPhaseToleranceBeats && h.originGap <= hOriginTolBeats;
  console.log(`  holder: device with a phrase from before the network endpoint, old origin ${(h.oldOriginOffset * 100).toFixed(1)}% of the loop away${hMoved ? '' : ' (case proves nothing)'}; position vs press ${h.gap.toFixed(4)} beats, origin gap ${h.originGap.toFixed(4)} beats ${hOk ? 'ok' : 'FAIL'}`);
  if (!hOk) failed++;

  const s = standalone();
  const sOk = s.worst <= kToleranceSamples;
  console.log(`  standalone: loop phase vs press, worst ${s.worst.toFixed(2)} samples over ${s.L}-sample loop ${sOk ? 'ok' : 'FAIL'}`);
  if (!sOk) failed++;

  const t = ticker();
  const tOk = t.gap <= kToleranceBeats;
  console.log(`  ticker: Link beat at press ${t.beatAtPress.toFixed(4)}, gap to phrase turnaround one loop before press (beat ${t.P} mod ${LINK_QUANTUM}) = ${t.gap.toFixed(4)} beats ${tOk ? 'ok' : 'FAIL'}`);
  if (!tOk) failed++;
  const pOk = Number.isFinite(t.phaseGapBeats) && t.phaseGapBeats <= kPhaseToleranceBeats;
  console.log(`  ticker: DSP loop phase vs Link target at the finish block, gap ${t.phaseGapBeats.toFixed(4)} beats (tolerance ${kPhaseToleranceBeats}) ${pOk ? 'ok' : 'FAIL'}`);
  if (!pOk) failed++;

  console.log(failed === 0 ? 'first take origin: PASS' : `first take origin: FAIL (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

if (require.main === module) main();
module.exports = { standalone, ticker };
