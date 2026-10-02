'use strict';

const world = require('./world');
const inv = require('./invariants');

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const EVENT_KINDS = [
  'padPress', 'padRelease', 'holdErase', 'clearAllPulse', 'shiftPulse',
  'punchHalf', 'punchDouble', 'linkPeerJoin', 'linkPeerLeave', 'linkTempoChange',
  'idle',
];

function genEvent(rng, looperCount) {
  const kind = EVENT_KINDS[Math.floor(rng() * EVENT_KINDS.length)];
  const looper = Math.floor(rng() * looperCount);
  switch (kind) {
    case 'padPress': return { kind, looper };
    case 'padRelease': return { kind, looper };
    case 'holdErase': return { kind, looper, holdMs: 1000 + Math.floor(rng() * 500) };
    case 'clearAllPulse': return { kind };
    case 'shiftPulse': return { kind, ms: 50 + Math.floor(rng() * 3000) };
    case 'punchHalf': return { kind, ms: 50 + Math.floor(rng() * 1500) };
    case 'punchDouble': return { kind, ms: 50 + Math.floor(rng() * 1500) };
    case 'linkPeerJoin': return { kind, bpm: 60 + Math.floor(rng() * 140) };
    case 'linkPeerLeave': return { kind };
    case 'linkTempoChange': return { kind, bpm: 60 + Math.floor(rng() * 140) };
    case 'idle': return { kind, ms: 20 + Math.floor(rng() * 3000) };
    default: return { kind: 'idle', ms: 100 };
  }
}

function applyEvent(w, ev) {
  switch (ev.kind) {
    case 'padPress': world.onPadPress(w, ev.looper); break;
    case 'padRelease': world.onPadRelease(w, ev.looper); break;
    case 'holdErase': {
      world.onPadPress(w, ev.looper);
      world.advance(w, world.msToSimSamples(ev.holdMs));
      w.loopers[ev.looper].held = false;
      break;
    }
    case 'clearAllPulse': {
      world.onClearAll(w, true);
      world.advance(w, world.msToSimSamples(150));
      world.onClearAll(w, false);
      break;
    }
    case 'shiftPulse': {
      world.onShiftPress(w);
      world.advance(w, world.msToSimSamples(ev.ms));
      world.onShiftRelease(w);
      break;
    }
    case 'punchHalf': {
      w.manualSpeedMul = 0.5;
      world.advance(w, world.msToSimSamples(ev.ms));
      w.manualSpeedMul = 1.0;
      break;
    }
    case 'punchDouble': {
      w.manualSpeedMul = 2.0;
      world.advance(w, world.msToSimSamples(ev.ms));
      w.manualSpeedMul = 1.0;
      break;
    }
    case 'linkPeerJoin': {
      w.link.remote.connected = true;
      w.link.session.tempo = ev.bpm;
      break;
    }
    case 'linkPeerLeave': {
      w.link.remote.connected = false;
      break;
    }
    case 'linkTempoChange': {
      if (w.link.remote.connected) w.link.session.tempo = ev.bpm;
      break;
    }
    case 'idle':
    default:
      world.advance(w, world.msToSimSamples(ev.ms || 100));
      break;
  }
}

function dspFingerprint(w) {
  return w.loopers.map((lp) => {
    const widxPart = lp.finishTargetPending > 0 ? lp.dsp.widx : 'x';
    return `${lp.dsp.pend}|${lp.dsp.fin}|${lp.dsp.act}|${lp.dsp.gate}|${widxPart}|${lp.recording}|${lp.finishTargetPending}`;
  }).join(';');
}

function settleUntilStable(w, maxSamples) {
  let prev = dspFingerprint(w);
  let stableFor = 0;
  for (let i = 0; i < maxSamples && stableFor < 4; i++) {
    world.advance(w, 1);
    const cur = dspFingerprint(w);
    if (cur === prev) stableFor++; else { stableFor = 0; prev = cur; }
  }
}

function runSequence(events, opts) {
  const looperCount = (opts && opts.looperCount) || 4;
  const w = world.createWorld({ looperCount, initialLinkBpm: (opts && opts.initialLinkBpm) || 120 });
  w.__maxRecordingSamples = world.SIM_MAXLEN;
  let prevRpos = inv.snapshotRpos(w);
  const findings = [];
  const MAX_SETTLE_SAMPLES = 2000;
  for (let i = 0; i < events.length; i++) {
    applyEvent(w, events[i]);
    settleUntilStable(w, MAX_SETTLE_SAMPLES);
    const violations = inv.runAllInvariants(w);
    const speedNeutralEvent = !['punchHalf', 'punchDouble', 'linkPeerJoin', 'linkPeerLeave', 'linkTempoChange'].includes(events[i].kind);
    const steadySpeed = Math.abs(world.effSpeedNow(w) - 1.0) < 1e-6;
    const jumpViolations = speedNeutralEvent && steadySpeed ? inv.checkNoResumeJump(prevRpos, w, 4) : [];
    prevRpos = inv.snapshotRpos(w);
    for (const v of [...violations, ...jumpViolations.map((m) => ({ kind: 'resumejump', message: m }))]) {
      findings.push({ atEvent: i, event: events[i], ...v });
    }
    if (findings.length > 0 && (opts && opts.stopOnFirst)) break;
  }
  return { w, findings };
}

function shrink(events, opts) {
  let current = events.slice();
  let changed = true;
  while (changed) {
    changed = false;
    for (let removeLen = Math.max(1, Math.floor(current.length / 4)); removeLen >= 1; removeLen = Math.floor(removeLen / 2)) {
      for (let start = 0; start + removeLen <= current.length; start += removeLen) {
        const candidate = current.slice(0, start).concat(current.slice(start + removeLen));
        if (candidate.length === current.length) continue;
        const { findings } = runSequence(candidate, opts);
        if (findings.length > 0) {
          current = candidate;
          changed = true;
          break;
        }
      }
      if (changed) break;
    }
  }
  return current;
}

function fuzz(opts) {
  const trials = (opts && opts.trials) || 2000;
  const eventsPerTrial = (opts && opts.eventsPerTrial) || 40;
  const seedStart = (opts && opts.seed) || 1;
  const looperCount = (opts && opts.looperCount) || 4;
  const results = [];
  for (let trial = 0; trial < trials; trial++) {
    const seed = seedStart + trial;
    const rng = mulberry32(seed);
    const events = [];
    for (let i = 0; i < eventsPerTrial; i++) events.push(genEvent(rng, looperCount));
    const { findings } = runSequence(events, { looperCount, stopOnFirst: true });
    if (findings.length > 0) {
      const shrunk = shrink(events, { looperCount });
      results.push({ seed, findings, original: events, shrunk });
    }
  }
  return results;
}

function main() {
  const argValue = (name, fallback) => {
    const hit = process.argv.find((a) => a.startsWith(name + '='));
    return hit ? hit.slice(name.length + 1) : fallback;
  };
  const trials = Number(argValue('--trials', '3000'));
  const eventsPerTrial = Number(argValue('--events', '50'));
  const results = fuzz({ trials, eventsPerTrial });
  for (const r of results) {
    for (const f of r.findings) {
      console.log(`seed ${r.seed} at event ${f.atEvent} (${f.event.kind}) ${f.kind}: ${f.message}`);
    }
  }
  console.log(`fuzz: ${trials} trials x ${eventsPerTrial} events, ${results.length} finding(s)`);
  process.exit(results.length === 0 ? 0 : 1);
}

if (require.main === module) main();

module.exports = { mulberry32, genEvent, applyEvent, runSequence, shrink, fuzz, EVENT_KINDS };
