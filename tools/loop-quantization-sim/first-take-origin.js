'use strict';

const W = require('./world');
const { setPhaseQuantum, LINK_PHASE_QUANTUM, beatAtTime, LINK_QUANTUM } = require('./link');
const { makeJoinPair, advancePairMs, initRemoteTransport } = require('./remote-join');

const kBpm = 120.0;
const kHoldMs = 2000;
const kSettleMs = 1500;
const kToleranceSamples = 2;
const kToleranceBeats = 1e-3;

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
  return { gap: circularGap(beatAtPress, 0, LINK_QUANTUM), beatAtPress };
}

function main() {
  let failed = 0;
  console.log('first take origin: the master grid starts on the record-press sample');

  const s = standalone();
  const sOk = s.worst <= kToleranceSamples;
  console.log(`  standalone: loop phase vs press, worst ${s.worst.toFixed(2)} samples over ${s.L}-sample loop ${sOk ? 'ok' : 'FAIL'}`);
  if (!sOk) failed++;

  const t = ticker();
  const tOk = t.gap <= kToleranceBeats;
  console.log(`  ticker: Link beat at press ${t.beatAtPress.toFixed(4)}, gap to beat 0 mod ${LINK_QUANTUM} = ${t.gap.toFixed(4)} beats ${tOk ? 'ok' : 'FAIL'}`);
  if (!tOk) failed++;

  console.log(failed === 0 ? 'first take origin: PASS' : `first take origin: FAIL (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

if (require.main === module) main();
module.exports = { standalone, ticker };
