'use strict';
const net = require('net');
const dgram = require('dgram');

const HOST = '192.168.137.100';
const WATCH_MS = Number(process.argv[2] || '900000');
const WANT_RB = 3;
const TAKE_MS_LIST = [1500, 1520, 1480, 1560, 1440];
const POLL_MS = 200;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sendBytes(bytes) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: HOST, port: 9401 }, () => {
      sock.write(Buffer.from(bytes), (err) => { if (err) reject(err); sock.end(); });
    });
    sock.setTimeout(5000);
    sock.on('timeout', () => { sock.destroy(); reject(new Error('midi timeout')); });
    sock.on('close', resolve);
    sock.on('error', reject);
  });
}
const tap = (n) => sendBytes([0x90, n, 127]).then(() => sendBytes([0x80, n, 0]));

function poll() {
  return new Promise((resolve) => {
    const s = dgram.createSocket('udp4');
    const timer = setTimeout(() => { try { s.close(); } catch (e) {} resolve(null); }, 1500);
    s.on('message', (m) => {
      clearTimeout(timer);
      try { s.close(); } catch (e) {}
      try { resolve(JSON.parse(m.toString())); } catch (e) { resolve(null); }
    });
    s.on('error', () => { clearTimeout(timer); resolve(null); });
    s.send('status', 4445, HOST);
  });
}

async function armRb3() {
  for (const takeMs of TAKE_MS_LIST) {
    await tap(0x5b);
    await sleep(1200);
    await tap(2);
    await sleep(takeMs);
    await tap(2);
    await sleep(2500);
    const t = await poll();
    if (!t) continue;
    const rb = Number(t.recorded_beats);
    const playing = Number(t.loopers.play) !== 0;
    console.log('[rb3] take ' + takeMs + 'ms -> rb=' + rb + ' playing=' + playing
      + ' master_len=' + t.master_len_samples);
    if (rb === WANT_RB && playing) {
      console.log('[rb3] armed rb=' + rb + '  (128 mod rb = ' + (128 % rb)
        + ') -> a 128-beat fold reads ~' + (128 % rb) + ' beats of error, trim cannot hide it');
      return true;
    }
  }
  console.log('[rb3] could not arm rb=' + WANT_RB);
  return false;
}

async function main() {
  if (!(await armRb3())) { console.log('[rb3] INCONCLUSIVE'); process.exit(2); }

  const start = Date.now();
  let lastPeers = -1;
  let transition = -1;
  const events = [];
  const after = [];
  let audiblePolls = 0;
  let audibleWithPeers = 0;

  while (Date.now() - start < WATCH_MS) {
    const t = await poll();
    const elapsed = Date.now() - start;
    if (!t) { await sleep(POLL_MS); continue; }
    const peers = Number(t.link.peers || 0);
    const playing = Number(t.loopers.play) !== 0 && Number(t.loopers.wraplen[0]) > 1;
    const err = Math.abs(Number(t.link.phase_err_beats || 0));
    if (playing) audiblePolls++;
    if (playing && peers > 0) audibleWithPeers++;
    if (peers !== lastPeers) {
      if (lastPeers >= 0) {
        events.push('t=' + (elapsed / 1000).toFixed(1) + 's peers ' + lastPeers + ' -> ' + peers
          + ' playing=' + (playing ? 1 : 0) + ' |err|=' + err.toFixed(4));
      }
      if (peers > 0 && lastPeers === 0) transition = elapsed;
      lastPeers = peers;
    }
    if (transition >= 0 && playing && peers > 0) after.push({ ms: elapsed - transition, err: err });
    await sleep(POLL_MS);
  }

  console.log('[rb3] polls: ' + audiblePolls + ' audible, ' + audibleWithPeers + ' audible+peered');
  console.log('[rb3] transitions:\n' + (events.join('\n') || '(none)'));
  if (transition >= 0 && after.length) {
    const early = after.filter((a) => a.ms <= 1500).map((a) => a.err);
    const late = after.filter((a) => a.ms > 1500).map((a) => a.err);
    const mx = (a) => (a.length ? Math.max.apply(null, a) : NaN);
    const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
    console.log('[rb3] after re-join: first 1.5s max=' + mx(early).toFixed(4)
      + ' mean=' + mean(early).toFixed(4) + ' n=' + early.length);
    console.log('[rb3] after re-join: later    max=' + mx(late).toFixed(4)
      + ' mean=' + mean(late).toFixed(4) + ' n=' + late.length);
    console.log('[rb3] VERDICT: ' + (mx(late) <= 0.03 ? 'BOUNDED after join re-base'
      : 'ERROR PERSISTS after join re-base'));
  } else {
    console.log('[rb3] INCONCLUSIVE: no 0->1 peer transition while audible');
  }
  process.exit(0);
}

main().catch((e) => { console.error('[rb3] error:', e.message); process.exit(1); });
