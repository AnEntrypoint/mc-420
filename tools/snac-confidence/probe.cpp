#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <vector>

#include "../../effects/home/faust/snacPeriodTracker.h"

static const int SR = 48000;
static const int DETECT_LAG = 1088;
static const int WIN = SnacPeriodTracker::SNAC_WIN;

static uint32_t g_rng = 0x12345678u;

static float white() {
    g_rng ^= g_rng << 13;
    g_rng ^= g_rng >> 17;
    g_rng ^= g_rng << 5;
    return (float)((int32_t)g_rng) * (1.0f / 2147483648.0f);
}

enum Kind { K_SINE = 0, K_HARM, K_NOISY, K_NOISE, K_GATED, K_PLOSIVE, K_VIBRATO };

struct Case {
    const char* label;
    Kind kind;
    float f0;
    int nh;
    float snrDb;
    float durS;
    int gateSmps;
    float duty;
};

static void gen(const Case& c, std::vector<float>& x, std::vector<uint8_t>& voiced) {
    g_rng = 0x12345678u;
    int n = (int)(c.durS * (float)SR);
    x.assign(n, 0.0f);
    voiced.assign(n, 0);
    const float sigRms = 0.1f;
    const float noiseRms = sigRms / powf(10.0f, c.snrDb / 20.0f);
    const int burstSmps = (int)(0.02f * SR);
    const int toneSmps = (int)(0.30f * SR);
    double phase = 0.0;
    double vibPhase = 0.0;
    std::vector<double> harmPhase(32, 0.0);
    for (int i = 0; i < n; i++) {
        float f = c.f0;
        if (c.kind == K_VIBRATO) {
            vibPhase += 2.0 * 3.14159265358979323846 * 5.0 / (double)SR;
            f = c.f0 * powf(2.0f, (50.0f / 1200.0f) * sinf((float)vibPhase));
        }
        bool on = true;
        bool isVoiced = true;
        bool isNoise = false;
        if (c.kind == K_GATED) {
            on = (i % c.gateSmps) < (int)(c.duty * (float)c.gateSmps);
            isVoiced = on;
        } else if (c.kind == K_PLOSIVE) {
            int cyc = burstSmps + toneSmps;
            int p = i % cyc;
            isNoise = p < burstSmps;
            isVoiced = !isNoise;
        } else if (c.kind == K_NOISE) {
            isNoise = true;
            isVoiced = false;
        }
        float s = 0.0f;
        if (c.kind == K_SINE) {
            phase += 2.0 * 3.14159265358979323846 * (double)f / (double)SR;
            s = sin(phase);
            float gain = sigRms * 1.41421356f;
            float nz = c.snrDb < 90.0f ? white() * noiseRms * 1.7320508f : 0.0f;
            s = s * gain + nz;
        } else if (c.kind == K_HARM || c.kind == K_GATED || c.kind == K_PLOSIVE ||
                   c.kind == K_VIBRATO) {
            float acc = 0.0f;
            int nh = c.nh;
            if (nh < 1) nh = 1;
            if (nh > 32) nh = 32;
            float norm = 0.0f;
            for (int k = 1; k <= nh; k++) norm += 1.0f / (float)k;
            for (int k = 1; k <= nh; k++) {
                harmPhase[k] += 2.0 * 3.14159265358979323846 * (double)f * (double)k / (double)SR;
                if (harmPhase[k] > 2.0 * 3.14159265358979323846)
                    harmPhase[k] -= 2.0 * 3.14159265358979323846;
                acc += sin(harmPhase[k]) / (float)k;
            }
            s = acc / norm * sigRms * 1.41421356f;
            if (!on) s = 0.0f;
        } else if (c.kind == K_NOISY || c.kind == K_NOISE) {
            float tone = 0.0f;
            if (c.kind == K_NOISY) {
                phase += 2.0 * 3.14159265358979323846 * (double)f / (double)SR;
                tone = sin(phase) * sigRms * 1.41421356f;
            }
            s = tone + white() * noiseRms * 1.7320508f;
        }
        if (isNoise && c.kind == K_PLOSIVE) s = white() * sigRms * 1.7320508f;
        x[i] = s;
        voiced[i] = isVoiced ? 1 : 0;
    }
}

