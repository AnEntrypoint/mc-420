#!/usr/bin/env node
'use strict';
const { execFileSync } = require('child_process');
const sha = process.argv[2];
const required = ['build-binary', 'test-loop-sim'];
for (let i = 1; i <= 60; i++) {
  let out = '';
  try {
    out = execFileSync('gh', ['api', 'repos/AnEntrypoint/mc-420/actions/runs?head_sha=' + sha + '&per_page=100', '--jq', '.workflow_runs[] | [.name,.status,.conclusion,.id] | @tsv'], { encoding: 'utf8' });
  } catch (e) {
    console.log('POLL ' + i + ' API_ERROR');
  }
  const rows = out.trim().split('\n').filter(Boolean).map((l) => l.split('\t'));
  console.log('POLL ' + i + ' ' + JSON.stringify(rows));
  const state = (n) => rows.find((r) => r[0] === n);
  const green = required.every((n) => { const r = state(n); return r && r[1] === 'completed' && r[2] === 'success'; });
  const red = required.some((n) => { const r = state(n); return r && r[1] === 'completed' && r[2] !== 'success'; });
  if (green) { console.log('ADR034_CI_GREEN ' + sha); process.exit(0); }
  if (red) { console.log('ADR034_CI_RED ' + sha); process.exit(1); }
  execFileSync('node', ['-e', 'setTimeout(()=>{},20000)']);
}
console.log('ADR034_CI_TIMEOUT ' + sha);
process.exit(2);
