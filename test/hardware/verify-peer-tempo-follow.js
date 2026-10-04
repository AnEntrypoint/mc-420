#!/usr/bin/env node
const net = require('net');
const fs = require('fs');
const { spawn } = require('child_process');
const path = require('path');
const { kSampleRate, despikedSpread, gridBeatLen, queryTelemetry } = require('./lib/gridlock');

const [, , host, sweepBpmArg, peerBpmArg] = process.argv;
if (!host) {
  console.error('usage: node verify-peer-tempo-follow.js <host> [sweepBpm] [peerBpm]');
  process.exit(2);
}
const kPeerBpm = Number(peerBpmArg || '120');
const kSweepBpm = Number(sweepBpmArg || '132');
const kHoldMs = 2000;
const kSweepAtSec = 25;
const kBackAtSec = 45;
const kWatchUntilSec = 80;
const kPollMs = 250;
const kClearAllSettleMs = 1500;
const kSpreadToleranceSamples = 32;
const kTempoMoveBpm = 4.0;
const kJumpBpm = 0.5;
const kTrimSettleSec = 8;
const kPeerBuild = 'g++ -std=c++14 -O1 -DLINK_PLATFORM_WINDOWS -D_WIN32_WINNT=0x0601 -DASIO_STANDALONE -I build/_deps/abletonlink-src/include -I build/_deps/abletonlink-src/modules/asio-standalone/asio/include test/hardware/link-peer.cpp -o build/link-peer-sweep.exe -static -lws2_32 -lwinmm -liphlpapi -mthreads';

const peerPath = path.join(__dirname, '..', '..', 'build', 'link-peer-sweep.exe');

function sendBytes(bytes) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port: 9401 }, () => {
      sock.write(Buffer.from(bytes), (err) => {
        if (err) return reject(err);
        sock.end();
      });
    });
    sock.setTimeout(5000);
    sock.on('timeout', () => { sock.destroy(); reject(new Error(`connect/write to ${host}:9401 timed out`)); });
    sock.on('close', resolve);
    sock.on('error', reject);
  });
}

const pressPad = (note) => sendBytes([0x90, note, 127]);
const releasePad = (note) => sendBytes([0x80, note, 0]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function settleWrapLen(looperIndex, maxMs) {
  let last = null, stableCount = 0;
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const t = await queryTelemetry(host);
    const w = t.loopers.wraplen[looperIndex];
    if (w === last) {
      stableCount++;
      if (stableCount >= 3) return t;
    } else {
      stableCount = 0;
    }
    last = w;
    await sleep(150);
  }
  return queryTelemetry(host);
}

async function recordTake(note, holdMs) {
  await pressPad(note);
  await releasePad(note);
  await sleep(holdMs);
  await pressPad(note);
  await releasePad(note);
}

function startPeer(sweepSpec) {
  const child = spawn(peerPath, [String(kPeerBpm), '16', '0', sweepSpec], { stdio: ['ignore', 'pipe', 'pipe'] });
  const lines = [];
  const push = (chunk) => {
    for (const line of chunk.toString().split('\n')) {
      if (line.trim()) lines.push(line.trim());
    }
    if (lines.length > 2000) lines.splice(0, lines.length - 2000);
  };
  child.stdout.on('data', push);
  child.stderr.on('data', push);
  return { child, lines };
}

