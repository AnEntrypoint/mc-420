'use strict';

const W = require('./world');
const { setPhaseQuantum, LINK_PHASE_QUANTUM } = require('./link');
const { makeJoinPair, advancePairMs, initRemoteTransport } = require('./remote-join');

const kMasterHoldMs = 2000;
const kSlaveHoldMs = 1000;
const kSettleMs = 2000;
const kPhraseToleranceBeats = 1e-3;

function main() {
  setPhaseQuantum(LINK_PHASE_QUANTUM);
  const { a, b } = makeJoinPair();
  initRemoteTransport(b, true);

  advancePairMs(a, b, 300);
  W.onPadPress(a, 0); W.onPadRelease(a, 0);
  advancePairMs(a, b, kMasterHoldMs);
  W.onPadPress(a, 0); W.onPadRelease(a, 0);
  advancePairMs(a, b, kSettleMs);

  advancePairMs(a, b, 1000);
  W.onPadPress(b, 0); W.onPadRelease(b, 0);
  advancePairMs(a, b, kSlaveHoldMs);
  W.onPadPress(b, 0); W.onPadRelease(b, 0);
  advancePairMs(a, b, kSettleMs);

  const masterPhrase = a.recordedBeats;
  const slavePhrase = b.link.local.foldBeats;
  const ok = Math.abs(slavePhrase - masterPhrase) <= kPhraseToleranceBeats;

  console.log('phrase turnaround: every device loops on the shared phrase');
  console.log(`  master phrase ${masterPhrase} beats`);
  console.log(`  slave loop phrase ${slavePhrase} beats (its own take ${b.recordedBeats} beats) ${ok ? 'ok' : 'FAIL'}`);
  console.log(ok
    ? 'phrase turnaround: PASS'
    : 'phrase turnaround: FAIL (slave loops on its own take length, not the shared phrase)');
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
module.exports = { main };
