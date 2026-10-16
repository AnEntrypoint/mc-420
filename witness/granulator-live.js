const net = require('net');
const dgram = require('dgram');

const HOST = process.argv[2] || '192.168.137.132';
const OUT = process.argv[3] || '/dev/stdout';
const LOFIFX_NOTE = 69;

function inject(bytes) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: HOST, port: 9401 }, () => {
      sock.write(Buffer.from(bytes), (e) => { if (e) reject(e); sock.end(); });
    });
    sock.setTimeout(5000);
    sock.on('timeout', () => { sock.destroy(); reject(new Error('inject timeout')); });
    sock.on('close', resolve);
    sock.on('error', reject);
  });
}
const noteOn = (n, v, ch) => inject([0x90 | (ch & 0x0f), n, v]);
const noteOff = (n, ch) => inject([0x80 | (ch & 0x0f), n, 0]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const peak = { out: 0, in: 0, n: 0 };
let lastReply = null;
const sock = dgram.createSocket('udp4');
sock.on('message', (m) => {
  try {
    const j = JSON.parse(m.toString());
    lastReply = j;
    const o = j && j.audio_peak ? j.audio_peak.out : null;
    const i = j && j.audio_peak ? j.audio_peak.in : null;
    if (typeof o === 'number') { if (o > peak.out) peak.out = o; peak.n++; }
    if (typeof i === 'number') { if (i > peak.in) peak.in = i; }
  } catch (e) { /* ignore */ }
});
setInterval(() => { sock.send(Buffer.from('status'), 0, 6, 4445, HOST, () => {}); }, 120);

async function measure(label, ms) {
  peak.out = 0; peak.in = 0; peak.n = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < ms) await sleep(60);
  return { label, peakOut: peak.out, peakIn: peak.in, polls: peak.n };
}

(async () => {
  const rows = [];
  rows.push(await measure('idle', 1500));

  await noteOn(48, 127, 1);
  rows.push(await measure('dry_key48_granulator_off', 2000));
  await noteOff(48, 1);
  await sleep(500);

  await noteOn(LOFIFX_NOTE, 127, 0);
  await sleep(150);
  await noteOff(LOFIFX_NOTE, 0);
  await sleep(700);
  rows.push(await measure('granulator_latched_no_keys', 2000));

  for (const cc of [49, 50, 51]) await inject([0xb0, cc, 100]);
  await sleep(400);
  rows.push(await measure('granulator_after_patch_knobs', 1500));

  for (const n of [36, 48, 60]) {
    await noteOn(n, 127, 1);
    rows.push(await measure('granulator_note' + n, 2500));
    await noteOff(n, 1);
    await sleep(500);
  }

  await noteOn(LOFIFX_NOTE, 127, 0);
  await sleep(150);
  await noteOff(LOFIFX_NOTE, 0);
  await sleep(700);
  rows.push(await measure('granulator_unlatched_idle', 1500));

  sock.close();
  const lines = ['host=' + HOST];
  if (lastReply) {
    lines.push('xruns=' + (lastReply.xruns !== undefined ? lastReply.xruns : '?'));
    lines.push('core_busy=' + JSON.stringify(lastReply.core_busy));
    lines.push('latency_bias_samples=' + (lastReply.latency_bias_samples !== undefined ? lastReply.latency_bias_samples : '?'));
  }
  for (const r of rows) lines.push(`${r.label} peakOut=${r.peakOut.toFixed(6)} peakIn=${r.peakIn.toFixed(6)} polls=${r.polls}`);
  const text = lines.join('\n') + '\n';
  require('fs').appendFileSync(OUT, text);
  console.log(text);
  process.exit(0);
})().catch((e) => { console.error('FAIL ' + e.message); process.exit(1); });
