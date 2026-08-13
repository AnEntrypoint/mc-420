#ifndef ALOOP_SAMPLER_H
#define ALOOP_SAMPLER_H

#include <stdint.h>
#include <string.h>
#include <math.h>

namespace aloop {

class Sampler {
public:
    static const int SR             = 48000;
    static const int CHROM_MAX      = 5 * SR;
    static const int DRUM_MAX       = 2 * SR;
    static const int NUM_DRUM       = 25;
    static const int BASE_NOTE      = 48;
    static const int ROOT_NOTE      = 60;
    static const int VOICES         = 16;
    static const int EVENT_RING     = 64;
    static const int TRIM_THRESH    = 200;
    static const int EDGE_FADE      = 64;
    static const int PREROLL        = 32;
    static const int LEAD_DECLICK   = 8;
    static const int MAX_GRAINS     = 48;

    enum EvType { EV_NONE = 0, EV_NOTE_ON, EV_NOTE_OFF,
                  EV_REC_START, EV_REC_STOP };

    Sampler()
    {
        m_chromM = new short[CHROM_MAX];
        memset(m_chromM, 0, sizeof(short) * CHROM_MAX);
        m_chromLen = 0;
        m_chromLoaded = false;

        for (int k = 0; k < NUM_DRUM; k++) {
            m_drumM[k] = new short[DRUM_MAX];
            memset(m_drumM[k], 0, sizeof(short) * DRUM_MAX);
            m_drumLen[k] = 0;
            m_drumLoaded[k] = false;
        }

        for (int v = 0; v < VOICES; v++) m_voice[v].active = false;
        m_ageCtr = 0;

        m_recActive = false;
        m_recTarget = -2;
        m_recPos    = 0;

        m_evHead = 0;
        m_evTail = 0;

        m_ampAttackMs     = 2.0f;
        m_ampDecayMs      = 50.0f;
        m_ampSustainLevel = 1.0f;
        m_ampReleaseMs    = 1000.0f / 48.0f;
        m_filterAttackMs     = 2.0f;
        m_filterDecayMs      = 50.0f;
        m_filterSustainLevel = 1.0f;
        m_filterReleaseMs    = 1000.0f / 48.0f;
        _recomputeFilterEngaged();

        m_granOn         = false;
        m_grainMs        = 60.0f;
        m_grainRateHz    = 20.0f;
        m_pitchSprayCents= 0.0f;
        m_posJitterMs    = 0.0f;
        m_scanRate       = 1.0f;
        m_reverseProb    = 0.0f;
        m_envShape       = 0.0f;
        _recomputeGrainGainComp();
        for (int g = 0; g < MAX_GRAINS; g++) m_grains[g].active = false;
        for (int v = 0; v < VOICES; v++) m_voice[v].grainAccum = 0.0;
    }

    ~Sampler()
    {
        delete[] m_chromM;
        for (int k = 0; k < NUM_DRUM; k++) { delete[] m_drumM[k]; }
    }

    void pushEvent(EvType type, int note, int vel)
    {
        unsigned head = m_evHead;
        unsigned next = (head + 1) % EVENT_RING;
        if (next == m_evTail) return;
        m_ev[head].type = (uint8_t)type;
        m_ev[head].note = (int16_t)note;
        m_ev[head].vel  = (int16_t)vel;
        m_evHead = next;
    }

    bool chromaticLoaded() const { return m_chromLoaded; }
    bool drumLoaded(int keyIdx) const
    {
        return (keyIdx >= 0 && keyIdx < NUM_DRUM) ? m_drumLoaded[keyIdx] : false;
    }
    static int keyIndex(int note)
    {
        return (note >= BASE_NOTE && note < BASE_NOTE + NUM_DRUM) ? (note - BASE_NOTE) : -1;
    }

