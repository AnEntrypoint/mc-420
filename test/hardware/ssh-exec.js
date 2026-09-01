const { Client } = require('ssh2');

const host = process.argv[2] || '192.168.137.100';
const cmd = process.argv[3];

const conn = new Client();
conn.on('ready', () => {
  conn.exec(cmd, (err, stream) => {
    if (err) { console.error(err); conn.end(); process.exit(1); }
    let out = '';
    stream.on('data', (d) => { out += d.toString(); process.stdout.write(d.toString()); });
    stream.stderr.on('data', (d) => process.stderr.write(d.toString()));
    stream.on('close', (code) => { conn.end(); process.exit(code || 0); });
  });
});
conn.on('error', (e) => { console.error('ssh error:', e.message); process.exit(1); });
conn.connect({ host, username: 'root', password: 'aloop', readyTimeout: 10000 });
