declare name "MultiKeyTranspose";
declare author "aloop";
declare license "GPLv3";
declare description "Polyphonic pitch-lock: each held voice's shift is derived from (targetNote - the live-tracked input pitch), continuously re-tracked for the whole sustain whenever the external autocorrelation tracker (fx/extfreqdet/pitchtracker.lv2) is trusted (extFreqDet > 0.5) AND stable -- xpose() is structurally an interval shifter (it reads live input through a delay line at whatever ratio shiftAmount currently is), so a TRUE absolute-pitch lock (output always lands on the held key's pitch regardless of what's actually sung) requires the shift ratio to continuously chase (targetNote - liveDetNote), not freeze it once at attack: freezing the ratio only freezes the INTERVAL, and re-processing live input through a frozen interval still produces a different final pitch every time the input pitch changes. A trusted-but-still-converging tracker reading is not accepted immediately: heldDetNote only updates once freqDet has stayed within stabilityMaxJumpSemitones (0.6st) of itself for a full stabilityWindowMs (25ms) -- real percussive onsets (verified on real marimba/vibraphone recordings) can spuriously correlate at a wrong high-octave candidate for tens of ms before the true fundamental's correlation dominates, and blindly chasing every trusted-but-transient reading during that window audibly 'searches' through wrong pitches rather than landing once, correctly, on the true note. The first time a voice's tracker reading becomes both trusted and stable, heldDetNote AND smoothedDetNote's own recursive smoother both snap directly to that settled value (not glide into it via the 20ms-tau smoother, which would itself sound like a second, slower search) -- steady-state re-locking after that snap uses the smoother normally. winSamples/xfSamples (xpose's PSOLA window/crossfade sizing) are continuously re-tracked under the same trust condition for the same reason -- a stale window size measured against the WRONG period distorts the effective shift ratio xpose actually produces, not just its naturalness. Falls back to the OLD snap-then-freeze-after-80ms-warmup behavior only when the external tracker is untrusted (extFreqDet <= 0.5, i.e. the internal zero-crossing tracker's own real jitter/convergence-time limitations make continuous tracking unsafe there) -- see AGENTS.md's disclosed limitation on that fallback tracker. formant additionally detunes the window/period ratio and applies a light spectral tilt for a real, continuously controllable vocal-character control, exact identity at formant=0.";

import("stdfaust.lib");

NVOICES = 6;

trackerHarmonics = 4;
trackerTau = 0.02;
minTrackHz = 60.0;
maxTrackHz = 1500.0;
maxWindowMs = 20.0;

coarseTrackerTau = 0.003;
fastTrackerTau = 0.0015;
minFloorCoeffHz = 60.0;

freqScaledPole(baseTau, freqHz) = ba.tau2pole(baseTau * minFloorCoeffHz / max(minFloorCoeffHz, freqHz));

onePoleZc(baseTau, freqHz, x) = loop ~ _
with {
    loop(prev) = ma.zc(x) * (1.0 - pole) + prev * pole
    with {
        pole = freqScaledPole(baseTau, freqHz);
    };
};

trackPitchHzAndHp(N, t, x) = (loop ~ _), xHighpassed
with {
    xHighpassed = fi.highpass(1, 20.0, x);
    loop(y) = an.zcr(t, fi.lowpass(N, cutoff, xHighpassed)) * ma.SR * .5
    with {
        coarseHz = onePoleZc(coarseTrackerTau, y, xHighpassed) * ma.SR * .5;
        fastHz   = onePoleZc(fastTrackerTau, y, xHighpassed) * ma.SR * .5;
        cutoff = max(minTrackHz, max(y, max(coarseHz * .5, fastHz * .8)));
    };
};

maxSemitoneJump = 9.0;
jumpMaxRatio = pow(2.0, maxSemitoneJump / 12.0);
jumpResyncMs = 25.0;
jumpResyncSamples = jumpResyncMs * 0.001 * ma.SR;

