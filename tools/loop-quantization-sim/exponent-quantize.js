'use strict';

const W = require('./world');
const { wrapAbs } = require('./looper');

const kBpm = 120.0;
const kMasterHoldMs = 2000;
const kSettleMs = 30000;
const kStepMs = 50;
const kLandingWatchMs = 2000;
const kLandingToleranceSamples = 1.0;
const kAllBeats = process.argv.includes('--all-beats');

const kNearestCases = [
  [0.3, 0.25, 'a 16th-plus take cuts to the 16th'],
  [0.4, 0.5, 'nearer the 8th than the 16th'],
  [0.6, 0.5, 'just past the 8th cuts back to it'],
  [0.7, 0.5, 'short of the 8th-to-4th midpoint stays at the 8th'],
  [1.4, 1, 'just past the beat cuts to the beat'],
  [1.6, 2, 'past the one-to-two midpoint extends to two'],
  [2.5, 2, 'half a beat past two cuts to two'],
  [2.9, 2, 'short of the two-to-four midpoint stays at two'],
  [3.4, 4, 'nearer four extends to four'],
  [5.5, 4, 'past the bar but nearer it cuts to the bar'],
  [5.9, 4, 'short of the bar-to-two-bars midpoint stays at the bar'],
  [7.0, 8, 'nearer two bars extends to two bars'],
  [13.0, 16, 'nearer four bars extends to four bars'],
  [25.0, 32, 'nearer eight bars extends to eight bars'],
];

const kTieCases = [[0.375, 0.25], [0.75, 0.5], [1.5, 1], [3, 2], [6, 4], [12, 8], [24, 16], [48, 32], [96, 64]];

const kFirstTakeCases = [
  [1450, 4, 3, 'a three-beat first take'],
  [2500, 4, 5, 'a five-beat first take'],
  [3400, 8, 7, 'a seven-beat first take'],
  [2000, 4, 4, 'a four-beat first take'],
];

function advance(w, ms) {
  const n = W.msToSimSamples(ms);
  for (let i = 0; i < n; i++) W.stepOneSample(w);
}

function press(w, looper) {
  W.onPadPress(w, looper);
  W.onPadRelease(w, looper);
}

function settle(w, looper) {
  const lp = w.loopers[looper];
  for (let k = 0; k * kStepMs < kSettleMs; k++) {
    advance(w, kStepMs);
    if (lp.finishTargetPending === 0 && !lp.recording) break;
  }
  advance(w, kStepMs);
}

function gridReadPos(w, lp) {
  const d = lp.dsp;
  return wrapAbs(d.beatScale * (w.masterPhaseSamples - d.rsm) + lp.ps_latencybias + d.coff, d.wlen);
}

function landingError(w, looper) {
  const lp = w.loopers[looper];
  let worst = 0;
  const n = W.msToSimSamples(kLandingWatchMs);
  for (let i = 0; i < n; i++) {
    W.stepOneSample(w);
    const gap = Math.abs(lp.dsp.rpos - gridReadPos(w, lp));
    worst = Math.max(worst, Math.min(gap, lp.dsp.wlen - gap));
  }
  return worst;
}

function recordMaster(w, holdMs) {
  advance(w, 300);
  press(w, 0);
  advance(w, holdMs);
  press(w, 0);
  settle(w, 0);
}

function runTake(takeBeats, allBeats) {
  const w = W.createWorld({ looperCount: 4, initialLinkBpm: kBpm, quantAllBeats: allBeats });
  recordMaster(w, kMasterHoldMs);
  advance(w, 1200);
  press(w, 1);
  advance(w, (takeBeats * 60000) / kBpm);
  press(w, 1);
  settle(w, 1);
  const lp = w.loopers[1];
  const oneBeat = w.masterLenSamples / Math.max(1, w.recordedBeats);
  return {
    loopBeats: lp.dsp.wlen / (oneBeat * lp.dsp.beatScale),
    pending: lp.finishTargetPending,
    landing: landingError(w, 1),
  };
}

