#!/usr/bin/env node
const net = require('net');
const dgram = require('dgram');

const [, , host, looperIndexArg, holdMsArg] = process.argv;
const looperIndex = looperIndexArg ? Number(looperIndexArg) : 3;
const holdMs = holdMsArg ? Number(holdMsArg) : 2000;

function sendBytes(bytes) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port: 9401 }, () => {
      sock.write(Buffer.from(bytes), (err) => {
        if (err) return reject(err);
        sock.end();
      });
    });
    sock.setTimeout(5000);
    sock.on('timeout', () => { sock.destroy(); reject(new Error('timeout')); });
    sock.on('close', resolve);
    sock.on('error', reject);
  });
}

function padNote(idx) {
  const row = 0, col = idx + 2;
  return row * 8 + col;
}

function queryTelemetry() {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4');
    const timeout = setTimeout(() => { sock.close(); reject(new Error('telemetry query timed out')); }, 3000);
    sock.on('message', (msg) => {
      clearTimeout(timeout);
      sock.close();
      try { resolve(JSON.parse(msg.toString())); }
      catch (e) { reject(e); }
    });
    sock.on('error', (e) => { clearTimeout(timeout); reject(e); });
    sock.send('status', 4445, host);
  });
}

async function main() {
  const note = padNote(looperIndex);
  console.log(`[armcycle] target=${host} looper=${looperIndex} note=${note} holdMs=${holdMs}`);

  console.log('[armcycle] PRESS 1 (ARM) -- note-on');
  await sendBytes([0x90, note, 127]);
  const t0 = await queryTelemetry();
  console.log('[armcycle] after ARM: rec=' + t0.loopers.rec + ' wraplen[' + looperIndex + ']=' + t0.loopers.wraplen[looperIndex]);
  console.log('[armcycle] RELEASE 1 -- note-off (should be a no-op per m_looperArmedOnPress)');
  await sendBytes([0x80, note, 0]);

  console.log(`[armcycle] holding ${holdMs}ms...`);
  await new Promise((r) => setTimeout(r, holdMs));

  console.log('[armcycle] PRESS 2 (FINISH) -- note-on');
  await sendBytes([0x90, note, 127]);
  await new Promise((r) => setTimeout(r, 300));
  console.log('[armcycle] RELEASE 2 -- note-off');
  await sendBytes([0x80, note, 0]);

  await new Promise((r) => setTimeout(r, 800));
  const t1 = await queryTelemetry();
  const wrapLenSamples = t1.loopers.wraplen[looperIndex];
  const wrapLenSeconds = wrapLenSamples / 48000;
  console.log(`[armcycle] FINAL: rec=${t1.loopers.rec} wraplen[${looperIndex}]=${wrapLenSamples} (${wrapLenSeconds.toFixed(4)}s) recordedBpm=${t1.link.bpm} synced=${t1.link.synced}`);
  console.log(`[armcycle] expected ~${(holdMs / 1000).toFixed(3)}s of content (grid-quantized up if non-first looper)`);
}

main().catch((err) => { console.error('[armcycle] error:', err.message); process.exit(1); });
