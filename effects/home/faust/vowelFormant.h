#ifndef VOWEL_FORMANT_H
#define VOWEL_FORMANT_H
#include <math.h>

struct LpcFormantShifter {
    static const int kOrder = 12;
    static const int kFrame = 512;
    static const int kFrameMask = kFrame - 1;
    static const int kAnalysisHop = 1024;
    static const int kMaxWarpLag = 36;
    static const int kMinWarpOrder = 4;
    static constexpr float kOctavesMax = 3.0f;
    static constexpr float kReflectionMagnitudeCeil = 0.985f;
    static constexpr float kPoleContraction = 0.995f;
    static constexpr float kLagWindowBandwidthHz = 120.0f;
    static constexpr float kWhiteNoiseCorrection = 1.0003f;
    static constexpr float kFrameEnergyFloor = 1.0e-9f;
    static constexpr float kResidualEnergyFloorRatio = 1.0e-7f;
    static constexpr float kGainMin = 0.125f;
    static constexpr float kGainMax = 8.0f;
    static constexpr float kGainGlidePerSample = 1.0f / 240.0f;
    static constexpr float kReflectionGlidePerBlock = 0.2f;
    static constexpr float kOutputMagnitudeCeil = 4.0f;

    LpcFormantShifter(float sampleRate = 48000.0f) {
        for (int n = 0; n < kFrame; n++)
            m_analysisWindow[n] = 0.5f - 0.5f * cosf(2.0f * (float)M_PI * (float)n / (float)kFrame);
        for (int k = 0; k <= kMaxWarpLag; k++) {
            float w = 2.0f * (float)M_PI * kLagWindowBandwidthHz * (float)k / sampleRate;
            m_lagWindow[k] = expf(-0.5f * w * w);
        }
        float g = kPoleContraction;
        for (int i = 0; i < kOrder; i++) { m_contraction[i] = g; g *= kPoleContraction; }
        reset();
    }

    void reset() {
        for (int i = 0; i < kFrame; i++) m_history[i] = 0.0f;
        m_historyWrite = 0;
        m_sinceAnalysis = kAnalysisHop;
        m_haveEnvelope = false;
        for (int i = 0; i < kOrder; i++) {
            m_reflSourceTarget[i] = 0.0f; m_reflShiftedTarget[i] = 0.0f;
            m_reflSourceNow[i] = 0.0f;    m_reflShiftedNow[i] = 0.0f;
            m_whitenCoeff[i] = 0.0f;      m_recolorCoeff[i] = 0.0f;
        }
        resetFilterState();
        m_gainTarget = 1.0f;
        m_gainNow = 1.0f;
        m_octaves = 0.0f;
    }

    void resetFilterState() {
        for (int i = 0; i < kOrder; i++) { m_whitenState[i] = 0.0f; m_recolorState[i] = 0.0f; }
    }

    void setFormantOctaves(float octaves) {
        if (octaves > kOctavesMax) octaves = kOctavesMax;
        else if (octaves < -kOctavesMax) octaves = -kOctavesMax;
        m_octaves = octaves;
    }

    void beginBlock() {
        if (m_sinceAnalysis >= kAnalysisHop) { m_sinceAnalysis = 0; estimateEnvelopes(); }
        for (int i = 0; i < kOrder; i++) {
            m_reflSourceNow[i]  += (m_reflSourceTarget[i]  - m_reflSourceNow[i])  * kReflectionGlidePerBlock;
            m_reflShiftedNow[i] += (m_reflShiftedTarget[i] - m_reflShiftedNow[i]) * kReflectionGlidePerBlock;
        }
        reflectionToDirect(m_reflSourceNow, m_contraction, m_whitenCoeff);
        reflectionToDirect(m_reflShiftedNow, m_contraction, m_recolorCoeff);
    }

    inline void observe(float x) {
        m_history[m_historyWrite] = x;
        m_historyWrite = (m_historyWrite + 1) & kFrameMask;
        if (m_sinceAnalysis < kAnalysisHop) m_sinceAnalysis++;
    }

