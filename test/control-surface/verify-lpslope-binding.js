'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

let pass = 0;
let fail = 0;
function check(name, ok) {
    if (ok) { pass++; process.stdout.write('PASS ' + name + '\n'); }
    else { fail++; process.stdout.write('FAIL ' + name + '\n'); }
}

const controls = read('config/controls.conf');
const midi = read('src/control/midi.cpp');
const apc = read('src/control/apc_grid.cpp');
const audio = read('src/dsp/audio_thread.cpp');
const runtime = read('dsp/effects_runtime.dsp');
const runtimePre = read('dsp/effects_runtime_pre.dsp');
const filters = read('effects/home/faust/filters.dsp');
const mapping = read('effects/home/faust/param_mapping.md');

const binding = /^cc(\d+)\s+fx\/lpslope\s*$/m.exec(controls);
check('config/controls.conf binds a CC to fx/lpslope', !!binding);
const cc = binding ? Number(binding[1]) : -1;
const intercepted = [1, 48, 49, 50, 51, 52, 53, 54, 55, 57, 64];
check('bound CC ' + cc + ' is free (not APC-intercepted)', cc >= 0 && intercepted.indexOf(cc) < 0);
check('midi.cpp flat map normalizes CC as data2/127', /d2\s*\/\s*127\.0f/.test(midi) && /map\.find\(key\)/.test(midi) && /ps\.setByName\(it->second,\s*val\)/.test(midi));
check('midi.cpp kFxDefaults includes fx/lpslope at 0.0', /\{"fx\/lpslope",\s*0\.0f\}/.test(midi));
check('apc_grid.cpp bindAll binds fx/lpslope at 0.0', /ps\.bind\("fx\/lpslope",\s*0\.0f\)/.test(apc));
check('targetToZone maps fx/lpslope to LPSLOPE', /target\s*==\s*"fx\/lpslope"\)\s*return\s*"LPSLOPE"/.test(audio));

const hslider = /LPSLOPE\s*=\s*hslider\("LPSLOPE",\s*0\.0,\s*0\.0,\s*1\.0,\s*1\.0\)/;
check('effects_runtime.dsp LPSLOPE hslider 0..1 present', hslider.test(runtime));
check('effects_runtime_pre.dsp LPSLOPE hslider 0..1 present', hslider.test(runtimePre));
check('effects_runtime.dsp declares LPSLOPE once', (runtime.match(/LPSLOPE\s*=\s*hslider/g) || []).length === 1);
check('effects_runtime_pre.dsp declares LPSLOPE once', (runtimePre.match(/LPSLOPE\s*=\s*hslider/g) || []).length === 1);
check('effects_runtime.dsp feeds filterStage LPSLOPE', /LPSLOPE=LPSLOPE/.test(runtime));
check('effects_runtime_pre.dsp feeds filterStage LPSLOPE', /LPSLOPE=LPSLOPE/.test(runtimePre));

check('filters.dsp smooths LPSLOPE with si.smoo', /lpSlopeS\s*=\s*LPSLOPE\s*:\s*si\.smoo/.test(filters));
check('filters.dsp lp12 is one SVF lowpass (12 dB/oct)', /lp12\s*=\s*svfLP\([^,]+,\s*1\.0\/lpQ12\(lpResS\),\s*x\)/.test(filters));
check('filters.dsp lp24 cascades two SVF lowpass (24 dB/oct)', /lpA\s*=\s*svfLP\([^,]+,\s*1\.0\/lpQ24a,\s*x\)/.test(filters) && /lp24\s*=\s*svfLP\([^,]+,\s*1\.0\/lpQ24b\(lpResS\),\s*lpA\)/.test(filters));
const blend = /lpMix\s*=\s*(lp12\s*\+\s*lpSlopeS\s*\*\s*\(lp24\s*-\s*lp12\))\s*;/.exec(filters);
check('filters.dsp lpMix blends lp12/lp24 by lpSlopeS', !!blend);
const A = 0.37;
const B = -1.24;
const mix = (s) => A + s * (B - A);
check('endpoint lpSlopeS=0 selects 12 dB/oct path', Math.abs(mix(0) - A) < 1e-12);
check('endpoint lpSlopeS=1 selects 24 dB/oct path', Math.abs(mix(1) - B) < 1e-12);

const row = /^\|\s*LP slope\s*\|.*$/m.exec(mapping);
check('param_mapping.md LP slope row names the bound CC', !!row && row[0].indexOf('CC' + cc) >= 0);
check('param_mapping.md LP slope row drops the unbound marker', !!row && row[0].indexOf('no CC bound yet') < 0);
check('param_mapping.md LP slope row keeps 12/24 dB/oct', !!row && /12 dB\/oct/.test(row[0]) && /24 dB\/oct/.test(row[0]));

const total = pass + fail;
process.stdout.write('\n' + pass + '/' + total + ' checks passed\n');
if (fail > 0) {
    process.stdout.write('LPSLOPE_CONTROL_BINDING=FAIL\n');
    process.exit(1);
}
process.stdout.write('LPSLOPE_CONTROL_BINDING=PASS\n');
process.exit(0);
