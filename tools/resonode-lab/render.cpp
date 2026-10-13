#include "faust_min.h"

#include <algorithm>
#include <cmath>
#include <complex>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "resonode_gen.cpp"

namespace {

const int kSampleRate = 48000;
const int kBlockSize = 64;

struct WavFile {
    int sampleRate = 48000;
    int channels = 1;
    int bits = 16;
    int format = 1;
    std::vector<float> mono;
};

unsigned long rd32(const unsigned char* p)
{
    return (unsigned long)p[0] | ((unsigned long)p[1] << 8) | ((unsigned long)p[2] << 16) | ((unsigned long)p[3] << 24);
}

unsigned long rd16(const unsigned char* p)
{
    return (unsigned long)p[0] | ((unsigned long)p[1] << 8);
}

bool readWav(const std::string& path, WavFile& w)
{
    FILE* f = std::fopen(path.c_str(), "rb");
    if (!f) return false;
    unsigned char hdr[12];
    if (std::fread(hdr, 1, 12, f) != 12) { std::fclose(f); return false; }
    if (std::memcmp(hdr, "RIFF", 4) != 0 || std::memcmp(hdr + 8, "WAVE", 4) != 0) { std::fclose(f); return false; }

    std::vector<unsigned char> raw;
    bool haveFmt = false;
    for (;;) {
        unsigned char ch[8];
        if (std::fread(ch, 1, 8, f) != 8) break;
        unsigned long sz = rd32(ch + 4);
        if (std::memcmp(ch, "fmt ", 4) == 0) {
            std::vector<unsigned char> fb(sz > 0 ? sz : 1);
            if (std::fread(fb.data(), 1, sz, f) != sz) break;
            w.format = (int)rd16(fb.data());
            w.channels = (int)rd16(fb.data() + 2);
            w.sampleRate = (int)rd32(fb.data() + 4);
            if (sz >= 16) w.bits = (int)rd16(fb.data() + 14);
            haveFmt = true;
        } else if (std::memcmp(ch, "data", 4) == 0) {
            raw.resize(sz);
            if (std::fread(raw.data(), 1, sz, f) != sz) break;
            if ((sz & 1) == 1) { unsigned char pad; std::fread(&pad, 1, 1, f); }
        } else {
            if (std::fseek(f, (long)sz + (sz & 1), SEEK_CUR) != 0) break;
        }
    }
    std::fclose(f);
    if (!haveFmt || raw.empty()) return false;

    const int bytesPerSample = w.bits / 8;
    const size_t frames = raw.size() / (size_t)(bytesPerSample * (w.channels > 0 ? w.channels : 1));
    w.mono.resize(frames);
    for (size_t i = 0; i < frames; i++) {
        double acc = 0.0;
        for (int c = 0; c < w.channels; c++) {
            const size_t off = (i * (size_t)w.channels + (size_t)c) * (size_t)bytesPerSample;
            double v = 0.0;
            if (w.format == 3 && w.bits == 32) {
                float fv = 0.0f;
                std::memcpy(&fv, raw.data() + off, 4);
                v = fv;
            } else if (w.bits == 16) {
                short sv = (short)rd16(raw.data() + off);
                v = sv / 32768.0;
            } else if (w.bits == 32) {
                int sv = (int)rd32(raw.data() + off);
                v = sv / 2147483648.0;
            } else if (w.bits == 8) {
                v = (raw[off] - 128) / 128.0;
            }
            acc += v;
        }
        w.mono[i] = (float)(acc / (w.channels > 0 ? w.channels : 1));
    }
    return true;
}

unsigned long g_rngState = 42;

float rndUniform()
{
    g_rngState ^= g_rngState << 13;
    g_rngState ^= g_rngState >> 7;
    g_rngState ^= g_rngState << 17;
    const unsigned long v = g_rngState >> 11;
    return (float)((double)v / 9007199254740992.0 * 2.0 - 1.0);
}

void fft(std::vector<double>& re, std::vector<double>& im, bool inverse)
{
    const size_t n = re.size();
    for (size_t i = 1, j = 0; i < n; i++) {
        size_t bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            std::swap(re[i], re[j]);
            std::swap(im[i], im[j]);
        }
    }
    for (size_t len = 2; len <= n; len <<= 1) {
        const double ang = (inverse ? 2.0 : -2.0) * 3.14159265358979323846 / (double)len;
        for (size_t i = 0; i < n; i += len) {
            for (size_t k = 0; k < len / 2; k++) {
                const double wr = std::cos(ang * (double)k);
                const double wi = std::sin(ang * (double)k);
                const double ur = re[i + k];
                const double ui = im[i + k];
                const double vr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi;
                const double vi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
                re[i + k] = ur + vr;
                im[i + k] = ui + vi;
                re[i + k + len / 2] = ur - vr;
                im[i + k + len / 2] = ui - vi;
            }
        }
    }
    if (inverse) {
        for (size_t i = 0; i < n; i++) { re[i] /= (double)n; im[i] /= (double)n; }
    }
}