    inline float process(float x) {
        observe(x);
        if (!m_haveEnvelope) return x;

        float residual = x;
        for (int j = 0; j < kOrder; j++) residual -= m_whitenCoeff[j] * m_whitenState[j];
        for (int j = kOrder - 1; j > 0; j--) m_whitenState[j] = m_whitenState[j - 1];
        m_whitenState[0] = x;

        m_gainNow += (m_gainTarget - m_gainNow) * kGainGlidePerSample;
        float y = residual * m_gainNow;
        for (int j = 0; j < kOrder; j++) y += m_recolorCoeff[j] * m_recolorState[j];

        if (!(y > -kOutputMagnitudeCeil && y < kOutputMagnitudeCeil)) {
            if (y != y) { resetFilterState(); return x; }
            y = (y > 0.0f) ? kOutputMagnitudeCeil : -kOutputMagnitudeCeil;
        }
        for (int j = kOrder - 1; j > 0; j--) m_recolorState[j] = m_recolorState[j - 1];
        m_recolorState[0] = y;
        return y;
    }

    bool envelopeReady() const { return m_haveEnvelope; }
    float gainNow() const { return m_gainNow; }
    float reflectionPeak() const {
        float p = 0.0f;
        for (int i = 0; i < kOrder; i++) {
            float a = fabsf(m_reflSourceNow[i]);  if (a > p) p = a;
            float b = fabsf(m_reflShiftedNow[i]); if (b > p) p = b;
        }
        return p;
    }

private:
    static bool levinson(const float* r, int order, float* reflection, float& residualEnergy) {
        float a[kOrder];
        for (int i = 0; i < kOrder; i++) a[i] = 0.0f;
        float energy = r[0];
        if (!(energy > 0.0f)) return false;
        const float energyFloor = r[0] * kResidualEnergyFloorRatio;
        for (int i = 0; i < order; i++) {
            float acc = r[i + 1];
            for (int j = 0; j < i; j++) acc -= a[j] * r[i - j];
            float k = acc / energy;
            if (k != k) return false;
            if (k > kReflectionMagnitudeCeil) k = kReflectionMagnitudeCeil;
            else if (k < -kReflectionMagnitudeCeil) k = -kReflectionMagnitudeCeil;
            float previous[kOrder];
            for (int j = 0; j < i; j++) previous[j] = a[j];
            for (int j = 0; j < i; j++) a[j] = previous[j] - k * previous[i - 1 - j];
            a[i] = k;
            reflection[i] = k;
            energy *= (1.0f - k * k);
            if (energy < energyFloor) energy = energyFloor;
        }
        for (int i = order; i < kOrder; i++) reflection[i] = 0.0f;
        residualEnergy = energy;
        return true;
    }

    static void reflectionToDirect(const float* reflection, const float* contraction, float* direct) {
        float scratch[kOrder];
        for (int i = 0; i < kOrder; i++) direct[i] = 0.0f;
        for (int i = 0; i < kOrder; i++) {
            float k = reflection[i];
            for (int j = 0; j < i; j++) scratch[j] = direct[j] - k * direct[i - 1 - j];
            for (int j = 0; j < i; j++) direct[j] = scratch[j];
            direct[i] = k;
        }
        for (int i = 0; i < kOrder; i++) direct[i] *= contraction[i];
    }

