#!/usr/bin/env node
'use strict';
const fs = require('fs');
const file = process.argv[2];
if (!file) { console.error('usage: node verify-adr034-impose-target.js <harness-output-file>'); process.exit(2); }
const lines = fs.readFileSync(file, 'utf8').split('\n');
const adrLines = lines.filter((l) => l.indexOf('ADR034') >= 0);
const within = adrLines.filter((l) => l.indexOf('WITHIN_TOLERANCE') >= 0).length;
const notPublished = adrLines.filter((l) => l.indexOf('NOT_PUBLISHED') >= 0).length;
const outside = adrLines.filter((l) => l.indexOf('OUTSIDE_TOLERANCE') >= 0).length;
const failedRules = lines.filter((l) => l.indexOf('[FAIL]') === 0);
const allPass = lines.some((l) => l.indexOf('[clear-reset] ALL PASS') >= 0);
const gateLine = lines.find((l) => l.indexOf('[clear-reset] gate=') >= 0) || '';
const published = lines.filter((l) => l.indexOf('imposeTarget') >= 0 && l.indexOf('telemetry') < 0);
const rules = [
  ['two ADR034 observations', adrLines.length === 2, adrLines.length],
  ['both WITHIN_TOLERANCE', within === 2, within],
  ['no NOT_PUBLISHED', notPublished === 0, notPublished],
  ['no OUTSIDE_TOLERANCE', outside === 0, outside],
  ['no failed harness rules', failedRules.length === 0, failedRules.length],
  ['harness ALL PASS', allPass, allPass],
  ['corrected gate used', gateLine.indexOf('gate=corrected') >= 0, gateLine.trim()]
];
console.log('[adr034-judge] file=' + file);
for (const r of rules) console.log('[' + (r[1] ? 'PASS' : 'FAIL') + '] ' + r[0] + ' ' + r[2]);
for (const l of adrLines) console.log('[adr034-judge] ' + l.trim());
for (const l of published) console.log('[adr034-judge] ' + l.trim());
const pass = rules.every((r) => r[1]);
console.log('[adr034-judge] ' + (pass ? 'PASS' : 'FAIL'));
process.exit(pass ? 0 : 1);