    void setAmpAttackMs(float ms)  { m_ampAttackMs  = _clampMs(ms); }
    void setAmpDecayMs(float ms)   { m_ampDecayMs   = _clampMs(ms); }
    void setAmpSustain(float v01)  { m_ampSustainLevel = _clamp01(v01); }
    void setAmpReleaseMs(float ms) { m_ampReleaseMs = _clampMs(ms); }

    void setFilterAttackMs(float ms)  { m_filterAttackMs  = _clampMs(ms); _recomputeFilterEngaged(); }
    void setFilterDecayMs(float ms)   { m_filterDecayMs   = _clampMs(ms); _recomputeFilterEngaged(); }
    void setFilterSustain(float v01)  { m_filterSustainLevel = _clamp01(v01); _recomputeFilterEngaged(); }
    void setFilterReleaseMs(float ms) { m_filterReleaseMs = _clampMs(ms); _recomputeFilterEngaged(); }

    void setGranulatorEnabled(bool on) { m_granOn = on; }
    bool granulatorEnabled() const     { return m_granOn; }

    void setGrainPatch(float grainMs, float grainRateHz, float pitchSprayCents,
                        float posJitterMs, float scanRate, float reverseProb,
                        float envShape)
    {
        if (grainMs < 5.0f) grainMs = 5.0f;
        if (grainMs > 500.0f) grainMs = 500.0f;
        if (grainRateHz < 0.5f) grainRateHz = 0.5f;
        if (grainRateHz > 200.0f) grainRateHz = 200.0f;
        if (pitchSprayCents < 0.0f) pitchSprayCents = 0.0f;
        if (pitchSprayCents > 1200.0f) pitchSprayCents = 1200.0f;
        if (posJitterMs < 0.0f) posJitterMs = 0.0f;
        if (posJitterMs > 1000.0f) posJitterMs = 1000.0f;
        if (scanRate < 0.0f) scanRate = 0.0f;
        if (scanRate > 8.0f) scanRate = 8.0f;
        if (reverseProb < 0.0f) reverseProb = 0.0f;
        if (reverseProb > 1.0f) reverseProb = 1.0f;
        if (envShape < 0.0f) envShape = 0.0f;
        if (envShape > 1.0f) envShape = 1.0f;

        m_grainMs = grainMs;
        m_grainRateHz = grainRateHz;
        m_pitchSprayCents = pitchSprayCents;
        m_posJitterMs = posJitterMs;
        m_scanRate = scanRate;
        m_reverseProb = reverseProb;
        m_envShape = envShape;
        _recomputeGrainGainComp();
    }

    void captureBlock(const int *in, int n)
    {
        if (!m_recActive) return;
        short *dm; int maxLen; int *lenp;
        if (!_recBuffers(dm, maxLen, lenp)) return;
        for (int i = 0; i < n; i++) {
            if (m_recPos >= maxLen) { m_recActive = false; break; }
            dm[m_recPos] = _clip16(in[i]);
            m_recPos++;
        }
        *lenp = m_recPos;
    }

