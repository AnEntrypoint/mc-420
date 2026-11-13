const fs = require("fs");
const net = require("net");
const dgram = require("dgram");
const { spawn, execFileSync } = require("child_process");
const D = process.argv[2];
const ASK = process.argv[3];
const HOST = "192.168.137.132";
const RATE = 48000;
const CH = 20;
const env = Object.assign({}, process.env, { SSH_ASKPASS: ASK, SSH_ASKPASS_REQUIRE: "force" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const send = (b) => new Promise((res, rej) => { const s = net.connect(9401, HOST, () => s.write(Buffer.from(b), (e) => { if (e) rej(e); s.end(); })); s.on("close", res); s.on("error", rej); });
const tele = () => new Promise((res, rej) => { const s = dgram.createSocket("udp4"); const t = setTimeout(() => { s.close(); rej(new Error("tele timeout")); }, 4000); s.on("message", (m) => { clearTimeout(t); s.close(); try { res(JSON.parse(m.toString().replace(/(?<=[\[,:])(-?nan|-?inf)(?=[,\]}])/gi, "null"))); } catch (e) { rej(e); } }); s.on("error", rej); s.send("status", 4445, HOST); });
const snap = (j) => ({ sustain_cmd: j.sustain_cmd, sustain_gate: j.sustain_gate, input_recordable: j.input_recordable, fx_bank: j.fx_bank, audio_peak: j.audio_peak, link: j.link, play: j.loopers.play, rec: j.loopers.rec, level0: j.loopers.level[0], wraplen0: j.loopers.wraplen[0], master_len: j.master_len_samples, recorded_beats: j.recorded_beats, beat_index: j.beat_mark.index, beat_valid: j.beat_mark.valid, beat_len_samples: j.groove.beat_len_samples });
const state = async () => snap(await tele());
const press = async (note, hold) => { await send([0x90, note, 127]); await sleep(hold || 80); await send([0x80, note, 0]); };
const toggle = async () => { await send([0x90, 0x62, 127]); await sleep(80); await send([0xB0, 64, 127]); await sleep(80); await send([0xB0, 64, 0]); await sleep(80); await send([0x80, 0x62, 0]); };
const ensureLatch = async (want) => { let s = await state(); if (s.sustain_cmd !== want) { await toggle(); await sleep(500); s = await state(); } return s; };
const ensureMode = async (want) => { let s = await state(); if (s.input_recordable[0] !== want) { await press(14, 80); await sleep(400); s = await state(); } return s; };
const clear0 = async () => { await press(2, 1500); await sleep(500); return state(); };
const ssh = (cmd) => execFileSync("setsid", ["ssh", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=10", "root@" + HOST, cmd], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const scp = (remote, dest) => execFileSync("setsid", ["scp", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=10", "root@" + HOST + ":" + remote, dest], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const listClips = () => { try { return ssh("find /media/aloop-usb/aloop-clips -name looper00.wav -print").split("\n").filter(Boolean); } catch (e) { return []; } };
const waitForNewClip = async (before) => { const until = Date.now() + 15000; for (;;) { const now = listClips(); const fresh = now.filter((p) => !before.includes(p)); if (fresh.length) return fresh[fresh.length - 1]; if (Date.now() > until) throw new Error("clip export did not write a WAV"); await sleep(300); } };
const triggerClip = async () => { await send([0x90, 0x5D, 127]); await sleep(80); await send([0x80, 0x5D, 0]); };
const capture = (file) => new Promise((res) => { const p = spawn("arecord", ["-q", "-D", "plughw:0,0", "-t", "raw", "-c", String(CH), "-f", "S32_LE", "-r", String(RATE), "-d", "8", file], { stdio: ["ignore", "ignore", "pipe"] }); let e = ""; p.stderr.on("data", (d) => { e += d; }); p.on("close", (c) => res({ file, code: c, err: e.trim() })); });
const waitTick = async () => { const s0 = await state(); const until = Date.now() + 3000; for (;;) { const s = await state(); if (s.beat_index !== s0.beat_index) return s; if (Date.now() > until) throw new Error("no beat tick"); await sleep(2); } };
const waitTicks = async (n) => { let s0 = await state(); for (let k = 0; k < n; k++) { const until = Date.now() + 3000; for (;;) { const s = await state(); if (s.beat_index !== s0.beat_index) { s0 = s; break; } if (Date.now() > until) throw new Error("beat tick missing"); await sleep(2); } } return s0; };
const onsetStats = (x) => { const W = 48; const n = Math.floor(x.length / W); const env2 = new Float64Array(n); for (let w = 0; w < n; w++) { let a = 0; for (let i = 0; i < W; i++) a += x[w * W + i] * x[w * W + i]; env2[w] = Math.sqrt(a / W); } const floor = Array.from(env2.slice(0, Math.min(300, n))).sort((a, b) => a - b)[Math.min(300, n) >> 1]; const thr = Math.max(floor * Math.pow(10, 10 / 20), 1e-6); let onsets = 0, last = -1e9; for (let w = 1; w < n; w++) if (env2[w] > thr && env2[w - 1] <= thr && w - last >= 60) { onsets++; last = w; } return { onsets, floor: +floor.toFixed(6), threshold: +thr.toFixed(6) }; };
const wavStats = (file) => { const b = fs.readFileSync(file); const frames = Math.floor((b.length - 44) / 4); const x = new Float64Array(frames); let s2 = 0, peak = 0; for (let f = 0; f < frames; f++) { const v = b.readFloatLE(44 + f * 4); x[f] = v; s2 += v * v; const a = Math.abs(v); if (a > peak) peak = a; } return Object.assign({ file: file.split("/").pop(), bytes: b.length, frames, seconds: +(frames / RATE).toFixed(3), rms: +Math.sqrt(s2 / frames).toFixed(6), peak: +peak.toFixed(6) }, onsetStats(x)); };
const rawStats = (file, c) => { const b = fs.readFileSync(file); const frames = Math.floor(b.length / (4 * CH)); const x = new Float64Array(frames); let s2 = 0, peak = 0; for (let f = 0; f < frames; f++) { const v = b.readInt32LE((f * CH + c) * 4) / 2147483648; x[f] = v; s2 += v * v; const a = Math.abs(v); if (a > peak) peak = a; } return Object.assign({ file: file.split("/").pop(), channel: c, rms: +Math.sqrt(s2 / frames).toFixed(6), peak: +peak.toFixed(6) }, onsetStats(x)); };
const conditions = [ { name: "passthrough-latch-on", mode: 0, latch: 1 }, { name: "processed-latch-on", mode: 1, latch: 1 }, { name: "passthrough-latch-off", mode: 0, latch: 0 }, { name: "processed-latch-off", mode: 1, latch: 0 } ];
const main = async () => {
  fs.mkdirSync(D, { recursive: true });
  const out = { conditions: [] };
  out.baseline = await state();
  if (out.baseline.play !== 0) { await clear0(); out.baselineAfterClear = await state(); }
  try {
    for (const c of conditions) {
      const row = { name: c.name };
      row.before = await state();
      row.latchSet = await ensureLatch(c.latch);
      row.modeSet = await ensureMode(c.mode);
      const capFile = D + "/cap-" + c.name + ".raw";
      const cap = capture(capFile);
      await sleep(1000);
      row.armTick = await waitTick();
      await press(2, 80);
      row.finishTick = await waitTicks(4);
      await press(2, 80);
      await sleep(2500);
      row.afterFinish = await state();
      row.capture = await cap;
      const beforeClips = listClips();
      await triggerClip();
      row.clipRemote = await waitForNewClip(beforeClips);
      row.clipLocal = D + "/clip-" + c.name + ".wav";
      scp(row.clipRemote, row.clipLocal);
      row.clipStats = wavStats(row.clipLocal);
      row.rawCh1 = rawStats(capFile, 1);
      row.beforeClear = await state();
      row.afterClear = await clear0();
      out.conditions.push(row);
    }
  } finally {
    out.finalLatch = await ensureLatch(1);
    out.finalMode = await ensureMode(0);
    out.finalClear = await clear0();
  }
  console.log(JSON.stringify(out, null, 1));
};
main().catch((e) => { console.error("record-tap-witness: " + e.message); process.exitCode = 2; });
