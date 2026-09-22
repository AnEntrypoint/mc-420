// dsp_cli — a minimal, dependency-free CLI harness for inspecting any
// mc-420 Faust DSP file (effects_runtime.dsp, a single effect stage, a
// whole loop.dsp+effects chain, anything faust -lang cpp can compile).
//
// Zero new installs: only needs faust.exe and the MSVC toolchain (both
// already installed on this dev machine) -- no libsndfile, no PortAudio,
// no Qt, no ALSA/JACK, no GUI at all. Reads/writes plain PCM/float WAV
// (a tiny hand-rolled RIFF-chunk-scanning reader, no library), or raw
// stdin/stdout float32 for scripting into other CLI tools.
//
// Usage:
//   dsp_cli <in.wav> <out.wav> [CTRL=value ...]
//   dsp_cli --gen sine:440:2.0 <out.wav> [CTRL=value ...]   (no input file --
//     generates a test signal instead: sine:freqHz:seconds,
//     sweep:startHz:endHz:seconds, impulse:seconds, noise:seconds,
//     step:lowVal:highVal:atSeconds:totalSeconds, silence:seconds,
//     wav:path/to/file.wav -- a real recorded file used as one channel's
//     signal, combinable with --genN on other channels; see below)
//   dsp_cli --stats <in.wav>                                 (prints peak/
//     RMS/zero-crossing-rate stats for a WAV, no DSP involved -- quick
//     sanity check on a rendered output)
//
// Multi-input DSPs (process(main, sidechainEnv) = ... and similar): repeat
// --gen with an explicit channel index, --gen0/--gen1/--gen2/..., to drive
// each Faust input channel with its own independent test signal:
//   dsp_cli --gen0 sine:440:1.0 --gen1 step:0:1:0.5:1.0 out.wav
// A bare `--gen <spec> <out.wav>` (no index) is exactly equivalent to
// `--gen0 <spec>` and remains fully backward compatible -- any input
// channels beyond the ones named are fed silence, same as before.
//
// Multi-output DSPs: channel 0 is written to <out.wav> exactly as before
// (byte-for-byte unchanged for single-output DSPs). Additional output
// channels 1..M-1 are written alongside as <out>.1.wav, <out>.2.wav, etc.
// (stem derived by stripping a trailing .wav, if present). --stats-style
// peak/RMS output is printed per channel, labelled by index.
//
// Every -lang cpp compiled Faust class exposes buildUserInterface(UI*) the
// same way the VST's FaustShim.h does; this harness reuses that exact
// same minimal UI shim (copy-pasted, not shared, to keep this a truly
// standalone single-file tool with no path dependency on any other repo)
// so CTRL=value on the command line maps straight to any hslider/button/
// checkbox/nentry the .dsp declares, by exact-or-suffix name match.
#define _USE_MATH_DEFINES
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cstdint>
#include <cctype>
#include <cmath>
#include <string>
#include <map>
#include <vector>
#include <memory>