    void renderInto(int *inout, int n)
    {
        _drainEvents();

        for (int v = 0; v < VOICES; v++) {
            Voice &vo = m_voice[v];
            if (!vo.active) continue;

            if (vo.granular) {
                _renderGranularVoice(v, inout, n);
                continue;
            }

            if (vo.isChrom) {
                for (int i = 0; i < n; i++) {
                    if (vo.pos >= (double)(vo.len - 1) && vo.ampPhase != kAdsrRelease && vo.ampPhase != kAdsrIdle) {
                        vo.ampPhase = kAdsrRelease;
                        vo.filterPhase = kAdsrRelease;
                    }

                    float sm = _readInterp(vo.M, vo.len, vo.pos);

                    _advanceEnv(vo.ampPhase, vo.ampLevel, vo.ampAttackStep, vo.ampDecayStep, vo.ampSustainLevel, vo.ampReleaseStep);
                    if (m_filterEngaged) {
                        _advanceEnv(vo.filterPhase, vo.filterLevel, vo.filterAttackStep, vo.filterDecayStep, vo.filterSustainLevel, vo.filterReleaseStep);
                        float alpha = _filterAlpha(_filterCutoffHz(vo.filterLevel));
                        vo.lpState += alpha * (sm - vo.lpState);
                        sm = vo.lpState;
                    }

                    inout[i] += (int)(sm * vo.ampLevel * vo.velGain);

                    vo.pos += vo.rate;
                    if (vo.ampPhase == kAdsrIdle) { vo.active = false; break; }
                }
                continue;
            }

            for (int i = 0; i < n; i++) {
                if (vo.pos >= (double)(vo.len - 1)) { vo.target = 0.0f; }

                float sm = _readInterp(vo.M, vo.len, vo.pos);

                if (vo.gain < vo.target)      { vo.gain += vo.attackStep;  if (vo.gain > vo.target) vo.gain = vo.target; }
                else if (vo.gain > vo.target) { vo.gain -= vo.releaseStep; if (vo.gain < vo.target) vo.gain = vo.target; }

                inout[i] += (int)(sm * vo.gain);

                vo.pos += vo.rate;
                if (vo.gain <= 0.0f && vo.target == 0.0f) { vo.active = false; break; }
            }
        }
    }

    bool recording() const   { return m_recActive; }
    int  recLen() const      { return m_recPos; }
    int  drumLoadedCount() const
    {
        int c = 0; for (int k = 0; k < NUM_DRUM; k++) if (m_drumLoaded[k]) c++;
        return c;
    }
    int  activeVoices() const
    {
        int c = 0; for (int v = 0; v < VOICES; v++) if (m_voice[v].active) c++;
        return c;
    }

private:
    static constexpr float GAIN_STEP = 1.0f / 48.0f;

    enum AdsrPhase : uint8_t { kAdsrAttack, kAdsrDecay, kAdsrSustain, kAdsrRelease, kAdsrIdle };

    static float _clampMs(float ms)  { return ms < 0.0f ? 0.0f : (ms > 2000.0f ? 2000.0f : ms); }
    static float _clamp01(float v)   { return v < 0.0f ? 0.0f : (v > 1.0f ? 1.0f : v); }

    static void _advanceEnv(uint8_t &phase, float &level, float attackStep, float decayStep, float sustainLevel, float releaseStep)
    {
        switch (phase) {
            case kAdsrAttack:
                level += attackStep;
                if (level >= 1.0f) { level = 1.0f; phase = kAdsrDecay; }
                break;
            case kAdsrDecay:
                if (level > sustainLevel) {
                    level -= decayStep;
                    if (level <= sustainLevel) { level = sustainLevel; phase = kAdsrSustain; }
                } else {
                    phase = kAdsrSustain;
                }
                break;
            case kAdsrSustain:
                level = sustainLevel;
                break;
            case kAdsrRelease:
                level -= releaseStep;
                if (level <= 0.0f) { level = 0.0f; phase = kAdsrIdle; }
                break;
            default:
                break;
        }
    }

    static float _msToStep(float ms)
    {
        float samples = (ms * 0.001f) * (float)SR;
        return samples > 0.0f ? (1.0f / samples) : 1.0f;
    }

    static constexpr float kFilterCutoffMinHz = 80.0f;
    static constexpr float kFilterCutoffMaxHz = 18000.0f;
    static float _filterCutoffHz(float envLevel)
    {
        return kFilterCutoffMinHz * powf(kFilterCutoffMaxHz / kFilterCutoffMinHz, envLevel);
    }
    static float _filterAlpha(float cutoffHz)
    {
        float a = 1.0f - expf(-2.0f * 3.14159265f * cutoffHz / (float)SR);
        return a < 0.0f ? 0.0f : (a > 1.0f ? 1.0f : a);
    }

