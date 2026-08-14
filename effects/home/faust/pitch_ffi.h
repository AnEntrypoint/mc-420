#ifndef DUBFX_PITCH_FFI_H
#define DUBFX_PITCH_FFI_H

#include "soladSnacOctaver.h"

static EngineSoladSnac& dubfx_engine() {
    static EngineSoladSnac eng;
    return eng;
}

static float& dubfx_lastScale()   { static float s = 1.0f; return s; }
static bool&  dubfx_lastEngaged() { static bool e = false; return e; }

static inline void dubfx_pitch_apply(float scale, float formantDepth, float engaged) {
    EngineSoladSnac& e = dubfx_engine();
    if (scale != dubfx_lastScale()) { e.setPitchScale(scale); dubfx_lastScale() = scale; }
    e.setFormantDepth(formantDepth);
    bool eng = engaged >= 0.5f;
    if (eng && !dubfx_lastEngaged()) e.reengage();
    dubfx_lastEngaged() = eng;
}

static const int DUBFX_BS = 64;

extern "C" inline float dubfx_pitch_tick(float x, float scale, float formant, float engaged) {
    dubfx_pitch_apply(scale, formant, engaged);

    static float inBuf[DUBFX_BS];
    static float outBuf[DUBFX_BS];
    static int   pos = 0;

    if (!dubfx_lastEngaged()) return x;

    float y = outBuf[pos];
    inBuf[pos] = x;
    pos++;
    if (pos >= DUBFX_BS) {
        dubfx_engine().processBlock(inBuf, outBuf, DUBFX_BS);
        pos = 0;
    }
    return y;
}

#endif