struct Row {
    const char* label;
    int det;
    int sample;
    float conf;
    int valid;
    float periodF;
    float truePeriod;
    float errCents;
    float voicedFrac;
    float rms;
    float peakVal;
    int peakTau;
    float contMin;
    float contMean;
};

static bool readWav(const char* path, std::vector<float>& x, int& sr) {
    FILE* f = fopen(path, "rb");
    if (!f) return false;
    unsigned char hdr[12];
    if (fread(hdr, 1, 12, f) != 12) { fclose(f); return false; }
    if (memcmp(hdr, "RIFF", 4) != 0 || memcmp(hdr + 8, "WAVE", 4) != 0) { fclose(f); return false; }
    int channels = 1;
    int bits = 16;
    int fmtTag = 1;
    sr = 48000;
    std::vector<float> raw;
    while (true) {
        unsigned char ch[8];
        if (fread(ch, 1, 8, f) != 8) break;
        uint32_t sz = (uint32_t)ch[4] | ((uint32_t)ch[5] << 8) | ((uint32_t)ch[6] << 16) |
                      ((uint32_t)ch[7] << 24);
        if (memcmp(ch, "fmt ", 4) == 0) {
            std::vector<unsigned char> b(sz);
            if (fread(b.data(), 1, sz, f) != sz) break;
            if (sz >= 16) {
                fmtTag = (int)(b[0] | ((int)b[1] << 8));
                channels = (int)(b[2] | ((int)b[3] << 8));
                sr = (int)(b[4] | ((int)b[5] << 8) | ((int)b[6] << 16) | ((int)b[7] << 24));
                bits = (int)(b[14] | ((int)b[15] << 8));
            }
        } else if (memcmp(ch, "data", 4) == 0) {
            std::vector<unsigned char> b(sz);
            if (fread(b.data(), 1, sz, f) != sz) break;
            size_t frames = 0;
            if (bits == 16 && fmtTag == 1) {
                frames = sz / 2;
                raw.resize(frames);
                for (size_t i = 0; i < frames; i++) {
                    int16_t v = (int16_t)((uint16_t)b[2 * i] | ((uint16_t)b[2 * i + 1] << 8));
                    raw[i] = (float)v / 32768.0f;
                }
            } else if (bits == 32 && fmtTag == 3) {
                frames = sz / 4;
                raw.resize(frames);
                memcpy(raw.data(), b.data(), frames * 4);
            } else if (bits == 32 && fmtTag == 1) {
                frames = sz / 4;
                raw.resize(frames);
                for (size_t i = 0; i < frames; i++) {
                    int32_t v = (int32_t)((uint32_t)b[4 * i] | ((uint32_t)b[4 * i + 1] << 8) |
                                          ((uint32_t)b[4 * i + 2] << 16) | ((uint32_t)b[4 * i + 3] << 24));
                    raw[i] = (float)v / 2147483648.0f;
                }
            }
            if (channels > 1) {
                size_t nf = raw.size() / (size_t)channels;
                x.resize(nf);
                for (size_t i = 0; i < nf; i++) {
                    float acc = 0.0f;
                    for (int c = 0; c < channels; c++) acc += raw[i * (size_t)channels + (size_t)c];
                    x[i] = acc / (float)channels;
                }
            } else {
                x = raw;
            }
            fclose(f);
            return true;
        } else {
            if (sz & 1) sz++;
            fseek(f, (long)sz, SEEK_CUR);
        }
    }
    fclose(f);
    return false;
}

