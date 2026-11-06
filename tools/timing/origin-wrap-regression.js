'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { wrap, centre, originMinusArm } = require('./origin-formula');

const kTol = 1e-6;
const legacy = process.argv.includes('--legacy');

function legacyOriginMinusArm(audioSamples, masterPhaseSamples, masterLenSamples, armSamples) {
  return audioSamples - masterPhaseSamples - armSamples;
}

const compute = legacy ? legacyOriginMinusArm : originMinusArm;

const cases = [
  { name: 'rb3 no wrap', masterLen: 72000, arm: 364736, origin: 364697, wraps: 0, delta: 12000 },
  { name: 'rb3 one wrap', masterLen: 72000, arm: 364736, origin: 364697, wraps: 1, delta: 12000 },
  { name: 'rb3 three wraps', masterLen: 72000, arm: 364736, origin: 364697, wraps: 3, delta: 47000 },
  { name: 'rb3 seven wraps near boundary', masterLen: 72000, arm: 364736, origin: 364697, wraps: 7, delta: 71999 },
  { name: 'rb4 one wrap', masterLen: 104575, arm: 364736, origin: 364800, wraps: 1, delta: 70000 },
  { name: 'rb4 four wraps', masterLen: 104575, arm: 500000, origin: 499936, wraps: 4, delta: 1000 },
];

const doc = fs.readFileSync(path.resolve(__dirname, '../../docs/measurements-archive.md'), 'utf8');
assert.match(doc, /origin minus arm edge = centre\(\(audio count - master phase - arm edge\) mod master_len\)/);

let failed = 0;
let legacyFailures = 0;
for (const c of cases) {
  const audio = c.origin + c.wraps * c.masterLen + c.delta;
  const phase = wrap(audio - c.origin, c.masterLen);
  const expected = c.origin - c.arm;
  const got = compute(audio, phase, c.masterLen, c.arm);
  const ok = Math.abs(got - expected) <= kTol;
  const legacyDrift = legacyOriginMinusArm(audio, phase, c.masterLen, c.arm) - expected;
  if (c.wraps > 0 && Math.abs(legacyDrift) >= c.masterLen) legacyFailures += 1;
  if (!ok) failed += 1;
  console.log('  ' + c.name + ': audio=' + audio + ' phase=' + phase + ' arm=' + c.arm + ' expected=' + expected + ' got=' + got + ' legacyDrift=' + legacyDrift + ' ' + (ok ? 'ok' : 'FAIL'));
}

assert.equal(centre(123 + 5 * 72000, 72000), centre(123, 72000));
assert.equal(centre(-123 - 5 * 72000, 72000), centre(-123, 72000));
if (!legacy) {
  assert.equal(legacyFailures, cases.filter(function (c) { return c.wraps > 0; }).length);
}

console.log(failed === 0
  ? 'origin wrap regression: PASS (' + cases.length + ' cases, ' + legacyFailures + ' wrap cases fail the old formula)'
  : 'origin wrap regression: FAIL (' + failed + ' cases)');
process.exit(failed === 0 ? 0 : 1);
