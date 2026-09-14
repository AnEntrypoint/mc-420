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

if (!TOKEN) {
  console.error('No token given. Pass --token <secret> or set PI_TOKEN, matching');
  console.error('the aloop.conf [remote] token= on the device. Without it the');
  console.error('device-side listener is disabled and this will do nothing.');
  process.exit(2);
}

const msg = Buffer.from('REBOOT:' + TOKEN);
const sock = dgram.createSocket('udp4');
sock.send(msg, PORT, HOST, (err) => {
  if (err) { console.error('[reboot] send failed:', err.message); process.exit(1); }
  console.log(`[reboot] REBOOT sent to ${HOST}:${PORT}`);
  sock.close();
});
