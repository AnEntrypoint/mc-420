#define _USE_MATH_DEFINES
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cstdint>
#include <cctype>
#include <cmath>
#include <string>
#include <map>
#include <vector>
#include <memory>
#include <algorithm>

#define FAUSTFLOAT float
struct FaustMeta { void declare(const char*, const char*) {} };
struct FaustUI {
    std::map<std::string, float*> zones;
    std::vector<std::string> path;
    std::string full(const char* label) const {
        std::string p;
        for (auto& g : path) if (!g.empty()) { p += g; p += "/"; }
        p += label;
        return p;
    }
    void openTabBox(const char* l) { path.push_back(l ? l : ""); }
    void openHorizontalBox(const char* l) { path.push_back(l ? l : ""); }
    void openVerticalBox(const char* l) { path.push_back(l ? l : ""); }
    void closeBox() { if (!path.empty()) path.pop_back(); }
    void addButton(const char* l, float* z) { zones[full(l)] = z; }
    void addCheckButton(const char* l, float* z) { zones[full(l)] = z; }
    void addVerticalSlider(const char* l, float* z, float, float, float, float) { zones[full(l)] = z; }
    void addHorizontalSlider(const char* l, float* z, float, float, float, float) { zones[full(l)] = z; }
    void addNumEntry(const char* l, float* z, float, float, float, float) { zones[full(l)] = z; }
    void addHorizontalBargraph(const char* l, float* z, float, float) { zones[full(l)] = z; }
    void addVerticalBargraph(const char* l, float* z, float, float) { zones[full(l)] = z; }
    void addSoundfile(const char*, const char*, void**) {}
    void declare(float*, const char*, const char*) {}
    void set(const char* name, float v) {
        auto it = zones.find(name);
        if (it != zones.end()) { *it->second = v; return; }
        std::string suf(name);
        for (auto& kv : zones) {
            const std::string& k = kv.first;
            if (k.size() >= suf.size() && k.compare(k.size() - suf.size(), suf.size(), suf) == 0) { *kv.second = v; return; }
        }
        fprintf(stderr, "warning: no zone matches '%s' -- ignored (see --list-zones)\n", name);
    }
    float get(const char* name, float def = 0.0f) const {
        auto it = zones.find(name);
        if (it != zones.end()) return *it->second;
        std::string suf(name);
        for (auto& kv : zones) {
            const std::string& k = kv.first;
            if (k.size() >= suf.size() && k.compare(k.size() - suf.size(), suf.size(), suf) == 0) return *kv.second;
        }
        return def;
    }
    void listZones() const { for (auto& kv : zones) fprintf(stderr, "  %s\n", kv.first.c_str()); }
};
#define Meta FaustMeta
#define UI FaustUI
#define dsp FaustDspBase
struct FaustDspBase { virtual ~FaustDspBase() {} };
#include "dsp_generated.cpp"
#include "soladSnacOctaver.h"
#undef dsp

#pragma pack(push, 1)
struct WavHeader {
    char riff[4] = {'R','I','F','F'}; uint32_t chunkSize;
    char wave[4] = {'W','A','V','E'};
    char fmt[4] = {'f','m','t',' '}; uint32_t fmtSize = 16;
    uint16_t audioFormat = 1; uint16_t numChannels = 1;
    uint32_t sampleRate; uint32_t byteRate;
    uint16_t blockAlign; uint16_t bitsPerSample = 16;
    char data[4] = {'d','a','t','a'}; uint32_t dataSize;
};
#pragma pack(pop)

static bool readWavMono(const char* path, std::vector<float>& out, uint32_t& sr) {
    FILE* f = fopen(path, "rb");
    if (!f) { fprintf(stderr, "error: cannot open %s\n", path); return false; }
    char riff[4], wave[4];
    uint32_t riffSize;
    if (fread(riff, 1, 4, f) != 4 || fread(&riffSize, 4, 1, f) != 1 || fread(wave, 1, 4, f) != 4
        || memcmp(riff, "RIFF", 4) != 0 || memcmp(wave, "WAVE", 4) != 0) {
        fprintf(stderr, "error: %s is not a RIFF/WAVE file\n", path);
        fclose(f); return false;
    }
    uint16_t audioFormat = 0, numChannels = 0, bitsPerSample = 0;
    uint32_t sampleRate = 0;
    long dataPos = -1;
    uint32_t dataSize = 0;
    const long byteRatePlusBlockAlignBytes = 6;
    char id[4]; uint32_t csize;
    while (fread(id, 1, 4, f) == 4 && fread(&csize, 4, 1, f) == 1) {
        long chunkStart = ftell(f);
        if (memcmp(id, "fmt ", 4) == 0) {
            fread(&audioFormat, 2, 1, f);
            fread(&numChannels, 2, 1, f);
            fread(&sampleRate, 4, 1, f);
            fseek(f, byteRatePlusBlockAlignBytes, SEEK_CUR);
            fread(&bitsPerSample, 2, 1, f);
        } else if (memcmp(id, "data", 4) == 0) {
            dataPos = chunkStart;
            dataSize = csize;
        }
        fseek(f, chunkStart + (long)csize + (long)(csize & 1), SEEK_SET);
    }
    if (dataPos < 0 || bitsPerSample == 0 || numChannels == 0) {
        fprintf(stderr, "error: %s has no usable fmt/data chunks\n", path);
        fclose(f); return false;
    }
    if (audioFormat != 1 && audioFormat != 3) {
        fprintf(stderr, "error: %s uses WAV format tag %u (only PCM=1/IEEE float=3 supported)\n", path, audioFormat);
        fclose(f); return false;
    }
    sr = sampleRate;
    int ch = numChannels;
    int bytesPerSample = bitsPerSample / 8;
    size_t nSamples = dataSize / bytesPerSample / ch;
    out.assign(nSamples, 0.0f);
    fseek(f, dataPos, SEEK_SET);
    std::vector<uint8_t> raw(dataSize);
    fread(raw.data(), 1, raw.size(), f);
    fclose(f);
    for (size_t i = 0; i < nSamples; i++) {
        double acc = 0.0;
        for (int c = 0; c < ch; c++) {
            const uint8_t* p = &raw[(i * ch + c) * bytesPerSample];
            double v;
            if (audioFormat == 3 && bitsPerSample == 32) {
                float fv; memcpy(&fv, p, 4); v = fv;
            } else if (bitsPerSample == 16) {
                int16_t sv; memcpy(&sv, p, 2); v = sv / 32768.0;
            } else if (bitsPerSample == 24) {
                int32_t sv = (int32_t)(p[0] | (p[1] << 8) | (p[2] << 16));
                if (sv & 0x800000) sv |= (int32_t)0xFF000000;
                v = sv / 8388608.0;
            } else if (bitsPerSample == 32) {
                int32_t sv; memcpy(&sv, p, 4); v = sv / 2147483648.0;
            } else if (bitsPerSample == 8) {
                v = (p[0] - 128) / 128.0;
            } else {
                v = 0.0;
            }
            acc += v;
        }
        out[i] = (float)(acc / ch);
    }
    return true;
}

static void writeWavMono(const char* path, const std::vector<float>& in, uint32_t sr) {
    WavHeader h;
    h.sampleRate = sr;
    h.byteRate = sr * 1 * 2;
    h.blockAlign = 2;
    h.dataSize = (uint32_t)(in.size() * 2);
    h.chunkSize = 36 + h.dataSize;
    FILE* f = fopen(path, "wb");
    fwrite(&h, sizeof(h), 1, f);
    for (float v : in) {
        float c = v < -1.0f ? -1.0f : (v > 1.0f ? 1.0f : v);
        int16_t s = (int16_t)(c * 32767.0f);
        fwrite(&s, sizeof(s), 1, f);
    }
    fclose(f);
}

