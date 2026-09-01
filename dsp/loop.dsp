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

    beatsPerMasterLen = max(1.0, recordedBeats);
    oneBeat = max(1.0, masterLen / beatsPerMasterLen);
    masterPhasePrev = masterPhase : mem;
    masterPhaseWrapped = masterPhase < masterPhasePrev;
    wrapAbs(p, len) = p - floor(p / float(len)) * float(len);
    beatPhase = wrapAbs(masterPhase, oneBeat);
    beatPhasePrev = beatPhase : mem;
    beatTickCrossed = beatPhase < beatPhasePrev;
    gridTickCrossed = beatTickCrossed;

    takeState(pendPrev, finPrev, actPrev, widxPrev, wlenPrev, rsmPrev, coffPrev, rposPrev, gatePrev) =
        (pendNext, finNext, actNext, widxNext, wlenNext, rsmNext, coffNext, rposNext, gateNext)
    with {
        recPrevEdge = recN : mem;
        armPulse = (recN > 0.5) & (recPrevEdge < 0.5);

        cancelPend = pendPrev & (finishReqN > 0.5) & (actPrev < 0.5);
        pendNext = ba.if(masterLen < 0.5, 0,
                    ba.if(pendPrev & gridTickCrossed, 0, ba.if(cancelPend, 0, ba.if(armPulse, 1, pendPrev))));
        armEdge = ba.if(masterLen < 0.5, armPulse, pendPrev & gridTickCrossed);

        rsmNext = ba.if(armEdge, masterPhase, rsmPrev);

        finNext = ba.if(armEdge, 0, ba.if(cancelPend, 0, ba.if(finishReqN > 0.5, 1, finPrev)));
        recKeepAlive = (recN > 0.5) | finNext;
        actNext = ba.if(armEdge, 1.0, ba.if(recKeepAlive, actPrev, 0.0));

        gateOf(x) = (actNext > 0.5) * (1.0 - finNext * (x >= finishTargetN));
        gateCur = gateOf(widxPrev);
        widxNext = ba.if(armEdge, 0,
                    ba.if(gateCur, min(widxPrev + 1, MAXLEN - 1), widxPrev));

        finishEdge = (gateCur < 0.5) & (gatePrev > 0.5);
        gateNext = gateCur;

        writeIdxForLatch = ba.if(finNext, finishTargetN, float(widxNext));
        intendedTakeLen = ba.if(finishTargetN > 0.5, finishTargetN, writeIdxForLatch);
        finishTakeLen = max(1.0, intendedTakeLen);
        takeLenBeats = finishTakeLen / oneBeat;
        gridPickEps = 0.01;
        anchorGridBeats = ba.if(takeLenBeats > 16.0 + gridPickEps, 16.0,
                           ba.if(takeLenBeats > 8.0 + gridPickEps, 8.0,
                             ba.if(takeLenBeats > 4.0 + gridPickEps, 4.0,
                               ba.if(takeLenBeats > 2.0 + gridPickEps, 2.0,
                                 ba.if(takeLenBeats > 1.0 + gridPickEps, 1.0,
                                   ba.if(takeLenBeats > 0.5 + gridPickEps, 0.5,
                                     ba.if(takeLenBeats > 0.25 + gridPickEps, 0.25, 0.125)))))));
        anchorGridLenNow = max(1.0, anchorGridBeats * oneBeat);
        gridMultiple = max(1.0, ceil(takeLenBeats / anchorGridBeats - gridPickEps));
        snappedWrapLen = ba.if(masterLen < 0.5, finishTakeLen, gridMultiple * anchorGridLenNow);
        wlenNext = ba.if(finishEdge, max(1.0, snappedWrapLen), wlenPrev);

        wrapLenCur = max(1, wlenNext);
        cycleInc = ba.if(masterLen < 0.5, wrapLenCur, masterLen);
        coffNext = ba.if(armEdge, 0.0,
                    ba.if(masterPhaseWrapped, wrapAbs(coffPrev + cycleInc, wrapLenCur), coffPrev));

        absPos = wrapAbs(masterPhase - rsmNext + latencyBiasN + coffNext, wrapLenCur);
        speedClamped = max(0.1, min(8.0, effSpeed));
        varispeedActive = effSpeed != 1.0;
        manualPunchActive = abs(effSpeed - 1.0) > 0.3;
        resyncCoeff = ba.if(manualPunchActive, 0.0, 0.0005);
        wrapDelta(prev) = wrapAbs(absPos - prev + wrapLenCur * 0.5, wrapLenCur) - wrapLenCur * 0.5;
        rposNext = ba.if(armEdge | finishEdge, absPos,
                    ba.if(varispeedActive,
                          wrapAbs(rposPrev + speedClamped + wrapDelta(rposPrev) * resyncCoeff, wrapLenCur),
                          absPos));
    };

    takeStateBus = (_,_,_,_,_,_,_,_,_) ~ takeState;
    pickState(k) = takeStateBus : (par(j, 9, *(j == k)) :> _);
    pend = pickState(0);
    fin = pickState(1);
    act = pickState(2);
    widxRaw = pickState(3);
    wlenRaw = pickState(4);
    rsm = pickState(5);
    coff = pickState(6);
    readPos = pickState(7);
    gateNow = pickState(8);

    wrapLen = max(1, wlenRaw);
    recordingGateNow = gateNow;

    writeVal = prevFiltIn * recordingGateNow * (1.0 - wipe);
    ring = rwtable(MAXLEN, 0.0, widxRaw, writeVal, int(readPos) % MAXLEN);

    readIdx0 = int(readPos) % MAXLEN;
    readIdx1 = (int(readPos) + 1) % MAXLEN;
    readFrac = readPos - floor(readPos);
    ringCeil = rwtable(MAXLEN, 0.0, widxRaw, writeVal, readIdx1);
    delayed = ring + (ringCeil - ring) * readFrac;
    hold = delayed * (1.0 - recordingGateNow) * (1.0 - wipe);
    record = writeVal;
    loopSig = record + hold;
    out = loopSig * playN * (1.0 - recordingGateNow) * volN * duckGain;
    levelMeter = hbargraph("level", 0.0, 1.0);
    writeIdxMeter = hbargraph("writeidx", 0.0, float(MAXLEN));
    attachWriteIdx(x) = attach(x, x*0.0 + float(widxRaw) : writeIdxMeter);
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
