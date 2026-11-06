#!/usr/bin/env node
'use strict';
const net = require('net');
const dgram = require('dgram');
const fs = require('fs');
const HOST = process.argv[2] || '192.168.137.132';
const OUT = process.argv[3] || '.gm/witness-out/window4a-peer-present-latency.jsonl';
const PAD0 = 2;
const BEFORE_S = 12;
const AFTER_S = 12;
const HOLD_MS = 1250;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
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
function query() {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4');
    let done = false;
    const timer = setTimeout(() => { if (done) return; done = true; try { sock.close(); } catch (e) { } reject(new Error('telemetry timeout')); }, 3000);
    sock.on('message', (m) => { if (done) return; done = true; clearTimeout(timer); sock.close(); try { resolve(JSON.parse(m.toString())); } catch (e) { reject(e); } });
    sock.on('error', (e) => { if (done) return; done = true; clearTimeout(timer); reject(e); });
    sock.send('status', 4445, HOST);
  });
}
function brief(t) {
  const bias = t.latency_bias_samples;
  const engagedSamples = bias + 127;
  return { bias: bias, rt: t.alsa_roundtrip_samples, trim: t.latency_trim_samples, peers: t.link && t.link.peers, synced: t.link && t.link.synced, bpm: t.link && t.link.bpm, phaseErr: t.link && t.link.phase_err_beats, xruns: t.xruns, mlen: t.master_len_samples, rb: t.recorded_beats, idleMs: +(bias / 48).toFixed(3), engagedSamples: engagedSamples, engagedMs: +(engagedSamples / 48).toFixed(3) };
}
function median(a) { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }
function stats(recs) {
  const b = recs.map((r) => r.bias); const rt = recs.map((r) => r.rt);
  const em = recs.map((r) => r.engagedMs);
  return { n: recs.length, biasMin: Math.min(...b), biasMedian: median(b), biasMax: Math.max(...b), rtMin: Math.min(...rt), rtMedian: median(rt), rtMax: Math.max(...rt), idleMsMedian: +(median(b) / 48).toFixed(3), engagedSamplesMedian: median(b) + 127, engagedMsMin: Math.min(...em), engagedMsMedian: median(em), engagedMsMax: Math.max(...em), over7ms: recs.filter((r) => r.engagedMs > 7).length, peerViolations: recs.filter((r) => !(r.peers >= 1 && r.synced === true)).length, xrunsMin: Math.min(...recs.map((r) => r.xruns)), xrunsMax: Math.max(...recs.map((r) => r.xruns)) };
}
async function collect(phase, count, gapMs, out) {
  const recs = [];
  for (let i = 0; i < count; i++) {
    const b = brief(await query());
    recs.push(b);
    out.push({ phase, at: new Date().toISOString(), ...b });
    console.log('[window4a] ' + phase + ' ' + JSON.stringify(b));
    if (i + 1 < count) await sleep(gapMs);
  }
  return recs;
}
async function main() {
  const recs = [];
  const first = brief(await query());
  console.log('[window4a] start ' + JSON.stringify(first));
  if (!(first.peers >= 1 && first.synced === true)) { console.log('[window4a] NOT_PEER_PRESENT'); process.exit(2); }
  const before = await collect('before', BEFORE_S, 1000, recs);
  await sendBytes([0x90, PAD0, 127]);
  await sendBytes([0x80, PAD0, 0]);
  const during = await collect('during', 5, 250, recs);
  await sendBytes([0x90, PAD0, 127]);
  await sendBytes([0x80, PAD0, 0]);
  const after = await collect('after', AFTER_S, 1000, recs);
  const s = { before: stats(before), during: stats(during), after: stats(after) };
  console.log('[window4a] summary ' + JSON.stringify(s));
  fs.writeFileSync(OUT, recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
  console.log('[window4a] wrote ' + OUT);
}
main().catch((e) => { console.error('[window4a] error: ' + e.message); process.exit(1); });
