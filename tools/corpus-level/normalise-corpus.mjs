#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const src = flag("--src", "test-audio-corpus/instruments");
const out = flag("--out", "");
const rmsTarget = Number(flag("--rms", "0.1"));
const floor = Number(flag("--floor", "1e-6"));
if (!out) {
  console.error("usage: node tools/corpus-level/normalise-corpus.mjs --out <dir> [--src <dir>] [--rms 0.1] [--floor 1e-6]");
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });

const files = fs.readdirSync(src).filter((f) => f.endsWith(".wav")).sort();
const rows = [];
for (const f of files) {
  const b = fs.readFileSync(path.join(src, f));
  let off = 12;
  let d = null;
  while (off + 8 <= b.length) {
    const id = b.toString("ascii", off, off + 4);
    const sz = b.readUInt32LE(off + 4);
    if (id === "data") { d = { s: off + 8, n: sz / 2 }; break; }
    off += 8 + sz + (sz & 1);
  }
  if (!d) { rows.push([f, "no data chunk", "", "", "no"]); continue; }
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < d.n; i++) {
    const v = b.readInt16LE(d.s + 2 * i) / 32768;
    sum += v * v;
    const a = Math.abs(v);
    if (a > peak) peak = a;
  }
  const rms = Math.sqrt(sum / d.n);
  let scale = rms > 0 ? rmsTarget / rms : 1;
  let capped = false;
  if (peak > 0 && scale * peak > 0.9) {
    scale = 0.9 / peak;
    capped = true;
  }
  const size = d.n * 2;
  const w = Buffer.alloc(44 + size);
  w.write("RIFF", 0);
  w.writeUInt32LE(36 + size, 4);
  w.write("WAVE", 8);
  w.write("fmt ", 12);
  w.writeUInt32LE(16, 16);
  w.writeUInt16LE(1, 20);
  w.writeUInt16LE(1, 22);
  w.writeUInt32LE(48000, 24);
  w.writeUInt32LE(96000, 28);
  w.writeUInt16LE(2, 32);
  w.writeUInt16LE(16, 34);
  w.write("data", 36);
  w.writeUInt32LE(size, 40);
  for (let i = 0; i < d.n; i++) {
    const v = (b.readInt16LE(d.s + 2 * i) / 32768) * scale;
    const c = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
    w.writeInt16LE(c, 44 + 2 * i);
  }
  fs.writeFileSync(path.join(out, f), w);
  const outRms = rms * scale;
  const env = outRms * outRms;
  rows.push([f, rms.toFixed(6), scale.toFixed(3), (env > floor ? "yes" : "no"), capped ? "written-capped" : "written"]);
}
const ready = rows.filter((r) => r[4].startsWith("written") && r[3] === "yes").length;
const written = rows.filter((r) => r[4].startsWith("written")).length;
console.log("files " + files.length + " written " + written + " clearing floor " + ready);
for (const r of rows) console.log(r.join(" "));
