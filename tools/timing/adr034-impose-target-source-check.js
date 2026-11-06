#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'dsp', 'audio_thread.cpp'), 'utf8');
const publish = src.indexOf('g_telem.imposeTargetSamples = (double)g_telem.lastTakeArmSample - (double)masterLen;') >= 0;
const deadWriter = src.indexOf('if (masterJustCreated) g_telem.imposeTargetSamples = linkTargetSamples;') >= 0;
const resetAtCreation = /if \(masterJustCreated\) \{[\s\S]{0,2600}?g_telem\.imposeTargetSamples = -1\.0;/.test(src);
const imposeUntouched = src.indexOf('requestPhaseImpose(0.0, pressMicros - loopMicros, (double)recordedBeatsShared)') >= 0;
const state = publish && !deadWriter && !resetAtCreation && imposeUntouched ? 'PUBLISHED_AT_CREATION' : 'DEAD_CODE';
const expected = process.argv[2] || 'PUBLISHED_AT_CREATION';
const pass = state === expected && imposeUntouched;
console.log('adr034 source check: state=' + state + ' expected=' + expected + ' publish=' + publish + ' deadWriter=' + deadWriter + ' resetAtCreation=' + resetAtCreation + ' imposeUntouched=' + imposeUntouched);
console.log('adr034 source check: ' + (pass ? 'PASS' : 'FAIL'));
process.exit(pass ? 0 : 1);
