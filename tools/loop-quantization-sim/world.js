'use strict';

const { initLooperDsp, stepSample, MAXLEN } = require('./looper');
const { createLinkWorld, LINK_QUANTUM, beatAtTime } = require('./link');

const SCALE = 100;
const SIM_SAMPLE_RATE = 48000 / SCALE;
const SIM_MAXLEN = Math.round(MAXLEN / SCALE);
const kHoldEraseSamples = Math.round((1000 / 1000) * SIM_SAMPLE_RATE);
const kFinishSettleTimeoutSamples = Math.round((500 / 1000) * SIM_SAMPLE_RATE);
const kBlockSizeSimSamples = 64 / SCALE;

function msToSimSamples(ms) {
  return Math.round((ms / 1000) * SIM_SAMPLE_RATE);
}

const kCandidates = [1.0, 2.0, 4.0, 8.0, 16.0, 32.0, 64.0, 128.0];

function deriveTempoQuant(seconds) {
  if (seconds <= 0.0) return { bpm: 120.0, beats: 16.0 };
  let best = { bpm: 120.0, beats: 16.0 };
  let bestDist = 1e18;
  let bestInWindow = false;
  for (const beats of kCandidates) {
    const bpm = (60.0 * beats) / seconds;
    const inWindow = bpm >= 80.0 && bpm <= 160.0;
    const dist = Math.abs(bpm - 120.0);
    const better = inWindow && !bestInWindow;
    const tieBreak = inWindow === bestInWindow && dist < bestDist;
    if (better || tieBreak) {
      best = { bpm, beats };
      bestDist = dist;
      bestInWindow = inWindow;
    }
  }
  return best;
}

function pickAnchorGridBeats(takeLenBeats) {
  const eps = 0.01;
  if (takeLenBeats > 16.0 + eps) return 16.0;
  if (takeLenBeats > 8.0 + eps) return 8.0;
  if (takeLenBeats > 4.0 + eps) return 4.0;
  if (takeLenBeats > 2.0 + eps) return 2.0;
  if (takeLenBeats > 1.0 + eps) return 1.0;
  if (takeLenBeats > 0.5 + eps) return 0.5;
  if (takeLenBeats > 0.25 + eps) return 0.25;
  return 0.125;
}

function snapBeatsToPow2(continuousBeats) {
  let best = kCandidates[0];
  let bestDist = 1e18;
  for (const beats of kCandidates) {
    const dist = Math.abs(Math.log2(beats) - Math.log2(Math.max(continuousBeats, 0.001)));
    if (dist < bestDist) { bestDist = dist; best = beats; }
  }
  return best;
}

function createLooperControl() {
  return {
    held: false, holdStartT: 0, erased: false, eraseReleaseAtT: 0,
    finishReqReleaseAtT: 0, armedOnPress: false, playing: false, hasContent: false,
    wrapLenStaleAfterWipe: false, recording: false,
    finishTargetPending: 0, finishPendingSinceT: 0, recordStartT: 0,
    shiftHeldDuringTake: false, pauseOthersOnFinish: false,
    ps_rec: 0, ps_play: 0, ps_finishreq: 0, ps_finishtarget: 0, ps_latencybias: 0,
    ps_erase: 0,
    armBeatAbs: null,
    dsp: initLooperDsp(),
  };
}

function createWorld(opts) {
  const looperCount = (opts && opts.looperCount) || 4;
  const linkWorld = createLinkWorld((opts && opts.initialLinkBpm) || 120.0);
  const w = {
    t: 0,
    looperCount,
    loopers: Array.from({ length: looperCount }, () => createLooperControl()),
    masterLenSamples: 0,
    masterLooper: -1,
    recordedBpm: 0,
    recordedBeats: 0,
    masterPhaseSamples: 0.0,
    masterPhasePrev: -1,
    ps_clearall: 0,
    shiftHeld: false,
    manualSpeedMul: 1.0,
    link: linkWorld,
    log: [],
    events: [],
    linkPhaseTrim: 0.0,
    phaseLockEnabled: true,
    varispeedOnAnchor: true,
    resnapOnReconnect: true,
    joinSnapEnabled: true,
    beatsGuessEnabled: false,
    tempoScaleInverted: false,
    deferBeatsWrite: false,
    pendingBeats: null,
    creationSnapPending: false,
    wasLinkSynced: false,
    linkPhaseErrBeats: 0.0,
    linkSnapHeld: null,
    lastPublishedPlaying: false,
    weStartedTransport: false,
    lastLinkPhaseMicroBeats: -1,
    lastLinkBpmSeen: 0.0,
    tempoStableSamples: 0,
    prevMasterLen: 0,
  };
  refreshLinkSnapshot(w);
  return w;
}