async function main() {
  let failed = 0;
  const fail = (msg) => { console.log(`[tempo-follow]   FAIL: ${msg}`); failed++; };

  if (!fs.existsSync(peerPath)) {
    console.error(`[tempo-follow] host Link peer not built: ${peerPath}`);
    console.error(`[tempo-follow] build it with: ${kPeerBuild}`);
    process.exit(2);
  }

  console.log(`[tempo-follow] target=${host} peer ${kPeerBpm} -> ${kSweepBpm} bpm at ${kSweepAtSec}s, back at ${kBackAtSec}s`);
  const { child, lines } = startPeer(`${kSweepAtSec}:${kSweepBpm},${kBackAtSec}:${kPeerBpm}`);
  const stopPeer = () => { try { child.kill(); } catch (e) { void e; } };
  process.on('exit', stopPeer);

  const started = Date.now();
  let peers = 0;
  while (Date.now() - started < 12000) {
    const t = await queryTelemetry(host);
    peers = t.link ? t.link.peers : 0;
    if (peers >= 1) break;
    await sleep(300);
  }
  if (peers < 1) {
    fail(`no Link peer connected (peers=${peers}) -- the tempo path is inert`);
  }

  await pressPad(0x5b);
  await releasePad(0x5b);
  await sleep(kClearAllSettleMs);

  await recordTake(2, kHoldMs);
  const first = await settleWrapLen(0, 8000);
  const wrapLens = [first.loopers.wraplen[0]];
  const recordedBeats = first.recorded_beats || 0;
  const recordedBpm = (recordedBeats >= 1 && first.master_len_samples > 0)
    ? (60 * recordedBeats) / (first.master_len_samples / kSampleRate)
    : first.link.bpm;
  console.log(`[tempo-follow] looper0: ${wrapLens[0]} samples, recorded ${recordedBpm.toFixed(2)} bpm, session ${first.link.bpm.toFixed(2)}, eff ${first.eff_speed.toFixed(4)}`);

  await recordTake(3, kHoldMs);
  const second = await settleWrapLen(1, 8000);
  wrapLens.push(second.loopers.wraplen[1]);
  console.log(`[tempo-follow] looper1: ${wrapLens[1]} samples, session ${second.link.bpm.toFixed(2)}, eff ${second.eff_speed.toFixed(4)}`);

  const beatLenSamples = gridBeatLen(second);
  const sharedWrap = Math.min(...wrapLens);
  const elapsedSec = () => (Date.now() - started) / 1000;
  while (elapsedSec() < kSweepAtSec - 4) await sleep(200);

  let bpmMin = Infinity;
  let bpmMax = -Infinity;
  let effMin = Infinity;
  let effMax = -Infinity;
  const firstLock = [null, null];
  const lockDevs = [[], []];
  let pairMin = Infinity;
  let pairMax = -Infinity;
  let pairFirst = null;
  let bpmAtSweep = null;
  let bpmAtEnd = null;
  let lastBpm = null;
  let trimSettleUntilSec = 0;

  while (elapsedSec() < kWatchUntilSec) {
    const t = await queryTelemetry(host);
    const bpm = t.link.bpm;
    bpmMin = Math.min(bpmMin, bpm);
    bpmMax = Math.max(bpmMax, bpm);
    effMin = Math.min(effMin, t.eff_speed);
    effMax = Math.max(effMax, t.eff_speed);
    const now = elapsedSec();
    if (lastBpm === null) lastBpm = bpm;
    if (Math.abs(bpm - lastBpm) > kJumpBpm) trimSettleUntilSec = now + kTrimSettleSec;
    lastBpm = bpm;
    if (now < trimSettleUntilSec) {
      if (bpmAtSweep === null && now > kSweepAtSec + 2 && now < kSweepAtSec + 8) bpmAtSweep = bpm;
      bpmAtEnd = bpm;
      await sleep(kPollMs);
      continue;
    }
    const masterSamples = t.master_phase_beats * beatLenSamples;
    for (let i = 0; i < 2; i++) {
      const wl = wrapLens[i];
      let lock = ((masterSamples - t.loopers.readpos[i]) % wl + wl) % wl;
      if (firstLock[i] === null) firstLock[i] = lock;
      let d = lock - firstLock[i];
      if (d > wl * 0.5) d -= wl;
      if (d < -wl * 0.5) d += wl;
      lockDevs[i].push(d);
    }
    let off = ((t.loopers.readpos[0] - t.loopers.readpos[1]) % sharedWrap + sharedWrap) % sharedWrap;
    if (off > sharedWrap * 0.5) off -= sharedWrap;
    if (pairFirst === null) pairFirst = off;
    let dOff = off - pairFirst;
    if (dOff > sharedWrap * 0.5) dOff -= sharedWrap;
    if (dOff < -sharedWrap * 0.5) dOff += sharedWrap;
    pairMin = Math.min(pairMin, dOff);
    pairMax = Math.max(pairMax, dOff);
    if (bpmAtSweep === null && now > kSweepAtSec + 2 && now < kSweepAtSec + 8) bpmAtSweep = bpm;
    bpmAtEnd = bpm;
    await sleep(kPollMs);
  }

  const sets = lines.filter((l) => l.includes('SET tempo'));
  console.log(`[tempo-follow] peer SET tempo lines: ${sets.length ? sets.join(' | ') : 'none'}`);
  console.log(`[tempo-follow] session bpm ranged ${bpmMin.toFixed(2)} .. ${bpmMax.toFixed(2)} (at the sweep: ${bpmAtSweep === null ? 'n/a' : bpmAtSweep.toFixed(2)}), eff ${effMin.toFixed(4)} .. ${effMax.toFixed(4)}`);
  const lock = lockDevs.map((devs) => despikedSpread(devs, kSpreadToleranceSamples));
  console.log(`[tempo-follow] grid lock ${lock[0].min.toFixed(1)}..${lock[0].max.toFixed(1)} / ${lock[1].min.toFixed(1)}..${lock[1].max.toFixed(1)} samples (${lock[0].dropped + lock[1].dropped} torn replies dropped), pair offset spread ${(pairMax - pairMin).toFixed(1)} samples`);
  console.log(`[tempo-follow] ended at ${bpmAtEnd.toFixed(2)} bpm`);

  if (bpmMax - bpmMin < kTempoMoveBpm) {
    fail(`the session tempo never moved (${bpmMin.toFixed(2)}..${bpmMax.toFixed(2)}) -- the sweep did not reach the device`);
  }
  const expectedEff = kSweepBpm / recordedBpm;
  if (bpmAtSweep !== null && Math.abs(bpmAtSweep - kSweepBpm) > 1.0 && Math.abs(effMax - expectedEff) > 0.02) {
    fail(`the sweep landed at ${bpmAtSweep.toFixed(2)} bpm and eff only reached ${effMax.toFixed(4)} (expected ~${expectedEff.toFixed(4)}) -- the device ignored the session tempo`);
  }
  for (let i = 0; i < 2; i++) {
    if (!lock[i].held) {
      fail(`looper${i} read head moved ${lock[i].spread.toFixed(1)} samples against the master grid while the session tempo moved -- the take did not follow the grid`);
    }
  }
  const pairSpread = pairMax - pairMin;
  if (pairSpread > kSpreadToleranceSamples) {
    fail(`the two takes drifted ${pairSpread.toFixed(1)} samples apart while the session tempo moved`);
  }
  if (Math.abs(bpmAtEnd - kPeerBpm) > 1.5 && Math.abs(bpmAtEnd - recordedBpm) > 1.5) {
    console.log(`[tempo-follow]   note: the session settled at ${bpmAtEnd.toFixed(2)} bpm, neither the peer's ${kPeerBpm} nor the recorded ${recordedBpm.toFixed(2)}`);
  }

  stopPeer();
  console.log(`[tempo-follow] ${failed === 0 ? 'PASS' : `FAIL (${failed})`}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[tempo-follow] error:', err.message);
  process.exit(1);
});
