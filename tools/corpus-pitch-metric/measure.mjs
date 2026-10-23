#!/usr/bin/env node
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..");
const DEFAULT_REFERENCE = "docs/witness/corpus-pitch-reference.md";
const DEFAULT_CORPUS = "test-audio-corpus/instruments";
const DEFAULT_DSP_CLI = "/tmp/dsp_cli";
const DEFAULT_OCTAVE_TOLERANCE_CENTS = 50;
const VOICED_CONFIDENCE_GATE = 0.5;
const METRIC_VERSION = 1;

const THRESHOLD_KEYS = [
  "median_abs_cents_max",
  "p90_abs_cents_max",
  "octave_errors_max",
  "min_voiced_frames_per_second",
  "min_scored_files",
  "octave_cents_tolerance",
  "max_median_regression_cents",
  "max_p90_regression_cents",
  "max_regressed_files",
];

const USAGE = `usage: node tools/corpus-pitch-metric/measure.mjs --thresholds <json> [options]

  --thresholds <json>   required: pass/fail limits, read before anything is measured
  --corpus <dir>        wav directory to score (default ${DEFAULT_CORPUS})
  --reference <file>    measured-peak table (default ${DEFAULT_REFERENCE})
  --dsp-cli <path>      dsp_cli binary (default ${DEFAULT_DSP_CLI})
  --semis <n>           corpus is shifted by n semitones; the reference shifts with it
  --out <file>          write the JSON report
  --baseline <file>     previous JSON report; adds per-file deltas
  --json                print the JSON report instead of the table
  --include-phrase      gate phrase files too (default: measured, not gated)

Every file is scored against the measured peak in the reference table, never against the
note in its filename. Files with no reliable measured peak are listed as excluded and are
never measured. --thresholds is mandatory: without it no number is printed, so a limit can
never be picked after the numbers have been seen.`;