#define FAUSTFLOAT float
struct FaustMeta { void declare(const char*, const char*) {} };
struct FaustUI {
    std::map<std::string, float*> zones;
    std::vector<std::string> path;
    std::string full(const char* label) const {
        std::string p;
        for (auto& g : path) if (!g.empty()) { p += g; p += "/"; }
        p += label;
        return p;
    }
    void openTabBox(const char* l) { path.push_back(l ? l : ""); }
    void openHorizontalBox(const char* l) { path.push_back(l ? l : ""); }
    void openVerticalBox(const char* l) { path.push_back(l ? l : ""); }
    void closeBox() { if (!path.empty()) path.pop_back(); }
    void addButton(const char* l, float* z) { zones[full(l)] = z; }
    void addCheckButton(const char* l, float* z) { zones[full(l)] = z; }
    void addVerticalSlider(const char* l, float* z, float, float, float, float) { zones[full(l)] = z; }
    void addHorizontalSlider(const char* l, float* z, float, float, float, float) { zones[full(l)] = z; }
    void addNumEntry(const char* l, float* z, float, float, float, float) { zones[full(l)] = z; }
    void addHorizontalBargraph(const char* l, float* z, float, float) { zones[full(l)] = z; }
    void addVerticalBargraph(const char* l, float* z, float, float) { zones[full(l)] = z; }
    void addSoundfile(const char*, const char*, void**) {}
    void declare(float*, const char*, const char*) {}
    void set(const char* name, float v) {
        auto it = zones.find(name);
        if (it != zones.end()) { *it->second = v; return; }
        std::string suf(name);
        for (auto& kv : zones) {
            const std::string& k = kv.first;
            if (k.size() >= suf.size() && k.compare(k.size() - suf.size(), suf.size(), suf) == 0) { *kv.second = v; return; }
        }
        fprintf(stderr, "warning: no zone matches '%s' -- ignored (see --list-zones)\n", name);
    }
    float get(const char* name, float def = 0.0f) const {
        auto it = zones.find(name);
        if (it != zones.end()) return *it->second;
        std::string suf(name);
        for (auto& kv : zones) {
            const std::string& k = kv.first;
            if (k.size() >= suf.size() && k.compare(k.size() - suf.size(), suf.size(), suf) == 0) return *kv.second;
        }
        return def;
    }
    void listZones() const { for (auto& kv : zones) fprintf(stderr, "  %s\n", kv.first.c_str()); }
};
#define Meta FaustMeta
#define UI FaustUI
#define dsp FaustDspBase
struct FaustDspBase { virtual ~FaustDspBase() {} };
#include "dsp_generated.cpp"   // faust -lang cpp output, regenerated by build.bat
#undef dsp

// ---- minimal WAV I/O, mono, no external library ----------------------
#pragma pack(push, 1)
struct WavHeader {
    char riff[4] = {'R','I','F','F'}; uint32_t chunkSize;
    char wave[4] = {'W','A','V','E'};
    char fmt[4] = {'f','m','t',' '}; uint32_t fmtSize = 16;
    uint16_t audioFormat = 1; uint16_t numChannels = 1;
    uint32_t sampleRate; uint32_t byteRate;
    uint16_t blockAlign; uint16_t bitsPerSample = 16;
    char data[4] = {'d','a','t','a'}; uint32_t dataSize;
};
#pragma pack(pop)

