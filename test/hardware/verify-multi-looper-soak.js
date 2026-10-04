#!/usr/bin/env node
const net = require('net');

const { despikedSpread, gridBeatLen, queryTelemetry } = require('./lib/gridlock');

const [, , host, takesArg, holdMsArg, gapMsArg, watchMsArg] = process.argv;
if (!host) {
  console.error('usage: node verify-multi-looper-soak.js <host> [takes] [holdMs] [gapMs] [watchMs]');
  process.exit(2);
}
const kTakes = Math.max(2, Math.min(4, Number(takesArg || '3')));
const kHoldMs = Number(holdMsArg || '2000');
const kGapMs = Number(gapMsArg || '60000');
const kWatchMs = Number(watchMsArg || '180000');
const kPollMs = 250;
const kClearAllSettleMs = 1500;
const kTrimSettleMs = 6000;
const kSpreadToleranceSamples = 24;
const kRateTolerance = 5e-5;

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
    await new Promise((r) => setTimeout(r, 150));
  }
  return queryTelemetry(host);
}

async function recordTake(note, holdMs) {
  await pressPad(note);
  await releasePad(note);
  await new Promise((r) => setTimeout(r, holdMs));
  await pressPad(note);
  await releasePad(note);
}

function slope(xs, ys) {
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < xs.length; i++) { sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; sxy += xs[i] * ys[i]; }
  const n = xs.length;
  const denom = n * sxx - sx * sx;
  return denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
}

async function watch(beatLenSamples, wrapLens) {
  await new Promise((r) => setTimeout(r, kTrimSettleMs));
  const first = await queryTelemetry(host);
  const beatsPerCycle = Math.max(1, Math.round(first.recorded_beats || 4));
  const prevRead = first.loopers.readpos.slice(0, kTakes);
  const readAcc = new Array(kTakes).fill(0);
  const baseRead = prevRead.slice();
  const baseMaster = first.master_phase_beats * beatLenSamples;
  const series = [];
  for (let i = 0; i < kTakes; i++) series.push([[0, 0]]);
  const masterSeries = [[0, 0]];
  const firstLock = new Array(kTakes).fill(null);
  const lockDevs = [];
  for (let i = 0; i < kTakes; i++) lockDevs.push([]);
  const pairMin = [];
  const pairMax = [];
  for (let i = 0; i < kTakes; i++) {
    pairMin.push(new Array(kTakes).fill(Infinity));
    pairMax.push(new Array(kTakes).fill(-Infinity));
  }
  const sharedWrap = Math.min(...wrapLens);
  const start = Date.now();
  let prevM = first.master_phase_beats;
  let mAcc = 0;
  const prevR = prevRead.slice();
  while (Date.now() - start < kWatchMs) {
    const t = await queryTelemetry(host);
    const at = (Date.now() - start) / 1000;
    const m = t.master_phase_beats;
    if (m < prevM - beatsPerCycle * 0.5) mAcc += beatsPerCycle;
    prevM = m;
    const masterSamples = (m + mAcc) * beatLenSamples;
    masterSeries.push([at, masterSamples - baseMaster]);
    for (let i = 0; i < kTakes; i++) {
      const r = t.loopers.readpos[i];
      const wl = wrapLens[i] || sharedWrap;
      if (r < prevR[i] - wl * 0.5) readAcc[i] += wl;
      prevR[i] = r;
      const read = r + readAcc[i];
      series[i].push([at, read - baseRead[i]]);
      let lock = (((m * beatLenSamples) - r) % wl + wl) % wl;
      if (firstLock[i] === null) firstLock[i] = lock;
      let d = lock - firstLock[i];
      if (d > wl * 0.5) d -= wl;
      if (d < -wl * 0.5) d += wl;
      lockDevs[i].push(d);
    }
    for (let i = 0; i < kTakes; i++) {
      for (let j = i + 1; j < kTakes; j++) {
        const wl = sharedWrap;
        let off = ((t.loopers.readpos[i] - t.loopers.readpos[j]) % wl + wl) % wl;
        if (off > wl * 0.5) off -= wl;
        if (pairMin[i][j] === Infinity) pairMin[i][j] = off;
        pairMin[i][j] = Math.min(pairMin[i][j], off);
        pairMax[i][j] = Math.max(pairMax[i][j], off);
      }
    }
    await new Promise((r) => setTimeout(r, kPollMs));
  }
  const last = await queryTelemetry(host);
  const elapsed = (Date.now() - start) / 1000;
  const masterSlope = slope(masterSeries.map((p) => p[0]), masterSeries.map((p) => p[1]));
  const rates = [];
  for (let i = 0; i < kTakes; i++) {
    const rs = slope(series[i].map((p) => p[0]), series[i].map((p) => p[1]));
    rates.push(masterSlope === 0 ? 0 : rs / masterSlope);
  }
  const pairSpread = [];
  for (let i = 0; i < kTakes; i++) {
    for (let j = i + 1; j < kTakes; j++) pairSpread.push([i, j, pairMax[i][j] - pairMin[i][j]]);
  }
  return {
    elapsed,
    rates,
    samples: lockDevs[0].length,
    lock: lockDevs.map((devs) => despikedSpread(devs, kSpreadToleranceSamples)),
    pairSpread,
    finalBpm: last.link.bpm,
    finalEffSpeed: last.eff_speed,
    finalPeers: last.link.peers,
  };
}