    struct Voice {
        bool   active;
        const short *M;
        int    len;
        double pos;
        double rate;
        bool   sustain;
        int    note;
        float  gain;
        float  target;
        float  attackStep;
        float  releaseStep;
        unsigned age;
        bool   isChrom;
        bool   granular;
        double grainAccum;
        float  velGain;

        uint8_t ampPhase;
        float   ampLevel;
        float   ampAttackStep;
        float   ampDecayStep;
        float   ampSustainLevel;
        float   ampReleaseStep;

        uint8_t filterPhase;
        float   filterLevel;
        float   filterAttackStep;
        float   filterDecayStep;
        float   filterSustainLevel;
        float   filterReleaseStep;
        float   lpState;
    };

    struct Grain {
        bool   active;
        int    voiceSlot;
        const short *M;
        int    len;
        double pos;
        double rate;
        int    lifeSamples;
        int    lifePos;
        float  envShape;
    };

    static short _clip16(int v)
    {
        return v > 32767 ? 32767 : (v < -32768 ? -32768 : (short)v);
    }

    static float _readInterp(const short *buf, int len, double pos)
    {
        if (len <= 0) return 0.0f;
        if (pos < 0.0) pos = 0.0;
        int i0 = (int)pos;
        if (i0 >= len) return 0.0f;
        int i1 = (i0 + 1 < len) ? i0 + 1 : i0;
        float frac = (float)(pos - (double)i0);
        if (frac < 0.0f) frac = 0.0f;
        return (float)buf[i0] * (1.0f - frac) + (float)buf[i1] * frac;
    }

    float _randBipolar()
    {
        m_grainRngState ^= m_grainRngState << 13;
        m_grainRngState ^= m_grainRngState >> 17;
        m_grainRngState ^= m_grainRngState << 5;
        uint32_t bits = m_grainRngState;
        float u = (float)(bits >> 8) * (1.0f / 16777216.0f);
        return u * 2.0f - 1.0f;
    }

    float _randTriangular()
    {
        return 0.5f * (_randBipolar() + _randBipolar());
    }

    static float _blackmanWindow(float phase)
    {
        const float pi = 3.14159265f;
        return 0.42f - 0.5f * cosf(2.0f * pi * phase) + 0.08f * cosf(4.0f * pi * phase);
    }

    static float _grainWindow(float phase, float envShape)
    {
        if (phase < 0.0f) phase = 0.0f;
        if (phase > 1.0f) phase = 1.0f;
        if (envShape < 0.5f) {
            float x = envShape * 2.0f;
            float blackmanWin = _blackmanWindow(phase);
            if (x <= 0.0f) return blackmanWin;
            float hannWin = 0.5f * (1.0f - cosf(2.0f * 3.14159265f * phase));
            return blackmanWin + (hannWin - blackmanWin) * x;
        }
        float x = (envShape - 0.5f) * 2.0f;
        float hannWin = 0.5f * (1.0f - cosf(2.0f * 3.14159265f * phase));
        if (x <= 0.0f) return hannWin;
        float percAttack = 0.12f;
        float percWin;
        if (phase < percAttack) {
            percWin = phase / percAttack;
        } else {
            float t = (phase - percAttack) / (1.0f - percAttack);
            percWin = (1.0f - t) * (1.0f - t);
        }
        return hannWin + (percWin - hannWin) * x;
    }

    static float _grainWindowRmsLevel(float envShape)
    {
        const int kSteps = 65;
        float sumSq = 0.0f;
        for (int i = 0; i < kSteps; i++) {
            float phase = (float)i / (float)(kSteps - 1);
            float w = _grainWindow(phase, envShape);
            sumSq += w * w;
        }
        return sqrtf(sumSq / (float)kSteps);
    }

