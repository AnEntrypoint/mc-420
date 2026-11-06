#!/usr/bin/env node
'use strict';
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const HOST = process.env.ALOOP_PI_HOST || '192.168.137.132';
const OUT = path.join(__dirname, '..', '..', '.gm', 'witness-out');
const XRUN_TOL = 1;
const LAT_TOL = 16;
const RT_TOL = 16;

function query() {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4');
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { sock.close(); } catch (e) { }
      reject(new Error('telemetry timeout'));
    }, 3000);
    sock.on('message', (msg) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sock.close();
      try { resolve(JSON.parse(msg.toString())); } catch (e) { reject(e); }
    });
    sock.on('error', (e) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(e);
    });
    sock.send('status', 4445, HOST);
  });
}

function brief(t) {
  return {
    xruns: t.xruns,
    latency_bias_samples: t.latency_bias_samples,
    alsa_roundtrip_samples: t.alsa_roundtrip_samples,
    latency_trim_samples: t.latency_trim_samples,
    link: t.link,
    master_len_samples: t.master_len_samples,
    recorded_beats: t.recorded_beats
  };
}

function fileFor(label, phase) {
  return path.join(OUT, 'hotdeploy-' + label + '-' + phase + '.json');
}

async function capture(label, phase) {
  const t = await query();
  const b = brief(t);
  const rec = { label, phase, at: new Date().toISOString(), host: HOST, telemetry: b };
  fs.writeFileSync(fileFor(label, phase), JSON.stringify(rec, null, 2) + '\n');
  console.log('[hotdeploy-gate] ' + label + ' ' + phase + ' ' + JSON.stringify(b));
  return rec;
}

function judge(label) {
  const before = JSON.parse(fs.readFileSync(fileFor(label, 'before'), 'utf8')).telemetry;
  const after = JSON.parse(fs.readFileSync(fileFor(label, 'after'), 'utf8')).telemetry;
  const rules = [
    ['xruns', after.xruns <= before.xruns + XRUN_TOL, before.xruns, after.xruns],
    ['latency_bias_samples', after.latency_bias_samples <= before.latency_bias_samples + LAT_TOL, before.latency_bias_samples, after.latency_bias_samples],
    ['alsa_roundtrip_samples', after.alsa_roundtrip_samples <= before.alsa_roundtrip_samples + RT_TOL, before.alsa_roundtrip_samples, after.alsa_roundtrip_samples]
  ];
  console.log('[hotdeploy-gate] label=' + label + ' tolerances xruns<=' + XRUN_TOL + ' lat<=' + LAT_TOL + ' rt<=' + RT_TOL);
  for (const r of rules) console.log('[' + (r[1] ? 'PASS' : 'FAIL') + '] ' + r[0] + ' before=' + r[2] + ' after=' + r[3]);
  console.log('[hotdeploy-gate] before link=' + JSON.stringify(before.link) + ' after link=' + JSON.stringify(after.link));
  const pass = rules.every((r) => r[1]);
  console.log('[hotdeploy-gate] ' + (pass ? 'PASS' : 'FAIL') + (pass ? '' : ' REVERT_REQUIRED'));
  return pass;
}

async function main() {
  const mode = process.argv[2];
  const label = process.argv[3];
  if (!label) throw new Error('usage: capture <label> <before|after> | judge <label>');
  if (mode === 'capture') {
    const phase = process.argv[4];
    if (phase !== 'before' && phase !== 'after') throw new Error('phase must be before or after');
    await capture(label, phase);
    return;
  }
  if (mode === 'judge') {
    if (!judge(label)) process.exitCode = 1;
    return;
  }
  throw new Error('unknown mode ' + mode);
}

main().catch((e) => { console.error('[hotdeploy-gate] error: ' + e.message); process.exit(2); });
