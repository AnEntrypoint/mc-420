#ifndef VOWEL_FORMANT_H
#define VOWEL_FORMANT_H
#include <math.h>

struct FormantBiquad {
    float b0 = 1.0f, b1 = 0.0f, b2 = 0.0f, a1 = 0.0f, a2 = 0.0f;
    float x1 = 0.0f, x2 = 0.0f, y1 = 0.0f, y2 = 0.0f;

    void setPeaking(float freq, float q, float gainDb, float sr) {
        float A = powf(10.0f, gainDb / 40.0f);
        float w0 = 2.0f * (float)M_PI * freq / sr;
        float alpha = sinf(w0) / (2.0f * q);
        float cw = cosf(w0);
        float b0n = 1.0f + alpha * A;
        float b1n = -2.0f * cw;
        float b2n = 1.0f - alpha * A;
        float a0n = 1.0f + alpha / A;
        float a1n = -2.0f * cw;
        float a2n = 1.0f - alpha / A;
        float inv = 1.0f / a0n;
        b0 = b0n * inv; b1 = b1n * inv; b2 = b2n * inv;
        a1 = a1n * inv; a2 = a2n * inv;
    }

    inline float process(float x) {
        float y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1; x1 = x;
        y2 = y1; y1 = y;
        return y;
    }
};

struct VowelDef { float f1, f2, f3; };

static inline const VowelDef* vowelTable() {
    static const VowelDef t[5] = {
        {300.0f, 870.0f, 2240.0f},
        {570.0f, 840.0f, 2410.0f},
        {730.0f, 1090.0f, 2440.0f},
        {530.0f, 1840.0f, 2480.0f},
        {270.0f, 2290.0f, 3010.0f},
    };
    return t;
}

static inline VowelDef vowelInterp(float pos) {
    const VowelDef* t = vowelTable();
    if (pos < 0.0f) pos = 0.0f;
    if (pos > 4.0f) pos = 4.0f;
    int i0 = (int)pos;
    int i1 = i0 + 1; if (i1 > 4) i1 = 4;
    float f = pos - (float)i0;
    VowelDef r;
    r.f1 = t[i0].f1 + (t[i1].f1 - t[i0].f1) * f;
    r.f2 = t[i0].f2 + (t[i1].f2 - t[i0].f2) * f;
    r.f3 = t[i0].f3 + (t[i1].f3 - t[i0].f3) * f;
    return r;
}

struct VowelFormantShaper {
    FormantBiquad band1, band2, band3;
    float lastVowelPos = -1000.0f;

    void setVowelPos(float pos, float sr) {
        if (fabsf(pos - lastVowelPos) < 0.004f) return;
        lastVowelPos = pos;
        VowelDef v = vowelInterp(pos);
        band1.setPeaking(v.f1, 9.0f, 9.0f, sr);
        band2.setPeaking(v.f2, 11.0f, 7.0f, sr);
        band3.setPeaking(v.f3, 13.0f, 5.0f, sr);
    }

    inline float process(float x) {
        float y = band1.process(x);
        y = band2.process(y);
        y = band3.process(y);
        return y;
    }
};

struct SibilanceDetector {
    float hpState = 0.0f;
    float xPrev = 0.0f;
    float envBroad = 0.0f;
    float envHf = 0.0f;
    static constexpr float kHpCoeff = 0.30f;
    static constexpr float kBroadTc = 1.0f / 400.0f;
    static constexpr float kHfTc = 1.0f / 120.0f;
    static constexpr float kRatioFloor = 0.45f;
    static constexpr float kRatioSpan = 0.35f;

    inline float update(float x) {
        float hp = kHpCoeff * (hpState + x - xPrev);
        hpState = hp;
        xPrev = x;
        float ax = fabsf(x);
        float ahp = fabsf(hp);
        envBroad += (ax - envBroad) * kBroadTc;
        envHf += (ahp - envHf) * kHfTc;
        if (envBroad < 1e-6f) return 0.0f;
        float ratio = envHf / envBroad;
        float amt = (ratio - kRatioFloor) / kRatioSpan;
        if (amt < 0.0f) amt = 0.0f;
        if (amt > 1.0f) amt = 1.0f;
        return amt;
    }
};

#endif
