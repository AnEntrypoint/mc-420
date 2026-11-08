'use strict';

const fs = require('fs');
const path = require('path');

const kMidiSrc = path.resolve(__dirname, '..', '..', 'src', 'control', 'midi_clock.cpp');
const PULSES = 24;
const SPP_UNITS_PER_BEAT = 4;
const PULSES_PER_UNIT = PULSES / SPP_UNITS_PER_BEAT;
const SPP_SPAN = 16384;
const POS_SPAN = SPP_SPAN * PULSES_PER_UNIT;
const PHRASE_BEATS = 64;
const BURST_MAX = PULSES;
const BPM = 120;
const PULSE_MS = 60000 / (BPM * PULSES);

function makeDevice() {
  return { pos: 0, ticks: 0, spps: 0 };
}

function deviceTick(d) {
  d.pos = (d.pos + 1) % POS_SPAN;
  d.ticks += 1;
}

function deviceSpp(d, beat) {
  const units = Math.floor(beat * SPP_UNITS_PER_BEAT);
  d.pos = (((units % SPP_SPAN) + SPP_SPAN) % SPP_SPAN) * PULSES_PER_UNIT;
  d.spps += 1;
}

function remainderPulses(beat, pulseIdx) {
  const sppPulse = Math.floor(beat * SPP_UNITS_PER_BEAT) * PULSES_PER_UNIT;
  let r = pulseIdx - sppPulse;
  if (r < 0) r = 0;
  if (r >= PULSES_PER_UNIT) r = PULSES_PER_UNIT - 1;
  return r;
}

function deviceError(d, pulseIdx) {
  const raw = (((d.pos - pulseIdx) % POS_SPAN) + POS_SPAN) % POS_SPAN;
  return raw > POS_SPAN / 2 ? raw - POS_SPAN : raw;
}

function runFixed(wakesMs, beatAt) {
  const d = makeDevice();
  let sentStart = false;
  let lastPulse = 0;
  let lastPhrase = -1;
  let pulse0 = null;
  for (const t of wakesMs) {
    const beat = beatAt(t);
    const pulseIdx = Math.floor(beat * PULSES);
    const phraseIdx = Math.floor(beat / PHRASE_BEATS);
    const phraseTurned = phraseIdx !== lastPhrase;
    lastPhrase = phraseIdx;
    if (!sentStart) {
      if (phraseTurned) deviceSpp(d, beat);
      sentStart = true;
      const r = remainderPulses(beat, pulseIdx);
      for (let i = 0; i < r; i++) deviceTick(d);
      lastPulse = pulseIdx;
      pulse0 = pulseIdx;
      continue;
    }
    const gap = pulseIdx - lastPulse;
    if (gap < 0 || gap > BURST_MAX || phraseTurned) {
      deviceSpp(d, beat);
      const r = remainderPulses(beat, pulseIdx);
      for (let i = 0; i < r; i++) deviceTick(d);
    } else if (gap > 0) {
      for (let i = 0; i < gap; i++) deviceTick(d);
    }
    lastPulse = pulseIdx;
  }
  return { d, pulse0, pulseEnd: Math.floor(beatAt(wakesMs[wakesMs.length - 1]) * PULSES) };
}

function runLegacy(wakesMs, beatAt) {
  const d = makeDevice();
  let sentStart = false;
  let lastPulse = 0;
  let lastPhrase = -1;
  let pulse0 = null;
  for (const t of wakesMs) {
    const beat = beatAt(t);
    const pulseIdx = Math.floor(beat * PULSES);
    const phraseIdx = Math.floor(beat / PHRASE_BEATS);
    if (phraseIdx !== lastPhrase) {
      deviceSpp(d, beat);
      lastPhrase = phraseIdx;
    }
    if (!sentStart) {
      sentStart = true;
      lastPulse = pulseIdx;
      pulse0 = pulseIdx;
    }
    if (pulseIdx > lastPulse) {
      deviceTick(d);
      lastPulse = pulseIdx;
    } else if (pulseIdx < lastPulse) {
      lastPulse = pulseIdx;
    }
  }
  return { d, pulse0, pulseEnd: Math.floor(beatAt(wakesMs[wakesMs.length - 1]) * PULSES) };
}

function wakeTimes(endMs, stepMs, stalls) {
  const out = [];
  let t = 0;
  while (t <= endMs) {
    out.push(t);
    t += stepMs;
  }
  return out.filter((w) => !stalls.some(([from, to]) => w > from && w < to));
}

function stallCase(runner, stallMs) {
  const stallAt = 100;
  const wakes = wakeTimes(200, 5, [[stallAt, stallAt + stallMs]]);
  wakes.push(stallAt + stallMs);
  const sorted = [...new Set(wakes)].sort((a, b) => a - b);
  const beatAt = (t) => (t * BPM) / 60000;
  const r = runner(sorted, beatAt);
  const expectedTicks = r.pulseEnd - r.pulse0;
  return {
    stallMs,
    expectedTicks,
    ticks: r.d.ticks,
    lost: expectedTicks - r.d.ticks,
    endError: deviceError(r.d, r.pulseEnd),
  };
}

