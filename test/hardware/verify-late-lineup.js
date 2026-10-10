#!/usr/bin/env node
const net = require('net');
const dgram = require('dgram');
const { despikedSpread } = require('./lib/gridlock');

const [, , host, holdMsArg, delayMsArg] = process.argv;
if (!host) {
  console.error('usage: node verify-late-lineup.js <host> [holdMs] [delayMs]');
  process.exit(2);
}
const holdMsRaw = Number(holdMsArg || '900');
const kHoldEraseMs = 1000;
const holdMs = holdMsRaw >= kHoldEraseMs ? 900 : holdMsRaw;
const delayMs = Number(delayMsArg || '45000');
if (holdMs !== holdMsRaw)
  console.error(`[late-lineup] hold ${holdMsRaw}ms >= kHoldEraseMs ${kHoldEraseMs}ms would erase instead of finish; using ${holdMs}ms`);
const kSampleRate = 48000;
const kTrimSettleMs = 4000;
const kWatchMs = 12000;
const kPollMs = 150;
const kClearAllSettleMs = 1200;
const kToleranceSamples = 16;

const wrap = (v, len) => ((v % len) + len) % len;
const center = (v, len) => wrap(v + len * 0.5, len) - len * 0.5;

function armPhaseSamples(arm, looperIndex, beatLenSamples) {
  if (!(arm.master_len_samples > 0)) return 0;
  return wrap(arm.master_phase_beats * beatLenSamples - arm.loopers.writeidx[looperIndex] * arm.eff_speed, arm.master_len_samples);
}

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
  const arm = await queryTelemetry();
  await new Promise((r) => setTimeout(r, holdMs));
  await pressPad(note);
  await releasePad(note);
  return arm;
}

async function watchTwoLoopers(wrapLen, beatLenSamples) {
  await new Promise((r) => setTimeout(r, kTrimSettleMs));
  const start = Date.now();
  let offsetMin = Infinity;
  let offsetMax = -Infinity;
  let lastOffset = 0;
  let bias0 = 0;
  let bias1 = 0;
  const lockDevs = [[], []];
  let firstLock = [null, null];
  while (Date.now() - start < kWatchMs) {
    const t = await queryTelemetry();
    const r0 = t.loopers.readpos[0];
    const r1 = t.loopers.readpos[1];
    const b0 = t.loopers.latencybias[0];
    const b1 = t.loopers.latencybias[1];
    bias0 = b0 > 0 ? b0 : t.latency_bias_samples;
    bias1 = b1 > 0 ? b1 : t.latency_bias_samples;
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
    bias: [bias0, bias1],
    lock: lockDevs.map((devs) => despikedSpread(devs, kToleranceSamples)),
  };
}

async function main() {
  console.log(`[late-lineup] target=${host} hold=${holdMs}ms delay=${delayMs}ms -- a take recorded later must still line up`);
  await pressPad(0x5b);
  await releasePad(0x5b);
  await new Promise((r) => setTimeout(r, kClearAllSettleMs));

  const armFirst = await recordTake(2, holdMs);
  const first = await settleWrapLen(0, 8000);
  const wlen0 = first.loopers.wraplen[0];
  console.log(`[late-lineup] looper0 (first take): ${wlen0} samples, session ${first.link.bpm.toFixed(2)} bpm, eff ${first.eff_speed.toFixed(4)}`);

  console.log(`[late-lineup] waiting ${delayMs}ms with the mesh running...`);
  await new Promise((r) => setTimeout(r, delayMs));

  const armSecond = await recordTake(3, holdMs);
  const second = await settleWrapLen(1, 8000);
  const wlen1 = second.loopers.wraplen[1];
  console.log(`[late-lineup] looper1 (takes ${(delayMs / 1000).toFixed(0)}s later): ${wlen1} samples, session ${second.link.bpm.toFixed(2)} bpm, eff ${second.eff_speed.toFixed(4)}`);

  let failed = 0;
  const fail = (msg) => { console.log(`[late-lineup]   FAIL: ${msg}`); failed++; };

  if (!(wlen0 > 0) || !(wlen1 > 0)) {
    fail(`a take never landed -- looper0 ${wlen0} samples, looper1 ${wlen1} samples`);
    console.log(`[late-lineup] FAIL (${failed})`);
    process.exit(1);
  }

  const beatLenSamples = gridBeatLen(second);
  const linkBeatLen = (60 / second.link.bpm) * kSampleRate;
  console.log(`[late-lineup] grid beat ${beatLenSamples.toFixed(1)} samples (master_len ${second.master_len_samples} / ${second.recorded_beats} beats), link bpm implies ${linkBeatLen.toFixed(1)}`);
  const wrapLen = Math.min(wlen0, wlen1);
  const lenRatio = wlen0 / wlen1;
  const lenOct = Math.log2(lenRatio);
  if (Math.abs(lenOct - Math.round(lenOct)) > 0.02) {
    fail(`the two takes came back different lengths (${wlen0} vs ${wlen1}) -- not a power-of-2 ratio`);
  }

  const watch = await watchTwoLoopers(wrapLen, beatLenSamples);
  const armPhase = [armPhaseSamples(armFirst, 0, beatLenSamples), armPhaseSamples(armSecond, 1, beatLenSamples)];
  const downbeat = [wrap(armPhase[0] - watch.bias[0], wrapLen), wrap(armPhase[1] - watch.bias[1], wrapLen)];
  const expectedOffset = center(downbeat[1] - downbeat[0], wrapLen);
  const offArm = Math.abs(center(watch.lastOffset - expectedOffset, wrapLen));
  console.log(`[late-lineup] arm phases: looper0 ${armPhase[0].toFixed(1)} (${(armPhase[0] / beatLenSamples).toFixed(3)} beats), looper1 ${armPhase[1].toFixed(1)} (${(armPhase[1] / beatLenSamples).toFixed(3)} beats), bias ${watch.bias[0].toFixed(1)}/${watch.bias[1].toFixed(1)}`);
  console.log(`[late-lineup] offset between the two read heads: ${watch.lastOffset.toFixed(1)} samples, expected ${expectedOffset.toFixed(1)} from the two arm phases`);
  console.log(`[late-lineup] offset spread ${watch.offsetSpread.toFixed(1)} samples, grid lock ${watch.lock[0].min.toFixed(1)}..${watch.lock[0].max.toFixed(1)} / ${watch.lock[1].min.toFixed(1)}..${watch.lock[1].max.toFixed(1)} (${watch.lock[0].dropped + watch.lock[1].dropped} torn replies dropped)`);

  if (watch.offsetSpread > kToleranceSamples) {
    fail(`the two loops drifted ${watch.offsetSpread.toFixed(1)} samples apart over ${(kWatchMs / 1000).toFixed(0)}s -- they do not share a rate`);
  }
  if (offArm > kToleranceSamples) {
    fail(`the two read heads sit ${offArm.toFixed(1)} samples from where their own arm phases put them (measured ${watch.lastOffset.toFixed(1)}, expected ${expectedOffset.toFixed(1)})`);
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
