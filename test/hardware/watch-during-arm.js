#!/usr/bin/env node
const net = require('net');
const dgram = require('dgram');
const [, , host, looperIndexArg, holdMsArg] = process.argv;
const looperIndex = looperIndexArg ? Number(looperIndexArg) : 1;
const holdMs = holdMsArg ? Number(holdMsArg) : 3000;

function sendBytes(bytes) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port: 9401 }, () => {
      sock.write(Buffer.from(bytes), (err) => { if (err) return reject(err); sock.end(); });
    });
    sock.setTimeout(5000);
    sock.on('timeout', () => { sock.destroy(); reject(new Error('timeout')); });
    sock.on('close', resolve);
    sock.on('error', reject);
  });
}
function padNote(idx) { return idx + 2; }
function queryTelemetry() {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4');
    const timeout = setTimeout(() => { sock.close(); reject(new Error('telemetry timeout')); }, 3000);
    sock.on('message', (msg) => { clearTimeout(timeout); sock.close(); try { resolve(JSON.parse(msg.toString())); } catch (e) { reject(e); } });
    sock.on('error', (e) => { clearTimeout(timeout); reject(e); });
    sock.send('status', 4445, host);
  });
}

async function main() {
  const note = padNote(looperIndex);
  console.log(`[watch] ARM looper${looperIndex} (note ${note})`);
  await sendBytes([0x90, note, 127]);
  await sendBytes([0x80, note, 0]);
  console.log(`[watch] holding ${holdMs}ms...`);
  await new Promise((r) => setTimeout(r, holdMs));
  console.log('[watch] FINISH press');
  await sendBytes([0x90, note, 127]);
  await sendBytes([0x80, note, 0]);

  console.log('[watch] polling wraplen/readpos until it stops changing (up to 15s)...');
  let lastWrap = -1, lastReadpos = -1, stableCount = 0;
  const start = Date.now();
  while (Date.now() - start < 15000) {
    const t = await queryTelemetry();
    const w = t.loopers.wraplen[looperIndex];
    const rp = t.loopers.readpos[looperIndex];
    console.log(`[watch] t=${Date.now() - start}ms wraplen=${w} readpos=${rp}`);
    if (w === lastWrap && rp === lastReadpos) {
      stableCount++;
      if (stableCount >= 3) break;
    } else {
      stableCount = 0;
    }
    lastWrap = w; lastReadpos = rp;
    await new Promise((r) => setTimeout(r, 400));
  }
  const tf = await queryTelemetry();
  console.log(`[watch] SETTLED: wraplen[${looperIndex}]=${tf.loopers.wraplen[looperIndex]} (${(tf.loopers.wraplen[looperIndex]/48000).toFixed(4)}s)`);
}
main().catch((e) => { console.error('[watch] error:', e.message); process.exit(1); });
