declare name "EffectsRuntimePre";
declare author "aloop";
declare description "Pre-delay/reverb half of the dubfx chain: guitar/lofi-fx already applied in C++ (dry), pitch-lock harmony, microrepeat glitch stage, and the HP/LP/res filter -- everything up to the point delay/reverb used to run. Split out of effects_runtime.dsp so delay.dsp/reverb.dsp (both fully unconditional in Faust -- no runtime branching to skip their real cost even at amount=0) can be hosted as a separately-invoked LV2 bundle (delayverb.lv2) that audio_thread.cpp only calls .process() on when DELAYAMT/REVAMT are meaningfully nonzero, instead of paying their cost on every block regardless. See effects_runtime_post.dsp for the other half (takes the LV2 host's delay/reverb output back in, applies the dub-gate/LFO stage, and finishes the master/cue mix assembly identically to the original single-pass graph).";

import("stdfaust.lib");

REVAMT   = hslider("REVAMT",  0.0, 0.0, 2.0, 0.001);
DELAYAMT = hslider("DELAYAMT",0.0, 0.0, 1.0, 0.001);
TIME     = hslider("TIME",    0.5, 0.0, 1.0, 0.001);
HPCUT    = hslider("HPCUT",   0.0, 0.0, 1.0, 0.001);
LPCUT    = hslider("LPCUT",   1.0, 0.0, 1.0, 0.001);
LPRES    = hslider("LPRES",   0.0, 0.0, 1.0, 0.001);
FORMANT  = hslider("FORMANT", 0.0, -3.0, 3.0, 0.001);
SEMIS    = hslider("SEMIS",   0.0, -12.0, 12.0, 0.001);
EXTFREQDET = hslider("fx/extfreqdet", 0.0, 0.0, 1500.0, 0.01);
KEYSMULTIMODE = checkbox("fx/keys/multimode");
ENGAGED  = checkbox("ENGAGED");
RESONODE_ENGAGED = checkbox("fx/resonode/engaged");
glitchDivisor    = nentry("DIV", 0, 0, 16, 1);
masterLoopBlocks = nentry("MLB", 0, 0, 4096, 1);

SUSTAINGATE = hslider("SUSTAINGATE", 0.0, 0.0, 1.0, 1.0);

filterStage = component("effects/home/faust/filters.dsp")[ HPCUT=HPCUT; LPCUT=LPCUT; LPRES=LPRES; ];
microStage  = component("effects/home/faust/microrepeat.dsp")[ DIV=glitchDivisor; MLB=masterLoopBlocks; ];
pitchStage  = component("effects/home/faust/pitch.dsp")[ SEMIS=SEMIS; FORMANT=FORMANT; ENGAGED=ENGAGED; ];

harmonize = component("effects/home/faust/multitranspose.dsp");

process(dry, loopSum, freeXpose, s0,g0, s1,g1, s2,g2, s3,g3, s4,g4, s5,g5, resonodeIn) = preFilterOut, loopHarmonyWet, masterGatedIn, loopSum
with {
    anyVoiceGated = min(1.0, g0+g1+g2+g3+g4+g5);
    dryGate = (1.0 - anyVoiceGated) * (1.0 - KEYSMULTIMODE) : si.smoo;
    resonodeEngageGate = RESONODE_ENGAGED : si.smoo;
    harmonyBus     = harmonize(dry, loopSum, freeXpose, FORMANT, EXTFREQDET, s0,g0, s1,g1, s2,g2, s3,g3, s4,g4, s5,g5);
    dryWet         = harmonyBus : _,!;
    loopHarmonyWet = harmonyBus : !,_;
    preChain = (pitchStage(dry)*dryGate + dryWet)*(1.0-resonodeEngageGate) + resonodeIn*resonodeEngageGate;

    preFilterOut = preChain : microStage : filterStage;
    masterGatedIn = preFilterOut * SUSTAINGATE;
};
