#ifndef DUBFX_PITCH_POLY_FFI_H
#define DUBFX_PITCH_POLY_FFI_H

#include "soladSnacOctaver.h"
#include "vowelFormant.h"
#include "snacPeriodTracker.h"

static const int DUBFX_POLY_VOICES = 6;
static const int DUBFX_POLY_BS = 64;
static const float DUBFX_POLY_SR = 48000.0f;
static const float kFormantPracticalMax = 1.5f;

struct DubfxPolyVoice {
    EngineSoladSnac eng;
    VowelFormantShaper vowel;
    SibilanceDetector sibilance;
    float lastScale = 1.0f;
    float lastFormant = 0.0f;
    bool  lastEngaged = false;
    float inBuf[DUBFX_POLY_BS] = {};
    float outBuf[DUBFX_POLY_BS] = {};
    int   pos = 0;
};

static SnacPeriodTracker& dubfx_poly_shared_snac() {
    static SnacPeriodTracker shared;
    return shared;
}

static DubfxPolyVoice& dubfx_poly_voice(int idx) {
    static DubfxPolyVoice voices[DUBFX_POLY_VOICES];
    static bool sharedTrackerAttached = false;
    if (!sharedTrackerAttached) {
        for (int v = 0; v < DUBFX_POLY_VOICES; v++)
            voices[v].eng.attachSharedTracker(&dubfx_poly_shared_snac());
        sharedTrackerAttached = true;
    }
    if (idx < 0) idx = 0;
    if (idx >= DUBFX_POLY_VOICES) idx = DUBFX_POLY_VOICES - 1;
    return voices[idx];
}

static inline void dubfx_poly_apply(DubfxPolyVoice& v, float scale, float formantDepth, float engaged) {
    if (scale != v.lastScale) { v.eng.setPitchScale(scale); v.lastScale = scale; }
    if (formantDepth != v.lastFormant) {
        v.eng.setFormantDepth(formantDepth);
        v.lastFormant = formantDepth;
        float norm = formantDepth / kFormantPracticalMax;
        if (norm > 1.0f) norm = 1.0f; else if (norm < -1.0f) norm = -1.0f;
        v.vowel.setVowelPos((norm + 1.0f) * 2.0f, DUBFX_POLY_SR);
    }
    bool eng = engaged >= 0.5f;
    if (eng && !v.lastEngaged) {
        v.eng.reengage();
        v.pos = 0;
        for (int i = 0; i < DUBFX_POLY_BS; i++) { v.inBuf[i] = 0.0f; v.outBuf[i] = 0.0f; }
    }
    v.lastEngaged = eng;
}

static inline void dubfx_poly_shape_block(DubfxPolyVoice& v) {
    float depth = fabsf(v.lastFormant) / kFormantPracticalMax;
    if (depth > 1.0f) depth = 1.0f;
    for (int i = 0; i < DUBFX_POLY_BS; i++) {
        float wet = v.outBuf[i];
        if (depth > 0.0f) {
            float colored = v.vowel.process(wet);
            wet = wet * (1.0f - depth) + colored * depth;
        }
        float sib = v.sibilance.update(v.inBuf[i], v.eng.periodOk());
        if (sib > 0.0f) {
            wet = wet * (1.0f - sib * 0.85f) + v.inBuf[i] * (sib * 0.85f);
        }
        v.outBuf[i] = wet;
    }
}

extern "C" inline float dubfx_pitch_tick_poly(float x, float voiceIdx, float scale, float formant, float engaged) {
    DubfxPolyVoice& v = dubfx_poly_voice((int)(voiceIdx + 0.5f));
    if (voiceIdx < 0.5f) dubfx_poly_shared_snac().tick(x);
    dubfx_poly_apply(v, scale, formant, engaged);

    if (!v.lastEngaged) return x;

    float y = v.outBuf[v.pos];
    v.inBuf[v.pos] = x;
    v.pos++;
    if (v.pos >= DUBFX_POLY_BS) {
        v.eng.processBlock(v.inBuf, v.outBuf, DUBFX_POLY_BS);
        dubfx_poly_shape_block(v);
        v.pos = 0;
    }
    return y;
}

extern "C" inline float dubfx_pitch_confidence_poly(float voiceIdx) {
    DubfxPolyVoice& v = dubfx_poly_voice((int)(voiceIdx + 0.5f));
    return v.eng.periodOk() ? 1.0f : 0.0f;
}

#endif
