declare name "PitchTrackerAC";
declare author "aloop";
declare license "GPLv3";
declare description "Normalized-autocorrelation pitch tracker, packaged as its own standalone LV2 bundle (pitchtracker.lv2) rather than living inside multitranspose.dsp's always-on Core-1 chain. Built to replace multitranspose.dsp's zero-crossing-based detectedFreq stage, which suffers a plosive/transient-triggered octave-search bug (see AGENTS.md): a broadband burst mid-sustained-note corrupts the zero-crossing counter's internal state and sends it swinging through wrong octaves for 130-150ms before recovering. This tracker is structurally immune to that failure class -- broadband noise decorrelates with itself at any nonzero lag, so during a burst no candidate lag clears the correlation threshold and the tracker safely falls to its floor rather than confidently reporting a wrong pitch, then recovers to the exact correct frequency within 15-25ms of the burst ending (verified via DawDreamer against the project's own plosive-burst reproduction at 110/164.8/220/440Hz, and against the full 10-frequency onset/steady-state CI battery, 82-1318.5Hz). Mechanism: a 37-candidate coarse grid (60-1350Hz, geometric-mean-spaced) picks the true fundamental via a local-maximum test on normalized lag-domain autocorrelation (a candidate must clear a correlation threshold AND exceed both its immediate shorter-lag and longer-lag neighbors -- this two-sided test is what distinguishes a genuine fundamental from its harmonics/subharmonics, which also show high but non-peak correlation), followed by a 16-sample-spread 3-point parabolic interpolation for sub-candidate accuracy -- widened from an original 1-sample spread, which left a real steady-state bias (measured 45-60 cents on harmonically-rich content at frequencies falling between candidate-grid points, since a 1-sample window cannot bridge the up-to-150-cent gaps between adjacent candidates) uncorrected; see AGENTS.md for the DawDreamer derivation. Candidates at or above 700Hz use a 2x-widened correlation smoothing time (0.02s vs the 0.01s used below 700Hz, via tauFor/corrAtLagTau) -- found via real recorded percussive-attack testing (marimba/vibraphone) that the fast 0.01s tau let a genuinely spurious high-octave candidate's correlation estimate clear threshold on broadband transient energy before the true (lower) fundamental's own correlation had built up, producing an audible false lock partway through the onset before correcting; the slower tau makes that specific false-positive harder to trigger with zero effect on steady-state accuracy (verified bit-identical CI figures at 880/1046.5/1318.5Hz) and zero added time-to-lock for candidates below 700Hz (unchanged). This candidate-tiered tau is a compile-time-constant-driven ba.if selection (mirroring pickFundamental's own literal-driven branch structure) rather than a runtime formula computed from the candidate frequency -- an earlier attempt using int/float-cast division+clamp per candidate hit a real multi-GB memory blowup during real Faust codegen (confirmed via two independent clean compile attempts, each exceeding 20 minutes before being killed) despite compiling fine under DawDreamer's JIT; only the literal-branch form compiles safely. The output holds at 0.0 (a safe fallback signal multitranspose.dsp's extFreqDet consumer already falls back on) for the first ~35ms after any fresh onset or re-attack from silence -- corrAtLag's internal correlation estimator has its own convergence time from its zero-initialized state, and without this hold a fresh onset could briefly read a spuriously high-octave or floor-frequency candidate before the true fundamental's correlation had accumulated (see AGENTS.md's plosive/octave-search entry for the real-hardware-witnessed symptom this fixed). subharmonicPromote is a post-hoc correction on top of the coarse pick: on rich harmonic content whose true fundamental falls between two grid points while a 2x/3x harmonic multiple lands almost exactly on one, pickFundamental's own local-max scan can settle on that subharmonic instead (see AGENTS.md); subharmonicPromote re-measures correlation at the picked candidate's own rounded-to-nearest-sample lag and at its 2x/3x harmonics' rounded lags (rounding, not truncating, matters here -- a bare int() lag at a short high-frequency period loses tens of cents of accuracy per truncated sample, enough on its own to make the true fundamental's harmonic read as weaker than the subharmonic), and promotes to whichever harmonic multiple's correlation dominates the original pick by a small margin, bounded to maxTrackHz. A symmetric demotion runs ahead of that promotion and fixes the inverse failure: a sustained note whose 2nd harmonic overtakes its own fundamental (the documented real-world octave-swap trigger, measured at +1200c on 110/220/440Hz) makes the octave-up candidate a local maximum in its own right, so pickFundamental's high-frequency-first scan settles there even though the true fundamental is still present. The discriminator is the correlation at half the pick's frequency: at that lag every even harmonic of the half-frequency aligns while every odd harmonic anti-aligns, so it reaches 1.0 only when no energy exists at the odd harmonics -- that is, when the pick really is the fundamental and the half-frequency candidate is spurious. A genuine lower fundamental leaves it short of the pick's own correlation by the same subharmDominanceMargin, which demotes the pick; a pure tone leaves it near -1 and a harmonically-rich one near -0.5, so neither is ever demoted wrongly. The demotion test compares corrPeakAt values -- the parabolic vertex of the correlation over a 1-sample spread -- and not raw correlations at integer lags: at 880Hz the integer lag costs the pick 0.0055 of correlation while costing its own octave-down neighbour almost nothing, which exceeds subharmDominanceMargin by itself and would make a correct 880Hz reading demote itself to 440Hz. The vertex recovers the true peak (0.99973 against 1.0 at 880Hz), leaving a 0.00026 gap between a tone and its own octave down -- well inside the margin -- so the comparison isolates the odd-harmonic term it is meant to test for. The 2x/3x promotion is left on raw rounded-to-nearest lags on purpose: it relies on the integer-lag penalty to separate a genuine 349Hz pick from 1047Hz, which peak values erase (measured -1896c regression at 1046.5Hz). A demotion also suppresses the promotion outright (notDemoted): after a demotion the 2x candidate IS the original pick, and at 110Hz the raw lag estimates ripple +-0.019 against a mean gap of 0.0047, so the promotion re-fired on 21% of samples and dragged the 200ms window mean from 110Hz to 133Hz; demotion and promotion are alternative corrections, never both. The demote decision itself is released slowly: demoteNow engages instantly but disengages only once its own 0.2s one-pole average has fallen below 0.5, because at 110Hz that ripple is 4-8x the evidence it carries and an instantaneous comparison flickers between octaves many times per 200ms window. That damper is applied by holding the already-refined frequency in detectedFreq's holdStep, never by feeding the recursive demote signal back into subharmonicPromote's baseFreq: baseFreq drives the correlation tap indices, and every tap whose lag is a signal once reached a variable-lag @, which is a real Faust compile-time cliff -- measured on the shipped codegen path, the pre-demote file compiles in 53s, one extra variable-lag @ pushes it to 70s, and four hit faust's own 120s SIGALRM (exit 142; a 150s sleep in the same step survives, so the alarm is faust's, not the runner's), while 148 fixed-lag correlations added 0.0s. Variable-lag reads therefore go through corrAtLagVar's rwtable tap rather than @: four such taps also measured 0.0s, and the tap renders bit-identically to @ at every lag from 3 to 3200, including a lag that changes every sample, under -vec -vs 32. The table is 4096 deep against a delayMaxLag of 3200, and its write index is a modulo-bounded counter rather than a free-running one, because a float accumulator loses integer exactness at 2^24 (~6 min at 48kHz) and a stalled index silently returns the wrong sample.";