const kSimSpeedup = 48000 / SIM_SAMPLE_RATE;
const kControlTickSamples = SIM_SAMPLE_RATE / 5;
const kLinkPhaseTrimPerSample = 0.00005 * kSimSpeedup;
const kLinkPhaseTrimMax = 0.03;
const kResyncCoeffPerSample = 0.0005 * kSimSpeedup;
const kJoinSnapErrBeats = 0.25;

function refreshLinkSnapshot(w) {
  const snap = w.link.local.audioRead((w.t / SIM_SAMPLE_RATE) * 1000);
  snap.captureMicros = (w.t / SIM_SAMPLE_RATE) * 1e6;
  w.linkSnapHeld = snap;
  return snap;
}

function beatsFoldBasis(w) {
  if (w.recordedBeats >= 1.0) return w.recordedBeats;
  return w.beatsGuessEnabled ? 16.0 : 0.0;
}

function linkTargetSamplesAt(w, nowMicros) {
  const s = w.linkSnapHeld;
  if (!s || !s.phaseValid || !(s.quantumMicroBeats > 0) || !(s.captureMicros > 0)) return null;
  let elapsed = nowMicros - s.captureMicros;
  if (elapsed < 0) elapsed = 0;
  if (elapsed > 4e6) elapsed = 4e6;
  const phaseMicroBeats = s.beatPhaseMicroBeats + elapsed * (s.bpm / 60.0);
  let frac = phaseMicroBeats / s.quantumMicroBeats;
  frac -= Math.floor(frac);
  const beats = beatsFoldBasis(w);
  if (!(beats >= 1.0)) return null;
  const oneBeat = w.masterLenSamples / beats;
  const linkBeat = frac * (s.quantumMicroBeats / 1e6);
  const loopBeatPos = ((linkBeat % beats) + beats) % beats;
  return loopBeatPos * oneBeat;
}

function linkAudioRead(w) {
  return w.link.local.audioRead(w.t / SIM_SAMPLE_RATE * 1000);
}

function effSpeedNow(w) {
  const s = w.linkSnapHeld;
  let linkSpeedRatio = 1.0;
  if (s && s.synced && w.recordedBpm > 1.0 && s.bpm > 1.0) {
    linkSpeedRatio = s.bpm / w.recordedBpm;
  }
  return w.manualSpeedMul * (linkSpeedRatio + w.linkPhaseTrim);
}

function snapshotWriteIdx(w, looper) {
  return w.loopers[looper].dsp.widx;
}
function snapshotWrapLen(w, looper) {
  return w.loopers[looper].dsp.wlen;
}

