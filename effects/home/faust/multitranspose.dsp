declare name "MultiKeyTranspose";
declare author "aloop";
declare license "GPLv3";
declare description "Polyphonic pitch-lock: each held voice's shift is derived from (targetNote - the live-tracked input pitch at that voice's own note-on instant), tracked live and smoothed (20ms one-pole, snapping fresh at each attackEdge to avoid carrying a previous voice's stale state) through an 80ms warmup window before freezing into heldDetNote for the rest of that voice's sustain -- never re-tracked after freezing, so a mid-sustain plosive/burst cannot perturb an already-locked note, and never snapped raw at the literal attack sample, since a real singer's vibrato/onset transient can make one instantaneous sample an unreliable target even when the underlying tracker itself is accurate. This is an Auto-Tune-hard-lock-style harmonizer, not a fixed-interval Whammy-style one. The live-tracked freqDet (fx/extfreqdet/pitchtracker.lv2, falling back to an internal zero-crossing tracker) is ALSO used, independently, to size xpose's pitch-synchronous window/crossfade for natural, formant-preserving shifting (PSOLA-style: a window sized to the input's own true period preserves timbre at any shift ratio) -- a wrong window costs a little naturalness, never a wrong note, and this window sizing has its own separate onset-freeze protection (winFreezeDelayMs). formant additionally detunes the window/period ratio and applies a light spectral tilt for a real, continuously controllable vocal-character control, exact identity at formant=0.";

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

voiceOut(sig, winSamples, xfSamples, freqDet, targetNote, gate) = wet
with {
    attackEdge = gate > (gate : mem);
    sinceAttackStep(prev) = ba.if(attackEdge, 0.0, prev + 1.0);
    sinceAttack = sinceAttackStep ~ _;
    inLockWarmup = sinceAttack < lockDelaySamples;
    rawDetNote = ba.hz2midikey(freqDet);
    smoothPole = ba.tau2pole(0.02);
    smoothedDetNoteStep(prev) = ba.if(attackEdge, rawDetNote,
                                  prev * smoothPole + rawDetNote * (1.0 - smoothPole));
    smoothedDetNote = smoothedDetNoteStep ~ _;
    heldDetNoteStep(prev) = ba.if(inLockWarmup, smoothedDetNote, prev);
    heldDetNote = heldDetNoteStep ~ _;
    shiftTarget = targetNote - heldDetNote;
    shiftStep(prev) = ba.if(attackEdge, shiftTarget,
                       prev * normalGlidePole + shiftTarget * (1.0 - normalGlidePole));
    shiftAmount = shiftStep ~ _;
    voiceEnv    = en.adsr(0.003, 0.03, 1, 0.05, gate);
    wet = (sig : xpose(winSamples, xfSamples, shiftAmount)) * voiceEnv * 0.6;
};

harmonySum(sig, winSamples, xfSamples, freqDet, n0,g0, n1,g1, n2,g2, n3,g3, n4,g4, n5,g5) =
    voiceOut(sig,winSamples,xfSamples,freqDet,n0,g0) + voiceOut(sig,winSamples,xfSamples,freqDet,n1,g1)
  + voiceOut(sig,winSamples,xfSamples,freqDet,n2,g2) + voiceOut(sig,winSamples,xfSamples,freqDet,n3,g3)
  + voiceOut(sig,winSamples,xfSamples,freqDet,n4,g4) + voiceOut(sig,winSamples,xfSamples,freqDet,n5,g5);

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
    winFrozenStep(prev) = ba.if(inWinWarmup, winSamplesSmoothed, prev);
    winSamples = max(windowFloorSamples, int(winFrozenStep ~ _));
    xfSamplesSmoothed = xfSamplesRaw : si.smooth(ba.tau2pole(0.02));
    xfFrozenStep(prev) = ba.if(inWinWarmup, xfSamplesSmoothed, prev);
    xfSamples = max(crossfadeFloorSamples, int(xfFrozenStep ~ _));
    wetRaw = harmonySum(
        sigIn, winSamples, xfSamples, freqDet,
        n0,g0, n1,g1, n2,g2, n3,g3, n4,g4, n5,g5
    ) : ma.tanh;
    wet = formantTilt(formant, wetRaw);
    dryWet  = wet * (1.0-freeSmooth);
    loopWet = wet * freeSmooth;
};