function runFirstTake(holdMs, allBeats) {
  const w = W.createWorld({ looperCount: 4, initialLinkBpm: kBpm, quantAllBeats: allBeats });
  advance(w, 300);
  press(w, 0);
  advance(w, holdMs);
  const recordedSamples = W.snapshotWriteIdx(w, 0);
  press(w, 0);
  settle(w, 0);
  return { beats: w.recordedBeats, wlen: w.loopers[0].dsp.wlen, recordedSamples };
}

function runToggle() {
  const w = W.createWorld({ looperCount: 4, initialLinkBpm: kBpm });
  const states = [w.quantAllBeats];
  states.push(W.toggleQuantAllBeats(w));
  recordMaster(w, 4000);
  advance(w, 1200);
  press(w, 1);
  advance(w, (6.0 * 60000) / kBpm);
  press(w, 1);
  settle(w, 1);
  const oneBeat = w.masterLenSamples / Math.max(1, w.recordedBeats);
  const allBeatsLoop = w.loopers[1].dsp.wlen / (oneBeat * w.loopers[1].dsp.beatScale);
  states.push(W.toggleQuantAllBeats(w));
  advance(w, 600);
  press(w, 2);
  advance(w, (6.0 * 60000) / kBpm);
  press(w, 2);
  settle(w, 2);
  const exponentLoop = w.loopers[2].dsp.wlen / (oneBeat * w.loopers[2].dsp.beatScale);
  return { states, phraseBeats: w.recordedBeats, allBeatsLoop, exponentLoop };
}

function main() {
  let failed = 0;
  const mode = kAllBeats ? 'accept-all-beats (negative control)' : 'exponent list (default)';
  console.log(`exponent quantize: ${mode}, list ${W.kExponentQuantBeats.join('/')} beats`);

  for (const [beats, want, label] of kNearestCases) {
    const r = runTake(beats, kAllBeats);
    const ok = r.pending === 0 && Math.abs(r.loopBeats - want) < 0.01 && r.landing <= kLandingToleranceSamples;
    console.log(`  cut ${label}: take ${beats} -> ${r.loopBeats.toFixed(3)} beats (want ${want}), landing error ${r.landing.toFixed(3)} samples ${ok ? 'ok' : 'FAIL'}`);
    if (!ok) failed++;
  }

  for (const [beats, want] of kTieCases) {
    const got = W.nearestExponentQuantBeats(beats);
    const ok = got === want;
    console.log(`  tie ${beats} beats -> ${got} (want the shorter, ${want}) ${ok ? 'ok' : 'FAIL'}`);
    if (!ok) failed++;
  }

  for (const [holdMs, want, oddBeats, label] of kFirstTakeCases) {
    const r = runFirstTake(holdMs, kAllBeats);
    const uncut = Math.abs(r.wlen - r.recordedSamples) <= 1;
    const ok = r.beats === want && uncut;
    console.log(`  first take ${label} (${holdMs} ms, ${oddBeats} beats at 120): recorded ${r.beats} beats (want ${want}), loop ${r.wlen} vs recorded ${r.recordedSamples} samples ${ok ? 'ok' : 'FAIL'}`);
    if (!ok) failed++;
  }

  if (!kAllBeats) {
    const t = runToggle();
    const ok = t.states.join(',') === 'false,true,false' && t.phraseBeats === 8
      && Math.abs(t.allBeatsLoop - 8) < 0.01 && Math.abs(t.exponentLoop - 4) < 0.01;
    console.log(`  toggle: modes ${t.states.join(' -> ')}, phrase ${t.phraseBeats}, 6-beat take ${t.allBeatsLoop.toFixed(3)} beats with accept-all, ${t.exponentLoop.toFixed(3)} beats after toggling back ${ok ? 'ok' : 'FAIL'}`);
    if (!ok) failed++;
  }

  console.log(failed === 0 ? 'exponent quantize: PASS' : `exponent quantize: FAIL (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

if (require.main === module) main();
module.exports = { runTake, runFirstTake, runToggle };