    void estimateEnvelopes() {
        float frame[kFrame];
        int oldest = m_historyWrite;
        for (int n = 0; n < kFrame; n++)
            frame[n] = m_history[(oldest + n) & kFrameMask] * m_analysisWindow[n];

        float r[kMaxWarpLag + 1];
        for (int k = 0; k <= kMaxWarpLag; k++) {
            float acc = 0.0f;
            for (int n = k; n < kFrame; n++) acc += frame[n] * frame[n - k];
            r[k] = acc;
        }
        if (!(r[0] > kFrameEnergyFloor)) return;
        for (int k = 1; k <= kMaxWarpLag; k++) r[k] *= m_lagWindow[k];
        r[0] *= kWhiteNoiseCorrection;

        float reflSource[kOrder];
        float energySource;
        if (!levinson(r, kOrder, reflSource, energySource)) return;

        float alpha = powf(2.0f, m_octaves);
        int warpOrder = kOrder;
        if (alpha > 1.0f) {
            int reachable = (int)((float)kMaxWarpLag / alpha);
            if (reachable < warpOrder) warpOrder = reachable;
        }
        if (warpOrder < kMinWarpOrder) warpOrder = kMinWarpOrder;

        float warped[kOrder + 1];
        warped[0] = r[0];
        for (int k = 1; k <= warpOrder; k++) {
            float lag = alpha * (float)k;
            if (lag > (float)kMaxWarpLag) lag = (float)kMaxWarpLag;
            int i = (int)lag;
            float frac = lag - (float)i;
            float lo = r[i];
            float hi = (i + 1 <= kMaxWarpLag) ? r[i + 1] : r[kMaxWarpLag];
            warped[k] = lo + (hi - lo) * frac;
        }

        float reflShifted[kOrder];
        float energyShifted;
        if (!levinson(warped, warpOrder, reflShifted, energyShifted)) return;

        float gain = sqrtf(energyShifted / energySource);
        if (!(gain > kGainMin)) gain = kGainMin;
        else if (gain > kGainMax) gain = kGainMax;

        for (int i = 0; i < kOrder; i++) {
            m_reflSourceTarget[i] = reflSource[i];
            m_reflShiftedTarget[i] = reflShifted[i];
        }
        m_gainTarget = gain;
        m_haveEnvelope = true;
    }

    float m_analysisWindow[kFrame];
    float m_lagWindow[kMaxWarpLag + 1];
    float m_contraction[kOrder];
    float m_history[kFrame];
    int   m_historyWrite;
    int   m_sinceAnalysis;
    bool  m_haveEnvelope;
    float m_reflSourceTarget[kOrder], m_reflShiftedTarget[kOrder];
    float m_reflSourceNow[kOrder], m_reflShiftedNow[kOrder];
    float m_whitenCoeff[kOrder], m_recolorCoeff[kOrder];
    float m_whitenState[kOrder], m_recolorState[kOrder];
    float m_gainTarget, m_gainNow;
    float m_octaves;
};

struct SibilanceDetector {
    float hpState = 0.0f;
    float xPrev = 0.0f;
    float envBroad = 0.0f;
    float envHf = 0.0f;
    float unpitchedGate = 0.0f;
    static constexpr float kHpPole = 0.5925f;
    static constexpr float kHpGain = (1.0f + kHpPole) * 0.5f;
    static constexpr float kBroadTc = 1.0f / 400.0f;
    static constexpr float kHfTc = 1.0f / 120.0f;
    static constexpr float kRatioFloor = 0.45f;
    static constexpr float kRatioSpan = 0.35f;
    static constexpr float kUnpitchedGateTc = 1.0f / 240.0f;

    inline float update(float x, bool pitchTrackerLocked) {
        float hp = kHpPole * hpState + kHpGain * (x - xPrev);
        hpState = hp;
        xPrev = x;
        float ax = fabsf(x);
        float ahp = fabsf(hp);
        envBroad += (ax - envBroad) * kBroadTc;
        envHf += (ahp - envHf) * kHfTc;
        float unpitchedTarget = pitchTrackerLocked ? 0.0f : 1.0f;
        unpitchedGate += (unpitchedTarget - unpitchedGate) * kUnpitchedGateTc;
        if (envBroad < 1e-6f) return 0.0f;
        float ratio = envHf / envBroad;
        float amt = (ratio - kRatioFloor) / kRatioSpan;
        if (amt < 0.0f) amt = 0.0f;
        if (amt > 1.0f) amt = 1.0f;
        return amt * unpitchedGate;
    }
};

#endif
