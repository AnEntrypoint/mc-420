#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const dgram = require('dgram');
const { Client } = require('ssh2');

const HOST = process.env.PI_HOST || '192.168.137.100';
const REMOTE_BIN = '/tmp/audio-injector';
const REMOTE_DIR = '/tmp/inject';
const REMOTE_LOG = '/tmp/inject.log';
const OUT_DIR = path.join(__dirname, '..', '..', '.witness', 'inject');

function readWav(file) {
  const b = fs.readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`${file} is not RIFF/WAVE`);
  }
  let off = 12;
  let fmt = null;
  let data = null;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4);
    const size = b.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ') {
      fmt = {
        format: b.readUInt16LE(body),
        channels: b.readUInt16LE(body + 2),
        rate: b.readUInt32LE(body + 4),
        bits: b.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      data = b.subarray(body, body + size);
    }
    off = body + size + (size % 2);
  }
  if (!fmt || !data) throw new Error(`${file}: no fmt/data chunk`);
  if (fmt.format !== 1) throw new Error(`${file}: need PCM, got format ${fmt.format}`);
  const bytes = fmt.bits / 8;
  const frames = Math.floor(data.length / bytes / fmt.channels);
  const mono = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let c = 0; c < fmt.channels; c++) {
      const o = (i * fmt.channels + c) * bytes;
      if (fmt.bits === 16) s += data.readInt16LE(o) / 32768;
      else if (fmt.bits === 32) s += data.readInt32LE(o) / 2147483648;
      else if (fmt.bits === 24) s += ((data[o] | (data[o + 1] << 8) | (data[o + 2] << 16)) << 8 >> 8) / 8388608;
      else if (fmt.bits === 8) s += (data[o] - 128) / 128;
      else throw new Error(`${file}: unsupported bits ${fmt.bits}`);
    }
    mono[i] = s / fmt.channels;
  }
  return { mono, rate: fmt.rate };
}

function resample(src, srcRate, dstRate) {
  if (srcRate === dstRate) return src;
  const r = srcRate / dstRate;
  const n = Math.floor(src.length / r);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const x = i * r;
    const i0 = Math.floor(x);
    const f = x - i0;
    const a = src[i0] || 0;
    const bv = src[i0 + 1] || 0;
    out[i] = a * (1 - f) + bv * f;
  }
  return out;
}

function toS32Stereo(mono, peak) {
  let mx = 0;
  for (let i = 0; i < mono.length; i++) mx = Math.max(mx, Math.abs(mono[i]));
  const norm = mx > 0 ? peak / mx : 0;
  const buf = Buffer.alloc(mono.length * 8);
  for (let i = 0; i < mono.length; i++) {
    let v = mono[i] * norm;
    if (v > 1) v = 1;
    if (v < -1) v = -1;
    const s = Math.round(v * 2147483647);
    buf.writeInt32LE(s, i * 8);
    buf.writeInt32LE(s, i * 8 + 4);
  }
  return buf;
}

function connect() {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => resolve(conn));
    conn.on('error', reject);
    conn.connect({ host: HOST, username: 'root', password: 'aloop', readyTimeout: 20000 });
  });
}

function exec(conn, c) {
  return new Promise((resolve, reject) => {
    conn.exec(c, (err, stream) => {
      if (err) return reject(err);
      let out = '';
      let errOut = '';
      stream.on('close', code => resolve({ code, out, errOut }));
      stream.on('data', d => { out += d.toString(); });
      stream.stderr.on('data', d => { errOut += d.toString(); });
    });
  });
}

function putFile(conn, local, remote, mode) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err);
      sftp.fastPut(local, remote, err2 => {
        if (err2) return reject(err2);
        if (!mode) return resolve();
        sftp.chmod(remote, mode, err3 => (err3 ? reject(err3) : resolve()));
      });
    });
  });
}

function getFile(conn, remote, local) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err);
      sftp.fastGet(remote, local, err2 => (err2 ? reject(err2) : resolve()));
    });
  });
}

function telemetry(timeoutMs = 4000) {
  return new Promise(resolve => {
    const s = dgram.createSocket('udp4');
    let done = false;
    const finish = v => {
      if (done) return;
      done = true;
      try { s.close(); } catch {}
      resolve(v);
    };
    s.on('message', m => {
      try { finish(JSON.parse(m.toString())); } catch { finish(null); }
    });
    s.on('error', () => finish(null));
    s.send('status', 4445, HOST);
    setTimeout(() => finish(null), timeoutMs);
  });
}

const REC_DIR = '/media/aloop-usb/aloop-rec';
const REMOTE_SLICE = '/tmp/inject_slice.raw';

function wavHeaderMono16(dataBytes) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + dataBytes, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(48000, 24);
  h.writeUInt32LE(96000, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(dataBytes, 40);
  return h;
}

