#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const json = args.includes("--json");
const files = args.filter((a) => a !== "--json");
if (files.length === 0) {
  console.error("usage: node tools/witness-summary/summarise.mjs [--json] <log> [<log> ...]");
  process.exit(2);
}

const num = (s) => (s === undefined ? null : Number(s));

function parse(file) {
  const rec = {
    file: path.basename(file), host: null, play: null, source: null, note: null,
    expect_hz: null, lock_hz: null, cents: null, octaves_off: null, verdict: null, seg_rms: null,
    silent_rms: null, valid_hops: null, octave_jumps: null, trajectory: null, exit: null,
  };
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    let m;
    if ((m = /^\[loopback-witness\] host=(\S+) play=(\S+)/.exec(line))) {
      rec.host = m[1];
      rec.play = m[2];
    } else if ((m = /silent control .*seg rms ([\d.]+)/.exec(line))) {
      rec.silent_rms = num(m[1]);
    } else if ((m = /LOCK source=(\S+) note=(\d+) expect ([\d.]+) Hz/.exec(line))) {
      rec.source = m[1];
      rec.note = num(m[2]);
      rec.expect_hz = num(m[3]);
    } else if ((m = /LOCK note=(\d+) expect ([\d.]+) Hz measured ([\d.]+) Hz .*?-> ([-+\d.]+) cents, octaves off (\d+)/.exec(line))) {
      rec.note = num(m[1]);
      rec.expect_hz = num(m[2]);
      rec.lock_hz = num(m[3]);
      rec.cents = num(m[4]);
      rec.verdict = "MEASURED";
      rec.octaves_off = num(m[5]);
      const seg = /seg rms ([\d.]+)/.exec(line);
      const sil = /silent rms ([\d.]+)/.exec(line);
      if (seg) rec.seg_rms = num(seg[1]);
      if (sil) rec.silent_rms = num(sil[1]);
    } else if ((m = /LOCK note=(\d+) expect ([\d.]+) Hz (?:measured )?(NOT DETECTED|\S+)(.*)$/.exec(line))) {
      rec.note = num(m[1]);
      rec.expect_hz = num(m[2]);
      rec.verdict = m[3].replace(" ", "_");
      const rest = m[4];
      const seg = /seg rms ([\d.]+)/.exec(rest);
      const sil = /silent rms ([\d.]+)/.exec(rest);
      const hops = /(\d+) valid hops/.exec(rest);
      const meas = /measured ([\d.]+) Hz/.exec(rest);
      const cents = /cents[ =:]([-+\d.]+)/.exec(rest);
      if (seg) rec.seg_rms = num(seg[1]);
      if (sil) rec.silent_rms = num(sil[1]);
      if (hops) rec.valid_hops = num(hops[1]);
      if (meas) rec.lock_hz = num(meas[1]);
      if (cents) rec.cents = num(cents[1]);
    } else if ((m = /trajectory .*: (.+)$/.exec(line))) {
      rec.trajectory = m[1].trim().split(/\s+/).map((t) => (t === "-" ? null : Number(t)));
    } else if ((m = /octave jumps in first 2s: (\d+)(?: \[[^\]]*\])? of (\d+) valid hops/.exec(line))) {
      rec.octave_jumps = num(m[1]);
      rec.valid_hops = num(m[2]);
    } else if ((m = /^exit=(\d+)/.exec(line))) {
      rec.exit = num(m[1]);
    }
  }
  return rec;
}

const records = files.map(parse);
if (json) {
  for (const r of records) console.log(JSON.stringify(r));
} else {
  const cols = ["file", "host", "play", "note", "expect_hz", "lock_hz", "cents", "octaves_off",
    "verdict", "seg_rms", "silent_rms", "valid_hops", "octave_jumps", "exit"];
  console.log(cols.join("\t"));
  for (const r of records) console.log(cols.map((c) => (r[c] === null ? "-" : r[c])).join("\t"));
}
