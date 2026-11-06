#!/usr/bin/env node
const net = require('net');
const dgram = require('dgram');

const HOST = process.argv[2] || '192.168.137.132';
const HOLD_MS = Number(process.argv[3] || 1250);
const SR = 48000;
const PAD0 = 2;
const CLEAR_ALL = 0x5b;
const LAT_TOL = 16;
const XRUN_TOL = 1;
const SPAN_TOL_BEATS = 1.05;
const IMPOSE_TOL = 4096;
const BPM_TOL = 0.05;
const GATE = process.argv[4] || 'original';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function sendBytes(bytes) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: HOST, port: 9401 }, () => {
      sock.write(Buffer.from(bytes), (err) => {
        if (err) return reject(err);
        sock.end();
      });
    });
    sock.setTimeout(5000);
    sock.on('timeout', () => { sock.destroy(); reject(new Error('midi ' + HOST + ':9401 timeout')); });
    sock.on('close', resolve);
    sock.on('error', reject);
  });
}

const press = (note) => sendBytes([0x90, note, 127]);
const releaseNote = (note) => sendBytes([0x80, note, 0]);

function queryTelemetry() {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4');
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { sock.close(); } catch (e) { }
      reject(new Error('telemetry timeout'));
    }, 3000);
    sock.on('message', (msg) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sock.close();
      try { resolve(JSON.parse(msg.toString())); }
      catch (e) { reject(e); }
    });
    sock.on('error', (e) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(e);
    });
    sock.send('status', 4445, HOST);
  });
}

function brief(t) {
  const sc = t.sample_clock || {};
  return {
    xruns: t.xruns, lat: t.latency_bias_samples, rt: t.alsa_roundtrip_samples,
    trim: t.latency_trim_samples, link: t.link,
    mlen: t.master_len_samples, rb: t.recorded_beats, phase: t.master_phase_beats,
    grid: t.grid_beat_index, wlen0: t.loopers ? t.loopers.wraplen[0] : null,
    sustainCmd: t.sustain_cmd, effSpeed: t.eff_speed, monitorMode: t.monitor_mode,
    glitchEngaged: t.glitch_engaged, recBits: t.loopers ? t.loopers.rec : null,
    playBits: t.loopers ? t.loopers.play : null,
    audio: sc.audio_samples, arm: sc.last_take_arm_sample, span: sc.last_take_span_samples,
    mphase: sc.master_phase_samples, linkTarget: sc.link_target_samples,
    createAudio: sc.create_audio_samples, createSpan: sc.create_span_samples,
    createMlen: sc.create_master_len, createPhase: sc.create_phase_samples,
    imposeAudio: sc.impose_audio_samples, imposeTarget: sc.impose_target_samples
  };
}

async function sample(label) {
  const t = await queryTelemetry();
  const b = brief(t);
  console.log('[telemetry] ' + label + ' ' + JSON.stringify(b));
  return b;
}

async function settle(label, maxMs) {
  const start = Date.now();
  let last = null;
  let stable = 0;
  while (Date.now() - start < maxMs) {
    const t = await queryTelemetry();
    const key = t.master_len_samples + '|' + t.recorded_beats + '|' + (t.loopers ? t.loopers.wraplen[0] : 0);
    const ready = t.master_len_samples > 0 && t.recorded_beats >= 1;
    if (ready && key === last) {
      stable++;
      if (stable >= 3) break;
    } else {
      stable = ready ? 1 : 0;
    }
    last = key;
    await sleep(150);
  }
  return sample(label + '-settled');
}

async function take(label) {
  await press(PAD0);
  await releaseNote(PAD0);
  const armed = await sample(label + '-arm');
  await sleep(HOLD_MS);
  await press(PAD0);
  await releaseNote(PAD0);
  const finished = await settle(label, 15000);
  return { label, armed, finished };
}

function bpmOf(s) {
  const beatLen = s.rb > 0 ? s.mlen / s.rb : 0;
  return beatLen > 0 ? (60 * SR) / beatLen : 0;
}

