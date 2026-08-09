import("stdfaust.lib");

SR = 48000.0;
PI = 3.14159265;

hpK = 1.41421356;
hpG(cutoff) = tan(PI * (20.0 * pow(1000.0, cutoff)) / SR);

svfHPf(cutoff, x) = (blk ~ si.bus(2) : (!, !, _))
with {
    g  = hpG(cutoff);
    k  = hpK;
    a1 = 1.0 / (1.0 + g*(g+k));
    a2 = g*a1;
    a3 = g*a2;
    blk(ic1, ic2) = ic1n, ic2n, y
    with {
        v3  = x - ic2;
        v1  = a1*ic1 + a2*v3;
        v2  = ic2 + a2*ic1 + a3*v3;
        ic1n = 2.0*v1 - ic1;
        ic2n = 2.0*v2 - ic2;
        y = x - k*v1 - v2;
    };
};

lpMaxFreq = SR * 0.45;
lpG(cutoff) = tan(PI * min(20.0 * pow(1000.0, cutoff), lpMaxFreq) / SR);
lpK(res)    = 1.0 / (0.5 + (res*res) * 24.5);

softClip(x) = select2(x > 1.0,
                select2(x < -1.0, x - (x*x*x)/3.0, -2.0/3.0),
                2.0/3.0);

svfLPf(cutoff, res, x) = (blk ~ si.bus(2) : (!, !, _)) : softClip
with {
    g  = lpG(cutoff);
    k  = lpK(res);
    a1 = 1.0 / (1.0 + g*(g+k));
    a2 = g*a1;
    a3 = g*a2;
    blk(ic1, ic2) = ic1n, ic2n, v2
    with {
        v3  = x - ic2;
        v1  = a1*ic1 + a2*v3;
        v2  = ic2 + a2*ic1 + a3*v3;
        ic1n = 2.0*v1 - ic1;
        ic2n = 2.0*v2 - ic2;
    };
};

HPCUT = 0.0;
LPCUT = 1.0;
LPRES = 0.0;

hpStage(x) = select2(HPCUT > 0.01, x, svfHPf(HPCUT, x));
lpStage(x) = select2(LPCUT < 0.99, x, svfLPf(LPCUT, LPRES, x));

process = hpStage : lpStage;
