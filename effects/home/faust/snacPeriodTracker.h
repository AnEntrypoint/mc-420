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
        if (m_sinceBlock == 0) stepSchedule(BLOCK);
        if (++m_sinceBlock >= BLOCK) m_sinceBlock = 0;
    }

    bool  periodValid() const { return m_periodValid; }
    int   period()      const { return m_period; }
    float periodF()     const { return m_periodF; }

    int   m_period = 256;
    float m_periodF = 256.0f;
    bool  m_periodValid = false;
    int   m_lockMiss = 0;
    float m_fidelityThresh = FIDELITY_THRESH_DEFAULT;
    float m_dbgPeakVal = -1.0f;
    int   m_dbgPeakTau = -1;

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
