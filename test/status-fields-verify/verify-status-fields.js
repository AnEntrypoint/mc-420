#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const kRepoRoot = path.resolve(__dirname, '..', '..');
const kPositiveDir = path.join(__dirname, 'fixtures', 'positive');
const kMaxEspReplyBytes = 1024;
const kMaxAloopReplyBytes = 8192;
const kForbiddenPollTokens = [
  'commitAppSessionState', 'setIsPlaying', 'setTempo', 'forceBeatAtTime',
  'enableStartStopSync', 'requestPhaseImpose', 'writeFile', 'unlink',
  'rc-service', 'reboot', 'midi-inject'
];
const kForbiddenPublisherTokens = [
  'commitAppSessionState', 'setIsPlaying', 'setTempo', 'forceBeatAtTime',
  'enableStartStopSync', 'requestPhaseImpose'
];
const caseDir = path.isAbsolute(argValue('--case', 'test/status-fields-verify/fixtures/positive'))
  ? argValue('--case', 'test/status-fields-verify/fixtures/positive')
  : path.join(kRepoRoot, argValue('--case', 'test/status-fields-verify/fixtures/positive'));

function argValue(name, fallback) {
  const at = process.argv.indexOf(name);
  return at >= 0 && at + 1 < process.argv.length ? process.argv[at + 1] : fallback;
}
function absolute(p) { return path.isAbsolute(p) ? p : path.join(kRepoRoot, p); }
function readCaseFile(name) {
  const casePath = path.join(caseDir, name);
  return fs.readFileSync(fs.existsSync(casePath) ? casePath : path.join(kPositiveDir, name));
}
function readSource(cliName, caseName, defaultRel) {
  const cli = argValue(cliName, null);
  if (cli) return fs.readFileSync(absolute(cli), 'utf8');
  const casePath = path.join(caseDir, caseName);
  if (fs.existsSync(casePath)) return fs.readFileSync(casePath, 'utf8');
  return fs.readFileSync(absolute(defaultRel), 'utf8');
}
function need(cond, msg) { if (!cond) throw new Error(msg); }
function parseJson(raw, label) {
  try { return JSON.parse(raw); }
  catch (e) { throw new Error(label + ' is not valid JSON: ' + e.message); }
}
function typeOf(value, expected, label) {
  need(typeof value === expected, label + ' must be a ' + expected + ', got ' + typeof value);
}
function hasFields(obj, spec, label) {
  for (const key of Object.keys(spec)) {
    need(Object.prototype.hasOwnProperty.call(obj, key), label + ' is missing ' + key);
    typeOf(obj[key], spec[key], label + '.' + key);
  }
}
function sourceFiles(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(p, out);
    else if (/\.(cpp|h|hpp|cc)$/.test(entry.name)) out.push(p);
  }
  return out;
}
const checks = [];
function check(name, fn) {
  try {
    const detail = fn();
    checks.push({ name, ok: true });
    console.log('PASS ' + name + (detail ? ': ' + detail : ''));
  } catch (err) {
    checks.push({ name, ok: false });
    console.log('FAIL ' + name + ': ' + err.message);
  }
}

const espRaw = readCaseFile('esp-20813-reply.json').toString('utf8');
const aloopRaw = readCaseFile('aloop-status-reply.json').toString('utf8');
const pollSrc = readSource('--poll-source', 'poll-source.js', 'test/hardware/link-mesh-status.js');
const telemetrySrc = readSource('--telemetry-source', 'telemetry-source.cpp', 'src/control/telemetry.cpp');
const linkSrc = readSource('--link-source', 'link-source.cpp', 'src/link/link_bridge.cpp');
const audioSrc = readSource('--audio-source', 'audio-source.cpp', 'src/dsp/audio_thread.cpp');
const docsSrc = readSource('--link-docs', 'link-docs.md', 'docs/LINK-MESH-TESTING.md');

