#!/usr/bin/env node
const net = require('net');
const dgram = require('dgram');

const [, , host, holdMsArg] = process.argv;
if (!host) {
  console.error('usage: node verify-transport-stays-running.js <host> [holdMs]');
  process.exit(2);
}
const kHoldMs = Number(holdMsArg || '1500');
const kClearAllSettleMs = 1200;
const kPollMs = 100;
const kWatchMs = 5000;
const kMinGridSteps = 4;

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
const tapPad = async (note) => { await pressPad(note); await releasePad(note); };

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

async function main() {
  console.log(`[transport] target=${host} take=${kHoldMs}ms`);
  let failed = 0;
  const fail = (msg) => { console.log(`[transport]   FAIL: ${msg}`); failed++; };
  const pass = (msg) => console.log(`[transport]   ok: ${msg}`);

  await tapPad(0x5b);
  await sleep(kClearAllSettleMs);

  await tapPad(2);
  await sleep(kHoldMs);
  await tapPad(2);
  await sleep(kClearAllSettleMs);

  const running = await queryTelemetry();
  if (running.loopers.play === 0) {
    fail('the take finished but no looper reports playing -- nothing to pause');
  } else {
    pass(`take playing (play bits ${running.loopers.play})`);
  }

  await tapPad(2);
  await sleep(kClearAllSettleMs);
  const paused = await queryTelemetry();
  if (paused.loopers.play !== 0) {
    fail(`pressing the pad again left play bits at ${paused.loopers.play}, expected 0`);
  } else {
    pass('all loopers paused (play bits 0)');
  }

  const gridSeen = new Set();
  const phases = [];
  let playingFalse = 0;
  let playBitsSeen = 0;
  const start = Date.now();
  while (Date.now() - start < kWatchMs) {
    const t = await queryTelemetry();
    if (t.grid_beat_index >= 0) gridSeen.add(t.grid_beat_index);
    if (typeof t.master_phase_beats === 'number') phases.push(t.master_phase_beats);
    if (t.link && t.link.playing === false) playingFalse++;
    playBitsSeen |= t.loopers.play;
    await sleep(kPollMs);
  }

  if (playingFalse > 0) {
    fail(`link.playing went false ${playingFalse} time(s) while the loop was only paused`);
  } else {
    pass('the local transport stays running while every loop is paused');
  }
  if (playBitsSeen !== 0) {
    fail(`a looper started playing on its own during the pause (play bits ${playBitsSeen})`);
  }
  if (gridSeen.size < kMinGridSteps) {
    fail(`the metronome grid moved through ${gridSeen.size} step(s) in ${kWatchMs}ms, expected at least ${kMinGridSteps}`);
  } else {
    pass(`the metronome keeps running: ${gridSeen.size} grid steps in ${kWatchMs}ms`);
  }
  let advanced = 0;
  for (let i = 1; i < phases.length; i++) if (phases[i] !== phases[i - 1]) advanced++;
  if (advanced < phases.length / 2) {
    fail(`master phase advanced on ${advanced} of ${phases.length - 1} polls -- the grid is frozen while paused`);
  } else {
    pass(`master phase keeps advancing (${advanced} of ${phases.length - 1} polls)`);
  }

  await tapPad(0x5b);
  await sleep(kClearAllSettleMs);

  console.log(`[transport] ${failed === 0 ? 'PASS' : `FAIL (${failed})`}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[transport] error:', err.message);
  process.exit(1);
});
