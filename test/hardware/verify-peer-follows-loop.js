#!/usr/bin/env node
const net = require('net');
const dgram = require('dgram');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const [, , host, holdBeatsArg, peerBpmArg, peerPathArg] = process.argv;
if (!host) {
  console.error('usage: node verify-peer-follows-loop.js <host> [holdBeats] [peerBpm] [peerBinary]');
  process.exit(2);
}
const holdBeats = Number(holdBeatsArg || '4.5');
const peerBpm = Number(peerBpmArg || '120');
const peerPath = peerPathArg || path.join(__dirname, '..', '..', 'build', 'link-peer.exe');
const kPeerBuild = 'g++ -std=c++14 -O1 -DLINK_PLATFORM_WINDOWS -D_WIN32_WINNT=0x0601 -DASIO_STANDALONE -I build/_deps/abletonlink-src/include -I build/_deps/abletonlink-src/modules/asio-standalone/asio/include test/hardware/link-peer.cpp -o build/link-peer.exe -lws2_32 -lwinmm -liphlpapi -mthreads';

const kSampleRate = 48000;
const kClearAllSettleMs = 1200;
const kSettleMs = 8000;
const kPollMs = 60;
const kJumpToleranceBeats = 0.2;
const kPhaseToleranceBeats = 0.05;
const kPressAlignToleranceBeats = 0.08;

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
    sock.on('error', (e) => { clearTimeout(timer); reject(e); });
    sock.send('status', 4445, host);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frac = (v) => v - Math.floor(v);
const circularDelta = (a, b, len) => {
  let d = (a - b) % len;
  if (d > len * 0.5) d -= len;
  if (d < -len * 0.5) d += len;
  return d;
};

function deriveTempoQuantBeats(seconds, anchorBpm) {
  const anchor = anchorBpm > 1 ? anchorBpm : 120;
  let best = 16;
  let bestScore = Infinity;
  let bestInWindow = false;
  for (let beats = 1; beats <= 128; beats += 1) {
    const bpm = (60 * beats) / seconds;
    const inWindow = bpm >= anchor * 0.5 && bpm <= anchor * 2;
    const score = Math.abs(Math.log2(bpm / anchor));
    if ((inWindow && !bestInWindow) || (inWindow === bestInWindow && score < bestScore)) {
      best = beats;
      bestScore = score;
      bestInWindow = inWindow;
    }
  }
  return best;
}

