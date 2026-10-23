#include <cstdio>
#include <cstdint>
#include <cstring>
#include <cmath>
#include <string>
#include <vector>
#include <algorithm>

namespace {

struct Mono {
    std::vector<double> x;
    double sr = 48000.0;
};

bool readWavMono(const char* path, Mono& out) {
    FILE* f = std::fopen(path, "rb");
    if (!f) { std::fprintf(stderr, "meter: cannot open %s\n", path); return false; }
    unsigned char hdr[12];
    if (std::fread(hdr, 1, 12, f) != 12) { std::fclose(f); return false; }
    if (std::memcmp(hdr, "RIFF", 4) != 0 || std::memcmp(hdr + 8, "WAVE", 4) != 0) {
        std::fclose(f);
        return false;
    }
    uint16_t audioFormat = 1, numChannels = 1, bitsPerSample = 16;
    uint32_t sampleRate = 48000;
    bool haveData = false;
    std::vector<unsigned char> raw;
    while (true) {
        unsigned char ch[8];
        if (std::fread(ch, 1, 8, f) != 8) break;
        uint32_t size = 0;
        std::memcpy(&size, ch + 4, 4);
        if (std::memcmp(ch, "fmt ", 4) == 0) {
            std::vector<unsigned char> body(size + (size & 1u));
            if (std::fread(body.data(), 1, body.size(), f) != body.size()) break;
            if (size >= 16) {
                std::memcpy(&audioFormat, body.data(), 2);
                std::memcpy(&numChannels, body.data() + 2, 2);
                std::memcpy(&sampleRate, body.data() + 4, 4);
                std::memcpy(&bitsPerSample, body.data() + 14, 2);
            }
        } else if (std::memcmp(ch, "data", 4) == 0) {
            raw.resize(size);
            if (std::fread(raw.data(), 1, size, f) != size) break;
            haveData = true;
            break;
        } else {
            if (std::fseek(f, (long)(size + (size & 1u)), SEEK_CUR) != 0) break;
        }
    }
    std::fclose(f);
    if (!haveData) { std::fprintf(stderr, "meter: no data chunk in %s\n", path); return false; }
    if (audioFormat != 1 && audioFormat != 3) {
        std::fprintf(stderr, "meter: unsupported format %u in %s\n", audioFormat, path);
        return false;
    }
    const uint32_t bytesPerSample = (uint32_t)(bitsPerSample / 8);
    if (bytesPerSample != 2 && bytesPerSample != 4) {
        std::fprintf(stderr, "meter: unsupported width %u in %s\n", bitsPerSample, path);
        return false;
    }
    const size_t frames = raw.size() / (size_t)(bytesPerSample * numChannels);
    out.x.assign(frames, 0.0);
    out.sr = (double)sampleRate;
    for (size_t i = 0; i < frames; i++) {
        const unsigned char* p = raw.data() + (size_t)(i * numChannels * bytesPerSample);
        double acc = 0.0;
        for (uint32_t c = 0; c < numChannels; c++) {
            const unsigned char* q = p + (size_t)(c * bytesPerSample);
            if (bytesPerSample == 2) {
                int16_t s = 0;
                std::memcpy(&s, q, 2);
                acc += (double)s / 32768.0;
            } else if (audioFormat == 3) {
                float s = 0.0f;
                std::memcpy(&s, q, 4);
                acc += (double)s;
            } else {
                int32_t s = 0;
                std::memcpy(&s, q, 4);
                acc += (double)s / 2147483648.0;
            }
        }
        out.x[i] = acc / (double)numChannels;
    }
    return true;
}

void fft(std::vector<double>& re, std::vector<double>& im) {
    const size_t n = re.size();
    for (size_t i = 1, j = 0; i < n; i++) {
        size_t bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) { std::swap(re[i], re[j]); std::swap(im[i], im[j]); }
    }
    for (size_t len = 2; len <= n; len <<= 1) {
        const double ang = -2.0 * M_PI / (double)len;
        const double wr = std::cos(ang), wi = std::sin(ang);
        for (size_t i = 0; i < n; i += len) {
            double cr = 1.0, ci = 0.0;
            for (size_t k = 0; k < len / 2; k++) {
                const double ur = re[i + k], ui = im[i + k];
                const double vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
                const double vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
                re[i + k] = ur + vr;
                im[i + k] = ui + vi;
                re[i + k + len / 2] = ur - vr;
                im[i + k + len / 2] = ui - vi;
                const double ncr = cr * wr - ci * wi;
                ci = cr * wi + ci * wr;
                cr = ncr;
            }
        }
    }
}