check('esp-reply-ends-in-newline', () => {
  need(espRaw.endsWith('\n'), '20813 reply does not end in a newline');
  need(!espRaw.endsWith('\r\n'), '20813 reply ends in CRLF, not a single newline');
  return 'trailing newline byte present';
});
check('esp-reply-single-json-line', () => {
  const body = espRaw.replace(/\r?\n$/, '');
  need(!body.includes('\n') && !body.includes('\r'), '20813 reply spans more than one line');
  parseJson(body, '20813 reply');
  return Buffer.byteLength(espRaw) + ' bytes of one JSON line';
});
check('esp-reply-bounded-length', () => {
  const bytes = Buffer.byteLength(espRaw);
  need(bytes <= kMaxEspReplyBytes, '20813 reply is ' + bytes + ' bytes, bound is ' + kMaxEspReplyBytes);
  return bytes + ' <= ' + kMaxEspReplyBytes;
});
check('aloop-reply-bounded-length', () => {
  const bytes = Buffer.byteLength(aloopRaw);
  need(bytes <= kMaxAloopReplyBytes, 'aloop status reply is ' + bytes + ' bytes, bound is ' + kMaxAloopReplyBytes + ' from char json[8192]');
  need(!aloopRaw.includes('\n'), 'aloop status reply is not a single JSON payload');
  parseJson(aloopRaw, 'aloop status reply');
  return bytes + ' <= ' + kMaxAloopReplyBytes;
});
check('esp-20813-field-types', () => {
  const esp = parseJson(espRaw.replace(/\r?\n$/, ''), '20813 reply');
  hasFields(esp, { peers: 'number', bpm: 'number', playing: 'boolean', beat: 'number', phase: 'number', quantum: 'number', ap: 'boolean', link: 'boolean' }, 'esp 20813');
  return 'peers/bpm/beat/phase/quantum numbers, playing/ap/link booleans';
});
check('aloop-link-field-types', () => {
  const aloop = parseJson(aloopRaw, 'aloop status reply');
  need(aloop.link && typeof aloop.link === 'object' && !Array.isArray(aloop.link), 'aloop status reply has no link object');
  hasFields(aloop.link, { synced: 'boolean', bpm: 'number', peers: 'number', playing: 'boolean', phase_err_beats: 'number' }, 'aloop link');
  return 'link synced/bpm/peers/playing/phase_err_beats typed';
});
check('playing-trees-distinct', () => {
  const esp = parseJson(espRaw.replace(/\r?\n$/, ''), '20813 reply');
  const aloop = parseJson(aloopRaw, 'aloop status reply');
  need(Object.prototype.hasOwnProperty.call(esp, 'playing'), 'esp 20813 reply lost its top-level playing');
  need(!(esp.link && typeof esp.link === 'object' && Object.prototype.hasOwnProperty.call(esp.link, 'playing')), 'esp playing was moved under link');
  need(!Object.prototype.hasOwnProperty.call(aloop, 'playing'), 'aloop status reply gained a top-level playing');
  need(Object.prototype.hasOwnProperty.call(aloop.link || {}, 'playing'), 'aloop link.playing is missing');
  return 'esp top-level playing vs aloop link.playing';
});
check('playing-values-are-independent-quantities', () => {
  const esp = parseJson(espRaw.replace(/\r?\n$/, ''), '20813 reply');
  const aloop = parseJson(aloopRaw, 'aloop status reply');
  need(esp.playing === false, 'esp 20813 playing is the Link SESSION transport and must stay false with enableStartStopSync(false)');
  need(aloop.link.playing === true, 'aloop link.playing is the LOCAL transport and the recorded reply has it true');
  need(esp.playing !== aloop.link.playing, 'the two playing fields were conflated');
  return 'aloop link.playing=true LOCAL transport; esp playing=false LINK SESSION transport; equality NOT required';
});
check('aloop-playing-semantics-source', () => {
  need(telemetrySrc.includes('t.linkPlaying'), 'src/control/telemetry.cpp:143 no longer publishes t.linkPlaying');
  const formatLine = telemetrySrc.split('\n').find(l => l.includes('link') && l.includes('playing') && l.includes('%s'));
  need(formatLine, 'src/control/telemetry.cpp:126 no longer formats playing inside the link object');
  need(telemetrySrc.includes('char json[8192]'), 'src/control/telemetry.cpp lost the 8192 byte reply bound');
  need(audioSrc.includes('g_telem.linkPlaying = linkSnap.isPlaying'), 'src/dsp/audio_thread.cpp:816 no longer copies the local transport flag');
  need(linkSrc.includes('enableStartStopSync(false)'), 'src/link/link_bridge.cpp:59 no longer keeps Link clock-only');
  need(linkSrc.includes('s.isPlaying') && linkSrc.includes('b.isPlaying') && linkSrc.includes('g_localTransportRunning'), 'src/link/link_bridge.cpp:160,213 no longer derive isPlaying from g_localTransportRunning');
  need(!linkSrc.includes('setIsPlaying'), 'src/link/link_bridge.cpp publishes session transport');
  return 'src/control/telemetry.cpp:126,143 -> src/dsp/audio_thread.cpp:816 -> src/link/link_bridge.cpp:59,160,213';
});
check('esp-playing-semantics-docs', () => {
  need(docsSrc.includes('20813') && docsSrc.includes('status_responder_task'), 'docs/LINK-MESH-TESTING.md:167-170 lost the 20813 responder');
  need(docsSrc.includes('replies to any datagram'), 'docs/LINK-MESH-TESTING.md:168 lost the query-only reply contract');
  const marker = docsSrc.indexOf('one JSON line:');
  need(marker >= 0, 'docs/LINK-MESH-TESTING.md:169 lost the one-JSON-line contract');
  const fieldBlock = docsSrc.slice(marker, marker + 200);
  need(['peers', 'bpm', 'playing', 'beat', 'phase', 'quantum', 'ap'].every(k => fieldBlock.includes(k)), 'docs/LINK-MESH-TESTING.md:169 lost the 20813 field list');
  need(docsSrc.includes('Both projects disable Link start-stop-sync'), 'docs/LINK-MESH-TESTING.md:66 lost the clock-only session semantics');
  return 'docs/LINK-MESH-TESTING.md:31,66,165-172';
});
check('poll-query-only', () => {
  need(pollSrc.includes('const ESP_STATUS_PORT = 20813;'), 'poll no longer targets 20813');
  need(pollSrc.includes("Buffer.from('?')"), 'poll no longer sends the one-byte query');
  need(pollSrc.includes("c.exec('cat /run/aloop/status.json'"), 'poll no longer reads status.json with cat');
  const execCount = (pollSrc.match(/c\.exec\(/g) || []).length;
  need(execCount === 1, 'poll issues ' + execCount + ' exec calls, expected one read-only cat');
  need(pollSrc.includes('JSON.parse'), 'poll no longer parses the reply');
  for (const token of kForbiddenPollTokens) need(!pollSrc.includes(token), 'poll mutates state: ' + token);
  need(telemetrySrc.includes('recvfrom(') && telemetrySrc.includes('sendto('), 'telemetry publish no longer answers a datagram query');
  need(telemetrySrc.includes('fwrite(json'), 'telemetry publish no longer writes the status snapshot');
  for (const token of kForbiddenPublisherTokens) need(!telemetrySrc.includes(token), 'telemetry publish mutates state: ' + token);
  const files = sourceFiles(path.join(kRepoRoot, 'src'), []);
  const offending = files.filter(p => fs.readFileSync(p, 'utf8').includes('setIsPlaying'));
  need(offending.length === 0, 'src/ publishes Link session transport: ' + offending.join(', '));
  return 'one 1-byte 20813 query, one read-only cat, no session write in src/ (' + files.length + ' source files scanned)';
});

const failed = checks.filter(c => !c.ok);
console.log('status-fields-verify: ' + (failed.length ? 'FAIL' : 'PASS') + ' (' + (checks.length - failed.length) + '/' + checks.length + ' assertions, case=' + path.relative(kRepoRoot, caseDir) + ')');
process.exit(failed.length ? 1 : 0);