function startCase(runner) {
  const beatAt = (t) => 37.3 + (t * BPM) / 60000;
  const wakes = wakeTimes(200, 5, []);
  const atStart = runner([wakes[0]], beatAt);
  const atEnd = runner(wakes, beatAt);
  return { startError: deviceError(atStart.d, atStart.pulse0), endError: deviceError(atEnd.d, atEnd.pulseEnd) };
}

function jumpCase(runner, jumpBeats) {
  const beatAt = (t) => (t * BPM) / 60000 + (t >= 100 ? jumpBeats : 0);
  const wakes = wakeTimes(200, 5, []);
  const r = runner(wakes, beatAt);
  return { jumpBeats, endError: deviceError(r.d, r.pulseEnd) };
}

function evaluate(runner) {
  const stalls = [10, 25, 30, 45, 60, 100].map((ms) => stallCase(runner, ms));
  const start = startCase(runner);
  const forward = jumpCase(runner, 1.5);
  const backward = jumpCase(runner, -0.5);
  const failures = [];
  for (const s of stalls) if (s.lost !== 0 || s.endError !== 0) failures.push(`stall ${s.stallMs} ms lost ${s.lost} endErr ${s.endError}`);
  if (start.startError !== 0) failures.push(`start device error ${start.startError}`);
  if (forward.endError !== 0) failures.push(`forward jump ${forward.jumpBeats} beats device error ${forward.endError}`);
  if (backward.endError !== 0) failures.push(`backward jump ${backward.jumpBeats} beats device error ${backward.endError}`);
  return { stalls, start, forward, backward, failures };
}

function sourceProbe() {
  const src = fs.readFileSync(kMidiSrc, 'utf8');
  const needles = [
    'constexpr int64_t kBurstMaxPulses',
    'constexpr long   kIdleSleepNs',
    'constexpr long   kSpinNs             = 200000;',
    'void writeTicks(OutputSet& outs, int64_t count)',
    'int64_t remainderPulses(double beat, int64_t pulseIdx)',
    'void relocate(OutputSet& outs, double beat, int64_t pulseIdx)',
    'void raiseClockPriority(int audioPriority)',
    'raiseClockPriority(audioPriority_);',
    'gap > kBurstMaxPulses',
    'writeTicks(outs, gap);',
  ];
  return needles.map((n) => ({ needle: n, found: src.includes(n) }));
}

function main() {
  const args = new Set(process.argv.slice(2));
  const legacy = args.has('--no-fix') || args.has('--assert-no-fix');
  const runner = legacy ? runLegacy : runFixed;
  const result = evaluate(runner);
  const label = legacy ? 'pre-fix pulse emission' : 'post-fix pulse emission';
  console.log(`midi clock pulse resync (${label}), 120 BPM, pulse ${PULSE_MS.toFixed(3)} ms`);
  for (const s of result.stalls) {
    console.log(`  stall ${String(s.stallMs).padStart(3)} ms: ticks ${s.ticks}/${s.expectedTicks} lost ${s.lost} endErr ${s.endError}`);
  }
  console.log(`  start alignment (beat 37.3): startErr ${result.start.startError} endErr ${result.start.endError}`);
  console.log(`  forward jump +${result.forward.jumpBeats} beats: endErr ${result.forward.endError}`);
  console.log(`  backward jump ${result.backward.jumpBeats} beats: endErr ${result.backward.endError}`);
  if (!legacy) {
    const probes = sourceProbe();
    const missing = probes.filter((p) => !p.found);
    for (const p of probes) console.log(`  source ${p.found ? 'ok  ' : 'MISS'} ${p.needle}`);
    if (missing.length) result.failures.push(`source missing ${missing.length} needle(s)`);
  }
  const failed = result.failures.length > 0;
  for (const f of result.failures) console.log(`  FAIL ${f}`);
  if (args.has('--assert-no-fix')) {
    if (failed) {
      console.log('MIDI CLOCK NEGATIVE CONTROL: PASS (pre-fix emission fails as expected)');
      process.exit(0);
    }
    console.log('MIDI CLOCK NEGATIVE CONTROL: FAIL (pre-fix emission passed the resync model)');
    process.exit(1);
  }
  if (args.has('--no-fix')) {
    console.log(failed ? 'pre-fix control FAILS as required' : 'pre-fix control unexpectedly passed');
    process.exit(failed ? 1 : 0);
  }
  console.log(failed ? 'MIDI CLOCK PULSE RESYNC: FAIL' : 'MIDI CLOCK PULSE RESYNC: PASS');
  process.exit(failed ? 1 : 0);
}

if (require.main === module) main();

module.exports = { runFixed, runLegacy, evaluate };