struct Metrics {
    double centroidHz = 0.0;
    double rmsDb = -120.0;
    double amDb = 0.0;
    double rippleDb = 0.0;
    size_t frames = 0;
};

Metrics analyze(const Mono& w) {
    const size_t N = 4096;
    const size_t HOP = 2048;
    Metrics m;
    if (w.x.size() < N) return m;
    const size_t total = w.x.size();
    const size_t start = (size_t)(0.20 * (double)total);
    const size_t end = (size_t)(0.80 * (double)total);
    if (end <= start + N) return m;

    double sumSq = 0.0;
    size_t nSq = 0;
    for (size_t i = start; i < end; i++) { sumSq += w.x[i] * w.x[i]; nSq++; }
    const double rmsAll = std::sqrt(sumSq / (double)nSq);
    m.rmsDb = 20.0 * std::log10(rmsAll + 1e-12);

    std::vector<double> frameRms;
    for (size_t s = start; s + N <= end; s += HOP) {
        double acc = 0.0;
        for (size_t i = 0; i < N; i++) { const double v = w.x[s + i]; acc += v * v; }
        frameRms.push_back(std::sqrt(acc / (double)N));
    }
    m.frames = frameRms.size();
    if (frameRms.size() >= 8) {
        const double peak = *std::max_element(frameRms.begin(), frameRms.end());
        const double gate = 0.10 * peak;
        std::vector<double> db;
        for (double r : frameRms) {
            if (r < gate) continue;
            db.push_back(20.0 * std::log10(r + 1e-12));
        }
        if (db.size() >= 8) {
            std::sort(db.begin(), db.end());
            const double lo = db[(size_t)(0.05 * (double)(db.size() - 1))];
            const double hi = db[(size_t)(0.95 * (double)(db.size() - 1))];
            m.amDb = hi - lo;
        }
    }

    std::vector<double> spec(N / 2 + 1, 0.0);
    size_t nFrames = 0;
    std::vector<double> re(N), im(N);
    for (size_t s = start; s + N <= end; s += N) {
        for (size_t i = 0; i < N; i++) {
            const double hann = 0.5 - 0.5 * std::cos(2.0 * M_PI * (double)i / (double)N);
            re[i] = w.x[s + i] * hann;
            im[i] = 0.0;
        }
        fft(re, im);
        for (size_t k = 0; k <= N / 2; k++) spec[k] += re[k] * re[k] + im[k] * im[k];
        nFrames++;
    }
    if (nFrames == 0) return m;
    for (double& v : spec) v /= (double)nFrames;

    const double binHz = w.sr / (double)N;
    double num = 0.0, den = 0.0;
    for (size_t k = 1; k <= N / 2; k++) {
        num += (double)k * binHz * spec[k];
        den += spec[k];
    }
    m.centroidHz = den > 1e-20 ? num / den : 0.0;

    const double binsPerOctave = 3.0;
    const double fLo = 100.0;
    const double fHi = std::min(8000.0, w.sr * 0.5);
    std::vector<double> bandDb;
    for (double f = fLo; f < fHi; f *= std::pow(2.0, 1.0 / binsPerOctave)) {
        const double f0 = f;
        const double f1 = f * std::pow(2.0, 1.0 / binsPerOctave);
        size_t k0 = (size_t)std::ceil(f0 / binHz);
        size_t k1 = (size_t)std::floor(f1 / binHz);
        if (k1 > N / 2) k1 = N / 2;
        double acc = 0.0;
        size_t cnt = 0;
        for (size_t k = k0; k <= k1 && k <= N / 2; k++) { acc += spec[k]; cnt++; }
        if (cnt == 0) continue;
        const double centre = std::sqrt(f0 * f1);
        if (centre < 200.0 || centre > 4000.0) continue;
        bandDb.push_back(10.0 * std::log10(acc / (double)cnt + 1e-20));
    }
    if (bandDb.size() >= 4) {
        m.rippleDb = *std::max_element(bandDb.begin(), bandDb.end())
                     - *std::min_element(bandDb.begin(), bandDb.end());
    }
    return m;
}

}  // namespace

int main(int argc, char** argv) {
    if (argc < 3) {
        std::fprintf(stderr, "usage: %s <label> <wav> [wav...]\n", argv[0]);
        return 2;
    }
    for (int i = 2; i < argc; i++) {
        Mono w;
        if (!readWavMono(argv[i], w)) return 2;
        const Metrics m = analyze(w);
        std::printf("%s\t%s\tcentroid=%.1f\trms=%.2f\tam=%.2f\tripple=%.2f\tframes=%zu\n",
                    argv[1], argv[i], m.centroidHz, m.rmsDb, m.amDb, m.rippleDb, m.frames);
    }
    return 0;
}
