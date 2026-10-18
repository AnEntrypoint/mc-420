import fs from "node:fs";
import { execFileSync } from "node:child_process";
const S = "/tmp/claude-1000/-config-workspace-mc-420/552e4f18-f9c8-4f76-973c-a987b5ca102c/scratchpad/lowhz/lk";
const LOCK = S + "/lock";
const CORPUS = "/config/workspace/mc-420/test-audio-corpus/instruments/";
const lines = fs.readFileSync(S + "/table.tsv", "utf8").trim().split("\n");
const variants = lines[0].split("\t").slice(2);
const rows = lines.slice(1).map(l => l.split("\t"));
fs.mkdirSync(S + "/out", { recursive: true });
const res = [];
for (const r of rows) {
  const name = r[0], note = +r[1];
  const target = 440 * Math.pow(2, (note - 69) / 12);
  const src = name.startsWith("sine_") ? "sine:" + name.slice(5) + ":6" : "wav:" + CORPUS + name + ".wav";
  variants.forEach((v, i) => {
    const trk = r[2 + i];
    if (trk === "NA" || trk === "NaN") { res.push([v, name, note, trk, "NA", "NA", "NA"].join("\t")); return; }
    const wav = S + "/out/" + v + "__" + name + ".wav";
    try {
      execFileSync(LOCK, ["--gen0", src, "--gen4", "const:" + trk + ":6", "--gen5", "const:" + note + ":6", "--gen6", "const:1:6", wav], { stdio: "pipe" });
      const p = execFileSync(LOCK, ["--pitch", wav, "from=0.4", "to=1.4", "hz=" + target.toFixed(4)], { encoding: "utf8" });
      const m = /measured=([\d.]+),cents=([-+\d.]+),ncc=([\d.]+)/.exec(p);
      res.push([v, name, note, trk, m ? m[1] : "ERR", m ? m[2] : "ERR", m ? m[3] : "ERR"].join("\t"));
      fs.unlinkSync(wav);
    } catch (e) { res.push([v, name, note, trk, "EXC", "EXC", String(e.message).slice(0,80)].join("\t")); }
  });
}
fs.writeFileSync(S + "/lock_results.tsv", "variant\tname\tnote\ttracker\tlock_hz\tcents\tncc\n" + res.join("\n") + "\n");
console.log("done", res.length);