static void genSine(std::vector<float>& out, double freq, double seconds, double sr) {
    size_t n = (size_t)(seconds * sr);
    out.resize(n);
    double phase = 0.0;
    for (size_t i = 0; i < n; i++) { out[i] = 0.5f * (float)sin(phase); phase += 2.0*M_PI*freq/sr; }
}
static void genSweep(std::vector<float>& out, double f0, double f1, double seconds, double sr) {
    size_t n = (size_t)(seconds * sr);
    out.resize(n);
    double phase = 0.0;
    for (size_t i = 0; i < n; i++) {
        double frac = (double)i / (double)n;
        double freq = f0 + frac * (f1 - f0);
        out[i] = 0.5f * (float)sin(phase);
        phase += 2.0*M_PI*freq/sr;
    }
}
static void genImpulse(std::vector<float>& out, double seconds, double sr) {
    size_t n = (size_t)(seconds * sr);
    out.assign(n, 0.0f);
    if (n > 0) out[0] = 1.0f;
}
static void genNoise(std::vector<float>& out, double seconds, double sr) {
    size_t n = (size_t)(seconds * sr);
    out.resize(n);
    unsigned seed = 12345;
    for (size_t i = 0; i < n; i++) {
        seed = seed * 1103515245 + 12345;
        out[i] = (((int)(seed >> 16) & 0x7fff) / 16384.0f - 1.0f) * 0.5f;
    }
}
static void genSilence(std::vector<float>& out, double seconds, double sr) {
    size_t n = (size_t)(seconds * sr);
    out.assign(n, 0.0f);
}
static void genStep(std::vector<float>& out, double lowVal, double highVal, double atSeconds, double seconds, double sr) {
    size_t n = (size_t)(seconds * sr);
    size_t atN = (size_t)(atSeconds * sr);
    out.resize(n);
    for (size_t i = 0; i < n; i++) out[i] = (float)(i < atN ? lowVal : highVal);
}

static bool parseGenSpec(const std::string& spec, std::vector<float>& out, double sr) {
    size_t p1 = spec.find(':');
    std::string kind = spec.substr(0, p1);
    if (kind == "wav") {
        std::string path = spec.substr(p1 + 1);
        uint32_t wavSr = 0;
        if (!readWavMono(path.c_str(), out, wavSr)) return false;
        if (wavSr != 0 && (double)wavSr != sr) {
            fprintf(stderr, "warning: %s is %uHz, harness runs at %.0fHz -- no resampling, pitch/timing will read wrong\n",
                    path.c_str(), wavSr, sr);
        }
    } else if (kind == "sine") {
        size_t p2 = spec.find(':', p1+1);
        double freq = atof(spec.substr(p1+1, p2-p1-1).c_str());
        double secs = atof(spec.substr(p2+1).c_str());
        genSine(out, freq, secs, sr);
    } else if (kind == "sweep") {
        size_t p2 = spec.find(':', p1+1);
        size_t p3 = spec.find(':', p2+1);
        double f0 = atof(spec.substr(p1+1, p2-p1-1).c_str());
        double f1 = atof(spec.substr(p2+1, p3-p2-1).c_str());
        double secs = atof(spec.substr(p3+1).c_str());
        genSweep(out, f0, f1, secs, sr);
    } else if (kind == "impulse") {
        double secs = atof(spec.substr(p1+1).c_str());
        genImpulse(out, secs, sr);
    } else if (kind == "noise") {
        double secs = atof(spec.substr(p1+1).c_str());
        genNoise(out, secs, sr);
    } else if (kind == "silence") {
        double secs = atof(spec.substr(p1+1).c_str());
        genSilence(out, secs, sr);
    } else if (kind == "step") {
        size_t p2 = spec.find(':', p1+1);
        size_t p3 = spec.find(':', p2+1);
        size_t p4 = spec.find(':', p3+1);
        double lo = atof(spec.substr(p1+1, p2-p1-1).c_str());
        double hi = atof(spec.substr(p2+1, p3-p2-1).c_str());
        double at = atof(spec.substr(p3+1, p4-p3-1).c_str());
        double secs = atof(spec.substr(p4+1).c_str());
        genStep(out, lo, hi, at, secs, sr);
    } else {
        fprintf(stderr, "error: unknown --gen kind '%s'\n", kind.c_str());
        return false;
    }
    return true;
}

struct AmDetect {
    size_t n;
    bool valid;
    int period;
    float periodF;
    float peakVal;
    int peakTau;
};

static void synthAm(std::vector<float>& x, double sr, double carrierHz, double modHz,
                    double depth, double secs, int harm) {
    size_t n = (size_t)(secs * sr);
    x.assign(n, 0.0f);
    double norm = 0.0;
    for (int h = 1; h <= harm; h++) norm += 1.0 / (double)h;
    if (norm < 1e-9) norm = 1.0;
    double pc = 0.0, pm = 0.0;
    for (size_t i = 0; i < n; i++) {
        double s = 0.0;
        double ph = pc;
        for (int h = 1; h <= harm; h++) { s += sin(ph) / (double)h; ph += pc; }
        double env = 1.0 + depth * sin(pm);
        x[i] = (float)(0.5 * env * s / norm);
        pc += 2.0 * M_PI * carrierHz / sr;
        pm += 2.0 * M_PI * modHz / sr;
    }
}

struct CurveSet {
    std::vector<double> r, nk, d, dp, r2, dp2;
};

static void curveFromWindow(const std::vector<double>& w, std::vector<double>& r,
                            std::vector<double>& nk) {
    const int W = SnacPeriodTracker::SNAC_WIN;
    const int MAXP = SnacPeriodTracker::MAX_PERIOD;
    r.assign(MAXP + 2, 0.0);
    nk.assign(MAXP + 2, 1e-12);
    std::vector<double> pre(W + 1, 0.0);
    for (int i = 0; i < W; i++) pre[i + 1] = pre[i] + w[i] * w[i];
    for (int k = 0; k <= MAXP + 1; k++) {
        int limit = W - k;
        if (limit <= 0) continue;
        double s = 0.0;
        for (int n = 0; n < limit; n++) s += w[n] * w[n + k];
        double n = pre[limit] + (pre[W] - pre[k]);
        if (n < 1e-12) n = 1e-12;
        nk[k] = n;
        r[k] = 2.0 * s / n;
    }
}

static double g_envFloor = 0.2;
static double g_envLScale = 1.0;

