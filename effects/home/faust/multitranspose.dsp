declare name "MultiKeyTranspose";
declare author "aloop";
declare license "GPLv3";
declare description "Polyphonic pitch-LOCK harmonizer: fx/extfreqdet-derived detNote drives each held voice's shift (targetNote - detNote), landing the wet output on the exact pressed key. fx/extfreqdet is a control-rate hslider fed once per block from a pitchtracker.lv2 bundle (computed in audio_thread.cpp) rather than an in-Faust computation -- see AGENTS.md for why. onsetUntrust/heldDetNote and formant are unchanged from before; see AGENTS.md 'multitranspose.dsp: polyphonic pitch-LOCK, 6 voices' for their full derivation.";

import("stdfaust.lib");

NVOICES = 6;

glideTau = ba.tau2pole(0.008);
voiceGain = 0.6;
minTrackHz = 60.0;
maxTrackHz = 1500.0;
maxWindowMs = 20.0;

extFreqDet = hslider("fx/extfreqdet", 220.0, minTrackHz, maxTrackHz, 0.01);

onsetFlatHoldMs = 110.0;
onsetReleaseMs = 60.0;
onsetFlatHoldSamples = onsetFlatHoldMs * 0.001 * ma.SR;
onsetReleaseSamples = onsetReleaseMs * 0.001 * ma.SR;
onsetTotalSamples = onsetFlatHoldSamples + onsetReleaseSamples;

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
    freqDet    = extFreqDet : max(minTrackHz) : min(maxTrackHz);
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
