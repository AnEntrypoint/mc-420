const { Client } = require('ssh2');

const host = process.argv[2] || '192.168.137.100';
const seconds = parseInt(process.argv[3] || '20', 10);

const conn = new Client();
conn.on('ready', () => {
  conn.exec(`timeout ${seconds} sh -c "cat /var/log/aloop/current 2>/dev/null || rc-service aloop status; journalctl -u aloop -f 2>/dev/null || true"`, (err, stream) => {
    if (err) { console.error(err); conn.end(); process.exit(1); }
    stream.on('data', (d) => process.stdout.write(d.toString()));
    stream.stderr.on('data', (d) => process.stderr.write(d.toString()));
    stream.on('close', () => { conn.end(); });
  });
});
conn.on('error', (e) => { console.error('ssh error:', e.message); process.exit(1); });
conn.connect({ host, username: 'root', password: 'aloop', readyTimeout: 10000 });