double rmsRange(const std::vector<float>& x, int fromSample, int toSample)
{
    if (fromSample < 0) fromSample = 0;
    if (toSample > (int)x.size()) toSample = (int)x.size();
    if (toSample <= fromSample) return 0.0;
    double acc = 0.0;
    for (int i = fromSample; i < toSample; i++) acc += (double)x[i] * (double)x[i];
    return std::sqrt(acc / (double)(toSample - fromSample));
}

double goertzelMag(const std::vector<float>& x, int fromSample, int toSample, double freqHz)
{
    const int n = toSample - fromSample;
    if (n <= 0) return 0.0;
    const double w = 2.0 * 3.14159265358979323846 * freqHz / (double)kSampleRate;
    const double coeff = 2.0 * std::cos(w);
    double s1 = 0.0, s2 = 0.0;
    for (int i = fromSample; i < toSample; i++) {
        const double s = (double)x[i] + coeff * s1 - s2;
        s2 = s1;
        s1 = s;
    }
    const double real = s1 - s2 * std::cos(w);
    const double imag = s2 * std::sin(w);
    return std::sqrt(real * real + imag * imag) / (double)n * 2.0;
}

struct Spectrum {
    std::vector<double> mag;
    double binHz = 0.0;
};

Spectrum spectrumOf(const std::vector<float>& x, int fromSample, int toSample, int fftSize)
{
    Spectrum s;
    s.binHz = (double)kSampleRate / (double)fftSize;
    std::vector<double> re(fftSize, 0.0), im(fftSize, 0.0);
    const int n = std::min(fftSize, toSample - fromSample);
    for (int i = 0; i < n; i++) {
        const double w = 0.5 - 0.5 * std::cos(2.0 * 3.14159265358979323846 * (double)i / (double)(n - 1));
        re[i] = (double)x[fromSample + i] * w;
    }
    fft(re, im, false);
    s.mag.resize(fftSize / 2);
    for (size_t i = 0; i < s.mag.size(); i++) s.mag[i] = std::sqrt(re[i] * re[i] + im[i] * im[i]);
    return s;
}

double bandEnergy(const Spectrum& s, double loHz, double hiHz)
{
    double acc = 0.0;
    for (size_t i = 0; i < s.mag.size(); i++) {
        const double f = (double)i * s.binHz;
        if (f >= loHz && f < hiHz) acc += s.mag[i] * s.mag[i];
    }
    return acc;
}

double spectralCentroid(const Spectrum& s)
{
    double num = 0.0, den = 0.0;
    for (size_t i = 1; i < s.mag.size(); i++) {
        const double f = (double)i * s.binHz;
        num += f * s.mag[i];
        den += s.mag[i];
    }
    return den > 0.0 ? num / den : 0.0;
}

double decayToMinus24dB_ms(const std::vector<float>& x)
{
    const int hop = kSampleRate / 100;
    int peakBlock = 0;
    double peakRms = 0.0;
    std::vector<double> env;
    for (size_t start = 0; start + (size_t)hop <= x.size(); start += (size_t)hop) {
        const double r = rmsRange(x, (int)start, (int)start + hop);
        env.push_back(r);
        if (r > peakRms) { peakRms = r; peakBlock = (int)env.size() - 1; }
    }
    const double target = peakRms * std::pow(10.0, -24.0 / 20.0);
    for (size_t i = (size_t)peakBlock; i < env.size(); i++) {
        if (env[i] < target) return (double)i * 10.0;
    }
    return -1.0;
}

struct Case {
    std::string name;
    float position = 0.35f;
    float tone = 6000.0f;
    float decayTime = 1.2f;
    float damping = 0.85f;
    float stretch = 0.0f;
    float collision = 0.0f;
    float outLevel = 25.0f;
    float couple = 0.15f;
    float inputAmt = 0.5f;
    float malletAmt = 0.65f;
    float bowAmt = 0.35f;
    float hardness = 0.5f;
    float shapeString = 1.0f;
    float shapeBell = 0.0f;
    float shapePlate = 0.0f;
    float shapeMembrane = 0.0f;
    float shapeBar = 0.0f;
    int note = 60;
    float vel = 1.0f;
    int voiceCount = 1;
    double durationSec = 3.0;
    std::string excitation = "burst";
    std::string wavPath;
    std::string specPath;
    std::string audioPath;
};

