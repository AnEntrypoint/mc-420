import("stdfaust.lib");

SR = 48000.0;

FLUTTERAMT = hslider("FLUTTERAMT", 0.0, 0.0, 1.0, 0.01);

LFO_RATE_HZ = 9.0;

CENTER_MS = 8.0;
MAX_SWING_MS = 3.0;

MAXD = 1024;

lfo = os.osc(LFO_RATE_HZ);
swingMs = FLUTTERAMT * MAX_SWING_MS;
delayMs = CENTER_MS + lfo * swingMs;
delaySamples = delayMs * SR / 1000.0;

flutterWet(x) = de.fdelay(MAXD, delaySamples, x);

flutterMix(x) = x + FLUTTERAMT * (flutterWet(x) - x);

process = _ <: flutterMix;
