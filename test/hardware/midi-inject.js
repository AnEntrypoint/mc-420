#!/usr/bin/env node

const net = require('net');

const [, , host, cmd, ...rest] = process.argv;
if (!host || !cmd) {
  console.error('usage: node midi-inject.js <host> <note-on|note-off|cc|raw|hold> ...');
  process.exit(2);
}

function sendBytes(bytes) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port: 9401 }, () => {
      sock.write(Buffer.from(bytes), (err) => {
        if (err) return reject(err);
        sock.end();
      });
    });
    sock.setTimeout(5000);
    sock.on('timeout', () => { sock.destroy(); reject(new Error(`connect/write to ${host}:9401 timed out after 5s`)); });
    sock.on('close', resolve);
    sock.on('error', reject);
  });
}

async function main() {
  if (cmd === 'raw') {
    const bytes = rest.map((h) => parseInt(h, 16));
    await sendBytes(bytes);
    console.log(`[midi-inject] sent raw bytes: ${rest.join(' ')}`);
  } else if (cmd === 'note-on') {
    const [note, vel = '127', ch = '0'] = rest;
    const status = 0x90 | (parseInt(ch, 10) & 0x0f);
    await sendBytes([status, parseInt(note, 10), parseInt(vel, 10)]);
    console.log(`[midi-inject] note-on note=${note} vel=${vel} ch=${ch}`);
  } else if (cmd === 'note-off') {
    const [note, vel = '0', ch = '0'] = rest;
    const status = 0x80 | (parseInt(ch, 10) & 0x0f);
    await sendBytes([status, parseInt(note, 10), parseInt(vel, 10)]);
    console.log(`[midi-inject] note-off note=${note} vel=${vel} ch=${ch}`);
  } else if (cmd === 'cc') {
    const [controller, value, ch = '0'] = rest;
    const status = 0xb0 | (parseInt(ch, 10) & 0x0f);
    await sendBytes([status, parseInt(controller, 10), parseInt(value, 10)]);
    console.log(`[midi-inject] cc controller=${controller} value=${value} ch=${ch}`);
  } else if (cmd === 'hold') {
    const [note, ms, ch = '0'] = rest;
    const onStatus = 0x90 | (parseInt(ch, 10) & 0x0f);
    const offStatus = 0x80 | (parseInt(ch, 10) & 0x0f);
    await sendBytes([onStatus, parseInt(note, 10), 127]);
    console.log(`[midi-inject] note-on note=${note} (holding ${ms}ms)`);
    await new Promise((r) => setTimeout(r, parseInt(ms, 10)));
    await sendBytes([offStatus, parseInt(note, 10), 0]);
    console.log(`[midi-inject] note-off note=${note} (held ${ms}ms)`);
  } else {
    console.error(`unknown command: ${cmd}`);
    process.exit(2);
  }
}

main().catch((err) => {
  console.error('[midi-inject] error:', err.message);
  process.exit(1);
});
