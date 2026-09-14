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

async function recordLooper(looperIndex, holdMs) {
  const note = padNote(looperIndex);
  console.log(`[verify-quant] looper${looperIndex}: ARM (note ${note}), holding ${holdMs}ms`);
  await pressPad(note);
  await new Promise((r) => setTimeout(r, holdMs));
  console.log(`[verify-quant] looper${looperIndex}: FINISH`);
  await releasePad(note);
  await new Promise((r) => setTimeout(r, 500));
  const t = await queryTelemetry();
  const wrapLenSamples = t.loopers.wraplen[looperIndex];
  const wrapLenSeconds = wrapLenSamples / 48000;
  return { holdMs, wrapLenSamples, wrapLenSeconds };
}

function ceilingPow2Candidate(effectiveSamples, masterLenSamples) {
  const gridPickEps = 0.0001;
  const log2Ratio = Math.log2(effectiveSamples / masterLenSamples);
  let lowerExp = Math.floor(log2Ratio + gridPickEps);
  if (lowerExp < -4.0) lowerExp = -4.0;
  const lowerCand = masterLenSamples * Math.pow(2, lowerExp);
  const upperCand = masterLenSamples * Math.pow(2, lowerExp + 1);
  return lowerCand >= effectiveSamples ? lowerCand : upperCand;
}

async function main() {
  console.log(`[verify-quant] target=${host}, holds=${holds.join(',')}ms`);
  console.log('[verify-quant] WARNING: assumes a clear rig already exists -- run clear-all yourself first if unsure.');

  const results = [];
  let masterLenSamples = null;
  for (let i = 0; i < holds.length; i++) {
    const r = await recordLooper(i, holds[i]);
    if (i === 0) {
      masterLenSamples = r.wrapLenSamples;
      const expectedSamples = (r.holdMs / 1000) * 48000;
      const errSamples = Math.abs(r.wrapLenSamples - expectedSamples);
      const errMs = (errSamples / 48000) * 1000;
      r.expectedSamples = expectedSamples;
      r.errMs = errMs;
      const injectionJitterToleranceMs = 250;
      r.pass = errMs < injectionJitterToleranceMs;
      console.log(`[verify-quant] loop0 (FIRST): held=${r.holdMs}ms expected=${r.expectedSamples.toFixed(0)}samp actual=${r.wrapLenSamples}samp err=${r.errMs.toFixed(1)}ms ${r.pass ? 'PASS' : 'FAIL -- check for musical-snapping regression'}`);
    } else {
      const rawSamplesEstimate = (r.holdMs / 1000) * 48000;
      const expectedCandidate = ceilingPow2Candidate(rawSamplesEstimate, masterLenSamples);
      const errSamples = Math.abs(r.wrapLenSamples - expectedCandidate);
      const errRatio = errSamples / expectedCandidate;
      r.expectedCandidate = expectedCandidate;
      r.pass = errRatio < 0.05;   // 5% tolerance for injection-side timing jitter
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
