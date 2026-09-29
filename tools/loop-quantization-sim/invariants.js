'use strict';

function isPow2Ratio(a, b, tolerance) {
  if (a <= 0 || b <= 0) return true;
  const ratio = a > b ? a / b : b / a;
  const lg = Math.log2(ratio);
  return Math.abs(lg - Math.round(lg)) < tolerance;
}

function checkWrapLenPow2Ratios(w) {
  const violations = [];
  const established = [];
  for (let i = 0; i < w.looperCount; i++) {
    const lp = w.loopers[i];
    if (lp.hasContent && lp.dsp.wlen > 1) established.push({ i, wlen: lp.dsp.wlen });
  }
  for (let a = 0; a < established.length; a++) {
    for (let b = a + 1; b < established.length; b++) {
      const A = established[a], B = established[b];
      if (!isPow2Ratio(A.wlen, B.wlen, 0.02)) {
        violations.push(`looper${A.i}.wlen=${A.wlen.toFixed(2)} vs looper${B.i}.wlen=${B.wlen.toFixed(2)} not a power-of-2 ratio`);
      }
    }
  }
  return violations;
}

function checkRecNeverStuck(w, maxRecordingSamples) {
  const violations = [];
  for (let i = 0; i < w.looperCount; i++) {
    const lp = w.loopers[i];
    if (lp.recording && w.t - lp.recordStartT > maxRecordingSamples) {
      violations.push(`looper${i} has been 'recording' (control-layer shadow) for ${w.t - lp.recordStartT} samples with no completion -- stuck rec`);
    }
  }
  return violations;
}

function checkHasContentMatchesRealWraplen(w) {
  const violations = [];
  for (let i = 0; i < w.looperCount; i++) {
    const lp = w.loopers[i];
    const realHasContent = lp.dsp.wlen > 1 && lp.dsp.gate < 0.5 && lp.dsp.fin > 0.5;
    if (!lp.wrapLenStaleAfterWipe && !lp.recording && lp.finishTargetPending <= 0) {
      if (realHasContent && !lp.hasContent) {
        violations.push(`looper${i}: DSP shows real finished content (wlen=${lp.dsp.wlen.toFixed(1)}) but control-layer hasContent=false`);
      }
    }
  }
  return violations;
}

function checkMasterResetOnlyWhenEmpty(w) {
  const violations = [];
  let anyHasContent = false;
  for (const lp of w.loopers) if (lp.hasContent) { anyHasContent = true; break; }
  if (!anyHasContent && w.masterLenSamples !== 0) {
    violations.push(`masterLenSamples=${w.masterLenSamples} but no looper has content`);
  }
  return violations;
}

function checkNoPhantomDspActivity(w) {
  const violations = [];
  for (let i = 0; i < w.looperCount; i++) {
    const lp = w.loopers[i];
    const controlIdle = !lp.recording && !lp.hasContent && lp.finishTargetPending <= 0;
    if (controlIdle && lp.dsp.gate > 0.5) {
      violations.push(`looper${i}: control layer thinks idle/empty but DSP gate=${lp.dsp.gate} (actively writing real audio into the ring -- phantom recording)`);
    }
    if (controlIdle && lp.dsp.pend > 0.5 && !lp.wrapLenStaleAfterWipe) {
      violations.push(`looper${i}: control layer thinks idle/empty but DSP pend=1 (a stale ARM is still latched, waiting to phantom-fire at the next phrase-top)`);
    }
  }
  return violations;
}

function checkNoResumeJump(prevSnapshot, w, threshold) {
  const violations = [];
  const elapsed = w.t - prevSnapshot.t;
  for (let i = 0; i < w.looperCount; i++) {
    const lp = w.loopers[i];
    const prev = prevSnapshot.rpos[i];
    const wasPlaying = prevSnapshot.playing[i];
    if (prev === undefined || !wasPlaying || !lp.playing || lp.dsp.wlen <= 1) continue;
    const wlen = lp.dsp.wlen;
    const actualDelta = (((lp.dsp.rpos - prev) % wlen) + wlen) % wlen;
    const expectedDelta = ((elapsed % wlen) + wlen) % wlen;
    let diff = Math.abs(actualDelta - expectedDelta);
    diff = Math.min(diff, wlen - diff);
    if (diff > threshold) {
      violations.push(`looper${i}: rpos advanced by ${actualDelta.toFixed(2)} (mod wlen) over ${elapsed} elapsed samples, expected ~${expectedDelta.toFixed(2)} -- a real position jump (prev=${prev.toFixed(2)} now=${lp.dsp.rpos.toFixed(2)} wlen=${wlen.toFixed(2)})`);
    }
  }
  return violations;
}

function snapshotRpos(w) {
  return { rpos: w.loopers.map((lp) => lp.dsp.rpos), playing: w.loopers.map((lp) => lp.playing), t: w.t };
}

function runAllInvariants(w) {
  const all = [
    ...checkWrapLenPow2Ratios(w).map((m) => ({ kind: 'pow2ratio', message: m })),
    ...checkRecNeverStuck(w, w.__maxRecordingSamples || 1e9).map((m) => ({ kind: 'stuckrec', message: m })),
    ...checkHasContentMatchesRealWraplen(w).map((m) => ({ kind: 'hascontentdesync', message: m })),
    ...checkMasterResetOnlyWhenEmpty(w).map((m) => ({ kind: 'masterresetdesync', message: m })),
    ...checkNoPhantomDspActivity(w).map((m) => ({ kind: 'phantomdsp', message: m })),
  ];
  return all;
}

module.exports = {
  isPow2Ratio, checkWrapLenPow2Ratios, checkRecNeverStuck, checkHasContentMatchesRealWraplen,
  checkMasterResetOnlyWhenEmpty, checkNoPhantomDspActivity, checkNoResumeJump, snapshotRpos,
  runAllInvariants,
};
