'use strict';
const net = require('net');
const dgram = require('dgram');

const host = process.argv[2] || '192.168.137.100';
const holdMs = Number(process.argv[3] || 1500);
const watchMs = Number(process.argv[4] || 20000);

const kSampleRate = 48000;
const kPollMs = 200;
const kClearAllSettleMs = 1200;
const kTrimSettleSkipMs = 6000;
const kClearAllNote = 0x5b;
const kMasterPad = 2;
const kBpmMatchMax = 0.05;
const kEffSpeedMaxDev = 0.005;
const kPeersPresentMinFrac = 0.95;

function sendBytes(bytes) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port: 9401 }, () => {
      sock.write(Buffer.from(bytes), (err) => { if (err) return reject(err); sock.end(); });
    });
    sock.setTimeout(5000);
    sock.on('timeout', () => { sock.destroy(); reject(new Error('midi inject timed out')); });
    sock.on('close', resolve);
    sock.on('error', reject);
  });
}

const pressPad = (note) => sendBytes([0x90, note, 127]);
const releasePad = (note) => sendBytes([0x80, note, 0]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function queryTelemetry() {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4');
    const timer = setTimeout(() => { try { sock.close(); } catch (e) {} reject(new Error('telemetry timeout')); }, 2000);
    sock.on('message', (msg) => {
      clearTimeout(timer);
      try { sock.close(); } catch (e) {}
      try { resolve(JSON.parse(msg.toString())); }
      catch (e) { reject(e); }
    });
    sock.on('error', (e) => { clearTimeout(timer); reject(e); });
    sock.send('status', 4445, host);
  });
}

async function pressRelease(note) {
  await pressPad(note);
  await releasePad(note);
}

function recordedBpm(t) {
  const beats = Number(t.recorded_beats || 0);
  const len = Number(t.master_len_samples || 0);
  if (!beats || !len) return 0;
  return (60 * beats * kSampleRate) / len;
}

async function settleWrapLen(maxMs) {
  const start = Date.now();
  let last = null;
  let stable = 0;
  while (Date.now() - start < maxMs) {
    const t = await queryTelemetry();
    const w = t.loopers.wraplen[0];
    if (w > 1 && w === last) {
      stable++;
      if (stable >= 3) return t;
    } else {
      stable = 0;
    }
    last = w;
    await sleep(150);
  }
  return queryTelemetry();
}

(async () => {
  const before = await queryTelemetry();
  const beforeBpm = recordedBpm(before);
  console.log('[tempo-follow] before: recorded_beats ' + before.recorded_beats + ', master_len ' + before.master_len_samples
    + ' smp -> ' + beforeBpm.toFixed(3) + ' bpm; session ' + before.link.bpm.toFixed(3)
    + ' bpm, peers ' + before.link.peers + ', eff ' + before.eff_speed.toFixed(5));

  if (before.link.peers < 1) {
    console.log('[tempo-follow] SKIP: no Link peer attached, nothing to test');
    process.exit(2);
  }

  await pressRelease(kClearAllNote);
  await sleep(kClearAllSettleMs);
  await pressRelease(kMasterPad);
  await sleep(holdMs);
  await pressRelease(kMasterPad);
  const landed = await settleWrapLen(12000);

  const afterBpm = recordedBpm(landed);
  console.log('[tempo-follow] after:  recorded_beats ' + landed.recorded_beats + ', master_len ' + landed.master_len_samples
    + ' smp -> ' + afterBpm.toFixed(3) + ' bpm; session ' + landed.link.bpm.toFixed(3)
    + ' bpm, peers ' + landed.link.peers + ', eff ' + landed.eff_speed.toFixed(5));

  if (Math.abs(afterBpm - beforeBpm) < 0.5) {
    console.log('[tempo-follow] note: new take landed at the same tempo as the old one ('
      + afterBpm.toFixed(3) + ' vs ' + beforeBpm.toFixed(3) + '), so this run does not exercise a tempo change');
  }

  await sleep(kTrimSettleSkipMs);
  const start = Date.now();
  const samples = [];
  while (Date.now() - start < watchMs) {
    const t = await queryTelemetry();
    samples.push({
      peers: Number(t.link.peers || 0),
      synced: !!t.link.synced,
      bpm: Number(t.link.bpm || 0),
      eff: Number(t.eff_speed || 0),
      phaseErr: Number(t.link.phase_err_beats || 0),
      recordedBpm: recordedBpm(t),
    });
    await sleep(kPollMs);
  }

  const withPeers = samples.filter((s) => s.peers >= 1);
  const presentFrac = samples.length ? withPeers.length / samples.length : 0;
  const losses = samples.filter((s, i) => i > 0 && samples[i - 1].peers >= 1 && s.peers === 0).length;
  const bpmSpread = withPeers.length
    ? Math.max(...withPeers.map((s) => s.bpm)) - Math.min(...withPeers.map((s) => s.bpm))
    : 0;
  const bpmErrMax = withPeers.reduce((m, s) => Math.max(m, Math.abs(s.bpm - s.recordedBpm)), 0);
  const effDevMax = withPeers.reduce((m, s) => Math.max(m, Math.abs(s.eff - 1)), 0);
  const phaseErrMax = withPeers.reduce((m, s) => Math.max(m, Math.abs(s.phaseErr)), 0);
  const syncedFrac = withPeers.length ? withPeers.filter((s) => s.synced).length / withPeers.length : 0;

  const checks = [];
  checks.push(['peer retained through tempo change', presentFrac >= kPeersPresentMinFrac,
    (presentFrac * 100).toFixed(1) + '% of ' + samples.length + ' polls, ' + losses + ' loss(es)']);
  checks.push(['peer follows our tempo', bpmErrMax <= kBpmMatchMax,
    'max |session bpm - recorded bpm| ' + bpmErrMax.toFixed(4) + ' (max ' + kBpmMatchMax + ')']);
  checks.push(['eff_speed settled at 1', effDevMax <= kEffSpeedMaxDev,
    'max |eff_speed-1| ' + effDevMax.toFixed(5) + ' (max ' + kEffSpeedMaxDev + ')']);
  checks.push(['session bpm stable', bpmSpread <= kBpmMatchMax, 'spread ' + bpmSpread.toFixed(4) + ' bpm']);
  checks.push(['phase error bounded', phaseErrMax <= 0.03, 'max |phase_err_beats| ' + phaseErrMax.toFixed(4)]);
  checks.push(['synced while peered', syncedFrac >= kPeersPresentMinFrac, (syncedFrac * 100).toFixed(1) + '% of ' + withPeers.length + ' polls']);

  console.log('[tempo-follow] watch ' + (watchMs / 1000).toFixed(1) + 's, ' + samples.length + ' polls');
  let failed = 0;
  for (const [name, ok, detail] of checks) {
    console.log((ok ? '  PASS ' : '  FAIL ') + name + ': ' + detail);
    if (!ok) failed += 1;
  }
  console.log(failed === 0 ? 'VERDICT: PASS' : 'VERDICT: FAIL (' + failed + ' check(s))');
  process.exit(failed === 0 ? 0 : 1);
})();
