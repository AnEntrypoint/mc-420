#!/usr/bin/env node
const net = require('net');
const dgram = require('dgram');

const [, , host, ...holdArgs] = process.argv;
if (!host) {
  console.error('usage: node verify-quantization.js <host> [holdMs...]');
  process.exit(2);
}
const holds = (holdArgs.length ? holdArgs : ['2000', '600', '8100']).map(Number);

function sendBytes(bytes) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port: 9401 }, () => {
      sock.write(Buffer.from(bytes), (err) => {
        if (err) return reject(err);
        sock.end();
      });
    });
    sock.setTimeout(5000);
    sock.on('timeout', () => { sock.destroy(); reject(new Error(`connect/write to ${host}:9401 timed out after 5s`)); });
    sock.on('close', resolve);
    sock.on('error', reject);
  });
}

function padNote(looperIndex) {
  if (looperIndex < 0 || looperIndex > 3) {
    throw new Error(`padNote only covers loopers 0-3 (row 0); got ${looperIndex}`);
  }
  const row = 0, col = looperIndex + 2;
  return row * 8 + col;
}

async function pressPad(note) {
  await sendBytes([0x90, note, 127]);
}
async function releasePad(note) {
  await sendBytes([0x80, note, 0]);
}

function queryTelemetry() {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4');
    const timeout = setTimeout(() => { sock.close(); reject(new Error('telemetry query timed out')); }, 3000);
    sock.on('message', (msg) => {
      clearTimeout(timeout);
      sock.close();
      try { resolve(JSON.parse(msg.toString())); }
      catch (e) { reject(e); }
    });
    sock.on('error', (e) => { clearTimeout(timeout); reject(e); });
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

async function recordLooper(looperIndex, holdMs) {
  const note = padNote(looperIndex);
  console.log(`[verify-quant] looper${looperIndex}: ARM (note ${note}), holding ${holdMs}ms`);
  await pressPad(note);
  await releasePad(note);
  await new Promise((r) => setTimeout(r, holdMs));
  console.log(`[verify-quant] looper${looperIndex}: FINISH (a second press -- ARM/FINISH both fire on PRESS, the matching release is a no-op)`);
  await pressPad(note);
  await releasePad(note);
  const t = await settleWrapLen(looperIndex, 8000);
  const wrapLenSamples = t.loopers.wraplen[looperIndex];
  const wrapLenSeconds = wrapLenSamples / 48000;
  return { holdMs, wrapLenSamples, wrapLenSeconds };
}

function ladderAnchorBeats(phraseBeats, takeLenBeats) {
  const eps = 0.01;
  let anchor = phraseBeats;
  while (anchor * 0.5 >= 1.0 && anchor > takeLenBeats + eps) anchor *= 0.5;
  if (anchor > takeLenBeats + eps) anchor = 1.0;
  return anchor;
}

function deriveTempoQuantBeats(recordedSeconds, anchorBpm) {
  const anchor = (anchorBpm > 1) ? anchorBpm : 120;
  let best = 16, bestScore = Infinity, bestInWindow = false;
  for (let beats = 1; beats <= 128; beats += 1) {
    const bpm = (60 * beats) / recordedSeconds;
    const inWindow = bpm >= anchor * 0.5 && bpm <= anchor * 2;
    const score = Math.abs(Math.log2(bpm / anchor));
    if ((inWindow && !bestInWindow) || (inWindow === bestInWindow && score < bestScore)) {
      best = beats; bestScore = score; bestInWindow = inWindow;
    }
  }
  return best;
}

const NEAR_CUT_BEATS = 1.0;
const WHOLE_BEAT_SNAP_BEATS = 0.4;

function nearCutFarExtendCandidate(effectiveSamples, masterLenSamples, recordedBeats) {
  const phraseBeats = Math.max(1, recordedBeats);
  const oneBeatSamples = Math.max(1, masterLenSamples / phraseBeats);
  const takeLenBeats = effectiveSamples / oneBeatSamples;
  const anchorGridBeats = ladderAnchorBeats(phraseBeats, takeLenBeats);
  const pastMultiple = Math.floor(takeLenBeats / anchorGridBeats + 0.0001);
  const pastNodeBeats = pastMultiple * anchorGridBeats;
  const futureNodeBeats = pastNodeBeats + anchorGridBeats;
  const overshootBeats = takeLenBeats - pastNodeBeats;
  let finalBeats = Math.abs(takeLenBeats - 1) <= WHOLE_BEAT_SNAP_BEATS ? 1 : ((pastMultiple >= 1 && overshootBeats <= NEAR_CUT_BEATS + 0.0001) ? pastNodeBeats : futureNodeBeats);
  if (takeLenBeats < 2 * phraseBeats && finalBeats > phraseBeats) finalBeats = phraseBeats;
  return finalBeats * oneBeatSamples;
}

const CLEAR_ALL_NOTE = 0x5b;
const CLEAR_ALL_SETTLE_MS = 1200;

async function main() {
  console.log(`[verify-quant] target=${host}, holds=${holds.join(',')}ms`);
  await pressPad(CLEAR_ALL_NOTE);
  await releasePad(CLEAR_ALL_NOTE);
  await new Promise((r) => setTimeout(r, CLEAR_ALL_SETTLE_MS));

  const results = [];
  let masterLenSamples = null;
  let recordedBeats = null;
  const tempoAnchorBpm = 120;
  console.log(`[verify-quant] tempo anchor=${tempoAnchorBpm.toFixed(1)} bpm (first take owns tempo)`);
  for (let i = 0; i < holds.length; i++) {
    const r = await recordLooper(i, holds[i]);
    if (i === 0) {
      masterLenSamples = r.wrapLenSamples;
      recordedBeats = deriveTempoQuantBeats(masterLenSamples / 48000, tempoAnchorBpm);
      const expectedSamples = (r.holdMs / 1000) * 48000;
      const errSamples = Math.abs(r.wrapLenSamples - expectedSamples);
      const errMs = (errSamples / 48000) * 1000;
      r.expectedSamples = expectedSamples;
      r.errMs = errMs;
      const injectionJitterToleranceMs = 250;
      r.pass = errMs < injectionJitterToleranceMs;
      console.log(`[verify-quant] loop0 (FIRST): held=${r.holdMs}ms expected=${r.expectedSamples.toFixed(0)}samp actual=${r.wrapLenSamples}samp err=${r.errMs.toFixed(1)}ms derivedBeats=${recordedBeats} ${r.pass ? 'PASS' : 'FAIL -- check for musical-snapping regression'}`);
    } else {
      const rawSamplesEstimate = (r.holdMs / 1000) * 48000;
      const expectedCandidate = nearCutFarExtendCandidate(rawSamplesEstimate, masterLenSamples, recordedBeats);
      const errSamples = Math.abs(r.wrapLenSamples - expectedCandidate);
      const errRatio = errSamples / expectedCandidate;
      r.expectedCandidate = expectedCandidate;
      const injectionJitterToleranceRatio = 0.05;
      r.pass = errRatio < injectionJitterToleranceRatio;
      console.log(`[verify-quant] loop${i}: held=${r.holdMs}ms M=${masterLenSamples}samp expectedCandidate=${expectedCandidate.toFixed(0)}samp actual=${r.wrapLenSamples}samp ${r.pass ? 'PASS' : 'FAIL -- possible quantization-collapse regression'}`);
    }
    results.push(r);
  }

  const allPass = results.every((r) => r.pass);
  console.log(`[verify-quant] ${allPass ? 'ALL PASS' : 'SOME FAILED'}`);
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error('[verify-quant] error:', err.message);
  process.exit(1);
});