import("stdfaust.lib");

minTrackHz = 60.0;
maxTrackHz = 1500.0;
corrThresh = 0.85;

delayTableSize = 4096;
delayMaxLag = 3200;

tableStep(prev) = int(prev + 1) % delayTableSize;

xHp(x) = fi.highpass(1, 20.0, x);

lagFor(freqHz) = int(ma.SR / freqHz);

tauFor(freqHz) = ba.if(freqHz >= 700.0, 0.02,
                  0.01);

corrAtLagTau(x, lag, energyTau) = num / den
with {
    d = x @ lag;
    pole = ba.tau2pole(energyTau);
    smoo(sig) = sig : *(1.0-pole) : + ~ *(pole);
    num = smoo(x * d);
    den = max(1e-9, smoo(x*x));
};

corrAtLag(x, lag) = corrAtLagTau(x, lag, 0.01);

corrAtLagVar(x, w, lagSig) = num / den
with {
    lagClamped = lagSig : max(1) : min(delayMaxLag);
    d = rwtable(delayTableSize, 0.0, w, x, (w + delayTableSize - lagClamped) % delayTableSize);
    energyTau = 0.01;
    pole = ba.tau2pole(energyTau);
    smoo(sig) = sig : *(1.0-pole) : + ~ *(pole);
    num = smoo(x * d);
    den = max(1e-9, smoo(x*x));
};

