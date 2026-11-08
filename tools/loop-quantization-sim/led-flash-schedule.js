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

const kVelocityName = { kLedOff: 'black', kLedGreen: 'green', kLedRed: 'red', kLedYellow: 'yellow' };
const kOwnerSpec = [
  { flash: 'red', background: 'black' },
  { flash: 'red', background: 'green' },
  { flash: 'red', background: 'yellow' },
  { flash: 'black', background: 'red' },
];

function parseStateTable(src) {
  const block = src.match(/kMetronomeStates\[kMetronomeCycleBeats\]\s*=\s*\{([\s\S]*?)\};/);
  if (!block) throw new Error('kMetronomeStates not found in apc_leds.h');
  const rows = [];
  for (const m of block[1].matchAll(/\{\s*(kLed\w+)\s*,\s*(kLed\w+)\s*\}/g)) {
    rows.push({ flash: kVelocityName[m[1]], background: kVelocityName[m[2]] });
  }
  return rows;
}

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

function padSends(table, beats) {
  const cycle = table.length;
  let last = null;
  const sends = [];
  const visible = [];
  for (let k = 0; k < beats; k += 1) {
    const st = table[k % cycle];
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
  return { sends, visible };
}

function beatClockUsable(t) {
  return t.linkSynced && t.bpm > 1;
}

function oldBeatClockUsable(t) {
  return t.linkSynced && t.bpm > 1 && t.masterLenSamples > 0;
}

function evaluate(scenario, table, fix) {
  const beatUs = timeline(scenario.segments);
  const start = beatUs(0) - LEAD_US - 5 * REFRESH_US;
  const rows = [];
  for (let k = 0; k < BEATS; k += 1) {
    const edgeTarget = beatUs(k) - LEAD_US;
    const fired = fix ? fireSpun(edgeTarget) : fireOnRefresh(edgeTarget, start);
    const endTarget = beatUs(k) - LEAD_US + FLASH_US;
    const ended = fix ? fireSpun(endTarget) : fireOnRefresh(endTarget, fired);
    rows.push({ beat: k, edgeErrUs: fired - edgeTarget, endErrUs: ended - endTarget });
  }
  const maxEdge = Math.max(...rows.map((r) => Math.abs(r.edgeErrUs)));
  const maxEnd = Math.max(...rows.map((r) => Math.abs(r.endErrUs)));
  const lastEdge = rows[rows.length - 1].edgeErrUs;
  return { maxEdge, maxEnd, lastEdge };
}

function cycleCounts(table) {
  const flash = {};
  const background = {};
  for (const st of table) {
    flash[st.flash] = (flash[st.flash] || 0) + 1;
    background[st.background] = (background[st.background] || 0) + 1;
  }
  return { flash, background };
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

function sourceProbe(src) {
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
  return needles.map(([s, n]) => ({ needle: n, found: s.includes(n) }));
}

function main() {
  const args = new Set(process.argv.slice(2));
  const fix = !args.has('--no-fix') && !args.has('--assert-no-fix');
  const apcSrc = fs.readFileSync(kApcSrc, 'utf8');
  const table = parseStateTable(apcSrc);
  let failed = false;
  const lines = [];

  const specOk = JSON.stringify(table) === JSON.stringify(kOwnerSpec);
  if (!specOk) failed = true;
  lines.push(`  table in apc_leds.h matches the owner spec: ${specOk ? 'ok' : 'FAIL'} (${table.map((s) => `${s.flash} over ${s.background}`).join(' | ')})`);

  const counts = cycleCounts(table);
  const countsOk = counts.flash.red === 3 && counts.flash.black === 1
    && counts.background.black === 1 && counts.background.green === 1
    && counts.background.yellow === 1 && counts.background.red === 1;
  if (!countsOk) failed = true;
  lines.push(`  cycle: flash red ${counts.flash.red || 0} black ${counts.flash.black || 0}; background black ${counts.background.black || 0} green ${counts.background.green || 0} yellow ${counts.background.yellow || 0} red ${counts.background.red || 0} ${countsOk ? 'ok' : 'FAIL'}`);

  const model = padSends(table, BEATS);
  const steady = model.visible.slice(table.length, 2 * table.length);
  const expectVisible = [false, true, true, true];
  const visOk = steady.every((v, i) => v === expectVisible[i]);
  if (!visOk) failed = true;
  const persist = table[table.length - 1].background === table[0].flash;
  lines.push(`  beat ${table.length - 1} background (${table[table.length - 1].background}) persists into beat 0 flash (${table[0].flash}): ${persist ? 'yes, the pad already shows that colour, so no send' : 'no'}`);
  lines.push(`  visibility against the previous beat's background (steady cycle, beats 0-3): ${steady.map((v, i) => `beat ${i} ${v ? 'visible' : 'NOT visible'}`).join(', ')} ${visOk ? 'ok' : 'FAIL'}`);

  const sendsPerBeat = {};
  for (const s of model.sends) sendsPerBeat[s.beat] = (sendsPerBeat[s.beat] || 0) + 1;
  const sendsOk = Object.values(sendsPerBeat).every((n) => n <= 2);
  if (!sendsOk) failed = true;
  lines.push(`  sends per beat <= 2 (flash then background, no off-then-on): ${sendsOk ? 'ok' : 'FAIL'}; ${model.sends.length} sends over ${BEATS} beats`);

  for (const sc of scenarios()) {
    const r = evaluate(sc, table, fix);
    const ok = r.maxEdge <= TOLERANCE_US && r.maxEnd <= TOLERANCE_US && Math.abs(r.lastEdge) <= TOLERANCE_US;
    if (!ok) failed = true;
    lines.push(`  ${sc.name}: 64 beats, max flash-start err ${r.maxEdge} us, max flash-end err ${r.maxEnd} us, last-beat start err ${r.lastEdge} us ${ok ? 'ok' : 'FAIL'}`);
  }

  for (const g of gateCases()) {
    const got = beatClockUsable(g.t);
    const ok = got === g.expect;
    if (!ok) failed = true;
    lines.push(`  metronome gate ${g.name}: usable ${got} (expect ${g.expect}, old gate ${oldBeatClockUsable(g.t)}) ${ok ? 'ok' : 'FAIL'}`);
  }

  if (fix) {
    for (const p of sourceProbe(apcSrc)) {
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

module.exports = { parseStateTable, padSends, kOwnerSpec, evaluate, scenarios, beatClockUsable };