std::vector<float> makeExcitation(const Case& c, int n)
{
    std::vector<float> x((size_t)n, 0.0f);
    g_rngState = 42;
    if (c.excitation == "burst") {
        const int burstSamples = (int)(0.015 * kSampleRate);
        for (int i = 0; i < burstSamples && i < n; i++) {
            const double t = (double)i / (double)kSampleRate;
            double env = 1.0;
            if (t < 0.001) env = t / 0.001;
            else env = std::exp(-(t - 0.001) / 0.003);
            x[i] = (float)(0.9 * (double)rndUniform() * env);
        }
    } else if (c.excitation == "sustain") {
        for (int i = 0; i < n; i++) x[i] = (float)(0.3 * (double)rndUniform());
    } else if (c.excitation == "silence") {
    } else if (c.excitation == "wav") {
        WavFile w;
        if (!readWav(c.wavPath, w)) {
            std::fprintf(stderr, "render: cannot read wav %s\n", c.wavPath.c_str());
            std::exit(2);
        }
        for (int i = 0; i < n && i < (int)w.mono.size(); i++) x[i] = w.mono[i];
    } else {
        std::fprintf(stderr, "render: unknown excitation %s\n", c.excitation.c_str());
        std::exit(2);
    }
    return x;
}

std::vector<float> runCase(const Case& c, const std::vector<float>& excite)
{
    ResonodeDsp dsp;
    ZoneUI ui;
    dsp.buildUserInterface(&ui);
    dsp.init(kSampleRate);

    ui.set("fx/resonode/position", c.position);
    ui.set("fx/resonode/tone", c.tone);
    ui.set("fx/resonode/decay", c.decayTime);
    ui.set("fx/resonode/damping", c.damping);
    ui.set("fx/resonode/stretch", c.stretch);
    ui.set("fx/resonode/collision", c.collision);
    ui.set("fx/resonode/level", c.outLevel);
    ui.set("fx/resonode/couple", c.couple);
    ui.set("fx/resonode/input", c.inputAmt);
    ui.set("fx/resonode/mallet", c.malletAmt);
    ui.set("fx/resonode/bow", c.bowAmt);
    ui.set("fx/resonode/hardness", c.hardness);
    ui.set("fx/resonode/shape/string", c.shapeString);
    ui.set("fx/resonode/shape/bell", c.shapeBell);
    ui.set("fx/resonode/shape/plate", c.shapePlate);
    ui.set("fx/resonode/shape/membrane", c.shapeMembrane);
    ui.set("fx/resonode/shape/bar", c.shapeBar);

    const int voices = std::max(1, std::min(4, c.voiceCount));
    for (int v = 0; v < voices; v++) {
        char label[64];
        std::snprintf(label, sizeof(label), "fx/resonodevoice%d/note", v);
        ui.set(label, (float)(c.note + v * 7));
        std::snprintf(label, sizeof(label), "fx/resonodevoice%d/vel", v);
        ui.set(label, c.vel);
        std::snprintf(label, sizeof(label), "fx/resonodevoice%d/gate", v);
        ui.set(label, 1.0f);
    }

    const int n = (int)excite.size();
    std::vector<float> out((size_t)n, 0.0f);
    std::vector<float> inBuf((size_t)kBlockSize, 0.0f);
    std::vector<float> outBuf((size_t)kBlockSize, 0.0f);
    float* inPtr[1] = { inBuf.data() };
    float* outPtr[1] = { outBuf.data() };

    for (int off = 0; off < n; off += kBlockSize) {
        const int m = std::min(kBlockSize, n - off);
        for (int i = 0; i < m; i++) inBuf[i] = excite[(size_t)(off + i)];
        for (int i = m; i < kBlockSize; i++) inBuf[i] = 0.0f;
        dsp.compute(kBlockSize, inPtr, outPtr);
        for (int i = 0; i < m; i++) out[(size_t)(off + i)] = outBuf[i];
    }
    return out;
}

