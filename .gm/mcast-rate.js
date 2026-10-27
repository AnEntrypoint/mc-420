'use strict';
const { Client } = require('C:/dev/mc-420/node_modules/ssh2');
const GAP_MS = Number(process.argv[2] || '5000');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ssh(cmd) {
  return new Promise((resolve) => {
    const conn = new Client();
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); try { conn.end(); } catch (e) {} } };
    conn.on('ready', () => {
      conn.exec(cmd, (err, stream) => {
        if (err) { finish('[ssh err] ' + err.message); return; }
        let out = '';
        stream.on('close', () => finish(out));
        stream.on('data', (d) => { out += d.toString(); });
        stream.stderr.on('data', (d) => { out += d.toString(); });
      });
    });
    conn.on('error', (e) => finish('[ssh error] ' + e.message));
    setTimeout(() => finish('[ssh timeout]'), 15000);
    conn.connect({ host: process.env.ALOOP_PI_HOST || '192.168.137.132', port: 22, username: 'root', password: 'aloop', readyTimeout: 15000 });
  });
}

function wlanMcast(txt) {
  const line = txt.split('\n').find((l) => l.trim().startsWith('wlan0:'));
  if (!line) return NaN;
  const f = line.trim().split(/\s+/);
  return { rxBytes: Number(f[1]), rxPackets: Number(f[2]), mcast: Number(f[8]) };
}

function snmpField(txt, header, key) {
  const lines = txt.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith(header)) continue;
    const keys = lines[i].trim().split(/\s+/).slice(1);
    const vals = (lines[i + 1] || '').trim().split(/\s+/).slice(1);
    const k = keys.indexOf(key);
    if (k >= 0 && k < vals.length) return Number(vals[k]);
  }
  return NaN;
}

(async () => {
  const a = await ssh('cat /proc/net/dev; echo ===; cat /proc/net/snmp');
  await sleep(GAP_MS);
  const b = await ssh('cat /proc/net/dev; echo ===; cat /proc/net/snmp');
  const [devA, snmpA] = a.split('===');
  const [devB, snmpB] = b.split('===');
  const wa = wlanMcast(devA), wb = wlanMcast(devB);
  const secs = GAP_MS / 1000;
  console.log('wlan0 rx-packets/s   ' + ((wb.rxPackets - wa.rxPackets) / secs).toFixed(1));
  console.log('wlan0 rx-multicast/s ' + ((wb.mcast - wa.mcast) / secs).toFixed(1));
  console.log('Udp   IgnoredMulti/s ' + ((snmpField(snmpB, 'Udp:', 'IgnoredMulti') - snmpField(snmpA, 'Udp:', 'IgnoredMulti')) / secs).toFixed(1));
  console.log('Udp   NoPorts/s      ' + ((snmpField(snmpB, 'Udp:', 'NoPorts') - snmpField(snmpA, 'Udp:', 'NoPorts')) / secs).toFixed(1));
  console.log('Udp   InDatagrams/s  ' + ((snmpField(snmpB, 'Udp:', 'InDatagrams') - snmpField(snmpA, 'Udp:', 'InDatagrams')) / secs).toFixed(1));
  console.log('Udp   InErrors/s     ' + ((snmpField(snmpB, 'Udp:', 'InErrors') - snmpField(snmpA, 'Udp:', 'InErrors')) / secs).toFixed(1));
  process.exit(0);
})();