jumpGuard(rawFreq) = anchorOut
with {
    firstSample = ba.time == 0;
    plausible(a, cand) = (cand < a * jumpMaxRatio) & (cand > a / jumpMaxRatio);
    pairStep(anchorPrev, cntPrev) = newAnchor, newCnt
    with {
        forceResync = cntPrev >= jumpResyncSamples;
        accept = firstSample | forceResync | plausible(anchorPrev, rawFreq);
        newAnchor = ba.if(accept, rawFreq, anchorPrev);
        newCnt = ba.if(accept, 0.0, cntPrev + 1.0);
    };
    pair = pairStep ~ (_, _);
    anchorOut = pair : (_, !);
};

detectedFreq(sig) = trackPitchHzAndHp(trackerHarmonics, trackerTau, sig)
    : (_, !) : max(minTrackHz) : min(maxTrackHz) : jumpGuard;

winSkewMul(formant) = pow(1.2, formant * (1.0/3.0));

windowFloorSamples = 70;
crossfadeFloorSamples = 35;

windowForFormant(freqHz, formant) = (ma.SR / freqHz) * winSkewMul(formant)
    : max(windowFloorSamples) : min(maxWindowMs * 0.001 * ma.SR)
    : si.smooth(ba.tau2pole(0.05)) : max(windowFloorSamples) : int;

xposeMaxDelay = 2000;

xpose(w, x, s, sig) = de.fdelay(xposeMaxDelay,d,sig)*crossfadeGain +
    de.fdelay(xposeMaxDelay,d+w,sig)*(1-crossfadeGain)
with {
    i = 1 - pow(2, s/12);
    d = i : (+ : +(w) : fmod(_,w)) ~ _;
    crossfadePos = ma.fmin(d/x,1);
    crossfadeGain = crossfadePos*crossfadePos*(3-2*crossfadePos);
};

formantXfSkew(formant) = pow(4.0, formant * (1.0/3.0));

winFreezeDelayMs = 80.0;
winFreezeDelaySamples = winFreezeDelayMs * 0.001 * ma.SR;

normalGlidePole = ba.tau2pole(0.008);

lockDelayMs = 80.0;
lockDelaySamples = lockDelayMs * 0.001 * ma.SR;

stabilityWindowMs = 25.0;
stabilityWindowSamples = stabilityWindowMs * 0.001 * ma.SR;
stabilityMaxJumpSemitones = 0.6;

voiceOut(sig, winSamples, xfSamples, freqDet, trustedTracker, targetNote, gate) = wet
with {
    attackEdge = gate > (gate : mem);
    sinceAttackStep(prev) = ba.if(attackEdge, 0.0, prev + 1.0);
    sinceAttack = sinceAttackStep ~ _;
    inLockWarmup = sinceAttack < lockDelaySamples;
    rawDetNote = ba.hz2midikey(freqDet);
    smoothPole = ba.tau2pole(0.02);
    smoothedDetNoteStep(prev) = ba.if(attackEdge | justTrustedAndStable, rawDetNote,
                                  prev * smoothPole + rawDetNote * (1.0 - smoothPole));
    smoothedDetNote = smoothedDetNoteStep ~ _;
    jumpDetectStep(prevRef) = ba.if(attackEdge, rawDetNote,
                               ba.if(abs(rawDetNote - prevRef) > stabilityMaxJumpSemitones, rawDetNote, prevRef));
    stableRef = jumpDetectStep ~ _;
    jumpNow = attackEdge | (abs(rawDetNote - stableRef) > stabilityMaxJumpSemitones);
    sinceJumpStep(prev) = ba.if(jumpNow, 0.0, prev + 1.0);
    sinceJump = sinceJumpStep ~ _;
    isStable = sinceJump >= stabilityWindowSamples;
    trustedAndStable = (trustedTracker > 0.5) & isStable;
    justTrustedAndStable = trustedAndStable > (trustedAndStable : mem);
    heldDetNoteStep(prev) = ba.if(attackEdge, rawDetNote,
                             ba.if(trustedTracker > 0.5,
                               ba.if(isStable, smoothedDetNote, prev),
                               ba.if(inLockWarmup, smoothedDetNote, prev)));
    heldDetNote = heldDetNoteStep ~ _;
    shiftTarget = targetNote - heldDetNote;
    shiftStep(prev) = ba.if(attackEdge, shiftTarget,
                       prev * normalGlidePole + shiftTarget * (1.0 - normalGlidePole));
    shiftAmount = shiftStep ~ _;
    voiceEnv    = en.adsr(0.003, 0.03, 1, 0.05, gate);
    wet = (sig : xpose(winSamples, xfSamples, shiftAmount)) * voiceEnv * 0.6;
};

