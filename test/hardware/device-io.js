const net = require('net');
const dgram = require('dgram');

const kMidiPort = 9401;
const kTelemetryPort = 4445;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function deriveTempoQuantBeats(seconds, anchorBpm, powersOfTwoOnly = true) {
  const anchor = anchorBpm > 1 ? anchorBpm : 120;
  const maxBeats = powersOfTwoOnly ? 64 : 128;
  let best = 16;
  let bestScore = Infinity;
  let bestInWindow = false;
  for (let beats = 1; beats <= maxBeats; beats = powersOfTwoOnly ? beats * 2 : beats + 1) {
    const bpm = (60 * beats) / seconds;
    const inWindow = bpm >= anchor * 0.5 && bpm <= anchor * 2;
    const score = Math.abs(Math.log2(bpm / anchor));
    if ((inWindow && !bestInWindow) || (inWindow === bestInWindow && score < bestScore)) {
      best = beats;
      bestScore = score;
      bestInWindow = inWindow;
    }
  }
  return best;
}

function deviceIo(host) {
  function sendBytes(bytes) {
    return new Promise((resolve, reject) => {
      const sock = net.connect({ host, port: kMidiPort }, () => {
        sock.write(Buffer.from(bytes), (err) => {
          if (err) return reject(err);
          sock.end();
        });
      });
      sock.setTimeout(5000);
      sock.on('timeout', () => { sock.destroy(); reject(new Error(`connect/write to ${host}:${kMidiPort} timed out after 5s`)); });
      sock.on('close', resolve);
      sock.on('error', reject);
    });
  }

  function queryTelemetry() {
    return new Promise((resolve, reject) => {
      const sock = dgram.createSocket('udp4');
      const timer = setTimeout(() => { sock.close(); reject(new Error('telemetry query timed out')); }, 3000);
      sock.on('message', (msg) => {
        clearTimeout(timer);
        sock.close();
        try { resolve(JSON.parse(msg.toString())); }
        catch (e) { reject(e); }
      });
      sock.on('error', (e) => { clearTimeout(timer); reject(e); });
      sock.send('status', kTelemetryPort, host);
    });
  }

  const pressPad = (note) => sendBytes([0x90, note, 127]);
  const releasePad = (note) => sendBytes([0x80, note, 0]);

  return { sendBytes, queryTelemetry, pressPad, releasePad };
}

module.exports = { deviceIo, sleep, deriveTempoQuantBeats };
