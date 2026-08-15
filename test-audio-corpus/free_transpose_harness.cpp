#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>
#include "../effects/home/faust/soladSnacOctaver.h"

int main(int argc, char** argv) {
    if (argc < 4) {
        std::fprintf(stderr, "usage: %s <in.f32> <out.f32> <pitchScale> [formantDepth]\n", argv[0]);
        return 1;
    }
    const char* inPath = argv[1];
    const char* outPath = argv[2];
    float pitchScale = std::atof(argv[3]);
    float formantDepth = argc > 4 ? std::atof(argv[4]) : 0.0f;

    FILE* fin = std::fopen(inPath, "rb");
    if (!fin) { std::fprintf(stderr, "cannot open %s\n", inPath); return 1; }
    std::fseek(fin, 0, SEEK_END);
    long bytes = std::ftell(fin);
    std::fseek(fin, 0, SEEK_SET);
    long n = bytes / (long)sizeof(float);
    std::vector<float> in(n);
    size_t got = std::fread(in.data(), sizeof(float), n, fin);
    std::fclose(fin);
    if ((long)got != n) { std::fprintf(stderr, "short read\n"); return 1; }

    std::vector<float> out(n, 0.0f);

    EngineSoladSnac engine;
    engine.setPitchScale(pitchScale);
    engine.setFormantDepth(formantDepth);
    engine.reengage();

    const int BS = 64;
    for (long i = 0; i < n; i += BS) {
        int m = (int)((n - i) < BS ? (n - i) : BS);
        engine.processBlock(in.data() + i, out.data() + i, m);
    }

    FILE* fout = std::fopen(outPath, "wb");
    if (!fout) { std::fprintf(stderr, "cannot open %s for write\n", outPath); return 1; }
    std::fwrite(out.data(), sizeof(float), n, fout);
    std::fclose(fout);
    return 0;
}
