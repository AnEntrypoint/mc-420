#!/usr/bin/env node
// Finds the exact semitone offset where glitches begin for a given
// instrument, by testing every semitone in a range (not just a sparse
// sweep) with the shifter trusted from t=0 (steady-state, isolates the
// shifter's own behavior from tracking-transition effects).
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..', '..');
const DSP_CLI = path.join(__dirname, 'dsp_cli.exe');
const OUT_DIR = path.join(__dirname, '.bisect-out');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR);

function midiToHz(note) { return 440.0 * Math.pow(2, (note - 69) / 12); }

const [, , fileArg, sourceNoteArg, loArg, hiArg] = process.argv;
if (!fileArg || !sourceNoteArg) {
  console.error('usage: node bisect-glitch-threshold.js <file.wav> <sourceMidiNote> [loOffset=0] [hiOffset=24]');
  process.exit(2);
}
const wavPath = path.join(ROOT, 'test-audio-corpus', 'instruments', fileArg);
const sourceNote = parseInt(sourceNoteArg, 10);
const lo = loArg ? parseInt(loArg, 10) : 0;
const hi = hiArg ? parseInt(hiArg, 10) : 24;
const sourceHz = midiToHz(sourceNote);

for (let offset = lo; offset <= hi; offset++) {
  const targetNote = sourceNote + offset;
  const outWav = path.join(OUT_DIR, `${fileArg.replace('.wav', '')}_off${offset}.wav`);
  execFileSync(DSP_CLI, [
    '--gen0', `wav:${wavPath}`,
    '--gen4', `step:${sourceHz.toFixed(2)}:${sourceHz.toFixed(2)}:0:6.0`,
    '--gen5', `step:${targetNote}:${targetNote}:0:6.0`,
    '--gen6', 'step:1:1:0:6.0',
    outWav,
  ], { stdio: 'pipe' });
  let glitches = 0;
  try {
    execFileSync(DSP_CLI, ['--glitch-check', outWav, 'threshold=0.15', 'minGapMs=3'], { stdio: 'pipe' });
  } catch (e) {
    const m = (e.stdout || '').toString().match(/glitches=(\d+)/);
    glitches = m ? parseInt(m[1], 10) : -1;
  }
  console.log(`offset=+${offset} target=${targetNote} glitches=${glitches}`);
}