function applyRecPlayCycle(w, looper) {
  const lp = w.loopers[looper];
  const timeMs = (w.t / SIM_SAMPLE_RATE) * 1000;
  if (lp.recording) {
    if (lp.finishTargetPending > 0) return;
    lp.hasContent = true;
    lp.wrapLenStaleAfterWipe = false;
    lp.playing = true;
    lp.ps_play = 1;
    const latencyBias = kBlockSizeSimSamples + (w.alsaRoundTripSamples || 0) + (lp.shiftHeldDuringTake ? kBlockSizeSimSamples : 0);
    lp.ps_latencybias = latencyBias;
    w.masterLenSamples = w.masterLenSamples;
    if (w.masterLenSamples === 0) {
      if (lp.shiftHeldDuringTake) {
        for (let src = 0; src < w.looperCount; src++) {
          if (src === looper) continue;
          const o = w.loopers[src];
          if (o.hasContent && o.playing) { o.playing = false; o.ps_play = 0; }
        }
      }
      let lenSamples = snapshotWriteIdx(w, looper);
      lenSamples = Math.max(1, Math.min(lenSamples, SIM_MAXLEN));
      w.masterLenSamples = lenSamples;
      w.masterLooper = looper;
      const recordedSeconds = w.masterLenSamples / SIM_SAMPLE_RATE;
      const linkSnap = linkAudioRead(w);
      const haveExternalTempo = linkSnap.synced && linkSnap.bpm > 1.0;
      let solvedBpm, solvedBeats;
      if (haveExternalTempo) {
        solvedBpm = linkSnap.bpm;
        solvedBeats = snapBeatsToPow2((recordedSeconds * linkSnap.bpm) / 60.0);
      } else {
        const solved = deriveTempoQuant(recordedSeconds);
        solvedBpm = solved.bpm;
        solvedBeats = solved.beats;
      }
      if (haveExternalTempo) {
        const beatSamples = (60.0 / solvedBpm) * SIM_SAMPLE_RATE;
        w.masterLenSamples = Math.max(1, Math.min(Math.round(solvedBeats * beatSamples), SIM_MAXLEN));
      }
      if (w.deferBeatsWrite) {
        w.pendingBeats = { bpm: solvedBpm, beats: solvedBeats, atT: w.t + 1 };
      } else {
        w.recordedBpm = solvedBpm;
        w.recordedBeats = solvedBeats;
      }
      if (!haveExternalTempo) w.link.local.proposeTempo(solvedBpm, timeMs);
      lp.ps_finishtarget = w.masterLenSamples;
      lp.ps_finishreq = 1;
      lp.ps_rec = 0;
      lp.finishReqReleaseAtT = w.t + msToSimSamples(50);
      lp.finishTargetPending = w.masterLenSamples;
      lp.finishPendingSinceT = w.t;
      lp.pauseOthersOnFinish = false;
    } else {
      const rawSamples = snapshotWriteIdx(w, looper);
      if (rawSamples <= 0) {
        lp.ps_rec = 0; lp.recording = false; lp.hasContent = false; lp.playing = false; lp.ps_play = 0;
        lp.armBeatAbs = null;
        lp.ps_finishreq = 1;
        lp.finishReqReleaseAtT = w.t + msToSimSamples(50);
        return;
      }
      let tempoScale = 1.0;
      const linkSnap = linkAudioRead(w);
      if (linkSnap.synced) {
        const recordedBpm = w.recordedBpm;
        const curBpm = linkSnap.bpm;
        if (recordedBpm > 1.0 && curBpm > 1.0) tempoScale = recordedBpm / curBpm;
      }
      const effectiveSamples = w.tempoScaleInverted ? rawSamples * tempoScale : rawSamples / tempoScale;
      const beatsPerMasterLen = Math.max(1.0, w.recordedBeats);
      const oneBeat = Math.max(1.0, w.masterLenSamples / beatsPerMasterLen);
      const takeLenBeats = effectiveSamples / oneBeat;
      let anchorGridBeats = pickAnchorGridBeats(takeLenBeats);
      const phraseBeats = Math.max(1.0, beatsPerMasterLen);
      const legacy = w.legacyFinishAnchor === true;
      if (!legacy && anchorGridBeats > phraseBeats) anchorGridBeats = phraseBeats;
      const pastMultiple = Math.floor(takeLenBeats / anchorGridBeats + 0.0001);
      const pastNodeBeats = pastMultiple * anchorGridBeats;
      const futureNodeBeats = pastNodeBeats + anchorGridBeats;
      const overshootBeats = takeLenBeats - pastNodeBeats;
      const cutToleranceBeats = legacy
        ? 1.0
        : Math.max(1.0, Math.min(anchorGridBeats * 0.5, takeLenBeats * 0.125));
      const finalBeats = (pastMultiple >= 1 && overshootBeats <= cutToleranceBeats + 0.0001)
        ? pastNodeBeats
        : futureNodeBeats;
      const beatLenSamplesNow = w.tempoScaleInverted ? oneBeat / tempoScale : oneBeat * tempoScale;
      let quantized = Math.round(finalBeats * beatLenSamplesNow);
      if (quantized < 1) quantized = 1;
      if (quantized > SIM_MAXLEN) quantized = SIM_MAXLEN;
      if (quantized > SIM_MAXLEN) quantized = SIM_MAXLEN;
      lp.ps_finishtarget = quantized;
      lp.ps_finishreq = 1;
      lp.ps_rec = 0;
      lp.finishReqReleaseAtT = w.t + msToSimSamples(50);
      lp.finishTargetPending = quantized;
      lp.finishPendingSinceT = w.t;
      lp.pauseOthersOnFinish = lp.shiftHeldDuringTake;
    }
  } else if (!lp.hasContent) {
    lp.ps_rec = 1;
    lp.recording = true;
    lp.recordStartT = w.t;
    lp.shiftHeldDuringTake = w.shiftHeld;
  } else if (lp.playing) {
    lp.ps_play = 0;
    lp.playing = false;
  } else {
    lp.ps_play = 1;
    lp.playing = true;
  }
  publishTransport(w);
}

