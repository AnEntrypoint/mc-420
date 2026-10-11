'use strict';
const { Client } = require('C:/dev/mc-420/node_modules/ssh2');

const HOST = '192.168.137.100';
const SRC = '/opt/aloop/' + (process.argv[2] || 'aloop.fixed');
const REMOTE = '/opt/aloop/aloop';

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

(async () => {
  const conn = await connect();
  try {
    const pre = await exec(conn, 'md5sum ' + SRC + ' ' + REMOTE);
    console.log('--- BEFORE ---\n' + (pre.out + pre.errOut).trim());
    const res = await exec(conn,
      'cp ' + SRC + ' ' + REMOTE + ' && chmod +x ' + REMOTE + ' && sync && rc-service aloop restart');
    console.log('--- SWAP ---\n' + (res.out + res.errOut).trim() + '\nexit=' + res.code);
    await new Promise((r) => setTimeout(r, 8000));
    const post = await exec(conn, 'md5sum ' + REMOTE + ' ; rc-service aloop status ; tail -n 8 /var/log/aloop.log');
    console.log('--- AFTER ---\n' + (post.out + post.errOut).trim());
  } finally {
    conn.end();
  }
})().catch((e) => { console.error('deploy error:', e.message); process.exit(1); });