async function main() {
  console.log('[clear-reset] host=' + HOST + ' holdMs=' + HOLD_MS + ' pad0=' + PAD0 + ' clear=0x' + CLEAR_ALL.toString(16) + ' SR=' + SR);
  console.log('[clear-reset] tolerances latTol=' + LAT_TOL + ' xrunTol=' + XRUN_TOL + ' spanTolBeats=' + SPAN_TOL_BEATS + ' imposeTol=' + IMPOSE_TOL + ' bpmTol=' + BPM_TOL);
  console.log('[clear-reset] gate=' + GATE);
  const before = await sample('before');
  const first = await take('take1');
  await press(CLEAR_ALL);
  await releaseNote(CLEAR_ALL);
  await sleep(1200);
  const cleared = await sample('cleared');
  const second = await take('take2');
  const after = await sample('after');

  const bpm1 = bpmOf(first.finished);
  const bpm2 = bpmOf(second.finished);
  const beat1 = first.finished.rb > 0 ? first.finished.mlen / first.finished.rb : 0;
  const beat2 = second.finished.rb > 0 ? second.finished.mlen / second.finished.rb : 0;
  const spanErr1 = Math.abs(first.finished.span - first.finished.mlen);
  const spanErr2 = Math.abs(second.finished.span - second.finished.mlen);

  const rules = [
    ['R1-xruns', after.xruns <= before.xruns + XRUN_TOL, 'after=' + after.xruns + ' before=' + before.xruns],
    ['R1-lat', after.lat <= before.lat + LAT_TOL, 'after=' + after.lat + ' before=' + before.lat],
    ['R1-rt', after.rt <= before.rt + LAT_TOL, 'after=' + after.rt + ' before=' + before.rt],
    ['R2-take1', first.finished.mlen > 0 && first.finished.rb >= 1 && first.finished.wlen0 > 1, 'mlen=' + first.finished.mlen + ' rb=' + first.finished.rb + ' wlen0=' + first.finished.wlen0],
    ['R2-take2', second.finished.mlen > 0 && second.finished.rb >= 1 && second.finished.wlen0 > 1, 'mlen=' + second.finished.mlen + ' rb=' + second.finished.rb + ' wlen0=' + second.finished.wlen0],
    ['R3-cleared-mlen', cleared.mlen === 0, 'cleared.mlen=' + cleared.mlen],
    ['R3-cleared-rb', cleared.rb === 0, 'cleared.rb=' + cleared.rb],
    ['R4-arm-advances', second.finished.arm > first.finished.arm, 'arm1=' + first.finished.arm + ' arm2=' + second.finished.arm],
    ['R4-audio-advances', second.finished.audio > first.finished.audio, 'audio1=' + first.finished.audio + ' audio2=' + second.finished.audio],
    ['R5-span1', spanErr1 <= SPAN_TOL_BEATS * beat1, 'err=' + spanErr1.toFixed(1) + ' beat=' + beat1.toFixed(1)],
    ['R5-span2', spanErr2 <= SPAN_TOL_BEATS * beat2, 'err=' + spanErr2.toFixed(1) + ' beat=' + beat2.toFixed(1)],
    ['R6-tempo-parity', Math.abs(bpm1 - bpm2) <= BPM_TOL, 'bpm1=' + bpm1.toFixed(3) + ' bpm2=' + bpm2.toFixed(3)],
    ['R6-phrase-parity', first.finished.rb === second.finished.rb, 'rb1=' + first.finished.rb + ' rb2=' + second.finished.rb]
  ];
  const r3 = GATE === 'corrected'
    ? [
        ['R3c-phase-zero', cleared.phase === 0, 'cleared.phase=' + cleared.phase],
        ['R3c-sustain', cleared.sustainCmd === 0, 'cleared.sustain_cmd=' + cleared.sustainCmd],
        ['R3c-effspeed', Math.abs(cleared.effSpeed - 1) < 1e-4, 'cleared.eff_speed=' + cleared.effSpeed],
        ['R3c-monitor', cleared.monitorMode === false, 'cleared.monitor_mode=' + cleared.monitorMode],
        ['R3c-glitch', cleared.glitchEngaged === false, 'cleared.glitch_engaged=' + cleared.glitchEngaged],
        ['R3c-rec', cleared.recBits !== null && (cleared.recBits & 1) === 0, 'cleared.loopers.rec=' + cleared.recBits],
        ['R3c-play', cleared.playBits !== null && (cleared.playBits & 1) === 0, 'cleared.loopers.play=' + cleared.playBits]
      ]
    : [['R3-cleared-wlen', cleared.wlen0 === 1, 'cleared.wlen0=' + cleared.wlen0]];
  rules.push(...r3);
  console.log('===== RULES =====');
  for (const r of rules) console.log('[' + (r[1] ? 'PASS' : 'FAIL') + '] ' + r[0] + ' ' + r[2]);
  console.log('[clear-reset] derived bpm1=' + bpm1.toFixed(3) + ' bpm2=' + bpm2.toFixed(3));
  console.log('[clear-reset] imposeTarget1=' + first.finished.imposeTarget + ' imposeTarget2=' + second.finished.imposeTarget);
  console.log('[clear-reset] expected impose at arm-minus-L: 1=' + (first.finished.arm - first.finished.mlen) + ' 2=' + (second.finished.arm - second.finished.mlen));
  for (const t of [first, second]) {
    const s = t.finished;
    const d = s.imposeTarget > 0 ? Math.abs(s.imposeTarget - (s.arm - s.mlen)) : null;
    console.log('[clear-reset] ' + t.label + ' ADR034 ' + (d === null ? 'NOT_PUBLISHED' : (d <= IMPOSE_TOL ? 'WITHIN_TOLERANCE' : 'OUTSIDE_TOLERANCE') + ' delta=' + d.toFixed(1)));
  }
  const allPass = rules.every((r) => r[1]);
  console.log('[clear-reset] ' + (allPass ? 'ALL PASS' : 'SOME FAILED'));
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => { console.error('[clear-reset] error:', e.message); process.exit(2); });