static void computeCurves(const std::vector<double>& w, CurveSet& c, int prevPeriod) {
    const int W = SnacPeriodTracker::SNAC_WIN;
    const int MAXP = SnacPeriodTracker::MAX_PERIOD;
    curveFromWindow(w, c.r, c.nk);
    c.d.assign(MAXP + 2, 0.0);
    for (int k = 0; k <= MAXP + 1; k++) c.d[k] = c.nk[k] - c.nk[k] * c.r[k];
    c.dp.assign(MAXP + 2, 1e9);
    double acc = 0.0;
    for (int k = 1; k <= MAXP + 1; k++) {
        acc += c.d[k];
        double mean = acc / (double)k;
        c.dp[k] = mean > 1e-12 ? c.d[k] / mean : 1e9;
    }
    double Lf = (prevPeriod > 0 ? (double)prevPeriod : 256.0) * g_envLScale;
    int L = (int)(Lf + 0.5);
    if (L < 64) L = 64;
    if (L > 512) L = 512;
    std::vector<double> preA(W + 1, 0.0);
    for (int i = 0; i < W; i++) preA[i + 1] = preA[i] + fabs(w[i]);
    double floorA = g_envFloor * preA[W] / (double)W;
    std::vector<double> w2(W, 0.0);
    for (int n = 0; n < W; n++) {
        int lo = n - L / 2; if (lo < 0) lo = 0;
        int hi = n + L / 2 + 1; if (hi > W) hi = W;
        double e = (preA[hi] - preA[lo]) / (double)(hi - lo);
        if (e < floorA) e = floorA;
        w2[n] = w[n] / e;
    }
    std::vector<double> nk2;
    curveFromWindow(w2, c.r2, nk2);
    std::vector<double> d2(MAXP + 2, 0.0);
    for (int k = 0; k <= MAXP + 1; k++) d2[k] = nk2[k] - nk2[k] * c.r2[k];
    c.dp2.assign(MAXP + 2, 1e9);
    double acc2 = 0.0;
    for (int k = 1; k <= MAXP + 1; k++) {
        acc2 += d2[k];
        double mean2 = acc2 / (double)k;
        c.dp2[k] = mean2 > 1e-12 ? d2[k] / mean2 : 1e9;
    }
}

static double refinePeak(const std::vector<double>& v, int k) {
    double a = v[k - 1], b = v[k], c = v[k + 1];
    double den = 2.0 * b - a - c;
    if (fabs(den) < 1e-9) return (double)k;
    return (double)k - 0.5 * (a - c) / den;
}

static double pickMax(const std::vector<double>& v, double thresh) {
    const int MINP = SnacPeriodTracker::MIN_PERIOD;
    const int MAXP = SnacPeriodTracker::MAX_PERIOD;
    double bestVal = -1e9;
    int bestTau = -1;
    for (int k = MINP; k < MAXP - 1; k++) {
        if (v[k] > v[k - 1] && v[k] > v[k + 1] && v[k] > thresh) {
            if (v[k] > bestVal) { bestVal = v[k]; bestTau = k; }
        }
    }
    if (bestTau < 0) return 0.0;
    double af = bestVal * 0.90;
    for (int k = MINP; k < bestTau; k++) {
        if (v[k] > v[k - 1] && v[k] > v[k + 1] && v[k] > thresh && v[k] >= af) {
            bestTau = k;
            break;
        }
    }
    return refinePeak(v, bestTau);
}

static double pickMin(const std::vector<double>& v, double thresh) {
    const int MINP = SnacPeriodTracker::MIN_PERIOD;
    const int MAXP = SnacPeriodTracker::MAX_PERIOD;
    int best = -1;
    for (int k = MINP; k < MAXP - 1; k++) {
        if (v[k] < v[k - 1] && v[k] < v[k + 1] && v[k] < thresh) { best = k; break; }
    }
    if (best < 0) {
        double bv = 1e9;
        for (int k = MINP; k < MAXP - 1; k++) if (v[k] < bv) { bv = v[k]; best = k; }
    }
    if (best < 0) return 0.0;
    return refinePeak(v, best);
}

static double centsOf(double estPeriod, double truePeriod) {
    if (estPeriod <= 0.0) return 0.0;
    return 1200.0 * log2(truePeriod / estPeriod);
}

static void dumpSnacCurve(const std::vector<float>& x, size_t nEnd, int obsPeriod,
                          int obsTau, double truePeriod, int prevPeriod) {
    const int W = SnacPeriodTracker::SNAC_WIN;
    const int BLOCK = SnacPeriodTracker::BLOCK;
    const int MAXP = SnacPeriodTracker::MAX_PERIOD;
    const int MINP = SnacPeriodTracker::MIN_PERIOD;
    int steps = (MAXP - 1) / SnacPeriodTracker::LAGS_PER_STEP + 1;
    long n0 = (long)nEnd - (long)steps * BLOCK;
    long start = n0 - (W - 1);
    if (start < 0 || n0 < 0 || n0 >= (long)x.size()) { printf("    curve: out of range\n"); return; }
    std::vector<double> w(W);
    for (int i = 0; i < W; i++) w[i] = x[start + i];
    CurveSet c;
    computeCurves(w, c, prevPeriod);
    printf("    window=[%ld..%ld] observedPeriod=%d observedPeakTau=%d\n",
           start, n0, obsPeriod, obsTau);
    printf("      snac  pick=%7.2f cents=%+8.1f\n",
           pickMax(c.r, 0.30), centsOf(pickMax(c.r, 0.30), truePeriod));
    printf("      yin   pick=%7.2f cents=%+8.1f\n",
           pickMin(c.dp, 0.15), centsOf(pickMin(c.dp, 0.15), truePeriod));
    printf("      envsn pick=%7.2f cents=%+8.1f\n",
           pickMax(c.r2, 0.30), centsOf(pickMax(c.r2, 0.30), truePeriod));
    printf("      envyin pick=%7.2f cents=%+8.1f\n",
           pickMin(c.dp2, 0.15), centsOf(pickMin(c.dp2, 0.15), truePeriod));
    struct Pk { double v; int k; };
    std::vector<Pk> pks;
    for (int k = MINP; k < MAXP - 1; k++) {
        if (c.r2[k] > c.r2[k - 1] && c.r2[k] > c.r2[k + 1]) pks.push_back({c.r2[k], k});
    }
    std::sort(pks.begin(), pks.end(), [](const Pk& a, const Pk& b) { return a.v > b.v; });
    printf("    env-normalized top local maxima:\n");
    for (size_t i = 0; i < pks.size() && i < 8; i++) {
        printf("      k=%4d v=%7.4f ratio=%6.3f cents=%+8.1f\n",
               pks[i].k, pks[i].v, (double)pks[i].k / truePeriod,
               1200.0 * log2(truePeriod / (double)pks[i].k));
    }
    printf("    dp2 local minima below 0.15 (env-yin candidates):\n");
    for (int k = MINP; k < MAXP - 1; k++) {
        if (c.dp2[k] < c.dp2[k - 1] && c.dp2[k] < c.dp2[k + 1] && c.dp2[k] < 0.15) {
            printf("      k=%4d dp2=%7.4f r2=%7.4f r=%7.4f ratio=%6.3f cents=%+8.1f\n",
                   k, c.dp2[k], c.r2[k], c.r[k], (double)k / truePeriod,
                   1200.0 * log2(truePeriod / (double)k));
        }
    }
    printf("    dp local minima below 0.15 (raw-yin candidates):\n");
    for (int k = MINP; k < MAXP - 1; k++) {
        if (c.dp[k] < c.dp[k - 1] && c.dp[k] < c.dp[k + 1] && c.dp[k] < 0.15) {
            printf("      k=%4d dp=%7.4f r=%7.4f ratio=%6.3f cents=%+8.1f\n",
                   k, c.dp[k], c.r[k], (double)k / truePeriod,
                   1200.0 * log2(truePeriod / (double)k));
        }
    }
    printf("    env r2(k) coarse:\n");
    for (int k = MINP; k < MAXP; k += 16) {
        printf("      k=%4d r=%7.4f r2=%7.4f dp=%7.4f\n", k, c.r[k], c.r2[k], c.dp[k]);
    }
}

