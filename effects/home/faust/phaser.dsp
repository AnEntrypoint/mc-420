import("stdfaust.lib");

PHASERAMT = hslider("PHASERAMT", 0.0, 0.0, 1.0, 0.01);
BANKSPEED = hslider("BANKSPEED", 0.5, 0.0, 1.0, 0.01);

RATE_MIN_HZ = 0.1;
DECADES     = 2.0;
lfoRateHz   = RATE_MIN_HZ * pow(10.0, DECADES * BANKSPEED);

lfoUni = (os.osc(lfoRateHz) + 1.0) * 0.5;

SWEEP_MIN_HZ = 200.0;
SWEEP_MAX_HZ = 2000.0;
sweepHz = SWEEP_MIN_HZ + lfoUni * (SWEEP_MAX_HZ - SWEEP_MIN_HZ);

SR = 48000.0;
PI = 3.14159265;
apCoeff(fc) = (t - 1.0) / (t + 1.0)
with { t = tan(PI * fc / SR); };

allpass1(fc, x) = (blk ~ si.bus(2)) : (!,_)
with {
    a = apCoeff(fc);
    blk(xprev, yprev) = x, y
    with {
        y = a*x + xprev - a*yprev;
    };
};

apStage(x) = allpass1(sweepHz, x);
apCascade(x) = x : apStage : apStage : apStage : apStage : apStage : apStage;

phaserMix(x) = x + PHASERAMT * (apCascade(x) - x);

process = _ <: phaserMix;
