'use strict';

const { initLooperDsp, stepSample } = require('./looper');

const kMasterLen = 144000;
const kBeats = 6;
const kHorizonMasters = 3;
const kEdgeGuard = 2;

const kWholeBeatCases = [
  { name: '5-beat take in 6-beat master', takeLen: 120000 },
  { name: '4-beat take in 6-beat master', takeLen: 96000 },
  { name: '3-beat take in 6-beat master (divisor)', takeLen: 72000 },
  { name: '2-beat take in 6-beat master (divisor)', takeLen: 48000 },
  { name: '1-beat take in 6-beat master (divisor)', takeLen: 24000 },
  { name: '8-beat take over 6-beat master (longer)', takeLen: 192000 },
];
const kInformationalCases = [
  { name: '3.5-beat take in 6-beat master (half-beat, out of scope)', takeLen: 84000 },
];

function replayTake(takeLen) {
  let s = initLooperDsp();
  const finishAt = Math.floor(takeLen / 2);
  const playFrom = takeLen + 8;
  const horizon = kMasterLen * kHorizonMasters;
  let base = null;
  let mismatches = 0;
  let firstAt = -1;
  let checked = 0;
  for (let t = 0; t < horizon; t++) {
    const r = stepSample(s, {
      recN: t < finishAt ? 1 : 0,
      finishReqN: t === finishAt ? 1 : 0,
      finishTargetN: takeLen,
      eraseN: 0,
      clearAll: 0,
      masterPhase: t % kMasterLen,
      masterPhasePrev: t === 0 ? 0 : (t - 1) % kMasterLen,
      masterLen: kMasterLen,
      recordedBeats: kBeats,
      effSpeed: 1,
      manualSpeed: 1,
      inputSample: t + 1,
      latencyBiasN: 0,
      resyncCoeff: 0.0005,
    });
    s = r;
    if (t < playFrom) continue;
    const idx = t % takeLen;
    if (idx < kEdgeGuard || idx > takeLen - kEdgeGuard - 1) continue;
    const offset = r.out - idx;
    if (base === null) base = offset;
    checked++;
    if (offset !== base) {
      mismatches++;
      if (firstAt < 0) firstAt = t;
    }
  }
  return { checked, mismatches, firstAt, base };
}

function report(c) {
  const r = replayTake(c.takeLen);
  const ok = r.checked > 0 && r.mismatches === 0 && r.base === 1;
  const detail = `checked=${r.checked} mismatches=${r.mismatches} firstAt=${r.firstAt} offset=${r.base}`;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${c.name}: ${detail}`);
  return ok;
}

function main() {
  console.log('[non-divisor wrap] a take that does not divide the master must read the same loop position across the master downbeat: the read index is (absolute time - arm) mod take length, so the master wrap is seamless');
  let failed = 0;
  for (const c of kWholeBeatCases) if (!report(c)) failed++;
  for (const c of kInformationalCases) report(c);
  console.log(failed === 0 ? 'non-divisor wrap: PASS' : `non-divisor wrap: FAIL (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

if (require.main === module) main();
module.exports = { replayTake };
