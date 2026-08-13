import("stdfaust.lib");

DISTAMT = hslider("DISTAMT", 0.0, 0.0, 1.0, 0.01);

DRIVE_MAX = 24.0;
drive = 1.0 + DISTAMT * DRIVE_MAX;

TONE_MIN_HZ = 1200.0;
TONE_MAX_HZ = 9000.0;
toneHz = TONE_MAX_HZ - DISTAMT * (TONE_MAX_HZ - TONE_MIN_HZ);

shape(x) = ma.tanh(x * drive) / ma.tanh(drive);
distorted(x) = fi.lowpass(2, toneHz, shape(x));

distMix(x) = x + DISTAMT * (distorted(x) - x);

process = _ <: distMix;
