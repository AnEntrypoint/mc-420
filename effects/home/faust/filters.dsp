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
lpQ12(res)  = 0.70710678 + res * (8.0 - 0.70710678);
lpQ24a      = 0.54119610;
lpQ24b(res) = 1.30656296 + res * (14.6 - 1.30656296);

svfLP(g, k, x) = (blk ~ si.bus(2) : (!, !, _))
with {
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
LPSLOPE = 0.0;

hpStage(x) = select2(HPCUT > 0.01, x, svfHPf(HPCUT, x));

lpCutS   = 1.0 - ((1.0 - LPCUT) : si.smoo);
lpResS   = LPRES : si.smoo;
lpSlopeS = LPSLOPE : si.smoo;
lpStage(x) = x + lpWet*(lpMix - x)
with {
    g     = lpG(lpCutS);
    lp12  = svfLP(g, 1.0/lpQ12(lpResS), x);
    lpA   = svfLP(g, 1.0/lpQ24a, x);
    lp24  = svfLP(g, 1.0/lpQ24b(lpResS), lpA);
    lpMix = lp12 + lpSlopeS*(lp24 - lp12);
    lpWet = min(1.0, max(0.0, (0.995 - lpCutS)*100.0));
};

process = hpStage : lpStage;
