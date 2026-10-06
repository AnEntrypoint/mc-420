#define _USE_MATH_DEFINES
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <map>
#include <string>
#include <vector>

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
    float* find(const char* suf) {
        std::string s(suf);
        for (auto& kv : zones) {
            const std::string& k = kv.first;
            if (k.size() >= s.size() && k.compare(k.size() - s.size(), s.size(), s) == 0)
                return kv.second;
        }
        return nullptr;
    }
};
#define Meta FaustMeta
#define UI FaustUI
#define dsp FaustDspBase
struct FaustDspBase { virtual ~FaustDspBase() {} };
#include "dsp_gen.cpp"
#undef dsp

static const int SR = 48000;
static const int BS = 128;
static const double F0 = 220.0;
static const double BURST_A = 1.00;
static const double BURST_B = 1.40;
static const float TARGET_NOTE = 69.0f;
static const float GATE_ON = 0.30;

static uint32_t g_rng = 0x9e3779b9u;
static float white() {
    g_rng ^= g_rng << 13;
    g_rng ^= g_rng >> 17;
    g_rng ^= g_rng << 5;
    return (float)((int32_t)g_rng) * (1.0f / 2147483648.0f);
}

struct Buf {
    std::vector<float> v;
    Buf(int n) : v(n, 0.0f) {}
};

