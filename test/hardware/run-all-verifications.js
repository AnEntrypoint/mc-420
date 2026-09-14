#!/usr/bin/env node
const { spawn } = require('child_process');
const path = require('path');

const [, , host, bisectSeconds] = process.argv;
if (!host) {
  console.error('usage: node run-all-verifications.js <host> [bisectCaptureSeconds=15]');
  process.exit(2);
}

function run(scriptName, args) {
  return new Promise((resolve) => {
    console.log(`\n${'='.repeat(70)}\nRunning ${scriptName} ${args.join(' ')}\n${'='.repeat(70)}`);
    const child = spawn(process.execPath, [path.join(__dirname, scriptName), ...args], { stdio: 'inherit' });
    child.on('close', (code) => resolve({ scriptName, code }));
    child.on('error', (err) => { console.error(`[run-all] failed to launch ${scriptName}:`, err.message); resolve({ scriptName, code: 1 }); });
  });
}

async function main() {
  const results = [];
  results.push(await run('verify-glitch-no-shift.js', [host]));
  results.push(await run('verify-quantization.js', [host]));
  results.push(await run('bisect-1hz-stall.js', [host, bisectSeconds || '15']));

  console.log(`\n${'='.repeat(70)}\nSUMMARY\n${'='.repeat(70)}`);
  let anyFailed = false;
  for (const r of results) {
    const isBisect = r.scriptName === 'bisect-1hz-stall.js';
    const label = isBisect ? (r.code === 0 ? 'RAN (read its own verdict above)' : 'ERRORED') : (r.code === 0 ? 'PASS' : 'FAIL');
    console.log(`${r.scriptName}: ${label} (exit ${r.code})`);
    if (r.code !== 0) anyFailed = true;
  }
  process.exit(anyFailed ? 1 : 0);
}

main();
