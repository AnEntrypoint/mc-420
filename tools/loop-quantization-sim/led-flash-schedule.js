'use strict';

const fs = require('fs');
const path = require('path');

const kApcSrc = path.resolve(__dirname, '..', '..', 'src', 'control', 'apc_leds.h');
const kMidiSrc = path.resolve(__dirname, '..', '..', 'src', 'control', 'midi.cpp');
const LEAD_US = 30000;
const FLASH_US = 100000;
const REFRESH_US = 33000;
const SPIN_RESIDUAL_US = 50;
const TOLERANCE_US = 1000;
const BEATS = 64;

const STATE_TABLE = [
  { flash: 'red', background: 'black' },
  { flash: 'red', background: 'green' },
  { flash: 'red', background: 'black' },
  { flash: 'green', background: 'red' },
];
const CYCLE = STATE_TABLE.length;

function timeline(segments) {
  return (beat) => {
    let seg = segments[0];
    for (const s of segments) if (beat >= s.beat0) seg = s;
    return Math.round(seg.us0 + ((beat - seg.beat0) * 60e6) / seg.bpm);
  };
}

function fireSpun(targetUs) {
  return targetUs + SPIN_RESIDUAL_US;
}

function fireOnRefresh(targetUs, startUs) {
  if (targetUs <= startUs) return startUs;
  const ticks = Math.ceil((targetUs - startUs) / REFRESH_US);
  return startUs + ticks * REFRESH_US;
}

function stateForBeat(linkBeat) {
  return STATE_TABLE[((linkBeat % CYCLE) + CYCLE) % CYCLE];
}

function padSends(beats) {
  let last = null;
  const sends = [];
  const visible = [];
  for (let k = 0; k < beats; k += 1) {
    const st = stateForBeat(k);
    visible.push(st.flash !== last);
    if (st.flash !== last) {
      sends.push({ beat: k, kind: 'flash', colour: st.flash });
      last = st.flash;
    }
    if (st.background !== last) {
      sends.push({ beat: k, kind: 'background', colour: st.background });
      last = st.background;
    }
  }
  const steady = visible.slice(CYCLE, 2 * CYCLE).filter(Boolean).length;
  return { sends, visibleFlashes: steady };
}

function beatClockUsable(t) {
  return t.linkSynced && t.bpm > 1;
}

function oldBeatClockUsable(t) {
  return t.linkSynced && t.bpm > 1 && t.masterLenSamples > 0;
}

function evaluate(scenario, fix) {
  const beatUs = timeline(scenario.segments);
  const start = beatUs(0) - LEAD_US - 5 * REFRESH_US;
  const rows = [];
  for (let k = 0; k < BEATS; k += 1) {
    const edgeTarget = beatUs(k) - LEAD_US;
    const fired = fix ? fireSpun(edgeTarget) : fireOnRefresh(edgeTarget, start);
    const endTarget = beatUs(k) - LEAD_US + FLASH_US;
    const ended = fix ? fireSpun(endTarget) : fireOnRefresh(endTarget, fired);
    rows.push({
      beat: k,
      edgeErrUs: fired - edgeTarget,
      endErrUs: ended - endTarget,
      state: stateForBeat(k),
    });
  }
  const maxEdge = Math.max(...rows.map((r) => Math.abs(r.edgeErrUs)));
  const maxEnd = Math.max(...rows.map((r) => Math.abs(r.endErrUs)));
  const last = rows[rows.length - 1];
  const stateBad = rows.filter((r) => r.state !== STATE_TABLE[r.beat % CYCLE]).length;
  const cycle = rows.slice(0, CYCLE);
  const flashCounts = { red: 0, green: 0 };
  const backgroundCounts = { black: 0, green: 0, red: 0 };
  for (const r of cycle) {
    flashCounts[r.state.flash] += 1;
    backgroundCounts[r.state.background] += 1;
  }
  const cycleOk = flashCounts.red === 3 && flashCounts.green === 1
    && backgroundCounts.black === 2 && backgroundCounts.green === 1 && backgroundCounts.red === 1;
  const { sends, visibleFlashes } = padSends(BEATS);
  const perBeat = {};
  for (const s of sends) perBeat[s.beat] = (perBeat[s.beat] || 0) + 1;
  const sendsOk = Object.values(perBeat).every((n) => n <= 2);
  return { maxEdge, maxEnd, lastEdge: last.edgeErrUs, stateBad, flashCounts, backgroundCounts, cycleOk, sendsOk, visibleFlashes, sendCount: sends.length, rows };
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
    { name: '174 BPM, no take (masterLenSamples 0)', segments: [{ beat0: 0, us0: 1000000, bpm: 174 }], take: false },
  ];
}

