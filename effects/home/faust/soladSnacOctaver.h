#pragma once

#include <math.h>
#include <stdint.h>
#include <vector>
#include "grainFormant.h"

#ifndef SOLAD_M_PI
#define SOLAD_M_PI 3.14159265358979323846f
#endif

class EngineSoladSnac {
public:
    EngineSoladSnac() { reset(); }

    void reset() {
        initSincTable();
        for (int i = 0; i < DL; i++) m_dl[i] = 0.0f;
        m_formantDepth = 0.0f;
        m_wr = (uint32_t)m_initialReadOffset;
        m_rdA = 0.0;
        m_rdB = 0.0;
        m_useA = true;
        m_xfadeRemain = 0;
        m_xfadeLen = 0;
        m_scale = 1.0f;
        m_targetScale = 1.0f;
        m_period = 256;
        m_periodValid = false;
        m_lastGoodPeriodF = 256.0f;
        m_haveGoodPeriod = false;
        m_lockMiss = 0;
        m_spliceCooldown = 0;
        m_sinceDetect = 0;
        m_warmup = SNAC_WIN;
        m_envSlow = 0.0f;
        m_envFast = 0.0f;
        m_transCool = 0;
        m_transientHold = 0;
        for (int i = 0; i < SNAC_WIN; i++) m_snacBuf[i] = 0.0f;
        m_snacWr = 0;
        m_snacPhase = SNAC_IDLE;
        m_snacK = 1;
        m_snacEnergy = 0.0f;
        m_snacMaxTau = 0;
    }

    void setPitchScale(float s) { m_targetScale = s; }

    void reengage() {
        m_rdA = (double)((int64_t)m_wr - m_initialReadOffset);
        m_rdB = (double)((int64_t)m_wr - m_initialReadOffset);
        m_useA = true;
        m_xfadeRemain = 0;
        m_xfadeLen = 0;
        m_scale = m_targetScale;
        m_periodValid = false;
        m_sinceDetect = 0;
        m_lastGoodPeriodF = kReengageSeedPeriod;
        m_haveGoodPeriod = true;
        m_lockMiss = 0;
        m_spliceCooldown = 0;
        m_grainFormant.reset();
        m_grainFormant.setFormantFactor(powf(2.0f, m_formantDepth));
    }

    void setInitialReadOffset(int samples) {
        if (samples < 32) samples = 32;
        if (samples > DL - 64) samples = DL - 64;
        m_initialReadOffset = samples;
    }
    int  getInitialReadOffset() const { return m_initialReadOffset; }

    void setRespliceFrac(float f) { if(f<0.25f)f=0.25f; if(f>128.0f)f=128.0f; m_respliceFrac = f; }
    void setXfadeScale(float s) {
        if (s < 0.25f) s = 0.25f;
        if (s > 4.0f) s = 4.0f;
        m_xfadeScale = s;
    }

    void setFidelityThresh(float f) {
        if (f < 0.30f) f = 0.30f;
        if (f > 0.95f) f = 0.95f;
        m_fidelityThresh = f;
    }

    void setSpliceSnap(bool on) { m_spliceSnap = on; }

    void setSpliceMatch(bool on) { m_spliceMatch = on; }

    void setDriftLowBand(int samples) {
        if (samples < 1) samples = 1;
        if (samples > DL / 4) samples = DL / 4;
        m_driftLowBand = samples;
    }

    void setDriftHighHead(int samples) {
        if (samples < 16) samples = 16;
        if (samples > DL / 2) samples = DL / 2;
        m_driftHighHead = samples;
    }

    void setFormantDepth(float d) {
        m_formantDepth = d;
        m_grainFormant.setFormantFactor(powf(2.0f, d));
        float a = d < 0 ? -d : d;
        if (a <= kFormantDeadbandSetter) m_grainMixTarget = 0.0f;
        else           m_grainMixTarget = kFormantMixCap * (a - kFormantDeadbandSetter) / (1.0f - kFormantDeadbandSetter);
    }

