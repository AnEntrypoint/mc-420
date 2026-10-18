#include "sampler.h"

#include <algorithm>
#include <cmath>
#include <complex>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

namespace {

constexpr int kSR = 48000;
constexpr int kBlock = 480;
constexpr int kHeldFrames = 5 * kSR;
constexpr int kSnapshotFrames = 3 * kSR;
constexpr int kEnvWin = 480;
constexpr int kFftN = 16384;
constexpr double kPi = 3.14159265358979323846;

constexpr double kRateRel = 0.20;
constexpr double kEnvDb = 2.0;
constexpr double kCentroidHz = 300.0;
constexpr double kFreezeCv = 0.05;
constexpr double kFreezeEnvStdDb = 1.0;

struct Patch {
    std::string name;
    float grainMs, grainRateHz, pitchSprayCents, posJitterMs, scanRate;
    float reverseProb, envShape, liveMix, toneNorm, transposeCents;
    int quantize;
    bool freeze;
};

struct Metrics {
    std::string name;
    double grainRateHz;
    double envMeanDb;
    double envStdDb;
    double centroidMeanHz;
    double centroidCv;
};

[[noreturn]] void fail(const std::string& why) {
    std::fprintf(stderr, "granulator-patches: FAIL: %s\n", why.c_str());
    std::exit(1);
}

std::vector<Patch> readPatches(const char* path) {
    std::ifstream in(path);
    if (!in) fail(std::string("cannot open ") + path);
    std::vector<Patch> out;
    std::string line;
    std::getline(in, line);
    while (std::getline(in, line)) {
        if (line.empty()) continue;
        std::istringstream ss(line);
        Patch p{};
        int freezeFlag = 0;
        ss >> p.name >> p.grainMs >> p.grainRateHz >> p.pitchSprayCents >> p.posJitterMs
           >> p.scanRate >> p.reverseProb >> p.envShape >> p.liveMix >> p.toneNorm
           >> p.transposeCents >> p.quantize >> freezeFlag;
        if (ss.fail()) fail("malformed patch row: " + line);
        p.freeze = freezeFlag == 1;
        out.push_back(p);
    }
    return out;
}

bool hasPatch(const std::vector<Patch>& ps, const std::string& name) {
    return std::any_of(ps.begin(), ps.end(), [&](const Patch& p) { return p.name == name; });
}

void fft(std::vector<std::complex<double>>& a) {
    const size_t n = a.size();
    for (size_t i = 1, j = 0; i < n; i++) {
        size_t bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) std::swap(a[i], a[j]);
    }
    for (size_t len = 2; len <= n; len <<= 1) {
        const double ang = -2.0 * kPi / static_cast<double>(len);
        const std::complex<double> wl(std::cos(ang), std::sin(ang));
        for (size_t i = 0; i < n; i += len) {
            std::complex<double> w(1.0, 0.0);
            for (size_t j = 0; j < len / 2; j++) {
                const std::complex<double> u = a[i + j];
                const std::complex<double> v = a[i + j + len / 2] * w;
                a[i + j] = u + v;
                a[i + j + len / 2] = u - v;
                w *= wl;
            }
        }
    }
}

void chordBlock(int pos, std::vector<int>& out) {
    const double freqs[3] = {261.63, 329.63, 392.00};
    for (int i = 0; i < kBlock; i++) {
        const double t = static_cast<double>(pos + i) / kSR;
        double v = 0.0;
        for (double f : freqs) v += std::sin(2.0 * kPi * f * t);
        out[i] = static_cast<int>(0.1 * 32767.0 * v);
    }
}

void loadChord(aloop::Sampler& s) {
    std::vector<int> scratch(kBlock, 0);
    std::vector<int> in(kBlock);
    s.pushEvent(aloop::Sampler::EV_REC_START, -1, 0);
    s.renderInto(scratch.data(), kBlock);
    for (int pos = 0; pos < kSnapshotFrames; pos += kBlock) {
        chordBlock(pos, in);
        s.captureBlock(in.data(), kBlock);
    }
    s.pushEvent(aloop::Sampler::EV_REC_STOP, -1, 0);
    s.renderInto(scratch.data(), kBlock);
    if (!s.chromaticLoaded()) fail("held chord did not load into the sampler");
}

void centroidStats(const std::string& name, const std::vector<double>& y, double& mean, double& cv) {
    std::vector<double> cents;
    std::vector<std::complex<double>> a(kFftN);
    for (size_t start = 0; start + kFftN <= y.size(); start += kFftN / 2) {
        for (int i = 0; i < kFftN; i++) {
            const double w = 0.5 - 0.5 * std::cos(2.0 * kPi * i / (kFftN - 1));
            a[i] = std::complex<double>(y[start + i] * w, 0.0);
        }
        fft(a);
        double num = 0.0, den = 0.0;
        for (int k = 1; k <= kFftN / 2; k++) {
            const double pwr = std::norm(a[k]);
            num += pwr * (static_cast<double>(k) * kSR / kFftN);
            den += pwr;
        }
        if (den > 1e-18) cents.push_back(num / den);
    }
    if (cents.empty()) fail("empty figure: no spectral energy in the measured window for " + name);
    mean = 0.0;
    for (double c : cents) mean += c;
    mean /= static_cast<double>(cents.size());
    double var = 0.0;
    for (double c : cents) var += (c - mean) * (c - mean);
    var /= static_cast<double>(cents.size());
    cv = std::sqrt(var) / mean;
}

