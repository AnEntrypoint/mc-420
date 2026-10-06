#!/usr/bin/env node
const dgram = require('dgram');

const [, , host, secondsArg, pollMsArg] = process.argv;
if (!host) {
  console.error('usage: node readpos-wrap.js <host> [seconds] [pollMs]');
  process.exit(2);
}

const kSampleRate = 48000;
const kSeconds = Number(secondsArg || '20');
const kPollMs = Number(pollMsArg || '200');

function queryTelemetry() {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4');
    const timer = setTimeout(() => { sock.close(); reject(new Error('telemetry query timed out')); }, 3000);
    sock.on('message', (msg) => {
      clearTimeout(timer);
      sock.close();
      try { resolve(JSON.parse(msg.toString())); }
      catch (e) { reject(e); }
    });
    sock.on('error', (e) => { clearTimeout(timer); sock.close(); reject(e); });
    sock.send('status', 4445, host);
  });
}

async function main() {
  const first = await queryTelemetry();
  const masterLen = first.master_len_samples;
  const wrapLen = first.loopers.wraplen[0];
  const recordedBeats = first.recorded_beats;
  const linkBpm = first.link.bpm;
  const pinnedLen = (kSampleRate * 60.0 / (linkBpm > 1 ? linkBpm : 120)) * 4.0;

  const start = Date.now();
  let prev = first.loopers.readpos[0];
  let maxSeen = prev;
  let wraps = 0;
  let samples = 0;
  let sumAdvance = 0;
  while (Date.now() - start < kSeconds * 1000) {
    const t = await queryTelemetry();
    const rp = t.loopers.readpos[0];
    const dt = (Date.now() - start) / 1000;
    if (rp < prev - masterLen * 0.5) { wraps++; sumAdvance += rp + masterLen - prev; }
    else if (rp > prev) { sumAdvance += rp - prev; }
    if (rp > maxSeen) maxSeen = rp;
    prev = rp;
    samples++;
    await new Promise((r) => setTimeout(r, kPollMs));
  }
  const last = await queryTelemetry();
  const elapsed = (Date.now() - start) / 1000;

  const advancePerSec = elapsed > 0 ? sumAdvance / elapsed : 0;
  const periodFromWraps = wraps > 0 ? elapsed / wraps : 0;
  const periodFromRate = advancePerSec > 0 ? masterLen / advancePerSec : 0;

  console.log(`[readpos-wrap] master_len=${masterLen} (${(masterLen / kSampleRate).toFixed(3)}s) wraplen[0]=${wrapLen} recorded_beats=${recordedBeats} link.bpm=${linkBpm.toFixed(3)}`);
  console.log(`[readpos-wrap] watched ${elapsed.toFixed(1)}s, ${samples} polls, ${wraps} wraps`);
  console.log(`[readpos-wrap] read-head max seen = ${maxSeen.toFixed(0)} (wraplen says ${wrapLen}; a 4-beat pin at this bpm is ${pinnedLen.toFixed(0)})`);
  console.log(`[readpos-wrap] read-head advance = ${advancePerSec.toFixed(1)} samples/s -> cycle ${(masterLen / advancePerSec).toFixed(3)}s from rate, ${periodFromWraps.toFixed(3)}s from wrap count`);
  console.log(`[readpos-wrap] vs master_len cycle ${(masterLen / kSampleRate).toFixed(3)}s, vs pinned-4 cycle ${(pinnedLen / kSampleRate).toFixed(3)}s`);
  const rates = [advancePerSec, periodFromWraps, periodFromRate, maxSeen, last.loopers.readpos[0]];
  console.log(`[readpos-wrap] end: readpos=${last.loopers.readpos[0].toFixed(0)} wraplen=${last.loopers.wraplen[0]} master_len=${last.master_len_samples}`);
  return rates;
}

main().catch((e) => { console.error('[readpos-wrap] error:', e.message); process.exit(1); });