    void processBlock(const float* in, float* out, int n) {
        for (int i = 0; i < n; i++) {
            float xWarped = in[i];

            float x = xWarped;
            m_dl[m_wr & MASK] = x;
            m_wr++;
            m_grainFormant.write(x);

            m_snacBuf[m_snacWr] = x;
            m_snacWr = (m_snacWr + 1) % SNAC_WIN;

            if (i == 0) {
                if (m_snacPhase == SNAC_IDLE) {
                    if ((m_sinceDetect += n) >= SNAC_HOP) { m_sinceDetect = 0; snacBegin(); }
                } else {
                    detectPitchStep();
                }
            }

            float ax = fabsf(x);
            m_envSlow += (ax - m_envSlow) * ENV_SLOW_TC;
            m_envFast += (ax - m_envFast) * ENV_FAST_TC;
            float envDeriv = m_envFast - m_envFastPrev;
            m_envFastPrev = m_envFast;
            bool transient = false;
            if (m_transCool > 0) m_transCool--;
            else if (m_envFast > m_envSlow * 3.0f
                     && m_envFast > 0.05f
                     && envDeriv > 0.005f) {
                transient = true;
                m_transCool = TRANS_REFRACTORY;
            }
            if (transient) m_transientHold = (int)(m_lastGoodPeriodF > 0.0f
                                                   ? m_lastGoodPeriodF * 2.0f : 512.0f);
            if (m_transientHold > 0) m_transientHold--;

            if (m_targetScale == 1.0f) {
                m_scale = 1.0f;
            } else {
                m_scale += (m_targetScale - m_scale) * kFormantGlideInvSamples;
            }

            if (m_warmup > 0) {
                m_warmup--;
                out[i] = 0.0f;
                m_rdA = (double)(m_wr - m_initialReadOffset);
                m_rdB = (double)(m_wr - m_initialReadOffset);
                continue;
            }

            double &rdActive  = m_useA ? m_rdA : m_rdB;
            double &rdPassive = m_useA ? m_rdB : m_rdA;

            double gap = (double)m_wr - rdActive;
            double driftFromTarget = gap - (double)m_initialReadOffset;
            if (m_periodValid && m_periodF >= (float)MIN_PERIOD) {
                m_lastGoodPeriodF = m_periodF;
                m_haveGoodPeriod = true;
            }
            if (m_spliceCooldown > 0) m_spliceCooldown--;
            if (m_haveGoodPeriod) {
                double per = (double)m_lastGoodPeriodF;
                double trigger = per * m_respliceFrac;
                if (driftFromTarget > trigger && m_envSlow > 0.003f
                    && m_xfadeRemain == 0 && m_spliceCooldown == 0
                    && m_transientHold == 0) {
                    m_spliceCooldown = (int)(per * kSpliceCooldownFrac);
                    triggerSpliceByPeriod(per, driftFromTarget);
                }
            }
            bool quiet = m_envSlow < 0.004f;
            if (gap > (double)(DL - 64) || gap < (double)(SINC_HALF + 2)) {
                if (quiet) {
                    double safe = (double)m_wr - (double)m_initialReadOffset;
                    m_rdA = safe; m_rdB = safe;
                } else {
                    m_emergencyCount++;
                    triggerSplice(false);
                }
            }
            m_gapBias = 0.0;

            float yA = readSinc(m_rdA);
            float yB = readSinc(m_rdB);
            float w  = (m_xfadeRemain > 0 && m_xfadeLen > 0)
                       ? (float)m_xfadeRemain / (float)m_xfadeLen
                       : 0.0f;
            float wActive  = 1.0f - w;
            float wPassive = w;

            float y = m_useA ? (yA * wActive + yB * wPassive)
                             : (yB * wActive + yA * wPassive);
            if (m_haveGoodPeriod) {
                m_grainFormant.setScale(m_scale);
                m_grainFormant.setInputPeriod((double)m_lastGoodPeriodF);
            }
            float gOut = m_grainFormant.read();
            float fmNow = m_grainFormant.factorNow();
            float dev = fmNow > 1.0f ? (fmNow - 1.0f) : (1.0f - fmNow);
            float mixTgt = dev <= kFormantDeadbandBlock
                           ? 0.0f
                           : (kFormantMixCap * (dev - kFormantDeadbandBlock) / (1.0f - kFormantDeadbandBlock));
            if (mixTgt > kFormantMixCap) mixTgt = kFormantMixCap;
            if (m_scale > 1.02f) mixTgt = 1.0f;
            m_grainMixTarget = mixTgt;
            m_grainMix += (mixTgt - m_grainMix) * kFormantGlideInvSamples;
            out[i] = y * (1.0f - m_grainMix) + gOut * m_grainMix;

            double adv = (double)m_scale + m_gapBias;
            m_rdA += adv;
            m_rdB += adv;
            if (m_xfadeRemain > 0) m_xfadeRemain--;
            m_effContAccum += adv;
            m_effSamples++;
        }
    }

