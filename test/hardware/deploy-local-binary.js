#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { Client } = require('ssh2');

const [, , localPath, hostArg] = process.argv;
const HOST = hostArg || process.env.PI_HOST || '192.168.137.100';
const REMOTE_BIN = '/opt/aloop/aloop';

if (!localPath) {
  console.error('usage: node deploy-local-binary.js <localBinary> [host]');
  process.exit(2);
}
if (!fs.statSync(localPath).isFile()) {
  console.error(`[deploy-local] not a file: ${localPath}`);
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

function exec(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = '', errOut = '';
      stream.on('close', code => resolve({ code, out, errOut }));
      stream.on('data', d => { out += d.toString(); });
      stream.stderr.on('data', d => { errOut += d.toString(); });
    });
  });
}

function put(conn, local, remote) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err);
      sftp.fastPut(local, remote, err2 => (err2 ? reject(err2) : resolve()));
    });
  });
}

async function main() {
  const conn = await connect();
  try {
    const tmp = `${REMOTE_BIN}.new`;
    await exec(conn, `rm -f ${tmp}`);
    await put(conn, localPath, tmp);
    await exec(conn, `chmod +x ${tmp} && mv -f ${tmp} ${REMOTE_BIN} && sync`);
    await exec(conn, 'rc-service aloop restart');
    await new Promise((r) => setTimeout(r, 5000));
    const md5 = await exec(conn, `md5sum ${REMOTE_BIN}`);
    const st = await exec(conn, 'rc-service aloop status; cat /proc/uptime');
    console.log(`[deploy-local] ${path.basename(localPath)} -> ${REMOTE_BIN}`);
    console.log(`[deploy-local] ${md5.out.trim()}`);
    console.log(`[deploy-local] ${(st.out + st.errOut).trim()}`);
  } finally {
    conn.end();
  }
}

main().catch((e) => { console.error('[deploy-local] error:', e.message); process.exit(1); });
