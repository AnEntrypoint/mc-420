declare name "MultiKeyTranspose";
declare author "aloop";
declare license "GPLv3";
declare description "Polyphonic pitch-lock: each held voice's shift is derived from (targetNote - the live-tracked input pitch), continuously re-tracked for the whole sustain whenever the external autocorrelation tracker (fx/extfreqdet/pitchtracker.lv2) is trusted. The lock/attack/glide state machine (smoothedDetNote/heldDetNote/shiftAmount) is unchanged from the prior xpose()-based design -- what changed is the shifter itself: each of the 6 voices now runs its own EngineSoladSnac instance (pitch_poly.dsp/pitch_poly_ffi.h), the same SNAC-tracked splice-based PSOLA engine already proven on the mono free-transpose effect (pitch.dsp), instead of a two-tap delay-line interval shifter whose correctness depended on an externally-computed window matching the true input period. shiftAmount (semitones) converts to a ratio and drives the per-voice engine's own pitch tracking, transient-safe resplicing, and GrainFormant-based real formant preservation directly -- no separate window/crossfade computation or spectral-tilt formant hack needed in this file anymore.";

import("stdfaust.lib");

pitchPoly = component("pitch_poly.dsp");

NVOICES = 6;

trackerHarmonics = 4;
trackerTau = 0.02;
minTrackHz = 60.0;
maxTrackHz = 1500.0;

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

normalGlidePole = ba.tau2pole(0.008);

engageReleaseHoldS = 0.06;

lockDelayMs = 80.0;
lockDelaySamples = lockDelayMs * 0.001 * ma.SR;

voiceOut(voiceIdx, sig, freqDet, trustedTracker, formant, targetNote, gate) = wet, shiftAmount, heldDetNote
with {
    attackEdge = gate > (gate : mem);
    sinceAttackStep(prev) = ba.if(attackEdge, 0.0, prev + 1.0);
    sinceAttack = sinceAttackStep ~ _;
    inLockWarmup = sinceAttack < lockDelaySamples;
    rawDetNote = ba.hz2midikey(max(20.0, freqDet));
    lastConvergedNoteStep(prev) = ba.if(inLockWarmup, prev, rawDetNote);
    lastConvergedNoteRaw = lastConvergedNoteStep ~ _;
    lastConvergedNote = ba.if(ba.time == 0, targetNote, lastConvergedNoteRaw);
    smoothPole = ba.tau2pole(0.008);
    trackingAllowed = trustedTracker > 0.5;
    // heldDetNote only ever updates while trackingAllowed is true (external
    // tracker genuinely locked). A seed at ba.time==0 alone is not enough on
    // real hardware: the process starts long before any note is ever played,
    // so by the time a real first note attacks, that seed has already gone
    // stale (frozen at "no note held", i.e. 0) -- WITNESSED live on the real
    // Pi 4: a note played with the external tracker never yet trusted read
    // shiftAmount=60.00 (a 5-octave runaway) instead of the intended safe
    // unity fallback. everTrusted latches permanently the first time
    // trackingAllowed is ever true; until then, EVERY attackEdge reseeds
    // heldDetNote to that note's own targetNote (safe unity), not just the
    // literal first sample of the DSP instance's life. Once real trust has
    // been established even once, this reseed never fires again and the
    // existing lastConvergedNote-based behavior is unchanged.
    everTrustedStep(prev) = max(prev, trackingAllowed);
    everTrusted = everTrustedStep ~ _;
    smoothedDetNoteStep(prev) = ba.if(attackEdge, lastConvergedNote,
                                  ba.if(trackingAllowed,
                                    prev * smoothPole + rawDetNote * (1.0 - smoothPole),
                                    prev));
    smoothedDetNote = smoothedDetNoteStep ~ _;
    heldDetNoteStep(prev) = ba.if(trackingAllowed, smoothedDetNote,
                              ba.if(attackEdge & (everTrusted < 0.5), targetNote, prev));
    heldDetNote = heldDetNoteStep ~ _;
    shiftTarget = targetNote - heldDetNote;
    shiftStep(prev) = ba.if(attackEdge, shiftTarget,
                       prev * normalGlidePole + shiftTarget * (1.0 - normalGlidePole));
    shiftAmount = shiftStep ~ _;
    shiftRatio = pow(2.0, shiftAmount / 12.0);
    voiceEnv    = en.adsr(0.003, 0.03, 1, 0.05, gate);
    engageHoldStep(prev) = ba.if(gate > 0.5, 1.0,
                             max(0.0, prev - (1.0/(engageReleaseHoldS*ma.SR))));
    engageHold = engageHoldStep ~ _;
    engaged = engageHold > 0.0;
    pitchPolyOut = sig, voiceIdx, shiftRatio, formant, engaged : pitchPoly;
    shifted = pitchPolyOut : (_, !);
    wet = shifted * voiceEnv * 0.6;
};