static void runAmProbe(double sr, double carrier, double mod, double depth,
                       double secs, int harm, bool trace, bool curve, bool est, bool dumpEnv) {
    std::vector<float> x;
    synthAm(x, sr, carrier, mod, depth, secs, harm);
    const double truePeriod = sr / carrier;

    SnacPeriodTracker trk;
    std::vector<AmDetect> det;
    int prevCount = -1;
    for (size_t i = 0; i < x.size(); i++) {
        trk.tick(x[i]);
        if (trk.m_detectCount != prevCount) {
            prevCount = trk.m_detectCount;
            AmDetect d;
            d.n = i;
            d.valid = trk.m_periodValid;
            d.period = trk.m_period;
            d.periodF = trk.m_periodF;
            d.peakVal = trk.m_dbgPeakVal;
            d.peakTau = trk.m_dbgPeakTau;
            det.push_back(d);
        }
    }

    double worst = 0.0, sum = 0.0;
    int count = 0, finalPeriod = 0;
    size_t worstI = 0;
    for (size_t i = 0; i < det.size(); i++) {
        if (!det[i].valid || i < 2) continue;
        double c = 1200.0 * log2(truePeriod / (double)det[i].period);
        double a = fabs(c);
        if (a > worst) { worst = a; worstI = i; }
        sum += a;
        count++;
        finalPeriod = det[i].period;
    }
    double mean = count > 0 ? sum / (double)count : 0.0;
    double finalCents = finalPeriod > 0
        ? 1200.0 * log2(truePeriod / (double)finalPeriod) : 0.0;
    double ratio = finalPeriod > 0 ? (double)finalPeriod / truePeriod : 0.0;

    printf("am,%g,%g,%g,%d,%.2f,%d,%+.1f,%.1f,%.1f,%.3f\n",
           carrier, mod, depth, harm, truePeriod, finalPeriod, finalCents,
           worst, mean, ratio);

    if (est) {
        const int W = SnacPeriodTracker::SNAC_WIN;
        const int BLOCK = SnacPeriodTracker::BLOCK;
        const int MAXP = SnacPeriodTracker::MAX_PERIOD;
        int steps = (MAXP - 1) / SnacPeriodTracker::LAGS_PER_STEP + 1;
        long off = (long)steps * BLOCK;
        double sw = 0, ss = 0, yw = 0, ys = 0, ew = 0, es = 0, e2w = 0, e2s = 0;
        double worstEC = 0.0;
        size_t worstEI = 0;
        int n = 0;
        for (size_t i = 0; i < det.size(); i++) {
            if (!det[i].valid || i < 2) continue;
            long n0 = (long)det[i].n - off;
            long start = n0 - (W - 1);
            if (start < 0) continue;
            std::vector<double> w(W);
            for (int j = 0; j < W; j++) w[j] = x[start + j];
            CurveSet c;
            computeCurves(w, c, det[i].period);
            double cs = centsOf(pickMax(c.r, 0.30), truePeriod);
            double cy = centsOf(pickMin(c.dp, 0.15), truePeriod);
            double ce = centsOf(pickMax(c.r2, 0.30), truePeriod);
            double c2 = centsOf(pickMin(c.dp2, 0.15), truePeriod);
            if (fabs(cs) > sw) sw = fabs(cs);
            if (fabs(cy) > yw) yw = fabs(cy);
            if (fabs(ce) > ew) ew = fabs(ce);
            if (fabs(c2) > e2w) e2w = fabs(c2);
            if (fabs(ce) > worstEC) { worstEC = fabs(ce); worstEI = i; }
            ss += fabs(cs); ys += fabs(cy); es += fabs(ce); e2s += fabs(c2);
            n++;
        }
        double inv = n > 0 ? 1.0 / (double)n : 0.0;
        printf("est,%g,%g,%g,%d,%.1f,%.1f,%.1f,%.1f,%.1f,%.1f,%.1f,%.1f,%d\n",
               carrier, mod, depth, harm, sw, ss * inv, yw, ys * inv, ew, es * inv,
               e2w, e2s * inv, n);
        if (dumpEnv && worstEI < det.size()) {
            printf("  worst env frame: t=%.4fs trackerPeriod=%d envCents=%+.1f\n",
                   det[worstEI].n / sr, det[worstEI].period, worstEC);
            dumpSnacCurve(x, det[worstEI].n, det[worstEI].period, 0, truePeriod,
                          det[worstEI].period);
        }
    }

    if (curve && worst > 0.0 && worstI < det.size()) {
        int prev = worstI > 0 ? det[worstI - 1].period : 0;
        printf("  worst detection: t=%.4fs period=%d peakTau=%d peakVal=%.4f cents=%+.1f\n",
               det[worstI].n / sr, det[worstI].period, det[worstI].peakTau,
               det[worstI].peakVal, 1200.0 * log2(truePeriod / (double)det[worstI].period));
        dumpSnacCurve(x, det[worstI].n, det[worstI].period, det[worstI].peakTau, truePeriod, prev);
    }

    if (trace) {
        printf("  truePeriod=%.2f  carrier=%gHz mod=%gHz depth=%g harm=%d\n",
               truePeriod, carrier, mod, depth, harm);
        for (size_t i = 0; i < det.size(); i++) {
            if (det[i].valid) {
                double c = 1200.0 * log2(truePeriod / (double)det[i].period);
                printf("    t=%.4fs period=%4d periodF=%7.2f cents=%+8.1f ratio=%.3f peakTau=%d peakVal=%.4f\n",
                       det[i].n / sr, det[i].period, det[i].periodF, c,
                       (double)det[i].period / truePeriod, det[i].peakTau, det[i].peakVal);
            } else {
                printf("    t=%.4fs invalid (lockMiss=%d)\n", det[i].n / sr, trk.m_lockMiss);
            }
        }
    }
}

static void runTrk(const char* path, const std::vector<float>& x, double sr,
                   double trueHz, bool trace, bool dump) {
    SnacPeriodTracker trk;
    int prevCount = -1;
    double worst = 0.0, sum = 0.0;
    int count = 0, invalid = 0;
    size_t worstI = 0;
    int worstPeriod = 0, worstTau = -1, worstPrev = 0;
    for (size_t i = 0; i < x.size(); i++) {
        trk.tick(x[i]);
        if (trk.m_detectCount == prevCount) continue;
        prevCount = trk.m_detectCount;
        double cents = 0.0;
        if (trueHz > 0.0) {
            double hz = sr / (double)trk.m_periodF;
            cents = 1200.0 * log2(hz / trueHz);
        }
        if (trace) {
            printf("trk,t=%.4fs,valid=%d,period=%7.2f,cents=%+8.1f,conf=%.3f,peakTau=%d\n",
                   (double)i / sr, trk.m_periodValid ? 1 : 0, trk.m_periodF, cents,
                   trk.m_confidence, trk.m_dbgPeakTau);
        }
        if (!trk.m_periodValid) { invalid++; continue; }
        double a = fabs(cents);
        if (a > worst) {
            worst = a;
            worstI = i;
            worstPeriod = (int)trk.m_periodF;
            worstTau = trk.m_dbgPeakTau;
            worstPrev = trk.m_period;
        }
        sum += a;
        count++;
    }
    double mean = count > 0 ? sum / (double)count : 0.0;
    printf("trksum,%s,trueHz=%.2f,detections=%d,valid=%d,invalid=%d,worst=%.1f,mean=%.1f\n",
           path, trueHz, count + invalid, count, invalid, worst, mean);
    if (dump) dumpSnacCurve(x, worstI, worstPeriod, worstTau, sr / trueHz, worstPrev);
}

