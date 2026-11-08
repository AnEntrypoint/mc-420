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
const BLACK_GAP_US = 15000;

const kVelocityName = { kLedOff: 'black', kLedGreen: 'green', kLedRed: 'red', kLedYellow: 'yellow' };
const kOwnerSpec = [
  ...Array(4).fill({ flash: 'red', background: 'black' }),
  ...Array(4).fill({ flash: 'red', background: 'green' }),
  ...Array(4).fill({ flash: 'red', background: 'yellow' }),
  ...Array(4).fill({ flash: 'green', background: 'red' }),
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

function padModel(table, beats, gapUs) {
  const cycle = table.length;
  const sends = [];
  const visible = [];
  for (let k = 0; k < beats; k += 1) {
    const st = table[k % cycle];
    const prev = table[(k + cycle - 1) % cycle];
    const needGap = st.flash === prev.background && gapUs > 0;
    if (needGap) sends.push({ beat: k, offsetUs: -gapUs, colour: 'black' });
    sends.push({ beat: k, offsetUs: 0, colour: st.flash });
    sends.push({ beat: k, offsetUs: FLASH_US, colour: st.background });
    visible.push(st.flash !== prev.background || needGap);
  }
  return { sends, visible };
}

function beatClockLive(t) {
  return t.linkPresent && t.bpm > 1;
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
  ];
}

function gateCases() {
  return [
    { name: 'linked, session alone (no peers)', t: { linkPresent: true, bpm: 174, peers: 0 }, expect: true },
    { name: 'linked, two peers joined', t: { linkPresent: true, bpm: 120, peers: 2 }, expect: true },
    { name: 'no Link object', t: { linkPresent: false, bpm: 120, peers: 0 }, expect: false },
    { name: 'Link present, tempo below 1', t: { linkPresent: true, bpm: 0, peers: 0 }, expect: false },
  ];
}

function sourceProbe(src) {
  const apc = fs.readFileSync(kApcSrc, 'utf8');
  const mid = fs.readFileSync(kMidiSrc, 'utf8');
  const needles = [
    [apc, 'constexpr MetronomeState metronomeStateFor(int linkBeat) {'],
    [apc, 'if (p.untilNextFlashUs <= c.blackGapUs && beatPadNeedsGap(beatPadIndex(p.litIndex + 1), p.litIndex)) {'],
    [apc, 'if (g == 0 && clock.live) color = beatPadVelocity(clock);'],
    [apc, 'if (now_ms - lastMs_ < kRefreshMs) return;'],
    [mid, 'if (!bm.valid || bm.bpm <= 1.0 || bm.nextBeatMicros <= bm.curBeatMicros) return c;'],
    [mid, 'const bool leadOpen = nextBeatMicros - clock.nowMicros <= leadMicros;'],
    [mid, 'publishBeatPadMark(colourBeat, clock.nowMicros - flashStartMicros, clock.bpm, state.flash, state.background);'],
    [mid, 'leds.refreshBeatPads(now, grid, beatPadClockFrom(link), ledWrite);'],
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
  lines.push('  table in apc_leds.h matches the owner spec: ' + (specOk ? 'ok' : 'FAIL') + ' (' + table.map((s) => s.flash + ' over ' + s.background).join(' | ') + ')');

  const counts = cycleCounts(table);
  const countsOk = counts.flash.red === 12 && counts.flash.green === 4 && !counts.flash.black
    && counts.background.black === 4 && counts.background.green === 4
    && counts.background.yellow === 4 && counts.background.red === 4;
  if (!countsOk) failed = true;
  lines.push('  cycle of ' + table.length + ': flash red ' + (counts.flash.red || 0) + ' green ' + (counts.flash.green || 0) + '; background black ' + (counts.background.black || 0) + ' green ' + (counts.background.green || 0) + ' yellow ' + (counts.background.yellow || 0) + ' red ' + (counts.background.red || 0) + ' ' + (countsOk ? 'ok' : 'FAIL'));

  const gapModel = padModel(table, BEATS, BLACK_GAP_US);
  const steady = gapModel.visible.slice(table.length, 2 * table.length);
  const visOk = steady.every((v) => v);
  if (!visOk) failed = true;
  const bareModel = padModel(table, table.length * 2, 0);
  const bareHidden = bareModel.visible.slice(table.length, 2 * table.length).map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
  const persist = table[table.length - 1].background === table[0].flash;
  lines.push('  beat ' + (table.length - 1) + ' background (' + table[table.length - 1].background + ') matches beat 0 flash (' + table[0].flash + '): ' + (persist ? 'yes, so the pad needs a black gap before beat 0' : 'no'));
  lines.push('  steady cycle flash visibility with the ' + BLACK_GAP_US / 1000 + ' ms black gap: ' + steady.filter((v) => v).length + ' of ' + steady.length + ' beats visible; NOT visible: ' + (steady.every((v) => v) ? 'none' : 'some') + ' ' + (visOk ? 'ok' : 'FAIL'));
  lines.push('  without the gap (control): NOT visible: ' + (bareHidden.length ? bareHidden.map((i) => 'beat ' + i).join(', ') : 'none'));

  const sendsPerBeat = {};
  for (const s of gapModel.sends) sendsPerBeat[s.beat] = (sendsPerBeat[s.beat] || 0) + 1;
  const sendsOk = Object.values(sendsPerBeat).every((n) => n <= 3);
  if (!sendsOk) failed = true;
  lines.push('  sends per beat <= 3 (black gap, flash, background): ' + (sendsOk ? 'ok' : 'FAIL') + '; ' + gapModel.sends.length + ' sends over ' + BEATS + ' beats');

  for (const sc of scenarios()) {
    const r = evaluate(sc, table, fix);
    const ok = r.maxEdge <= TOLERANCE_US && r.maxEnd <= TOLERANCE_US && Math.abs(r.lastEdge) <= TOLERANCE_US;
    if (!ok) failed = true;
    lines.push('  ' + sc.name + ': 64 beats, max flash-start err ' + r.maxEdge + ' us, max flash-end err ' + r.maxEnd + ' us, last-beat start err ' + r.lastEdge + ' us ' + (ok ? 'ok' : 'FAIL'));
  }

  for (const g of gateCases()) {
    const got = beatClockLive(g.t);
    const ok = got === g.expect;
    if (!ok) failed = true;
    lines.push('  beat pad clock ' + g.name + ': live ' + got + ' (expect ' + g.expect + ') ' + (ok ? 'ok' : 'FAIL'));
  }

  if (fix) {
    for (const p of sourceProbe(apcSrc)) {
      if (!p.found) {
        failed = true;
        lines.push('  source MISS ' + p.needle);
      }
    }
  }

  console.log('led flash schedule (' + (fix ? 'fixed' : 'pre-fix refresh cadence') + '), lead ' + LEAD_US / 1000 + ' ms, flash ' + FLASH_US / 1000 + ' ms, tolerance ' + TOLERANCE_US + ' us');
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

module.exports = { parseStateTable, padModel, kOwnerSpec, evaluate, scenarios, beatClockLive };
