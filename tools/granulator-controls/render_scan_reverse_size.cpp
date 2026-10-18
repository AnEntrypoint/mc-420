#include "sampler.h"

#include <algorithm>
#include <cmath>
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
constexpr int kEnvWin = 480;
constexpr double kPi = 3.14159265358979323846;
constexpr double kSourceHz = 440.0;
constexpr double kScanDb = 3.0;
constexpr double kReverseDb = 2.0;
constexpr double kGapDelta = 0.25;

enum class Shape { Constant, Ramp, Decay };

struct Setting {
    float grainMs, grainRateHz, pitchSprayCents, posJitterMs, scanRate;
    float reverseProb, envShape, liveMix, toneNorm;
};

[[noreturn]] void fail(const std::string& why) {
    std::fprintf(stderr, "granulator-scan-reverse-size: FAIL: %s\n", why.c_str());
    std::exit(1);
}

double sourceAmp(Shape shape, double t) {
    switch (shape) {
        case Shape::Constant: return 0.3;
        case Shape::Ramp: return 0.05 + 0.25 * (t / 3.0);
        case Shape::Decay: return 0.3 * std::exp(-t / 0.5);
    }
    return 0.3;
}

void loadSource(aloop::Sampler& s, Shape shape) {
    std::vector<int> scratch(kBlock, 0);
    std::vector<int> in(kBlock);
    s.pushEvent(aloop::Sampler::EV_REC_START, -1, 0);
    s.renderInto(scratch.data(), kBlock);
    for (int pos = 0; pos < kSourceFrames; pos += kBlock) {
        for (int i = 0; i < kBlock; i++) {
            const double t = static_cast<double>(pos + i) / kSR;
            in[i] = static_cast<int>(32767.0 * sourceAmp(shape, t) * std::sin(2.0 * kPi * kSourceHz * t));
        }
        s.captureBlock(in.data(), kBlock);
    }
    s.pushEvent(aloop::Sampler::EV_REC_STOP, -1, 0);
    s.renderInto(scratch.data(), kBlock);
    if (!s.chromaticLoaded()) fail("source did not load into the sampler");
}

std::vector<double> render(const Setting& st, Shape shape) {
    aloop::Sampler s;
    loadSource(s, shape);
    s.setGranulatorEnabled(true);
    s.setGrainPatch(st.grainMs, st.grainRateHz, st.pitchSprayCents, st.posJitterMs, st.scanRate,
                    st.reverseProb, st.envShape, st.liveMix, st.toneNorm);
    s.setGrainFreeze(0.0f);
    s.setGrainTransposeCents(0.0f);
    s.setGrainPitchQuantize(0);
    s.pushEvent(aloop::Sampler::EV_NOTE_ON, 60, 127);
    std::vector<double> y(kHeldFrames, 0.0);
    std::vector<int> buf(kBlock, 0);
    for (int pos = 0; pos < kHeldFrames; pos += kBlock) {
        std::fill(buf.begin(), buf.end(), 0);
        s.renderInto(buf.data(), kBlock);
        for (int i = 0; i < kBlock; i++) y[pos + i] = buf[i] / 32768.0;
    }
    return y;
}

double rmsBetween(const std::vector<double>& y, double fromS, double toS) {
    const size_t a = static_cast<size_t>(fromS * kSR);
    const size_t b = std::min(static_cast<size_t>(toS * kSR), y.size());
    if (b <= a) fail("empty figure: window outside the render");
    double ss = 0.0;
    for (size_t i = a; i < b; i++) ss += y[i] * y[i];
    const double rms = std::sqrt(ss / static_cast<double>(b - a));
    if (!(rms > 1e-12)) fail("empty figure: zero reference level");
    return rms;
}

double levelChangeDb(const std::vector<double>& y) {
    return 20.0 * std::log10(rmsBetween(y, 2.5, 3.0) / rmsBetween(y, 1.0, 1.5));
}

