#!/usr/bin/env node
'use strict';

const fs = require('fs');

const lines = fs.readFileSync(0, 'utf8').split('\n').filter((l) => l.length > 0);
const failures = [];
function need(cond, msg) { if (!cond) failures.push(msg); }

need(lines.length === 2, `harness must print two lines (raw, sanitized), got ${lines.length}`);

const [raw, safe] = lines;
let rawParses = true;
try { JSON.parse(raw); } catch (e) { rawParses = false; }
need(!rawParses, 'raw line with nan/inf must NOT parse, otherwise the test exercises nothing');

let parsed = null;
try { parsed = JSON.parse(safe); } catch (e) { failures.push(`sanitized line is not JSON: ${e.message}`); }

if (parsed) {
  const level = parsed.loopers && parsed.loopers.level;
  need(Array.isArray(level), 'loopers.level must stay an array');
  need(JSON.stringify(level) === JSON.stringify([null, null, null, null, 0.5, 1]),
    `loopers.level must be [null,null,null,null,0.5,1], got ${JSON.stringify(level)}`);
  need(parsed.audio_peak && parsed.audio_peak.in === 0.25, 'finite audio_peak.in must keep its value');
  need(parsed.link && parsed.link.bpm === null, 'NaN link.bpm must become null');
}

need(!/[:\[,](-?nan|-?inf)[,\]}]/i.test(safe), 'sanitized output must contain no nan or inf token');

if (failures.length) {
  for (const f of failures) console.log(`FAIL ${f}`);
  console.log('NONFINITE JSON: FAIL');
  process.exit(1);
}
console.log('raw line rejected by JSON.parse, sanitized line parses; loopers.level [null,null,null,null,0.5,1]; link.bpm null');
console.log('NONFINITE JSON: PASS');
