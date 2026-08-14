declare name "EffectsRuntime";
declare author "aloop";
declare description "The dubfx effect stages with every param exposed as a runtime UI control (hslider/checkbox/nentry) instead of a compile-time constant, so the remappable control map can set them live. Zone labels match targetToZone in the native shell (HPCUT, LPCUT, LPRES, REVAMT, DELAYAMT, TIME, FORMANT, SEMIS); any fx/resonode/... or fx/xpose.../... target passes through targetToZone verbatim. resonodeIn is now an external audio-rate signal input (the resonode.lv2 bundle's own output, computed in C++ audio_thread.cpp ONLY when fx/resonode/engaged is true) rather than an in-Faust component -- Resonode's per-block cost used to be paid unconditionally on every block even when idle, since Faust has no runtime branching to skip a stage. dry is now the guitar/lofi-fx LV2 bundle's OUTPUT (an input-stage effect that now runs before this whole chain), not the raw mic signal.";

import("stdfaust.lib");

HPCUT    = hslider("HPCUT",   0.0, 0.0, 1.0, 0.001);
LPCUT    = hslider("LPCUT",   1.0, 0.0, 1.0, 0.001);
LPRES    = hslider("LPRES",   0.0, 0.0, 1.0, 0.001);
REVAMT   = hslider("REVAMT",  0.0, 0.0, 2.0, 0.001);
DELAYAMT = hslider("DELAYAMT",0.0, 0.0, 1.0, 0.001);
TIME     = hslider("TIME",    0.5, 0.0, 1.0, 0.001);
FORMANT  = hslider("FORMANT", 0.0, -3.0, 3.0, 0.001);
SEMIS    = hslider("SEMIS",   0.0, -12.0, 12.0, 0.001);
EXTFREQDET = hslider("fx/extfreqdet", 0.0, 0.0, 1500.0, 0.01);
KEYSMULTIMODE = checkbox("fx/keys/multimode");
ENGAGED  = checkbox("ENGAGED");
RESONODE_ENGAGED = checkbox("fx/resonode/engaged");
glitchDivisor    = nentry("DIV", 0, 0, 16, 1);
masterLoopBlocks = nentry("MLB", 0, 0, 4096, 1);

DUBGATEAMT     = hslider("fx/dubgate/amt",        0.0, 0.0, 1.0, 0.001);
DUBGATEPATTERN = hslider("fx/dubgate/pattern",     0.0, 0.0, 1.0, 0.001);
DUBGATECLOCK   = hslider("fx/dubgate/clockphase",  0.0, 0.0, 1.0, 0.0001);
DUBLFORATE     = hslider("fx/dublfo/rate",         0.3, 0.0, 1.0, 0.001);
DUBLFODEPTH    = hslider("fx/dublfo/depth",        0.0, 0.0, 1.0, 0.001);
DUBLFOSHAPE    = hslider("fx/dublfo/shape",        0.0, 0.0, 1.0, 0.001);
DUBLFOTARGET   = hslider("fx/dublfo/target",       0.0, 0.0, 1.0, 0.001);
DUBLFOPHASE    = hslider("fx/dublfo/phase",        0.0, 0.0, 1.0, 0.001);

filterStage = component("effects/home/faust/filters.dsp")[ HPCUT=HPCUT; LPCUT=LPCUT; LPRES=LPRES; ];
delayStage  = component("effects/home/faust/delay.dsp")[ DELAYAMT=DELAYAMT; TIME=TIME; ];
reverbStage = component("effects/home/faust/reverb.dsp")[ REVAMT=REVAMT; TIME=TIME; ];
microStage  = component("effects/home/faust/microrepeat.dsp")[ DIV=glitchDivisor; MLB=masterLoopBlocks; ];
pitchStage  = component("effects/home/faust/pitch.dsp")[ SEMIS=SEMIS; FORMANT=FORMANT; ENGAGED=ENGAGED; ];

harmonize = component("effects/home/faust/multitranspose.dsp");

process(dry, loopSum, freeXpose, s0,g0, s1,g1, s2,g2, s3,g3, s4,g4, s5,g5, resonodeIn) = mainOut, loopHarmonyWet
with {
    anyVoiceGated = min(1.0, g0+g1+g2+g3+g4+g5);
    dryGate = (1.0 - anyVoiceGated*(1.0-freeXpose)) * (1.0 - KEYSMULTIMODE) : si.smoo;
    resonodeEngageGate = RESONODE_ENGAGED : si.smoo;
    harmonyBus     = harmonize(dry, loopSum, freeXpose, FORMANT, EXTFREQDET, s0,g0, s1,g1, s2,g2, s3,g3, s4,g4, s5,g5);
    dryWet         = harmonyBus : _,!;
    loopHarmonyWet = harmonyBus : !,_;
    preChain = (pitchStage(dry)*dryGate + dryWet)*(1.0-resonodeEngageGate) + resonodeIn*resonodeEngageGate;

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

    mainOut = preChain : microStage : filterStage : delayStage : reverbStage : dubGateLfoStage;
};