harmonySum(sig, freqDet, trustedTracker, formant, n0,g0, n1,g1, n2,g2, n3,g3, n4,g4, n5,g5) = wetSum
with {
    v0 = voiceOut(0.0,sig,freqDet,trustedTracker,formant,n0,g0);
    w0 = v0 : (_,!,!);
    sh0 = v0 : (!,_,!);
    hd0 = v0 : (!,!,_);
    w1 = voiceOut(1.0,sig,freqDet,trustedTracker,formant,n1,g1) : (_,!,!);
    w2 = voiceOut(2.0,sig,freqDet,trustedTracker,formant,n2,g2) : (_,!,!);
    w3 = voiceOut(3.0,sig,freqDet,trustedTracker,formant,n3,g3) : (_,!,!);
    w4 = voiceOut(4.0,sig,freqDet,trustedTracker,formant,n4,g4) : (_,!,!);
    w5 = voiceOut(5.0,sig,freqDet,trustedTracker,formant,n5,g5) : (_,!,!);
    // Voice 0 only, tapped via the same attach() probe idiom freqDetDiag/
    // extFreqDetDiagRaw already use below -- attach(a,b) returns a
    // UNCHANGED while computing b (the bargraph) as a side effect, so this
    // has zero effect on the actual audio and only needs voice 0's own
    // shiftAmount/heldDetNote to reach a real output (matches
    // shiftamountdiag/helddetnotediag, the zone names audio_thread.cpp's
    // [diag-multitranspose] log already looks up by name).
    w0Tapped = attach(attach(w0, sh0 : hbargraph("shiftamountdiag", -60.0, 60.0)),
                       hd0 : hbargraph("helddetnotediag", 0.0, 127.0));
    wetSum = w0Tapped + w1 + w2 + w3 + w4 + w5;
};

freqDetMeter = hbargraph("freqdetdiag", 0.0, 2000.0);
rawExtFreqDetMeter = hbargraph("rawextfreqdetdiag", 0.0, 2000.0);
trustedTrackerMeter = hbargraph("trustedtrackerdiag", 0.0, 1.0);
freeMeter = hbargraph("freediag", 0.0, 1.0);

process(dry, loopSum, free, formant, extFreqDet, n0,g0, n1,g1, n2,g2, n3,g3, n4,g4, n5,g5) = dryWet, loopWet
with {
    freeSmooth = attach(free, free : freeMeter) : si.smoo;
    sigIn      = dry*(1.0-freeSmooth) + loopSum*freeSmooth;
    freqDetInternal = detectedFreq(sigIn);
    extFreqDetDiagRaw = attach(extFreqDet, extFreqDet : rawExtFreqDetMeter);
    extFreqDetApplies = extFreqDetDiagRaw > (minTrackHz + 1.0);
    freqDet    = ba.if(extFreqDetApplies, extFreqDetDiagRaw, freqDetInternal) : max(minTrackHz);
    trustedTracker = attach(extFreqDetApplies, extFreqDetApplies : trustedTrackerMeter);
    freqDetDiag = attach(freqDet, freqDet : freqDetMeter);
    anyGateHigh = (g0 > 0.5) | (g1 > 0.5) | (g2 > 0.5) | (g3 > 0.5) | (g4 > 0.5) | (g5 > 0.5);
    anyGateHighRelease(prev) = ba.if(anyGateHigh, 1.0, max(0.0, prev - (1.0/(0.1*ma.SR))));
    voiceActive = anyGateHighRelease ~ _;
    wetRaw = harmonySum(
        sigIn, freqDetDiag, trustedTracker, formant,
        n0,g0, n1,g1, n2,g2, n3,g3, n4,g4, n5,g5
    ) : ma.tanh : *(voiceActive);
    wet = wetRaw;
    dryWet  = wet * (1.0-freeSmooth);
    loopWet = wet * freeSmooth;
};
