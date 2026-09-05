#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>
#include "../effects/home/faust/pitch_poly_ffi.h"

int main(int argc, char** argv) {
    if (argc < 4) {
        std::fprintf(stderr, "usage: %s <in.f32> <out.f32> <pitchScale> [formantDepth] [voiceIdx]\n", argv[0]);
        return 1;
    }
    const char* inPath = argv[1];
    const char* outPath = argv[2];
    float pitchScale = std::atof(argv[3]);
    float formantDepth = argc > 4 ? std::atof(argv[4]) : 0.0f;
    int voiceIdx = argc > 5 ? std::atoi(argv[5]) : 0;

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

    for (long i = 0; i < n; i++) {
        out[i] = dubfx_pitch_tick_poly(in[i], (float)voiceIdx, pitchScale, formantDepth, 1.0f);
    }

    FILE* fout = std::fopen(outPath, "wb");
    if (!fout) { std::fprintf(stderr, "cannot open %s for write\n", outPath); return 1; }
    std::fwrite(out.data(), sizeof(float), n, fout);
    std::fclose(fout);
    return 0;
}
