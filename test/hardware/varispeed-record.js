#!/usr/bin/env node
const net = require('net');
const dgram = require('dgram');

const [, , host] = process.argv;
if (!host) {
  console.error('usage: node varispeed-record.js <host>');
  process.exit(2);
}
const SAMPLE_RATE = 48000;
const MASTER_PAD = 2;
const TAKE_PADS = [3, 4, 5];
const LOOPERS = [1, 2, 3];
const CLEAR_ALL_NOTE = 0x5b;
const HALFSPEED_NOTE = 70;
const HOLD_MS = 2000;
const WANT_RATE = 0.5;
const RATE_TOLERANCE = 0.03;

const sleep = ms => new Promise(r => setTimeout(r, ms));

function openInject() {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port: 9401 }, () => { sock.setTimeout(0); resolve(sock); });
    sock.on('timeout', () => { sock.destroy(); reject(new Error(`connect to ${host}:9401 timed out`)); });
    sock.on('error', reject);
  });
}

function burst(sock, notes) {
  const on = [], off = [];
  for (const n of notes) { on.push(0x90, n, 127); off.push(0x80, n, 0); }
  sock.write(Buffer.from(on));
  sock.write(Buffer.from(off));
}
function noteOn(sock, n) { sock.write(Buffer.from([0x90, n, 127])); }
function noteOff(sock, n) { sock.write(Buffer.from([0x80, n, 0])); }

function queryTelemetry() {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4');
    const timeout = setTimeout(() => { sock.close(); reject(new Error('telemetry query timed out')); }, 3000);
    sock.on('message', msg => {
      clearTimeout(timeout);
      sock.close();
      try { resolve(JSON.parse(msg.toString())); }
      catch (e) { reject(e); }
    });
    sock.on('error', e => { clearTimeout(timeout); reject(e); });
    sock.send('status', 4445, host);
  });
}

function unwrap(d, period) {
  const half = period * 0.5;
  let v = d;
  while (v > half) v -= period;
  while (v < -half) v += period;
  return v;
}

async function measureRate(looper, wlen, masterLen, oneBeat, samples = 6) {
  const gapMs = Math.max(230, (0.35 * masterLen * 1000) / SAMPLE_RATE);
  let sum = 0, n = 0;
  let prev = await queryTelemetry();
  for (let k = 0; k < samples; k++) {
    await sleep(gapMs);
    const cur = await queryTelemetry();
    const dPhase = unwrap((cur.master_phase_beats - prev.master_phase_beats) * oneBeat, masterLen);
    const dRead = unwrap(cur.loopers.readpos[looper] - prev.loopers.readpos[looper], wlen);
    const unambiguous = Math.abs(dPhase) > 1 && Math.abs(dPhase) < masterLen * 0.45;
    if (unambiguous) { sum += dRead / dPhase; n++; }
    prev = cur;
  }
  return n ? sum / n : NaN;
}

function flagsOf(t, i) { return t.loopers.stateflags ? t.loopers.stateflags[i] : '?'; }

async function waitForFinish(before, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let prevIdx = null;
  let last = null;
  while (Date.now() < deadline) {
    const t = await queryTelemetry();
    last = t;
    const idx = LOOPERS.map(i => t.loopers.writeidx[i]);
    const lengthened = LOOPERS.some(i => t.loopers.wraplen[i] !== before[i]);
    const parked = prevIdx !== null && idx.every((v, k) => v === prevIdx[k]);
    prevIdx = idx;
    if (lengthened && parked) return t;
    await sleep(250);
  }
  if (last) {
    console.log(`[varispeed]   timeout state: wlens=${LOOPERS.map(i => last.loopers.wraplen[i]).join(',')} ` +
      `widx=${LOOPERS.map(i => last.loopers.writeidx[i]).join(',')} flags=${LOOPERS.map(i => flagsOf(last, i)).join(',')}`);
  }
  return null;
}

async function main() {
  console.log(`[varispeed] target=${host}`);
  const sock = await openInject();
  await burst(sock, [CLEAR_ALL_NOTE]);
  await sleep(1200);

  await burst(sock, [MASTER_PAD]);
  await sleep(HOLD_MS);
  await burst(sock, [MASTER_PAD]);
  await sleep(1200);

  const master = await queryTelemetry();
  const masterLen = master.loopers.wraplen[0];
  if (!masterLen || masterLen <= 1) {
    console.error('[varispeed] FAIL: master looper 0 has no length');
    process.exit(1);
  }
  const bpm = master.link && master.link.bpm > 1 ? master.link.bpm : 120;
  const beats = Math.max(1, Math.round(masterLen / ((SAMPLE_RATE * 60) / bpm)));
  const oneBeat = masterLen / beats;
  console.log(`[varispeed] master wlen=${masterLen} (${beats} beats, oneBeat=${oneBeat.toFixed(1)}) bpm=${bpm.toFixed(2)}`);

  noteOn(sock, HALFSPEED_NOTE);
  await sleep(400);
  const held = await queryTelemetry();
  console.log(`[varispeed] halfspeed engaged: eff_speed=${held.eff_speed}`);

  const before = await queryTelemetry();
  burst(sock, [TAKE_PADS[0]]);
  await sleep(HOLD_MS);
  burst(sock, [TAKE_PADS[0]]);
  const settled = await waitForFinish(before.loopers.wraplen);
  if (!settled) {
    console.error('[varispeed] FAIL: take never finished');
    process.exit(1);
  }
  const lp = LOOPERS[0];
  const wlen = settled.loopers.wraplen[lp];
  console.log(`[varispeed] take looper ${lp}: wlen=${wlen} (${(wlen / oneBeat).toFixed(3)} beats) ` +
    `widx=${settled.loopers.writeidx[lp]} flags=${flagsOf(settled, lp)} eff_speed=${settled.eff_speed}`);

  const rateHeld = await measureRate(lp, wlen, masterLen, oneBeat);
  noteOff(sock, HALFSPEED_NOTE);
  await sleep(600);
  const rel = await queryTelemetry();
  const rateReleased = await measureRate(lp, rel.loopers.wraplen[lp], masterLen, oneBeat);

  console.log(`[varispeed] take looper ${lp}: wlen=${wlen} (${(wlen / oneBeat).toFixed(3)} beats) ` +
    `widx=${settled.loopers.writeidx[lp]} flags=${flagsOf(settled, lp)} eff_speed=${settled.eff_speed}`);
  console.log(`[varispeed] playback rate while halfspeed HELD: ${rateHeld.toFixed(4)} (want ${WANT_RATE})`);
  console.log(`[varispeed] after release: eff_speed=${rel.eff_speed} wlen=${rel.loopers.wraplen[lp]} flags=${flagsOf(rel, lp)}`);
  console.log(`[varispeed] playback rate after RELEASE: ${rateReleased.toFixed(4)} (want ${WANT_RATE} -- the resample must stick)`);

  const offHeld = Math.abs(rateHeld - WANT_RATE);
  const offReleased = Math.abs(rateReleased - WANT_RATE);
  const pass = offHeld <= RATE_TOLERANCE && offReleased <= RATE_TOLERANCE;
  if (!pass) {
    console.error(`[varispeed] FAIL: held off ${offHeld.toFixed(4)}, released off ${offReleased.toFixed(4)} ` +
      `(tol ${RATE_TOLERANCE}) -- the punch is not baked into the take`);
  } else {
    console.log('[varispeed] ALL PASS');
  }
  sock.destroy();
  process.exit(pass ? 0 : 1);
}

main().catch(err => {
  console.error('[varispeed] error:', err.message);
  process.exit(1);
});
