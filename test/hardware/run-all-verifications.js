#!/usr/bin/env node
const { spawn } = require('child_process');
const path = require('path');

const [, , host, bisectSeconds] = process.argv;
if (!host) {
  console.error('usage: node run-all-verifications.js <host> [bisectCaptureSeconds=15]');
  process.exit(2);
}

function run(scriptName, args, skipCodes) {
  return new Promise((resolve) => {
    console.log(`\n${'='.repeat(70)}\nRunning ${scriptName} ${args.join(' ')}\n${'='.repeat(70)}`);
    const child = spawn(process.execPath, [path.join(__dirname, scriptName), ...args], { stdio: 'inherit' });
    child.on('close', (code) => resolve({ scriptName, code, skipCodes: skipCodes || [] }));
    child.on('error', (err) => { console.error(`[run-all] failed to launch ${scriptName}:`, err.message); resolve({ scriptName, code: 1, skipCodes: [] }); });
  });
}

async function main() {
  const results = [];
  results.push(await run('verify-glitch-no-shift.js', [host]));
  results.push(await run('verify-quantization.js', [host]));
  results.push(await run('verify-lineup.js', [host]));
  results.push(await run('varispeed-record.js', [host]));
  results.push(await run('bisect-1hz-stall.js', [host, bisectSeconds || '15']));
  results.push(await run('verify-peer-tempo-follow.js', [host], [2]));
  results.push(await run('verify-multi-looper-soak.js', [host, '2', '2000', '30000', '120000']));

  console.log(`\n${'='.repeat(70)}\nSUMMARY\n${'='.repeat(70)}`);
  let anyFailed = false;
  for (const r of results) {
    const isBisect = r.scriptName === 'bisect-1hz-stall.js';
    const skipped = r.skipCodes.includes(r.code);
    const label = isBisect ? (r.code === 0 ? 'RAN (read its own verdict above)' : 'ERRORED')
      : skipped ? 'SKIPPED (its prerequisite is missing)'
      : (r.code === 0 ? 'PASS' : 'FAIL');
    console.log(`${r.scriptName}: ${label} (exit ${r.code})`);
    if (r.code !== 0 && !skipped) anyFailed = true;
  }
  process.exit(anyFailed ? 1 : 0);
}

main();