function publishTransport(w) {
  let anyPlaying = false;
  for (const lp of w.loopers) if (lp.playing) { anyPlaying = true; break; }
  if (w.lastPublishedPlaying === anyPlaying) return;
  w.lastPublishedPlaying = anyPlaying;
  if (!anyPlaying) {
    if (!w.weStartedTransport) return;
    w.weStartedTransport = false;
  } else {
    w.weStartedTransport = true;
  }
  const timeMs = (w.t / SIM_SAMPLE_RATE) * 1000;
  w.link.local.setTransportPlaying(anyPlaying, timeMs);
}

function onPadPress(w, looper) {
  const lp = w.loopers[looper];
  const alreadyHeld = lp.held;
  lp.held = true;
  if (alreadyHeld) return;
  lp.erased = false;
  lp.holdStartT = w.t;
  if (!lp.hasContent || lp.recording) {
    applyRecPlayCycle(w, looper);
    lp.armedOnPress = true;
  } else {
    lp.armedOnPress = false;
  }
}

function onPadRelease(w, looper) {
  const lp = w.loopers[looper];
  if (lp.armedOnPress) {
    lp.armedOnPress = false;
    lp.held = false;
    return;
  }
  if (lp.held && !lp.erased) {
    applyRecPlayCycle(w, looper);
  }
  lp.held = false;
}

function onClearAll(w, held) {
  w.ps_clearall = held ? 1 : 0;
  if (!held) return;
  for (let i = 0; i < w.looperCount; i++) {
    const lp = w.loopers[i];
    const wasRecording = lp.recording;
    lp.held = false; lp.erased = false; lp.armedOnPress = false; lp.playing = false;
    lp.hasContent = false; lp.wrapLenStaleAfterWipe = true; lp.recording = false;
    lp.armBeatAbs = null;
    lp.ps_play = 0; lp.ps_rec = 0;
    if (wasRecording) {
      lp.ps_finishtarget = snapshotWriteIdx(w, i);
      lp.ps_finishreq = 1;
      lp.finishReqReleaseAtT = w.t + msToSimSamples(50);
    } else {
      lp.ps_finishreq = 0;
      lp.finishReqReleaseAtT = 0;
    }
    lp.finishTargetPending = 0; lp.pauseOthersOnFinish = false;
  }
  w.masterLenSamples = 0;
  w.masterLooper = -1;
  w.recordedBpm = 0;
  w.recordedBeats = 0;
  w.link.local.resetTempoAuthority();
  publishTransport(w);
}

function onShiftPress(w) { w.shiftHeld = true; }
function onShiftRelease(w) { w.shiftHeld = false; }

function onHoldEraseTick(w, looper) {
  const lp = w.loopers[looper];
  if (!lp.held || lp.erased) return;
  if (w.t - lp.holdStartT < kHoldEraseSamples) return;
  lp.ps_erase = 1;
  lp.eraseReleaseAtT = w.t + msToSimSamples(50);
  if (lp.recording) {
    lp.ps_rec = 0;
    lp.ps_finishtarget = snapshotWriteIdx(w, looper);
    lp.ps_finishreq = 1;
    lp.finishReqReleaseAtT = w.t + msToSimSamples(50);
    lp.recording = false;
  }
  lp.finishTargetPending = 0;
  lp.pauseOthersOnFinish = false;
  lp.erased = true;
  lp.armedOnPress = false;
  lp.armBeatAbs = null;
  lp.hasContent = false;
  lp.wrapLenStaleAfterWipe = true;
  lp.playing = false;
  lp.ps_play = 0;
}