pickFundamental(x) = result
with {
    c(f) = corrAtLagTau(x, lagFor(f), tauFor(f));
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

refineFreq(x, w, coarseFreq) = refinedFreq
with {
    L0 = int(ma.SR / coarseFreq) : max(2 + refineSpreadK) : min(3199 - refineSpreadK);
    cLo  = corrAtLagVar(x, w, L0 - refineSpreadK);
    cMid = corrAtLagVar(x, w, L0);
    cHi  = corrAtLagVar(x, w, L0 + refineSpreadK);
    denom = cLo - 2.0*cMid + cHi;
    safeDenom = ba.if(abs(denom) < 1e-6, 1e-6, denom);
    delta = 0.5 * (cLo - cHi) / safeDenom : max(-1.0) : min(1.0);
    delta2 = ba.if(abs(denom) < 1e-6, 0.0, delta);
    refinedLag = float(L0) + delta2 * refineSpreadK;
    refinedFreq = ma.SR / max(1.0, refinedLag);
};

peakSpreadK = 1;

corrPeakAt(x, w, freqHz) = vertex
with {
    L0 = int(ma.SR / freqHz) : max(2 + peakSpreadK) : min(3199 - peakSpreadK);
    cLo  = corrAtLagVar(x, w, L0 - peakSpreadK);
    cMid = corrAtLagVar(x, w, L0);
    cHi  = corrAtLagVar(x, w, L0 + peakSpreadK);
    denom = cLo - 2.0*cMid + cHi;
    safeDenom = ba.if(denom > -1e-9, -1e-9, denom);
    vertex = (cMid - (cLo - cHi)*(cLo - cHi) / (8.0 * safeDenom)) : max(-1.0) : min(1.0);
};

subharmDominanceMargin = 0.004;

demoteTau = 0.2;
demotePole = ba.tau2pole(demoteTau);

corrRawAt(x, w, freqHz) = corrAtLagVar(x, w, int(ma.SR / freqHz + 0.5));

demoteTest(x, w, coarseFreq) = demoteNow
with {
    pCoarse = corrPeakAt(x, w, coarseFreq);
    freqH = coarseFreq * 0.5;
    pH = corrPeakAt(x, w, freqH);
    demoteNow = (freqH >= minTrackHz) & (pH >= corrThresh) & (pH > pCoarse + subharmDominanceMargin);
};

subharmonicPromote(x, w, coarseFreq, demoteNow) = promoted, promotedConfidence
with {
    freqH = coarseFreq * 0.5;
    baseFreq = ba.if(demoteNow, freqH, coarseFreq);
    pBase = ba.if(demoteNow, corrRawAt(x, w, freqH), corrRawAt(x, w, coarseFreq));
    freq2 = baseFreq * 2.0;
    freq3 = baseFreq * 3.0;
    p2 = corrRawAt(x, w, freq2);
    p3 = corrRawAt(x, w, freq3);
    reachable2 = freq2 <= maxTrackHz;
    reachable3 = freq3 <= maxTrackHz;
    notDemoted = 1.0 - demoteNow;
    dominant3 = reachable3 & (p3 >= corrThresh) & (p3 > pBase + subharmDominanceMargin) & (p3 >= p2) & (notDemoted > 0.5);
    dominant2 = reachable2 & (p2 >= corrThresh) & (p2 > pBase + subharmDominanceMargin) & (notDemoted > 0.5);
    promoted = ba.if(dominant3, freq3, ba.if(dominant2, freq2, baseFreq));
    promotedConfidence = ba.if(dominant3, p3, ba.if(dominant2, p2, pBase));
};

detectedFreq(x) = heldFreq, confident
with {
    xh = xHp(x);
    w = tableStep ~ _;
    coarseFreq = pickFundamental(xh);
    demoteNow = demoteTest(xh, w, coarseFreq);
    demoteDuty = demoteNow : *(1.0-demotePole) : + ~ *(demotePole);
    promotion = subharmonicPromote(xh, w, coarseFreq, demoteNow);
    corrected = promotion : (_, !);
    finalConfidence = promotion : (!, _);
    refinedNow = refineFreq(xh, w, corrected);
    takeNew = (demoteNow > 0.5) | (demoteDuty <= 0.5);
    holdStep(prev) = ba.if(takeNew, refinedNow, prev);
    heldFreq = holdStep ~ _;
    confident = finalConfidence >= corrThresh;
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

holdLastGood(freqHz, ready, confident) = out
with {
    fallingEdge = (ready:mem) * (1.0 - ready);
    accept = ready & confident;
    heldStep(prev) = ba.if(accept, freqHz, ba.if(fallingEdge > 0.5, 0.0, prev));
    out = heldStep ~ _;
};

process(sig) = holdLastGood(rawFreq, ready, confident)
with {
    detected = detectedFreq(sig);
    rawFreqUnclamped = detected : (_, !);
    confident = detected : (!, _);
    rawFreq = rawFreqUnclamped : max(minTrackHz) : min(maxTrackHz);
    ready = energyReady(sig);
};
