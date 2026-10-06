#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { Client } = require('ssh2');

const HOST = process.env.PI_HOST || '192.168.137.100';
const REMOTE_TONE = '/tmp/aloop_witness_tone.raw';
const REMOTE_FEEDER = '/tmp/aloop_witness_feeder.sh';
const OSS_RATE = 8000;

const [, , wavArg, nodeArg, gainArg] = process.argv;
if (!wavArg) {
  console.error('usage: node inject-corpus.js <wav> [ossNode] [gain]');
  process.exit(2);
}
const ossNode = nodeArg || '/dev/dsp2';
const gain = Number(gainArg || '0.5');

function readWav(file) {
  const b = fs.readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`${file} is not a RIFF/WAVE file`);
  }
  let off = 12;
  let fmt = null;
  let data = null;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4);
    const size = b.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ') {
      fmt = {
        format: b.readUInt16LE(body),
        channels: b.readUInt16LE(body + 2),
        rate: b.readUInt32LE(body + 4),
        bits: b.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      data = b.subarray(body, body + size);
    }
    off = body + size + (size % 2);
  }
  if (!fmt || !data) throw new Error(`${file}: no fmt/data chunk`);
  if (fmt.format !== 1 || fmt.bits !== 16) throw new Error(`${file}: need 16-bit PCM, got fmt=${fmt.format} bits=${fmt.bits}`);
  const n = Math.floor(data.length / 2 / fmt.channels);
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < fmt.channels; c++) s += data.readInt16LE((i * fmt.channels + c) * 2) / 32768;
    mono[i] = s / fmt.channels;
  }
  return { mono, rate: fmt.rate };
}

function decimate(src, srcRate, dstRate) {
  const r = Math.round(srcRate / dstRate);
  if (r < 1) throw new Error(`cannot decimate ${srcRate} -> ${dstRate}`);
  const out = new Float32Array(Math.floor(src.length / r));
  const win = r * 4;
  for (let i = 0; i < out.length; i++) {
    const start = i * r - Math.floor(win / 2);
    let acc = 0;
    let cnt = 0;
    for (let k = 0; k < win; k++) {
      const j = start + k;
      if (j >= 0 && j < src.length) { acc += src[j]; cnt++; }
    }
    out[i] = cnt ? acc / cnt : 0;
  }
  return out;
}

function toU8(sig, g) {
  const b = Buffer.alloc(sig.length);
  let peak = 0;
  for (let i = 0; i < sig.length; i++) peak = Math.max(peak, Math.abs(sig[i]));
  const norm = peak > 0 ? g / peak : 0;
  for (let i = 0; i < sig.length; i++) {
    const v = Math.max(-1, Math.min(1, sig[i] * norm));
    b[i] = Math.max(0, Math.min(255, Math.round(128 + 127 * v)));
  }
  return b;
}

function connect() {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => resolve(conn));
    conn.on('error', reject);
    conn.connect({ host: HOST, username: 'root', password: 'aloop', readyTimeout: 20000 });
  });
}

function exec(conn, c) {
  return new Promise((resolve, reject) => {
    conn.exec(c, (err, stream) => {
      if (err) return reject(err);
      let out = '', errOut = '';
      stream.on('close', code => resolve({ code, out, errOut }));
      stream.on('data', d => { out += d.toString(); });
      stream.stderr.on('data', d => { errOut += d.toString(); });
    });
  });
}

function putBuffer(conn, remote, buf) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err);
      const ws = sftp.createWriteStream(remote);
      ws.on('close', resolve);
      ws.on('error', reject);
      ws.end(buf);
    });
  });
}

async function main() {
  const { mono, rate } = readWav(wavArg);
  const dec = decimate(mono, rate, OSS_RATE);
  const buf = toU8(dec, gain);
  const conn = await connect();
  try {
    await putBuffer(conn, REMOTE_TONE, buf);
    await exec(conn, `printf '%s\n' '#!/bin/sh' 'while :; do cat ${REMOTE_TONE} > ${ossNode} 2>/dev/null; sleep 0.2; done' > ${REMOTE_FEEDER}`);
    await exec(conn, `chmod +x ${REMOTE_FEEDER}`);
    const r = await exec(conn, `nohup sh -c '${REMOTE_FEEDER}' >/dev/null 2>&1 & sleep 2; echo started`);
    console.log(`[inject-corpus] ${path.basename(wavArg)} ${rate}Hz ${mono.length} samples -> ${OSS_RATE}Hz ${buf.length} bytes -> ${ossNode} (${(buf.length / OSS_RATE).toFixed(2)}s) ${r.out.trim()}`);
  } finally {
    conn.end();
  }
}

main().catch(e => { console.error('[inject-corpus] error:', e.message); process.exit(1); });
