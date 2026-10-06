#!/usr/bin/env node
const { Client } = require('ssh2');

const HOST = process.env.PI_HOST || '192.168.137.100';
const REMOTE_TONE = '/tmp/aloop_witness_tone.raw';
const REMOTE_FEEDER = '/tmp/aloop_witness_feeder.sh';

const [, , cmd, ...rest] = process.argv;
const opts = {};
for (const a of rest) {
  const [k, v] = a.split('=');
  opts[k.replace(/^--/, '')] = v === undefined ? true : v;
}

const freq = Number(opts.freq || '110');
const secs = Number(opts.secs || '120');
const amp = Number(opts.amp || '0.5');
const ossRate = 8000;
const ossNode = opts.node || '/dev/dsp3';

function makeTone() {
  const n = Math.round(ossRate * secs);
  const b = Buffer.alloc(n);
  for (let i = 0; i < n; i++) {
    const v = amp * Math.sin((2 * Math.PI * freq * i) / ossRate);
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
  const conn = await connect();
  try {
    if (cmd === 'start') {
      const buf = makeTone();
      await putBuffer(conn, REMOTE_TONE, buf);
      await putBuffer(conn, REMOTE_FEEDER, Buffer.from(
        `#!/bin/sh\nwhile :; do cat ${REMOTE_TONE}; done\n`));
      await exec(conn, `chmod +x ${REMOTE_FEEDER}`);
      await exec(conn, `pkill -f aloop_witness_feeder`);
      const r = await exec(conn, `nohup sh -c '${REMOTE_FEEDER} > ${ossNode} 2>/dev/null' >/dev/null 2>&1 & sleep 1; echo ok`);
      console.log(`[inject-tone] ${freq}Hz amp=${amp} ${secs}s u8@${ossRate} -> ${ossNode} (${buf.length} bytes) ${r.out.trim()}`);
    } else if (cmd === 'stop') {
      const r = await exec(conn, `pkill -f aloop_witness_feeder; pkill -f 'cat ${REMOTE_TONE}'; echo stopped`);
      console.log(`[inject-tone] ${(r.out + r.errOut).trim()}`);
    } else {
      console.error('usage: node inject-tone.js <start|stop> [--freq=110] [--secs=120] [--amp=0.5]');
      process.exit(2);
    }
  } finally {
    conn.end();
  }
}

main().catch(e => { console.error('[inject-tone] error:', e.message); process.exit(1); });