    static void run(const std::vector<float>& in, std::vector<float>& out,
                    int sr, float scale, float formantDepth = 0.0f) {
        EngineSoladSnac e;
        e.setPitchScale(scale);
        e.setFormantDepth(formantDepth);
        out.assign(in.size(), 0.0f);
        const int CHUNK = 64;
        for (size_t i = 0; i < in.size(); i += CHUNK) {
            size_t left = in.size() - i;
            int n = (int)(left < (size_t)CHUNK ? left : (size_t)CHUNK);
            e.processBlock(&in[i], &out[i], n);
        }
    }

private:
    static const int DL = 32768;
    static const int MASK = DL - 1;
    static const int SINC_TAPS = 16;
    static const int SINC_HALF = SINC_TAPS / 2;
    static const int INITIAL_READ_OFFSET_DEFAULT = 64;
    static const int SNAC_WIN = 1024;
    static const int SNAC_HOP = 2048;
    static const int MIN_PERIOD = 48;
    static const int MAX_PERIOD = 800;
    static const int RESPLICE_GAP = 4096;
    static const int TRANS_REFRACTORY = 14400;
    static constexpr float ENV_SLOW_TC = 1.0f / 4800.0f;
    static constexpr float ENV_FAST_TC = 1.0f / 48.0f;
    static constexpr float FIDELITY_THRESH_DEFAULT = 0.30f;
    static constexpr float kReengageSeedPeriod = 600.0f;
    static constexpr float kFormantGlideInvSamples = 1.0f / 480.0f;
    static constexpr float kFormantDeadbandSetter = 0.35f;
    static constexpr float kFormantDeadbandBlock = 0.04f;
    static constexpr float kFormantMixCap = 0.6f;
    static constexpr float kSpliceCooldownFrac = 0.9f;
    static constexpr float kFirstPeakRatio = 0.90f;

    float    m_dl[DL];
    float    m_formantDepth = 0.0f;
    int      m_initialReadOffset = INITIAL_READ_OFFSET_DEFAULT;
    float    m_xfadeScale = 1.0f;
    float    m_respliceFrac = 1.0f;
    float    m_fidelityThresh = FIDELITY_THRESH_DEFAULT;
    GrainFormant m_grainFormant;
    float  m_grainMix = 0.0f;
    float  m_grainMixTarget = 0.0f;
    bool     m_spliceSnap = true;
    bool     m_spliceMatch = true;
    int      m_driftLowBand = 8;
    int      m_driftHighHead = 256;
    uint32_t m_wr = INITIAL_READ_OFFSET_DEFAULT;
    double   m_rdA = 0.0;
    double   m_rdB = 0.0;
    double   m_gapBias = 0.0;
    bool     m_useA = true;
    int      m_xfadeRemain = 0;
    int      m_xfadeLen = 0;
    float    m_scale = 1.0f;
    float    m_targetScale = 1.0f;
    int      m_period = 256;
    float    m_periodF = 256.0f;
    bool     m_periodValid = false;
    float    m_lastGoodPeriodF = 256.0f;
    bool     m_haveGoodPeriod = false;
    unsigned m_emergencyCount = 0;
    int      m_lockMiss = 0;
    int      m_spliceCooldown = 0;
public:
    unsigned m_spliceCount = 0;
    int      gapNow() const { return (int)((double)m_wr - (m_useA ? m_rdA : m_rdB)); }
    unsigned emergencyCount() const { return m_emergencyCount; }
    float    m_dbgPeakVal = -1.0f;
    int      m_dbgPeakTau = -1;
    float    dbgPeakVal() const { return m_dbgPeakVal; }
    int      dbgPeakTau() const { return m_dbgPeakTau; }
    double   m_effContAccum = 0.0;
    double   m_spliceJumpAccum = 0.0;
    unsigned m_effSamples = 0;
    float effRateNow() {
        float r = (m_effSamples > 0)
                  ? (float)(m_effContAccum / (double)m_effSamples)
                  : 0.0f;
        m_effContAccum = 0.0; m_spliceJumpAccum = 0.0; m_effSamples = 0;
        return r;
    }
    double   m_splicePhaseErrAccum = 0.0;
    unsigned m_splicePhaseN = 0;
    float splicePhaseErrNow() {
        float e = (m_splicePhaseN > 0)
                  ? (float)(m_splicePhaseErrAccum / (double)m_splicePhaseN)
                  : 0.0f;
        m_splicePhaseErrAccum = 0.0; m_splicePhaseN = 0;
        return e;
    }
    float grainMixNow()    const { return m_grainMix; }
    float grainMixTargetNow() const { return m_grainMixTarget; }
    float grainFactorNow() const { return m_grainFormant.factorNow(); }
    float grainTargetFactorNow() const { return m_grainFormant.targetFactorNow(); }
    float formantDepthRawNow() const { return m_formantDepth; }
    void setGrainFactorDirect(float f) { m_grainFormant.setFormantFactor(f); }
    void setGrainMixDirect(float m) { if(m<0)m=0; if(m>1)m=1; m_grainMixTarget = m; }
    float    scaleNow()  const { return m_scale; }
    int      periodNow() const { return m_period; }
    bool     periodOk()  const { return m_periodValid; }
private:
    int      m_sinceDetect = 0;
    int      m_warmup = SNAC_WIN;
    float    m_envSlow = 0.0f;
    float    m_envFast = 0.0f;
    float    m_envFastPrev = 0.0f;
    int      m_transCool = 0;
    int      m_transientHold = 0;
    float    m_snacBuf[SNAC_WIN];
    int      m_snacWr = 0;
    float    m_snacWin[SNAC_WIN];
    float    m_snacPre[SNAC_WIN + 1];
    float    m_snacEnergy = 0.0f;
    int      m_snacMaxTau = 0;
    int      m_snacK = 1;
    int      m_snacPhase = SNAC_IDLE;
    float    m_r[MAX_PERIOD + 1];
    float    m_normK[MAX_PERIOD + 1];

