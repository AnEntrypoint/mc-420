declare name "EffectsRuntimePost";
declare author "aloop";
declare description "Post-delay/reverb half of the dubfx chain: takes the delayverb.lv2 host's already-processed cue and master signals back in as external audio-rate inputs (same C++-external-signal pattern as effects_runtime.dsp's own resonodeIn), applies the dub-gate/LFO stage to cue, and finishes assembling filtOut/recordTap/inputFxOut identically to the original single-pass aloop.dsp graph. See effects_runtime_pre.dsp for the other half.";

import("stdfaust.lib");

DUBGATEAMT     = hslider("fx/dubgate/amt",        0.0, 0.0, 1.0, 0.001);
DUBGATEPATTERN = hslider("fx/dubgate/pattern",     0.0, 0.0, 1.0, 0.001);
DUBGATECLOCK   = hslider("fx/dubgate/clockphase",  0.0, 0.0, 1.0, 0.0001);
DUBLFORATE     = hslider("fx/dublfo/rate",         0.3, 0.0, 1.0, 0.001);
DUBLFODEPTH    = hslider("fx/dublfo/depth",        0.0, 0.0, 1.0, 0.001);
DUBLFOSHAPE    = hslider("fx/dublfo/shape",        0.0, 0.0, 1.0, 0.001);
DUBLFOTARGET   = hslider("fx/dublfo/target",       0.0, 0.0, 1.0, 0.001);
DUBLFOPHASE    = hslider("fx/dublfo/phase",        0.0, 0.0, 1.0, 0.001);

MONITORFOLD = hslider("MONITORFOLD", 0.0, 0.0, 1.0, 1.0);
GLITCHFOLD  = hslider("GLITCHFOLD",  0.0, 0.0, 1.0, 1.0);

process(cueWet, masterWet, loopSumIn, loopHarmonyWet, freeXpose, s0,g0, s1,g1, s2,g2, s3,g3, s4,g4, s5,g5) = filtOut, loopSumOut, recordTap, inputFxOut
with {
    loopSumOut = loopSumIn;
    dubGatePat0 = pow(max(0.0, 0.5 + 0.5*cos(2.0*ma.PI*4.0*DUBGATECLOCK)), 4.0);
    dubGatePat1 = pow(max(0.0, 0.5 + 0.5*cos(2.0*ma.PI*4.0*(DUBGATECLOCK-0.125))), 4.0);
    dubGatePat2 = pow(max(0.0, 0.5 + 0.5*cos(2.0*ma.PI*16.0*DUBGATECLOCK)), 6.0);
    dubGateBump(center) = pow(max(0.0, 0.5 + 0.5*cos(2.0*ma.PI*(DUBGATECLOCK-center))), 8.0);
    dubGatePat3 = min(1.0, dubGateBump(0.0/8.0) + dubGateBump(3.0/8.0) + dubGateBump(6.0/8.0));
    dubGatePatternIdx = int(min(3.0, max(0.0, DUBGATEPATTERN*4.0)));
    dubGateSelected = select2(dubGatePatternIdx==3,
                          select2(dubGatePatternIdx==2,
                              select2(dubGatePatternIdx==1, dubGatePat0, dubGatePat1),
                              dubGatePat2),
                          dubGatePat3);
    dubGateEnv = 1.0 - DUBGATEAMT*(1.0 - dubGateSelected);
    dubGateStage(x) = x * dubGateEnv;

    DUB_LFO_RATE_MIN_HZ = 0.02;
    DUB_LFO_RATE_DECADES = 3.0;
    dubLfoRateHz = DUB_LFO_RATE_MIN_HZ * pow(10.0, DUB_LFO_RATE_DECADES * DUBLFORATE);
    dubLfoPhaseAccum = (dubLfoRateHz/ma.SR) : (+ : ma.decimal) ~ _;
    dubLfoPhase01 = ma.decimal(dubLfoPhaseAccum + DUBLFOPHASE);
    dubLfoSine   = sin(2.0*ma.PI*dubLfoPhase01);
    dubLfoSquare = ma.signum(dubLfoSine);
    dubLfoRaw    = dubLfoSine*(1.0 - DUBLFOSHAPE) + dubLfoSquare*DUBLFOSHAPE;
    dubLfoUni    = (dubLfoRaw + 1.0) * 0.5;

    dubLfoVolMod(x) = x * dubLfoUni;
    DUB_LFO_WOBBLE_MIN_HZ = 300.0;
    DUB_LFO_WOBBLE_MAX_HZ = 6000.0;
    dubLfoWobbleHz = DUB_LFO_WOBBLE_MIN_HZ + dubLfoUni*(DUB_LFO_WOBBLE_MAX_HZ - DUB_LFO_WOBBLE_MIN_HZ);
    dubLfoFilterMod(x) = fi.lowpass(2, dubLfoWobbleHz, x);
    dubLfoTargeted(x) = dubLfoVolMod(x)*(1.0-DUBLFOTARGET) + dubLfoFilterMod(x)*DUBLFOTARGET;
    dubLfoStage(x) = x + DUBLFODEPTH*(dubLfoTargeted(x) - x);

    dubGateLfoStage = dubGateStage : dubLfoStage;

    mainOut = cueWet : dubGateLfoStage;

    anyVoiceGated  = min(1.0, g0+g1+g2+g3+g4+g5);
    loopDirectRaw  = 1.0 - max(max(MONITORFOLD, GLITCHFOLD), anyVoiceGated*freeXpose);
    loopDirectGate = loopDirectRaw : si.smoo;

    filtOut = mainOut + loopSumIn*loopDirectGate + loopHarmonyWet;
    recordTap = mainOut + loopHarmonyWet;
    inputFxOut = masterWet + loopHarmonyWet;
};