int main(int argc, char** argv) {
    double durS = argc > 1 ? atof(argv[1]) : 3.0;
    const char* wavIn = argc > 2 ? argv[2] : nullptr;

    AloopEffectDsp dsp;
    FaustUI ui;
    dsp.buildUserInterface(&ui);
    dsp.init(SR);
    int nin = dsp.getNumInputs();
    int nout = dsp.getNumOutputs();
    fprintf(stderr, "trace: nin=%d nout=%d zones=%d\n", nin, nout, (int)ui.zones.size());

    float* zShift = ui.find("shiftamountdiag");
    float* zHeld = ui.find("helddetnotediag");
    float* zFreq = ui.find("freqdetdiag");
    float* zTrust = ui.find("trustedtrackerdiag");
    if (!zShift || !zHeld) {
        fprintf(stderr, "trace: missing diagnostic zones\n");
        return 1;
    }

    int nBlocks = (int)(durS * SR / BS);
    std::vector<std::vector<float>> in(nin, std::vector<float>(BS, 0.0f));
    std::vector<std::vector<float>> out(nout, std::vector<float>(BS, 0.0f));
    std::vector<float*> inP(nin), outP(nout);
    for (int i = 0; i < nin; i++) inP[i] = in[i].data();
    for (int i = 0; i < nout; i++) outP[i] = out[i].data();

    std::vector<double> harmPhase(16, 0.0);
    std::vector<float> wav;
    size_t wavPos = 0;
    double extF0 = argc > 3 ? atof(argv[3]) : F0;
    float targetNote = argc > 4 ? (float)atof(argv[4]) : TARGET_NOTE;
    bool impulse = wavIn && strcmp(wavIn, "impulse") == 0;
    int impAt = impulse ? (int)(0.5 * SR) : -1;
    if (impulse) wavIn = nullptr;
    if (wavIn) {
        FILE* f = fopen(wavIn, "rb");
        if (!f) { fprintf(stderr, "trace: cannot open %s\n", wavIn); return 1; }
        unsigned char hdr[12];
        if (fread(hdr, 1, 12, f) != 12 || memcmp(hdr, "RIFF", 4) != 0) {
            fprintf(stderr, "trace: not a RIFF wav %s\n", wavIn);
            return 1;
        }
        int channels = 1;
        int bits = 16;
        int fmtTag = 1;
        int wsr = SR;
        bool gotData = false;
        while (!gotData) {
            unsigned char ch[8];
            if (fread(ch, 1, 8, f) != 8) break;
            unsigned long sz = (unsigned long)ch[4] | ((unsigned long)ch[5] << 8) |
                               ((unsigned long)ch[6] << 16) | ((unsigned long)ch[7] << 24);
            if (memcmp(ch, "fmt ", 4) == 0) {
                std::vector<unsigned char> b(sz);
                if (fread(b.data(), 1, sz, f) != sz) break;
                if (sz >= 16) {
                    fmtTag = (int)(b[0] | ((int)b[1] << 8));
                    channels = (int)(b[2] | ((int)b[3] << 8));
                    wsr = (int)(b[4] | ((int)b[5] << 8) | ((int)b[6] << 16) | ((int)b[7] << 24));
                    bits = (int)(b[14] | ((int)b[15] << 8));
                }
            } else if (memcmp(ch, "data", 4) == 0) {
                std::vector<unsigned char> b(sz);
                if (fread(b.data(), 1, sz, f) != sz) break;
                size_t frames = 0;
                if (bits == 16 && fmtTag == 1) {
                    frames = sz / 2;
                    wav.resize(frames / (size_t)(channels > 0 ? channels : 1));
                    for (size_t i = 0; i < wav.size(); i++) {
                        double acc = 0.0;
                        for (int c = 0; c < channels; c++) {
                            size_t o = 2 * (i * (size_t)channels + (size_t)c) + 1;
                            if (o >= sz) break;
                            int16_t v = (int16_t)((uint16_t)b[o - 1] | ((uint16_t)b[o] << 8));
                            acc += (double)v / 32768.0;
                        }
                        wav[i] = (float)(acc / (double)(channels > 0 ? channels : 1));
                    }
                }
                gotData = true;
            } else {
                if (sz & 1) sz++;
                fseek(f, (long)sz, SEEK_CUR);
            }
        }
        fclose(f);
        fprintf(stderr, "trace: wav %s frames=%d sr=%d\n", wavIn, (int)wav.size(), wsr);
    }

    printf("block,t,conf,shiftAmt,heldDetNote,freqDet,trusted,outRms\n");
    for (int b = 0; b < nBlocks; b++) {
        for (int i = 0; i < BS; i++) {
            int n = b * BS + i;
            double t = (double)n / (double)SR;
            float dry;
            if (!wav.empty()) {
                dry = wavPos < wav.size() ? wav[wavPos++] : 0.0f;
            } else {
                double acc = 0.0;
                double norm = 0.0;
                for (int k = 1; k <= 8; k++) {
                    harmPhase[k] += 2.0 * M_PI * F0 * (double)k / (double)SR;
                    if (harmPhase[k] > 2.0 * M_PI) harmPhase[k] -= 2.0 * M_PI;
                    acc += sin(harmPhase[k]) / (double)k;
                    norm += 1.0 / (double)k;
                }
                dry = (float)(acc / norm * 0.25);
            }
            bool burst = (t >= BURST_A && t < BURST_B);
            if (burst && wav.empty()) dry = white() * 0.25f;
            if (impulse && n == impAt) dry = 1.0f;
            if (impulse && n != impAt) dry = 0.0f;

            in[0][i] = dry;
            in[1][i] = 0.0f;
            in[2][i] = 0.0f;
            in[3][i] = 0.0f;
            in[4][i] = wav.empty() ? (burst ? 880.0f : (float)F0) : (float)extF0;
            in[5][i] = targetNote;
            in[6][i] = t >= GATE_ON ? 1.0f : 0.0f;
            for (int c = 7; c < nin; c++) in[c][i] = 0.0f;
        }
        dsp.compute(BS, inP.data(), outP.data());

        double acc = 0.0;
        int firstNz = -1;
        for (int i = 0; i < BS; i++) {
            acc += (double)out[0][i] * (double)out[0][i];
            if (firstNz < 0 && fabs(out[0][i]) > 1e-9) firstNz = i;
        }
        float rms = (float)sqrt(acc / BS);
        printf("%d,%.6f,%.5f,%.4f,%.4f,%.4f,%.4f,%.6f,%d\n", b, (double)(b * BS) / (double)SR,
               dubfx_poly_shared_snac().confidence(), *zShift, *zHeld,
               zFreq ? *zFreq : 0.0f, zTrust ? *zTrust : 0.0f, rms, firstNz);
    }
    return 0;
}