    static constexpr int SINC_PHASES = 256;
    static float sincTable[SINC_PHASES][SINC_TAPS];
    static bool sincTableReady;
    static void initSincTable() {
        if (sincTableReady) return;
        for (int p = 0; p < SINC_PHASES; p++) {
            double frac = (double)p / (double)SINC_PHASES;
            double sum = 0.0;
            double tmp[SINC_TAPS];
            for (int k = 0; k < SINC_TAPS; k++) {
                double x = (double)(k - SINC_HALF + 1) - frac;
                double s = (x < 1e-9 && x > -1e-9) ? 1.0
                         : sin(SOLAD_M_PI * x) / (SOLAD_M_PI * x);
                double w = 0.5 - 0.5 * cos(2.0 * SOLAD_M_PI * ((double)k + frac)
                                           / (double)(SINC_TAPS - 1));
                tmp[k] = s * w;
                sum += tmp[k];
            }
            double inv = (fabs(sum) > 1e-9) ? 1.0 / sum : 1.0;
            for (int k = 0; k < SINC_TAPS; k++)
                sincTable[p][k] = (float)(tmp[k] * inv);
        }
        sincTableReady = true;
    }

    inline float readSinc(double pos) const {
        int base = (int)pos;
        if (pos < 0) base = (int)pos - 1;
        double frac = pos - (double)base;
        int p = (int)(frac * SINC_PHASES);
        if (p < 0) p = 0;
        if (p >= SINC_PHASES) p = SINC_PHASES - 1;
        const float* coef = sincTable[p];
        float v = 0;
        for (int k = 0; k < SINC_TAPS; k++) {
            int idx = base + k - SINC_HALF + 1;
            v += m_dl[(uint32_t)idx & MASK] * coef[k];
        }
        return v;
    }

