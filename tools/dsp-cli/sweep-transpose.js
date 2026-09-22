#!/usr/bin/env node
// Sweeps multitranspose.dsp across real corpus instruments x a wide range of
// target-note offsets, glitch-checking every render. Local, fast (no CI/
// hardware round trip) -- the efficient-iteration counterpart to live
// hardware spot-checks. Requires dsp_cli.exe already built against
// multitranspose.dsp (run build.bat first).
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..', '..');
const DSP_CLI = path.join(__dirname, 'dsp_cli.exe');
const OUT_DIR = path.join(__dirname, '.sweep-out');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR);

// filename -> approximate source MIDI note (from manifest.json descriptions)
const INSTRUMENTS = {
  'piano_low_A1.wav': 33,
  'piano_mid_C4.wav': 60,
  'piano_high_C7.wav': 96,
  'violin_low_sulG_G3B3.wav': 55,
  'violin_high_sulE_C7E7.wav': 96,
  'cello_low_sulC_A2.wav': 45,
  'marimba_low_C2B2.wav': 36,
  'marimba_mid_C5B5.wav': 72,
  'vibraphone_mid_C5B5.wav': 72,
  'trumpet_low_A3.wav': 57,
  'trumpet_high_C6.wav': 84,
  'oboe_mid_C5B5.wav': 72,
  'bassoon_low_C2B2.wav': 36,
  'clarinet_high_C6B6.wav': 84,
  'vocal_female_vibrato.wav': 69,
  'vocal_male_baritone_scale.wav': 53,
};

// Representative offsets: unison, small intervals both directions, larger
// leaps, octave extremes -- not every one of 7744 combos, a representative
// spread across the practically reachable shift range.
const OFFSETS = [-24, -19, -12, -7, -5, -3, -1, 0, 1, 3, 5, 7, 12, 19, 24];

function midiToHz(note) { return 440.0 * Math.pow(2, (note - 69) / 12); }

let total = 0, glitchCount = 0;
const failures = [];

for (const [file, sourceNote] of Object.entries(INSTRUMENTS)) {
  const wavPath = path.join(ROOT, 'test-audio-corpus', 'instruments', file);
  if (!fs.existsSync(wavPath)) { console.error('missing:', wavPath); continue; }
  const sourceHz = midiToHz(sourceNote);
  for (const offset of OFFSETS) {
    const targetNote = Math.max(0, Math.min(127, sourceNote + offset));
    total++;
    const outWav = path.join(OUT_DIR, `${file.replace('.wav', '')}_off${offset >= 0 ? '+' : ''}${offset}.wav`);
    const args = [
      '--gen0', `wav:${wavPath}`,
      '--gen4', `step:0:${sourceHz.toFixed(2)}:0.04:6.0`, // extFreqDet: untrusted 40ms then real lock
      '--gen5', `step:${targetNote}:${targetNote}:0:6.0`,  // n0 = target note
      '--gen6', 'step:1:1:0:6.0',                          // g0 = gate held
      outWav,
    ];
    try {
      execFileSync(DSP_CLI, args, { stdio: 'pipe', timeout: 15000 });
    } catch (e) {
      failures.push({ file, offset, targetNote, stage: 'render', error: e.message });
      continue;
    }
    let glitchOut;
    try {
      glitchOut = execFileSync(DSP_CLI, ['--glitch-check', outWav, 'threshold=0.15', 'minGapMs=3'], { stdio: 'pipe', timeout: 10000 }).toString();
    } catch (e) {
      // non-zero exit = glitches found; stdout still has the report
      glitchOut = e.stdout ? e.stdout.toString() : '';
      const m = glitchOut.match(/glitches=(\d+)/);
      const n = m ? parseInt(m[1], 10) : -1;
      if (n > 0) {
        glitchCount++;
        failures.push({ file, offset, targetNote, stage: 'glitch', count: n, report: glitchOut });
      }
      continue;
    }
  }
  console.log(`done: ${file} (${OFFSETS.length} offsets)`);
}

console.log(`\n=== sweep complete: ${total} renders, ${glitchCount} with glitches ===`);
if (failures.length) {
  console.log(JSON.stringify(failures, null, 2));
  process.exit(1);
}
process.exit(0);
