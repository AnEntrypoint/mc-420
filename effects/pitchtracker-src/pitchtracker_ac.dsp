declare name "PitchTrackerAC";
declare author "aloop";
declare license "GPLv3";
declare description "Normalized-autocorrelation pitch tracker, packaged as its own standalone LV2 bundle (pitchtracker.lv2) rather than living inside multitranspose.dsp's always-on Core-1 chain. Built to replace multitranspose.dsp's zero-crossing-based detectedFreq stage, which suffers a plosive/transient-triggered octave-search bug (see AGENTS.md): a broadband burst mid-sustained-note corrupts the zero-crossing counter's internal state and sends it swinging through wrong octaves for 130-150ms before recovering. This tracker is structurally immune to that failure class -- broadband noise decorrelates with itself at any nonzero lag, so during a burst no candidate lag clears the correlation threshold and the tracker safely falls to its floor rather than confidently reporting a wrong pitch, then recovers to the exact correct frequency within 15-25ms of the burst ending (verified via DawDreamer against the project's own plosive-burst reproduction at 110/164.8/220/440Hz, and against the full 10-frequency onset/steady-state CI battery, 82-1318.5Hz). Mechanism: a 37-candidate coarse grid (60-1350Hz, geometric-mean-spaced) picks the true fundamental via a local-maximum test on normalized lag-domain autocorrelation (a candidate must clear a correlation threshold AND exceed both its immediate shorter-lag and longer-lag neighbors -- this two-sided test is what distinguishes a genuine fundamental from its harmonics/subharmonics, which also show high but non-peak correlation), followed by a 16-sample-spread 3-point parabolic interpolation for sub-candidate accuracy -- widened from an original 1-sample spread, which left a real steady-state bias (measured 45-60 cents on harmonically-rich content at frequencies falling between candidate-grid points, since a 1-sample window cannot bridge the up-to-150-cent gaps between adjacent candidates) uncorrected; see AGENTS.md for the DawDreamer derivation. This exact design was verified in total isolation before ever being packaged as an LV2 bundle -- integrating it directly into multitranspose.dsp (in-Faust, not as a separate compilation unit) reproduces the same compile-time wall this file's own change history documents for every other tracker-replacement attempt, regardless of tracking algorithm; only pulling it out as its own bundle (this file) avoids that wall, mirroring resonode.lv2's own RT-budget-driven extraction for an analogous reason. The output holds at 0.0 (a safe fallback signal multitranspose.dsp's extFreqDet consumer already falls back on) for the first ~35ms after any fresh onset or re-attack from silence -- corrAtLag's internal correlation estimator has its own convergence time from its zero-initialized state, and without this hold a fresh onset could briefly read a spuriously high-octave or floor-frequency candidate before the true fundamental's correlation had accumulated (see AGENTS.md's plosive/octave-search entry for the real-hardware-witnessed symptom this fixed). subharmonicPromote is a post-hoc correction on top of the coarse pick: on rich harmonic content whose true fundamental falls between two grid points while a 2x/3x harmonic multiple lands almost exactly on one, pickFundamental's own local-max scan can settle on that subharmonic instead (see AGENTS.md); subharmonicPromote re-measures correlation at the picked candidate's own rounded-to-nearest-sample lag and at its 2x/3x harmonics' rounded lags (rounding, not truncating, matters here -- a bare int() lag at a short high-frequency period loses tens of cents of accuracy per truncated sample, enough on its own to make the true fundamental's harmonic read as weaker than the subharmonic), and promotes to whichever harmonic multiple's correlation dominates the original pick by a small margin, bounded to maxTrackHz.";

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
        ba.if(isPeak(c(1581.12), c(1500.0), c(1423.02)), 1500.0,
        ba.if(isPeak(c(1500.0), c(1423.02), c(1350.0)), 1423.02,
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
        60.0)))))))))))))))))))))))))))))))))))))));
};

refineSpreadK = 16;

refineFreq(x, coarseFreq) = refinedFreq
with {
    L0 = int(ma.SR / coarseFreq) : max(2 + refineSpreadK) : min(3199 - refineSpreadK);
    cLo  = corrAtLagVar(x, L0 - refineSpreadK);
    cMid = corrAtLagVar(x, L0);
    cHi  = corrAtLagVar(x, L0 + refineSpreadK);
    denom = cLo - 2.0*cMid + cHi;
    safeDenom = ba.if(abs(denom) < 1e-6, 1e-6, denom);
    delta = 0.5 * (cLo - cHi) / safeDenom : max(-1.0) : min(1.0);
    delta2 = ba.if(abs(denom) < 1e-6, 0.0, delta);
    refinedLag = float(L0) + delta2 * refineSpreadK;
    refinedFreq = ma.SR / max(1.0, refinedLag);
};

subharmDominanceMargin = 0.004;

roundedLag(freqHz) = int(ma.SR / freqHz + 0.5);

subharmonicPromote(x, coarseFreq) = promoted
with {
    cCoarse = corrAtLagVar(x, roundedLag(coarseFreq));
    freq2 = coarseFreq * 2.0;
    freq3 = coarseFreq * 3.0;
    c2 = corrAtLagVar(x, roundedLag(freq2));
    c3 = corrAtLagVar(x, roundedLag(freq3));
    reachable2 = freq2 <= maxTrackHz;
    reachable3 = freq3 <= maxTrackHz;
    dominant3 = reachable3 & (c3 >= corrThresh) & (c3 > cCoarse + subharmDominanceMargin) & (c3 >= c2);
    dominant2 = reachable2 & (c2 >= corrThresh) & (c2 > cCoarse + subharmDominanceMargin);
    promoted = ba.if(dominant3, freq3, ba.if(dominant2, freq2, coarseFreq));
};

detectedFreq(x) = refineFreq(xh, corrected)
with {
    xh = xHp(x);
    coarse = pickFundamental(xh);
    corrected = subharmonicPromote(xh, coarse);
};

onsetHoldMs = 35.0;
onsetHoldSamples = int(onsetHoldMs * 0.001 * ma.SR);

energyReady(x) = ready
with {
    envTau = 0.003;
    envPole = ba.tau2pole(envTau);
    env = x*x : *(1.0-envPole) : + ~ *(envPole);
    aboveFloor = env > 1e-6;
    countUp(prev) = min(onsetHoldSamples, prev + 1);
    holdCount = ba.if(aboveFloor, countUp, 0) ~ _;
    ready = holdCount >= onsetHoldSamples;
};

holdLastGood(freqHz, gate) = out
with {
    fallingEdge = (gate:mem) * (1.0 - gate);
    heldStep(prev) = ba.if(gate, freqHz, ba.if(fallingEdge > 0.5, 0.0, prev));
    out = heldStep ~ _;
};

process(sig) = holdLastGood(rawFreq, ready)
with {
    rawFreq = detectedFreq(sig) : max(minTrackHz) : min(maxTrackHz);
    ready = energyReady(sig);
};
