'use strict';
const fs = require('fs');
const { Client } = require('C:/dev/mc-420/node_modules/ssh2');

const HOST = process.env.ALOOP_PI_HOST || '192.168.137.132';
const remote = process.argv[2] || '/media/aloop-usb/aloop-rec/aloop_chunk_04.wav';
const outPath = process.argv[3] || 'C:/dev/mc-420/.gm/usbrec-slice.wav';
const byteOffset = Number(process.argv[4] || 54720000);
const byteCount = Number(process.argv[5] || 960000);

function run(conn, cmd) {
  return new Promise((resolve) => {
    conn.exec(cmd, (err, stream) => {
      if (err) { resolve('[exec error] ' + err.message); return; }
      let out = '';
      let erro = '';
      stream.on('close', () => resolve(out + (erro ? '\n[stderr] ' + erro : '')));
      stream.on('data', (d) => { out += d.toString(); });
      stream.stderr.on('data', (d) => { erro += d.toString(); });
    });
  });
}

const conn = new Client();
conn.on('ready', async () => {
  const cmds = [
    'dd if=' + remote + ' of=/tmp/hdr.bin bs=44 count=1 2>/dev/null',
    'dd if=' + remote + ' of=/tmp/slice.raw bs=' + byteCount + ' count=1 skip=' + Math.floor(byteOffset / byteCount) + ' 2>/dev/null',
    'cat /tmp/hdr.bin /tmp/slice.raw > /tmp/slice.wav',
    'ls -la /tmp/slice.wav /tmp/hdr.bin /tmp/slice.raw',
    'head -c 44 /tmp/hdr.bin | od -A d -t u1 -N 44 | head -4',
  ];
  for (const c of cmds) {
    console.log('=== ' + c.slice(0, 70) + ' ===');
    console.log((await run(conn, c)).trim());
  }
  const sftp = await new Promise((res, rej) => conn.sftp((e, s) => (e ? rej(e) : res(s))));
  await new Promise((res, rej) => {
    sftp.fastGet('/tmp/slice.wav', outPath, (e) => (e ? rej(e) : res()));
  });
  console.log('downloaded -> ' + outPath + ' (' + fs.statSync(outPath).size + ' bytes)');
  conn.end();
});
conn.on('error', (e) => { console.log('[ssh error] ' + e.message); process.exit(1); });
conn.connect({ host: HOST, port: 22, username: 'root', password: 'aloop', readyTimeout: 20000 });