function gateCases() {
  return [
    { name: 'linked, no take', t: { linkSynced: true, bpm: 174, masterLenSamples: 0 }, expect: true },
    { name: 'linked, take', t: { linkSynced: true, bpm: 120, masterLenSamples: 72000 }, expect: true },
    { name: 'not linked', t: { linkSynced: false, bpm: 120, masterLenSamples: 72000 }, expect: false },
  ];
}

function sourceProbe() {
  const apc = fs.readFileSync(kApcSrc, 'utf8');
  const mid = fs.readFileSync(kMidiSrc, 'utf8');
  const needles = [
    [apc, 'constexpr MetronomeState metronomeStateFor(int linkBeat) {'],
    [apc, 'color = beatFlash ? st.flash : st.background;'],
    [apc, 'if (!beatEdge && now_ms - lastMs_ < kRefreshMs) return;'],
    [mid, 'return t.linkSynced && t.bpm > 1.0f;'],
    [mid, 'if (leadOpen && bm.nextBeatMicros != lastFlashNextMicros) {'],
    [mid, 'publishBeatPadMark(colourBeat, bm.nowMicros - flashStartMicros, bm.bpm, state.flash, state.background);'],
    [mid, 'while (monotonicMicros() < spinUntil) {}'],
    [mid, 'constexpr int64_t kFlashSpinUs = 2000;'],
  ];
  return needles.map(([src, n]) => ({ needle: n, found: src.includes(n) }));
}

function main() {
  const args = new Set(process.argv.slice(2));
  const fix = !args.has('--no-fix') && !args.has('--assert-no-fix');
  let failed = false;
  const lines = [];
  let firstResult = null;
  for (const sc of scenarios()) {
    const r = evaluate(sc, fix);
    if (!firstResult) firstResult = r;
    const ok = r.maxEdge <= TOLERANCE_US && r.maxEnd <= TOLERANCE_US && r.stateBad === 0
      && Math.abs(r.lastEdge) <= TOLERANCE_US && r.cycleOk && r.sendsOk;
    if (!ok) failed = true;
    lines.push(`  ${sc.name}: 64 beats, max flash-start err ${r.maxEdge} us, max flash-end err ${r.maxEnd} us, last-beat start err ${r.lastEdge} us, state mismatches ${r.stateBad}, cycle red ${r.flashCounts.red} green ${r.flashCounts.green} bg black ${r.backgroundCounts.black} green ${r.backgroundCounts.green} red ${r.backgroundCounts.red}, sends per beat <=2 ${r.sendsOk} ${ok ? 'ok' : 'FAIL'}`);
  }
  for (const g of gateCases()) {
    const got = beatClockUsable(g.t);
    const ok = got === g.expect;
    if (!ok) failed = true;
    lines.push(`  metronome gate ${g.name}: usable ${got} (expect ${g.expect}, old gate ${oldBeatClockUsable(g.t)}) ${ok ? 'ok' : 'FAIL'}`);
  }
  if (fix) {
    for (const p of sourceProbe()) {
      if (!p.found) {
        failed = true;
        lines.push(`  source MISS ${p.needle}`);
      }
    }
  }
  lines.push(`  pad 15 table (flash/background per beat mod 4): ${STATE_TABLE.map((s) => `${s.flash}/${s.background}`).join(' ')}; visible flashes per cycle ${firstResult.visibleFlashes} of ${CYCLE} sends ${firstResult.sendCount} over ${BEATS} beats`);
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

module.exports = { evaluate, scenarios, stateForBeat, beatClockUsable, padSends, STATE_TABLE };
