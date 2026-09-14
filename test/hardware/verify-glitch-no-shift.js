#!/usr/bin/env node
const net = require('net');
const dgram = require('dgram');

const [, , host] = process.argv;
if (!host) {
  console.error('usage: node verify-glitch-no-shift.js <host>');
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

const MICROREPEAT_DIVISION_1_NOTE = 82;

async function main() {
  console.log(`[verify-glitch] target=${host}`);

  console.log('[verify-glitch] querying baseline telemetry...');
  const before = await queryTelemetry();
  console.log(`[verify-glitch] baseline: monitor_mode=${before.monitor_mode}, glitch_engaged=${before.glitch_engaged}`);
  if (before.monitor_mode || before.glitch_engaged) {
    console.warn('[verify-glitch] WARNING: baseline is not at rest (SHIFT or glitch already engaged) -- results below may be affected by pre-existing state.');
  }

  console.log(`[verify-glitch] engaging microrepeat (note ${MICROREPEAT_DIVISION_1_NOTE}) WITHOUT touching SHIFT...`);
  await sendBytes([0x90, MICROREPEAT_DIVISION_1_NOTE, 127]);
  await new Promise((r) => setTimeout(r, 300));

  const during = await queryTelemetry();
  console.log(`[verify-glitch] while engaged: monitor_mode=${during.monitor_mode}, glitch_engaged=${during.glitch_engaged}`);

  console.log(`[verify-glitch] releasing microrepeat (note ${MICROREPEAT_DIVISION_1_NOTE})...`);
  await sendBytes([0x80, MICROREPEAT_DIVISION_1_NOTE, 0]);
  await new Promise((r) => setTimeout(r, 300));

  const after = await queryTelemetry();
  console.log(`[verify-glitch] after release: monitor_mode=${after.monitor_mode}, glitch_engaged=${after.glitch_engaged}`);

  const glitchEngagedWithoutShift = during.glitch_engaged === true && during.monitor_mode === false;
  const glitchClearedOnRelease = after.glitch_engaged === false;

  console.log('[verify-glitch] === VERDICT ===');
  if (glitchEngagedWithoutShift && glitchClearedOnRelease) {
    console.log('[verify-glitch] PASS: glitch_engaged reached true WITHOUT SHIFT held, and cleared correctly on release. The CONTROL-SURFACE/STATE path is confirmed independent of SHIFT, matching the confirmed design intent.');
    console.log('[verify-glitch] NOTE: this does not verify the AUDIBLE/recorded content itself -- if the bug persists despite this passing, the remaining gap is in the audio signal routing (dsp/aloop.dsp), not this control-surface dispatch.');
    process.exit(0);
  } else {
    console.log('[verify-glitch] FAIL:');
    if (!glitchEngagedWithoutShift) console.log(`  - glitch_engaged did not reach true-without-SHIFT as expected (got glitch_engaged=${during.glitch_engaged}, monitor_mode=${during.monitor_mode})`);
    if (!glitchClearedOnRelease) console.log(`  - glitch_engaged did not clear on release (got ${after.glitch_engaged})`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[verify-glitch] error:', err.message);
  process.exit(1);
});