    static int _clipGrainLifeToBuffer(double pos, double rate, int len, int nominalLifeSamples)
    {
        int maxLifeSamples = nominalLifeSamples;
        if (rate > 1e-6) {
            double samplesToEnd = ((double)(len - 1) - pos) / rate;
            if (samplesToEnd < (double)maxLifeSamples) maxLifeSamples = (int)samplesToEnd;
        } else if (rate < -1e-6) {
            double samplesToStart = pos / (-rate);
            if (samplesToStart < (double)maxLifeSamples) maxLifeSamples = (int)samplesToStart;
        }
        return maxLifeSamples < 2 ? 2 : maxLifeSamples;
    }

    int _stealMostFinishedGrainSlot() const
    {
        int best = 0;
        float bestFrac = -1.0f;
        for (int g = 0; g < MAX_GRAINS; g++) {
            float frac = (float)m_grains[g].lifePos / (float)(m_grains[g].lifeSamples > 0 ? m_grains[g].lifeSamples : 1);
            if (frac > bestFrac) { bestFrac = frac; best = g; }
        }
        return best;
    }

    void _killGrainsOwnedByVoice(int vSlot)
    {
        for (int g = 0; g < MAX_GRAINS; g++)
            if (m_grains[g].active && m_grains[g].voiceSlot == vSlot) m_grains[g].active = false;
    }

    void _releaseVoicesUsingBuffer(const short *buf)
    {
        for (int v = 0; v < VOICES; v++) {
            if (m_voice[v].active && m_voice[v].M == buf) {
                m_voice[v].active = false;
                _killGrainsOwnedByVoice(v);
            }
        }
    }

    void _spawnGrain(int vSlot, double scanPos)
    {
        Voice &vo = m_voice[vSlot];
        int slot = -1;
        for (int g = 0; g < MAX_GRAINS; g++) { if (!m_grains[g].active) { slot = g; break; } }
        if (slot < 0) slot = _stealMostFinishedGrainSlot();

        Grain &gr = m_grains[slot];
        gr.active = true;
        gr.voiceSlot = vSlot;
        gr.M = vo.M;
        gr.len = vo.len;

        double jitterSamples = 0.0;
        if (m_posJitterMs > 0.0f) {
            jitterSamples = (double)(_randTriangular() * m_posJitterMs * 0.001f * (float)SR);
        }
        double p = scanPos + jitterSamples;
        if (p < 0.0) p = 0.0;
        if (p > (double)(vo.len - 1)) p = (double)(vo.len - 1);
        gr.pos = p;

        float pitchSprayCentsOffset = (m_pitchSprayCents > 0.0f) ? (_randTriangular() * m_pitchSprayCents) : 0.0f;
        gr.rate = vo.rate * pow(2.0, (double)pitchSprayCentsOffset / 1200.0);

        bool grainReversed = (m_reverseProb > 0.0f) && ((_randBipolar() * 0.5f + 0.5f) < m_reverseProb);
        if (grainReversed) gr.rate = -gr.rate;

        int nominalLifeSamples = (int)((m_grainMs * 0.001f) * (float)SR);
        if (nominalLifeSamples < 2) nominalLifeSamples = 2;
        gr.lifeSamples = _clipGrainLifeToBuffer(gr.pos, gr.rate, vo.len, nominalLifeSamples);
        gr.lifePos = 0;
        gr.envShape = m_envShape;
    }

