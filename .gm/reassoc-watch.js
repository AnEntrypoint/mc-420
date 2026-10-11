'use strict';
const dgram = require('dgram');
const { execFile } = require('child_process');
const { promisify } = require('util');
const run = promisify(execFile);

const HOST = '192.168.137.100';
const MAC = 'e4:65:b8:77:0d:14';
const secs = Number(process.argv[2] || 900);

function pollPeers() {
  return new Promise((resolve) => {
    const s = dgram.createSocket('udp4');
    const timer = setTimeout(() => { try { s.close(); } catch (e) {} resolve(null); }, 1200);
    s.on('message', (m) => {
      clearTimeout(timer);
      try { s.close(); } catch (e) {}
      try { resolve(JSON.parse(m.toString())); } catch (e) { resolve(null); }
    });
    s.send('status', 4445, HOST);
  });
}

function station() {
  return run('node', ['.gm/exec-ssh.js', 'iw dev wlan0 station dump; echo @@; iw dev wlan0 info'],
    { cwd: 'C:/dev/mc-420', encoding: 'utf8', maxBuffer: 1 << 24 })
    .then((r) => r.stdout)
    .catch(() => '');
}

(async () => {
  const t0 = Date.now();
  const el = () => ((Date.now() - t0) / 1000).toFixed(1);
  let assoc = null;
  let peers = null;
  const events = [];
  const end = Date.now() + secs * 1000;

  while (Date.now() < end) {
    const [st, tm] = await Promise.all([station(), pollPeers()]);
    const nowAssoc = st.indexOf(MAC) >= 0;
    const nowPeers = tm ? tm.link.peers : peers;
    const apType = /type\s+(\w+)/.exec(st.split('@@')[1] || '');
    if (assoc === null) {
      events.push(el() + 's start: assoc=' + nowAssoc + ' peers=' + nowPeers + ' aptype=' + (apType ? apType[1] : '?'));
    } else {
      if (nowAssoc !== assoc) events.push(el() + 's ASSOC ' + (nowAssoc ? 'UP' : 'DOWN'));
      if (nowPeers !== peers && nowPeers !== null && peers !== null) {
        events.push(el() + 's PEERS ' + peers + '->' + nowPeers);
      }
    }
    assoc = nowAssoc;
    peers = nowPeers;
    await new Promise((r) => setTimeout(r, 2000));
  }

  console.log('reassociation watch ' + secs + 's, station ' + MAC);
  console.log('  final: assoc=' + assoc + ' peers=' + peers);
  console.log('  events:');
  for (const e of events) console.log('    ' + e);
  if (!events.length) console.log('    (no transitions)');
  process.exit(0);
})();
