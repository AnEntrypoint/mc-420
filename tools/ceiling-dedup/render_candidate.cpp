#include <faust/dsp/dsp.h>
#include <faust/dsp/llvm-dsp.h>
#include <faust/gui/meta.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

namespace {

constexpr int kBlock = 4800;

[[noreturn]] void fail(const std::string& why) {
    std::fprintf(stderr, "render_candidate: FAIL: %s\n", why.c_str());
    std::exit(1);
}

std::vector<float> loadWav(const char* path, int& sr) {
    FILE* f = std::fopen(path, "rb");
    if (!f) return {};
    std::fseek(f, 0, SEEK_END);
    const long sz = std::ftell(f);
    std::fseek(f, 0, SEEK_SET);
    std::vector<unsigned char> b(static_cast<size_t>(sz));
    const size_t got = std::fread(b.data(), 1, b.size(), f);
    std::fclose(f);
    if (got != b.size()) return {};
    int ch = 1, bits = 16;
    long dpos = -1, dlen = 0, q = 12;
    while (q + 8 <= sz) {
        const unsigned cl = b[q + 4] | (b[q + 5] << 8) | (b[q + 6] << 16) | (static_cast<unsigned>(b[q + 7]) << 24);
        if (!std::memcmp(&b[q], "fmt ", 4)) {
            ch = b[q + 10] | (b[q + 11] << 8);
            sr = b[q + 12] | (b[q + 13] << 8) | (b[q + 14] << 16) | (b[q + 15] << 24);
            bits = b[q + 22] | (b[q + 23] << 8);
        }
        if (!std::memcmp(&b[q], "data", 4)) {
            dpos = q + 8;
            dlen = cl;
            if (dpos + dlen > sz) dlen = sz - dpos;
            break;
        }
        q += 8 + cl + (cl & 1);
    }
    if (dpos < 0 || bits != 16) return {};
    const long n = dlen / (2L * ch);
    std::vector<float> o(static_cast<size_t>(n));
    for (long i = 0; i < n; i++) {
        const short v = static_cast<short>(b[dpos + i * 2 * ch] | (b[dpos + i * 2 * ch + 1] << 8));
        o[static_cast<size_t>(i)] = v / 32768.0f;
    }
    return o;
}

}

int main(int argc, char** argv) {
    if (argc < 6) {
        std::fprintf(stderr, "usage: render_candidate <dsp> <gain> <outdir> <tag> <wav>...\n");
        return 2;
    }
    const std::string dspPath = argv[1];
    const float gain = static_cast<float>(std::atof(argv[2]));
    const std::string outdir = argv[3];
    const std::string tag = argv[4];

    std::string err;
    llvm_dsp_factory* fac = createDSPFactoryFromFile(dspPath.c_str(), 0, nullptr, "", err, -1);
    if (!fac) fail("compile failed: " + err);

    for (int a = 5; a < argc; a++) {
        const std::string wav = argv[a];
        std::string base = wav.substr(wav.find_last_of('/') + 1);
        base = base.substr(0, base.size() - 4);
        int sr = 48000;
        std::vector<float> in = loadWav(wav.c_str(), sr);
        if (in.empty()) fail("cannot load " + wav);
        const float g = base.compare(0, 5, "sine_") == 0 ? 1.0f : gain;
        for (float& v : in) v *= g;

        dsp* d = fac->createDSPInstance();
        d->init(sr);
        const int no = d->getNumOutputs();
        std::vector<float> ib(kBlock, 0.0f);
        std::vector<std::vector<float>> ob(static_cast<size_t>(no), std::vector<float>(kBlock, 0.0f));
        std::vector<float*> op(static_cast<size_t>(no));
        for (int i = 0; i < no; i++) op[static_cast<size_t>(i)] = ob[static_cast<size_t>(i)].data();
        float* ip[1] = {ib.data()};

        const std::string of = outdir + "/" + tag + "__" + base + ".txt";
        FILE* fo = std::fopen(of.c_str(), "w");
        if (!fo) fail("cannot write " + of);
        long pos = 0;
        const long n = static_cast<long>(in.size());
        while (pos < n) {
            long c = n - pos;
            if (c > kBlock) c = kBlock;
            std::fill(ib.begin(), ib.end(), 0.0f);
            std::memcpy(ib.data(), &in[static_cast<size_t>(pos)], static_cast<size_t>(c) * sizeof(float));
            d->compute(kBlock, ip, op.data());
            const float last = ob[0][static_cast<size_t>(c - 1)];
            if (std::isnan(last)) fail("NaN in output for " + base);
            std::fprintf(fo, "%.4f %.4f\n", static_cast<double>(pos + c) / sr, last);
            pos += c;
        }
        std::fclose(fo);
        delete d;
        std::fprintf(stderr, "render_candidate: done %s\n", base.c_str());
    }
    deleteDSPFactory(fac);
    return 0;
}
