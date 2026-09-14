#!/usr/bin/env node

const dgram = require('dgram');

function arg(name, envName, def) {
  const i = process.argv.indexOf(name);
  if (i > 0 && process.argv[i + 1]) return process.argv[i + 1];
  if (envName && process.env[envName]) return process.env[envName];
  return def;
}

const HOST = arg('--host', 'PI_HOST', '192.168.137.100');
const PORT = parseInt(arg('--port', 'PI_PORT', '4446'));
const TOKEN = arg('--token', 'PI_TOKEN', '');
const INTERVAL_MS = parseInt(arg('--interval', 'PI_LOGTAIL_INTERVAL', '1000'));

if (!TOKEN) {
  console.error('No token given. Pass --token <secret> or set PI_TOKEN, matching');
  console.error('the aloop.conf [remote] token= on the device.');
  process.exit(2);
}

const PANIC_RE = /panic|crash|kernel panic|fatal/i;
const sock = dgram.createSocket('udp4');
let buf = '';

sock.on('message', (data) => {
  const text = data.toString('utf8');
  if (!text) return;
  buf += text;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    const ts = new Date().toISOString().slice(11, 23);
    if (PANIC_RE.test(line)) {
      console.log(`[${ts}] !!! ${line}`);
    } else {
      console.log(`[${ts}] ${line}`);
    }
  }
});
sock.on('error', (err) => console.error('[logtail] socket error:', err.message));

console.log(`[logtail] polling ${HOST}:${PORT} every ${INTERVAL_MS}ms — Ctrl-C to stop`);
const msg = Buffer.from('LOGTAIL:' + TOKEN);
setInterval(() => {
  sock.send(msg, PORT, HOST, (err) => {
    if (err) console.error('[logtail] send failed:', err.message);
  });
}, INTERVAL_MS);
