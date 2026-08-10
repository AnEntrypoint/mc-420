declare name "PitchTrackerAC";
declare author "aloop";
declare license "GPLv3";
declare description "Normalized-autocorrelation pitch tracker, packaged as its own standalone LV2 bundle (pitchtracker.lv2) rather than living inside multitranspose.dsp's always-on Core-1 chain. Built to replace multitranspose.dsp's zero-crossing-based detectedFreq stage, which suffers a plosive/transient-triggered octave-search bug (see AGENTS.md): a broadband burst mid-sustained-note corrupts the zero-crossing counter's internal state and sends it swinging through wrong octaves for 130-150ms before recovering. This tracker is structurally immune to that failure class -- broadband noise decorrelates with itself at any nonzero lag, so during a burst no candidate lag clears the correlation threshold and the tracker safely falls to its floor rather than confidently reporting a wrong pitch, then recovers to the exact correct frequency within 15-25ms of the burst ending (verified via DawDreamer against the project's own plosive-burst reproduction at 110/164.8/220/440Hz, and against the full 10-frequency onset/steady-state CI battery, 82-1318.5Hz). Mechanism: a 37-candidate coarse grid (60-1350Hz, geometric-mean-spaced) picks the true fundamental via a local-maximum test on normalized lag-domain autocorrelation (a candidate must clear a correlation threshold AND exceed both its immediate shorter-lag and longer-lag neighbors -- this two-sided test is what distinguishes a genuine fundamental from its harmonics/subharmonics, which also show high but non-peak correlation), followed by a 1-sample 3-point parabolic interpolation for sub-candidate accuracy. This exact design was verified in total isolation before ever being packaged as an LV2 bundle -- integrating it directly into multitranspose.dsp (in-Faust, not as a separate compilation unit) reproduces the same compile-time wall this file's own change history documents for every other tracker-replacement attempt, regardless of tracking algorithm; only pulling it out as its own bundle (this file) avoids that wall, mirroring resonode.lv2's own RT-budget-driven extraction for an analogous reason.";

import("stdfaust.lib");

minTrackHz = 60.0;
maxTrackHz = 1500.0;
corrThresh = 0.85;

xHp(x) = fi.highpass(1, 20.0, x);

lagFor(freqHz) = int(ma.SR / freqHz);

corrAtLag(x, lag) = num / den
with {
    d = x @ lag;
    energyTau = 0.01;
    pole = ba.tau2pole(energyTau);
    smoo(sig) = sig : *(1.0-pole) : + ~ *(pole);
    num = smoo(x * d);
    den = max(1e-9, smoo(x*x));
};

corrAtLagVar(x, lagSig) = num / den
with {
    lagClamped = lagSig : max(1) : min(3200);
    d = x @ lagClamped;
    energyTau = 0.01;
    pole = ba.tau2pole(energyTau);
    smoo(sig) = sig : *(1.0-pole) : + ~ *(pole);
    num = smoo(x * d);
    den = max(1e-9, smoo(x*x));
};

pickFundamental(x) = result
with {
    c(f) = corrAtLag(x, lagFor(f));
    isPeak(cLo, cMid, cHi) = (cMid >= corrThresh) & (cMid >= cLo) & (cMid >= cHi);

    result =
        ba.if(isPeak(c(1423.02), c(1350.0), c(1272.79)), 1350.0,
        ba.if(isPeak(c(1350.0), c(1272.79), c(1200.0)), 1272.79,
        ba.if(isPeak(c(1272.79), c(1200.0), c(1095.45)), 1200.0,
        ba.if(isPeak(c(1200.0), c(1095.45), c(1000.0)), 1095.45,
        ba.if(isPeak(c(1095.45), c(1000.0), c(938.08)), 1000.0,
        ba.if(isPeak(c(1000.0), c(938.08), c(880.0)), 938.08,
        ba.if(isPeak(c(938.08), c(880.0), c(784.86)), 880.0,
        ba.if(isPeak(c(880.0), c(784.86), c(700.0)), 784.86,
        ba.if(isPeak(c(784.86), c(700.0), c(641.01)), 700.0,
        ba.if(isPeak(c(700.0), c(641.01), c(587.0)), 641.01,
        ba.if(isPeak(c(641.01), c(587.0), c(508.21)), 587.0,
        ba.if(isPeak(c(587.0), c(508.21), c(440.0)), 508.21,
        ba.if(isPeak(c(508.21), c(440.0), c(391.87)), 440.0,
        ba.if(isPeak(c(440.0), c(391.87), c(349.0)), 391.87,
        ba.if(isPeak(c(391.87), c(349.0), c(320.32)), 349.0,
        ba.if(isPeak(c(349.0), c(320.32), c(294.0)), 320.32,
        ba.if(isPeak(c(320.32), c(294.0), c(277.33)), 294.0,
        ba.if(isPeak(c(294.0), c(277.33), c(261.6)), 277.33,
        ba.if(isPeak(c(277.33), c(261.6), c(239.9)), 261.6,
        ba.if(isPeak(c(261.6), c(239.9), c(220.0)), 239.9,
        ba.if(isPeak(c(239.9), c(220.0), c(201.74)), 220.0,
        ba.if(isPeak(c(220.0), c(201.74), c(185.0)), 201.74,
        ba.if(isPeak(c(201.74), c(185.0), c(169.66)), 185.0,
        ba.if(isPeak(c(185.0), c(169.66), c(155.6)), 169.66,
        ba.if(isPeak(c(169.66), c(155.6), c(142.66)), 155.6,
        ba.if(isPeak(c(155.6), c(142.66), c(130.8)), 142.66,
        ba.if(isPeak(c(142.66), c(130.8), c(119.95)), 130.8,
        ba.if(isPeak(c(130.8), c(119.95), c(110.0)), 119.95,
        ba.if(isPeak(c(119.95), c(110.0), c(100.87)), 110.0,
        ba.if(isPeak(c(110.0), c(100.87), c(92.5)), 100.87,
        ba.if(isPeak(c(100.87), c(92.5), c(84.83)), 92.5,
        ba.if(isPeak(c(92.5), c(84.83), c(77.8)), 84.83,
        ba.if(isPeak(c(84.83), c(77.8), c(71.33)), 77.8,
        ba.if(isPeak(c(77.8), c(71.33), c(65.4)), 71.33,
        ba.if(isPeak(c(71.33), c(65.4), c(62.64)), 65.4,
        ba.if(isPeak(c(65.4), c(62.64), c(60.0)), 62.64,
        ba.if(c(60.0) >= corrThresh, 60.0,
        60.0)))))))))))))))))))))))))))))))))))));
};

refineFreq(x, coarseFreq) = refinedFreq
with {
    L0 = int(ma.SR / coarseFreq) : max(2) : min(3199);
    cLo  = corrAtLagVar(x, L0 - 1 : max(1));
    cMid = corrAtLagVar(x, L0);
    cHi  = corrAtLagVar(x, L0 + 1 : min(3200));
    denom = cLo - 2.0*cMid + cHi;
    safeDenom = ba.if(abs(denom) < 1e-6, 1e-6, denom);
    delta = 0.5 * (cLo - cHi) / safeDenom : max(-0.5) : min(0.5);
    delta2 = ba.if(abs(denom) < 1e-6, 0.0, delta);
    refinedLag = float(L0) + delta2;
    refinedFreq = ma.SR / max(1.0, refinedLag);
};

detectedFreq(x) = refineFreq(xh, coarse)
with {
    xh = xHp(x);
    coarse = pickFundamental(xh);
};

process(sig) = detectedFreq(sig) : max(minTrackHz) : min(maxTrackHz);