// Real-world WAV files (anything exported by a DAW/editor, not just this
// tool's own writeWavMono output) routinely carry a LIST/INFO/fact/JUNK
// chunk BETWEEN "fmt " and "data" -- a fixed-offset struct read assuming
// "data" sits immediately after a 16-byte fmt chunk silently misreads a
// later chunk's own tag/size as audio data (witnessed: a real corpus file
// with a 26-byte LIST chunk at that position was read as 13 samples of
// garbage instead of ~224k real ones, with no error at all). This scans
// chunks by id instead of assuming a position, and reads whatever bit
// depth/format the fmt chunk actually declares (PCM 16/24/32-bit int, or
// IEEE float32) rather than hardcoding 16-bit.
static bool readWavMono(const char* path, std::vector<float>& out, uint32_t& sr) {
    FILE* f = fopen(path, "rb");
    if (!f) { fprintf(stderr, "error: cannot open %s\n", path); return false; }
    char riff[4], wave[4];
    uint32_t riffSize;
    if (fread(riff, 1, 4, f) != 4 || fread(&riffSize, 4, 1, f) != 1 || fread(wave, 1, 4, f) != 4
        || memcmp(riff, "RIFF", 4) != 0 || memcmp(wave, "WAVE", 4) != 0) {
        fprintf(stderr, "error: %s is not a RIFF/WAVE file\n", path);
        fclose(f); return false;
    }
    uint16_t audioFormat = 0, numChannels = 0, bitsPerSample = 0;
    uint32_t sampleRate = 0;
    long dataPos = -1;
    uint32_t dataSize = 0;
    char id[4]; uint32_t csize;
    while (fread(id, 1, 4, f) == 4 && fread(&csize, 4, 1, f) == 1) {
        long chunkStart = ftell(f);
        if (memcmp(id, "fmt ", 4) == 0) {
            fread(&audioFormat, 2, 1, f);
            fread(&numChannels, 2, 1, f);
            fread(&sampleRate, 4, 1, f);
            fseek(f, 6, SEEK_CUR); // byteRate(4) + blockAlign(2)
            fread(&bitsPerSample, 2, 1, f);
        } else if (memcmp(id, "data", 4) == 0) {
            dataPos = chunkStart;
            dataSize = csize;
        }
        fseek(f, chunkStart + (long)csize + (long)(csize & 1), SEEK_SET);
    }
    if (dataPos < 0 || bitsPerSample == 0 || numChannels == 0) {
        fprintf(stderr, "error: %s has no usable fmt/data chunks\n", path);
        fclose(f); return false;
    }
    if (audioFormat != 1 && audioFormat != 3) {
        fprintf(stderr, "error: %s uses WAV format tag %u (only PCM=1/IEEE float=3 supported)\n", path, audioFormat);
        fclose(f); return false;
    }
    sr = sampleRate;
    int ch = numChannels;
    int bytesPerSample = bitsPerSample / 8;
    size_t nSamples = dataSize / bytesPerSample / ch;
    out.assign(nSamples, 0.0f);
    fseek(f, dataPos, SEEK_SET);
    std::vector<uint8_t> raw(dataSize);
    fread(raw.data(), 1, raw.size(), f);
    fclose(f);
    for (size_t i = 0; i < nSamples; i++) {
        double acc = 0.0;
        for (int c = 0; c < ch; c++) {
            const uint8_t* p = &raw[(i * ch + c) * bytesPerSample];
            double v;
            if (audioFormat == 3 && bitsPerSample == 32) {
                float fv; memcpy(&fv, p, 4); v = fv;
            } else if (bitsPerSample == 16) {
                int16_t sv; memcpy(&sv, p, 2); v = sv / 32768.0;
            } else if (bitsPerSample == 24) {
                int32_t sv = (int32_t)(p[0] | (p[1] << 8) | (p[2] << 16));
                if (sv & 0x800000) sv |= (int32_t)0xFF000000;
                v = sv / 8388608.0;
            } else if (bitsPerSample == 32) {
                int32_t sv; memcpy(&sv, p, 4); v = sv / 2147483648.0;
            } else if (bitsPerSample == 8) {
                v = (p[0] - 128) / 128.0;
            } else {
                v = 0.0;
            }
            acc += v;
        }
        out[i] = (float)(acc / ch);
    }
    return true;
}

static void writeWavMono(const char* path, const std::vector<float>& in, uint32_t sr) {
    WavHeader h;
    h.sampleRate = sr;
    h.byteRate = sr * 1 * 2;
    h.blockAlign = 2;
    h.dataSize = (uint32_t)(in.size() * 2);
    h.chunkSize = 36 + h.dataSize;
    FILE* f = fopen(path, "wb");
    fwrite(&h, sizeof(h), 1, f);
    for (float v : in) {
        float c = v < -1.0f ? -1.0f : (v > 1.0f ? 1.0f : v);
        int16_t s = (int16_t)(c * 32767.0f);
        fwrite(&s, sizeof(s), 1, f);
    }
    fclose(f);
}