function pollHoldsTick(w) {
  for (let i = 0; i < w.looperCount; i++) {
    const lp = w.loopers[i];
    if (lp.finishTargetPending <= 0) continue;
    const reached = snapshotWriteIdx(w, i) >= lp.finishTargetPending;
    if (reached) {
      lp.recording = false;
      lp.finishTargetPending = 0;
      if (lp.pauseOthersOnFinish) {
        lp.pauseOthersOnFinish = false;
        for (let src = 0; src < w.looperCount; src++) {
          if (src === i) continue;
          const o = w.loopers[src];
          if (o.hasContent && o.playing) { o.playing = false; o.ps_play = 0; }
        }
      }
    }
  }
  if (w.shiftHeld) {
    for (const lp of w.loopers) if (lp.recording) lp.shiftHeldDuringTake = true;
  }
  for (const lp of w.loopers) {
    if (lp.eraseReleaseAtT !== 0 && w.t >= lp.eraseReleaseAtT) {
      lp.ps_erase = 0;
      lp.eraseReleaseAtT = 0;
    }
    if (lp.finishReqReleaseAtT !== 0 && w.t >= lp.finishReqReleaseAtT) {
      lp.ps_finishreq = 0;
      lp.finishReqReleaseAtT = 0;
    }
  }
  for (let i = 0; i < w.looperCount; i++) onHoldEraseTick(w, i);

  let anyHasContent = false;
  for (const lp of w.loopers) if (lp.hasContent) { anyHasContent = true; break; }
  if (!anyHasContent) {
    for (let i = 0; i < w.looperCount; i++) {
      const lp = w.loopers[i];
      if (!lp.wrapLenStaleAfterWipe && snapshotWrapLen(w, i) > 1) {
        lp.hasContent = true;
        anyHasContent = true;
      }
    }
  }
  if (!anyHasContent && w.masterLenSamples !== 0) {
    w.masterLenSamples = 0;
    w.masterLooper = -1;
    w.recordedBpm = 0;
    w.recordedBeats = 0;
    w.link.local.resetTempoAuthority();
  }
}

