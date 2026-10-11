#!/usr/bin/env node
const net = require('net');
const dgram = require('dgram');
const { Client } = require('C:/dev/mc-420/node_modules/ssh2');

const HOST = process.argv[2] || '192.168.137.100';
const HOLD_MS = Number(process.argv[3] || 1500);
const RUNS = Number(process.argv[4] || 2);
const SR = 48000;
const PAD0 = 2;
const CLEAR_ALL = 0x5b;
const TOL_SAMPLES = 2000;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function sendBytes(bytes) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: HOST, port: 9401 }, () => {
      sock.write(Buffer.from(bytes), (err) => {
        if (err) return reject(err);
        sock.end();
      });
    });
    sock.setTimeout(5000);
    sock.on('timeout', () => { sock.destroy(); reject(new Error('midi ' + HOST + ':9401 timeout')); });
    sock.on('close', resolve);
    sock.on('error', reject);
  });
}

const press = (note) => sendBytes([0x90, note, 127]);
const release = (note) => sendBytes([0x80, note, 0]);

function queryTelemetry() {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4');
    const timer = setTimeout(() => { sock.close(); reject(new Error('telemetry timeout')); }, 3000);
    sock.on('message', (msg) => {
      clearTimeout(timer);
      sock.close();
      try { resolve(JSON.parse(msg.toString())); }
      catch (e) { reject(e); }
    });
    sock.on('error', (e) => { clearTimeout(timer); reject(e); });
    sock.send('status', 4445, HOST);
  });
}

async function waitTelemetry(maxMs) {
  const start = Date.now();
  let lastErr = null;
  while (Date.now() - start < maxMs) {
    try {
      const t = await queryTelemetry();
      if (t && t.loopers) return t;
    } catch (e) { lastErr = e; }
    await sleep(500);
  }
  throw new Error('telemetry never answered: ' + (lastErr && lastErr.message));
}

function connectSsh() {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => resolve(conn));
    conn.on('error', reject);
    conn.connect({ host: HOST, username: 'root', password: 'aloop', readyTimeout: 20000 });
  });
}

function sshExec(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = '', errOut = '';
      stream.on('close', code => resolve({ code, out, errOut }));
      stream.on('data', d => { out += d.toString(); });
      stream.stderr.on('data', d => { errOut += d.toString(); });
    });
  });
}