    void triggerSpliceByPeriod(double per, double drift = 0.0) {
        if (m_xfadeRemain > 0) return;
        m_spliceCount++;
        double &rdActive  = m_useA ? m_rdA : m_rdB;
        double &rdPassive = m_useA ? m_rdB : m_rdA;
        int n = 1;
        if (drift > per) { n = (int)(drift / per + 0.5); if (n < 1) n = 1; if (n > 64) n = 64; }
        double jump = (double)n * per;
        double newPos = rdActive + jump;
        double maxPos = (double)m_wr - (double)m_initialReadOffset;
        while (newPos > maxPos && n > 1) { n--; newPos = rdActive + (double)n * per; }
        if (newPos > maxPos) newPos = maxPos;

        {
            float vA  = readSinc(rdActive);
            float vAn = readSinc(rdActive + (double)m_scale);
            float dA  = vAn - vA;
            int   nBest = (n >= 1) ? n : 1;
            float bestErr = 1e30f;
            for (int nn = n - 3; nn <= n + 3; nn++) {
                if (nn < 1) continue;
                double tp = rdActive + (double)nn * per;
                if (tp < 1.0 || tp > maxPos) continue;
                float vT  = readSinc(tp);
                float vTn = readSinc(tp + (double)m_scale);
                float dT  = vTn - vT;
                float err = fabsf(vT - vA) + fabsf(dT - dA) * 80.0f;
                if (err < bestErr) { bestErr = err; nBest = nn; }
            }
            newPos = rdActive + (double)nBest * per;
            while (newPos > maxPos && nBest > 1) { nBest--; newPos = rdActive + (double)nBest * per; }
            if (newPos > maxPos) newPos = maxPos;
        }
        jump = newPos - rdActive;
        rdPassive = newPos;
        m_spliceJumpAccum += jump;
        {
            double r = jump / per;
            double frac = r - (double)((long)(r + (r >= 0.0 ? 0.5 : -0.5)));
            m_splicePhaseErrAccum += fabs(frac) * per;
            m_splicePhaseN++;
        }
        int len = (int)per;
        if (len < 32) len = 32;
        if (len > 2048) len = 2048;
        m_xfadeLen = len;
        m_xfadeRemain = len;
        m_useA = !m_useA;
    }

    void triggerSplice(bool toLive) {
        if (m_xfadeRemain > 0) return;
        m_spliceCount++;

        double &rdActive  = m_useA ? m_rdA : m_rdB;
        double &rdPassive = m_useA ? m_rdB : m_rdA;

        double newPos;
        if (toLive) {
            newPos = (double)m_wr - 32.0;
        } else {
            newPos = (double)m_wr - (double)m_initialReadOffset;
        }
        if (m_spliceSnap && m_periodValid && m_periodF >= (float)MIN_PERIOD) {
            double diff = newPos - rdActive;
            double pf = (double)m_periodF;
            int periods = (int)(diff / pf + (diff > 0 ? 0.5 : -0.5));
            newPos = rdActive + (double)periods * pf;

            if (m_spliceMatch) {
                float vActive = readSinc(rdActive);
                float vActiveNext = readSinc(rdActive + (double)m_scale);
                float dActive = vActiveNext - vActive;
                double bestDelta = 0.0;
                float  bestErr = 1e9f;
                const int N_TRIAL = 33;
                double maxOff = (double)pf * 0.5;
                for (int t = -N_TRIAL/2; t <= N_TRIAL/2; t++) {
                    double off = (double)t * maxOff / (double)(N_TRIAL/2);
                    double trialPos = newPos + off;
                    if (trialPos < 0.0) continue;
                    if (trialPos > (double)m_wr - 1.0) continue;
                    float vTrial = readSinc(trialPos);
                    float vTrialNext = readSinc(trialPos + (double)m_scale);
                    float dTrial = vTrialNext - vTrial;
                    float err = fabsf(vTrial - vActive) * 1.0f
                              + fabsf(dTrial - dActive) * 100.0f;
                    if (err < bestErr) { bestErr = err; bestDelta = off; }
                }
                newPos += bestDelta;
            }
        }
        rdPassive = newPos;
        int len = m_periodValid
                  ? (int)((float)m_period * 2.0f * m_xfadeScale)
                  : (int)(512.0f * m_xfadeScale);
        if (len < 256)  len = 256;
        if (len > 2048) len = 2048;
        m_xfadeLen = len;
        m_xfadeRemain = len;
        m_useA = !m_useA;
    }

    static const int LAGS_PER_STEP = 48;
    enum { SNAC_IDLE = 0, SNAC_SWEEP = 1 };

    void snacBegin() {
        const int W = SNAC_WIN;
        for (int i = 0; i < W; i++) {
            int idx = (m_snacWr + i) % W;
            m_snacWin[i] = m_snacBuf[idx];
        }
        float acc = 0.0f;
        for (int i = 0; i < W; i++) { m_snacPre[i] = acc; acc += m_snacWin[i] * m_snacWin[i]; }
        m_snacPre[W] = acc;
        float energy = acc;
        m_snacEnergy = energy;
        if (energy < 0.00002f) { m_periodValid = false; m_snacPhase = SNAC_IDLE; return; }
        m_snacMaxTau = MAX_PERIOD; if (m_snacMaxTau > W - 32) m_snacMaxTau = W - 32;
        m_r[0] = energy;
        m_normK[0] = 2.0f * energy;
        m_snacK = 1;
        m_snacPhase = SNAC_SWEEP;
    }