function stepOneSample(w) {
  if (w.pendingBeats && w.t >= w.pendingBeats.atT) {
    w.recordedBpm = w.pendingBeats.bpm;
    w.recordedBeats = w.pendingBeats.beats;
    w.pendingBeats = null;
  }
  if (w.t % kControlTickSamples === 0) refreshLinkSnapshot(w);
  const masterPhasePrev = w.masterPhaseSamples;

  const s = w.linkSnapHeld;
  const linkDriving = !!(s && s.synced && s.bpm > 1.0);
  const linkVarispeedEngaged = linkDriving && w.recordedBpm > 1.0;
  let linkSpeedRatio = 1.0;
  if (linkVarispeedEngaged) linkSpeedRatio = s.bpm / w.recordedBpm;
  const anchorRate = w.varispeedOnAnchor ? linkSpeedRatio : 1.0;
  const manualPunchActive = Math.abs(w.manualSpeedMul - 1.0) > 0.3;
  if (!linkVarispeedEngaged || manualPunchActive) w.linkPhaseTrim = 0.0;

  const effSpeed = w.manualSpeedMul * (linkSpeedRatio + w.linkPhaseTrim);
  const masterLen = w.masterLenSamples;
  const masterJustCreated = w.prevMasterLen <= 0 && masterLen > 0;
  w.prevMasterLen = masterLen;
  if (masterJustCreated) w.creationSnapPending = true;

  if (masterLen > 0) {
    if (linkDriving) {
      const curBpm = s.bpm;
      const bpmChanged = w.lastLinkBpmSeen > 0 && Math.abs(curBpm - w.lastLinkBpmSeen) > 0.05;
      w.lastLinkBpmSeen = curBpm;
      w.tempoStableSamples = bpmChanged ? 0 : w.tempoStableSamples + 1;

      const target = linkTargetSamplesAt(w, (w.t / SIM_SAMPLE_RATE) * 1e6);
      let anyAudible = false;
      for (const lp of w.loopers) if (lp.playing || lp.recording) { anyAudible = true; break; }

      if (masterJustCreated && target !== null) w.lastLinkPhaseMicroBeats = -1;

      const fresh = target !== null && s.beatPhaseMicroBeats !== w.lastLinkPhaseMicroBeats;
      if (fresh) w.lastLinkPhaseMicroBeats = s.beatPhaseMicroBeats;

      const linkJoined = linkDriving && !w.wasLinkSynced;
      let joinErrBeats = 0.0;
      if (linkJoined && target !== null) {
        w.wasLinkSynced = true;
        const half = masterLen * 0.5;
        const raw = (target - w.masterPhaseSamples + half) % masterLen;
        const delta = ((raw < 0 ? raw + masterLen : raw)) - half;
        joinErrBeats = Math.abs(delta) / (masterLen / Math.max(1.0, w.recordedBeats));
      }

      if (w.phaseLockEnabled && target !== null
          && (!anyAudible || masterJustCreated || w.creationSnapPending
              || (w.joinSnapEnabled && linkJoined && joinErrBeats > kJoinSnapErrBeats))) {
        w.masterPhaseSamples = target;
        w.linkPhaseTrim = 0.0;
        w.tempoStableSamples = 0;
        w.creationSnapPending = false;
        w.linkPhaseErrBeats = 0.0;
      } else {
        w.masterPhaseSamples += anchorRate + (w.phaseLockEnabled ? w.linkPhaseTrim : 0.0);
        if (fresh && target !== null) {
          const half = masterLen * 0.5;
          const raw = (target - w.masterPhaseSamples + half) % masterLen;
          const delta = ((raw < 0 ? raw + masterLen : raw)) - half;
          const oneBeat = masterLen / Math.max(1.0, w.recordedBeats);
          w.linkPhaseErrBeats = delta / oneBeat;
          const tempoStable = w.tempoStableSamples >= SIM_SAMPLE_RATE;
          if (tempoStable && linkVarispeedEngaged && !manualPunchActive) {
            let trim = delta * kLinkPhaseTrimPerSample;
            if (trim > kLinkPhaseTrimMax) trim = kLinkPhaseTrimMax;
            if (trim < -kLinkPhaseTrimMax) trim = -kLinkPhaseTrimMax;
            w.linkPhaseTrim = trim;
          } else {
            w.linkPhaseTrim = 0.0;
          }
        }
      }
    } else {
      w.masterPhaseSamples += linkSpeedRatio + w.linkPhaseTrim;
      w.creationSnapPending = false;
      if (w.resnapOnReconnect) w.wasLinkSynced = false;
      w.lastLinkBpmSeen = 0.0;
      w.tempoStableSamples = 0;
      w.lastLinkPhaseMicroBeats = -1;
      w.linkPhaseTrim = 0.0;
      w.linkPhaseErrBeats = 0.0;
    }
    w.masterPhaseSamples = ((w.masterPhaseSamples % masterLen) + masterLen) % masterLen;
  } else {
    w.masterPhaseSamples = 0;
    w.linkPhaseErrBeats = 0.0;
    w.creationSnapPending = false;
    if (w.resnapOnReconnect) w.wasLinkSynced = false;
  }
  const results = [];
  for (let i = 0; i < w.looperCount; i++) {
    const lp = w.loopers[i];
    const inp = {
      recN: lp.ps_rec, finishReqN: lp.ps_finishreq, finishTargetN: lp.ps_finishtarget,
      eraseN: lp.ps_erase, clearAll: w.ps_clearall,
      masterPhase: w.masterPhaseSamples, masterPhasePrev, masterLen: w.masterLenSamples,
      recordedBeats: w.recordedBeats,
      effSpeed, manualSpeed: w.manualSpeedMul, latencyBiasN: lp.ps_latencybias,
      resyncCoeff: kResyncCoeffPerSample, legacyBake: w.legacyBakeVarispeed === true,
    };
    const next = stepSample(lp.dsp, inp);
    lp.dsp = next;
    if (next.armEdge) lp.armBeatAbs = beatAtTime(w.link.session, (w.t / SIM_SAMPLE_RATE) * 1000) - next.armPullbackBeats;
    results.push(next);
  }
  w.t += 1;
  pollHoldsTick(w);
  return results;
}

function advance(w, samples) {
  for (let i = 0; i < samples; i++) stepOneSample(w);
}

module.exports = {
  createWorld, advance, stepOneSample,
  onPadPress, onPadRelease, onClearAll, onShiftPress, onShiftRelease,
  msToSimSamples, SIM_SAMPLE_RATE, SIM_MAXLEN,
  snapshotWriteIdx, snapshotWrapLen, linkAudioRead, deriveTempoQuant, snapBeatsToPow2,
  effSpeedNow, beatsFoldBasis,
};