static void printStats(const std::vector<float>& sig, uint32_t sr) {
    float peak = 0.0f, sumSq = 0.0f;
    int zeroCrossings = 0;
    int prevSign = 0;
    for (float v : sig) {
        float a = fabsf(v);
        if (a > peak) peak = a;
        sumSq += v * v;
        int sign = v > 0 ? 1 : (v < 0 ? -1 : prevSign);
        if (prevSign != 0 && sign != prevSign) zeroCrossings++;
        prevSign = sign;
    }
    double seconds = sig.size() / (double)sr;
    double rms = sig.empty() ? 0.0 : sqrt(sumSq / sig.size());
    double approxHz = seconds > 0 ? (zeroCrossings / 2.0) / seconds : 0.0;
    printf("samples=%zu  duration=%.4fs  sampleRate=%u\n", sig.size(), seconds, sr);
    printf("peak=%.4f  rms=%.4f  zeroCrossings=%d  approxFreq=%.1fHz\n", peak, rms, zeroCrossings, approxHz);
}

struct PitchResult {
    double hz = 0.0;
    double ncc = 0.0;
    int lag = 0;
};

static PitchResult nccPitch(const std::vector<float>& sig, uint32_t sr, size_t from, size_t to,
                            double minHz, double maxHz) {
    PitchResult r;
    if (to <= from || to > sig.size()) return r;
    size_t n = to - from;
    std::vector<double> x(n);
    double mean = 0.0;
    for (size_t i = 0; i < n; i++) mean += sig[from + i];
    mean /= (double)n;
    for (size_t i = 0; i < n; i++) x[i] = (double)sig[from + i] - mean;
    std::vector<double> pre(n + 1, 0.0);
    for (size_t i = 0; i < n; i++) pre[i + 1] = pre[i] + x[i] * x[i];
    if (pre[n] < 1e-12) return r;
    int minLag = (int)((double)sr / maxHz);
    int maxLag = (int)((double)sr / minHz + 0.5);
    if (minLag < 2) minLag = 2;
    if (maxLag > (int)(n / 2)) maxLag = (int)(n / 2);
    if (maxLag <= minLag + 2) return r;
    std::vector<double> ncc(maxLag + 2, 0.0);
    double gmax = -1e9;
    for (int lag = minLag; lag <= maxLag; lag++) {
        size_t lim = n - (size_t)lag;
        double s = 0.0;
        for (size_t i = 0; i < lim; i++) s += x[i] * x[i + lag];
        double e1 = pre[lim];
        double e2 = pre[n] - pre[(size_t)lag];
        double den = sqrt(e1 * e2);
        double v = den > 1e-18 ? s / den : 0.0;
        ncc[lag] = v;
        if (v > gmax) gmax = v;
    }
    double thresh = 0.85 * gmax;
    int best = -1;
    for (int lag = minLag + 1; lag < maxLag; lag++) {
        if (ncc[lag] >= ncc[lag - 1] && ncc[lag] >= ncc[lag + 1] && ncc[lag] >= thresh) {
            best = lag;
            break;
        }
    }
    if (best < 0) {
        best = minLag;
        for (int lag = minLag; lag <= maxLag; lag++) if (ncc[lag] > ncc[best]) best = lag;
    }
    double refined = (double)best;
    double den2 = ncc[best - 1] - 2.0 * ncc[best] + ncc[best + 1];
    if (fabs(den2) > 1e-12) {
        double delta = 0.5 * (ncc[best - 1] - ncc[best + 1]) / den2;
        if (delta > 1.0) delta = 1.0;
        if (delta < -1.0) delta = -1.0;
        refined += delta;
    }
    r.lag = best;
    r.ncc = ncc[best];
    r.hz = refined > 0.0 ? (double)sr / refined : 0.0;
    return r;
}

static double centsBetween(double measuredHz, double expectedHz) {
    if (measuredHz <= 0.0 || expectedHz <= 0.0) return 0.0;
    return 1200.0 * log(measuredHz / expectedHz) / log(2.0);
}

static void reportPitch(const char* tag, const char* path, const std::vector<float>& sig,
                        uint32_t sr, double expectedHz, double fromSec, double toSec,
                        double minHz, double maxHz, int maxCandidates) {
    size_t a = (size_t)(fromSec * (double)sr);
    size_t b = (size_t)(toSec * (double)sr);
    if (b > sig.size()) b = sig.size();
    if (a >= b) { printf("%s,%s,empty-window\n", tag, path); return; }
    if (minHz <= 0.0) minHz = expectedHz > 0.0 ? expectedHz * 0.35 : 40.0;
    if (maxHz <= 0.0) maxHz = expectedHz > 0.0 ? expectedHz * 3.0 : 4000.0;
    if (maxHz > (double)sr * 0.45) maxHz = (double)sr * 0.45;
    PitchResult p = nccPitch(sig, sr, a, b, minHz, maxHz);
    printf("%s,%s,expect=%.2f,measured=%.2f,cents=%+.1f,ncc=%.4f,lag=%d,window=%.3f..%.3f,band=%.0f..%.0f\n",
           tag, path, expectedHz, p.hz, centsBetween(p.hz, expectedHz), p.ncc, p.lag,
           fromSec, toSec, minHz, maxHz);
    if (maxCandidates <= 0) return;
    size_t n = b - a;
    std::vector<double> x(n);
    double mean = 0.0;
    for (size_t i = 0; i < n; i++) mean += sig[a + i];
    mean /= (double)n;
    for (size_t i = 0; i < n; i++) x[i] = (double)sig[a + i] - mean;
    std::vector<double> pre(n + 1, 0.0);
    for (size_t i = 0; i < n; i++) pre[i + 1] = pre[i] + x[i] * x[i];
    int minLag = (int)((double)sr / maxHz);
    int maxLag = (int)((double)sr / minHz + 0.5);
    if (minLag < 2) minLag = 2;
    if (maxLag > (int)(n / 2)) maxLag = (int)(n / 2);
    struct Cand { int lag; double v; };
    std::vector<Cand> cands;
    for (int lag = minLag + 1; lag < maxLag; lag++) {
        size_t lim = n - (size_t)lag;
        double s = 0.0;
        for (size_t i = 0; i < lim; i++) s += x[i] * x[i + lag];
        double e1 = pre[lim];
        double e2 = pre[n] - pre[(size_t)lag];
        double den = sqrt(e1 * e2);
        double v = den > 1e-18 ? s / den : 0.0;
        if (v > 0.30) {
            size_t lm1 = (size_t)(lag - 1), lp1 = (size_t)(lag + 1);
            double vm = 0.0, vp = 0.0;
            {
                double s2 = 0.0;
                for (size_t i = 0; i + lm1 < n; i++) s2 += x[i] * x[i + lm1];
                double d2 = sqrt(pre[n - lm1] * (pre[n] - pre[lm1]));
                vm = d2 > 1e-18 ? s2 / d2 : 0.0;
            }
            {
                double s2 = 0.0;
                for (size_t i = 0; i + lp1 < n; i++) s2 += x[i] * x[i + lp1];
                double d2 = sqrt(pre[n - lp1] * (pre[n] - pre[lp1]));
                vp = d2 > 1e-18 ? s2 / d2 : 0.0;
            }
            if (v >= vm && v >= vp) cands.push_back({lag, v});
        }
    }
    std::sort(cands.begin(), cands.end(), [](const Cand& p1, const Cand& p2) { return p1.v > p2.v; });
    int shown = 0;
    for (const Cand& c : cands) {
        if (shown++ >= maxCandidates) break;
        double hz = (double)sr / (double)c.lag;
        printf("    cand lag=%4d hz=%8.2f ncc=%.4f ratioToExpect=%.4f cents=%+8.1f\n",
               c.lag, hz, c.v, expectedHz > 0.0 ? hz / expectedHz : 0.0,
               centsBetween(hz, expectedHz));
    }
}

