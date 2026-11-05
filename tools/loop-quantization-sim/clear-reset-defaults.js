const { createWorld, onClearAll, PARAM_DEFAULTS } = require('./world');

function mutate(w) {
  w.params['fx/lp'] = 0.2;
  w.params['fx/time'] = 0.9;
  w.params['cmd/input1_recordable'] = 0;
  w.params['fx/resonode/decay'] = 4.0;
  w.params['fx/dublfo/rate'] = 0.8;
  w.params['cmd/recorded_bpm'] = 137;
}

function allDefaults(w) {
  return Object.keys(PARAM_DEFAULTS).every((k) => w.params[k] === PARAM_DEFAULTS[k]);
}

const before = createWorld();
mutate(before);
onClearAll(before, true, false);
const beforeOk = allDefaults(before);

const after = createWorld();
mutate(after);
onClearAll(after, true, true);
const afterOk = allDefaults(after);

if (beforeOk || !afterOk) {
  console.log('clear reset defaults: FAIL');
  console.log('  without reset allDefaults=' + beforeOk);
  console.log('  with reset allDefaults=' + afterOk);
  process.exit(1);
}
console.log('clear reset defaults: PASS (old path FAIL, new path PASS)');
process.exit(0);