    void _renderGranularVoice(int vSlot, int *inout, int n)
    {
        Voice &vo = m_voice[vSlot];
        bool chrom = vo.isChrom;

        float densityFromVel = 0.4f + 0.6f * vo.velGain;
        double spawnPeriod = (double)SR / ((double)m_grainRateHz * (double)densityFromVel);

        for (int i = 0; i < n; i++) {
            float envLevel;
            bool  sounding;
            if (chrom) {
                _advanceEnv(vo.ampPhase, vo.ampLevel, vo.ampAttackStep, vo.ampDecayStep, vo.ampSustainLevel, vo.ampReleaseStep);
                if (m_filterEngaged) _advanceEnv(vo.filterPhase, vo.filterLevel, vo.filterAttackStep, vo.filterDecayStep, vo.filterSustainLevel, vo.filterReleaseStep);
                envLevel = vo.ampLevel;
                sounding = (vo.ampPhase != kAdsrRelease && vo.ampPhase != kAdsrIdle);
            } else {
                if (vo.gain < vo.target)      { vo.gain += vo.attackStep;  if (vo.gain > vo.target) vo.gain = vo.target; }
                else if (vo.gain > vo.target) { vo.gain -= vo.releaseStep; if (vo.gain < vo.target) vo.gain = vo.target; }
                envLevel = vo.gain;
                sounding = (vo.target > 0.0f);
            }

            if (sounding) {
                vo.grainAccum += 1.0;
                if (vo.grainAccum >= spawnPeriod) {
                    vo.grainAccum -= spawnPeriod;
                    _spawnGrain(vSlot, vo.pos);
                }
                vo.pos += vo.rate * (double)m_scanRate;
                if (vo.pos >= (double)(vo.len - 1)) vo.pos = 0.0;
            }

            float mixed = 0.0f;
            for (int g = 0; g < MAX_GRAINS; g++) {
                Grain &gr = m_grains[g];
                if (!gr.active || gr.voiceSlot != vSlot) continue;

                float sm = _readInterp(gr.M, gr.len, gr.pos);

                float phase = (float)gr.lifePos / (float)gr.lifeSamples;
                float win = _grainWindow(phase, gr.envShape);

                mixed += sm * win;

                gr.pos += gr.rate;
                gr.lifePos++;
                if (gr.lifePos >= gr.lifeSamples || gr.pos < 0.0 || gr.pos >= (double)(gr.len - 1)) gr.active = false;
            }

            if (chrom && m_filterEngaged) {
                float alpha = _filterAlpha(_filterCutoffHz(vo.filterLevel));
                vo.lpState += alpha * (mixed - vo.lpState);
                mixed = vo.lpState;
            }

            float finalGain = chrom ? (envLevel * vo.velGain) : envLevel;
            inout[i] += (int)(mixed * finalGain * m_grainGainComp);

            bool done = chrom ? (vo.ampPhase == kAdsrIdle) : (vo.gain <= 0.0f && vo.target == 0.0f);
            if (done) {
                _killGrainsOwnedByVoice(vSlot);
                vo.active = false;
                break;
            }
        }
    }

    bool _recBuffers(short *&dm, int &maxLen, int *&lenp)
    {
        if (m_recTarget == -1) { dm = m_chromM; maxLen = CHROM_MAX; lenp = &m_chromLen; return true; }
        if (m_recTarget >= 0 && m_recTarget < NUM_DRUM) {
            dm = m_drumM[m_recTarget];
            maxLen = DRUM_MAX; lenp = &m_drumLen[m_recTarget]; return true;
        }
        return false;
    }

    void _startRecord(int target)
    {
        if (target >= 0 && target < NUM_DRUM) {
            _releaseVoicesUsingBuffer(m_drumM[target]);
            m_drumLoaded[target] = false;
            m_drumLen[target] = 0;
        } else if (target == -1) {
            _releaseVoicesUsingBuffer(m_chromM);
            m_chromLoaded = false;
            m_chromLen = 0;
        }
        m_recActive = true;
        m_recTarget = target;
        m_recPos    = 0;
    }

    void _stopRecord()
    {
        if (m_recTarget == -2) return;
        m_recActive = false;
        short *dm; int maxLen; int *lenp;
        if (!_recBuffers(dm, maxLen, lenp)) { m_recTarget = -2; return; }
        int len = *lenp;
        int trimmed = _autoTrim(dm, len);
        *lenp = trimmed;
        if (m_recTarget == -1) m_chromLoaded = (trimmed > 0);
        else if (m_recTarget >= 0 && m_recTarget < NUM_DRUM) m_drumLoaded[m_recTarget] = (trimmed > 0);
        m_recTarget = -2;
    }