static bool writeWav16(const char* path, const std::vector<float>& s, uint32_t sr) {
    FILE* f = fopen(path, "wb");
    if (!f) return false;
    uint32_t n = (uint32_t)s.size();
    uint32_t dataBytes = n * 2;
    auto u32 = [f](uint32_t v) { fwrite(&v, 4, 1, f); };
    auto u16 = [f](uint16_t v) { fwrite(&v, 2, 1, f); };
    fwrite("RIFF", 1, 4, f); u32(36 + dataBytes); fwrite("WAVE", 1, 4, f);
    fwrite("fmt ", 1, 4, f); u32(16); u16(1); u16(1); u32(sr);
    u32(sr * 2); u16(2); u16(16);
    fwrite("data", 1, 4, f); u32(dataBytes);
    for (uint32_t i = 0; i < n; i++) {
        double v = (double)s[i];
        if (v > 1.0) v = 1.0;
        if (v < -1.0) v = -1.0;
        int16_t q = (int16_t)(v * 32767.0);
        fwrite(&q, 2, 1, f);
    }
    fclose(f);
    return true;
}

static void runSolad(double sr, double freq, double semis, double secs, int harm,
                     int blockSize, double formant, double traceFrom, double traceTo,
                     int gapDump, const char* wavIn, double lpHz, int nearWin,
                     const char* wavOut, double normRms) {
    size_t n = (size_t)(secs * sr);
    std::vector<float> in(n), out(n);
    if (wavIn) {
        uint32_t wavSr = 0;
        if (!readWavMono(wavIn, in, wavSr)) return;
        if (wavSr != (uint32_t)sr) {
            fprintf(stderr, "warning: %s is %uHz, engine runs at %.0fHz\n", wavIn, wavSr, sr);
        }
        n = in.size();
    } else {
    double norm = 0.0;
    for (int h = 1; h <= harm; h++) norm += 1.0 / (double)h;
    if (norm < 1e-9) norm = 1.0;
    for (size_t i = 0; i < n; i++) {
        double s = 0.0;
        for (int h = 1; h <= harm; h++) s += sin(2.0 * M_PI * freq * (double)h * (double)i / sr) / (double)h;
        in[i] = (float)(0.5 * s / norm);
    }
    }
    if (lpHz > 0.0 && lpHz < sr * 0.5) {
        double a = exp(-2.0 * M_PI * lpHz / sr);
        double b = 1.0 - a;
        for (int pass = 0; pass < 4; pass++) {
            double z = 0.0;
            for (size_t i = 0; i < n; i++) { z += b * ((double)in[i] - z); in[i] = (float)z; }
            z = 0.0;
            for (size_t i = n; i-- > 0;) { z += b * ((double)in[i] - z); in[i] = (float)z; }
        }
    }
    EngineSoladSnac eng;
    eng.setPitchScale((float)pow(2.0, semis / 12.0));
    eng.setFormantDepth((float)formant);
    eng.reengage();
    out.assign(n, 0.0f);
    size_t pos = 0;
    size_t traceA = (size_t)(traceFrom * sr);
    size_t traceB = (size_t)(traceTo * sr);
    if (traceB > n) traceB = n;
    std::vector<double> gapTrace;
    std::vector<size_t> spliceAt;
    unsigned prevSpliceCount = 0;
    while (pos < n) {
        int m = (int)std::min((size_t)blockSize, n - pos);
        eng.processBlock(in.data() + pos, out.data() + pos, m);
        if (eng.m_spliceCount != prevSpliceCount) {
            prevSpliceCount = eng.m_spliceCount;
            spliceAt.push_back(pos);
        }
        if (pos >= traceA && pos < traceB) gapTrace.push_back((double)eng.gapNow());
        pos += (size_t)m;
    }
    double expectedHz = freq * pow(2.0, semis / 12.0);
    PitchResult p = nccPitch(out, (uint32_t)sr, (size_t)(0.30 * sr), n,
                             expectedHz * 0.35, expectedHz * 3.0);
    double peakStep = 0.0;
    size_t stepHits = 0, stepNearSplice = 0;
    size_t stepStart = (size_t)(0.30 * sr);
    size_t nearIdx = 0;
    for (size_t i = stepStart + 1; i < n; i++) {
        double d = fabs((double)out[i] - (double)out[i - 1]);
        if (d > 0.15) {
            stepHits++;
            while (nearIdx < spliceAt.size() && spliceAt[nearIdx] + (size_t)(nearWin > 0 ? nearWin : 0) < i) nearIdx++;
            bool near = false;
            for (size_t k = nearIdx; k < spliceAt.size(); k++) {
                if (spliceAt[k] > i) break;
                if (i - spliceAt[k] <= (size_t)(nearWin > 0 ? nearWin : 0)) { near = true; break; }
            }
            if (near) stepNearSplice++;
        }
        if (d > peakStep) peakStep = d;
    }
    double sq = 0.0;
    size_t sqN = 0;
    for (size_t i = stepStart; i < n; i++) { sq += (double)out[i] * (double)out[i]; sqN++; }
    double rms = sqN > 0 ? sqrt(sq / (double)sqN) : 0.0;
    if (wavOut) {
        std::vector<float> w = out;
        if (normRms > 0.0 && rms > 1e-9) {
            double g = normRms / rms;
            for (size_t i = 0; i < w.size(); i++) w[i] = (float)((double)w[i] * g);
        }
        writeWav16(wavOut, w, (uint32_t)sr);
    }
    double gapMin = 1e9, gapMax = -1e9, gapSum = 0.0;
    for (double g : gapTrace) {
        if (g < gapMin) gapMin = g;
        if (g > gapMax) gapMax = g;
        gapSum += g;
    }
    double gapMean = gapTrace.empty() ? 0.0 : gapSum / (double)gapTrace.size();
    float effRate = eng.effRateNow();
    if (gapDump > 0) {
        int shown = 0;
        for (double g : gapTrace) {
            if (shown >= gapDump) break;
            printf("gap,%d,%.2f\n", shown, g);
            shown++;
        }
    }
    printf("solad,freq=%.2f,semis=%+.2f,scale=%.4f,expect=%.2f,measured=%.2f,cents=%+.1f,"
           "achievedSemis=%+.2f,splices=%u,emergency=%u,clamped=%u,effRate=%.4f,"
           "gapMin=%d,gapMean=%.1f,gapMax=%d,stepHits=%zu,stepNear=%zu,peakStep=%.4f,rms=%.4f,"
           "stepPerK=%zu\n",
           freq, semis, pow(2.0, semis / 12.0), expectedHz, p.hz,
           centsBetween(p.hz, expectedHz),
           p.hz > 0.0 ? 12.0 * log(freq > 0.0 ? p.hz / freq : 0.0) / log(2.0) : 0.0,
           eng.m_spliceCount, eng.emergencyCount(), eng.clampCount(), effRate,
           eng.gapMinSeen(), gapMean, eng.gapMaxSeen(),
           stepHits, stepNearSplice, peakStep, rms,
           (size_t)(stepHits * 1000 / (sqN > 0 ? sqN : 1)));
}

