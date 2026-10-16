const { execFile, spawn } = require('child_process');
const net = require('net');
const dgram = require('dgram');
const fs = require('fs');

const PI = process.argv[2] || '192.168.137.132';
const WAV = process.argv[3] || '/config/workspace/mc-420/test-audio-corpus/instruments/cello_low_sulC_A2.wav';
const MODE = process.argv[4] || 'granulator';
const OUT = process.argv[5] || '/dev/stdout';

const SINK = process.env.SCARLETT_SINK
  || 'alsa_output.usb-Focusrite_Scarlett_18i8_USB_F9TY0AQ9602F96-00.analog-surround-71';

const LOFIFX_NOTE = 69;
const SHIFT_NOTE = 98;

function inject(bytes) {
  return new Promise((resolve, reject) => {
    const s = net.connect({ host: PI, port: 9401 }, () => {
      s.write(Buffer.from(bytes), (e) => { if (e) reject(e); s.end(); });
    });
    s.setTimeout(5000);
    s.on('timeout', () => { s.destroy(); reject(new Error('inject timeout')); });
    s.on('close', resolve);
    s.on('error', reject);
  });
}
const noteOn = (n, v, ch) => inject([0x90 | (ch & 0x0f), n, v]);
const noteOff = (n, ch) => inject([0x80 | (ch & 0x0f), n, 0]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const peak = { out: 0, in: 0, n: 0 };
let last = null;
const sock = dgram.createSocket('udp4');
sock.on('message', (m) => {
  try {
    const j = JSON.parse(m.toString());
    last = j;
    const o = j && j.audio_peak ? j.audio_peak.out : null;
    const i = j && j.audio_peak ? j.audio_peak.in : null;
    if (typeof o === 'number' && o > peak.out) peak.out = o;
    if (typeof i === 'number' && i > peak.in) peak.in = i;
    if (typeof o === 'number') peak.n++;
  } catch (e) { /* ignore */ }
});
const poll = setInterval(() => sock.send(Buffer.from('status'), 0, 6, 4445, PI, () => {}), 120);

async function measure(label, ms) {
  peak.out = 0; peak.in = 0; peak.n = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < ms) await sleep(60);
  return `${label} peakOut=${peak.out.toFixed(6)} peakIn=${peak.in.toFixed(6)} polls=${peak.n}`;
}

(async () => {
  const rows = [];
  rows.push(await measure('silence_baseline', 2000));

  const player = spawn('sh', ['-c',
    `pactl set-sink-volume "${SINK}" 100% 2>/dev/null; ` +
    `for i in 1 2 3 4 5 6 7 8 9 10; do paplay -d "${SINK}" "${WAV}" 2>/dev/null; done`],
    { stdio: 'ignore' });

  await sleep(1500);
  rows.push(await measure('tone_playing_dry', 2500));

  if (MODE === 'granulator') {
    await noteOn(LOFIFX_NOTE, 127, 0); await sleep(150); await noteOff(LOFIFX_NOTE, 0);
    await sleep(700);
    for (const n of [36, 48, 60]) {
      await noteOn(n, 127, 1);
      rows.push(await measure('granulator_note' + n, 2500));
      await noteOff(n, 1); await sleep(400);
    }
    await noteOn(LOFIFX_NOTE, 127, 0); await sleep(150); await noteOff(LOFIFX_NOTE, 0);
  } else {
    await noteOn(SHIFT_NOTE, 127, 0); await sleep(120);
    await noteOn(LOFIFX_NOTE, 127, 0); await sleep(120);
    await noteOff(LOFIFX_NOTE, 0); await sleep(120); await noteOff(SHIFT_NOTE, 0);
    await sleep(700);
    for (const n of [36, 48, 60]) {
      await noteOn(n, 127, 1);
      rows.push(await measure('resonode_note' + n, 2500));
      await noteOff(n, 1); await sleep(400);
    }
    await noteOn(SHIFT_NOTE, 127, 0); await sleep(120);
    await noteOn(LOFIFX_NOTE, 127, 0); await sleep(120);
    await noteOff(LOFIFX_NOTE, 0); await sleep(120); await noteOff(SHIFT_NOTE, 0);
  }

  try { player.kill(); } catch (e) { /* ignore */ }
  try { execFile('pkill', ['-f', 'paplay']); } catch (e) { /* ignore */ }
  clearInterval(poll); sock.close();

  const lines = [
    `host=${PI}`,
    `mode=${MODE}`,
    `source=${WAV}`,
    `scarlett_sink=${SINK}`,
    last ? `xruns=${last.xruns}` : 'xruns=?',
    last ? `core_busy=${JSON.stringify(last.core_busy)}` : '',
    last ? `latency_bias_samples=${last.latency_bias_samples}` : '',
  ];
  for (const r of rows) lines.push(r);
  const text = lines.join('\n') + '\n';
  fs.appendFileSync(OUT, text);
  console.log(text);
  process.exit(0);
})().catch((e) => { console.error('FAIL ' + e.message); process.exit(1); });