int main(int argc, char** argv) {
    if (argc >= 2) {
        std::vector<float> x;
        int sr = 48000;
        if (!readWav(argv[1], x, sr)) {
            fprintf(stderr, "cannot read %s\n", argv[1]);
            return 1;
        }
        float f0 = argc >= 3 ? (float)atof(argv[2]) : 0.0f;
        double gacc = 0.0;
        for (size_t i = 0; i < x.size(); i++) gacc += (double)x[i] * (double)x[i];
        float gRms = x.size() ? (float)sqrt(gacc / (double)x.size()) : 0.0f;
        SnacPeriodTracker tr;
        int lastCount = 0;
        int detIdx = 0;
        float contMin = 1e9f;
        double contSum = 0.0;
        int contN = 0;
        if (argc >= 4 && strcmp(argv[3], "blocks") == 0) {
            printf("label,sample,cont,conf,effConf,valid,periodF,audible\n");
            for (int i = 0; i < (int)x.size(); i++) {
                tr.tick(x[i]);
                if (i % 64 != 63) continue;
                int w0 = i - 255;
                if (w0 < 0) w0 = 0;
                double acc = 0.0;
                int cnt = 0;
                for (int k = w0; k <= i; k++) { acc += (double)x[k] * (double)x[k]; cnt++; }
                float rms = cnt > 0 ? (float)sqrt(acc / (double)cnt) : 0.0f;
                float audible = rms > 0.15f * gRms ? 1.0f : 0.0f;
                printf("%s,%d,%.5f,%.5f,%.5f,%d,%.3f,%.1f\n", argv[1], i, tr.continuity(),
                       tr.rawConfidence(), tr.confidence(), tr.m_periodValid ? 1 : 0, tr.m_periodF,
                       audible);
            }
            return 0;
        }
        printf("label,det,sample,conf,valid,periodF,truePeriod,errCents,voicedFrac,rms,peakVal,"
               "peakTau,contMin,contMean\n");
        for (int i = 0; i < (int)x.size(); i++) {
            tr.tick(x[i]);
            float cv = tr.continuity();
            if (cv < contMin) contMin = cv;
            contSum += cv; contN++;
            if (tr.m_detectCount != lastCount) {
                lastCount = tr.m_detectCount;
                detIdx++;
                if (detIdx <= 2) continue;
                int w0 = i - DETECT_LAG - WIN;
                int w1 = i - DETECT_LAG;
                if (w0 < 0) w0 = 0;
                if (w1 > (int)x.size()) w1 = (int)x.size();
                double acc = 0.0;
                int cnt = 0;
                for (int k = w0; k < w1; k++) { acc += (double)x[k] * (double)x[k]; cnt++; }
                float rms = cnt > 0 ? (float)sqrt(acc / (double)cnt) : 0.0f;
                float audible = rms > 0.15f * gRms ? 1.0f : 0.0f;
                float tp = (f0 > 0.0f && audible > 0.5f) ? (float)sr / f0 : 0.0f;
                float err = tp > 0.0f ? 1200.0f * log2f(tr.m_periodF / tp) : -9999.0f;
                printf("%s,%d,%d,%.5f,%d,%.3f,%.3f,%.2f,%.3f,%.6f,%.5f,%d,%.5f,%.5f\n", argv[1],
                       detIdx, i, tr.m_confidence, tr.m_periodValid ? 1 : 0, tr.m_periodF, tp, err,
                       audible, rms, tr.m_dbgPeakVal, tr.m_dbgPeakTau, contMin,
                       contN ? (float)(contSum / contN) : 0.0f);
                contMin = 1e9f; contSum = 0.0; contN = 0;
            }
        }
        return 0;
    }

    std::vector<Case> cases;
    const float dur = 6.0f;

    static const float f0s[] = {82.41f, 110.0f, 146.83f, 220.0f, 293.66f, 440.0f, 587.33f,
                                880.0f, 1046.5f, 1318.5f, 1568.0f, 2093.0f};
    for (int i = 0; i < (int)(sizeof(f0s) / sizeof(f0s[0])); i++) {
        Case c = {"sine", K_SINE, f0s[i], 1, 90.0f, dur, 0, 0.0f};
        cases.push_back(c);
    }
    for (int i = 0; i < (int)(sizeof(f0s) / sizeof(f0s[0])); i++) {
        Case c = {"harm", K_HARM, f0s[i], 8, 90.0f, dur, 0, 0.0f};
        cases.push_back(c);
    }
    static const float snrs[] = {-24.0f, -18.0f, -12.0f, -6.0f, 0.0f, 6.0f, 12.0f, 20.0f};
    for (int i = 0; i < 8; i++) {
        Case c = {"noisySine", K_SINE, 220.0f, 1, snrs[i], dur, 0, 0.0f};
        cases.push_back(c);
    }
    for (int i = 0; i < 8; i++) {
        Case c = {"noisyHarm", K_HARM, 220.0f, 8, snrs[i], dur, 0, 0.0f};
        cases.push_back(c);
    }
    for (int i = 0; i < 8; i++) {
        Case c = {"noisyHarm", K_HARM, 110.0f, 8, snrs[i], dur, 0, 0.0f};
        cases.push_back(c);
    }
    cases.push_back(Case{"noise", K_NOISE, 0.0f, 1, 0.0f, dur, 0, 0.0f});
    cases.push_back(Case{"gated", K_GATED, 220.0f, 8, 90.0f, dur, SR / 4, 0.5f});
    cases.push_back(Case{"gated", K_GATED, 146.83f, 8, 90.0f, dur, SR / 8, 0.5f});
    cases.push_back(Case{"plosive", K_PLOSIVE, 220.0f, 8, 90.0f, dur, 0, 0.0f});
    cases.push_back(Case{"plosive", K_PLOSIVE, 110.0f, 8, 90.0f, dur, 0, 0.0f});
    cases.push_back(Case{"vibrato", K_VIBRATO, 220.0f, 8, 90.0f, dur, 0, 0.0f});

    std::vector<Row> rows;

    for (size_t ci = 0; ci < cases.size(); ci++) {
        const Case& c = cases[ci];
        std::vector<float> x;
        std::vector<uint8_t> voiced;
        gen(c, x, voiced);

        SnacPeriodTracker tr;
        int lastCount = 0;
        int detIdx = 0;
        float contMin = 1e9f;
        double contSum = 0.0;
        int contN = 0;
        for (int i = 0; i < (int)x.size(); i++) {
            tr.tick(x[i]);
            float cv = tr.continuity();
            if (cv < contMin) contMin = cv;
            contSum += cv; contN++;
            if (tr.m_detectCount != lastCount) {
                lastCount = tr.m_detectCount;
                detIdx++;
                if (detIdx <= 2) continue;
                Row r;
                r.label = c.label;
                r.det = detIdx;
                r.sample = i;
                r.conf = tr.m_confidence;
                r.valid = tr.m_periodValid ? 1 : 0;
                r.periodF = tr.m_periodF;
                r.peakVal = tr.m_dbgPeakVal;
                r.peakTau = tr.m_dbgPeakTau;
                r.contMin = contMin;
                r.contMean = contN ? (float)(contSum / (double)contN) : 0.0f;
                contMin = 1e9f; contSum = 0.0; contN = 0;
                int w0 = i - DETECT_LAG - WIN;
                int w1 = i - DETECT_LAG;
                if (w0 < 0) w0 = 0;
                if (w1 > (int)x.size()) w1 = (int)x.size();
                int vc = 0;
                double acc = 0.0;
                int cnt = 0;
                for (int k = w0; k < w1; k++) {
                    vc += voiced[k];
                    acc += (double)x[k] * (double)x[k];
                    cnt++;
                }
                r.voicedFrac = cnt > 0 ? (float)vc / (float)cnt : 0.0f;
                r.rms = cnt > 0 ? (float)sqrt(acc / (double)cnt) : 0.0f;
                r.truePeriod = c.f0 > 0.0f ? (float)SR / c.f0 : 0.0f;
                if (c.kind == K_NOISE || r.voicedFrac < 0.9f) {
                    r.errCents = -9999.0f;
                    r.truePeriod = 0.0f;
                } else {
                    r.errCents = 1200.0f * log2f(r.periodF / r.truePeriod);
                }
                rows.push_back(r);
            }
        }
    }

    printf("label,det,sample,conf,valid,periodF,truePeriod,errCents,voicedFrac,rms,peakVal,peakTau,"
           "contMin,contMean\n");
    for (size_t i = 0; i < rows.size(); i++) {
        const Row& r = rows[i];
        printf("%s,%d,%d,%.5f,%d,%.3f,%.3f,%.2f,%.3f,%.6f,%.5f,%d,%.5f,%.5f\n", r.label, r.det,
               r.sample, r.conf, r.valid, r.periodF, r.truePeriod, r.errCents, r.voicedFrac, r.rms,
               r.peakVal, r.peakTau, r.contMin, r.contMean);
    }
    return 0;
}