int main(int argc, char** argv) {
    if (argc < 2) {
        fprintf(stderr,
            "usage:\n"
            "  dsp_cli <in.wav> <out.wav> [CTRL=value ...]\n"
            "  dsp_cli --gen <sine:freq:secs|sweep:f0:f1:secs|impulse:secs|noise:secs|silence:secs|step:lo:hi:at:secs|wav:path> <out.wav> [CTRL=value ...]\n"
            "  dsp_cli --gen0 <spec> [--gen1 <spec> --gen2 <spec> ...] <out.wav> [CTRL=value ...]\n"
            "      (multi-input DSPs: drive each input channel independently; --gen is an alias for --gen0)\n"
            "  dsp_cli --stats <file.wav>\n"
            "  dsp_cli --trk <file.wav> [hz=<trueHz>] [trace=1]\n"
            "  dsp_cli --list-zones\n");
        return 1;
    }

    const double SR = 48000.0;

    if (strcmp(argv[1], "--am-probe") == 0) {
        double carrier = 220.0, mod = 5.0, depth = 0.9, secs = 2.5;
        int harm = 1;
        bool grid = false, trace = false, curve = false, est = false, dumpEnv = false;
        for (int i = 2; i < argc; i++) {
            std::string arg = argv[i];
            size_t eq = arg.find('=');
            if (eq == std::string::npos) continue;
            std::string k = arg.substr(0, eq);
            double v = atof(arg.substr(eq + 1).c_str());
            if (k == "carrier") carrier = v;
            else if (k == "mod") mod = v;
            else if (k == "depth") depth = v;
            else if (k == "secs") secs = v;
            else if (k == "harm") harm = (int)v;
            else if (k == "grid") grid = v != 0.0;
            else if (k == "trace") trace = v != 0.0;
            else if (k == "curve") curve = v != 0.0;
            else if (k == "est") est = v != 0.0;
            else if (k == "envFloor") g_envFloor = v;
            else if (k == "envLScale") g_envLScale = v;
            else if (k == "dumpEnv") dumpEnv = v != 0.0;
        }
        if (harm < 1) harm = 1;
        if (harm > 8) harm = 8;
        printf("carrier,mod,depth,harm,truePeriod,finalPeriod,finalCents,worstAbsCents,meanAbsCents,ratio\n");
        if (grid) {
            const double carriers[] = {110.0, 220.0, 440.0};
            const double mods[] = {1.0, 4.0, 8.0, 16.0, 32.0, 64.0};
            const double depths[] = {0.5, 0.9, 1.0};
            const int harms[] = {1, 3};
            for (double c : carriers)
                for (double m : mods)
                    for (double d : depths)
                        for (int h : harms)
                            runAmProbe(SR, c, m, d, secs, h, false, false, est, false);
        } else {
            runAmProbe(SR, carrier, mod, depth, secs, harm, trace, curve, est, dumpEnv);
        }
        return 0;
    }

    if (strcmp(argv[1], "--trk") == 0) {
        if (argc < 3) { fprintf(stderr, "error: --trk needs a file\n"); return 1; }
        double trueHz = 0.0;
        bool trace = false, dump = false;
        for (int i = 3; i < argc; i++) {
            std::string arg = argv[i];
            size_t eq = arg.find('=');
            if (eq == std::string::npos) continue;
            std::string k = arg.substr(0, eq);
            double v = atof(arg.substr(eq + 1).c_str());
            if (k == "hz") trueHz = v;
            else if (k == "trace") trace = v != 0.0;
            else if (k == "dump") dump = v != 0.0;
            else if (k == "envFloor") g_envFloor = v;
            else if (k == "envLScale") g_envLScale = v;
        }
        std::vector<float> sig; uint32_t sr;
        if (!readWavMono(argv[2], sig, sr)) return 1;
        runTrk(argv[2], sig, (double)sr, trueHz, trace, dump);
        return 0;
    }

    if (strcmp(argv[1], "--glitch-check") == 0) {
        if (argc < 3) { fprintf(stderr, "error: --glitch-check needs a file\n"); return 1; }
        std::vector<float> sig; uint32_t sr;
        if (!readWavMono(argv[2], sig, sr)) return 1;
        float threshold = 0.25f;
        float minGapMs = 5.0f;
        for (int i = 3; i < argc; i++) {
            std::string arg = argv[i];
            size_t eq = arg.find('=');
            if (eq == std::string::npos) continue;
            std::string name = arg.substr(0, eq);
            float val = (float)atof(arg.substr(eq + 1).c_str());
            if (name == "threshold") threshold = val;
            else if (name == "minGapMs") minGapMs = val;
        }
        size_t minGapSamples = (size_t)(minGapMs * 0.001 * sr);
        std::vector<size_t> hits;
        size_t lastHit = (size_t)-1;
        for (size_t i = 1; i < sig.size(); i++) {
            float d = fabsf(sig[i] - sig[i - 1]);
            if (d > threshold) {
                if (lastHit == (size_t)-1 || (i - lastHit) > minGapSamples) hits.push_back(i);
                lastHit = i;
            }
        }
        printf("samples=%zu  duration=%.4fs  sampleRate=%u  threshold=%.3f  minGapMs=%.1f\n",
               sig.size(), sig.size() / (double)sr, sr, threshold, minGapMs);
        printf("glitches=%zu\n", hits.size());
        for (size_t h : hits) {
            printf("  at sample=%zu t=%.4fs  delta=%.4f\n", h, h / (double)sr, fabsf(sig[h] - sig[h - 1]));
        }
        return hits.empty() ? 0 : 1;
    }

    if (strcmp(argv[1], "--stats") == 0) {
        if (argc < 3) { fprintf(stderr, "error: --stats needs a file\n"); return 1; }
        std::vector<float> sig; uint32_t sr;
        if (!readWavMono(argv[2], sig, sr)) return 1;
        printStats(sig, sr);
        return 0;
    }

    if (strcmp(argv[1], "--pitch") == 0) {
        if (argc < 3) { fprintf(stderr, "error: --pitch needs a file\n"); return 1; }
        double hz = 0.0, minHz = 0.0, maxHz = 0.0, from = 0.40, to = 1.40;
        int maxCandidates = 0;
        for (int i = 3; i < argc; i++) {
            std::string arg = argv[i];
            size_t eq = arg.find('=');
            if (eq == std::string::npos) continue;
            std::string k = arg.substr(0, eq);
            double v = atof(arg.substr(eq + 1).c_str());
            if (k == "hz") hz = v;
            else if (k == "minhz") minHz = v;
            else if (k == "maxhz") maxHz = v;
            else if (k == "from") from = v;
            else if (k == "to") to = v;
            else if (k == "candidates") maxCandidates = (int)v;
        }
        std::vector<float> sig; uint32_t sr;
        if (!readWavMono(argv[2], sig, sr)) return 1;
        reportPitch("pitch", argv[2], sig, sr, hz, from, to, minHz, maxHz, maxCandidates);
        return 0;
    }

    if (strcmp(argv[1], "--solad") == 0) {
        double freq = 220.0, semis = 0.0, secs = 2.0, formant = 0.0;
        double traceFrom = 0.0, traceTo = 1.0e9;
        int harm = 3, blockSize = 64, gapDump = 0;
        const char* wavIn = nullptr;
        const char* wavOut = nullptr;
        bool sweep = false;
        double sweepLo = -24.0, sweepHi = 24.0, sweepStep = 1.0;
        double lpHz = 0.0, normRms = 0.0;
        int nearWin = 64;
        std::string wavPath, wavOutPath;
        for (int i = 2; i < argc; i++) {
            std::string arg = argv[i];
            size_t eq = arg.find('=');
            if (eq == std::string::npos) continue;
            std::string k = arg.substr(0, eq);
            double v = atof(arg.substr(eq + 1).c_str());
            if (k == "freq") freq = v;
            else if (k == "semis") semis = v;
            else if (k == "secs") secs = v;
            else if (k == "harm") harm = (int)v;
            else if (k == "bs") blockSize = (int)v;
            else if (k == "formant") formant = v;
            else if (k == "tracefrom") traceFrom = v;
            else if (k == "traceto") traceTo = v;
            else if (k == "sweep") sweep = v != 0.0;
            else if (k == "sweeplo") sweepLo = v;
            else if (k == "sweephi") sweepHi = v;
            else if (k == "sweepstep") sweepStep = v;
            else if (k == "gapdump") gapDump = (int)v;
            else if (k == "in") { wavPath = arg.substr(eq + 1); wavIn = wavPath.c_str(); }
            else if (k == "out") { wavOutPath = arg.substr(eq + 1); wavOut = wavOutPath.c_str(); }
            else if (k == "normrms") normRms = v;
            else if (k == "lp") lpHz = v;
            else if (k == "nearwin") nearWin = (int)v;
        }
        if (harm < 1) harm = 1;
        if (harm > 8) harm = 8;
        if (blockSize < 1) blockSize = 1;
        if (sweep) {
            for (double s = sweepLo; s <= sweepHi + 1e-9; s += sweepStep)
                runSolad(SR, freq, s, secs, harm, blockSize, formant, traceFrom, traceTo, gapDump, wavIn, lpHz, nearWin, wavOut, normRms);
        } else {
            runSolad(SR, freq, semis, secs, harm, blockSize, formant, traceFrom, traceTo, gapDump, wavIn, lpHz, nearWin, wavOut, normRms);
        }
        return 0;
    }

    auto dspPtr = std::make_unique<AloopEffectDsp>();
    AloopEffectDsp& dsp = *dspPtr;
    dsp.init((int)SR);
    FaustUI ui;
    dsp.buildUserInterface(&ui);

    if (strcmp(argv[1], "--list-zones") == 0) {
        fprintf(stderr, "controls in this DSP:\n");
        ui.listZones();
        return 0;
    }

    std::vector<float> in, out;
    uint32_t sr = (uint32_t)SR;
    int ctrlArgStart;
    const char* outPath;

    std::map<int, std::vector<float>> genByChannel;

    bool isGenMode = strncmp(argv[1], "--gen", 5) == 0
        && (argv[1][5] == '\0' || isdigit((unsigned char)argv[1][5]));

    if (isGenMode) {
        int i = 1;
        while (i < argc && strncmp(argv[i], "--gen", 5) == 0
               && (argv[i][5] == '\0' || isdigit((unsigned char)argv[i][5]))) {
            std::string flag = argv[i];
            std::string idxPart = flag.substr(5);
            int chan = idxPart.empty() ? 0 : atoi(idxPart.c_str());
            if (i + 1 >= argc) { fprintf(stderr, "error: %s needs a spec\n", flag.c_str()); return 1; }
            std::string spec = argv[i+1];
            std::vector<float> sig;
            if (!parseGenSpec(spec, sig, SR)) return 1;
            genByChannel[chan] = std::move(sig);
            i += 2;
        }
        if (i >= argc) { fprintf(stderr, "error: --gen/--genN needs an output file after the spec(s)\n"); return 1; }
        outPath = argv[i];
        ctrlArgStart = i + 1;

        size_t maxLen = 0;
        for (auto& kv : genByChannel) maxLen = std::max(maxLen, kv.second.size());
        in.assign(maxLen, 0.0f);
        if (genByChannel.count(0)) in = genByChannel[0];
        out.assign(maxLen, 0.0f);
    } else {
        if (argc < 3) { fprintf(stderr, "error: need <in.wav> <out.wav>\n"); return 1; }
        if (!readWavMono(argv[1], in, sr)) return 1;
        outPath = argv[2];
        ctrlArgStart = 3;
        out.assign(in.size(), 0.0f);
        genByChannel[0] = in;
    }

    for (int i = ctrlArgStart; i < argc; i++) {
        std::string arg = argv[i];
        size_t eq = arg.find('=');
        if (eq == std::string::npos) { fprintf(stderr, "warning: ignoring malformed arg '%s' (expected CTRL=value)\n", arg.c_str()); continue; }
        std::string name = arg.substr(0, eq);
        float val = (float)atof(arg.substr(eq+1).c_str());
        ui.set(name.c_str(), val);
    }

    const int N = dsp.getNumInputs();
    const int M = dsp.getNumOutputs();
    {
        int undriven = 0;
        for (int c = 0; c < N; c++) if (!genByChannel.count(c)) undriven++;
        if (undriven > 0) {
            fprintf(stderr, "note: this DSP has %d input(s); %d channel(s) have no --gen%s spec and are fed silence\n",
                N, undriven, N > 1 ? "N" : "");
        }
    }

    size_t totalLen = in.size();
    for (auto& kv : genByChannel) totalLen = std::max(totalLen, kv.second.size());

    std::vector<std::vector<float>> inBufs(N > 0 ? N : 1), outBufs(M > 0 ? M : 1);
    for (auto& b : inBufs) b.assign(totalLen, 0.0f);
    for (auto& b : outBufs) b.assign(totalLen, 0.0f);
    for (int c = 0; c < N; c++) {
        auto it = genByChannel.find(c);
        if (it != genByChannel.end()) {
            for (size_t s = 0; s < it->second.size(); s++) inBufs[c][s] = it->second[s];
        }
    }

    const int blockSize = 64;
    size_t pos = 0;
    std::vector<float*> inPtrs(N > 0 ? N : 1), outPtrs(M > 0 ? M : 1);
    while (pos < totalLen) {
        int n = (int)std::min((size_t)blockSize, totalLen - pos);
        for (int c = 0; c < N; c++) inPtrs[c] = inBufs[c].data() + pos;
        for (int c = 0; c < M; c++) outPtrs[c] = outBufs[c].data() + pos;
        dsp.compute(n, N > 0 ? inPtrs.data() : nullptr, M > 0 ? outPtrs.data() : nullptr);
        pos += n;
    }
    if (M > 0) out = outBufs[0];
    else out.assign(totalLen, 0.0f);

    writeWavMono(outPath, out, sr);
    fprintf(stderr, "wrote %s (%zu samples, %.3fs)\n", outPath, out.size(), out.size()/SR);
    if (M > 1) fprintf(stderr, "channel 0:\n");
    printStats(out, sr);

    if (M > 1) {
        std::string stem = outPath;
        const std::string ext = ".wav";
        if (stem.size() >= ext.size() && stem.compare(stem.size() - ext.size(), ext.size(), ext) == 0)
            stem = stem.substr(0, stem.size() - ext.size());
        for (int c = 1; c < M; c++) {
            std::string chPath = stem + "." + std::to_string(c) + ".wav";
            writeWavMono(chPath.c_str(), outBufs[c], sr);
            fprintf(stderr, "wrote %s (%zu samples, %.3fs)\n", chPath.c_str(), outBufs[c].size(), outBufs[c].size()/SR);
            fprintf(stderr, "channel %d:\n", c);
            printStats(outBufs[c], sr);
        }
    }
    return 0;
}
