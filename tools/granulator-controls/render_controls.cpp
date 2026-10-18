#include "sampler.h"

#include <algorithm>
#include <cmath>
#include <complex>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <string>
#include <vector>

namespace {

constexpr int kSR = 48000;
constexpr int kBlock = 480;
constexpr int kSourceFrames = 3 * kSR;
constexpr int kHeldFrames = 5 * kSR;
constexpr int kSettleFrames = 1 * kSR;
constexpr int kEnvWin = 480;
constexpr int kFftN = 16384;
constexpr double kPi = 3.14159265358979323846;
constexpr double kSourceHz = 440.0;
constexpr double kDensityRatio = 2.0;
constexpr double kSprayRatio = 1.5;
constexpr double kEnvShapeDb = 2.0;

struct Setting {
    float grainMs, grainRateHz, pitchSprayCents, posJitterMs, scanRate;
    float reverseProb, envShape, liveMix, toneNorm;
};

[[noreturn]] void fail(const std::string& why) {
    std::fprintf(stderr, "granulator-controls: FAIL: %s\n", why.c_str());
    std::exit(1);
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

void loadSource(aloop::Sampler& s) {
    std::vector<int> scratch(kBlock, 0);
    std::vector<int> in(kBlock);
    s.pushEvent(aloop::Sampler::EV_REC_START, -1, 0);
    s.renderInto(scratch.data(), kBlock);
    for (int pos = 0; pos < kSourceFrames; pos += kBlock) {
        for (int i = 0; i < kBlock; i++) {
            const double t = static_cast<double>(pos + i) / kSR;
            in[i] = static_cast<int>(0.3 * 32767.0 * std::sin(2.0 * kPi * kSourceHz * t));
        }
        s.captureBlock(in.data(), kBlock);
    }
    s.pushEvent(aloop::Sampler::EV_REC_STOP, -1, 0);
    s.renderInto(scratch.data(), kBlock);
    if (!s.chromaticLoaded()) fail("source sine did not load into the sampler");
}

std::vector<double> render(const Setting& st, float transposeCents) {
    aloop::Sampler s;
    loadSource(s);
    s.setGranulatorEnabled(true);
    s.setGrainPatch(st.grainMs, st.grainRateHz, st.pitchSprayCents, st.posJitterMs, st.scanRate,
                    st.reverseProb, st.envShape, st.liveMix, st.toneNorm);
    s.setGrainFreeze(0.0f);
    s.setGrainTransposeCents(transposeCents);
    s.setGrainPitchQuantize(0);
    s.pushEvent(aloop::Sampler::EV_NOTE_ON, 60, 127);
    std::vector<double> y(kHeldFrames, 0.0);
    std::vector<int> buf(kBlock, 0);
    for (int pos = 0; pos < kHeldFrames; pos += kBlock) {
        std::fill(buf.begin(), buf.end(), 0);
        s.renderInto(buf.data(), kBlock);
        for (int i = 0; i < kBlock; i++) y[pos + i] = buf[i] / 32768.0;
    }
    return std::vector<double>(y.begin() + kSettleFrames, y.end());
}

double grainRate(const std::vector<double>& w) {
    std::vector<double> envDb;
    for (size_t start = 0; start + kEnvWin <= w.size(); start += kEnvWin) {
        double ss = 0.0;
        for (int i = 0; i < kEnvWin; i++) ss += w[start + i] * w[start + i];
        envDb.push_back(20.0 * std::log10(std::max(std::sqrt(ss / kEnvWin), 1e-9)));
    }
    if (envDb.size() < 3) fail("empty figure: too few envelope windows");
    double mean = 0.0;
    for (double d : envDb) mean += d;
    mean /= static_cast<double>(envDb.size());
    int peaks = 0;
    for (size_t k = 1; k + 1 < envDb.size(); k++) {
        if (envDb[k] > mean && envDb[k] > envDb[k - 1] && envDb[k] >= envDb[k + 1]) peaks++;
    }
    return peaks / (static_cast<double>(w.size()) / kSR);
}

double crestDb(const std::vector<double>& w) {
    std::vector<double> envDb;
    for (size_t start = 0; start + kEnvWin <= w.size(); start += kEnvWin) {
        double ss = 0.0;
        for (int i = 0; i < kEnvWin; i++) ss += w[start + i] * w[start + i];
        envDb.push_back(20.0 * std::log10(std::max(std::sqrt(ss / kEnvWin), 1e-9)));
    }
    if (envDb.empty()) fail("empty figure: no envelope windows");
    double mean = 0.0;
    double peak = -1e9;
    for (double d : envDb) {
        mean += d;
        peak = std::max(peak, d);
    }
    mean /= static_cast<double>(envDb.size());
    return peak - mean;
}

double spectralBandwidth(const std::vector<double>& w) {
    std::vector<std::complex<double>> a(kFftN);
    double sum = 0.0;
    int windows = 0;
    for (size_t start = 0; start + kFftN <= w.size(); start += kFftN / 2) {
        for (int i = 0; i < kFftN; i++) {
            const double win = 0.5 - 0.5 * std::cos(2.0 * kPi * i / (kFftN - 1));
            a[i] = std::complex<double>(w[start + i] * win, 0.0);
        }
        fft(a);
        double pSum = 0.0, cen = 0.0;
        for (int k = 1; k <= kFftN / 2; k++) {
            const double f = static_cast<double>(k) * kSR / kFftN;
            const double p = std::norm(a[k]);
            pSum += p;
            cen += p * f;
        }
        if (pSum <= 1e-18) continue;
        cen /= pSum;
        double var = 0.0;
        for (int k = 1; k <= kFftN / 2; k++) {
            const double f = static_cast<double>(k) * kSR / kFftN;
            var += std::norm(a[k]) * (f - cen) * (f - cen);
        }
        sum += std::sqrt(var / pSum);
        windows++;
    }
    if (windows == 0) fail("empty figure: no spectral energy");
    return sum / windows;
}

Setting base() {
    return Setting{200.0f, 8.0f, 0.0f, 0.0f, 1.0f, 0.0f, 0.5f, 0.0f, 1.0f};
}

}

int main(int argc, char** argv) {
    if (argc != 2) {
        std::fprintf(stderr, "usage: render_controls <out.tsv>\n");
        return 2;
    }
    std::ofstream out(argv[1]);
    if (!out) fail(std::string("cannot write ") + argv[1]);
    out << "control\tlow_setting\thigh_setting\tlow_metric\thigh_metric\tmetric\tthreshold\tverdict\n";

    bool allPass = true;

    Setting lo = base();
    lo.grainRateHz = 4.0f;
    Setting hi = base();
    hi.grainRateHz = 40.0f;
    const double rLo = grainRate(render(lo, 0.0f));
    const double rHi = grainRate(render(hi, 0.0f));
    if (!(rLo > 0.0)) fail("empty figure: density base rate is zero");
    const double densityRatio = rHi / rLo;
    const bool densityPass = densityRatio >= kDensityRatio;
    if (!densityPass) allPass = false;
    out << "density\t4\t40\t" << rLo << '\t' << rHi << "\tpeaks per second ratio\t>= 2.0\t"
        << (densityPass ? "PASS" : "FAIL") << '\n';

    Setting sLo = base();
    sLo.pitchSprayCents = 0.0f;
    Setting sHi = base();
    sHi.pitchSprayCents = 200.0f;
    const double bLo = spectralBandwidth(render(sLo, 0.0f));
    const double bHi = spectralBandwidth(render(sHi, 0.0f));
    if (!(bLo > 0.0)) fail("empty figure: spray base bandwidth is zero");
    const double sprayRatio = bHi / bLo;
    const bool sprayPass = sprayRatio >= kSprayRatio;
    if (!sprayPass) allPass = false;
    out << "spray\t0\t200\t" << bLo << '\t' << bHi << "\tbandwidth ratio\t>= 1.5\t"
        << (sprayPass ? "PASS" : "FAIL") << '\n';

    Setting eLo = base();
    eLo.envShape = 0.1f;
    Setting eHi = base();
    eHi.envShape = 0.9f;
    const double cLo = crestDb(render(eLo, 0.0f));
    const double cHi = crestDb(render(eHi, 0.0f));
    const bool envPass = std::fabs(cHi - cLo) >= kEnvShapeDb;
    if (!envPass) allPass = false;
    out << "envshape\t0.1\t0.9\t" << cLo << '\t' << cHi << "\tcrest dB difference\t>= 2.0\t"
        << (envPass ? "PASS" : "FAIL") << '\n';

    out << "VERDICT\t" << (allPass ? "PASS" : "FAIL") << '\n';
    std::printf("granulator-controls: VERDICT %s\n", allPass ? "PASS" : "FAIL");
    return 0;
}
