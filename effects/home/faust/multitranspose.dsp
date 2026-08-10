declare name "MultiKeyTranspose";
declare author "aloop";
declare license "GPLv3";
declare description "Polyphonic pitch-LOCK harmonizer: an.pitchTracker-derived detNote drives each held voice's shift (targetNote - detNote), landing the wet output on the exact pressed key. Two additions on top of the base engine: (1) onsetUntrust, a per-voice trust gate keyed to that voice's own gate rising edge, which holds effDetNote at a two-tier fallback (heldDetNote) for a flat-hold-then-release window after note-on -- on this voice's first-ever onset (no prior gate), heldDetNote tracks targetNote live (a bounded, musically-safe fallback matching the original fix); on any LATER retrigger, it freezes at detNote's own last-settled pre-onset value instead, preserving whatever pitch-lock was already established rather than zeroing shiftAmount. Neither a pure blend-to-targetNote (zeroes shiftAmount, unlocks every attack) nor a pure freeze-last-value (has nothing sane to freeze onto on a true cold start) alone is correct -- both were tried, both regressed, see AGENTS.md; (2) formant (-3..3, default 0), which skews xpose's window/crossfade sizing (winSkewMul/formantXfSkew) for a real, monotonic timbral character control reachable while voices are locking a chord. Both additions are exact no-ops in their disabled/default state -- see AGENTS.md 'multitranspose.dsp: polyphonic pitch-LOCK, 6 voices' for the full derivation and numeric verification.";

import("stdfaust.lib");

NVOICES = 6;

glideTau = ba.tau2pole(0.008);
voiceGain = 0.6;
trackerHarmonics = 4;
trackerTau = 0.02;
minTrackHz = 60.0;
maxTrackHz = 1500.0;
maxWindowMs = 20.0;

coarseTrackerTau = 0.003;
fastTrackerTau = 0.0015;
minFloorCoeffHz = 60.0;

onsetFlatHoldMs = 110.0;
onsetReleaseMs = 60.0;
onsetFlatHoldSamples = onsetFlatHoldMs * 0.001 * ma.SR;
onsetReleaseSamples = onsetReleaseMs * 0.001 * ma.SR;
onsetTotalSamples = onsetFlatHoldSamples + onsetReleaseSamples;

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

periodicityMaxDelay = 1024;
periodicityEnergyTau = 0.006;
periodicityConfThresh = 0.75;
periodicityEpsilon = 1e-6;
periodicityStreakSamples = 240;
slowRefTau = 0.02;

periodicityConfidenceAt(freqHz, x) = confidence
with {
    lagSamples = (ma.SR / max(minTrackHz, freqHz)) : min(periodicityMaxDelay - 1) : max(1.0);
    delayed = x : de.fdelay(periodicityMaxDelay, lagSamples);
    xEnergy = (x : ^(2.0)) : si.smooth(ba.tau2pole(periodicityEnergyTau));
    delayedEnergy = (delayed : ^(2.0)) : si.smooth(ba.tau2pole(periodicityEnergyTau));
    crossCorr = (x * delayed) : si.smooth(ba.tau2pole(periodicityEnergyTau));
    denom = sqrt(max(periodicityEpsilon, xEnergy * delayedEnergy));
    confidence = crossCorr / denom;
};

maxSemitoneJump = 9.0;
jumpMaxRatio = pow(2.0, maxSemitoneJump / 12.0);
jumpResyncMs = 25.0;
jumpResyncSamples = jumpResyncMs * 0.001 * ma.SR;

detectedFreq(sig) = trackedHz
with {
    trackOut = trackPitchHzAndHp(trackerHarmonics, trackerTau, sig);
    rawFreq = trackOut : (_, !) : max(minTrackHz) : min(maxTrackHz);
    xHp = trackOut : (!, _);

    firstSample = ba.time == 0;
    plausible(a, cand) = (cand < a * jumpMaxRatio) & (cand > a / jumpMaxRatio);
    conf = periodicityConfidenceAt(rawFreq, xHp);
    confOk = conf > periodicityConfThresh;
    streakStep(prev) = ba.if(confOk, min(periodicityStreakSamples, prev + 1.0), 0.0);
    streak = streakStep ~ _;
    candPeriodic = streak >= periodicityStreakSamples;

    slowRefStep(prev) = ba.if(firstSample, rawFreq, rawFreq * (1.0 - pole) + prev * pole)
    with {
        pole = ba.tau2pole(slowRefTau);
    };
    slowRef = slowRefStep ~ _;

    pairStep(anchorPrev, cntPrev) = newAnchor, newCnt
    with {
        forceResync = cntPrev >= jumpResyncSamples;
        plausibleVsAnchor = plausible(anchorPrev, rawFreq);
        plausibleVsSlowRef = plausible(slowRef, rawFreq);
        accept = firstSample | (plausibleVsAnchor & plausibleVsSlowRef) | (forceResync & candPeriodic);
        newAnchor = ba.if(accept, rawFreq, anchorPrev);
        newCnt = ba.if(accept, 0.0, cntPrev + 1.0);
    };
    pair = pairStep ~ (_, _);
    trackedHz = pair : (_, !);
};