function median(values) {
  const s = values.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

async function settle() {
  const start = Date.now();
  let last = null, stable = 0;
  while (Date.now() - start < 12000) {
    const t = await queryTelemetry();
    const key = t.loopers.wraplen[0] + '|' + t.master_len_samples + '|' + t.recorded_beats;
    const ready = t.master_len_samples > 0 && t.loopers.wraplen[0] > 0 && t.recorded_beats >= 1;
    if (ready && key === last) {
      stable++;
      if (stable >= 3) break;
    } else {
      stable = ready ? 1 : 0;
    }
    last = key;
    await sleep(150);
  }
  const samples = [];
  for (let i = 0; i < 5; i++) {
    try { samples.push(await queryTelemetry()); } catch (e) { /* keep going */ }
    await sleep(200);
  }
  if (!samples.length) throw new Error('no telemetry samples after settle');
  return {
    wlen: median(samples.map((s) => s.loopers.wraplen[0])),
    writeIdx: median(samples.map((s) => s.loopers.writeidx[0])),
    masterLen: median(samples.map((s) => s.master_len_samples)),
    recordedBeats: median(samples.map((s) => s.recorded_beats)),
    linkBpm: median(samples.map((s) => (s.link ? s.link.bpm : 0))),
    linkPeers: median(samples.map((s) => (s.link ? s.link.peers : 0))),
    effSpeed: median(samples.map((s) => s.eff_speed)),
    masterPhaseBeats: median(samples.map((s) => s.master_phase_beats)),
  };
}

function parseDiag(logText) {
  const out = [];
  for (const line of logText.split('\n')) {
    if (line.indexOf('[diag-quant]') === -1) continue;
    const rec = { line: line.trim() };
    for (const m of line.matchAll(/(\w+)=(-?[\d.]+)/g)) rec[m[1]] = Number(m[2]);
    out.push(rec);
  }
  return out;
}

async function runScenario(conn, index) {
  console.log('\n===== run ' + (index + 1) + '/' + RUNS + ': restart, clear-all, pad0 hold ' + HOLD_MS + 'ms =====');
  const restart = await sshExec(conn, 'rc-service aloop restart');
  console.log('[' + (index + 1) + '] restart: ' + (restart.out + restart.errOut).trim().replace(/\s+/g, ' '));
  await waitTelemetry(30000);

  const sizeRes = await sshExec(conn, 'wc -c < /var/log/aloop.log');
  const offset = parseInt(sizeRes.out.trim(), 10) || 0;

  await press(CLEAR_ALL);
  await release(CLEAR_ALL);
  await sleep(1200);

  const tArm0 = Date.now();
  await press(PAD0);
  await release(PAD0);
  await sleep(HOLD_MS);
  const heldMs = Date.now() - tArm0;
  await press(PAD0);
  await release(PAD0);

  const m = await settle();
  const logRes = await sshExec(conn, 'tail -c +' + (offset + 1) + ' /var/log/aloop.log');
  const diag = parseDiag(logRes.out + logRes.errOut);
  const masterDiag = diag.find((d) => d.line.indexOf('MASTER') !== -1);

  const raw = masterDiag && masterDiag.raw ? masterDiag.raw : m.masterLen;
  const beatLen = m.recordedBeats > 0 ? m.masterLen / m.recordedBeats : 0;
  const errSamples = Math.abs(m.wlen - raw);
  const errMs = (errSamples / SR) * 1000;
  const twoBeat = 2 * beatLen;
  const fourBeat = 4 * beatLen;
  const derivedBpm = beatLen > 0 ? (60 * SR) / beatLen : 0;

  console.log('[' + (index + 1) + '] held: ' + heldMs + 'ms (requested ' + HOLD_MS + 'ms)');
  console.log('[' + (index + 1) + '] raw write index (diag MASTER raw): ' + raw + ' (' + (raw / SR).toFixed(4) + 's)');
  console.log('[' + (index + 1) + '] telemetry master_len_samples: ' + m.masterLen + ' (' + (m.masterLen / SR).toFixed(4) + 's)');
  console.log('[' + (index + 1) + '] telemetry writeidx[0]: ' + m.writeIdx);
  console.log('[' + (index + 1) + '] wlen/wraplen[0] (finished loop length): ' + m.wlen + ' (' + (m.wlen / SR).toFixed(4) + 's)');
  console.log('[' + (index + 1) + '] recorded_beats: ' + m.recordedBeats);
  console.log('[' + (index + 1) + '] derived bpm (60*SR/beatLen): ' + derivedBpm.toFixed(3));
  console.log('[' + (index + 1) + '] diag solvedBpm: ' + (masterDiag ? masterDiag.solvedBpm : 'n/a') + ' solvedBeats: ' + (masterDiag ? masterDiag.solvedBeats : 'n/a') + ' beats: ' + (masterDiag ? masterDiag.beats : 'n/a'));
  console.log('[' + (index + 1) + '] link: bpm=' + m.linkBpm + ' peers=' + m.linkPeers + ' eff_speed=' + m.effSpeed + ' master_phase_beats=' + m.masterPhaseBeats);
  console.log('[' + (index + 1) + '] takeBeats = wlen/beatLen = ' + (beatLen > 0 ? (m.wlen / beatLen).toFixed(4) : 'n/a'));
  console.log('[' + (index + 1) + '] GRID ERROR |wlen - raw| = ' + errSamples.toFixed(1) + ' samples / ' + errMs.toFixed(3) + ' ms');
  console.log('[' + (index + 1) + '] distance to 2-beat node (' + twoBeat.toFixed(1) + '): ' + Math.abs(m.wlen - twoBeat).toFixed(1) + ' samples');
  console.log('[' + (index + 1) + '] distance to 4-beat node (' + fourBeat.toFixed(1) + '): ' + Math.abs(m.wlen - fourBeat).toFixed(1) + ' samples');
  for (const d of diag) console.log('[' + (index + 1) + '] ' + d.line);

  const pass = errSamples <= TOL_SAMPLES
    && Math.abs(m.wlen - twoBeat) > TOL_SAMPLES
    && Math.abs(m.wlen - fourBeat) > TOL_SAMPLES
    && m.recordedBeats === 3;
  console.log('[' + (index + 1) + '] ' + (pass ? 'PASS' : 'FAIL') + ' (tol ' + TOL_SAMPLES + ' samples, recorded_beats must be 3)');
  return { index: index + 1, heldMs, raw, wlen: m.wlen, masterLen: m.masterLen, recordedBeats: m.recordedBeats, errSamples, errMs, derivedBpm, pass, twoBeat, fourBeat };
}

async function main() {
  console.log('[3beat] host=' + HOST + ' holdMs=' + HOLD_MS + ' runs=' + RUNS + ' tol=' + TOL_SAMPLES + ' samples');
  const conn = await connectSsh();
  const results = [];
  try {
    const ver = await sshExec(conn, 'md5sum /opt/aloop/aloop');
    console.log('[3beat] binary: ' + ver.out.trim());
    for (let i = 0; i < RUNS; i++) results.push(await runScenario(conn, i));
  } finally {
    conn.end();
  }
  console.log('\n===== SUMMARY =====');
  for (const r of results) {
    console.log('run ' + r.index + ': held=' + r.heldMs + 'ms raw=' + r.raw + ' wlen=' + r.wlen + ' masterLen=' + r.masterLen + ' beats=' + r.recordedBeats + ' bpm=' + r.derivedBpm.toFixed(2) + ' err=' + r.errSamples.toFixed(1) + 'smp/' + r.errMs.toFixed(2) + 'ms ' + (r.pass ? 'PASS' : 'FAIL'));
  }
  const allPass = results.length > 0 && results.every((r) => r.pass);
  console.log('[3beat] ' + (allPass ? 'ALL PASS' : 'SOME FAILED'));
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => { console.error('[3beat] error:', e.message); process.exit(1); });
