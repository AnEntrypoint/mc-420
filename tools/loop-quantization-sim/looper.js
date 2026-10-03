'use strict';

const MAXLEN = 48000 * 60;
const kFineGridBeats = 0.125;

function wrapAbs(p, len) {
  return p - Math.floor(p / len) * len;
}

function initLooperDsp() {
  return {
    fin: 0, act: 0, widx: 0, wlen: 1, rsm: 0, coff: 0, rpos: 0, gate: 0,
    beatScale: 1, bakedSpeed: 1,
    recPrevEdge: 0,
  };
}

function stepSample(s, inp) {
  const {
    recN, finishReqN, finishTargetN, eraseN, clearAll,
    masterPhase, masterPhasePrev, masterLen, recordedBeats,
    effSpeed, manualSpeed,
  } = inp;

  const wipe = Math.max(clearAll, eraseN);
  const beatsPerMasterLen = Math.max(1.0, recordedBeats);
  const oneBeat = Math.max(1.0, masterLen / beatsPerMasterLen);
  const speedClamped = Math.max(0.1, Math.min(8.0, effSpeed));
  const manualSafe = Math.max(0.1, Math.abs(manualSpeed === undefined ? 1.0 : manualSpeed));
  const legacyBake = inp.legacyBake === true;
  const ratioClamped = legacyBake
    ? speedClamped
    : Math.max(0.1, Math.min(8.0, effSpeed / manualSafe));
  const masterPhaseWrapped = masterLen >= 0.5 && masterPhase < masterPhasePrev;

  const armPulse = recN > 0.5 && s.recPrevEdge < 0.5;
  const armEdge = armPulse;

  const fineGridSamples = Math.max(1.0, kFineGridBeats * oneBeat);
  const cellOffset = wrapAbs(masterPhase, fineGridSamples);
  const rsmNearestNode = wrapAbs(
    masterPhase + (cellOffset > fineGridSamples * 0.5 ? fineGridSamples - cellOffset : -cellOffset),
    Math.max(1.0, masterLen));
  const rsmNext = armEdge ? rsmNearestNode : s.rsm;

  const finNext = armEdge ? 0 : (finishReqN > 0.5 ? 1 : s.fin);
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
  const beatLenNow = masterLen < 0.5 ? oneBeat : oneBeat / ratioClamped;
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
  const anchorGridLenNow = Math.max(1.0, Math.min(anchorGridBeats * beatLenNow, masterLen));
  const gridMultiple = Math.max(1.0, Math.ceil(finishTakeLen / anchorGridLenNow - gridPickEps));
  const snappedWrapLen = masterLen < 0.5 ? finishTakeLen : gridMultiple * anchorGridLenNow;
  const wlenNext = finishEdge ? Math.max(1.0, snappedWrapLen) : s.wlen;
  const beatScaleNext = armEdge
    ? 1.0
    : (finishEdge ? (masterLen < 0.5 ? 1.0 : 1.0 / ratioClamped) : s.beatScale);
  const bakedSpeedNext = armEdge ? 1.0 : (finishEdge ? manualSafe : s.bakedSpeed);
  const bakedActive = !legacyBake && bakedSpeedNext !== 1.0;
  const speedForTake = bakedActive ? bakedSpeedNext / manualSafe : 1.0;

  const wrapLenCur = Math.max(1, wlenNext);
  const cycleInc = masterLen < 0.5 ? wrapLenCur : beatScaleNext * masterLen;
  const coffNext = armEdge
    ? 0.0
    : (masterPhaseWrapped ? wrapAbs(s.coff + cycleInc, wrapLenCur) : s.coff);

  const absPos = wrapAbs(beatScaleNext * (masterPhase - rsmNext) + inp.latencyBiasN + coffNext, wrapLenCur);
  const varispeedActive = effSpeed !== 1.0 || bakedActive;
  const manualPunchActive = Math.abs(effSpeed - 1.0) > 0.3;
  const resyncCoeff = manualPunchActive || bakedActive ? 0.0 : inp.resyncCoeff;
  const wrapDelta = (prev) => wrapAbs(absPos - prev + wrapLenCur * 0.5, wrapLenCur) - wrapLenCur * 0.5;
  const rposNext = (armEdge || finishEdge)
    ? absPos
    : (varispeedActive
      ? wrapAbs(s.rpos + speedClamped * beatScaleNext * speedForTake + wrapDelta(s.rpos) * resyncCoeff, wrapLenCur)
      : absPos);

  return {
    fin: finNext, act: actNext, widx: widxNext, wlen: wlenNext,
    rsm: rsmNext, coff: coffNext, rpos: rposNext, gate: gateNext,
    beatScale: beatScaleNext, bakedSpeed: bakedSpeedNext,
    recPrevEdge: recN > 0.5 ? 1 : 0,
    armEdge, finishEdge,
  };
}

module.exports = {
  initLooperDsp, stepSample, wrapAbs, MAXLEN, kFineGridBeats,
};