async function main() {
  console.log(`[soak] target=${host} takes=${kTakes} hold=${kHoldMs}ms gap=${kGapMs}ms watch=${kWatchMs}ms`);
  await pressPad(0x5b);
  await releasePad(0x5b);
  await new Promise((r) => setTimeout(r, kClearAllSettleMs));

  const wrapLens = [];
  for (let i = 0; i < kTakes; i++) {
    if (i > 0) {
      console.log(`[soak] waiting ${kGapMs}ms before take ${i}...`);
      await new Promise((r) => setTimeout(r, kGapMs));
    }
    await recordTake(2 + i, kHoldMs);
    const t = await settleWrapLen(i, 8000);
    wrapLens.push(t.loopers.wraplen[i]);
    console.log(`[soak] looper${i}: ${t.loopers.wraplen[i]} samples, session ${t.link.bpm.toFixed(2)} bpm, eff ${t.eff_speed.toFixed(4)}, peers ${t.link.peers}`);
  }

  const t = await queryTelemetry(host);
  const beatLenSamples = gridBeatLen(t);
  let failed = 0;
  const fail = (msg) => { console.log(`[soak]   FAIL: ${msg}`); failed++; };

  const lenOct = Math.log2(Math.max(...wrapLens) / Math.min(...wrapLens));
  if (Math.abs(lenOct - Math.round(lenOct)) > 0.02) {
    fail(`the takes came back at ${wrapLens.join('/')} samples -- not a power-of-2 ratio`);
  }

  console.log(`[soak] watching ${(kWatchMs / 1000).toFixed(0)}s against a ${beatLenSamples.toFixed(1)} sample grid beat`);
  const w = await watch(beatLenSamples, wrapLens);

  for (let i = 0; i < kTakes; i++) {
    const cents = 1200 * Math.log2(w.rates[i] || 1);
    const held = w.lock[i];
    console.log(`[soak] looper${i} read/grid rate ${w.rates[i].toFixed(7)} (${cents.toFixed(3)} cents), grid lock ${held.min.toFixed(1)}..${held.max.toFixed(1)} samples over ${w.elapsed.toFixed(0)}s (${held.dropped} torn replies dropped)`);
  }
  for (const [i, j, spread] of w.pairSpread) {
    console.log(`[soak] looper${i}/looper${j} offset spread ${spread.toFixed(1)} samples`);
  }
  console.log(`[soak] ended at ${w.finalBpm.toFixed(2)} bpm eff ${w.finalEffSpeed.toFixed(4)} peers ${w.finalPeers}`);

  for (let i = 0; i < kTakes; i++) {
    if (Math.abs(w.rates[i] - 1.0) > kRateTolerance) {
      fail(`looper${i} runs at ${w.rates[i].toFixed(7)} of the grid rate -- ${(1200 * Math.log2(w.rates[i])).toFixed(2)} cents, ${((w.rates[i] - 1) * wrapLens[i]).toFixed(1)} samples of slip per repeat`);
    }
    if (!w.lock[i].held) {
      fail(`looper${i} read head moved ${w.lock[i].spread.toFixed(1)} samples against the master grid over ${w.elapsed.toFixed(0)}s -- ${w.lock[i].min.toFixed(1)}..${w.lock[i].max.toFixed(1)}`);
    }
  }
  for (const [i, j, spread] of w.pairSpread) {
    if (spread > kSpreadToleranceSamples) {
      fail(`looper${i} and looper${j} drifted ${spread.toFixed(1)} samples apart over ${w.elapsed.toFixed(0)}s -- they do not share a rate`);
    }
  }

  console.log(`[soak] ${failed === 0 ? 'PASS' : `FAIL (${failed})`}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[soak] error:', err.message);
  process.exit(1);
});