async function cmdGrab(conn, seconds, outPath) {
  const list = `cd ${REC_DIR} && for f in aloop_chunk_*.wav; do echo "$f $(stat -c %Y:%s "$f")"; done`;
  const first = await exec(conn, list);
  await new Promise(r => setTimeout(r, 1500));
  const second = await exec(conn, list);
  const parse = s => {
    const m = new Map();
    for (const line of s.out.trim().split('\n')) {
      const [name, stamp] = line.trim().split(/\s+/);
      if (!name || !stamp) continue;
      const [mt, sz] = stamp.split(':');
      m.set(name, { mtime: Number(mt), size: Number(sz) });
    }
    return m;
  };
  const a = parse(first);
  const b = parse(second);
  let best = null;
  for (const [name, v] of b) {
    const prev = a.get(name);
    if (!prev || prev.size === undefined) continue;
    const grew = v.size - prev.size;
    if (grew > 0 && (!best || grew > best.grew)) best = { name, grew, size: v.size };
  }
  if (!best) throw new Error(`no growing chunk in ${REC_DIR}`);
  const wantBytes = Math.round(seconds * 48000) * 2;
  let offset = best.size - wantBytes;
  if (offset < 44) offset = 44;
  await exec(conn, `tail -c +${offset + 1} ${REC_DIR}/${best.name} > ${REMOTE_SLICE}`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const tmp = outPath + '.raw';
  await getFile(conn, REMOTE_SLICE, tmp);
  const raw = fs.readFileSync(tmp);
  fs.rmSync(tmp);
  fs.writeFileSync(outPath, Buffer.concat([wavHeaderMono16(raw.length), raw]));
  console.log(`[grab] ${best.name} (+${best.grew}B/1.5s) offset=${offset} -> ${outPath} (${(raw.length / 2 / 48000).toFixed(3)}s)`);
}

async function cmdPrepare(files, peak) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const f of files) {
    const { mono, rate } = readWav(f);
    const r = resample(mono, rate, 48000);
    const buf = toS32Stereo(r, peak);
    const out = path.join(OUT_DIR, path.basename(f).replace(/\.wav$/i, '') + '.s32le');
    fs.writeFileSync(out, buf);
    console.log(`[prepare] ${path.basename(f)} ${rate}Hz ${(mono.length / rate).toFixed(2)}s -> ${out} (${buf.length} bytes, ${(buf.length / 8 / 48000).toFixed(2)}s @48k stereo S32LE)`);
  }
}

async function cmdStart(conn, opts) {
  const localBin = path.join(OUT_DIR, 'audio-injector');
  if (fs.existsSync(localBin)) {
    await exec(conn, `pkill -f audio-injector 2>/dev/null; sleep 0.3; rm -f ${REMOTE_BIN}`);
    await putFile(conn, localBin, REMOTE_BIN, 0o755);
  }
  await exec(conn, `mkdir -p ${REMOTE_DIR}`);
  const remoteFile = opts.file;
  if (opts.local) {
    await putFile(conn, opts.local, remoteFile);
  }
  await exec(conn, `pkill -f audio-injector 2>/dev/null; sleep 0.3; rm -f ${REMOTE_LOG}`);
  const args = [
    `--device ${opts.device}`,
    `--file ${remoteFile}`,
    `--rate 48000`,
    `--channels 2`,
    `--period ${opts.period}`,
    `--buffer ${opts.buffer}`,
    `--secs ${opts.secs}`,
    `--gain ${opts.gain}`,
    `--loop ${opts.loop ? 1 : 0}`,
  ].join(' ');
  const r = await exec(
    conn,
    `nohup ${REMOTE_BIN} ${args} > ${REMOTE_LOG} 2>&1 & sleep 2; echo "pid=$(pgrep -f audio-injector | tr '\\n' ' ')"; head -5 ${REMOTE_LOG}`);
  console.log(`[start] ${opts.device} <- ${remoteFile} ${r.out.trim()}`);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const opts = { peak: 0.5, device: 'hw:2,1,0', period: '64', buffer: '256', secs: '0', gain: '1.0', loop: true };
  const files = [];
  for (const a of rest) {
    if (a.startsWith('--')) {
      const [k, v] = a.replace(/^--/, '').split('=');
      opts[k] = v === undefined ? true : v;
    } else {
      files.push(a);
    }
  }
  opts.peak = Number(opts.peak);

  if (cmd === 'prepare') {
    if (!files.length) {
      console.error('usage: node inject-alsa.js prepare <wav...> [--peak=0.5]');
      process.exit(2);
    }
    await cmdPrepare(files, opts.peak);
    return;
  }

  const conn = await connect();
  try {
    if (cmd === 'start') {
      opts.file = opts.file || `${REMOTE_DIR}/${path.basename(opts.local || 'x.s32le')}`;
      await cmdStart(conn, opts);
    } else if (cmd === 'stop') {
      const r = await exec(conn, `pkill -f audio-injector; echo stopped`);
      console.log(`[stop] ${r.out.trim()}`);
    } else if (cmd === 'log') {
      const r = await exec(conn, `tail -20 ${REMOTE_LOG} 2>&1`);
      console.log(r.out.trim() || r.errOut.trim());
    } else if (cmd === 'peak') {
      const t = await telemetry();
      if (!t) throw new Error('no telemetry reply');
      console.log(`[peak] audio_peak=${JSON.stringify(t.audio_peak)} eff_speed=${t.eff_speed} xruns=${t.xruns}`);
    } else if (cmd === 'probe') {
      const r = await exec(conn, `${REMOTE_BIN} --device ${opts.device} 2>&1 | head -5`);
      console.log(r.out.trim() || r.errOut.trim());
    } else if (cmd === 'grab') {
      const seconds = Number(files[0] || '5');
      const outPath = files[1] || path.join(OUT_DIR, 'grab.wav');
      await cmdGrab(conn, seconds, outPath);
    } else if (cmd === 'fetch-bin') {
      fs.mkdirSync(OUT_DIR, { recursive: true });
      await getFile(conn, REMOTE_BIN, path.join(OUT_DIR, 'audio-injector'));
      console.log(`[fetch-bin] -> ${path.join(OUT_DIR, 'audio-injector')}`);
    } else {
      console.error('usage: node inject-alsa.js <prepare|start|stop|log|peak|probe> [args] [--file=remote] [--local=local] [--device=hw:2,1,0] [--secs=0] [--gain=1] [--peak=0.5]');
      process.exit(2);
    }
  } finally {
    conn.end();
  }
}

main().catch(e => { console.error('[inject-alsa] error:', e.message); process.exit(1); });