function die(message, code) {
  process.stderr.write(`corpus-pitch-metric: ${message}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const flagNames = new Set(["--json", "--help", "--include-phrase"]);
  const valueNames = new Set([
    "--corpus", "--out", "--baseline", "--thresholds", "--reference", "--dsp-cli", "--semis",
  ]);
  const opts = { flags: new Set(), values: {} };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    let key = arg;
    let val = null;
    const eq = arg.indexOf("=");
    if (arg.startsWith("--") && eq > 0) {
      key = arg.slice(0, eq);
      val = arg.slice(eq + 1);
    }
    if (flagNames.has(key)) {
      opts.flags.add(key);
      continue;
    }
    if (valueNames.has(key)) {
      if (val === null) val = argv[++i];
      if (val === undefined || val === null) throw new Error(`${key} needs a value`);
      opts.values[key] = val;
      continue;
    }
    throw new Error(`unknown argument ${arg}`);
  }
  return opts;
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function readWavSeconds(file) {
  const buf = fs.readFileSync(file);
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF") return null;
  let at = 12;
  let sampleRate = 0;
  let channels = 0;
  let bits = 0;
  let dataBytes = 0;
  while (at + 8 <= buf.length) {
    const id = buf.toString("ascii", at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    const body = at + 8;
    if (id === "fmt " && body + 16 <= buf.length) {
      channels = buf.readUInt16LE(body + 2);
      sampleRate = buf.readUInt32LE(body + 4);
      bits = buf.readUInt16LE(body + 14);
    } else if (id === "data") {
      dataBytes = Math.min(size, buf.length - body);
    }
    at = body + size + (size % 2);
  }
  const bytesPerFrame = channels * (bits / 8);
  if (!sampleRate || !bytesPerFrame || !dataBytes) return null;
  return dataBytes / bytesPerFrame / sampleRate;
}

function parseReference(file) {
  const text = fs.readFileSync(file, "utf8");
  const phrase = new Set();
  for (const rawLine of text.split("\n")) {
    const phraseHit = /`?([A-Za-z0-9_]+)`? is a PHRASE/.exec(rawLine.trim());
    if (phraseHit) phrase.add(phraseHit[1]);
  }
  const reliable = new Map();
  const notReliable = new Map();
  let section = "";
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    const heading = /^##\s+(.*)$/.exec(line);
    if (heading) {
      section = heading[1];
      continue;
    }
    if (!line.startsWith("|")) continue;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim().replace(/^`+|`+$/g, ""));
    if (cells.length < 3) continue;
    const name = cells[0];
    if (!/^[A-Za-z0-9_]+$/.test(name)) continue;
    if (/^(file|note|---+)$/i.test(name)) continue;
    if (/^Reliable/i.test(section)) {
      const peakHz = Number(cells[2]);
      if (!Number.isFinite(peakHz) || peakHz <= 0) continue;
      const labelMatch = /([0-9]+(?:\.[0-9]+)?)\s*(?:Hz)?\s*$/.exec(cells[1] || "");
      const labelHz = labelMatch ? Number(labelMatch[1]) : null;
      reliable.set(name, {
        file: name,
        peakHz,
        labelHz: Number.isFinite(labelHz) ? labelHz : null,
        labelNote: (cells[1] || "").replace(/[0-9.]+\s*(?:Hz)?\s*$/, "").trim() || null,
        phrase: phrase.has(name),
      });
    } else if (/^Not reliable/i.test(section)) {
      const peakHz = Number(cells[1]);
      if (!Number.isFinite(peakHz) || peakHz <= 0) continue;
      notReliable.set(name, {
        file: name,
        peakHz,
        reason: cells[3] || "measured peak is not the fundamental",
      });
    }
  }
  return { path: file, sha256: sha256File(file), reliable, notReliable };
}

function loadThresholds(file) {
  const text = fs.readFileSync(file, "utf8");
  const parsed = JSON.parse(text);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("thresholds must be a JSON object");
  }
  const unknown = Object.keys(parsed).filter(
    (k) => !k.startsWith("_") && !THRESHOLD_KEYS.includes(k),
  );
  if (unknown.length) throw new Error(`unknown threshold key(s): ${unknown.join(", ")}`);
  const out = {};
  for (const key of THRESHOLD_KEYS) {
    const value = parsed[key];
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`threshold ${key} must be a finite number`);
    }
    out[key] = value;
  }
  if (Object.keys(out).length === 0) throw new Error("thresholds file names no limit");
  return { values: out, sha256: crypto.createHash("sha256").update(text).digest("hex") };
}

const TRK_LINE =
  /^trk,t=([0-9.]+)s,valid=([01]),period=\s*([0-9.]+),cents=\s*([+-][0-9.]+),conf=([0-9.]+),peakTau=(-?[0-9]+)/;

function measureFile(dspCli, wav, referenceHz) {
  let out;
  try {
    out = execFileSync(dspCli, ["--trk", wav, `hz=${referenceHz}`, "trace=1"], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
  } catch (err) {
    throw new Error(`dsp_cli --trk failed on ${wav}: ${err.message.split("\n")[0]}`);
  }
  const frames = [];
  for (const line of out.split("\n")) {
    const m = TRK_LINE.exec(line.trim());
    if (!m) continue;
    frames.push({
      t: Number(m[1]),
      voiced: m[2] === "1",
      cents: Number(m[4]),
      confidence: Number(m[5]),
    });
  }
  return frames;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[i];
}

function round(value, digits) {
  return value === null || value === undefined ? null : Number(value.toFixed(digits));
}

function isOctaveError(absCents, tolerance) {
  if (!(absCents > 0)) return false;
  const k = Math.round(absCents / 1200);
  return k >= 1 && Math.abs(absCents - k * 1200) <= tolerance;
}

function scoreFile(entry, frames, thresholds, seconds, tolerance) {
  const voiced = frames.filter((f) => f.voiced && f.confidence >= VOICED_CONFIDENCE_GATE);
  const absCents = voiced.map((f) => Math.abs(f.cents)).sort((a, b) => a - b);
  const median = percentile(absCents, 0.5);
  const p10 = percentile(absCents, 0.1);
  const p90 = percentile(absCents, 0.9);
  const octaveErrors = absCents.reduce(
    (n, c) => n + (isOctaveError(c, tolerance) ? 1 : 0),
    0,
  );
  const failures = [];
  if (voiced.length === 0) {
    failures.push("no voiced frames");
  } else {
    const minVoiced =
      thresholds.min_voiced_frames_per_second !== undefined && seconds > 0
        ? Math.ceil(thresholds.min_voiced_frames_per_second * seconds)
        : 0;
    if (minVoiced > 0 && voiced.length < minVoiced) {
      failures.push(`voiced ${voiced.length} < ${minVoiced}`);
    }
    if (thresholds.median_abs_cents_max !== undefined && median > thresholds.median_abs_cents_max) {
      failures.push(`median ${median.toFixed(1)} > ${thresholds.median_abs_cents_max}`);
    }
    if (thresholds.p90_abs_cents_max !== undefined && p90 > thresholds.p90_abs_cents_max) {
      failures.push(`p90 ${p90.toFixed(1)} > ${thresholds.p90_abs_cents_max}`);
    }
    if (thresholds.octave_errors_max !== undefined && octaveErrors > thresholds.octave_errors_max) {
      failures.push(`octave ${octaveErrors} > ${thresholds.octave_errors_max}`);
    }
  }
  return {
    file: entry.file,
    reference_peak_hz: round(entry.peakHz, 2),
    reference_hz: round(entry.shiftedHz, 2),
    label_hz: entry.labelHz === null ? null : round(entry.labelHz, 2),
    label_peak_error_cents:
      entry.labelHz && entry.labelHz > 0
        ? round(1200 * Math.log2(entry.peakHz / entry.labelHz), 1)
        : null,
    seconds: round(seconds, 3),
    frames: frames.length,
    voiced_frames: voiced.length,
    median_abs_cents: round(median, 1),
    p10_abs_cents: round(p10, 1),
    p90_abs_cents: round(p90, 1),
    octave_errors: octaveErrors,
    phrase: entry.phrase === true,
    gated: entry.gated,
    verdict: entry.gated ? (failures.length ? "FAIL" : "PASS") : "NOT GATED",
    failures,
  };
}

function formatNum(value, width, digits) {
  if (value === null || value === undefined) return "-".padStart(width);
  return value.toFixed(digits).padStart(width);
}

function printTable(rows) {
  const head = [
    "file".padEnd(22),
    "ref_hz".padStart(8),
    "label_hz".padStart(9),
    "voiced".padStart(11),
    "median".padStart(7),
    "p10".padStart(7),
    "p90".padStart(7),
    "oct".padStart(4),
    "  verdict",
  ];
  console.log(head.join(" "));
  for (const row of rows) {
    console.log(
      [
        row.file.padEnd(22),
        formatNum(row.reference_hz, 8, 2),
        formatNum(row.label_hz, 9, 2),
        `${row.voiced_frames}/${row.frames}`.padStart(11),
        formatNum(row.median_abs_cents, 7, 1),
        formatNum(row.p10_abs_cents, 7, 1),
        formatNum(row.p90_abs_cents, 7, 1),
        String(row.octave_errors).padStart(4),
        `  ${row.verdict}${row.failures.length ? ` (${row.failures.join("; ")})` : ""}`,
      ].join(" "),
    );
  }
}

function printDeltas(deltas) {
  console.log(
    ["file".padEnd(22), "median".padStart(8), "p90".padStart(8), "oct".padStart(5), "voiced".padStart(8)].join(" "),
  );
  for (const d of deltas) {
    const fmt = (v, digits, width) =>
      v === null || v === undefined
        ? "-".padStart(width)
        : `${v > 0 ? "+" : ""}${v.toFixed(digits)}`.padStart(width);
    console.log(
      [
        d.file.padEnd(22),
        fmt(d.median_abs_cents, 1, 8),
        fmt(d.p90_abs_cents, 1, 8),
        fmt(d.octave_errors, 0, 5),
        fmt(d.voiced_frames, 0, 8),
        d.regressed ? "  REGRESSED" : "",
      ].join(" "),
    );
  }
}

function numericDelta(current, baseline) {
  const a = current === null || current === undefined ? null : current;
  const b = baseline === null || baseline === undefined ? null : baseline;
  if (a === null || b === null) return null;
  return round(a - b, 3);
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    die(`${err.message}\n\n${USAGE}`, 2);
  }
  if (opts.flags.has("--help")) {
    console.log(USAGE);
    process.exit(0);
  }

  const thresholdsPath = opts.values["--thresholds"];
  if (!thresholdsPath) {
    die(
      "refusing to measure without --thresholds: no number is printed until the limits are\n" +
        "supplied, so a limit cannot be chosen after the numbers have been seen.\n\n" + USAGE,
      2,
    );
  }

  let thresholds;
  try {
    thresholds = loadThresholds(path.resolve(REPO_ROOT, thresholdsPath));
  } catch (err) {
    die(`cannot read thresholds ${thresholdsPath}: ${err.message}`, 2);
  }
  const tolerance =
    thresholds.values.octave_cents_tolerance !== undefined
      ? thresholds.values.octave_cents_tolerance
      : DEFAULT_OCTAVE_TOLERANCE_CENTS;

  const referencePath = path.resolve(REPO_ROOT, opts.values["--reference"] || DEFAULT_REFERENCE);
  let reference;
  try {
    reference = parseReference(referencePath);
  } catch (err) {
    die(`cannot read reference ${referencePath}: ${err.message}`, 2);
  }

  const corpusDir = path.resolve(REPO_ROOT, opts.values["--corpus"] || DEFAULT_CORPUS);
  if (!fs.existsSync(corpusDir)) die(`corpus directory not found: ${corpusDir}`, 2);
  const dspCli = path.resolve(REPO_ROOT, opts.values["--dsp-cli"] || DEFAULT_DSP_CLI);
  const semis = opts.values["--semis"] === undefined ? 0 : Number(opts.values["--semis"]);
  if (!Number.isFinite(semis)) die("--semis must be a number", 2);
  const includePhrase = opts.flags.has("--include-phrase");

  const corpusFiles = fs
    .readdirSync(corpusDir)
    .filter((n) => n.toLowerCase().endsWith(".wav"))
    .sort();

  const rows = [];
  const excluded = [];
  for (const wav of corpusFiles) {
    const name = wav.replace(/\.wav$/i, "");
    const reliable = reference.reliable.get(name);
    if (!reliable) {
      const bad = reference.notReliable.get(name);
      excluded.push({
        file: name,
        measured_peak_hz: bad ? round(bad.peakHz, 2) : null,
        reason: bad
          ? `not reliable: ${bad.reason}`
          : `no measured peak in ${path.relative(REPO_ROOT, referencePath)}; the filename note is not a reference`,
      });
      continue;
    }
    const entry = {
      ...reliable,
      shiftedHz: reliable.peakHz * Math.pow(2, semis / 12),
      gated: !(reliable.phrase && !includePhrase),
    };
    const wavPath = path.join(corpusDir, wav);
    const seconds = readWavSeconds(wavPath);
    let frames;
    try {
      frames = measureFile(dspCli, wavPath, entry.shiftedHz);
    } catch (err) {
      die(err.message, 3);
    }
    rows.push(scoreFile(entry, frames, thresholds.values, seconds === null ? 0 : seconds, tolerance));
  }

  const missing = [...reference.reliable.keys()]
    .filter((n) => !corpusFiles.some((w) => w.replace(/\.wav$/i, "") === n))
    .sort();

  const gated = rows.filter((r) => r.gated);
  const failures = gated.filter((r) => r.failures.length > 0);
  if (thresholds.values.min_scored_files !== undefined && gated.length < thresholds.values.min_scored_files) {
    failures.push({
      file: "<corpus>",
      failures: [`scored ${gated.length} < min_scored_files ${thresholds.values.min_scored_files}`],
    });
  }

  const report = {
    tool: "corpus-pitch-metric",
    metric_version: METRIC_VERSION,
    generated_utc: new Date().toISOString(),
    reference: {
      path: path.relative(REPO_ROOT, referencePath),
      sha256: reference.sha256,
      reliable_rows: reference.reliable.size,
      not_reliable_rows: reference.notReliable.size,
    },
    corpus_dir: path.relative(REPO_ROOT, corpusDir),
    dsp_cli: opts.values["--dsp-cli"] || DEFAULT_DSP_CLI,
    semis,
    include_phrase: includePhrase,
    thresholds: thresholds.values,
    thresholds_sha256: thresholds.sha256,
    octave_cents_tolerance: tolerance,
    files: rows,
    excluded,
    missing_from_corpus: missing,
    summary: {
      corpus_files: corpusFiles.length,
      scored: rows.length,
      gated: gated.length,
      excluded: excluded.length,
      failures: failures.length,
      regressions: 0,
      pass: failures.length === 0,
    },
  };

  let incomparable = null;
  const regressions = [];
  if (opts.values["--baseline"]) {
    const baselinePath = path.resolve(REPO_ROOT, opts.values["--baseline"]);
    let baseline;
    try {
      baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
    } catch (err) {
      die(`cannot read baseline ${baselinePath}: ${err.message}`, 2);
    }
    const byName = new Map((baseline.files || []).map((f) => [f.file, f]));
    const deltas = rows.map((r) => {
      const b = byName.get(r.file) || {};
      return {
        file: r.file,
        median_abs_cents: numericDelta(r.median_abs_cents, b.median_abs_cents),
        p90_abs_cents: numericDelta(r.p90_abs_cents, b.p90_abs_cents),
        octave_errors: numericDelta(r.octave_errors, b.octave_errors),
        voiced_frames: numericDelta(r.voiced_frames, b.voiced_frames),
      };
    });
    const reasons = [];
    if (baseline.thresholds_sha256 !== report.thresholds_sha256) reasons.push("thresholds changed");
    if (baseline.reference && baseline.reference.sha256 !== report.reference.sha256) {
      reasons.push("reference table changed");
    }
    if (baseline.semis !== report.semis) reasons.push(`semis ${baseline.semis} -> ${report.semis}`);
    report.baseline = {
      path: path.relative(REPO_ROOT, baselinePath),
      comparable: reasons.length === 0,
      reasons,
      deltas,
    };
    if (reasons.length) incomparable = reasons.join(", ");
    if (!incomparable) {
      const medianTol = thresholds.values.max_median_regression_cents;
      const p90Tol = thresholds.values.max_p90_regression_cents;
      for (const d of deltas) {
        const worse = [];
        if (medianTol !== undefined && d.median_abs_cents !== null && d.median_abs_cents > medianTol) {
          worse.push(`median +${d.median_abs_cents.toFixed(1)}c`);
        }
        if (p90Tol !== undefined && d.p90_abs_cents !== null && d.p90_abs_cents > p90Tol) {
          worse.push(`p90 +${d.p90_abs_cents.toFixed(1)}c`);
        }
        if (worse.length) {
          d.regressed = true;
          regressions.push({ file: d.file, failures: [`regression vs baseline: ${worse.join("; ")}`] });
        } else {
          d.regressed = false;
        }
      }
    }
  }
  for (const r of regressions) {
    const target = rows.find((row) => row.file === r.file);
    if (target) target.verdict = "REGRESSED";
  }
  if (
    thresholds.values.max_regressed_files !== undefined &&
    regressions.length > thresholds.values.max_regressed_files
  ) {
    regressions.push({
      file: "<corpus>",
      failures: [`regressed ${regressions.length} > max_regressed_files ${thresholds.values.max_regressed_files}`],
    });
  }
  report.summary.regressions = regressions.length;
  report.summary.failures = failures.length;
  report.summary.pass = failures.length === 0 && regressions.length === 0 && !incomparable;

  if (opts.values["--out"]) {
    fs.writeFileSync(path.resolve(REPO_ROOT, opts.values["--out"]), `${JSON.stringify(report, null, 2)}\n`);
  }

  if (opts.flags.has("--json")) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.summary.pass && !incomparable ? 0 : 1);
  }

  console.log(
    `corpus-pitch-metric v${METRIC_VERSION}  reference=${report.reference.path}  sha256=${report.reference.sha256.slice(0, 12)}  semis=${semis}  dsp-cli=${report.dsp_cli}`,
  );
  console.log(`thresholds ${JSON.stringify(thresholds.values)}  sha256=${thresholds.sha256.slice(0, 12)}`);
  console.log(`octave error window +/-${tolerance}c around a nonzero multiple of 1200c`);
  console.log("");
  printTable(rows);
  console.log("");
  if (excluded.length) {
    console.log(`excluded (never scored):`);
    for (const e of excluded) {
      console.log(
        `  ${e.file.padEnd(22)} ${e.measured_peak_hz === null ? "-".padStart(8) : e.measured_peak_hz.toFixed(2).padStart(8)}  ${e.reason}`,
      );
    }
  }
  if (missing.length) {
    console.log(`in reference but not in corpus: ${missing.join(", ")}`);
  }
  console.log("");
  if (report.baseline) {
    if (incomparable) {
      console.log(`baseline ${report.baseline.path} is NOT comparable: ${incomparable}`);
    } else {
      console.log(`baseline ${report.baseline.path} deltas (current - baseline):`);
      printDeltas(report.baseline.deltas);
    }
    console.log("");
  }
  console.log(
    `summary: scored=${report.summary.scored} gated=${report.summary.gated} excluded=${report.summary.excluded} failures=${report.summary.failures} regressions=${report.summary.regressions} ${report.summary.pass ? "PASS" : "FAIL"}`,
  );
  for (const r of regressions) console.log(`  ${r.file}: ${r.failures.join("; ")}`);
  if (incomparable) console.log(`FAIL: baseline not comparable (${incomparable})`);
  process.exit(report.summary.pass && !incomparable ? 0 : 1);
}

main();
