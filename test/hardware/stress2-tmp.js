const net = require('net');
const { Client } = require('ssh2');
const HOST = '192.168.137.100', SHIFT = 0x62, LOFI = 69;

const midi = b => new Promise((r, j) => { const s = net.connect(9401, HOST, () => { s.write(Buffer.from(b)); s.end(); }); s.on('close', r); s.on('error', j); });
const on = (n, v = 110) => midi([0x90, n, v]);
const off = n => midi([0x80, n, 0]);
const sl = m => new Promise(r => setTimeout(r, m));

function ssh(c) {
  return new Promise((res, rej) => {
    const cl = new Client();
    cl.on('ready', () => cl.exec(c, (e, st) => {
      if (e) { cl.end(); return rej(e); }
      let o = ''; st.on('data', d => o += d).on('close', () => { cl.end(); res(o.trim()); }); st.stderr.on('data', () => {});
    })).on('error', rej).connect({ host: HOST, username: 'root', password: 'aloop', readyTimeout: 20000 });
  });
}

async function stats() {
  const o = await ssh("grep -c 'diag-gap' /var/log/aloop.log; cat /run/aloop/status.json");
  const lines = o.split('\n');
  const gaps = parseInt(lines[0]) || 0;
  const json = lines.slice(1).join('');
  let xruns = 0, busy = 0;
  try { const j = JSON.parse(json); xruns = j.xruns; busy = Math.max(...j.core_busy); } catch (e) {}
  return { gaps, xruns, busy };
}

const shiftPress = async n => { await on(SHIFT, 127); await sl(120); await on(n, 127); await sl(60); await off(n); await sl(120); await off(SHIFT); await sl(250); };

(async () => {
  const notes = [36, 43, 48, 52, 55, 60, 64, 67];
  await shiftPress(LOFI); await sl(900);
  for (const n of notes) { await on(n); await sl(25); }
  await sl(1500);
  const b = await stats();
  let peak = 0;
  for (let i = 0; i < 10; i++) { const s = await stats(); peak = Math.max(peak, s.busy); await sl(600); }
  const a = await stats();
  for (const n of notes) await off(n);
  await shiftPress(LOFI);
  console.log(`STRESS resonode + 8 keys: gaps+${a.gaps - b.gaps} xruns+${a.xruns - b.xruns} peak_busy=${peak}%`);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
