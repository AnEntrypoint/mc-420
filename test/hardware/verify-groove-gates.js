#!/usr/bin/env node
const net = require('net');
const dgram = require('dgram');

const [, , host, shortMsArg, longMsArg] = process.argv;
if (!host) {
  console.error('usage: node verify-groove-gates.js <host> [shortHoldMs] [longHoldMs]');
  process.exit(2);
}
const kSampleRate = 48000;
const shortHoldMs = Number(shortMsArg || '1500');
const longHoldMs = Number(longMsArg || '4000');
const kClearAllSettleMs = 1200;
const kSettlePollMs = 150;
const kGateWatchMs = 6000;
const kGatePollMs = 120;
const kBeatLenTolerance = 0.02;
const kPhraseTolerance = 0.02;

const kSwingByMode = [
  { cellBeats: 0.5, lateRatio: 0.5 },
  { cellBeats: 0.5, lateRatio: 0.54 },
  { cellBeats: 0.5, lateRatio: 0.62 },
  { cellBeats: 0.5, lateRatio: 0.71 },
  { cellBeats: 1.0, lateRatio: 0.6667 },
];

const kGateExpect = [
  { name: 'off', minLo: 0.999, minHi: 1.001, maxLo: 0.999 },
  { name: 'chop 1 beat', minLo: -1, minHi: 0.05, maxLo: 0.95 },
  { name: 'chop 1/2 beat', minLo: -1, minHi: 0.05, maxLo: 0.95 },
  { name: 'pump', minLo: 0.05, minHi: 0.5, maxLo: 0.95 },
  { name: 'swell', minLo: -1, minHi: 0.25, maxLo: 0.9 },
];

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

async function recordTake(pad, holdMs) {
  await tapPad(pad);
  await sleep(holdMs);
  await tapPad(pad);
}

async function settleWrapLen(looperIndex, maxMs) {
  let last = null;
  let stable = 0;
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const t = await queryTelemetry();
    const w = t.loopers.wraplen[looperIndex];
    if (w === last) {
      stable++;
      if (stable >= 3) return t;
    } else {
      stable = 0;
    }
    last = w;
    await sleep(kSettlePollMs);
  }
  return queryTelemetry();
}

async function watchGate() {
  let min = Infinity;
  let max = -Infinity;
  const start = Date.now();
  while (Date.now() - start < kGateWatchMs) {
    const t = await queryTelemetry();
    const g = t.groove || {};
    if (typeof g.gate_min === 'number') min = Math.min(min, g.gate_min);
    if (typeof g.gate_max === 'number') max = Math.max(max, g.gate_max);
    await sleep(kGatePollMs);
  }
  return { min, max };
}

function beatLenFromBpm(bpm, effSpeed) {
  return (60 * kSampleRate) / (bpm * effSpeed);
}

