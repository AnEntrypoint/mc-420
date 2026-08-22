import("stdfaust.lib");

SR       = 48000.0;
MAXLEN   = 48000 * 60;
NLOOPERS = 20;

oneLooper(in, prevFiltIn, clearAll, effSpeed, masterPhase, masterLen, sidechainEnv, recordedBeats) = out : attachLevel
with {
    recN  = button("rec");
    playN = checkbox("play");
    volN  = hslider("vol", 1.0, 0.0, 1.0, 0.001);
    isSourceN = checkbox("sidechainsrc");
    duckGain  = 1.0 - sidechainEnv * (1.0 - isSourceN);
    finishReqN    = button("finishreq");
    finishTargetN = hslider("finishtarget", 0, 0, MAXLEN, 1);
    latencyBiasN  = hslider("latencybias", 0, -MAXLEN, MAXLEN, 1);
    eraseN = button("erase");
    wipe   = max(clearAll, eraseN);

    recPrev = recN : mem;
    armPulse = (recN > 0.5) & (recPrev < 0.5);
    beatsPerMasterLen = max(1.0, recordedBeats);
    oneBeat = max(1.0, masterLen / beatsPerMasterLen);
    gridStep = max(1.0, oneBeat / 4.0);
    phaseInGrid = wrapAbs(masterPhase, gridStep);
    phaseInGridPrev = phaseInGrid : mem;
    gridTickCrossed = phaseInGrid < phaseInGridPrev;
    armPendingStep(prev) = ba.if(masterLen < 0.5, 0,
                            ba.if(prev & gridTickCrossed, 0, ba.if(armPulse, 1, prev)));
    armPending = armPendingStep ~ _;
    armPendingPrev = armPending : mem;
    armEdge = ba.if(masterLen < 0.5, armPulse, armPendingPrev & gridTickCrossed);
    armMasterPhaseStep(prev) = ba.if(armEdge, masterPhase, prev);
    armMasterPhase = armMasterPhaseStep ~ _;
    armPulseMasterPhaseStep(prev) = ba.if(armPulse, masterPhase, prev);
    armPulseMasterPhase = armPulseMasterPhaseStep ~ _;
    finishRequestedStep(prev) = ba.if(armEdge, 0, ba.if(finishReqN > 0.5, 1, prev));
    finishRequested = finishRequestedStep ~ _;
    wrapLenStep(prev) = ba.if(finishEdge, max(1.0, snappedWrapLen), prev);
    wrapLen = max(1, wrapLenStep ~ _);
    writeIdxForLatch = ba.if(finishRequested, finishTargetN, writeIdx);
    recordingGate(prev) = (recN > 0.5) | (finishRequested & (prev < finishTargetN));
    writeIdxStep(prev) = ba.if(armPulse, 0,
                          ba.if(recordingGate(prev), min(prev + 1, MAXLEN - 1), prev));
    writeIdx = writeIdxStep ~ _;
    recordingGateNow = recordingGate(writeIdx : mem);
    recordingGatePrev = recordingGateNow : mem;
    finishEdge = (recordingGateNow < 0.5) & (recordingGatePrev > 0.5);
    writeVal = prevFiltIn * recordingGateNow * (1.0 - wipe);
    ring = rwtable(MAXLEN, 0.0, writeIdx, writeVal, readIdx0);

    wrapAbs(p, len) = p - floor(p / float(len)) * float(len);
    intendedTakeLen = ba.if(finishTargetN > 0.5, finishTargetN, float(writeIdxForLatch));
    finishTakeLen = max(1.0, intendedTakeLen);
    takeLenBeats = finishTakeLen / oneBeat;
    beatBucketEps = 0.5;
    roundedBeats = ba.if(masterLen < 0.5, takeLenBeats,
                     max(1.0, floor(takeLenBeats + beatBucketEps)));
    snappedWrapLen = ba.if(masterLen < 0.5, finishTakeLen, roundedBeats * oneBeat);
    recordStartMasterPhaseStep(prev) = ba.if(finishEdge, armPulseMasterPhase, prev);
    recordStartMasterPhase = recordStartMasterPhaseStep ~ _;
    ringOffset = recordStartMasterPhase;
    masterPhasePrev = masterPhase : mem;
    masterPhaseWrapped = masterPhase < masterPhasePrev;
    cycleOffsetStep(prev) = ba.if(armEdge, 0.0,
                             ba.if(masterPhaseWrapped, prev + ba.if(masterLen < 0.5, wrapLen, masterLen), prev));
    cycleOffset = cycleOffsetStep ~ _;
    absPos = wrapAbs(masterPhase - ringOffset + latencyBiasN + cycleOffset, wrapLen);
    speedClamped = max(0.1, min(8.0, effSpeed));
    varispeedActive = effSpeed != 1.0;
    manualPunchActive = abs(effSpeed - 1.0) > 0.3;
    resyncCoeff = ba.if(manualPunchActive, 0.0, 0.0005);
    wrapDelta(prev) = wrapAbs(absPos - prev + wrapLen * 0.5, wrapLen) - wrapLen * 0.5;
    readPosStep(prev) = ba.if(armEdge | finishEdge, absPos,
                         ba.if(varispeedActive,
                               wrapAbs(prev + speedClamped + wrapDelta(prev) * resyncCoeff, wrapLen),
                               absPos));
    readPos = readPosStep ~ _;
    readIdx0 = int(readPos) % MAXLEN;
    readIdx1 = (int(readPos) + 1) % MAXLEN;
    readFrac = readPos - floor(readPos);
    ringCeil = rwtable(MAXLEN, 0.0, writeIdx, writeVal, readIdx1);
    delayed = ring + (ringCeil - ring) * readFrac;
    hold = delayed * (1.0 - recordingGateNow) * (1.0 - wipe);
    record = writeVal;
    loopSig = record + hold;
    out = loopSig * playN * (1.0 - recordingGateNow) * volN * duckGain;
    levelMeter = hbargraph("level", 0.0, 1.0);
    writeIdxMeter = hbargraph("writeidx", 0.0, float(MAXLEN));
    attachWriteIdx(x) = attach(x, x*0.0 + float(writeIdx) : writeIdxMeter);
    wrapLenMeter = hbargraph("wraplen", 0.0, float(MAXLEN));
    attachWrapLen(x) = attach(x, x*0.0 + float(wrapLen) : wrapLenMeter);
    readPosMeter = hbargraph("readposdiag2", 0.0, float(MAXLEN));
    attachReadPos(x) = attach(x, x*0.0 + float(readPos) : readPosMeter);
    levelPeakDecay = pow(0.001, 1.0/4096.0);
    levelPeakFollow(x) = loop ~ _
    with {
        loop(prev) = max(abs(x), prev * levelPeakDecay);
    };
    attachLevel(x) = attach(x, levelPeakFollow(x) : levelMeter) : attachWriteIdx : attachWrapLen : attachReadPos;
};

loopEngine(in, prevFiltIn, clearAll, effSpeed, masterPhase, masterLen, sidechainEnv, recordedBeats) = in, (par(i, NLOOPERS, vgroup("looper%2i", oneLooper(in, prevFiltIn, clearAll, effSpeed, masterPhase, masterLen, sidechainEnv, recordedBeats))) :> _);

process(in, prevFiltIn, clearAll, effSpeed, masterPhase, masterLen, sidechainEnv, recordedBeats) = loopEngine(in, prevFiltIn, clearAll, effSpeed, masterPhase, masterLen, sidechainEnv, recordedBeats);