// ---- test-signal generators (--gen mode, no input file needed) --------
static void genSine(std::vector<float>& out, double freq, double seconds, double sr) {
    size_t n = (size_t)(seconds * sr);
    out.resize(n);
    double phase = 0.0;
    for (size_t i = 0; i < n; i++) { out[i] = 0.5f * (float)sin(phase); phase += 2.0*M_PI*freq/sr; }
}
static void genSweep(std::vector<float>& out, double f0, double f1, double seconds, double sr) {
    size_t n = (size_t)(seconds * sr);
    out.resize(n);
    double phase = 0.0;
    for (size_t i = 0; i < n; i++) {
        double frac = (double)i / (double)n;
        double freq = f0 + frac * (f1 - f0);
        out[i] = 0.5f * (float)sin(phase);
        phase += 2.0*M_PI*freq/sr;
    }
}
static void genImpulse(std::vector<float>& out, double seconds, double sr) {
    size_t n = (size_t)(seconds * sr);
    out.assign(n, 0.0f);
    if (n > 0) out[0] = 1.0f;
}
static void genNoise(std::vector<float>& out, double seconds, double sr) {
    size_t n = (size_t)(seconds * sr);
    out.resize(n);
    unsigned seed = 12345;
    for (size_t i = 0; i < n; i++) {
        seed = seed * 1103515245 + 12345;
        out[i] = (((int)(seed >> 16) & 0x7fff) / 16384.0f - 1.0f) * 0.5f;
    }
}
static void genSilence(std::vector<float>& out, double seconds, double sr) {
    size_t n = (size_t)(seconds * sr);
    out.assign(n, 0.0f);
}
// step:lowVal:highVal:atSeconds:totalSeconds -- useful for driving a
// sidechain-envelope input to test ducking/pumping: flat at lowVal, then
// jumps to highVal at atSeconds and holds until totalSeconds.
static void genStep(std::vector<float>& out, double lowVal, double highVal, double atSeconds, double seconds, double sr) {
    size_t n = (size_t)(seconds * sr);
    size_t atN = (size_t)(atSeconds * sr);
    out.resize(n);
    for (size_t i = 0; i < n; i++) out[i] = (float)(i < atN ? lowVal : highVal);
}

// Parses a --gen spec string ("sine:440:1.0", "silence:1.0", "step:0:1:0.5:1.0",
// "wav:path/to/file.wav", ...) into `out`, at sample rate sr. Returns false
// (and prints an error) on an unrecognized kind. Shared by the bare --gen
// flag and the indexed --gen0/--gen1/... flags so every input channel
// supports the exact same spec grammar -- this is what lets a real recorded
// corpus file drive one channel (e.g. the live mic input) while scripted
// step/silence automation drives another (e.g. a gate or an external-tracker
// reading), in the same render, which no single positional <in.wav> arg can
// express. A wav: path containing ':' (a Windows drive letter, "C:\...")
// works because the kind is only ever matched against the FIRST colon and
// the remainder is taken whole -- no further colon-splitting for this kind.
static bool parseGenSpec(const std::string& spec, std::vector<float>& out, double sr) {
    size_t p1 = spec.find(':');
    std::string kind = spec.substr(0, p1);
    if (kind == "wav") {
        std::string path = spec.substr(p1 + 1);
        uint32_t wavSr = 0;
        if (!readWavMono(path.c_str(), out, wavSr)) return false;
        if (wavSr != 0 && (double)wavSr != sr) {
            fprintf(stderr, "warning: %s is %uHz, harness runs at %.0fHz -- no resampling, pitch/timing will read wrong\n",
                    path.c_str(), wavSr, sr);
        }
    } else if (kind == "sine") {
        size_t p2 = spec.find(':', p1+1);
        double freq = atof(spec.substr(p1+1, p2-p1-1).c_str());
        double secs = atof(spec.substr(p2+1).c_str());
        genSine(out, freq, secs, sr);
    } else if (kind == "sweep") {
        size_t p2 = spec.find(':', p1+1);
        size_t p3 = spec.find(':', p2+1);
        double f0 = atof(spec.substr(p1+1, p2-p1-1).c_str());
        double f1 = atof(spec.substr(p2+1, p3-p2-1).c_str());
        double secs = atof(spec.substr(p3+1).c_str());
        genSweep(out, f0, f1, secs, sr);
    } else if (kind == "impulse") {
        double secs = atof(spec.substr(p1+1).c_str());
        genImpulse(out, secs, sr);
    } else if (kind == "noise") {
        double secs = atof(spec.substr(p1+1).c_str());
        genNoise(out, secs, sr);
    } else if (kind == "silence") {
        double secs = atof(spec.substr(p1+1).c_str());
        genSilence(out, secs, sr);
    } else if (kind == "step") {
        size_t p2 = spec.find(':', p1+1);
        size_t p3 = spec.find(':', p2+1);
        size_t p4 = spec.find(':', p3+1);
        double lo = atof(spec.substr(p1+1, p2-p1-1).c_str());
        double hi = atof(spec.substr(p2+1, p3-p2-1).c_str());
        double at = atof(spec.substr(p3+1, p4-p3-1).c_str());
        double secs = atof(spec.substr(p4+1).c_str());
        genStep(out, lo, hi, at, secs, sr);
    } else {
        fprintf(stderr, "error: unknown --gen kind '%s'\n", kind.c_str());
        return false;
    }
    return true;
}