harmonySum(sig, winSamples, xfSamples, freqDet, trustedTracker, n0,g0, n1,g1, n2,g2, n3,g3, n4,g4, n5,g5) =
    voiceOut(sig,winSamples,xfSamples,freqDet,trustedTracker,n0,g0) + voiceOut(sig,winSamples,xfSamples,freqDet,trustedTracker,n1,g1)
  + voiceOut(sig,winSamples,xfSamples,freqDet,trustedTracker,n2,g2) + voiceOut(sig,winSamples,xfSamples,freqDet,trustedTracker,n3,g3)
  + voiceOut(sig,winSamples,xfSamples,freqDet,trustedTracker,n4,g4) + voiceOut(sig,winSamples,xfSamples,freqDet,trustedTracker,n5,g5);

formantTiltDb(formant) = formant * 2.5;

formantTilt(formant, sig) = sig <: select2(formant != 0.0, _, tilted)
with {
    tilted = sig
        : fi.low_shelf(0.0 - formantTiltDb(formant), 400.0)
        : fi.high_shelf(formantTiltDb(formant), 3000.0);
};

process(dry, loopSum, free, formant, extFreqDet, n0,g0, n1,g1, n2,g2, n3,g3, n4,g4, n5,g5) = dryWet, loopWet
with {
    freeSmooth = free : si.smoo;
    sigIn      = dry*(1.0-freeSmooth) + loopSum*freeSmooth;
    freqDetInternal = detectedFreq(sigIn);
    freqDet    = ba.if(extFreqDet > 0.5, extFreqDet, freqDetInternal);
    trustedTracker = extFreqDet > 0.5;
    winSamplesRaw = windowForFormant(freqDet, formant);
    xfSkew     = formantXfSkew(formant);
    xfSamplesRaw = int(winSamplesRaw * 0.5 * xfSkew) : max(crossfadeFloorSamples);
    anyRising = (g0 > 0.5) & (g0 : mem < 0.5)
              | (g1 > 0.5) & (g1 : mem < 0.5)
              | (g2 > 0.5) & (g2 : mem < 0.5)
              | (g3 > 0.5) & (g3 : mem < 0.5)
              | (g4 > 0.5) & (g4 : mem < 0.5)
              | (g5 > 0.5) & (g5 : mem < 0.5);
    sinceRiseStep(prev) = ba.if(anyRising, 0.0, prev + 1.0);
    sinceRise = sinceRiseStep ~ _;
    inWinWarmup = sinceRise < winFreezeDelaySamples;
    winSamplesSmoothed = winSamplesRaw : si.smooth(ba.tau2pole(0.02));
    winFrozenStep(prev) = ba.if(trustedTracker > 0.5, winSamplesSmoothed,
                            ba.if(inWinWarmup, winSamplesSmoothed, prev));
    winSamples = max(windowFloorSamples, int(winFrozenStep ~ _));
    xfSamplesSmoothed = xfSamplesRaw : si.smooth(ba.tau2pole(0.02));
    xfFrozenStep(prev) = ba.if(trustedTracker > 0.5, xfSamplesSmoothed,
                           ba.if(inWinWarmup, xfSamplesSmoothed, prev));
    xfSamples = max(crossfadeFloorSamples, int(xfFrozenStep ~ _));
    wetRaw = harmonySum(
        sigIn, winSamples, xfSamples, freqDet, trustedTracker,
        n0,g0, n1,g1, n2,g2, n3,g3, n4,g4, n5,g5
    ) : ma.tanh;
    wet = formantTilt(formant, wetRaw);
    dryWet  = wet * (1.0-freeSmooth);
    loopWet = wet * freeSmooth;
};