    static int _autoTrim(short *M, int len)
    {
        if (len <= 0) return 0;
        int start = -1, end = -1;
        for (int i = 0; i < len; i++) {
            int a = M[i]; if (a < 0) a = -a;
            if (a > TRIM_THRESH) { if (start < 0) start = i; end = i; }
        }
        if (start < 0 || end < start) return 0;
        if (start > PREROLL) start -= PREROLL; else start = 0;
        int newLen = end - start + 1;
        if (start > 0) {
            memmove(M, M + start, sizeof(short) * newLen);
        }
        int fin = newLen < LEAD_DECLICK ? newLen : LEAD_DECLICK;
        for (int i = 0; i < fin; i++) {
            float g = (float)i / (float)fin;
            M[i] = (short)(M[i] * g);
        }
        int fout = newLen < EDGE_FADE ? newLen : EDGE_FADE;
        for (int i = 0; i < fout; i++) {
            float g = (float)i / (float)fout;
            int j = newLen - 1 - i;
            M[j] = (short)(M[j] * g);
        }
        return newLen;
    }

    int _spawnVoice(const short *M, int len, double rate, bool sustain, int note, bool isChrom, float velGain)
    {
        if (len <= 0) return -1;
        int slot = -1; unsigned oldest = 0xFFFFFFFF;
        for (int v = 0; v < VOICES; v++) {
            if (!m_voice[v].active) { slot = v; break; }
            if (m_voice[v].age < oldest) { oldest = m_voice[v].age; slot = v; }
        }
        Voice &vo = m_voice[slot];
        vo.active = true; vo.M = M; vo.len = len;
        vo.pos = 0.0; vo.rate = rate; vo.sustain = sustain; vo.note = note;
        vo.gain = 0.0f; vo.target = velGain; vo.age = ++m_ageCtr;
        vo.isChrom = isChrom;
        vo.granular = false;
        vo.grainAccum = 0.0;
        vo.velGain = velGain;
        _killGrainsOwnedByVoice(slot);

        double playable = (rate > 0.0) ? ((double)len / rate) : (double)len;
        float fastStep = (playable > 4.0) ? (float)(1.0 / (playable * 0.25)) : 0.25f;
        float legacyAttackStep = fastStep > GAIN_STEP ? fastStep : GAIN_STEP;
        vo.attackStep  = legacyAttackStep;
        vo.releaseStep = GAIN_STEP;

        if (isChrom) {
            vo.ampPhase = kAdsrAttack;
            vo.ampLevel = 0.0f;
            vo.ampAttackStep   = _msToStep(m_ampAttackMs);
            vo.ampDecayStep    = _msToStep(m_ampDecayMs);
            vo.ampSustainLevel = m_ampSustainLevel;
            vo.ampReleaseStep  = _msToStep(m_ampReleaseMs);

            vo.filterPhase = kAdsrAttack;
            vo.filterLevel = 0.0f;
            vo.filterAttackStep   = _msToStep(m_filterAttackMs);
            vo.filterDecayStep    = _msToStep(m_filterDecayMs);
            vo.filterSustainLevel = m_filterSustainLevel;
            vo.filterReleaseStep  = _msToStep(m_filterReleaseMs);
            vo.lpState = 0.0f;
        }
        return slot;
    }

    static void _releaseChromVoice(Voice &vo)
    {
        if (vo.ampPhase != kAdsrIdle) vo.ampPhase = kAdsrRelease;
        if (vo.filterPhase != kAdsrIdle) vo.filterPhase = kAdsrRelease;
    }