Metrics renderPatch(const Patch& p) {
    aloop::Sampler s;
    loadChord(s);
    s.setGranulatorEnabled(true);
    s.setGrainPatch(p.grainMs, p.grainRateHz, p.pitchSprayCents, p.posJitterMs, p.scanRate,
                    p.reverseProb, p.envShape, p.liveMix, p.toneNorm);
    s.setGrainFreeze(0.0f);
    s.setGrainTransposeCents(p.transposeCents);
    s.setGrainPitchQuantize(p.quantize);
    s.pushEvent(aloop::Sampler::EV_NOTE_ON, 60, 127);

    const int freezeAt = p.freeze ? kSnapshotFrames : kHeldFrames;
    bool frozen = false;
    std::vector<double> y(kHeldFrames, 0.0);
    std::vector<int> buf(kBlock, 0);
    std::vector<int> in(kBlock, 0);
    for (int pos = 0; pos < kHeldFrames; pos += kBlock) {
        if (!frozen && pos >= freezeAt) {
            s.setGrainFreeze(1.0f);
            frozen = true;
        }
        if (!frozen) {
            chordBlock(pos, in);
            s.feedLiveGrainSource(in.data(), kBlock);
        }
        std::fill(buf.begin(), buf.end(), 0);
        s.renderInto(buf.data(), kBlock);
        for (int i = 0; i < kBlock; i++) y[pos + i] = buf[i] / 32768.0;
    }

    const size_t winStart = p.freeze ? static_cast<size_t>(freezeAt) : 0;
    const std::vector<double> w(y.begin() + static_cast<long>(winStart), y.end());
    double sq = 0.0;
    for (double v : w) sq += v * v;
    std::fprintf(stderr, "granulator-patches: %s rms %.8f over %zu frames\n", p.name.c_str(),
                 std::sqrt(sq / static_cast<double>(w.size())), w.size());

    std::vector<double> envDb;
    for (size_t start = 0; start + kEnvWin <= w.size(); start += kEnvWin) {
        double ss = 0.0;
        for (int i = 0; i < kEnvWin; i++) ss += w[start + i] * w[start + i];
        const double rms = std::sqrt(ss / kEnvWin);
        envDb.push_back(20.0 * std::log10(std::max(rms, 1e-9)));
    }
    if (envDb.empty()) fail("empty figure: no envelope windows for patch " + p.name);

    double envMean = 0.0;
    for (double d : envDb) envMean += d;
    envMean /= static_cast<double>(envDb.size());
    double envVar = 0.0;
    for (double d : envDb) envVar += (d - envMean) * (d - envMean);
    envVar /= static_cast<double>(envDb.size());

    int peaks = 0;
    for (size_t k = 1; k + 1 < envDb.size(); k++) {
        if (envDb[k] > envMean && envDb[k] > envDb[k - 1] && envDb[k] >= envDb[k + 1]) peaks++;
    }

    Metrics m{};
    m.name = p.name;
    m.grainRateHz = peaks / (static_cast<double>(w.size()) / kSR);
    m.envMeanDb = envMean;
    m.envStdDb = std::sqrt(envVar);
    centroidStats(p.name, w, m.centroidMeanHz, m.centroidCv);

    const double vals[] = {m.grainRateHz, m.envMeanDb, m.envStdDb, m.centroidMeanHz, m.centroidCv};
    for (double v : vals) {
        if (std::isnan(v)) fail("NaN in measurements for patch " + p.name);
    }
    return m;
}

bool distinct(const Metrics& a, const Metrics& b) {
    const double rateRel = std::fabs(a.grainRateHz - b.grainRateHz) /
                           std::max(std::max(a.grainRateHz, b.grainRateHz), 1e-9);
    return rateRel >= kRateRel ||
           std::fabs(a.envMeanDb - b.envMeanDb) >= kEnvDb ||
           std::fabs(a.centroidMeanHz - b.centroidMeanHz) >= kCentroidHz;
}

}

int main(int argc, char** argv) {
    if (argc != 3) {
        std::fprintf(stderr, "usage: render_patches <patches.tsv> <out.tsv>\n");
        return 2;
    }
    const std::vector<Patch> patches = readPatches(argv[1]);
    if (patches.empty()) fail("no patch rows");
    if (!hasPatch(patches, "Freeze")) fail("missing Freeze row in patches.tsv");
    if (!hasPatch(patches, "Tape")) fail("missing Tape row in patches.tsv");

    std::vector<Metrics> all;
    for (const Patch& p : patches) {
        all.push_back(renderPatch(p));
    }

    bool allPass = true;
    std::ofstream out(argv[2]);
    if (!out) fail(std::string("cannot write ") + argv[2]);
    out << "name\tgrain_rate_hz\tenv_mean_db\tenv_std_db\tcentroid_mean_hz\tcentroid_cv"
           "\tdistinct_from_all\tfreeze_static\n";
    for (size_t i = 0; i < all.size(); i++) {
        bool distinctFromAll = true;
        for (size_t j = 0; j < all.size(); j++) {
            if (i != j && !distinct(all[i], all[j])) distinctFromAll = false;
        }
        const bool isFreeze = patches[i].name == "Freeze";
        const bool frozenOk = all[i].centroidCv < kFreezeCv && all[i].envStdDb < kFreezeEnvStdDb;
        if (!distinctFromAll) allPass = false;
        if (isFreeze && !frozenOk) allPass = false;
        out << all[i].name << '\t' << all[i].grainRateHz << '\t' << all[i].envMeanDb << '\t'
            << all[i].envStdDb << '\t' << all[i].centroidMeanHz << '\t' << all[i].centroidCv
            << '\t' << (distinctFromAll ? "yes" : "no") << '\t'
            << (isFreeze ? (frozenOk ? "yes" : "no") : "-") << '\n';
    }
    out << "VERDICT\t" << (allPass ? "PASS" : "FAIL") << '\n';
    std::printf("granulator-patches: VERDICT %s\n", allPass ? "PASS" : "FAIL");
    return 0;
}
