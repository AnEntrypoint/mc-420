#ifndef DUBFX_PITCH_POLY_FFI_H
#define DUBFX_PITCH_POLY_FFI_H

#include "soladSnacOctaver.h"

static const int DUBFX_POLY_VOICES = 6;
static const int DUBFX_POLY_BS = 64;

struct DubfxPolyVoice {
    EngineSoladSnac eng;
    float lastScale = 1.0f;
    float lastFormant = 0.0f;
    bool  lastEngaged = false;
    float inBuf[DUBFX_POLY_BS] = {};
    float outBuf[DUBFX_POLY_BS] = {};
    int   pos = 0;
};

static DubfxPolyVoice& dubfx_poly_voice(int idx) {
    static DubfxPolyVoice voices[DUBFX_POLY_VOICES];
    if (idx < 0) idx = 0;
    if (idx >= DUBFX_POLY_VOICES) idx = DUBFX_POLY_VOICES - 1;
    return voices[idx];
}

static inline void dubfx_poly_apply(DubfxPolyVoice& v, float scale, float formantDepth, float engaged) {
    if (scale != v.lastScale) { v.eng.setPitchScale(scale); v.lastScale = scale; }
    if (formantDepth != v.lastFormant) { v.eng.setFormantDepth(formantDepth); v.lastFormant = formantDepth; }
    bool eng = engaged >= 0.5f;
    if (eng && !v.lastEngaged) v.eng.reengage();
    v.lastEngaged = eng;
}

extern "C" inline float dubfx_pitch_tick_poly(float x, float voiceIdx, float scale, float formant, float engaged) {
    DubfxPolyVoice& v = dubfx_poly_voice((int)(voiceIdx + 0.5f));
    dubfx_poly_apply(v, scale, formant, engaged);

    if (!v.lastEngaged) return x;

    float y = v.outBuf[v.pos];
    v.inBuf[v.pos] = x;
    v.pos++;
    if (v.pos >= DUBFX_POLY_BS) {
        v.eng.processBlock(v.inBuf, v.outBuf, DUBFX_POLY_BS);
        v.pos = 0;
    }
    return y;
}

extern "C" inline float dubfx_pitch_confidence_poly(float voiceIdx) {
    DubfxPolyVoice& v = dubfx_poly_voice((int)(voiceIdx + 0.5f));
    return v.eng.periodOk() ? 1.0f : 0.0f;
}

#endif
