import("stdfaust.lib");

SUSTAINGATE = hslider("SUSTAINGATE", 0.0, 0.0, 1.0, 1.0);

loop = component("loop.dsp");

NLOOPERS = 20;

fxpre(dry, loopSum, freeXpose, s0,g0, s1,g1, s2,g2, s3,g3, s4,g4, s5,g5, resonodeIn) = preFilterOut, loopHarmonyWet, masterGatedIn, loopSum
with {
    preFilterOut = dry;
    loopHarmonyWet = 0.0;
    masterGatedIn = preFilterOut * SUSTAINGATE;
};

process(in, prevFiltIn, clearAll, effSpeed, manualSpeed, masterPhase, masterLen, sidechainEnv, recordedBeats, freeXpose, s0,g0, s1,g1, s2,g2, s3,g3, s4,g4, s5,g5, resonodeIn) = fxOuts, loopSolos
with {
    loopBus = loop(in, prevFiltIn, clearAll, effSpeed, manualSpeed, masterPhase, masterLen, sidechainEnv, recordedBeats, freeXpose);
    loopMainAndSum = loopBus : (_, _, par(i, NLOOPERS, !));
    loopSolos = loopBus : (!, !, par(i, NLOOPERS, _));
    fxOuts = (loopMainAndSum, freeXpose, s0,g0, s1,g1, s2,g2, s3,g3, s4,g4, s5,g5, resonodeIn) : fxpre;
};
