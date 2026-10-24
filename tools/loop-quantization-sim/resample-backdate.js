'use strict';

const W = require('./world');

const kBlock = 64 / 100;
const kLandingToleranceSamples = 1;
const kFormulaToleranceSamples = 1e-9;
const kFolds = [0, 0.5, 1];

function latencyBiasFor(foldFraction, measuredFoldExtra) {
  const w = W.createWorld({ looperCount: 4, initialLinkBpm: 120.0 });
  w.foldFraction = foldFraction;
  w.resampleMeasuredExtra = measuredFoldExtra;
  W.advance(w, W.msToSimSamples(300));
  W.onPadPress(w, 0); W.onPadRelease(w, 0);
  W.advance(w, W.msToSimSamples(500));
  W.onPadPress(w, 0); W.onPadRelease(w, 0);
  return w.loopers[0].ps_latencybias;
}

function main() {
  let failed = 0;
  const trueExtra = kBlock;
  console.log('resample backdate: the SHIFT read offset is the measured dry bias plus the fold term');

  for (const f of kFolds) {
    const bias = latencyBiasFor(f, trueExtra);
    const expected = kBlock + f * trueExtra;
    const formulaOk = Math.abs(bias - expected) <= kFormulaToleranceSamples;
    const arrival = kBlock + f * trueExtra;
    const residual = arrival - bias;
    const landingOk = Math.abs(residual) <= kLandingToleranceSamples;
    console.log(`  fold ${f}: bias ${bias.toFixed(4)} = dry ${kBlock.toFixed(4)} + fold ${(f * trueExtra).toFixed(4)} ${formulaOk ? 'ok' : 'FAIL'}; residual ${residual.toFixed(4)} samples ${landingOk ? 'ok' : 'FAIL'}`);
    if (!formulaOk) failed++;
    if (!landingOk) failed++;
  }

  const staleExtra = 3 * kBlock;
  const staleBias = latencyBiasFor(1, staleExtra);
  const staleResidual = (kBlock + trueExtra) - staleBias;
  const discriminates = Math.abs(staleResidual) > kLandingToleranceSamples;
  console.log(`  stale measurement (fold ${staleExtra.toFixed(4)} vs true ${trueExtra.toFixed(4)}) misses by ${staleResidual.toFixed(4)} samples ${discriminates ? 'ok: the case catches it' : 'FAIL: the case cannot catch a stale measurement'}`);
  if (!discriminates) failed++;

  const low = latencyBiasFor(1, kBlock);
  const high = latencyBiasFor(1, 2 * kBlock);
  const tracks = Math.abs((high - low) - kBlock) <= kFormulaToleranceSamples;
  console.log(`  tracking: doubling the measured fold extra moves the offset by ${(high - low).toFixed(4)} samples ${tracks ? 'ok' : 'FAIL'}`);
  if (!tracks) failed++;

  console.log(failed === 0 ? 'resample backdate: PASS' : `resample backdate: FAIL (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

if (require.main === module) main();
module.exports = { latencyBiasFor };
