const net = require('net');
const { Client } = require('ssh2');

const HOST = '192.168.137.100';
const MIDI_PORT = 9401;
const SHIFT = 0x62, LIVE = 0x40, LOFI = 69;

function midi(bytes) {
  return new Promise((res, rej) => {
    const s = net.connect(MIDI_PORT, HOST, () => { s.write(Buffer.from(bytes)); s.end(); });
    s.on('close', res); s.on('error', rej);
  });
}
const noteOn = (n, v = 110) => midi([0x90, n, v]);
const noteOff = (n) => midi([0x80, n, 0]);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function ssh(cmd) {
  return new Promise((res, rej) => {
    const c = new Client();
    c.on('ready', () => c.exec(cmd, (e, st) => {
      if (e) { c.end(); return rej(e); }
      let o = '';
      st.on('data', d => o += d).on('close', () => { c.end(); res(o.trim()); });
      st.stderr.on('data', () => {});
    })).on('error', rej).connect({ host: HOST, username: 'root', password: 'aloop', readyTimeout: 20000 });
  });
}

async function counters() {
  const o = await ssh("grep -c 'diag-gap' /var/log/aloop.log; grep -o '\"xruns\":[0-9]*' /run/aloop/status.json | grep -o '[0-9]*'; grep -o '\"core_busy\":\\[[^]]*\\]' /run/aloop/status.json");
  const L = o.split('\n');
  return { gaps: parseInt(L[0]) || 0, xruns: parseInt(L[1]) || 0, busy: (L[2] || '') };
}

async function shiftPress(note) {
  await noteOn(SHIFT, 127); await sleep(120);
  await noteOn(note, 127); await sleep(60); await noteOff(note); await sleep(120);
  await noteOff(SHIFT); await sleep(200);
}

async function measure(label, setup, teardown, secs) {
  await sleep(2500);
  const b = await counters();
  if (setup) await setup();
  await sleep(secs * 1000);
  const a = await counters();
  if (teardown) await teardown();
  console.log(`${label.padEnd(30)} gaps +${a.gaps - b.gaps}  xruns +${a.xruns - b.xruns}  busy=${a.busy}`);
  return { gaps: a.gaps - b.gaps, xruns: a.xruns - b.xruns };
}

const CHORD = [48, 52, 55, 60, 64, 67];

(async () => {
  const mode = process.argv[2] || 'all';
  console.log('=== engaged-CPU bench on real Pi 4 ===');

  if (mode === 'all' || mode === 'idle')
    await measure('idle (nothing engaged)', null, null, 12);

  if (mode === 'all' || mode === 'xpose') {
    await measure('MultiKey transpose + 6 keys',
      async () => { await shiftPress(LIVE); for (const n of CHORD) { await noteOn(n); await sleep(40); } },
      async () => { for (const n of CHORD) await noteOff(n); await shiftPress(LIVE); },
      15);
  }

  if (mode === 'all' || mode === 'resonode') {
    await measure('Resonode + 4 keys',
      async () => { await shiftPress(LOFI); for (const n of CHORD.slice(0, 4)) { await noteOn(n); await sleep(40); } },
      async () => { for (const n of CHORD.slice(0, 4)) await noteOff(n); await shiftPress(LOFI); },
      15);
  }
  console.log('=== done ===');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
