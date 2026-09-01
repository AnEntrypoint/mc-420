#!/usr/bin/env node
const { Client } = require('ssh2');
const fs = require('fs');

const [, , host, localPath] = process.argv;
if (!host || !localPath) {
  console.error('usage: node deploy-binary.js <host> <local-aloop-binary-path>');
  process.exit(2);
}

const conn = new Client();

function execP(cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = '', errOut = '';
      stream
        .on('close', (code) => resolve({ code, out, errOut }))
        .on('data', (d) => (out += d.toString()))
        .stderr.on('data', (d) => (errOut += d.toString()));
    });
  });
}

conn
  .on('ready', async () => {
    try {
      console.log('[deploy] stopping aloop service...');
      let r = await execP('rc-service aloop stop');
      console.log(r.out, r.errOut);

      console.log('[deploy] uploading binary via sftp...');
      await new Promise((resolve, reject) => {
        conn.sftp((err, sftp) => {
          if (err) return reject(err);
          sftp.fastPut(localPath, '/opt/aloop/aloop', {}, (err2) => {
            if (err2) return reject(err2);
            resolve();
          });
        });
      });

      console.log('[deploy] chmod +x...');
      r = await execP('chmod +x /opt/aloop/aloop');
      console.log(r.out, r.errOut);

      console.log('[deploy] md5sum on device...');
      r = await execP('md5sum /opt/aloop/aloop');
      console.log(r.out);

      console.log('[deploy] starting aloop service...');
      r = await execP('rc-service aloop start');
      console.log(r.out, r.errOut);

      console.log('[deploy] checking status...');
      r = await execP('sleep 2; rc-service aloop status; cat /proc/uptime');
      console.log(r.out, r.errOut);

      conn.end();
      process.exitCode = 0;
    } catch (e) {
      console.error('[deploy] FAILED:', e.message);
      conn.end();
      process.exitCode = 1;
    }
  })
  .on('error', (err) => {
    console.error('[deploy] connection error:', err.message);
    process.exitCode = 1;
  })
  .connect({ host, username: 'root', password: 'aloop', readyTimeout: 15000 });
