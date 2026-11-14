#!/usr/bin/env node
import dgram from 'node:dgram';
import { readFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';

const kHost = '192.168.137.132';
const kEsp = '192.168.4.19';
const kRate = 48000;
const kChannels = 20;
const kChannel = 1;
const kSeconds = 10;
const kFrameBytes = 4 * kChannels;
const kWindowSamples = 48;
const kFloorWindows = 300;
const kOnsetDb = 10;
const kMinGapWindows = 60;
const kUsbMount = '/media/aloop-usb';
const kSidechain = { field: 'pot0', physical: 'Pot 1 / ADC_CHANNEL_6 / GPIO34', mapping: 'pad 3 single-tap SET_SERIES' };
const kArgs = process.argv.slice(2);
const kSelfTest = kArgs.includes('--self-test');
const kAskIndex = kArgs.indexOf('--askpass');
const kAskpass = kAskIndex >= 0 ? kArgs[kAskIndex + 1] : null;

function cleanJson(text) {
  return text.replace(/(?<=[\[,:])(-?nan|-?inf)(?=[,\]}])/gi, 'null');
}
function median(values) {
  const a = Array.from(values).sort((x, y) => x - y);
  return a.length ? a[a.length >> 1] : 0;
}
function telemetry() {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const timer = setTimeout(() => { socket.close(); reject(new Error('Pi telemetry timeout')); }, 7000);
    socket.on('message', data => {
      clearTimeout(timer);
      socket.close();
      try {
        const j = JSON.parse(cleanJson(data.toString()));
        resolve({
          sustain_cmd: j.sustain_cmd,
          sustain_gate: j.sustain_gate,
          input_recordable: j.input_recordable,
          fx_bank: j.fx_bank,
          looper0: {
            play: j.loopers.play,
            rec: j.loopers.rec,
            level: j.loopers.level[0],
            wraplen: j.loopers.wraplen[0],
            master_len: j.master_len_samples,
            recorded_beats: j.recorded_beats,
          },
          link: {
            synced: j.link.synced,
            peers: j.link.peers,
            bpm: j.link.bpm,
            phase_err_beats: j.link.phase_err_beats,
          },
        });
      } catch (e) { reject(e); }
    });
    socket.on('error', e => { clearTimeout(timer); reject(e); });
    socket.send('status', 4445, kHost);
  });
}
function ssh(command) {
  const env = Object.assign({}, process.env);
  if (kAskpass) {
    env.SSH_ASKPASS = kAskpass;
    env.SSH_ASKPASS_REQUIRE = 'force';
  }
  return execFileSync('setsid', ['ssh', '-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=10', 'root@' + kHost, command], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 }).trim();
}
function local(command, args) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 }).trim();
}
function espStatus() {
  const j = JSON.parse(cleanJson(ssh("printf '?' | nc -u -w1 " + kEsp + " 20813")));
  return { link: j.link, peers: j.peers, bpm: j.bpm, pot0: j.pot0, pot1: j.pot1, sidechain: kSidechain };
}
function amixerSwitch(text) {
  const line = text.split('\n').map(s => s.trim()).filter(Boolean).reverse().find(s => s.startsWith('Mono: Capture'));
  const match = line && line.match(/\[(on|off)\]/);
  return match ? match[1] : null;
}
function amixerItem(text) {
  const line = text.split('\n').map(s => s.trim()).filter(Boolean).reverse().find(s => s.startsWith('Item0:'));
  const match = line && line.match(/'([^']+)'/);
  return match ? match[1] : null;
}
function guardState() {
  return {
    enabled: local('systemctl', ['is-enabled', 'focusrite-input2-guard.service']),
    active: local('systemctl', ['is-active', 'focusrite-input2-guard.service']),
    pad: amixerSwitch(local('amixer', ['-c', '0', 'sget', 'Line In 2 Pad'])),
    air: amixerSwitch(local('amixer', ['-c', '0', 'sget', 'Line In 2 Air'])),
    level: amixerItem(local('amixer', ['-c', '0', 'sget', 'Line In 2 Level'])),
  };
}
function usbState() {
  const mountRow = readFileSync('/proc/mounts', 'utf8').split('\n').map(s => s.trim()).filter(Boolean).find(s => s.split(/\s+/)[1] === kUsbMount);
  if (!mountRow) return { usbDrive: 'absent', mounted: false, mountPoint: kUsbMount, source: null, fstype: null, freeKiB: 0, freeMiB: 0, warning: 'clip export will not persist' };
  const mountParts = mountRow.split(/\s+/);
  const source = mountParts[0];
  const fstype = mountParts[2];
  const partitions = readFileSync('/proc/partitions', 'utf8').split('\n').map(s => s.trim()).filter(Boolean).map(s => s.split(/\s+/)).filter(p => p.length === 4 && /^\d+$/.test(p[0])).map(p => p[3]);
  const usbPartitions = partitions.filter(name => /^sd[a-z]/.test(name));
  const blockBacked = source.startsWith('/dev/') && fstype !== 'tmpfs' && usbPartitions.some(name => source.includes(name));
  const usbDrive = blockBacked ? 'real' : 'stand-in-tmpfs';
  const dfRows = local('df', ['-k', kUsbMount]).split('\n').map(s => s.trim()).filter(Boolean);
  const dfRow = dfRows[dfRows.length - 1];
  const freeKiB = dfRow ? Number(dfRow.split(/\s+/)[3]) : 0;
  return { usbDrive, mounted: true, mountPoint: kUsbMount, source, fstype, freeKiB, freeMiB: Number((freeKiB / 1024).toFixed(1)), warning: usbDrive === 'real' ? null : 'clip export will not persist' };
}
function capture() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let err = '';
    const rec = spawn('arecord', ['-q', '-D', 'plughw:0,0', '-t', 'raw', '-c', String(kChannels), '-f', 'S32_LE', '-r', String(kRate), '-d', String(kSeconds), '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
    rec.stdout.on('data', d => chunks.push(d));
    rec.stderr.on('data', d => { err += d; });
    rec.on('error', reject);
    rec.on('close', code => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error('arecord exited ' + code + ': ' + err.trim())));
  });
}
function analyze(raw) {
  const frames = Math.floor(raw.length / kFrameBytes);
  let sumSquares = 0;
  let peak = 0;
  let clippedSampleCount = 0;
  for (let f = 0; f < frames; f += 1) {
    const v = raw.readInt32LE((f * kChannels + kChannel) * 4) / 2147483648;
    sumSquares += v * v;
    const a = Math.abs(v);
    if (a > peak) peak = a;
    if (a >= 0.999) clippedSampleCount += 1;
  }
  const windows = Math.floor(frames / kWindowSamples);
  const env = new Float64Array(windows);
  for (let w = 0; w < windows; w += 1) {
    let acc = 0;
    for (let i = 0; i < kWindowSamples; i += 1) {
      const f = w * kWindowSamples + i;
      const v = raw.readInt32LE((f * kChannels + kChannel) * 4) / 2147483648;
      acc += v * v;
    }
    env[w] = Math.sqrt(acc / kWindowSamples);
  }
  const floor = median(env.subarray(0, Math.min(kFloorWindows, windows)));
  const threshold = Math.max(floor * 10 ** (kOnsetDb / 20), 1e-6);
  const onsets = [];
  let last = -kMinGapWindows;
  for (let w = 1; w < windows; w += 1) {
    if (env[w] > threshold && env[w - 1] <= threshold && w - last >= kMinGapWindows) {
      onsets.push(w * kWindowSamples);
      last = w;
    }
  }
  const periods = [];
  for (let i = 1; i < onsets.length; i += 1) periods.push(((onsets[i] - onsets[i - 1]) / kRate) * 1000);
  const period = periods.length ? Number(median(periods).toFixed(1)) : null;
  return { channel: kChannel, seconds: Number((frames / kRate).toFixed(3)), rms: Number(Math.sqrt(sumSquares / Math.max(1, frames)).toFixed(6)), peak: Number(peak.toFixed(6)), beepOnsetCount: onsets.length, medianPeriodMs: period, clippedSampleCount };
}
function syntheticResult() {
  return {
    pi: { sustain_cmd: 1, sustain_gate: 1, input_recordable: [0, 1], fx_bank: 0, looper0: { play: 0, rec: 0, level: 0, wraplen: 1, master_len: 0, recorded_beats: 0 }, link: { synced: true, peers: 1, bpm: 120, phase_err_beats: 0 } },
    esp: { link: true, peers: 1, bpm: 120, pot0: 126, pot1: 126, sidechain: kSidechain },
    guard: { enabled: 'enabled', active: 'active', pad: 'on', air: 'off', level: 'Line' },
    capture: { channel: 1, rms: 0.01, peak: 0.2, beepOnsetCount: 5, medianPeriodMs: 500, clippedSampleCount: 0 },
    usb: { usbDrive: 'real', mounted: true, mountPoint: kUsbMount, source: '/dev/sda1', fstype: 'vfat', freeKiB: 61440, freeMiB: 60, warning: null },
  };
}
function evaluate(r) {
  const fails = [];
  const eq = (name, value, want) => { if (value !== want) fails.push(name); };
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  eq('sustain_cmd', r.pi.sustain_cmd, 1);
  eq('sustain_gate', r.pi.sustain_gate, 1);
  if (JSON.stringify(r.pi.input_recordable) !== JSON.stringify([0, 1])) fails.push('input_recordable');
  eq('fx_bank', r.pi.fx_bank, 0);
  eq('looper0.play', r.pi.looper0.play, 0);
  eq('looper0.rec', r.pi.looper0.rec, 0);
  eq('looper0.level', r.pi.looper0.level, 0);
  eq('looper0.wraplen', r.pi.looper0.wraplen, 1);
  eq('looper0.master_len', r.pi.looper0.master_len, 0);
  eq('looper0.recorded_beats', r.pi.looper0.recorded_beats, 0);
  eq('pi.link.synced', r.pi.link.synced, true);
  if (!(r.pi.link.peers >= 1)) fails.push('pi.link.peers');
  if (!(finite(r.pi.link.bpm) && r.pi.link.bpm > 0)) fails.push('pi.link.bpm');
  if (!(finite(r.pi.link.phase_err_beats) && Math.abs(r.pi.link.phase_err_beats) <= 0.03)) fails.push('pi.link.phase_err_beats');
  eq('esp.link', r.esp.link, true);
  if (!(r.esp.peers >= 1)) fails.push('esp.peers');
  if (!(finite(r.esp.bpm) && r.esp.bpm > 0)) fails.push('esp.bpm');
  if (!(Number.isInteger(r.esp.pot0) && r.esp.pot0 >= 0 && r.esp.pot0 <= 127)) fails.push('esp.pot0');
  if (!(Number.isInteger(r.esp.pot1) && r.esp.pot1 >= 0 && r.esp.pot1 <= 127)) fails.push('esp.pot1');
  eq('esp.sidechain.field', r.esp.sidechain.field, 'pot0');
  eq('guard.enabled', r.guard.enabled, 'enabled');
  eq('guard.active', r.guard.active, 'active');
  eq('guard.pad', r.guard.pad, 'on');
  eq('guard.air', r.guard.air, 'off');
  eq('guard.level', r.guard.level, 'Line');
  if (!(finite(r.capture.rms) && r.capture.rms >= 0.0005)) fails.push('capture.rms');
  if (!(finite(r.capture.peak) && r.capture.peak >= 0.005 && r.capture.peak <= 0.99)) fails.push('capture.peak');
  if (!(r.capture.beepOnsetCount >= 1)) fails.push('capture.beepOnsetCount');
  if (!(finite(r.capture.medianPeriodMs) && r.capture.medianPeriodMs >= 100 && r.capture.medianPeriodMs <= 2000)) fails.push('capture.medianPeriodMs');
  eq('capture.clippedSampleCount', r.capture.clippedSampleCount, 0);
  return fails;
}
function finalLine(fails) {
  return fails.length ? 'STAGE_READY FAIL fields=' + fails.join(',') : 'STAGE_READY PASS';
}
function warningLine(usb) {
  return usb.usbDrive === 'real' ? null : 'WARN usbDrive=' + usb.usbDrive + ' clipExportWillNotPersist=true';
}
async function main() {
  if (kSelfTest) {
    const bad = syntheticResult();
    bad.pi.sustain_cmd = 0;
    const fails = evaluate(bad);
    console.log('SELF_TEST known_bad_value=' + JSON.stringify({ sustain_cmd: 0 }));
    console.log('SELF_TEST_FAILS ' + fails.join(','));
    console.log(finalLine(fails));
    process.exitCode = fails.includes('sustain_cmd') ? 1 : 0;
    return;
  }
  const [pi, esp, guard, usb, raw] = await Promise.all([telemetry(), espStatus(), guardState(), usbState(), capture()]);
  const result = { pi, esp, guard, capture: analyze(raw), usb };
  console.log('PI_TELEMETRY ' + JSON.stringify(pi));
  console.log('ESP_STATUS ' + JSON.stringify(esp));
  console.log('SIDECHAIN_POT ' + JSON.stringify(kSidechain));
  console.log('FOCUSRITE_GUARD ' + JSON.stringify(guard));
  console.log('CAPTURE_CH2 ' + JSON.stringify(result.capture));
  console.log('USB_STORAGE ' + JSON.stringify(usb));
  const warning = warningLine(usb);
  if (warning) console.log(warning);
  const fails = evaluate(result);
  console.log(finalLine(fails));
  process.exitCode = fails.length ? 1 : 0;
}
main().catch(e => {
  console.error('ERROR ' + String(e && e.message || e));
  console.log('STAGE_READY FAIL fields=script_error');
  process.exitCode = 2;
});
