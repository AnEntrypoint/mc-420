import("stdfaust.lib");

fxpost = component("effects_runtime_post.dsp");

process(cueWet, masterWet, loopSum, loopHarmonyWet, freeXpose, s0,g0, s1,g1, s2,g2, s3,g3, s4,g4, s5,g5) =
    (cueWet, masterWet, loopSum, loopHarmonyWet, freeXpose, s0,g0, s1,g1, s2,g2, s3,g3, s4,g4, s5,g5) : fxpost;
