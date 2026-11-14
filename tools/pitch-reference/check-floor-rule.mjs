import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
const root = process.argv[2];
const wav = path.join(root, "test-audio-corpus/instruments/vocal_tenor_operatic_PD.wav");
const comb = path.join(root, "tools/pitch-reference/comb.mjs");
const sub = path.join(root, "tools/pitch-reference/submultiple.mjs");
const archive = path.join(root, "docs/measurements-archive.md");
const opts = { cwd: root, encoding: "utf8", maxBuffer: 4 * 1024 * 1024, env: Object.assign({}, process.env, { NODE_OPTIONS: "--max-old-space-size=96" }) };
const combOut = execFileSync("node", ["--max-old-space-size=96", comb, "--src", "test-audio-corpus/instruments", "--only", "vocal_tenor_operatic_PD", "--seconds", "6"], opts);
const subOut = execFileSync("node", ["--max-old-space-size=96", sub, "--wav", "test-audio-corpus/instruments/vocal_tenor_operatic_PD.wav", "--peak", "461.06", "--lo", "100", "--hi", "150", "--seconds", "6"], opts);
const rule = fs.readFileSync(archive, "utf8");
const checks = [
  ["comb certifies 114.18", combOut.includes("vocal_tenor_operatic_PD") && combOut.includes("114.18") && combOut.includes("certified")],
  ["submultiple finds no clearing candidate", /clearing candidates in band:\s*0/.test(subOut)],
  ["submultiple excludes file", subOut.includes("file stays excluded")],
  ["archive states both floors", rule.includes("archive#pitch-reference-floor-rule") && rule.includes("60-4000 Hz") && rule.includes("100-150 Hz") && rule.includes("12 dB")]
];
const failed = checks.filter((x) => !x[1]).map((x) => x[0]);
const combLine = combOut.split("\n").find((x) => x.includes("vocal_tenor_operatic_PD")) || "";
const subLine = subOut.split("\n").filter((x) => x.includes("clearing candidates") || x.includes("verdict")).join(" | ");
console.log(JSON.stringify({ checks: checks.length, failed, pass: failed.length === 0, combLine, subLine, wav: fs.statSync(wav).size, heapMb: 96 }));
if (failed.length) process.exitCode = 1;
