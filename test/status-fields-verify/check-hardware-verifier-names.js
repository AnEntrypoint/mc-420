#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const kRepoRoot = path.resolve(__dirname, '..', '..');
const kWorkflow = path.join(kRepoRoot, '.github/workflows/test-status-fields.yml');
const kScripts = [
  'verify-two-device-sync.js',
  'verify-quantization.js',
  'verify-transport-stays-running.js',
  'verify-peer-follows-loop.js'
];
const kGate = 'if: $' + '{{' + " github.event_name == 'workflow_dispatch' && inputs.run_device_verifiers == true }}";
const workflow = fs.readFileSync(kWorkflow, 'utf8');
const lines = workflow.split('\n');
const start = lines.findIndex(l => /^  hardware-verifiers:\s*$/.test(l));
if (start < 0) throw new Error('hardware-verifiers job is missing from the workflow');
const block = lines.slice(start).join('\n');
for (const name of kScripts) {
  if (!block.includes(name)) throw new Error('hardware-verifiers job does not name ' + name);
  if (!fs.existsSync(path.join(kRepoRoot, 'test/hardware', name))) throw new Error('missing device verifier ' + name);
}
if (!workflow.includes('run_device_verifiers:')) throw new Error('workflow_dispatch gate input is missing');
if (!block.includes(kGate)) throw new Error('hardware-verifiers job lost its workflow_dispatch gate');
console.log('hardware-verifier-names: PASS (' + kScripts.length + ' scripts named in the hardware-verifiers job, gate=workflow_dispatch/run_device_verifiers, no device execution)');
