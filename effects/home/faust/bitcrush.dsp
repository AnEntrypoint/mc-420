import("stdfaust.lib");

BITCRUSHAMT = hslider("BITCRUSHAMT", 0.0, 0.0, 1.0, 0.01);

BITS_MAX = 24.0;
BITS_MIN = 2.0;
bits = BITS_MAX - BITCRUSHAMT * (BITS_MAX - BITS_MIN);

levels = pow(2.0, bits - 1.0);
quantize(x) = rint(x * levels) / levels;

process = _ <: quantize;
