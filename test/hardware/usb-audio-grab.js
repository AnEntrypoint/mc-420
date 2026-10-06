#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { Client } = require('ssh2');

const HOST = process.env.PI_HOST || '192.168.137.100';
const REC_DIR = '/media/aloop-usb/aloop-rec';
const REMOTE_SLICE = '/tmp/aloop_witness_slice.raw';
const SR = Number(process.env.WITNESS_SR || '48000');

const [, , secondsArg, outArg] = process.argv;
const seconds = Number(secondsArg || '5');
const outPath = outArg || path.join(__dirname, '..', '..', '.witness', 'slice.wav');
if (!Number.isFinite(seconds) || seconds <= 0) {
  console.error('usage: node usb-audio-grab.js <seconds> [outWav]');
  process.exit(2);
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

function getFile(conn, remote, local) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err);
      sftp.fastGet(remote, local, err2 => (err2 ? reject(err2) : resolve()));
    });
  });
}

function wavHeader(dataBytes) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + dataBytes, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(dataBytes, 40);
  return h;
}

async function main() {
  const conn = await connect();
  try {
    const wantBytes = Math.round(seconds * SR) * 2;
    const cmd = `cd ${REC_DIR} && for f in aloop_chunk_*.wav; do echo "$f $(stat -c %Y:%s "$f")"; done | sort -t' ' -k2 -r | head -1`;
    const pick = await exec(conn, cmd);
    const line = pick.out.trim().split(/\s+/);
    const name = line[0];
    const size = Number((line[1] || '').split(':')[1]);
    if (!name || !Number.isFinite(size)) throw new Error(`could not find an active chunk (${pick.out.trim()})`);
    let offset = size - wantBytes;
    if (offset < 44) offset = 44;
    const bytes = size - offset;
    await exec(conn, `tail -c +${offset + 1} ${REC_DIR}/${name} > ${REMOTE_SLICE} 2>/dev/null; stat -c %s ${REMOTE_SLICE}`);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const tmpRaw = outPath + '.raw';
    await getFile(conn, REMOTE_SLICE, tmpRaw);
    const raw = fs.readFileSync(tmpRaw);
    fs.writeFileSync(outPath, Buffer.concat([wavHeader(raw.length), raw]));
    fs.rmSync(tmpRaw);
    console.log(`[usb-grab] ${name} offset=${offset} bytes=${raw.length} -> ${outPath} (${(raw.length / 2 / SR).toFixed(3)}s)`);
  } finally {
    conn.end();
  }
}

main().catch(e => { console.error('[usb-grab] error:', e.message); process.exit(1); });
