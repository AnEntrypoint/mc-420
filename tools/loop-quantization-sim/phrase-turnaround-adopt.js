'use strict';

const W = require('./world');
const { setPhaseQuantum, LINK_PHASE_QUANTUM } = require('./link');
const { makeJoinPair, advancePairMs, initRemoteTransport } = require('./remote-join');

const kMasterHoldMs = 2000;
const kSettleMs = 2000;
const kPhraseToleranceBeats = 1e-3;

function runJoin(enabled) {
  W.setPhraseMeshEnabled(enabled);
  setPhaseQuantum(LINK_PHASE_QUANTUM);
  const { a, b } = makeJoinPair();
  initRemoteTransport(b, true);

  advancePairMs(a, b, 300);
  W.onPadPress(a, 0); W.onPadRelease(a, 0);
  advancePairMs(a, b, kMasterHoldMs);
  W.onPadPress(a, 0); W.onPadRelease(a, 0);
  advancePairMs(a, b, kSettleMs);

  return { masterPhrase: a.recordedBeats, slavePhrase: b.link.local.foldBeats };
}

function main() {
  const on = runJoin(true);
  const onOk = on.masterPhrase >= 1 && Math.abs(on.slavePhrase - on.masterPhrase) <= kPhraseToleranceBeats;
  const off = runJoin(false);
  const offOk = off.slavePhrase === 0;
  W.setPhraseMeshEnabled(false);

  console.log('phrase turnaround: an empty slave loops on the recorder phrase');
  console.log(`  flag on: master phrase ${on.masterPhrase} beats, slave loop phrase ${on.slavePhrase} beats ${onOk ? 'ok' : 'FAIL'}`);
  console.log(`  flag off (device default): slave loop phrase ${off.slavePhrase} beats, no adoption ${offOk ? 'ok' : 'FAIL'}`);
  const ok = onOk && offOk;
  console.log(ok ? 'phrase turnaround: PASS' : 'phrase turnaround: FAIL');
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
module.exports = { main };
