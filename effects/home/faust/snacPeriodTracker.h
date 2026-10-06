#pragma once

#include <math.h>

class SnacPeriodTracker {
public:
    static const int SNAC_WIN = 1024;
    static const int SNAC_HOP = 2048;
    static const int MIN_PERIOD = 48;
    static const int MAX_PERIOD = 800;
    static const int LAGS_PER_STEP = 48;
    static const int BLOCK = 64;
    static constexpr float FIDELITY_THRESH_DEFAULT = 0.30f;
    static constexpr float kFirstPeakRatio = 0.90f;
    static constexpr float kEnvFloorFrac = 0.05f;
    static constexpr float kDiffAccept = 0.15f;
    static constexpr float kDiffStrict = 0.05f;
    static constexpr float kDiffFallback = 0.50f;
    static constexpr float kDiffReject = 0.35f;
    static constexpr float kContGate = 0.50f;
    static const int CONT_MIN_WIN = 256;
    static const int CONT_MAX_WIN = SNAC_WIN;
    static const int CONT_WIN_PAD = 128;

    SnacPeriodTracker() { reset(); }

    void reset() {
        for (int i = 0; i < SNAC_WIN; i++) m_snacBuf[i] = 0.0f;
        m_snacWr = 0;
        m_snacPhase = SNAC_IDLE;
        m_snacK = 1;
        m_snacEnergy = 0.0f;
        m_snacMaxTau = 0;
        m_sinceDetect = 0;
        m_sinceBlock = 0;
        m_period = 256;
        m_periodF = 256.0f;
        m_periodValid = false;
        m_lockMiss = 0;
        m_confidence = 0.0f;
        m_continuity = 0.0f;
        m_detectCount = 0;
    }

    void setFidelityThresh(float f) {
        if (f < 0.30f) f = 0.30f;
        if (f > 0.95f) f = 0.95f;
        m_fidelityThresh = f;
    }

    void write(float x) {
        m_snacBuf[m_snacWr] = x;
        m_snacWr = (m_snacWr + 1) % SNAC_WIN;
    }

    void stepSchedule(int blockLen) {
        if (m_snacPhase == SNAC_IDLE) {
            if ((m_sinceDetect += blockLen) >= SNAC_HOP) { m_sinceDetect = 0; snacBegin(); }
        } else {
            detectPitchStep();
        }
    }

    void tick(float x) {
        write(x);
        if (m_sinceBlock == 0) { stepSchedule(BLOCK); updateContinuity(); }
        if (++m_sinceBlock >= BLOCK) m_sinceBlock = 0;
    }

    bool  periodValid() const { return m_periodValid; }
    int   period()      const { return m_period; }
    float periodF()     const { return m_periodF; }
    float continuity()  const { return m_continuity; }
    float rawConfidence() const { return m_confidence; }
    float confidence()  const { return m_continuity >= kContGate ? m_confidence : 0.0f; }

