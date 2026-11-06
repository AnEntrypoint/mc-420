#!/usr/bin/env node
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const kRepoRoot = path.resolve(__dirname, '..', '..');
const kVerifier = path.join(__dirname, 'verify-status-fields.js');
const kPositiveDir = path.join(__dirname, 'fixtures', 'positive');
const kEspName = 'esp-20813-reply.json';
const kAloopName = 'aloop-status-reply.json';

const base = {
  esp: fs.readFileSync(path.join(kPositiveDir, kEspName), 'utf8'),
  aloop: fs.readFileSync(path.join(kPositiveDir, kAloopName), 'utf8'),
  poll: fs.readFileSync(path.join(kRepoRoot, 'test/hardware/link-mesh-status.js'), 'utf8'),
  telemetry: fs.readFileSync(path.join(kRepoRoot, 'src/control/telemetry.cpp'), 'utf8'),
  link: fs.readFileSync(path.join(kRepoRoot, 'src/link/link_bridge.cpp'), 'utf8'),
  audio: fs.readFileSync(path.join(kRepoRoot, 'src/dsp/audio_thread.cpp'), 'utf8'),
  docs: fs.readFileSync(path.join(kRepoRoot, 'docs/LINK-MESH-TESTING.md'), 'utf8')
};
const sources = {
  'poll-source.js': 'poll',
  'telemetry-source.cpp': 'telemetry',
  'link-source.cpp': 'link',
  'audio-source.cpp': 'audio',
  'link-docs.md': 'docs'
};
const espObj = JSON.parse(base.esp.replace(/\r?\n$/, ''));
const aloopObj = JSON.parse(base.aloop);
const conflatedEsp = Object.assign({}, espObj, { link: { playing: false } });
delete conflatedEsp.playing;
const conflatedAloop = Object.assign({}, aloopObj, { playing: true, link: Object.assign({}, aloopObj.link) });
delete conflatedAloop.link.playing;
const overlongEsp = Object.assign({}, espObj, { pad: 'x'.repeat(1200) });

const cases = [
  { name: 'positive', expect: 'pass', files: null, expected: [] },
  { name: 'negative/playing-type', expect: 'fail', expected: ['esp-20813-field-types'], files: Object.assign({}, base, { esp: base.esp.replace('"playing":false', '"playing":"false"') }) },
  { name: 'negative/missing-newline', expect: 'fail', expected: ['esp-reply-ends-in-newline'], files: Object.assign({}, base, { esp: base.esp.replace(/\n$/, '') }) },
  { name: 'negative/overlong', expect: 'fail', expected: ['esp-reply-bounded-length'], files: Object.assign({}, base, { esp: JSON.stringify(overlongEsp) + '\n' }) },
  { name: 'negative/conflated-trees', expect: 'fail', expected: ['playing-trees-distinct'], files: Object.assign({}, base, { esp: JSON.stringify(conflatedEsp) + '\n', aloop: JSON.stringify(conflatedAloop) }) },
  { name: 'negative/session-equals-local', expect: 'fail', expected: ['playing-values-are-independent-quantities'], files: Object.assign({}, base, { esp: base.esp.replace('"playing":false', '"playing":true') }) },
  { name: 'negative/mutating-poll', expect: 'fail', expected: ['poll-query-only'], files: Object.assign({}, base, { poll: base.poll.replace("sock.send(Buffer.from('?')", "session.setIsPlaying(true);\n    sock.send(Buffer.from('?')") }) },
  { name: 'negative/mutating-semantics-source', expect: 'fail', expected: ['aloop-playing-semantics-source'], files: Object.assign({}, base, { link: base.link.replace('enableStartStopSync(false)', 'enableStartStopSync(true)') }) }
];

function writeCase(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-fields-'));
  fs.writeFileSync(path.join(dir, kEspName), files.esp);
  fs.writeFileSync(path.join(dir, kAloopName), files.aloop);
  for (const name of Object.keys(sources)) fs.writeFileSync(path.join(dir, name), files[sources[name]]);
  return dir;
}
function failNames(out) {
  return out.split('\n').filter(l => l.startsWith('FAIL ')).map(l => l.split(':')[0].slice(5));
}
let bad = 0;
for (const c of cases) {
  const args = c.files ? ['--case', writeCase(c.files)] : [];
  const r = spawnSync(process.execPath, [kVerifier].concat(args), { cwd: kRepoRoot, encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = failNames(out);
  if (c.expect === 'pass') {
    const ok = r.status === 0 && out.includes('status-fields-verify: PASS');
    console.log('CONTROL ' + c.name + ': ' + (ok ? 'PASS' : 'BAD CONTROL') + ' exit=' + r.status);
    if (ok) console.log('  ' + out.trim().split('\n').slice(-1)[0]);
    else { bad++; console.log(out.trim()); }
  } else {
    const ok = r.status === 1 && c.expected.every(n => fails.includes(n));
    console.log('CONTROL ' + c.name + ': ' + (ok ? 'FAIL as expected' : 'BAD CONTROL') + ' exit=' + r.status + ' failing=[' + fails.join(', ') + ']');
    if (!ok) { bad++; console.log(out.trim()); }
  }
}
console.log('status-fields-controls: ' + (bad ? 'FAIL' : 'PASS') + ' (1 positive, ' + (cases.length - 1) + ' negative controls)');
process.exit(bad ? 1 : 0);
