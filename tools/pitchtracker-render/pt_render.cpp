#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "pt_dsp.cpp"

static std::string argValue(int argc, char** argv, const char* key, const char* fallback)
{
    std::string prefix = std::string(key) + "=";
    for (int i = 1; i < argc; i++) {
        std::string a = argv[i];
        if (a.compare(0, prefix.size(), prefix) == 0) {
            return a.substr(prefix.size());
        }
    }
    return std::string(fallback);
}

static bool readPlanarF32(const std::string& path, std::vector<float>& out, size_t& frames)
{
    FILE* f = fopen(path.c_str(), "rb");
    if (f == 0) {
        fprintf(stderr, "pt_render: cannot open input %s\n", path.c_str());
        return false;
    }
    fseek(f, 0, SEEK_END);
    long bytes = ftell(f);
    fseek(f, 0, SEEK_SET);
    out.resize(bytes / sizeof(float));
    size_t got = fread(out.data(), sizeof(float), out.size(), f);
    fclose(f);
    if (got != out.size()) {
        fprintf(stderr, "pt_render: short read on %s\n", path.c_str());
        return false;
    }
    frames = out.size();
    return true;
}

int main(int argc, char** argv)
{
    std::string inPath = argValue(argc, argv, "in", "");
    std::string outPath = argValue(argc, argv, "out", "");
    int sr = atoi(argValue(argc, argv, "sr", "48000").c_str());
    int block = atoi(argValue(argc, argv, "block", "64").c_str());
    int channels = atoi(argValue(argc, argv, "channels", "1").c_str());

    if (inPath.empty() || outPath.empty()) {
        fprintf(stderr, "usage: pt_render in=<f32> out=<f32> sr=<hz> block=<n> channels=<n>\n");
        return 2;
    }
    if (sr <= 0 || block <= 0 || channels <= 0) {
        fprintf(stderr, "pt_render: sr, block and channels must be positive\n");
        return 2;
    }

    std::vector<float> raw;
    size_t total = 0;
    if (!readPlanarF32(inPath, raw, total)) {
        return 1;
    }
    if (total % size_t(channels) != 0) {
        fprintf(stderr, "pt_render: %zu samples is not a whole number of %d channels\n", total, channels);
        return 1;
    }
    size_t frames = total / size_t(channels);

    pitchtracker engine;
    engine.init(sr);
    UI ui;
    engine.buildUserInterface(&ui);

    if (engine.getNumInputs() != channels) {
        fprintf(stderr, "pt_render: dsp wants %d inputs, input file has %d channels\n",
                engine.getNumInputs(), channels);
        return 1;
    }
    int outs = engine.getNumOutputs();
    if (outs <= 0) {
        fprintf(stderr, "pt_render: dsp declares no outputs\n");
        return 1;
    }

    std::vector<float> outBuf(size_t(outs) * frames, 0.0f);
    std::vector<float*> inPtrs(size_t(channels), 0);
    std::vector<float*> outPtrs(size_t(outs), 0);

    for (size_t i = 0; i < frames; i += size_t(block)) {
        size_t n = frames - i;
        if (n > size_t(block)) {
            n = size_t(block);
        }
        for (int c = 0; c < channels; c++) {
            inPtrs[size_t(c)] = &raw[size_t(c) * frames + i];
        }
        for (int c = 0; c < outs; c++) {
            outPtrs[size_t(c)] = &outBuf[size_t(c) * frames + i];
        }
        engine.compute(int(n), inPtrs.data(), outPtrs.data());
    }

    FILE* f = fopen(outPath.c_str(), "wb");
    if (f == 0) {
        fprintf(stderr, "pt_render: cannot open output %s\n", outPath.c_str());
        return 1;
    }
    size_t wrote = fwrite(outBuf.data(), sizeof(float), outBuf.size(), f);
    fclose(f);
    if (wrote != outBuf.size()) {
        fprintf(stderr, "pt_render: short write on %s\n", outPath.c_str());
        return 1;
    }
    return 0;
}
