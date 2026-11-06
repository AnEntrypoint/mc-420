#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const SR = 48000;
const N = 64;
const PERIOD = 64;
const BUFFER = 128;
const ENGAGED_STAGE = 127;
const LIMIT_MS = 7;
const RISE = 51.9;
const file = path.join(__dirname, '..', '..', '.gm', 'witness-out', 'window4a-peer-present-latency.jsonl');
const recs = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const phases = ['before', 'during', 'after'];
function median(a) { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }
function stats(name) {
  const r = recs.filter((x) => x.phase === name);
  const b = r.map((x) => x.bias);
  return { phase: name, n: r.length, biasMedian: median(b), rtMedian: median(r.map((x) => x.rt)), engagedSamplesMedian: median(b) + ENGAGED_STAGE, engagedMsMedian: +((median(b) + ENGAGED_STAGE) / 48).toFixed(3), over7ms: r.filter((x) => (x.bias + ENGAGED_STAGE) / 48 > LIMIT_MS).length, peerViolations: r.filter((x) => !(x.peers >= 1 && x.synced === true)).length };
}
console.log('[alsa-prereg] SR=' + SR + ' N=' + N + ' PERIOD=' + PERIOD + ' BUFFER=' + BUFFER + ' ENGAGED_STAGE=' + ENGAGED_STAGE + ' LIMIT_MS=' + LIMIT_MS);
console.log('[alsa-prereg] RISE=' + RISE + ' RISE/N=' + (RISE / N).toFixed(4) + ' RISE/PERIOD=' + (RISE / PERIOD).toFixed(4) + ' RISE/BUFFER=' + (RISE / BUFFER).toFixed(4) + ' RISE_MS=' + (RISE / 48).toFixed(4));
for (const p of phases) console.log('[alsa-prereg] ' + JSON.stringify(stats(p)));
const lowBias = 190.3;
const highBias = 237.6;
console.log('[alsa-prereg] derived engaged before rise = ' + (lowBias + ENGAGED_STAGE) + ' smp / ' + ((lowBias + ENGAGED_STAGE) / 48).toFixed(3) + ' ms');
console.log('[alsa-prereg] derived engaged after rise  = ' + (highBias + ENGAGED_STAGE) + ' smp / ' + ((highBias + ENGAGED_STAGE) / 48).toFixed(3) + ' ms');
console.log('[alsa-prereg] H4 additive delta = ' + (highBias - lowBias).toFixed(1) + ' smp / ' + ((highBias - lowBias) / 48).toFixed(3) + ' ms');
console.log('[alsa-prereg] 7 ms budget = ' + (LIMIT_MS * 48) + ' samples');
console.log('[alsa-prereg] H1 RISE is ' + (RISE / PERIOD).toFixed(2) + ' periods and ' + (RISE / BUFFER).toFixed(2) + ' buffers');
