'use strict';

const fs = require('fs');

const kLoopSimWorkflow = '.github/workflows/test-loop-sim.yml';
const kPhraseAnchorWorkflow = '.github/workflows/test-phrase-anchor.yml';
const kPhraseOffsetScript = 'tools/loop-quantization-sim/first-take-phrase-offset.js';
const kJoinRaceScript = 'tools/loop-quantization-sim/join-race-tempo-authority.js';
const kCheckScript = 'tools/ci-contract-check.js';
const kVisualBeatCueScript = 'tools/loop-quantization-sim/visual-beat-cue.js';
const kPhraseRebaseScript = 'tools/loop-quantization-sim/phrase-rebase-backwards.js';

function readLines(path) {
  return fs.readFileSync(path, 'utf8').split(String.fromCharCode(10)).map((line) => line.replace(String.fromCharCode(13), ''));
}

function countRunLines(lines, script) {
  return lines.filter((line) => line.trim() === 'run: node ' + script).length;
}

function requireExactlyOnce(lines, script) {
  const count = countRunLines(lines, script);
  return { script, count, ok: count === 1 };
}

function main() {
  const loopLines = readLines(kLoopSimWorkflow);
  const phraseLines = readLines(kPhraseAnchorWorkflow);
  const checks = [
    requireExactlyOnce(loopLines, kPhraseOffsetScript),
    requireExactlyOnce(loopLines, kJoinRaceScript),
    requireExactlyOnce(loopLines, kCheckScript),
    requireExactlyOnce(loopLines, kVisualBeatCueScript),
    requireExactlyOnce(loopLines, kPhraseRebaseScript),
  ];
  const phraseText = phraseLines.join(String.fromCharCode(10));
  const loopText = loopLines.join(String.fromCharCode(10));
  const pathChecks = [
    { path: 'src/control/midi_clock.cpp', ok: phraseText.includes("- 'src/control/midi_clock.cpp'") },
    { path: 'src/control/midi.cpp CI path filter', ok: loopText.includes("- 'src/control/midi.cpp'") },
    { path: 'src/link/**', ok: phraseText.includes("- 'src/link/**'") },
    { path: 'workflow_dispatch', ok: phraseText.includes('workflow_dispatch:') },
    { path: 'visual-beat-cue negative control', ok: loopText.includes('visual-beat-cue.js --control') },
    { path: 'visual-beat-cue one-step index negative control', ok: loopText.includes('visual-beat-cue.js --no-index-fix') },
    { path: 'phrase-rebase-backwards negative control', ok: loopText.includes('phrase-rebase-backwards.js --no-fix') },
    { path: 'phrase-rebase-backwards stale-hold negative control', ok: loopText.includes('phrase-rebase-backwards.js --stale-hold') },
  ];
  const failed = [];
  for (const c of checks) {
    console.log('  ' + c.script + ': ' + c.count + ' invocation(s) ' + (c.ok ? 'ok' : 'FAIL'));
    if (!c.ok) failed.push(c.script);
  }
  for (const c of pathChecks) {
    console.log('  ' + c.path + ': ' + (c.ok ? 'present' : 'MISSING') + ' ' + (c.ok ? 'ok' : 'FAIL'));
    if (!c.ok) failed.push(c.path);
  }
  console.log(failed.length === 0 ? 'CI workflow contract: PASS' : 'CI workflow contract: FAIL (' + failed.length + ')');
  process.exit(failed.length === 0 ? 0 : 1);
}

if (require.main === module) main();
module.exports = { countRunLines, requireExactlyOnce };