    void _noteOn(int note, int vel)
    {
        float velGain = (float)(vel < 1 ? 1 : (vel > 127 ? 127 : vel)) / 127.0f;
        int k = keyIndex(note);
        if (k >= 0 && m_drumLoaded[k]) {
            int slot = _spawnVoice(m_drumM[k], m_drumLen[k], 1.0, false, -1, false, velGain);
            if (slot >= 0 && m_granOn) m_voice[slot].granular = true;
            return;
        }
        if (m_chromLoaded) {
            for (int v = 0; v < VOICES; v++)
                if (m_voice[v].active && m_voice[v].sustain && m_voice[v].note == note)
                    _releaseChromVoice(m_voice[v]);
            double rate = pow(2.0, (double)(note - ROOT_NOTE) / 12.0);
            int slot = _spawnVoice(m_chromM, m_chromLen, rate, true, note, true, velGain);
            if (slot >= 0 && m_granOn) m_voice[slot].granular = true;
        }
    }

    void _noteOff(int note)
    {
        for (int v = 0; v < VOICES; v++)
            if (m_voice[v].active && m_voice[v].sustain && m_voice[v].note == note)
                _releaseChromVoice(m_voice[v]);
    }

    void _drainEvents()
    {
        while (m_evTail != m_evHead) {
            uint8_t type = m_ev[m_evTail].type;
            int     note = m_ev[m_evTail].note;
            int     vel  = m_ev[m_evTail].vel;
            m_evTail = (m_evTail + 1) % EVENT_RING;
            switch (type) {
                case EV_NOTE_ON:   _noteOn(note, vel);  break;
                case EV_NOTE_OFF:  _noteOff(note);      break;
                case EV_REC_START: _startRecord(note);  break;
                case EV_REC_STOP:  _stopRecord();       break;
                default: break;
            }
        }
    }

    short *m_chromM;
    int    m_chromLen;
    volatile bool m_chromLoaded;

    short *m_drumM[NUM_DRUM];
    int    m_drumLen[NUM_DRUM];
    volatile bool m_drumLoaded[NUM_DRUM];

    Voice    m_voice[VOICES];
    unsigned m_ageCtr;

    volatile bool m_recActive;
    int  m_recTarget;
    int  m_recPos;

    struct Ev { uint8_t type; int16_t note; int16_t vel; };
    volatile Ev m_ev[EVENT_RING];
    volatile unsigned m_evHead, m_evTail;

    float m_ampAttackMs;
    float m_ampDecayMs;
    float m_ampSustainLevel;
    float m_ampReleaseMs;
    float m_filterAttackMs;
    float m_filterDecayMs;
    float m_filterSustainLevel;
    float m_filterReleaseMs;
    bool  m_filterEngaged = true;

    void _recomputeFilterEngaged()
    {
        m_filterEngaged = (m_filterSustainLevel < 0.999f) || (m_filterAttackMs > 5.0f) || (m_filterDecayMs > 5.0f) || (m_filterReleaseMs > 5.0f);
    }

    static constexpr float kGrainGainCompReferenceWindowRms = 0.612372f;

    void _recomputeGrainGainComp()
    {
        float overlap = (m_grainMs * 0.001f) * m_grainRateHz;
        if (overlap < 1.0f) overlap = 1.0f;
        float windowRms = _grainWindowRmsLevel(m_envShape);
        if (windowRms < 0.05f) windowRms = 0.05f;
        float effectiveOverlap = overlap * (windowRms / kGrainGainCompReferenceWindowRms);
        if (effectiveOverlap < 1.0f) effectiveOverlap = 1.0f;
        m_grainGainComp = 1.0f / sqrtf(effectiveOverlap);
    }

    Grain    m_grains[MAX_GRAINS];
    bool     m_granOn;
    float    m_grainMs;
    float    m_grainRateHz;
    float    m_pitchSprayCents;
    float    m_posJitterMs;
    float    m_scanRate;
    float    m_reverseProb = 0.0f;
    float    m_envShape = 0.0f;
    float    m_grainGainComp = 1.0f;
    uint32_t m_grainRngState = 2463534242u;
};

}
#endif
