#!/usr/bin/env node
const net = require('net');
const dgram = require('dgram');
const { despikedSpread } = require('./lib/gridlock');

const [, , host, holdMsArg, delayMsArg] = process.argv;
if (!host) {
  console.error('usage: node verify-late-lineup.js <host> [holdMs] [delayMs]');
  process.exit(2);
}
const holdMs = Number(holdMsArg || '2000');
const delayMs = Number(delayMsArg || '45000');
const kSampleRate = 48000;
const kFineGridBeats = 0.125;
const kTrimSettleMs = 4000;
const kWatchMs = 12000;
const kPollMs = 150;
const kClearAllSettleMs = 1200;
const kToleranceSamples = 16;

function gridBeatLen(t) {
  if (t.master_len_samples > 0 && t.recorded_beats >= 1) return t.master_len_samples / t.recorded_beats;
  return t.groove.beat_len_samples;
}

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

async function settleWrapLen(looperIndex, maxMs) {
  let last = null, stableCount = 0;
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const t = await queryTelemetry();
    const w = t.loopers.wraplen[looperIndex];
    if (w === last) {
      stableCount++;
      if (stableCount >= 3) return t;
    } else {
      stableCount = 0;
    }
    last = w;
    await new Promise((r) => setTimeout(r, 150));
  }
  return queryTelemetry();
}

async function recordTake(note, holdMs) {
  await pressPad(note);
  await releasePad(note);
  await new Promise((r) => setTimeout(r, holdMs));
  await pressPad(note);
  await releasePad(note);
}

async function watchTwoLoopers(wrapLen, beatLenSamples) {
  await new Promise((r) => setTimeout(r, kTrimSettleMs));
  const start = Date.now();
  let offsetMin = Infinity;
  let offsetMax = -Infinity;
  let lastOffset = 0;
  const lockDevs = [[], []];
  let firstLock = [null, null];
  while (Date.now() - start < kWatchMs) {
    const t = await queryTelemetry();
    const r0 = t.loopers.readpos[0];
    const r1 = t.loopers.readpos[1];
    const masterSamples = t.master_phase_beats * beatLenSamples;
    let offset = ((r0 - r1) % wrapLen + wrapLen) % wrapLen;
    if (offset > wrapLen * 0.5) offset -= wrapLen;
    offsetMin = Math.min(offsetMin, offset);
    offsetMax = Math.max(offsetMax, offset);
    lastOffset = offset;
    for (let i = 0; i < 2; i++) {
      let lock = ((masterSamples - t.loopers.readpos[i]) % wrapLen + wrapLen) % wrapLen;
      if (firstLock[i] === null) firstLock[i] = lock;
      let d = lock - firstLock[i];
      if (d > wrapLen * 0.5) d -= wrapLen;
      if (d < -wrapLen * 0.5) d += wrapLen;
      lockDevs[i].push(d);
    }
    await new Promise((r) => setTimeout(r, kPollMs));
  }
  return {
    offsetSpread: offsetMax - offsetMin,
    lastOffset,
    lock: lockDevs.map((devs) => despikedSpread(devs, kToleranceSamples)),
  };
}

async function main() {
  console.log(`[late-lineup] target=${host} hold=${holdMs}ms delay=${delayMs}ms -- a take recorded later must still line up`);
  await pressPad(0x5b);
  await releasePad(0x5b);
  await new Promise((r) => setTimeout(r, kClearAllSettleMs));

  await recordTake(2, holdMs);
  const first = await settleWrapLen(0, 8000);
  const wlen0 = first.loopers.wraplen[0];
  console.log(`[late-lineup] looper0 (first take): ${wlen0} samples, session ${first.link.bpm.toFixed(2)} bpm, eff ${first.eff_speed.toFixed(4)}`);

  console.log(`[late-lineup] waiting ${delayMs}ms with the mesh running...`);
  await new Promise((r) => setTimeout(r, delayMs));

  await recordTake(3, holdMs);
  const second = await settleWrapLen(1, 8000);
  const wlen1 = second.loopers.wraplen[1];
  console.log(`[late-lineup] looper1 (takes ${(delayMs / 1000).toFixed(0)}s later): ${wlen1} samples, session ${second.link.bpm.toFixed(2)} bpm, eff ${second.eff_speed.toFixed(4)}`);

  let failed = 0;
  const fail = (msg) => { console.log(`[late-lineup]   FAIL: ${msg}`); failed++; };

  const beatLenSamples = gridBeatLen(second);
  const cell = beatLenSamples * kFineGridBeats;
  const linkBeatLen = (60 / second.link.bpm) * kSampleRate;
  console.log(`[late-lineup] grid beat ${beatLenSamples.toFixed(1)} samples (master_len ${second.master_len_samples} / ${second.recorded_beats} beats), link bpm implies ${linkBeatLen.toFixed(1)}`);
  const wrapLen = Math.min(wlen0, wlen1);
  const lenRatio = wlen0 / wlen1;
  const lenOct = Math.log2(lenRatio);
  if (Math.abs(lenOct - Math.round(lenOct)) > 0.02) {
    fail(`the two takes came back different lengths (${wlen0} vs ${wlen1}) -- not a power-of-2 ratio`);
  }

  const watch = await watchTwoLoopers(wrapLen, beatLenSamples);
  const offCell = Math.abs(watch.lastOffset - Math.round(watch.lastOffset / cell) * cell);
  console.log(`[late-lineup] offset between the two read heads: ${watch.lastOffset.toFixed(1)} samples (${(watch.lastOffset / cell).toFixed(3)} grid cells of ${cell.toFixed(1)})`);
  console.log(`[late-lineup] offset spread ${watch.offsetSpread.toFixed(1)} samples, grid lock ${watch.lock[0].min.toFixed(1)}..${watch.lock[0].max.toFixed(1)} / ${watch.lock[1].min.toFixed(1)}..${watch.lock[1].max.toFixed(1)} (${watch.lock[0].dropped + watch.lock[1].dropped} torn replies dropped)`);

  if (watch.offsetSpread > kToleranceSamples) {
    fail(`the two loops drifted ${watch.offsetSpread.toFixed(1)} samples apart over ${(kWatchMs / 1000).toFixed(0)}s -- they do not share a rate`);
  }
  if (offCell > kToleranceSamples) {
    fail(`the second take sits ${offCell.toFixed(1)} samples off the 1/8-beat grid relative to the first -- off by ${(offCell / cell).toFixed(2)} of a cell`);
  }
  for (let i = 0; i < 2; i++) {
    if (!watch.lock[i].held) {
      fail(`looper${i} read head jumped ${watch.lock[i].spread.toFixed(1)} samples against the master grid`);
    }
  }

  console.log(`[late-lineup] ${failed === 0 ? 'PASS' : `FAIL (${failed})`}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[late-lineup] error:', err.message);
  process.exit(1);
});
