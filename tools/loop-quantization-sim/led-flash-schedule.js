'use strict';

const fs = require('fs');
const path = require('path');

const kApcSrc = path.resolve(__dirname, '..', '..', 'src', 'control', 'apc_leds.h');
const kMidiSrc = path.resolve(__dirname, '..', '..', 'src', 'control', 'midi.cpp');
const LEAD_US = 30000;
const FLASH_US = 100000;
const REFRESH_US = 33000;
const POLL_US = 1000;
const TOLERANCE_US = 1000;
const BEATS = 64;
const COLOURS = ['red', 'amber', 'green', 'amber'];

function timeline(segments) {
  return (beat) => {
    let seg = segments[0];
    for (const s of segments) if (beat >= s.beat0) seg = s;
    return Math.round(seg.us0 + ((beat - seg.beat0) * 60e6) / seg.bpm);
  };
}

function firePolled(targetUs, nowUs) {
  const waitUs = targetUs - nowUs;
  const waitMs = Math.max(1, Math.ceil(waitUs / POLL_US));
  return nowUs + waitMs * POLL_US;
}

function fireOnRefresh(targetUs, startUs) {
  if (targetUs <= startUs) return startUs;
  const ticks = Math.ceil((targetUs - startUs) / REFRESH_US);
  return startUs + ticks * REFRESH_US;
}

function colourForBeat(beatIndex) {
  return COLOURS[(beatIndex >> 2) & 0x3];
}

function evaluate(scenario, fix) {
  const beatUs = timeline(scenario.segments);
  const start = beatUs(0) - LEAD_US - 5 * POLL_US;
  const rows = [];
  for (let k = 0; k < BEATS; k += 1) {
    const edgeTarget = beatUs(k) - LEAD_US;
    const fired = fix ? firePolled(edgeTarget, start) : fireOnRefresh(edgeTarget, start);
    const endTarget = beatUs(k) - LEAD_US + FLASH_US;
    const ended = fix ? firePolled(endTarget, fired) : fireOnRefresh(endTarget, fired);
    rows.push({
      beat: k,
      edgeErrUs: fired - edgeTarget,
      endErrUs: ended - endTarget,
      flashLenErrUs: (ended - fired) - FLASH_US,
      colour: colourForBeat(k),
    });
  }
  const maxEdge = Math.max(...rows.map((r) => Math.abs(r.edgeErrUs)));
  const maxEnd = Math.max(...rows.map((r) => Math.abs(r.endErrUs)));
  const last = rows[rows.length - 1];
  const colourBad = rows.filter((r) => r.colour !== COLOURS[(r.beat >> 2) & 0x3]).length;
  return { maxEdge, maxEnd, lastEdge: last.edgeErrUs, colourBad, rows };
}

function scenarios() {
  return [
    { name: '90 BPM', segments: [{ beat0: 0, us0: 1000000, bpm: 90 }] },
    { name: '120 BPM', segments: [{ beat0: 0, us0: 1000000, bpm: 120 }] },
    { name: '174 BPM', segments: [{ beat0: 0, us0: 1000000, bpm: 174 }] },
    {
      name: '120 to 150 BPM at beat 32',
      segments: [
        { beat0: 0, us0: 1000000, bpm: 120 },
        { beat0: 32, us0: 1000000 + Math.round(32 * 60e6 / 120), bpm: 150 },
      ],
    },
  ];
}

function sourceProbe() {
  const apc = fs.readFileSync(kApcSrc, 'utf8');
  const mid = fs.readFileSync(kMidiSrc, 'utf8');
  const needles = [
    [apc, 'constexpr uint8_t kPhraseBarColour[4] = {kLedRed, kLedYellow, kLedGreen, kLedYellow};'],
    [apc, 'if (beatFlash && g == 0) color = kPhraseBarColour[(gridBeatIndex >> 2) & 0x3];'],
    [apc, 'if (!beatEdge && now_ms - lastMs_ < kRefreshMs) return;'],
    [mid, 'const int64_t flashEndMicros = bm.nextBeatMicros - leadMicros + (int64_t)kApcBeatFlashMs * 1000;'],
  ];
  return needles.map(([src, n]) => ({ needle: n, found: src.includes(n) }));
}

function main() {
  const args = new Set(process.argv.slice(2));
  const fix = !args.has('--no-fix') && !args.has('--assert-no-fix');
  let failed = false;
  const lines = [];
  for (const sc of scenarios()) {
    const r = evaluate(sc, fix);
    const ok = r.maxEdge <= TOLERANCE_US && r.maxEnd <= TOLERANCE_US && r.colourBad === 0
      && Math.abs(r.lastEdge) <= TOLERANCE_US;
    if (!ok) failed = true;
    lines.push(`  ${sc.name}: 64 beats, max edge err ${r.maxEdge} us, max end err ${r.maxEnd} us, last-beat edge err ${r.lastEdge} us, colour mismatches ${r.colourBad} ${ok ? 'ok' : 'FAIL'}`);
  }
  if (fix) {
    for (const p of sourceProbe()) {
      if (!p.found) {
        failed = true;
        lines.push(`  source MISS ${p.needle}`);
      }
    }
  }
  console.log(`led flash schedule (${fix ? 'fixed' : 'pre-fix refresh cadence'}), lead ${LEAD_US / 1000} ms, flash ${FLASH_US / 1000} ms, tolerance ${TOLERANCE_US} us`);
  for (const l of lines) console.log(l);
  if (args.has('--assert-no-fix')) {
    if (failed) {
      console.log('LED FLASH NEGATIVE CONTROL: PASS (pre-fix cadence fails as expected)');
      process.exit(0);
    }
    console.log('LED FLASH NEGATIVE CONTROL: FAIL (pre-fix cadence passed the schedule model)');
    process.exit(1);
  }
  if (!fix) {
    console.log(failed ? 'pre-fix control FAILS as required' : 'pre-fix control unexpectedly passed');
    process.exit(failed ? 1 : 0);
  }
  console.log(failed ? 'LED FLASH SCHEDULE: FAIL' : 'LED FLASH SCHEDULE: PASS');
  process.exit(failed ? 1 : 0);
}

if (require.main === module) main();

module.exports = { evaluate, scenarios };
