#!/usr/bin/env node
'use strict';
const dgram = require('dgram');
const net = require('net');
const fs = require('fs');
const { execFileSync } = require('child_process');

const HOST = '192.168.137.132';
const ROOT = '/config/workspace/mc-420';
const PAD0 = 2;
const JSONL = ROOT + '/.gm/witness-out/restart-control-20261106.jsonl';
const ELEV_BIAS = [221.6, 253.6];
const ELEV_RT = [157.6, 189.6];
const LOW_BIAS = [177.5, 209.5];
const LOW_RT = [113.5, 145.5];

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function query() {
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    let done = false;
    const finish = (v) => { if (done) return; done = true; try { sock.close(); } catch (e) { } resolve(v); };
    const timer = setTimeout(() => finish(null), 3000);
    sock.on('message', (m) => { clearTimeout(timer); try { finish(JSON.parse(m.toString())); } catch (e) { finish(null); } });
    sock.on('error', () => { clearTimeout(timer); finish(null); });
    sock.send('status', 4445, HOST);
  });
}
function sendBytes(bytes) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: HOST, port: 9401 }, () => {
      sock.write(Buffer.from(bytes), (err) => { if (err) return reject(err); sock.end(); });
    });
    sock.setTimeout(5000);
    sock.on('timeout', () => { sock.destroy(); reject(new Error('midi timeout')); });
    sock.on('close', resolve);
    sock.on('error', reject);
  });
}
function brief(t) {
  const bias = t.latency_bias_samples;
  const engagedSamples = bias + 127;
  return { bias: bias, rt: t.alsa_roundtrip_samples, trim: t.latency_trim_samples, peers: t.link && t.link.peers, synced: t.link && t.link.synced, bpm: t.link && t.link.bpm, phaseErr: t.link && t.link.phase_err_beats, xruns: t.xruns, mlen: t.master_len_samples, rb: t.recorded_beats, idleMs: +(bias / 48).toFixed(3), engagedSamples: engagedSamples, engagedMs: +(engagedSamples / 48).toFixed(3) };
}
function median(a) { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }
function inBand(v, b) { return v >= b[0] && v <= b[1]; }
function stats(recs) {
  const b = recs.map((r) => r.bias);
  return { n: recs.length, biasMedian: median(b), rtMedian: median(recs.map((r) => r.rt)), idleMsMedian: +(median(b) / 48).toFixed(3), engagedSamplesMedian: median(b) + 127, engagedMsMedian: +((median(b) + 127) / 48).toFixed(3), over7ms: recs.filter((r) => (r.bias + 127) / 48 > 7).length, peerViolations: recs.filter((r) => !(r.peers >= 1 && r.synced === true)).length, xrunsMin: Math.min(...recs.map((r) => r.xruns)), xrunsMax: Math.max(...recs.map((r) => r.xruns)) };
}
async function sample(phase) {
  let t = null;
  for (let a = 0; a < 5 && !t; a++) { t = await query(); if (!t) await sleep(300); }
  if (!t) throw new Error('telemetry lost in phase ' + phase);
  return brief(t);
}
async function collect(phase, count, gapMs, out) {
  const recs = [];
  for (let i = 0; i < count; i++) {
    const b = await sample(phase);
    recs.push(b);
    out.push({ phase: phase, at: new Date().toISOString(), ...b });
    console.log('[restart-control] ' + phase + ' ' + JSON.stringify(b));
    if (i + 1 < count) await sleep(gapMs);
  }
  return recs;
}
function verdictOf(s, recs, reason) {
  const all = [s.before, s.during, s.after];
  const peersOk = all.every((x) => x.peerViolations === 0);
  const xr = recs.map((r) => r.xruns);
  const xrunsOk = Math.max(...xr) - Math.min(...xr) <= 1;
  const elevated = all.every((x) => inBand(x.biasMedian, ELEV_BIAS) && inBand(x.rtMedian, ELEV_RT));
  const low = all.every((x) => inBand(x.biasMedian, LOW_BIAS) && inBand(x.rtMedian, LOW_RT));
  let v;
  if (reason) v = 'INCONCLUSIVE';
  else if (!peersOk || !xrunsOk) v = 'INCONCLUSIVE';
  else if (elevated) v = 'CONFIRMS_STATE_EFFECT';
  else if (low) v = 'REFUTES_STATE_EFFECT';
  else v = 'INCONCLUSIVE';
  console.log('[restart-control] peersOk=' + peersOk + ' xrunsOk=' + xrunsOk + ' elevatedBand=' + elevated + ' lowBand=' + low + ' reason=' + (reason || 'none'));
  console.log('[restart-control] VERDICT=' + v);
  return v;
}
async function main() {
  const recs = [];
  const first = await sample('baseline');
  console.log('[restart-control] baseline ' + JSON.stringify(first));
  if (!(first.peers >= 1 && first.synced === true)) {
    console.log('[restart-control] VERDICT=PEER_NOT_PRESENT_AT_BASELINE');
    fs.writeFileSync(JSONL, JSON.stringify({ verdict: 'PEER_NOT_PRESENT_AT_BASELINE', baseline: first }) + '\n');
    process.exit(3);
  }
  let restartOut = '';
  try {
    restartOut = execFileSync('node', ['test/hardware/ssh-run.js', HOST, 'rc-service aloop restart'], { encoding: 'utf8', cwd: ROOT, timeout: 90000 });
    console.log('[restart-control] RECOVERY_PATH=REMOTE_RESTART_VIA_SSH2');
  } catch (e) {
    console.log('[restart-control] RECOVERY_PATH=REMOTE_RESTART_FAILED_NO_FALLBACK');
    console.log('[restart-control] restart error: ' + e.message);
    console.log('[restart-control] VERDICT=STOP_NO_FALLBACK');
    fs.writeFileSync(JSONL, JSON.stringify({ verdict: 'STOP_NO_FALLBACK', baseline: first }) + '\n');
    process.exit(5);
  }
  console.log('[restart-control] restart output: ' + restartOut.trim());
  let consecutive = 0, acquired = false, elapsed = 0, peerless = 0;
  for (let i = 0; i < 180; i++) {
    const t = await query();
    if (!t) { peerless++; consecutive = 0; await sleep(1000); continue; }
    const b = brief(t);
    recs.push({ phase: 'reacquisition', at: new Date().toISOString(), ...b });
    if (b.peers >= 1 && b.synced === true) { consecutive++; if (consecutive >= 2) { acquired = true; elapsed = i; break; } }
    else { consecutive = 0; peerless++; }
    console.log('[restart-control] reacquisition +' + i + 's ' + JSON.stringify({ peers: b.peers, synced: b.synced, bias: b.bias, rt: b.rt }));
    await sleep(1000);
  }
  if (!acquired) {
    console.log('[restart-control] VERDICT=PEER_NOT_REACQUIRED peerless=' + peerless);
    fs.writeFileSync(JSONL, recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
    process.exit(4);
  }
  console.log('[restart-control] peer re-acquired at +' + elapsed + 's peerlessSamples=' + peerless);
  await sleep(6000);
  const before = await collect('before', 20, 1000, recs);
  await sendBytes([0x90, PAD0, 127]);
  await sendBytes([0x80, PAD0, 0]);
  const during = await collect('during', 5, 250, recs);
  await sendBytes([0x90, PAD0, 127]);
  await sendBytes([0x80, PAD0, 0]);
  const after = await collect('after', 20, 1000, recs);
  const s = { before: stats(before), during: stats(during), after: stats(after) };
  console.log('[restart-control] summary ' + JSON.stringify(s));
  const v = verdictOf(s, recs, null);
  fs.writeFileSync(JSONL, recs.map((r) => JSON.stringify(r)).join('\n') + '\n' + JSON.stringify({ verdict: v, summary: s }) + '\n');
  process.exit(v === 'STOP_NO_FALLBACK' ? 5 : 0);
}
main().catch((e) => {
  console.log('[restart-control] ERROR ' + e.message);
  console.log('[restart-control] VERDICT=INCONCLUSIVE');
  process.exit(2);
});