static void printStats(const std::vector<float>& sig, uint32_t sr) {
    float peak = 0.0f, sumSq = 0.0f;
    int zeroCrossings = 0;
    int prevSign = 0;
    for (float v : sig) {
        float a = fabsf(v);
        if (a > peak) peak = a;
        sumSq += v * v;
        int sign = v > 0 ? 1 : (v < 0 ? -1 : prevSign);
        if (prevSign != 0 && sign != prevSign) zeroCrossings++;
        prevSign = sign;
    }
    double seconds = sig.size() / (double)sr;
    double rms = sig.empty() ? 0.0 : sqrt(sumSq / sig.size());
    double approxHz = seconds > 0 ? (zeroCrossings / 2.0) / seconds : 0.0;
    printf("samples=%zu  duration=%.4fs  sampleRate=%u\n", sig.size(), seconds, sr);
    printf("peak=%.4f  rms=%.4f  zeroCrossings=%d  approxFreq=%.1fHz\n", peak, rms, zeroCrossings, approxHz);
}

int main(int argc, char** argv) {
    if (argc < 2) {
        fprintf(stderr,
            "usage:\n"
            "  dsp_cli <in.wav> <out.wav> [CTRL=value ...]\n"
            "  dsp_cli --gen <sine:freq:secs|sweep:f0:f1:secs|impulse:secs|noise:secs|silence:secs|step:lo:hi:at:secs|wav:path> <out.wav> [CTRL=value ...]\n"
            "  dsp_cli --gen0 <spec> [--gen1 <spec> --gen2 <spec> ...] <out.wav> [CTRL=value ...]\n"
            "      (multi-input DSPs: drive each input channel independently; --gen is an alias for --gen0)\n"
            "  dsp_cli --stats <file.wav>\n"
            "  dsp_cli --glitch-check <file.wav> [threshold=0.25] [minGapMs=5]\n"
            "  dsp_cli --list-zones\n");
        return 1;
    }

    const double SR = 48000.0;

    if (strcmp(argv[1], "--glitch-check") == 0) {
        // Flags a click/pop/discontinuity in a REAL recorded/rendered WAV: a
        // single-sample delta this large has no acoustic origin at 48kHz --
        // real audio (even a sharp transient/attack) is band-limited and
        // never jumps this far in one sample. 0.25 (of full-scale -1..1) is
        // a deliberately loose default so normal transients don't false-
        // positive; tighten it for a known-quiet test signal. minGapMs
        // coalesces a burst of consecutive over-threshold samples (one real
        // glitch event) into a single reported hit instead of one per
        // sample.
        if (argc < 3) { fprintf(stderr, "error: --glitch-check needs a file\n"); return 1; }
        std::vector<float> sig; uint32_t sr;
        if (!readWavMono(argv[2], sig, sr)) return 1;
        float threshold = 0.25f;
        float minGapMs = 5.0f;
        for (int i = 3; i < argc; i++) {
            std::string arg = argv[i];
            size_t eq = arg.find('=');
            if (eq == std::string::npos) continue;
            std::string name = arg.substr(0, eq);
            float val = (float)atof(arg.substr(eq + 1).c_str());
            if (name == "threshold") threshold = val;
            else if (name == "minGapMs") minGapMs = val;
        }
        size_t minGapSamples = (size_t)(minGapMs * 0.001 * sr);
        std::vector<size_t> hits;
        size_t lastHit = (size_t)-1;
        for (size_t i = 1; i < sig.size(); i++) {
            float d = fabsf(sig[i] - sig[i - 1]);
            if (d > threshold) {
                if (lastHit == (size_t)-1 || (i - lastHit) > minGapSamples) hits.push_back(i);
                lastHit = i;
            }
        }
        printf("samples=%zu  duration=%.4fs  sampleRate=%u  threshold=%.3f  minGapMs=%.1f\n",
               sig.size(), sig.size() / (double)sr, sr, threshold, minGapMs);
        printf("glitches=%zu\n", hits.size());
        for (size_t h : hits) {
            printf("  at sample=%zu t=%.4fs  delta=%.4f\n", h, h / (double)sr, fabsf(sig[h] - sig[h - 1]));
        }
        return hits.empty() ? 0 : 1;
    }

    if (strcmp(argv[1], "--stats") == 0) {
        if (argc < 3) { fprintf(stderr, "error: --stats needs a file\n"); return 1; }
        std::vector<float> sig; uint32_t sr;
        if (!readWavMono(argv[2], sig, sr)) return 1;
        printStats(sig, sr);
        return 0;
    }

    // Heap-allocate: a stack-local AloopEffectDsp crashes (STATUS_STACK_OVERFLOW,
    // 0xC00000FD) the moment the compiled .dsp is large enough -- WITNESSED
    // directly against dsp/loop.dsp (20 loopers x 60s delay-line buffers,
    // ~320MB), the exact same struct-size class the real aloop repo's own
    // ADR-013 already documents for audio_thread.cpp's AloopLoopDsp (fixed
    // there via std::make_unique for the identical reason). Small single-
    // effect .dsp files (the common case this tool was built for) never hit
    // this, but the tool must not silently corrupt/crash on a large one.
    auto dspPtr = std::make_unique<AloopEffectDsp>();
    AloopEffectDsp& dsp = *dspPtr;
    dsp.init((int)SR);
    FaustUI ui;
    dsp.buildUserInterface(&ui);

    if (strcmp(argv[1], "--list-zones") == 0) {
        fprintf(stderr, "controls in this DSP:\n");
        ui.listZones();
        return 0;
    }

    std::vector<float> in, out;
    uint32_t sr = (uint32_t)SR;
    int ctrlArgStart;
    const char* outPath;

    // genByChannel[i] holds the generated signal explicitly requested for
    // Faust input channel i, via --genN <spec> (or channel 0 via the bare
    // --gen alias, kept as an exact alias for full backward compatibility).
    // Input channels with no entry here are fed silence, same as before.
    std::map<int, std::vector<float>> genByChannel;

    // Detect "generator mode": argv[1] is --gen or --genN. Bare --gen is
    // parsed as if it were --gen0 (same grammar, same single-channel
    // result), so every pre-existing `--gen <spec> <out.wav> ...` call
    // site keeps behaving exactly as before -- it is simply the N==1 case
    // of the same indexed loop below.
    bool isGenMode = strncmp(argv[1], "--gen", 5) == 0
        && (argv[1][5] == '\0' || isdigit((unsigned char)argv[1][5]));

    if (isGenMode) {
        int i = 1;
        while (i < argc && strncmp(argv[i], "--gen", 5) == 0
               && (argv[i][5] == '\0' || isdigit((unsigned char)argv[i][5]))) {
            std::string flag = argv[i];
            std::string idxPart = flag.substr(5); // "" for "--gen", digits for "--genN"
            int chan = idxPart.empty() ? 0 : atoi(idxPart.c_str());
            if (i + 1 >= argc) { fprintf(stderr, "error: %s needs a spec\n", flag.c_str()); return 1; }
            std::string spec = argv[i+1];
            std::vector<float> sig;
            if (!parseGenSpec(spec, sig, SR)) return 1;
            genByChannel[chan] = std::move(sig);
            i += 2;
        }
        if (i >= argc) { fprintf(stderr, "error: --gen/--genN needs an output file after the spec(s)\n"); return 1; }
        outPath = argv[i];
        ctrlArgStart = i + 1;

        size_t maxLen = 0;
        for (auto& kv : genByChannel) maxLen = std::max(maxLen, kv.second.size());
        in.assign(maxLen, 0.0f);
        if (genByChannel.count(0)) in = genByChannel[0]; // legacy single-channel "in" view
        out.assign(maxLen, 0.0f);
    } else {
        if (argc < 3) { fprintf(stderr, "error: need <in.wav> <out.wav>\n"); return 1; }
        if (!readWavMono(argv[1], in, sr)) return 1;
        outPath = argv[2];
        ctrlArgStart = 3;
        out.assign(in.size(), 0.0f);
        genByChannel[0] = in;
    }

    for (int i = ctrlArgStart; i < argc; i++) {
        std::string arg = argv[i];
        size_t eq = arg.find('=');
        if (eq == std::string::npos) { fprintf(stderr, "warning: ignoring malformed arg '%s' (expected CTRL=value)\n", arg.c_str()); continue; }
        std::string name = arg.substr(0, eq);
        float val = (float)atof(arg.substr(eq+1).c_str());
        ui.set(name.c_str(), val);
    }

    const int N = dsp.getNumInputs();
    const int M = dsp.getNumOutputs();
    // Only warn about undriven input channels now -- multi-output is
    // handled below (all channels written), and multi-input is only a
    // problem if the caller didn't supply --gen for every channel.
    {
        int undriven = 0;
        for (int c = 0; c < N; c++) if (!genByChannel.count(c)) undriven++;
        if (undriven > 0) {
            fprintf(stderr, "note: this DSP has %d input(s); %d channel(s) have no --gen%s spec and are fed silence\n",
                N, undriven, N > 1 ? "N" : "");
        }
    }

    // Figure out the longest requested signal so every channel's buffer
    // (driven or silent) spans the full render length.
    size_t totalLen = in.size();
    for (auto& kv : genByChannel) totalLen = std::max(totalLen, kv.second.size());

    std::vector<std::vector<float>> inBufs(N > 0 ? N : 1), outBufs(M > 0 ? M : 1);
    for (auto& b : inBufs) b.assign(totalLen, 0.0f);
    for (auto& b : outBufs) b.assign(totalLen, 0.0f);
    for (int c = 0; c < N; c++) {
        auto it = genByChannel.find(c);
        if (it != genByChannel.end()) {
            for (size_t s = 0; s < it->second.size(); s++) inBufs[c][s] = it->second[s];
        }
    }

    const int blockSize = 64;
    size_t pos = 0;
    std::vector<float*> inPtrs(N > 0 ? N : 1), outPtrs(M > 0 ? M : 1);
    while (pos < totalLen) {
        int n = (int)std::min((size_t)blockSize, totalLen - pos);
        for (int c = 0; c < N; c++) inPtrs[c] = inBufs[c].data() + pos;
        for (int c = 0; c < M; c++) outPtrs[c] = outBufs[c].data() + pos;
        dsp.compute(n, N > 0 ? inPtrs.data() : nullptr, M > 0 ? outPtrs.data() : nullptr);
        pos += n;
    }
    if (M > 0) out = outBufs[0];
    else out.assign(totalLen, 0.0f);

    // Channel 0 always goes to outPath exactly as before (byte-identical
    // for single-output DSPs, which is the overwhelming majority so far).
    // Additional output channels (M > 1) are written alongside as
    // <stem>.1.wav, <stem>.2.wav, ... derived by stripping a trailing
    // ".wav" from outPath if present.
    writeWavMono(outPath, out, sr);
    fprintf(stderr, "wrote %s (%zu samples, %.3fs)\n", outPath, out.size(), out.size()/SR);
    if (M > 1) fprintf(stderr, "channel 0:\n");
    printStats(out, sr);

    if (M > 1) {
        std::string stem = outPath;
        const std::string ext = ".wav";
        if (stem.size() >= ext.size() && stem.compare(stem.size() - ext.size(), ext.size(), ext) == 0)
            stem = stem.substr(0, stem.size() - ext.size());
        for (int c = 1; c < M; c++) {
            std::string chPath = stem + "." + std::to_string(c) + ".wav";
            writeWavMono(chPath.c_str(), outBufs[c], sr);
            fprintf(stderr, "wrote %s (%zu samples, %.3fs)\n", chPath.c_str(), outBufs[c].size(), outBufs[c].size()/SR);
            fprintf(stderr, "channel %d:\n", c);
            printStats(outBufs[c], sr);
        }
    }
    return 0;
}