void writeMonoWav(const std::string& path, const std::vector<float>& x)
{
    FILE* f = std::fopen(path.c_str(), "wb");
    if (!f) return;
    const unsigned long dataBytes = (unsigned long)x.size() * 2ul;
    const unsigned long riff = 36ul + dataBytes;
    auto w32 = [f](unsigned long v) {
        unsigned char b[4] = { (unsigned char)(v & 255), (unsigned char)((v >> 8) & 255), (unsigned char)((v >> 16) & 255), (unsigned char)((v >> 24) & 255) };
        std::fwrite(b, 1, 4, f);
    };
    auto w16 = [f](unsigned long v) {
        unsigned char b[2] = { (unsigned char)(v & 255), (unsigned char)((v >> 8) & 255) };
        std::fwrite(b, 1, 2, f);
    };
    std::fwrite("RIFF", 1, 4, f);
    w32(riff);
    std::fwrite("WAVEfmt ", 1, 8, f);
    w32(16);
    w16(1);
    w16(1);
    w32(48000);
    w32(96000);
    w16(2);
    w16(16);
    std::fwrite("data", 1, 4, f);
    w32(dataBytes);
    for (size_t i = 0; i < x.size(); i++) {
        double v = (double)x[i];
        if (v > 1.0) v = 1.0;
        if (v < -1.0) v = -1.0;
        const short s = (short)(v * 32767.0);
        w16((unsigned long)(unsigned short)s);
    }
    std::fclose(f);
}

void writeSpectrumCsv(const std::string& path, const Spectrum& s)
{
    FILE* f = std::fopen(path.c_str(), "wb");
    if (!f) return;
    std::fprintf(f, "bin_hz,mag\n");
    for (size_t i = 0; i < s.mag.size(); i++) std::fprintf(f, "%.3f,%.9g\n", (double)i * s.binHz, s.mag[i]);
    std::fclose(f);
}

void report(const Case& c, const std::vector<float>& y)
{
    const int n = (int)y.size();
    double peak = 0.0, acc = 0.0;
    int clipped = 0, saturated = 0;
    for (int i = 0; i < n; i++) {
        const double a = std::fabs((double)y[i]);
        if (a > peak) peak = a;
        acc += a * a;
        if (a > 0.98) clipped++;
        if (a > 0.70) saturated++;
    }
    const double rms = std::sqrt(acc / (double)n);

    const int wFrom = (int)(0.10 * kSampleRate);
    const int wTo = (int)(0.40 * kSampleRate);
    const Spectrum spec = spectrumOf(y, wFrom, wTo, 16384);
    const Spectrum specLate = spectrumOf(y, (int)(2.0 * kSampleRate), (int)(2.3 * kSampleRate), 16384);
    const double centroid = spectralCentroid(spec);
    const double total = bandEnergy(spec, 0.0, 1.0e9);

    const double f0 = 440.0 * std::pow(2.0, ((double)c.note - 69.0) / 12.0);
    const double lowEnergy = bandEnergy(spec, 0.0, 1.5 * f0);
    const double lowRatio = total > 0.0 ? lowEnergy / total : 0.0;
    const double band1 = bandEnergy(spec, 0.0, 120.0);
    const double band2 = bandEnergy(spec, 120.0, 500.0);
    const double band3 = bandEnergy(spec, 500.0, 2000.0);
    const double band4 = bandEnergy(spec, 2000.0, 8000.0);

    double peakBinMag = 0.0;
    for (size_t i = 1; i < spec.mag.size(); i++) if (spec.mag[i] > peakBinMag) peakBinMag = spec.mag[i];
    const double f0MagDb = (f0 > 0.0 && peakBinMag > 0.0)
        ? 20.0 * std::log10(goertzelMag(y, wFrom, wTo, f0) / (peakBinMag / 8192.0) + 1e-12)
        : 0.0;

    const double transientRatio = rmsRange(y, 0, (int)(0.050 * kSampleRate)) /
                                  std::max(1e-12, rmsRange(y, (int)(0.050 * kSampleRate), (int)(0.500 * kSampleRate)));
    const double sustainRatio = rmsRange(y, (int)(0.500 * kSampleRate), (int)(0.600 * kSampleRate)) /
                                std::max(1e-12, rmsRange(y, (int)(0.050 * kSampleRate), (int)(0.150 * kSampleRate)));
    const double decayMs = decayToMinus24dB_ms(y);

    std::printf("case=%s note=%d vel=%.3f voices=%d exc=%s\n", c.name.c_str(), c.note, c.vel, c.voiceCount, c.excitation.c_str());
    std::printf("  peak=%.6f rms=%.6f crest_db=%.2f clip_frac=%.4f sat_frac=%.4f\n",
                peak, rms, 20.0 * std::log10(peak / std::max(1e-12, rms)),
                (double)clipped / (double)n, (double)saturated / (double)n);
    std::printf("  centroid_hz=%.1f f0_hz=%.2f f0_rel_peak_db=%.2f low_ratio=%.4f\n",
                centroid, f0, f0MagDb, lowRatio);
    std::printf("  band_lt120=%.4f band_120_500=%.4f band_500_2k=%.4f band_2k_8k=%.4f\n",
                total > 0.0 ? band1 / total : 0.0, total > 0.0 ? band2 / total : 0.0,
                total > 0.0 ? band3 / total : 0.0, total > 0.0 ? band4 / total : 0.0);
    const double lateCentroid = spectralCentroid(specLate);
    const double lateTotal = bandEnergy(specLate, 0.0, 1.0e9);
    const double lateLowRatio = lateTotal > 0.0 ? bandEnergy(specLate, 0.0, 1.5 * f0) / lateTotal : 0.0;

    std::printf("  transient_ratio=%.4f sustain_ratio=%.4f decay_ms=%.1f\n", transientRatio, sustainRatio, decayMs);
    std::printf("  late_centroid_hz=%.1f late_low_ratio=%.4f late_band_lt120=%.4f late_band_120_500=%.4f late_band_500_2k=%.4f late_band_2k_8k=%.4f\n",
                lateCentroid, lateLowRatio,
                lateTotal > 0.0 ? bandEnergy(specLate, 0.0, 120.0) / lateTotal : 0.0,
                lateTotal > 0.0 ? bandEnergy(specLate, 120.0, 500.0) / lateTotal : 0.0,
                lateTotal > 0.0 ? bandEnergy(specLate, 500.0, 2000.0) / lateTotal : 0.0,
                lateTotal > 0.0 ? bandEnergy(specLate, 2000.0, 8000.0) / lateTotal : 0.0);

    if (!c.specPath.empty()) writeSpectrumCsv(c.specPath, spec);
    if (!c.audioPath.empty()) writeMonoWav(c.audioPath, y);
}

