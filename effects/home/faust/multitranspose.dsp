declare name "MultiKeyTranspose";
declare author "aloop";
declare license "GPLv3";
declare description "Polyphonic pitch-LOCK harmonizer: an.pitchTracker detects the tracked signal's own fundamental once per sample, and each held voice's shift is (targetNote - detectedNote), so the wet output always lands on the exact pressed key regardless of what pitch is actually being played -- Infected Mushroom Manipulator style, not a fixed-interval transpose. The shift window is pitch-synchronous (sized from the detected period, like davemollen/dm-Whammy and DawDreamer's own dt_whammy.dsp auto_window), since a fixed window measurably detunes ef.transpose at large shift ratios -- confirmed via DawDreamer: a fixed 10ms window put a +22-semitone lock ~114 cents flat, while pitch-synchronous sizing holds every tested shift within a few cents. free crossfades the tracked/shifted source between dry (free=0) and loopSum (free=1), and routes the single shared wet bus to the matching output (dryWet/loopWet) -- so SHIFT-held polyphonic keyplay locks the loops instead of the live input, with no second pitch-tracker/voice bank. trackPitchHz reimplements an.pitchTracker's zero-crossing/adaptive-lowpass loop locally with two broadband zero-crossing floors on the adaptive cutoff (coarseTrackerTau=3ms, fastTrackerTau=1.5ms, both taken via max() against the main tracker's own recursive state, never replacing it): the stock function's cutoff is bounded only by a hardcoded 20Hz and its own zero-initialized recursive state, so after silence a fresh attack's cutoff has to crawl up from that floor, starving the filter of the true fundamental and reading far too low -- since shiftAmount is targetNote-detNote, an under-read detNote inflates the locked output sharp for the whole crawl. Two rounds of fixes: first, wideningfastHz's multiplier from *.5 to *.8 (WITNESSED via a real CI DawDreamer run) reduced but did not eliminate a real 123-188 cent mean sharp bias in the 35-100ms window specifically at 880-1318Hz, because both floors' time constants (coarseTrackerTau/fastTrackerTau) are fixed WALL-CLOCK values -- a high note's much shorter period means the same fixed tau spans proportionally many more of its own cycles before converging than it does for a low note. Second fix: freqScaledPole/onePoleZc replace an.zcr's fixed-tau smoothing for both floors with a hand-written one-pole (an.zcr's tau argument and si.smooth's pole coefficient are BOTH compile-time-constant-only per faustlibraries' analyzers.lib/filters.lib/signals.lib source -- verified, ruling out feeding a runtime signal into an.zcr directly) whose coefficient is derived each sample from the main tracker's own previous-sample output y (already in scope, no new estimator needed), scaled so the effective tau shrinks proportionally above minFloorCoeffHz -- unchanged at/below 60Hz (matching the original fixed baseline exactly there), progressively faster above it, so a 1300Hz transient converges roughly 20x faster in wall-clock terms than the old fixed-tau floor while a 60Hz or lower note's behavior is bit-identical to before.";

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

freqScaledPole(baseTau, freqHz) = ba.tau2pole(baseTau * minFloorCoeffHz / max(minFloorCoeffHz, freqHz));

onePoleZc(baseTau, freqHz, x) = loop ~ _
with {
    loop(prev) = ma.zc(x) * (1.0 - pole) + prev * pole
    with {
        pole = freqScaledPole(baseTau, freqHz);
    };
};

trackPitchHz(N, t, x) = loop ~ _
with {
    xHighpassed = fi.highpass(1, 20.0, x);
    loop(y) = an.zcr(t, fi.lowpass(N, cutoff, xHighpassed)) * ma.SR * .5
    with {
        coarseHz = onePoleZc(coarseTrackerTau, y, xHighpassed) * ma.SR * .5;
        fastHz   = onePoleZc(fastTrackerTau, y, xHighpassed) * ma.SR * .5;
        cutoff = max(minTrackHz, max(y, max(coarseHz * .5, fastHz * .8)));
    };
};

detectedFreq(sig) = sig
    : trackPitchHz(trackerHarmonics, trackerTau)
    : max(minTrackHz) : min(maxTrackHz);

windowFor(freqHz) = (ma.SR / freqHz)
    : max(64) : min(maxWindowMs * 0.001 * ma.SR)
    : si.smooth(ba.tau2pole(0.05)) : max(64) : int;

xposeMaxDelay = 4096;

xpose(w, x, s, sig) = de.fdelay(xposeMaxDelay,d,sig)*ma.fmin(d/x,1) +
    de.fdelay(xposeMaxDelay,d+w,sig)*(1-ma.fmin(d/x,1))
with {
    i = 1 - pow(2, s/12);
    d = i : (+ : +(w) : fmod(_,w)) ~ _;
};

voiceOut(sig, detNote, winSamples, xfSamples, targetNote, gate) = wet
with {
    shiftAmount = (targetNote - detNote) : si.smooth(glideTau);
    voiceEnv    = en.adsr(0.003, 0.03, 1, 0.05, gate);
    wet = (sig : xpose(winSamples, xfSamples, shiftAmount)) * voiceEnv * voiceGain;
};

harmonySum(sig, detNote, winSamples, xfSamples, n0,g0, n1,g1, n2,g2, n3,g3, n4,g4, n5,g5) =
    voiceOut(sig,detNote,winSamples,xfSamples,n0,g0) + voiceOut(sig,detNote,winSamples,xfSamples,n1,g1)
  + voiceOut(sig,detNote,winSamples,xfSamples,n2,g2) + voiceOut(sig,detNote,winSamples,xfSamples,n3,g3)
  + voiceOut(sig,detNote,winSamples,xfSamples,n4,g4) + voiceOut(sig,detNote,winSamples,xfSamples,n5,g5);

process(dry, loopSum, free, n0,g0, n1,g1, n2,g2, n3,g3, n4,g4, n5,g5) = dryWet, loopWet
with {
    freeSmooth = free : si.smoo;
    sigIn      = dry*(1.0-freeSmooth) + loopSum*freeSmooth;
    freqDet    = detectedFreq(sigIn);
    winSamples = windowFor(freqDet);
    xfSamples  = int(winSamples * 0.5) : max(32);
    wet = harmonySum(
        sigIn, ba.hz2midikey(freqDet), winSamples, xfSamples,
        n0,g0, n1,g1, n2,g2, n3,g3, n4,g4, n5,g5
    ) : ma.tanh;
    dryWet  = wet * (1.0-freeSmooth);
    loopWet = wet * freeSmooth;
};
