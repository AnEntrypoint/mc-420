import("stdfaust.lib");

SR = 48000.0;

COMPRESSAMT = hslider("COMPRESSAMT", 0.0, 0.0, 1.0, 0.01);

RATIO = 4.0;

RMS_MS = 50.0;
rmsCoeff = exp(-1.0 / (RMS_MS * 0.001 * SR));

SILENCE_FLOOR_LIN = 0.000001;

envFollow(x) = sqrt(max(SILENCE_FLOOR_LIN_SQ, powLP))
with {
    powLP = (x*x) : si.smooth(rmsCoeff);
    SILENCE_FLOOR_LIN_SQ = SILENCE_FLOOR_LIN * SILENCE_FLOOR_LIN;
};

envDb(x) = 20.0 * log10(max(SILENCE_FLOOR_LIN, envFollow(x)));

THRESH_MAX_DB = 24.0;
THRESH_MIN_DB = -24.0;

thresholdDb = THRESH_MAX_DB - COMPRESSAMT * (THRESH_MAX_DB - THRESH_MIN_DB);

overDb(x)   = max(0.0, envDb(x) - thresholdDb);
grDb(x)     = overDb(x) * (1.0 - 1.0 / RATIO);
grLinear(x) = pow(10.0, -grDb(x) / 20.0);

makeupDb     = max(0.0, 0.0 - thresholdDb) * (1.0 - 1.0 / RATIO);
makeupLinear = pow(10.0, makeupDb / 20.0);

combinedGain(x) = grLinear(x) * makeupLinear;

EXCESS_DRIVE = 20.0;
clampUnit(v) = max(-1.0, min(1.0, v));
saturateExcess(e) = (EXCESS_DRIVE * e / (1.0 + abs(EXCESS_DRIVE * e))) / EXCESS_DRIVE;
softLimit(v) = clampUnit(v) + saturateExcess(v - clampUnit(v));

compress(x) = softLimit(x * combinedGain(x));

process = _ <: compress;