    int   m_period = 256;
    float m_periodF = 256.0f;
    bool  m_periodValid = false;
    int   m_lockMiss = 0;
    float m_fidelityThresh = FIDELITY_THRESH_DEFAULT;
    float m_dbgPeakVal = -1.0f;
    int   m_dbgPeakTau = -1;
    float m_confidence = 0.0f;
    float m_continuity = 0.0f;
    int   m_detectCount = 0;

private:
    enum { SNAC_IDLE = 0, SNAC_SWEEP = 1 };
    float m_snacBuf[SNAC_WIN];
    float m_snacWin[SNAC_WIN];
    float m_snacPre[SNAC_WIN + 1];
    int   m_snacWr = 0;
    float m_snacEnergy = 0.0f;
    int   m_snacMaxTau = 0;
    int   m_snacK = 1;
    int   m_snacPhase = SNAC_IDLE;
    int   m_sinceDetect = 0;
    int   m_sinceBlock = 0;
    float m_r[MAX_PERIOD + 1];
    float m_rr[MAX_PERIOD + 1];
    float m_normK[MAX_PERIOD + 1];

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
        if (energy < 0.00002f) {
            m_periodValid = false;
            m_confidence = 0.0f;
            m_snacPhase = SNAC_IDLE;
            return;
        }
        flattenEnvelope();
        acc = 0.0f;
        for (int i = 0; i < W; i++) { m_snacPre[i] = acc; acc += m_snacWin[i] * m_snacWin[i]; }
        m_snacPre[W] = acc;
        m_snacMaxTau = MAX_PERIOD; if (m_snacMaxTau > W - 32) m_snacMaxTau = W - 32;
        m_r[0] = acc;
        m_normK[0] = 2.0f * acc;
        m_snacK = 1;
        m_snacPhase = SNAC_SWEEP;
    }

    void updateContinuity() {
        const int W = SNAC_WIN;
        if (!m_periodValid || m_periodF <= 0.0f) { m_continuity = 0.0f; return; }
        int lag = (int)(m_periodF + 0.5f);
        if (lag < MIN_PERIOD) lag = MIN_PERIOD;
        int win = 2 * lag + CONT_WIN_PAD;
        if (win < CONT_MIN_WIN) win = CONT_MIN_WIN;
        if (win > CONT_MAX_WIN) win = CONT_MAX_WIN;
        if (lag >= win) { m_continuity = 0.0f; return; }
        int len = win - lag;
        int span = lag / 32;
        if (span < 4) span = 4;
        if (span > 16) span = 16;
        int lo = lag - span;
        if (lo < 8) lo = 8;
        int hi = lag + span;
        if (hi >= win) hi = win - 1;
        if (lo > hi) { m_continuity = 0.0f; return; }
        float best = -2.0f;
        for (int L = lo; L <= hi; L++) {
            float num = 0.0f;
            float e1 = 0.0f;
            float e2 = 0.0f;
            for (int n = 0; n < len; n++) {
                int base = m_snacWr - win + n + 2 * W;
                float a = m_snacBuf[base % W];
                float b = m_snacBuf[(base + L) % W];
                num += a * b;
                e1 += a * a;
                e2 += b * b;
            }
            float den = e1 + e2;
            if (den < 1e-9f) continue;
            float r = 2.0f * num / den;
            if (r > best) best = r;
        }
        m_continuity = best;
    }

    void flattenEnvelope() {
        const int W = SNAC_WIN;
        int half = m_period / 4;
        if (half < 32) half = 32;
        if (half > 256) half = 256;
        m_snacPre[0] = 0.0f;
        for (int i = 0; i < W; i++) m_snacPre[i + 1] = m_snacPre[i] + fabsf(m_snacWin[i]);
        float floorA = kEnvFloorFrac * m_snacPre[W] / (float)W;
        if (floorA < 1e-12f) return;
        for (int n = 0; n < W; n++) {
            int lo = n - half;
            if (lo < 0) lo = 0;
            int hi = n + half;
            if (hi > W - 1) hi = W - 1;
            float e = (m_snacPre[hi + 1] - m_snacPre[lo]) / (float)(hi - lo + 1);
            if (e < floorA) e = floorA;
            m_snacWin[n] = m_snacWin[n] / e;
        }
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
        m_detectCount++;
        int maxTau = m_snacMaxTau;
        for (int k = 0; k <= maxTau; k++) m_rr[k] = 2.0f * m_r[k] / m_normK[k];
        { float gmax = -1.0f; int gtau = -1;
          for (int kk = MIN_PERIOD; kk < maxTau - 1; kk++) {
              if (m_rr[kk] > gmax) { gmax = m_rr[kk]; gtau = kk; }
          }
          m_dbgPeakVal = gmax; m_dbgPeakTau = gtau; }
        for (int k = 0; k <= maxTau; k++) m_r[k] = m_normK[k] - 2.0f * m_r[k];
        double cum = 0.0;
        for (int k = 1; k <= maxTau; k++) {
            cum += (double)m_r[k];
            double mean = cum / (double)k;
            m_normK[k] = (float)((mean > 1e-12) ? mean : 1e-12);
        }
        for (int k = 1; k <= maxTau; k++) m_r[k] = m_r[k] / m_normK[k];
        float rPeak = 0.0f;
        for (int k = MIN_PERIOD; k < maxTau - 1; k++) {
            if (m_r[k] < m_r[k - 1] && m_r[k] < m_r[k + 1] && m_r[k] < kDiffAccept && m_rr[k] > rPeak)
                rPeak = m_rr[k];
        }
        float rFloor = rPeak * kFirstPeakRatio;
        int bestTau = -1;
        float bestVal = 1e9f;
        for (int k = MIN_PERIOD; k < maxTau - 1; k++) {
            if (m_r[k] < m_r[k - 1] && m_r[k] < m_r[k + 1] && m_r[k] < kDiffAccept && m_rr[k] >= rFloor) {
                bestTau = k;
                bestVal = m_r[k];
                break;
            }
        }
        bool fromDiff = bestTau >= 0;
        float q = bestVal;
        float qThresh = 1.0f - m_fidelityThresh;
        if (qThresh > kDiffReject) qThresh = kDiffReject;
        if (!fromDiff) {
            float gmin = 1e9f;
            int gtau = -1;
            for (int k = MIN_PERIOD; k < maxTau - 1; k++) {
                if (m_r[k] < gmin) { gmin = m_r[k]; gtau = k; }
            }
            if (gtau >= 0 && gmin < kDiffStrict) {
                bestTau = gtau;
                q = gmin;
                fromDiff = true;
            } else {
                float peakBest = -1.0f;
                for (int k = MIN_PERIOD; k < maxTau - 1; k++) {
                    if (m_rr[k] > m_rr[k - 1] && m_rr[k] > m_rr[k + 1] && m_rr[k] > m_fidelityThresh && m_rr[k] > peakBest) {
                        peakBest = m_rr[k];
                        bestTau = k;
                    }
                }
                if (bestTau >= 0) {
                    float peakFloor = peakBest * kFirstPeakRatio;
                    for (int k = MIN_PERIOD; k < bestTau; k++) {
                        if (m_rr[k] > m_rr[k - 1] && m_rr[k] > m_rr[k + 1] && m_rr[k] > m_fidelityThresh && m_rr[k] >= peakFloor) {
                            peakBest = m_rr[k];
                            bestTau = k;
                            break;
                        }
                    }
                }
                if (bestTau >= 0 && m_r[bestTau] > kDiffFallback) bestTau = -1;
                q = 1.0f - peakBest;
                qThresh = 1.0f - m_fidelityThresh;
            }
        }
        if (bestTau < 0 || q > qThresh) {
            m_confidence = 0.0f;
            if (++m_lockMiss >= 3) m_periodValid = false;
            return;
        }
        m_lockMiss = 0;
        m_confidence = 1.0f - q;
        if (m_confidence < 0.0f) m_confidence = 0.0f;
        const float* ref = fromDiff ? m_r : m_rr;
        float a = ref[bestTau - 1];
        float b = ref[bestTau];
        float c = ref[bestTau + 1];
        float refined = (float)bestTau;
        float denom = 2.0f * b - a - c;
        if (fabsf(denom) > 1e-9f) {
            float delta = (c - a) / (2.0f * denom);
            if (!fromDiff) delta = -delta;
            if (delta > 1.0f) delta = 1.0f;
            if (delta < -1.0f) delta = -1.0f;
            refined += delta;
        }
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
