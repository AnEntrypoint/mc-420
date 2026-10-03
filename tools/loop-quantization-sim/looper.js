'use strict';

const MAXLEN = 48000 * 60;
const kFineGridBeats = 0.125;

function wrapAbs(p, len) {
  return p - Math.floor(p / len) * len;
}

function initLooperDsp() {
  return {
    pend: 0, fin: 0, act: 0, widx: 0, wlen: 1, rsm: 0, coff: 0, rpos: 0, gate: 0,
    beatScale: 1,
    recPrevEdge: 0,
  };
}

function stepSample(s, inp) {
  const {
    recN, finishReqN, finishTargetN, eraseN, clearAll,
    masterPhase, masterPhasePrev, masterLen, recordedBeats,
    effSpeed,
  } = inp;

  const wipe = Math.max(clearAll, eraseN);
  const beatsPerMasterLen = Math.max(1.0, recordedBeats);
  const oneBeat = Math.max(1.0, masterLen / beatsPerMasterLen);
  const speedClamped = Math.max(0.1, Math.min(8.0, effSpeed));
  const masterPhaseWrapped = masterLen >= 0.5 && masterPhase < masterPhasePrev;

  const fineGrid = Math.max(1.0, kFineGridBeats * oneBeat);
  const fineGridWrapped = Math.floor(masterPhase / fineGrid) !== Math.floor(masterPhasePrev / fineGrid);

  const armPulse = recN > 0.5 && s.recPrevEdge < 0.5;
  const armPulseGrid = armPulse && masterLen >= 0.5;

  const cancelPend = s.pend > 0.5 && finishReqN > 0.5 && s.act < 0.5;
  const armEdge = masterLen < 0.5
    ? armPulse
    : ((s.pend > 0.5 || armPulseGrid) && fineGridWrapped);
  const pendNext = masterLen < 0.5
    ? 0
    : (armEdge ? 0 : (cancelPend ? 0 : (armPulseGrid ? 1 : s.pend)));

  const rsmNext = armEdge ? masterPhase : s.rsm;

  const finNext = armEdge ? 0 : cancelPend ? 0 : (finishReqN > 0.5 ? 1 : s.fin);
  const recKeepAlive = recN > 0.5 || finNext > 0.5;
  const actNext = armEdge ? 1.0 : (recKeepAlive ? s.act : 0.0);

  const gateOf = (x) => (actNext > 0.5 ? 1 : 0) * (1 - (finNext > 0.5 ? 1 : 0) * (x >= finishTargetN ? 1 : 0));
  const gateCur = gateOf(s.widx);
  const widxNext = armEdge ? 0 : (gateCur > 0.5 ? Math.min(s.widx + 1, MAXLEN - 1) : s.widx);

  const finishEdge = gateCur < 0.5 && s.gate > 0.5;
  const gateNext = gateCur;

  const writeIdxForLatch = finNext > 0.5 ? finishTargetN : widxNext;
  const intendedTakeLen = finishTargetN > 0.5 ? finishTargetN : writeIdxForLatch;
  const finishTakeLen = Math.max(1.0, intendedTakeLen);
  const beatLenNow = masterLen < 0.5 ? oneBeat : oneBeat / speedClamped;
  const takeLenBeats = finishTakeLen / beatLenNow;
  const gridPickEps = 0.01;
  let anchorGridBeats;
  if (takeLenBeats > 16.0 + gridPickEps) anchorGridBeats = 16.0;
  else if (takeLenBeats > 8.0 + gridPickEps) anchorGridBeats = 8.0;
  else if (takeLenBeats > 4.0 + gridPickEps) anchorGridBeats = 4.0;
  else if (takeLenBeats > 2.0 + gridPickEps) anchorGridBeats = 2.0;
  else if (takeLenBeats > 1.0 + gridPickEps) anchorGridBeats = 1.0;
  else if (takeLenBeats > 0.5 + gridPickEps) anchorGridBeats = 0.5;
  else if (takeLenBeats > 0.25 + gridPickEps) anchorGridBeats = 0.25;
  else anchorGridBeats = 0.125;
  const anchorGridLenNow = Math.max(1.0, anchorGridBeats * beatLenNow);
  const gridMultiple = Math.max(1.0, Math.ceil(takeLenBeats / anchorGridBeats - gridPickEps));
  const snappedWrapLen = masterLen < 0.5 ? finishTakeLen : gridMultiple * anchorGridLenNow;
  const wlenNext = finishEdge ? Math.max(1.0, snappedWrapLen) : s.wlen;
  const beatScaleNext = armEdge
    ? 1.0
    : (finishEdge ? (masterLen < 0.5 ? 1.0 : 1.0 / speedClamped) : s.beatScale);

  const wrapLenCur = Math.max(1, wlenNext);
  const cycleInc = masterLen < 0.5 ? wrapLenCur : beatScaleNext * masterLen;
  const coffNext = armEdge
    ? 0.0
    : (masterPhaseWrapped ? wrapAbs(s.coff + cycleInc, wrapLenCur) : s.coff);

  const absPos = wrapAbs(beatScaleNext * (masterPhase - rsmNext) + inp.latencyBiasN + coffNext, wrapLenCur);
  const varispeedActive = effSpeed !== 1.0;
  const manualPunchActive = Math.abs(effSpeed - 1.0) > 0.3;
  const resyncCoeff = manualPunchActive ? 0.0 : inp.resyncCoeff;
  const wrapDelta = (prev) => wrapAbs(absPos - prev + wrapLenCur * 0.5, wrapLenCur) - wrapLenCur * 0.5;
  const rposNext = (armEdge || finishEdge)
    ? absPos
    : (varispeedActive
      ? wrapAbs(s.rpos + speedClamped * beatScaleNext + wrapDelta(s.rpos) * resyncCoeff, wrapLenCur)
      : absPos);

  return {
    pend: pendNext, fin: finNext, act: actNext, widx: widxNext, wlen: wlenNext,
    rsm: rsmNext, coff: coffNext, rpos: rposNext, gate: gateNext,
    beatScale: beatScaleNext,
    recPrevEdge: recN > 0.5 ? 1 : 0,
    armEdge, finishEdge,
  };
}

module.exports = {
  initLooperDsp, stepSample, wrapAbs, MAXLEN, kFineGridBeats,
};
