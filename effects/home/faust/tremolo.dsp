import("stdfaust.lib");

TREMOLOAMT = hslider("TREMOLOAMT", 0.0, 0.0, 1.0, 0.01);
BANKSPEED  = hslider("BANKSPEED", 0.5, 0.0, 1.0, 0.01);

RATE_MIN_HZ = 0.1;
DECADES     = 2.0;
lfoRateHz   = RATE_MIN_HZ * pow(10.0, DECADES * BANKSPEED);

lfoUni = (os.osc(lfoRateHz) + 1.0) * 0.5;

gain = 1.0 - TREMOLOAMT * (1.0 - lfoUni);

process = _ * gain;