double gapFraction(const std::vector<double>& y) {
    std::vector<double> rms;
    for (size_t start = static_cast<size_t>(1.0 * kSR); start + kEnvWin <= static_cast<size_t>(5.0 * kSR); start += kEnvWin) {
        double ss = 0.0;
        for (int i = 0; i < kEnvWin; i++) ss += y[start + i] * y[start + i];
        rms.push_back(std::sqrt(ss / kEnvWin));
    }
    if (rms.size() < 10) fail("empty figure: too few windows for the gap fraction");
    std::vector<double> sorted = rms;
    std::sort(sorted.begin(), sorted.end());
    const double p90 = sorted[(sorted.size() * 9) / 10];
    if (!(p90 > 1e-12)) fail("empty figure: zero 90th-percentile level");
    size_t gaps = 0;
    for (double r : rms) {
        if (r < 0.1 * p90) gaps++;
    }
    return static_cast<double>(gaps) / static_cast<double>(rms.size());
}

Setting base() {
    return Setting{200.0f, 8.0f, 0.0f, 0.0f, 1.0f, 0.0f, 0.5f, 0.0f, 1.0f};
}

}

int main(int argc, char** argv) {
    if (argc != 2) {
        std::fprintf(stderr, "usage: render_scan_reverse_size <out.tsv>\n");
        return 2;
    }
    std::ofstream out(argv[1]);
    if (!out) fail(std::string("cannot write ") + argv[1]);
    out << "control\tlow_setting\thigh_setting\tlow_metric\thigh_metric\tmetric\tthreshold\tverdict\n";

    bool allPass = true;

    Setting scan0 = base();
    scan0.scanRate = 0.0f;
    Setting scan1 = base();
    scan1.scanRate = 1.0f;
    const double c0 = levelChangeDb(render(scan0, Shape::Ramp));
    const double c1 = levelChangeDb(render(scan1, Shape::Ramp));
    const double scanDiff = c1 - c0;
    const bool scanPass = scanDiff >= kScanDb;
    if (!scanPass) allPass = false;
    out << "scan\t0\t1.0\t" << c0 << '\t' << c1 << "\tlevel change difference dB\t>= 3.0\t"
        << (scanPass ? "PASS" : "FAIL") << '\n';

    Setting rev0 = base();
    rev0.reverseProb = 0.0f;
    Setting rev1 = base();
    rev1.reverseProb = 1.0f;
    const std::vector<double> yr0 = render(rev0, Shape::Decay);
    const std::vector<double> yr1 = render(rev1, Shape::Decay);
    const double revDb = 20.0 * std::log10(rmsBetween(yr1, 1.0, 2.5) / rmsBetween(yr0, 1.0, 2.5));
    const bool revPass = revDb >= kReverseDb;
    if (!revPass) allPass = false;
    out << "reverse\t0\t1.0\t" << rmsBetween(yr0, 1.0, 2.5) << '\t' << rmsBetween(yr1, 1.0, 2.5)
        << "\tRMS ratio dB\t>= 2.0\t" << (revPass ? "PASS" : "FAIL") << '\n';

    Setting g20 = base();
    g20.grainMs = 20.0f;
    Setting g200 = base();
    g200.grainMs = 200.0f;
    const double gap20 = gapFraction(render(g20, Shape::Constant));
    const double gap200 = gapFraction(render(g200, Shape::Constant));
    const bool sizePass = (gap20 - gap200) >= kGapDelta;
    if (!sizePass) allPass = false;
    out << "grain_size\t20\t200\t" << gap20 << '\t' << gap200 << "\tgap fraction difference\t>= 0.25\t"
        << (sizePass ? "PASS" : "FAIL") << '\n';

    out << "VERDICT\t" << (allPass ? "PASS" : "FAIL") << '\n';
    std::printf("granulator-scan-reverse-size: VERDICT %s\n", allPass ? "PASS" : "FAIL");
    return 0;
}