    void detectPitchStep() {
        const int W = SNAC_WIN;
        int kEnd = m_snacK + LAGS_PER_STEP;
        if (kEnd > m_snacMaxTau + 1) kEnd = m_snacMaxTau + 1;
        for (int k = m_snacK; k < kEnd; k++) {
            float sum = 0; int limit = W - k;
            for (int n = 0; n < limit; n++) sum += m_snacWin[n] * m_snacWin[n + k];
            m_r[k] = sum;
            float e1 = m_snacPre[limit];
            float e2 = m_snacPre[W] - m_snacPre[k];
            float nk = e1 + e2; if (nk < 1e-12f) nk = 1e-12f;
            m_normK[k] = nk;
        }
        m_snacK = kEnd;
        if (m_snacK <= m_snacMaxTau) return;

        m_snacPhase = SNAC_IDLE;
        int maxTau = m_snacMaxTau;
        int k = 1;
        while (k < maxTau && (2.0f*m_r[k]/m_normK[k]) > (2.0f*m_r[k-1]/m_normK[k-1])) k++;
        int kScanStart = k;
        float bestVal = -1.0f; int bestTau = -1;
        for (k = kScanStart; k < maxTau - 1; k++) {
            if (k < MIN_PERIOD) continue;
            float v  = 2.0f*m_r[k]/m_normK[k];
            float vm = 2.0f*m_r[k-1]/m_normK[k-1];
            float vp = 2.0f*m_r[k+1]/m_normK[k+1];
            if (v > vm && v > vp && v > m_fidelityThresh) {
                if (v > bestVal) { bestVal = v; bestTau = k; }
            }
        }
        if (bestTau >= 0) {
            float acceptFloor = bestVal * kFirstPeakRatio;
            for (k = kScanStart; k < bestTau; k++) {
                if (k < MIN_PERIOD) continue;
                float v  = 2.0f*m_r[k]/m_normK[k];
                float vm = 2.0f*m_r[k-1]/m_normK[k-1];
                float vp = 2.0f*m_r[k+1]/m_normK[k+1];
                if (v > vm && v > vp && v > m_fidelityThresh && v >= acceptFloor) {
                    bestTau = k;
                    bestVal = v;
                    break;
                }
            }
        }
        { float gmax=-1; int gtau=-1;
          for (int kk=MIN_PERIOD; kk<maxTau-1; kk++){ float vv=2.0f*m_r[kk]/m_normK[kk];
            if (vv>gmax){gmax=vv;gtau=kk;} }
          m_dbgPeakVal = gmax; m_dbgPeakTau = gtau; }
        if (bestTau < 0) {
            if (++m_lockMiss >= 3) m_periodValid = false;
            return;
        }
        m_lockMiss = 0;
        float a = 2.0f*m_r[bestTau-1]/m_normK[bestTau-1];
        float b = 2.0f*m_r[bestTau]  /m_normK[bestTau];
        float c = 2.0f*m_r[bestTau+1]/m_normK[bestTau+1];
        float refined = (float)bestTau;
        float denom = 2.0f*b - a - c;
        if (fabsf(denom) > 1e-9f) refined += (a - c) / denom;
        int np = (int)(refined + 0.5f);
        if (np < MIN_PERIOD) np = MIN_PERIOD;
        if (np > MAX_PERIOD) np = MAX_PERIOD;
        if (refined < (float)MIN_PERIOD) refined = (float)MIN_PERIOD;
        if (refined > (float)MAX_PERIOD) refined = (float)MAX_PERIOD;
        if (m_periodValid) {
            int delta = np - m_period;
            int maxDelta = m_period / 8 + 2;
            if (delta >  maxDelta) { np = m_period + maxDelta; refined = (float)np; }
            if (delta < -maxDelta) { np = m_period - maxDelta; refined = (float)np; }
        }
        m_period = np;
        m_periodF = refined;
        m_periodValid = true;
    }
};

inline float EngineSoladSnac::sincTable[EngineSoladSnac::SINC_PHASES][EngineSoladSnac::SINC_TAPS] = {};
inline bool  EngineSoladSnac::sincTableReady = false;