winSkewMul(formant) = pow(1.2, formant * (1.0/3.0));

windowForFormant(freqHz, formant) = (ma.SR / freqHz) * winSkewMul(formant)
    : max(64) : min(maxWindowMs * 0.001 * ma.SR)
    : si.smooth(ba.tau2pole(0.05)) : max(64) : int;

xposeMaxDelay = 2000;

xpose(w, x, s, sig) = de.fdelay(xposeMaxDelay,d,sig)*ma.fmin(d/x,1) +
    de.fdelay(xposeMaxDelay,d+w,sig)*(1-ma.fmin(d/x,1))
with {
    i = 1 - pow(2, s/12);
    d = i : (+ : +(w) : fmod(_,w)) ~ _;
};

formantXfSkew(formant) = pow(4.0, formant * (1.0/3.0));

onsetUntrust(gate) = loop ~ _ : /(onsetReleaseSamples) : min(1.0) : max(0.0)
with {
    rising = gate > (gate : mem);
    loop(prevCnt) = ba.if(rising, onsetTotalSamples, max(0.0, prevCnt - 1.0));
};

voiceOut(sig, detNote, winSamples, xfSamples, targetNote, gate) = wet
with {
    untrust          = onsetUntrust(gate);
    everGatedStep(prev) = max(prev, gate > 0.5);
    everGatedBefore  = (everGatedStep ~ _) : mem;
    rising           = gate > (gate : mem);
    heldDetNoteStep(prev) = ba.if(everGatedBefore & rising, detNote : mem,
                             ba.if(everGatedBefore, prev, targetNote));
    heldDetNote      = heldDetNoteStep ~ _;
    effDetNote       = detNote*(1.0-untrust) + heldDetNote*untrust;
    shiftAmount = (targetNote - effDetNote) : si.smooth(glideTau);
    voiceEnv    = en.adsr(0.003, 0.03, 1, 0.05, gate);
    wet = (sig : xpose(winSamples, xfSamples, shiftAmount)) * voiceEnv * voiceGain;
};

harmonySum(sig, detNote, winSamples, xfSamples, n0,g0, n1,g1, n2,g2, n3,g3, n4,g4, n5,g5) =
    voiceOut(sig,detNote,winSamples,xfSamples,n0,g0) + voiceOut(sig,detNote,winSamples,xfSamples,n1,g1)
  + voiceOut(sig,detNote,winSamples,xfSamples,n2,g2) + voiceOut(sig,detNote,winSamples,xfSamples,n3,g3)
  + voiceOut(sig,detNote,winSamples,xfSamples,n4,g4) + voiceOut(sig,detNote,winSamples,xfSamples,n5,g5);

process(dry, loopSum, free, formant, n0,g0, n1,g1, n2,g2, n3,g3, n4,g4, n5,g5) = dryWet, loopWet
with {
    freeSmooth = free : si.smoo;
    sigIn      = dry*(1.0-freeSmooth) + loopSum*freeSmooth;
    freqDet    = detectedFreq(sigIn);
    winSamples = windowForFormant(freqDet, formant);
    xfSkew     = formantXfSkew(formant);
    xfSamples  = int(winSamples * 0.5 * xfSkew) : max(32);
    wet = harmonySum(
        sigIn, ba.hz2midikey(freqDet), winSamples, xfSamples,
        n0,g0, n1,g1, n2,g2, n3,g3, n4,g4, n5,g5
    ) : ma.tanh;
    dryWet  = wet * (1.0-freeSmooth);
    loopWet = wet * freeSmooth;
};
