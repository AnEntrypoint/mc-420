'use strict';
const dgram = require('dgram');

const kSampleRate = 48000;

function despikedSpread(devs, tolerance, tearSamples = 16) {
  const kept = [];
  let dropped = 0;
  for (let i = 0; i < devs.length; i++) {
    const near = [devs[i - 2], devs[i - 1], devs[i + 1], devs[i + 2]].filter((v) => v !== undefined);
    const isolated = near.length >= 2 && near.every((v) => Math.abs(devs[i] - v) > tearSamples);
    if (isolated) dropped++;
    else kept.push(devs[i]);
  }
  if (kept.length === 0) return { spread: 0, dropped, min: 0, max: 0, held: true };
  const min = Math.min(...kept);
  const max = Math.max(...kept);
  return { spread: max - min, dropped, min, max, held: max - min <= tolerance };
}

function gridBeatLen(t) {
  if (t.master_len_samples > 0 && t.recorded_beats >= 1) return t.master_len_samples / t.recorded_beats;
  return t.groove ? t.groove.beat_len_samples : (60 / t.link.bpm) * kSampleRate;
}

function queryTelemetry(host, timeoutMs) {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4');
    const timer = setTimeout(() => { sock.close(); reject(new Error('telemetry query timed out')); }, timeoutMs || 3000);
    sock.on('message', (msg) => {
      clearTimeout(timer);
      sock.close();
      try { resolve(JSON.parse(msg.toString())); }
      catch (e) { reject(e); }
    });
    sock.on('error', (e) => { clearTimeout(timer); reject(e); });
    sock.send('status', 4445, host);
  });
}

module.exports = { kSampleRate, despikedSpread, gridBeatLen, queryTelemetry };