function startPeer() {
  const child = spawn(peerPath, [String(peerBpm), '16', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const trace = [];
  let carry = '';
  const push = (chunk) => {
    carry += chunk.toString();
    const lines = carry.split('\n');
    carry = lines.pop();
    for (const line of lines) {
      const m = line.match(/peers=(\d+) bpm=([\d.]+) beat=([\d.-]+) phase=([\d.-]+) ms=(\d+)/);
      if (m) {
        trace.push({
          hostMs: Number(m[5]),
          peers: Number(m[1]),
          bpm: Number(m[2]),
          beat: Number(m[3]),
        });
        if (trace.length > 4000) trace.shift();
      }
    }
  };
  child.stdout.on('data', push);
  child.stderr.on('data', push);
  child.on('error', (e) => console.error(`[peer-follow] peer process error: ${e.message}`));
  return { child, trace };
}

function peerBeatAt(trace, hostMs) {
  let last = null;
  for (let i = trace.length - 1; i >= 0; i--) {
    if (trace[i].hostMs <= hostMs) { last = trace[i]; break; }
  }
  if (!last) return null;
  const dtSec = (hostMs - last.hostMs) / 1000;
  return last.beat + dtSec * (last.bpm / 60.0);
}

function findJump(trace, fromMs, toMs) {
  let best = null;
  for (let i = 1; i < trace.length; i++) {
    const a = trace[i - 1];
    const b = trace[i];
    if (b.hostMs < fromMs || b.hostMs > toMs || a.hostMs < fromMs) continue;
    const dtSec = (b.hostMs - a.hostMs) / 1000;
    if (dtSec <= 0 || dtSec > 1.0) continue;
    const expected = dtSec * (a.bpm / 60.0);
    const residual = b.beat - a.beat - expected;
    if (!best || Math.abs(residual) > Math.abs(best.residual)) {
      best = { residual, atMs: b.hostMs, fromBeat: a.beat, toBeat: b.beat, bpm: b.bpm };
    }
  }
  return best;
}

async function waitForBeatFraction(trace, target, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const now = Date.now();
    const beat = peerBeatAt(trace, now);
    if (beat !== null) {
      const f = frac(beat);
      const off = Math.min(Math.abs(f - target), 1 - Math.abs(f - target));
      if (off <= kPressAlignToleranceBeats) return { atMs: Date.now(), beat };
    }
    await sleep(20);
  }
  return null;
}

async function main() {
  let failed = 0;
  const fail = (msg) => { console.log(`[peer-follow]   FAIL: ${msg}`); failed++; };

  if (!fs.existsSync(peerPath)) {
    console.error(`[peer-follow] host Link peer not built: ${peerPath}`);
    console.error(`[peer-follow] build it with: ${kPeerBuild}`);
    process.exit(2);
  }

  console.log(`[peer-follow] target=${host} hold=${holdBeats} beats -- the first loop must own the phase and the peer must follow it`);
  const { child, trace } = startPeer();
  const stopPeer = () => { try { child.kill(); } catch (e) { void e; } };
  process.on('exit', stopPeer);

  const peerUp = Date.now();
  while (Date.now() - peerUp < 8000 && trace.length < 3) await sleep(100);
  if (trace.length === 0) {
    console.error('[peer-follow] the host Link peer produced no output');
    stopPeer();
    process.exit(2);
  }

  await pressPad(0x5b);
  await releasePad(0x5b);
  await sleep(kClearAllSettleMs);

  const pre = await queryTelemetry();
  const peers = pre.link ? pre.link.peers : 0;
  console.log(`[peer-follow] session ${pre.link.bpm.toFixed(2)} bpm peers=${peers} synced=${!!pre.link.synced}`);
  if (peers < 1) {
    fail(`no Link peer is connected (peers=${peers}) -- the phase path is inert, nothing can be shown`);
  }

  const arm = await waitForBeatFraction(trace, 0.0, 20000);
  if (!arm) {
    console.error('[peer-follow] could not line up the ARM press with the session downbeat');
    stopPeer();
    process.exit(2);
  }
  const beatSec = 60.0 / (arm.beat ? (pre.link.bpm || peerBpm) : peerBpm);
  const holdMs = Math.max(300, Math.round(holdBeats * beatSec * 1000));
  console.log(`[peer-follow] ARM on the session downbeat (beat ${arm.beat.toFixed(3)}), holding ${holdMs}ms`);
  await pressPad(2);
  await releasePad(2);
  const armAtMs = Date.now();

  await sleep(holdMs);
  await pressPad(2);
  await releasePad(2);
  const finishAtMs = Date.now();

  let settled = null;
  let lastWlen = -1;
  let stable = 0;
  const settleStart = Date.now();
  while (Date.now() - settleStart < kSettleMs) {
    const t = await queryTelemetry();
    const w = t.loopers.wraplen[0];
    if (w === lastWlen && w > 1) {
      stable++;
      if (stable >= 3) { settled = t; break; }
    } else {
      stable = 0;
    }
    lastWlen = w;
    await sleep(kPollMs);
  }
  if (!settled) settled = await queryTelemetry();

  const wlen = settled.loopers.wraplen[0];
  const wlenSeconds = wlen / kSampleRate;
  const postBpm = settled.link.bpm;
  const phraseBeats = deriveTempoQuantBeats(wlenSeconds, postBpm);
  const derivedBpm = (60 * phraseBeats) / wlenSeconds;
  console.log(`[peer-follow] take: ${wlen} samples (${(wlenSeconds * 1000).toFixed(0)}ms) -> ${phraseBeats} beats @ ${derivedBpm.toFixed(2)} bpm, eff ${settled.eff_speed.toFixed(4)}`);

  const jump = findJump(trace, armAtMs, finishAtMs + 3000);
  if (jump) {
    console.log(`[peer-follow] the session phase jumped ${jump.residual.toFixed(3)} beats at ${jump.atMs - finishAtMs}ms from the finish press (beat ${jump.fromBeat.toFixed(3)} -> ${jump.toBeat.toFixed(3)})`);
  } else {
    console.log('[peer-follow] the session phase never jumped -- the session kept its own downbeat');
  }

  if (!jump || Math.abs(jump.residual) < kJumpToleranceBeats) {
    fail(`the session phase did not move onto the loop point (jump ${jump ? jump.residual.toFixed(3) : '0.000'} beats) -- our material would have been displaced instead`);
  }

  const phaseSamples = [];
  const watchStart = Date.now();
  let minDelta = Infinity;
  let maxDelta = -Infinity;
  while (Date.now() - watchStart < 6000) {
    const t = await queryTelemetry();
    const atMs = Date.now();
    const peerBeat = peerBeatAt(trace, atMs);
    if (peerBeat === null) { await sleep(kPollMs); continue; }
    const sessionPhase = ((peerBeat % phraseBeats) + phraseBeats) % phraseBeats;
    const delta = circularDelta(t.master_phase_beats, sessionPhase, phraseBeats);
    minDelta = Math.min(minDelta, delta);
    maxDelta = Math.max(maxDelta, delta);
    phaseSamples.push(delta);
    await sleep(kPollMs);
  }
  const meanDelta = phaseSamples.reduce((a, b) => a + b, 0) / (phaseSamples.length || 1);
  console.log(`[peer-follow] device grid vs session phase over ${phaseSamples.length} samples: mean ${meanDelta.toFixed(4)} beats (spread ${(maxDelta - minDelta).toFixed(4)})`);
  if (Math.abs(meanDelta) > kPhaseToleranceBeats) {
    fail(`the loop's grid sits ${meanDelta.toFixed(3)} beats off the session phase -- the two do not share a downbeat`);
  }

  const final = await queryTelemetry();
  console.log(`[peer-follow] after the take: session ${final.link.bpm.toFixed(2)} bpm peers=${final.link.peers} eff ${final.eff_speed.toFixed(4)}`);
  if (Math.abs(final.eff_speed - 1.0) > 1e-3) {
    fail(`eff_speed ${final.eff_speed.toFixed(4)} resamples the take instead of repeating it`);
  }
  if (Math.abs(final.link.bpm - derivedBpm) > Math.max(0.5, derivedBpm * 0.01)) {
    fail(`the session stayed at ${final.link.bpm.toFixed(2)} bpm instead of the loop's ${derivedBpm.toFixed(2)} bpm`);
  }

  console.log(`[peer-follow] ${failed === 0 ? 'PASS' : `FAIL (${failed})`}`);
  stopPeer();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[peer-follow] error:', err.message);
  process.exit(1);
});