async function main() {
  console.log(`[groove] target=${host} short=${shortHoldMs}ms long=${longHoldMs}ms`);
  let failed = 0;
  const fail = (msg) => { console.log(`[groove]   FAIL: ${msg}`); failed++; };
  const pass = (msg) => console.log(`[groove]   ok: ${msg}`);

  await pressPad(0x5b);
  await releasePad(0x5b);
  await sleep(kClearAllSettleMs);

  await recordTake(2, shortHoldMs);
  const shortTake = await settleWrapLen(0, 8000);
  const shortWrap = shortTake.loopers.wraplen[0];
  const shortBeatLen = shortTake.groove.beat_len_samples;
  const shortBpm = shortTake.link.bpm;

  await recordTake(3, longHoldMs);
  const longTake = await settleWrapLen(1, 8000);
  const longWrap = longTake.loopers.wraplen[1];
  const longBeatLen = longTake.groove.beat_len_samples;
  const longBpm = longTake.link.bpm;

  const shortBeats = shortWrap / shortBeatLen;
  const longBeats = longWrap / longBeatLen;
  console.log(`[groove] take short: performed ${shortHoldMs}ms -> wraplen ${shortWrap} (${(shortWrap / kSampleRate * 1000).toFixed(0)}ms)`);
  console.log(`[groove] take long:  performed ${longHoldMs}ms -> wraplen ${longWrap} (${(longWrap / kSampleRate * 1000).toFixed(0)}ms)`);
  console.log(`[groove] beat_len ${shortBeatLen.toFixed(1)} -> ${shortBeatLen.toFixed(1)} samples, bpm ${shortBpm.toFixed(2)} -> ${longBpm.toFixed(2)}`);
  console.log(`[groove] repeat lengths in beats: short ${shortBeats.toFixed(3)}, long ${longBeats.toFixed(3)}`);

  const expectShortBeatLen = beatLenFromBpm(shortBpm, shortTake.eff_speed);
  const expectLongBeatLen = beatLenFromBpm(longBpm, longTake.eff_speed);
  if (Math.abs(shortBeatLen - expectShortBeatLen) > expectShortBeatLen * kBeatLenTolerance) {
    fail(`beat_len ${shortBeatLen.toFixed(1)} is not 60*sr/(bpm*eff_speed) = ${expectShortBeatLen.toFixed(1)}`);
  } else {
    pass(`beat length follows the tempo: ${shortBeatLen.toFixed(1)} samples at ${shortBpm.toFixed(2)} bpm`);
  }
  if (Math.abs(longBeatLen - expectLongBeatLen) > expectLongBeatLen * kBeatLenTolerance) {
    fail(`after the second take beat_len ${longBeatLen.toFixed(1)} is not ${expectLongBeatLen.toFixed(1)}`);
  } else {
    pass(`beat length still tempo-derived after the second take: ${longBeatLen.toFixed(1)} samples`);
  }
  if (Math.abs(longBeatLen - shortBeatLen) > shortBeatLen * kBeatLenTolerance) {
    fail(`a ${longHoldMs}ms take changed the beat length from ${shortBeatLen.toFixed(1)} to ${longBeatLen.toFixed(1)} -- repeat lengths still track the loop, not the beat`);
  } else {
    pass(`a ${(longHoldMs / shortHoldMs).toFixed(1)}x longer take leaves the beat length unchanged`);
  }
  for (const [label, beats] of [['short', shortBeats], ['long', longBeats]]) {
    const wholeBeats = Math.round(beats);
    if (Math.abs(beats - wholeBeats) > Math.max(0.02, wholeBeats * 0.002)) {
      fail(`${label} take repeats ${beats.toFixed(3)} beats, not a whole number of beats of the shared grid`);
    } else {
      pass(`${label} take repeats exactly ${wholeBeats} beats of the ${shortBeatLen.toFixed(1)}-sample beat`);
    }
  }
  const beatRatio = longBeats / shortBeats;
  const wholeRatio = Math.round(beatRatio);
  if (Math.abs(beatRatio - wholeRatio) > Math.max(0.02, wholeRatio * 0.002)) {
    fail(`the two takes repeat ${shortBeats.toFixed(3)} and ${longBeats.toFixed(3)} beats (ratio ${beatRatio.toFixed(3)}) -- the longer is not a whole number of the shorter's phrases`);
  } else {
    pass(`the ${(longHoldMs / shortHoldMs).toFixed(1)}x longer take repeats ${wholeRatio}x the phrase, same beat length`);
  }

  const beatPads = [15, 23, 31, 39];
  for (let i = 0; i < beatPads.length; i++) {
    await tapPad(beatPads[i]);
    await sleep(400);
    const t = await queryTelemetry();
    const mode = t.groove.shuffle;
    const swing = kSwingByMode[mode];
    const expectOffset = (swing.lateRatio - 0.5) * 2 * swing.cellBeats * t.groove.beat_len_samples;
    if (mode !== i + 1) {
      fail(`beat pad ${beatPads[i]} set shuffle ${mode}, expected ${i + 1}`);
    } else if (Math.abs(t.groove.swing_offset_samples - expectOffset) > Math.max(1, expectOffset * 0.02)) {
      fail(`shuffle ${mode} swings ${t.groove.swing_offset_samples.toFixed(1)} samples, expected ${expectOffset.toFixed(1)}`);
    } else {
      pass(`shuffle ${mode}: ${t.groove.swing_offset_samples.toFixed(1)} samples late on the off-cell (${(expectOffset / t.groove.beat_len_samples).toFixed(3)} beats)`);
    }
    await tapPad(beatPads[i]);
    await sleep(300);
    const off = await queryTelemetry();
    if (off.groove.shuffle !== 0) fail(`re-pressing beat pad ${beatPads[i]} left shuffle at ${off.groove.shuffle}, expected 0`);
  }

  await tapPad(beatPads[2]);
  await sleep(300);
  await pressPad(7);
  await sleep(120);
  for (let i = 0; i < beatPads.length; i++) {
    await tapPad(beatPads[i]);
    await sleep(400);
    const t = await queryTelemetry();
    if (t.groove.gate !== i + 1) {
      fail(`gate-mod + beat pad ${beatPads[i]} set gate ${t.groove.gate}, expected ${i + 1}`);
    } else if (t.groove.shuffle !== 3) {
      fail(`gate-mod + beat pad ${beatPads[i]} clobbered the shuffle (now ${t.groove.shuffle}, expected 3)`);
    } else {
      pass(`gate-mod + beat pad ${beatPads[i]} -> gate ${t.groove.gate}, shuffle held at ${t.groove.shuffle}`);
    }
    const seen = await watchGate();
    const expect = kGateExpect[i + 1];
    console.log(`[groove]   gate ${i + 1} (${expect.name}): min ${seen.min.toFixed(3)} max ${seen.max.toFixed(3)} over ${kGateWatchMs}ms`);
    if (seen.min < expect.minLo || seen.min > expect.minHi) {
      fail(`gate ${i + 1} (${expect.name}) floor ${seen.min.toFixed(3)} outside [${expect.minLo}, ${expect.minHi}]`);
    }
    if (seen.max < expect.maxLo) {
      fail(`gate ${i + 1} (${expect.name}) never opens (peak ${seen.max.toFixed(3)} < ${expect.maxLo})`);
    }
    await tapPad(beatPads[i]);
    await sleep(300);
    const cleared = await queryTelemetry();
    if (cleared.groove.gate !== 0) fail(`re-pressing beat pad ${beatPads[i]} left gate at ${cleared.groove.gate}, expected 0`);
  }
  await releasePad(7);
  await sleep(300);

  await tapPad(beatPads[1]);
  await sleep(400);
  const afterMod = await queryTelemetry();
  if (afterMod.groove.shuffle !== 2) {
    fail(`after releasing the gate mod, beat pad ${beatPads[1]} set shuffle ${afterMod.groove.shuffle}, expected 2`);
  } else {
    pass('releasing the gate mod returns the beat pads to shuffles');
  }
  await tapPad(beatPads[1]);
  await sleep(300);

  await pressPad(0x5b);
  await releasePad(0x5b);
  await sleep(kClearAllSettleMs);

  console.log(`[groove] ${failed === 0 ? 'PASS' : `FAIL (${failed})`}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[groove] error:', err.message);
  process.exit(1);
});
