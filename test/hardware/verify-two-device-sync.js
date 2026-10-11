'use strict';
const dgram = require('dgram');

const host = process.argv[2] || '192.168.137.100';
const watchMs = Number(process.argv[3] || 30000);
const kPollMs = 200;
const kPeersPresentMinFrac = 0.95;
const kBpmSpreadMax = 0.05;
const kPhaseErrBeatsMax = 0.03;

function queryTelemetry() {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4');
    const timer = setTimeout(() => { try { sock.close(); } catch (e) {} reject(new Error('telemetry timeout')); }, 2000);
    sock.on('message', (msg) => {
      clearTimeout(timer);
      try { sock.close(); } catch (e) {}
      try { resolve(JSON.parse(msg.toString())); }
      catch (e) { reject(e); }
    });
    sock.on('error', (e) => { clearTimeout(timer); reject(e); });
    sock.send('status', 4445, host);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function spread(values) {
  if (!values.length) return 0;
  let lo = values[0];
  let hi = values[0];
  for (const v of values) { if (v < lo) lo = v; if (v > hi) hi = v; }
  return hi - lo;
}

(async () => {
  const started = Date.now();
  const samples = [];
  let consecutiveFailures = 0;

  while (Date.now() - started < watchMs) {
    const t = Date.now() - started;
    try {
      const t0 = await queryTelemetry();
      consecutiveFailures = 0;
      const link = t0.link || {};
      samples.push({
        tMs: t,
        peers: Number(link.peers || 0),
        synced: !!link.synced,
        bpm: Number(link.bpm || 0),
        phaseErr: Number(link.phase_err_beats || 0),
        effSpeed: Number(t0.eff_speed || 0),
        masterPhase: Number(t0.master_phase_beats || 0),
        recordedBeats: Number(t0.recorded_beats || 0),
        masterLen: Number(t0.master_len_samples || 0),
        xruns: Number(t0.xruns || 0),
      });
    } catch (e) {
      consecutiveFailures += 1;
      if (consecutiveFailures >= 10) {
        console.log('[fail] 10 consecutive telemetry timeouts at t=' + t + 'ms: ' + e.message);
        process.exit(1);
      }
    }
    await sleep(kPollMs);
  }

  if (!samples.length) {
    console.log('[fail] no telemetry replies in ' + watchMs + 'ms');
    process.exit(1);
  }

  let firstPeerIdx = -1;
  for (let i = 0; i < samples.length; i++) {
    if (samples[i].peers >= 1) { firstPeerIdx = i; break; }
  }

  const after = firstPeerIdx >= 0 ? samples.slice(firstPeerIdx) : [];
  const withPeers = after.filter((s) => s.peers >= 1);
  const presentFrac = after.length ? withPeers.length / after.length : 0;

  const losses = [];
  for (let i = 1; i < after.length; i++) {
    if (after[i - 1].peers >= 1 && after[i].peers === 0) losses.push(after[i].tMs);
  }
  const rejoins = [];
  for (let i = 1; i < after.length; i++) {
    if (after[i - 1].peers === 0 && after[i].peers >= 1) rejoins.push(after[i].tMs);
  }

  const syncedFrac = withPeers.length ? withPeers.filter((s) => s.synced).length / withPeers.length : 0;
  const bpmSpread = spread(withPeers.map((s) => s.bpm));
  const phaseErrMax = withPeers.reduce((m, s) => Math.max(m, Math.abs(s.phaseErr)), 0);
  const effSpeedSpread = spread(withPeers.map((s) => s.effSpeed));
  const xrunsTotal = samples[samples.length - 1].xruns;

  const checks = [];
  checks.push(['peer acquired', firstPeerIdx >= 0, firstPeerIdx >= 0 ? 'first at ' + after[0].tMs + 'ms' : 'peers stayed 0 for ' + watchMs + 'ms']);
  checks.push(['peer retained', presentFrac >= kPeersPresentMinFrac, (presentFrac * 100).toFixed(1) + '% of ' + after.length + ' polls after acquisition, ' + losses.length + ' loss(es), ' + rejoins.length + ' rejoin(s)']);
  checks.push(['synced while peered', syncedFrac >= kPeersPresentMinFrac, (syncedFrac * 100).toFixed(1) + '% of ' + withPeers.length + ' peered polls']);
  checks.push(['session bpm stable', bpmSpread <= kBpmSpreadMax, 'spread ' + bpmSpread.toFixed(3) + ' bpm (max ' + kBpmSpreadMax + ')']);
  checks.push(['phase error bounded', phaseErrMax <= kPhaseErrBeatsMax, 'max |phase_err_beats| ' + phaseErrMax.toFixed(4) + ' (max ' + kPhaseErrBeatsMax + ')']);
  checks.push(['eff_speed settled', effSpeedSpread <= 0.005, 'spread ' + effSpeedSpread.toFixed(5)]);

  console.log('two-device sync watch ' + (watchMs / 1000).toFixed(1) + 's, ' + samples.length + ' polls');
  if (withPeers.length) {
    const bpms = withPeers.map((s) => s.bpm);
    console.log('  link bpm        ' + Math.min(...bpms).toFixed(3) + ' .. ' + Math.max(...bpms).toFixed(3));
    console.log('  peers           ' + Math.min(...withPeers.map((s) => s.peers)) + ' .. ' + Math.max(...withPeers.map((s) => s.peers)));
  }
  console.log('  recorded_beats  ' + samples[samples.length - 1].recordedBeats + '  master_len ' + samples[samples.length - 1].masterLen + ' smp');
  console.log('  xruns           ' + xrunsTotal);
  if (losses.length) console.log('  peer losses at ms: ' + losses.join(', '));
  if (rejoins.length) console.log('  peer rejoins at ms: ' + rejoins.join(', '));

  let failed = 0;
  for (const [name, ok, detail] of checks) {
    console.log((ok ? '  PASS ' : '  FAIL ') + name + ': ' + detail);
    if (!ok) failed += 1;
  }
  console.log(failed === 0 ? 'VERDICT: PASS' : 'VERDICT: FAIL (' + failed + ' check(s))');
  process.exit(failed === 0 ? 0 : 1);
})();
