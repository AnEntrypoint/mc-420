import("stdfaust.lib");

loop = component("loop.dsp");
fxpre = component("effects_runtime_pre.dsp");

process(in, prevFiltIn, clearAll, effSpeed, masterPhase, masterLen, sidechainEnv, recordedBeats, freeXpose, s0,g0, s1,g1, s2,g2, s3,g3, s4,g4, s5,g5, resonodeIn) =
    (loop(in, prevFiltIn, clearAll, effSpeed, masterPhase, masterLen, sidechainEnv, recordedBeats), freeXpose, s0,g0, s1,g1, s2,g2, s3,g3, s4,g4, s5,g5, resonodeIn)
    : fxpre;
