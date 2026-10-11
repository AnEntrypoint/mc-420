'use strict';
const fs = require('fs');
const { Client } = require('C:/dev/mc-420/node_modules/ssh2');

const kHost = '192.168.137.100';
const kSampleRate = 48000;
const kBytesPerSample = 2;

const chunkIndex = Number(process.argv[2] || 4);
const offsetSec = Number(process.argv[3] || 1140);
const seconds = Number(process.argv[4] || 10);
const outPath = process.argv[5] || 'C:/dev/mc-420/.gm/usbrec-slice.wav';

const remote = '/media/aloop-usb/aloop-rec/aloop_chunk_' + String(chunkIndex).padStart(2, '0') + '.wav';
const byteOffset = offsetSec * kSampleRate * kBytesPerSample;
const byteCount = seconds * kSampleRate * kBytesPerSample;

function run(conn, cmd) {
  return new Promise((resolve) => {
    conn.exec(cmd, (err, stream) => {
      if (err) { resolve('[exec error] ' + err.message); return; }
      let out = '';
      let erro = '';
      stream.on('close', () => resolve(out + (erro ? '[stderr] ' + erro : '')));
      stream.on('data', (d) => { out += d.toString(); });
      stream.stderr.on('data', (d) => { erro += d.toString(); });
    });
  });
}

const conn = new Client();
conn.on('ready', async () => {
  console.log('chunk ' + remote + ' offset ' + offsetSec + 's length ' + seconds + 's');
  const listing = await run(conn, 'ls -la ' + remote);
  console.log(listing.trim());
  const built = await run(conn,
    'dd if=' + remote + ' of=/tmp/hdr.bin bs=44 count=1 2>/dev/null;' +
    'dd if=' + remote + ' of=/tmp/slice.raw bs=' + byteCount + ' count=1 skip=' + Math.floor(byteOffset / byteCount) + ' 2>/dev/null;' +
    'cat /tmp/hdr.bin /tmp/slice.raw > /tmp/slice.wav;' +
    'ls -la /tmp/slice.wav');
  console.log(built.trim());
  const sftp = await new Promise((res, rej) => conn.sftp((e, s) => (e ? rej(e) : res(s))));
  await new Promise((res, rej) => sftp.fastGet('/tmp/slice.wav', outPath, (e) => (e ? rej(e) : res())));
  console.log('downloaded ' + fs.statSync(outPath).size + ' bytes -> ' + outPath);
  conn.end();
});
conn.on('error', (e) => { console.log('[ssh error] ' + e.message); process.exit(1); });
conn.connect({ host: kHost, port: 22, username: 'root', password: 'aloop', readyTimeout: 20000 });
