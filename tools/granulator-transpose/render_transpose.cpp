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
constexpr int kFftN = 16384;
constexpr double kPi = 3.14159265358979323846;
constexpr double kSourceHz = 440.0;
constexpr double kThresholdCents = 20.0;

const int kTransposeCents[] = {0, -1200, 700};
const double kGrainRatesHz[] = {8.0, 35.0, 70.0};

[[noreturn]] void fail(const std::string& why) {
    std::fprintf(stderr, "granulator-transpose: FAIL: %s\n", why.c_str());
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

double measuredHz(const std::vector<double>& y) {
    std::vector<double> power(kFftN / 2 + 1, 0.0);
    std::vector<std::complex<double>> a(kFftN);
    int windows = 0;
    for (size_t start = 0; start + kFftN <= y.size(); start += kFftN / 2) {
        for (int i = 0; i < kFftN; i++) {
            const double w = 0.5 - 0.5 * std::cos(2.0 * kPi * i / (kFftN - 1));
            a[i] = std::complex<double>(y[start + i] * w, 0.0);
        }
        fft(a);
        for (int k = 0; k <= kFftN / 2; k++) power[k] += std::norm(a[k]);
        windows++;
    }
    if (windows == 0) fail("empty figure: no FFT windows");
    const int lo = static_cast<int>(std::ceil(100.0 * kFftN / kSR));
    const int hi = static_cast<int>(std::floor(2000.0 * kFftN / kSR));
    int peak = -1;
    double peakPow = 0.0;
    for (int k = lo; k <= hi; k++) {
        if (power[k] > peakPow) {
            peakPow = power[k];
            peak = k;
        }
    }
    if (peak < 1 || peakPow <= 1e-18) fail("empty figure: no spectral peak in 100 to 2000 Hz");
    const double alpha = std::log(power[peak - 1]);
    const double beta = std::log(power[peak]);
    const double gamma = std::log(power[peak + 1]);
    const double denom = alpha - 2.0 * beta + gamma;
    const double delta = denom == 0.0 ? 0.0 : 0.5 * (alpha - gamma) / denom;
    const double hz = (peak + delta) * static_cast<double>(kSR) / kFftN;
    if (std::isnan(hz)) fail("NaN in measured frequency");
    return hz;
}

}

int main(int argc, char** argv) {
    if (argc != 2) {
        std::fprintf(stderr, "usage: render_transpose <out.tsv>\n");
        return 2;
    }
    std::ofstream out(argv[1]);
    if (!out) fail(std::string("cannot write ") + argv[1]);
    out << "transpose_cents\tgrain_rate_hz\texpected_hz\tmeasured_hz\terror_cents\tverdict\n";

    bool allPass = true;
    for (int cents : kTransposeCents) {
        for (double rate : kGrainRatesHz) {
            aloop::Sampler s;
            loadSource(s);
            s.setGranulatorEnabled(true);
            s.setGrainPatch(90.0f, static_cast<float>(rate), 0.0f, 0.0f, 1.0f, 0.0f, 0.5f, 0.0f, 1.0f);
            s.setGrainFreeze(0.0f);
            s.setGrainTransposeCents(static_cast<float>(cents));
            s.setGrainPitchQuantize(0);
            s.pushEvent(aloop::Sampler::EV_NOTE_ON, 60, 127);

            std::vector<double> y(kHeldFrames, 0.0);
            std::vector<int> buf(kBlock, 0);
            for (int pos = 0; pos < kHeldFrames; pos += kBlock) {
                std::fill(buf.begin(), buf.end(), 0);
                s.renderInto(buf.data(), kBlock);
                for (int i = 0; i < kBlock; i++) y[pos + i] = buf[i] / 32768.0;
            }

            const std::vector<double> settled(y.begin() + kSettleFrames, y.end());
            const double expected = kSourceHz * std::pow(2.0, cents / 1200.0);
            const double measured = measuredHz(settled);
            const double err = 1200.0 * std::log2(measured / expected);
            if (std::isnan(err)) fail("NaN in cents error");
            const bool pass = std::fabs(err) <= kThresholdCents;
            if (!pass) allPass = false;
            out << cents << '\t' << rate << '\t' << expected << '\t' << measured << '\t' << err
                << '\t' << (pass ? "PASS" : "FAIL") << '\n';
            std::fprintf(stderr, "granulator-transpose: %d cents, %.0f Hz grains: expected %.2f measured %.2f error %+.2f cents\n",
                         cents, rate, expected, measured, err);
        }
    }
    out << "VERDICT\t" << (allPass ? "PASS" : "FAIL") << '\n';
    std::printf("granulator-transpose: VERDICT %s\n", allPass ? "PASS" : "FAIL");
    return 0;
}
