declare name "MultiKeyTranspose";
declare author "aloop";
declare license "GPLv3";
declare description "Polyphonic pitch-LOCK harmonizer: extFreqDet-derived detNote drives each held voice's shift (targetNote - detNote), landing the wet output on the exact pressed key. extFreqDet is now an EXTERNAL audio-rate signal input (the pitchtracker.lv2 bundle's own output, computed continuously in C++ audio_thread.cpp every block) rather than an in-Faust computation -- this file's own previous zero-crossing-based tracker (trackPitchHzAndHp/octaveCorrect/jumpGuard) suffered a plosive/transient-triggered octave-search bug (a broadband burst mid-sustained-note corrupted the zero-crossing counter's internal state, sending it through wrong octaves for 130-150ms before recovering) that eleven-plus in-Faust gating-based fix attempts across multiple sessions could not resolve without either regressing steady-state accuracy or hitting a Faust compile-time wall (see AGENTS.md's full change history). A structurally different, verified-robust replacement tracker (normalized autocorrelation, immune to that failure class by construction) was built and confirmed correct in isolation, but wiring it directly into THIS file reproduced the identical compile-time wall regardless of tracking algorithm -- proving the wall is inherent to this file's own combined complexity (voiceOut/harmonySum's 6-voice machinery), not any one tracker's fault. The fix: pull tracking out entirely into its own LV2 bundle (effects/home/faust/pitchtracker_ac.dsp, compiled separately, hosted by a dedicated Lv2Host in audio_thread.cpp, called unconditionally every block since a pitch-lock harmonizer always needs a current pitch estimate) and feed its output in here as a plain signal, mirroring how resonodeIn already reaches effects_runtime.dsp the same way. Two additions on top of the base engine: (1) onsetUntrust, a per-voice trust gate keyed to that voice's own gate rising edge, which holds effDetNote at a two-tier fallback (heldDetNote) for a flat-hold-then-release window after note-on -- on this voice's first-ever onset (no prior gate), heldDetNote tracks targetNote live (a bounded, musically-safe fallback matching the original fix); on any LATER retrigger, it freezes at detNote's own last-settled pre-onset value instead, preserving whatever pitch-lock was already established rather than zeroing shiftAmount. Neither a pure blend-to-targetNote (zeroes shiftAmount, unlocks every attack) nor a pure freeze-last-value (has nothing sane to freeze onto on a true cold start) alone is correct -- both were tried, both regressed, see AGENTS.md; (2) formant (-3..3, default 0), which skews xpose's window/crossfade sizing (winSkewMul/formantXfSkew) for a real, monotonic timbral character control reachable while voices are locking a chord. Both additions are exact no-ops in their disabled/default state -- see AGENTS.md 'multitranspose.dsp: polyphonic pitch-LOCK, 6 voices' for the full derivation and numeric verification.";

import("stdfaust.lib");

NVOICES = 6;

glideTau = ba.tau2pole(0.008);
voiceGain = 0.6;
minTrackHz = 60.0;
maxTrackHz = 1500.0;
maxWindowMs = 20.0;

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

process(dry, loopSum, free, formant, extFreqDet, n0,g0, n1,g1, n2,g2, n3,g3, n4,g4, n5,g5) = dryWet, loopWet
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
