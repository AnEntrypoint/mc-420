#ifndef GRAIN_FORMANT_H
#define GRAIN_FORMANT_H
#include <math.h>
#include <string.h>

class GrainFormant {
public:
    static const int RBUF = 16384;
    static const int VOICES = 6;
    static constexpr double kRespliceDeadbandPeriods = 5.0;
    static constexpr float kFormantGlideInvSamples = 1.0f / 480.0f;

    void reset() {
        memset(m_ring, 0, sizeof(m_ring));
        m_wr = 0; m_Tin = 256.0; m_scale = 0.5f;
        m_fm = 1.0f; m_targetFm = 1.0f;
        m_inEpoch = 0.0; m_sinceEmit = 1e9; m_seeded = false;
        for (int v = 0; v < VOICES; v++) m_v[v].active = false;
        m_nextV = 0;
    }
    GrainFormant() { reset(); }

    void setScale(float s)        { if (s > 0.05f && s < 4.0f) m_scale = s; }
    void setInputPeriod(double p) { if (p >= 32.0 && p <= 2048.0) m_Tin = p; }
    void setFormantFactor(float f){ if (f<0.5f) f=0.5f; if (f>2.0f) f=2.0f; m_targetFm = f; }

    float factorNow() const { return m_fm; }
    float targetFactorNow() const { return m_targetFm; }
    double periodNow() const { return m_Tin; }
    float scaleNow() const { return m_scale; }
    inline void write(float dry) { m_ring[m_wr & (RBUF - 1)] = dry; m_wr++; }
    inline float process(float dry) { write(dry); return read(); }

    inline void advanceFactor() {
        m_fm += (m_targetFm - m_fm) * kFormantGlideInvSamples;
    }

    void suspend() {
        advanceFactor();
        m_seeded = false;
        for (int v = 0; v < VOICES; v++) m_v[v].active = false;
    }

    inline float read() {
        advanceFactor();
        double Tin   = m_Tin;
        double outHop = Tin / (double)m_scale;
        double glenD  = (m_scale > 1.0f) ? (2.0 * outHop) : (2.0 * Tin);
        int    glen   = (int)glenD;
        double targetLag = Tin * (3.0 + (double)m_fm);

        if (!m_seeded) {
            m_inEpoch = (double)m_wr - targetLag;
            m_seeded = true; m_sinceEmit = outHop;
        }

        if (m_sinceEmit >= outHop) {
            m_sinceEmit -= outHop;
            double lag = (double)m_wr - m_inEpoch;
            double deadband = Tin * kRespliceDeadbandPeriods;
            if (lag > targetLag + deadband || lag < targetLag - deadband) {
                double want = (double)m_wr - targetLag;
                double diff = want - m_inEpoch;
                double nper = floor(diff / Tin + 0.5);
                m_inEpoch += nper * Tin;
            }
            Voice& nv = m_v[m_nextV];
            nv.active = true; nv.k = 0; nv.len = glen; nv.center = m_inEpoch;
            m_nextV = (m_nextV + 1) % VOICES;
            m_inEpoch += Tin;
        }
        m_sinceEmit += 1.0;

        float acc = 0.0f;
        for (int vi = 0; vi < VOICES; vi++) {
            Voice& v = m_v[vi];
            if (!v.active) continue;
            float ph = (float)v.k / (float)v.len;
            float win = hannWindow(ph);
            double src = v.center + (double)(v.k - v.len / 2) * (double)m_fm;
            acc += win * readRing(src);
            v.k++;
            if (v.k >= v.len) v.active = false;
        }
        return acc;
    }

private:
    static const int WIN_LUT = 2048;
    static const float* hannLut() {
        static float lut[WIN_LUT + 1];
        static bool ready = false;
        if (!ready) {
            for (int i = 0; i <= WIN_LUT; i++)
                lut[i] = 0.5f - 0.5f * cosf(2.0f * 3.14159265f * (float)i / (float)WIN_LUT);
            ready = true;
        }
        return lut;
    }
    static inline float hannWindow(float ph) {
        if (ph <= 0.0f) return 0.0f;
        if (ph >= 1.0f) return 0.0f;
        float fi = ph * (float)WIN_LUT;
        int i = (int)fi;
        float fr = fi - (float)i;
        const float* l = hannLut();
        return l[i] * (1.0f - fr) + l[i + 1] * fr;
    }
    struct Voice { bool active; int k; int len; double center; };
    float  m_ring[RBUF];
    unsigned m_wr;
    double m_Tin, m_inEpoch, m_sinceEmit;
    float  m_scale, m_fm, m_targetFm;
    bool   m_seeded;
    Voice  m_v[VOICES];
    int    m_nextV;

    inline float readRing(double pos) const {
        double maxPos = (double)m_wr - 1.0;
        double minPos = (double)m_wr - (double)(RBUF - 2);
        if (pos > maxPos) pos = maxPos;
        if (pos < minPos) pos = minPos;
        int i = (int)pos; if (pos < 0) i = (int)pos - 1;
        double fr = pos - (double)i;
        float a = m_ring[(unsigned)i & (RBUF - 1)];
        float b = m_ring[(unsigned)(i + 1) & (RBUF - 1)];
        return a * (float)(1.0 - fr) + b * (float)fr;
    }
};
#endif
