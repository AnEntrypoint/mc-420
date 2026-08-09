import("stdfaust.lib");

SR = 48000.0;

VINYLAMT = hslider("VINYLAMT", 0.0, 0.0, 1.0, 0.01);

LP_CUTOFF_HZ = 3500.0;
HP_CUTOFF_HZ = 150.0;
BED_LEVEL = 0.12;

noiseBed = no.noise : fi.lowpass(1, LP_CUTOFF_HZ) : fi.highpass(1, HP_CUTOFF_HZ) : *(BED_LEVEL);

vinylMix(x) = x + VINYLAMT * noiseBed;

process = _ <: vinylMix;