const char* argValue(int argc, char** argv, const char* key)
{
    const size_t klen = std::strlen(key);
    for (int i = 1; i < argc; i++) {
        if (std::strncmp(argv[i], key, klen) == 0 && argv[i][klen] == '=') return argv[i] + klen + 1;
    }
    return nullptr;
}

float argFloat(int argc, char** argv, const char* key, float def)
{
    const char* v = argValue(argc, argv, key);
    return v ? (float)std::atof(v) : def;
}

int argInt(int argc, char** argv, const char* key, int def)
{
    const char* v = argValue(argc, argv, key);
    return v ? std::atoi(v) : def;
}

std::string argString(int argc, char** argv, const char* key, const std::string& def)
{
    const char* v = argValue(argc, argv, key);
    return v ? std::string(v) : def;
}

}

int main(int argc, char** argv)
{
    Case c;
    c.name = argString(argc, argv, "--name", "default");
    c.position = argFloat(argc, argv, "--position", c.position);
    c.tone = argFloat(argc, argv, "--tone", c.tone);
    c.decayTime = argFloat(argc, argv, "--decay", c.decayTime);
    c.damping = argFloat(argc, argv, "--damping", c.damping);
    c.stretch = argFloat(argc, argv, "--stretch", c.stretch);
    c.collision = argFloat(argc, argv, "--collision", c.collision);
    c.outLevel = argFloat(argc, argv, "--level", c.outLevel);
    c.couple = argFloat(argc, argv, "--couple", c.couple);
    c.inputAmt = argFloat(argc, argv, "--input", c.inputAmt);
    c.malletAmt = argFloat(argc, argv, "--mallet", c.malletAmt);
    c.bowAmt = argFloat(argc, argv, "--bow", c.bowAmt);
    c.hardness = argFloat(argc, argv, "--hardness", c.hardness);
    c.shapeString = argFloat(argc, argv, "--shape-string", c.shapeString);
    c.shapeBell = argFloat(argc, argv, "--shape-bell", c.shapeBell);
    c.shapePlate = argFloat(argc, argv, "--shape-plate", c.shapePlate);
    c.shapeMembrane = argFloat(argc, argv, "--shape-membrane", c.shapeMembrane);
    c.shapeBar = argFloat(argc, argv, "--shape-bar", c.shapeBar);
    c.note = argInt(argc, argv, "--note", c.note);
    c.vel = argFloat(argc, argv, "--vel", c.vel);
    c.voiceCount = argInt(argc, argv, "--voices", c.voiceCount);
    c.durationSec = (double)argFloat(argc, argv, "--dur", (float)c.durationSec);
    c.excitation = argString(argc, argv, "--exc", c.excitation);
    c.wavPath = argString(argc, argv, "--wav", "");
    c.specPath = argString(argc, argv, "--spec", "");
    c.audioPath = argString(argc, argv, "--audio", "");

    const int n = (int)(c.durationSec * (double)kSampleRate);
    const std::vector<float> excite = makeExcitation(c, n);
    const std::vector<float> y = runCase(c, excite);
    report(c, y);
    return 0;
}
