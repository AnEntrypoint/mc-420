#include "faust_min.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "gen_pre.cpp"
#include "gen_pre_bypass.cpp"
#include "gen_pre_clean.cpp"
#include "gen_post.cpp"
#include "gen_post_regress.cpp"
#include "gen_lfx.cpp"
#include "gen_lfx_nobc.cpp"
#include "gen_bitcrush.cpp"
#include "gen_flanger.cpp"
#include "gen_tremolo.cpp"
#include "gen_phaser.cpp"
#include "gen_distortion.cpp"
#include "gen_vinyl.cpp"
#include "gen_flutter.cpp"

namespace {

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
        } else {
            if (std::fseek(f, (long)sz, SEEK_CUR) != 0) break;
        }
        if (sz & 1UL) std::fseek(f, 1, SEEK_CUR);
    }
    std::fclose(f);
    if (!haveFmt || raw.empty()) return false;
    if (w.channels < 1) w.channels = 1;

    size_t bytesPerSample = (size_t)(w.bits / 8);
    if (bytesPerSample < 1) bytesPerSample = 1;
    size_t frames = raw.size() / (bytesPerSample * (size_t)w.channels);
    w.mono.assign(frames, 0.0f);

    for (size_t i = 0; i < frames; i++) {
        float acc = 0.0f;
        for (int c = 0; c < w.channels; c++) {
            const unsigned char* p = raw.data() + (size_t)(i * w.channels + c) * bytesPerSample;
            float v = 0.0f;
            if (w.format == 3 && w.bits == 32) {
                float fv = 0.0f;
                std::memcpy(&fv, p, 4);
                v = fv;
            } else if (w.format == 3 && w.bits == 64) {
                double dv = 0.0;
                std::memcpy(&dv, p, 8);
                v = (float)dv;
            } else if (w.bits == 16) {
                short sv = 0;
                std::memcpy(&sv, p, 2);
                v = (float)sv / 32768.0f;
            } else if (w.bits == 32) {
                int iv = 0;
                std::memcpy(&iv, p, 4);
                v = (float)iv / 2147483648.0f;
            } else if (w.bits == 24) {
                unsigned long u = (unsigned long)p[0] | ((unsigned long)p[1] << 8) | ((unsigned long)p[2] << 16);
                long sv = (u & 0x800000UL) ? (long)(u | 0xFF000000UL) : (long)u;
                v = (float)sv / 8388608.0f;
            } else if (w.bits == 8) {
                v = ((float)p[0] - 128.0f) / 128.0f;
            }
            acc += v;
        }
        w.mono[i] = acc / (float)w.channels;
    }
    return true;
}

void wr32(unsigned char* p, unsigned long v)
{
    p[0] = (unsigned char)(v & 0xFF);
    p[1] = (unsigned char)((v >> 8) & 0xFF);
    p[2] = (unsigned char)((v >> 16) & 0xFF);
    p[3] = (unsigned char)((v >> 24) & 0xFF);
}

void wr16(unsigned char* p, unsigned long v)
{
    p[0] = (unsigned char)(v & 0xFF);
    p[1] = (unsigned char)((v >> 8) & 0xFF);
}

bool writeWavF32(const std::string& path, const std::vector<float>& x, int sampleRate)
{
    FILE* f = std::fopen(path.c_str(), "wb");
    if (!f) return false;
    size_t dataBytes = x.size() * 4;
    std::vector<unsigned char> head(44);
    std::memcpy(head.data(), "RIFF", 4);
    wr32(head.data() + 4, 36UL + dataBytes);
    std::memcpy(head.data() + 8, "WAVE", 4);
    std::memcpy(head.data() + 12, "fmt ", 4);
    wr32(head.data() + 16, 16UL);
    wr16(head.data() + 20, 3UL);
    wr16(head.data() + 22, 1UL);
    wr32(head.data() + 24, (unsigned long)sampleRate);
    wr32(head.data() + 28, (unsigned long)sampleRate * 4UL);
    wr16(head.data() + 32, 4UL);
    wr16(head.data() + 34, 32UL);
    std::memcpy(head.data() + 36, "data", 4);
    wr32(head.data() + 40, dataBytes);
    if (std::fwrite(head.data(), 1, head.size(), f) != head.size()) { std::fclose(f); return false; }
    if (!x.empty()) {
        if (std::fwrite(x.data(), 4, x.size(), f) != x.size()) { std::fclose(f); return false; }
    }
    std::fclose(f);
    return true;
}

std::string argValue(int argc, char** argv, const std::string& key, const std::string& def)
{
    for (int i = 1; i < argc; i++) {
        std::string a = argv[i];
        size_t p = a.find('=');
        if (p != std::string::npos && a.substr(0, p) == key) return a.substr(p + 1);
    }
    return def;
}

std::vector<std::string> argList(int argc, char** argv, const std::string& key)
{
    std::vector<std::string> out;
    for (int i = 1; i < argc; i++) {
        std::string a = argv[i];
        size_t p = a.find('=');
        if (p != std::string::npos && a.substr(0, p) == key) out.push_back(a.substr(p + 1));
    }
    return out;
}

double dbfs(double v)
{
    if (v <= 0.0) return -999.0;
    return 20.0 * std::log10(v);
}

void dumpZones(const char* tag, ZoneUI& ui)
{
    std::map<std::string, FAUSTFLOAT*>::iterator it;
    for (it = ui.zone.begin(); it != ui.zone.end(); ++it) {
        std::map<std::string, FAUSTFLOAT>::iterator iv = ui.init.find(it->first);
        std::map<std::string, std::string>::iterator ik = ui.kind.find(it->first);
        std::printf("zone %s %s %s init=%.6f now=%.6f\n",
                    tag,
                    it->first.c_str(),
                    ik == ui.kind.end() ? "?" : ik->second.c_str(),
                    iv == ui.init.end() ? 0.0 : (double)iv->second,
                    (double)*(it->second));
    }
}

struct Stage {
    dsp* obj;
    ZoneUI ui;
};

Stage makeStage(dsp* obj, int sampleRate)
{
    Stage s;
    s.obj = obj;
    s.obj->init(sampleRate);
    s.obj->buildUserInterface(&s.ui);
    return s;
}

}  // namespace

int main(int argc, char** argv)
{
    std::string inPath = argValue(argc, argv, "in", "");
    std::string outPath = argValue(argc, argv, "out", "");
    std::string mode = argValue(argc, argv, "mode", "none");
    std::string tap = argValue(argc, argv, "tap", "master");
    int block = std::atoi(argValue(argc, argv, "block", "64").c_str());
    int warmup = std::atoi(argValue(argc, argv, "warmup", "48000").c_str());
    float gain = (float)std::atof(argValue(argc, argv, "gain", "1.0").c_str());
    std::string dump = argValue(argc, argv, "dump", "");
    int sr = std::atoi(argValue(argc, argv, "sr", "48000").c_str());

    if (inPath.empty() || outPath.empty()) {
        std::printf("usage: chain_render in=<wav> out=<wav> mode=<none|...|faust|full|...> tap=<master|cue|record|inputfx|loopsum> block=64 warmup=48000 gain=1.0 dump=<tag> sr=48000 postregress=0 set=ZONE:VALUE (repeatable) sweep=ZONE:FROM:TO (repeatable)\n");
        return 2;
    }
    if (block < 1) block = 1;

    struct ZoneSet { std::string name; float value; };
    struct ZoneSweep { std::string name; double from; double to; };
    std::vector<ZoneSet> zoneSets;
    std::vector<ZoneSweep> zoneSweeps;

    std::vector<std::string> setArgs = argList(argc, argv, "set");
    for (size_t i = 0; i < setArgs.size(); i++) {
        size_t c = setArgs[i].find(':');
        if (c == std::string::npos) {
            std::printf("bad set arg %s (want ZONE:VALUE)\n", setArgs[i].c_str());
            return 2;
        }
        ZoneSet zs;
        zs.name = setArgs[i].substr(0, c);
        zs.value = (float)std::atof(setArgs[i].substr(c + 1).c_str());
        zoneSets.push_back(zs);
    }
    std::vector<std::string> sweepArgs = argList(argc, argv, "sweep");
    for (size_t i = 0; i < sweepArgs.size(); i++) {
        size_t c1 = sweepArgs[i].find(':');
        size_t c2 = (c1 == std::string::npos) ? std::string::npos : sweepArgs[i].find(':', c1 + 1);
        if (c2 == std::string::npos) {
            std::printf("bad sweep arg %s (want ZONE:FROM:TO)\n", sweepArgs[i].c_str());
            return 2;
        }
        ZoneSweep sw;
        sw.name = sweepArgs[i].substr(0, c1);
        sw.from = std::atof(sweepArgs[i].substr(c1 + 1, c2 - c1 - 1).c_str());
        sw.to = std::atof(sweepArgs[i].substr(c2 + 1).c_str());
        zoneSweeps.push_back(sw);
    }

    WavFile src;
    if (!readWav(inPath, src)) {
        std::printf("read failed %s\n", inPath.c_str());
        return 3;
    }
    std::printf("in=%s sr=%d ch=%d bits=%d fmt=%d frames=%zu\n",
                inPath.c_str(), src.sampleRate, src.channels, src.bits, src.format, src.mono.size());

    bool useLfx = (mode == "lfx" || mode == "full" || mode == "full_bp");
    bool useLfxNoBc = (mode == "lfx_nobc");
    bool useBitcrush = (mode == "bitcrush");
    bool useFlanger = (mode == "flanger");
    bool useTremolo = (mode == "tremolo");
    bool usePhaser = (mode == "phaser");
    bool useDistortion = (mode == "distortion");
    bool useVinyl = (mode == "vinyl");
    bool useFlutter = (mode == "flutter");
    bool usePreBypass = (mode == "faust_bp" || mode == "full_bp");
    bool usePreClean = (mode == "faust_clean");
    bool usePre = (mode == "faust" || mode == "full" || usePreBypass || usePreClean);

    Stage lfx = useLfx ? makeStage(new GuitarLofiFx(), sr) : Stage();
    Stage lfxNoBc = useLfxNoBc ? makeStage(new LfxNoBitcrush(), sr) : Stage();
    Stage bitcrush = useBitcrush ? makeStage(new StageBitcrush(), sr) : Stage();
    Stage flanger = useFlanger ? makeStage(new StageFlanger(), sr) : Stage();
    Stage tremolo = useTremolo ? makeStage(new StageTremolo(), sr) : Stage();
    Stage phaser = usePhaser ? makeStage(new StagePhaser(), sr) : Stage();
    Stage distortion = useDistortion ? makeStage(new StageDistortion(), sr) : Stage();
    Stage vinyl = useVinyl ? makeStage(new StageVinyl(), sr) : Stage();
    Stage flutter = useFlutter ? makeStage(new StageFlutter(), sr) : Stage();

    dsp* preObj = nullptr;
    if (usePreBypass) preObj = new AloopPreBypassDsp();
    else if (usePreClean) preObj = new AloopPreCleanDsp();
    else if (usePre) preObj = new AloopPreDsp();
    int postRegress = std::atoi(argValue(argc, argv, "postregress", "0").c_str());
    Stage pre = preObj ? makeStage(preObj, sr) : Stage();
    dsp* postObj = postRegress ? (dsp*)new AloopPostRegressDsp() : (dsp*)new AloopPostDsp();
    Stage post = usePre ? makeStage(postObj, sr) : Stage();

    if (usePre) {
        std::printf("pre in=%d out=%d\n", pre.obj->getNumInputs(), pre.obj->getNumOutputs());
        std::printf("post in=%d out=%d%s\n", post.obj->getNumInputs(), post.obj->getNumOutputs(),
                    postRegress ? " postregress=1" : "");
        bool sustSet = false;
        for (size_t i = 0; i < zoneSets.size(); i++) {
            if (zoneSets[i].name == "SUSTAINGATE") sustSet = true;
        }
        if (!sustSet) {
            if (pre.ui.set("SUSTAINGATE", 1.0f)) {
                std::printf("override SUSTAINGATE=1.0 on pre\n");
            } else {
                std::printf("WARN SUSTAINGATE zone not found on pre\n");
            }
        }
    }

    for (size_t i = 0; i < zoneSets.size(); i++) {
        bool hit = false;
        if (usePre) {
            if (pre.ui.set(zoneSets[i].name, zoneSets[i].value)) hit = true;
            if (post.ui.set(zoneSets[i].name, zoneSets[i].value)) hit = true;
        }
        if (useLfx && lfx.ui.set(zoneSets[i].name, zoneSets[i].value)) hit = true;
        if (useLfxNoBc && lfxNoBc.ui.set(zoneSets[i].name, zoneSets[i].value)) hit = true;
        if (useBitcrush && bitcrush.ui.set(zoneSets[i].name, zoneSets[i].value)) hit = true;
        if (useFlanger && flanger.ui.set(zoneSets[i].name, zoneSets[i].value)) hit = true;
        if (useTremolo && tremolo.ui.set(zoneSets[i].name, zoneSets[i].value)) hit = true;
        if (usePhaser && phaser.ui.set(zoneSets[i].name, zoneSets[i].value)) hit = true;
        if (useDistortion && distortion.ui.set(zoneSets[i].name, zoneSets[i].value)) hit = true;
        if (useVinyl && vinyl.ui.set(zoneSets[i].name, zoneSets[i].value)) hit = true;
        if (useFlutter && flutter.ui.set(zoneSets[i].name, zoneSets[i].value)) hit = true;
        std::printf("set %s=%.6f %s\n", zoneSets[i].name.c_str(), (double)zoneSets[i].value,
                    hit ? "applied" : "WARN no such zone");
    }
    for (size_t i = 0; i < zoneSweeps.size(); i++) {
        bool hit = false;
        if (usePre) {
            if (pre.ui.set(zoneSweeps[i].name, (float)zoneSweeps[i].from)) hit = true;
            if (post.ui.set(zoneSweeps[i].name, (float)zoneSweeps[i].from)) hit = true;
        }
        if (useLfx && lfx.ui.set(zoneSweeps[i].name, (float)zoneSweeps[i].from)) hit = true;
        if (useLfxNoBc && lfxNoBc.ui.set(zoneSweeps[i].name, (float)zoneSweeps[i].from)) hit = true;
        if (useBitcrush && bitcrush.ui.set(zoneSweeps[i].name, (float)zoneSweeps[i].from)) hit = true;
        if (useFlanger && flanger.ui.set(zoneSweeps[i].name, (float)zoneSweeps[i].from)) hit = true;
        if (useTremolo && tremolo.ui.set(zoneSweeps[i].name, (float)zoneSweeps[i].from)) hit = true;
        if (usePhaser && phaser.ui.set(zoneSweeps[i].name, (float)zoneSweeps[i].from)) hit = true;
        if (useDistortion && distortion.ui.set(zoneSweeps[i].name, (float)zoneSweeps[i].from)) hit = true;
        if (useVinyl && vinyl.ui.set(zoneSweeps[i].name, (float)zoneSweeps[i].from)) hit = true;
        if (useFlutter && flutter.ui.set(zoneSweeps[i].name, (float)zoneSweeps[i].from)) hit = true;
        std::printf("sweep %s %.6f -> %.6f %s\n", zoneSweeps[i].name.c_str(),
                    zoneSweeps[i].from, zoneSweeps[i].to, hit ? "armed" : "WARN no such zone");
    }

    if (!dump.empty()) {
        if (usePre) {
            dumpZones("pre", pre.ui);
            dumpZones("post", post.ui);
        }
        if (useLfx) dumpZones("lfx", lfx.ui);
        if (useLfxNoBc) dumpZones("lfx_nobc", lfxNoBc.ui);
        if (useBitcrush) dumpZones("bitcrush", bitcrush.ui);
        return 0;
    }

    int preIn = 0, preOut = 0, postIn = 0, postOut = 0;
    if (usePre) {
        preIn = pre.obj->getNumInputs();
        preOut = pre.obj->getNumOutputs();
        postIn = post.obj->getNumInputs();
        postOut = post.obj->getNumOutputs();
        if (preIn < 23 || preOut < 4 || postIn < 17 || postOut < 4) {
            std::printf("unexpected io pre=%d/%d post=%d/%d\n", preIn, preOut, postIn, postOut);
            return 4;
        }
    }

    std::vector<float> signal(src.mono.size(), 0.0f);
    for (size_t i = 0; i < signal.size(); i++) signal[i] = src.mono[i] * gain;

    std::vector<std::vector<float> > preInBuf;
    std::vector<std::vector<float> > preOutBuf;
    std::vector<std::vector<float> > postInBuf;
    std::vector<std::vector<float> > postOutBuf;
    std::vector<float*> preInPtr, preOutPtr, postInPtr, postOutPtr;

    if (usePre) {
        preInBuf.assign((size_t)preIn, std::vector<float>((size_t)block, 0.0f));
        preOutBuf.assign((size_t)preOut, std::vector<float>((size_t)block, 0.0f));
        postInBuf.assign((size_t)postIn, std::vector<float>((size_t)block, 0.0f));
        postOutBuf.assign((size_t)postOut, std::vector<float>((size_t)block, 0.0f));
        preInPtr.resize((size_t)preIn);
        preOutPtr.resize((size_t)preOut);
        postInPtr.resize((size_t)postIn);
        postOutPtr.resize((size_t)postOut);
    }

    std::vector<float> prevFilt((size_t)block, 0.0f);
    float masterPhase = 0.0f;
    std::vector<float> stageBuf((size_t)block, 0.0f);
    std::vector<float*> monoIn(1);
    std::vector<float*> monoOut(1);
    monoIn[0] = stageBuf.data();
    monoOut[0] = stageBuf.data();
    std::vector<float> out;
    out.reserve(signal.size());

    long long nonFinite = 0;
    double sumSq = 0.0;
    float peak = 0.0f;

    size_t wu = (size_t)(warmup > 0 ? warmup : 0);
    size_t total = signal.size() + wu;
    for (size_t base = 0; base < total; base += (size_t)block) {
        int n = (int)std::min((size_t)block, total - base);
        size_t srcBase = (base >= wu) ? (base - wu) : 0;
        bool srcValid = (base >= wu);
        for (int i = 0; i < n; i++) {
            size_t si = srcBase + (size_t)i;
            float v = (srcValid && si < signal.size()) ? signal[si] : 0.0f;
            stageBuf[(size_t)i] = v;
        }
        for (int i = n; i < block; i++) stageBuf[(size_t)i] = 0.0f;
        int nb = block;

        if (!zoneSweeps.empty()) {
            double span = (double)(total > wu ? total - wu : 1);
            double prog = (double)(base > wu ? base - wu : 0) / span;
            if (prog < 0.0) prog = 0.0;
            if (prog > 1.0) prog = 1.0;
            for (size_t k = 0; k < zoneSweeps.size(); k++) {
                float v = (float)(zoneSweeps[k].from + (zoneSweeps[k].to - zoneSweeps[k].from) * prog);
                if (usePre) {
                    pre.ui.set(zoneSweeps[k].name, v);
                    post.ui.set(zoneSweeps[k].name, v);
                }
                if (useLfx) lfx.ui.set(zoneSweeps[k].name, v);
                if (useLfxNoBc) lfxNoBc.ui.set(zoneSweeps[k].name, v);
                if (useBitcrush) bitcrush.ui.set(zoneSweeps[k].name, v);
                if (useFlanger) flanger.ui.set(zoneSweeps[k].name, v);
                if (useTremolo) tremolo.ui.set(zoneSweeps[k].name, v);
                if (usePhaser) phaser.ui.set(zoneSweeps[k].name, v);
                if (useDistortion) distortion.ui.set(zoneSweeps[k].name, v);
                if (useVinyl) vinyl.ui.set(zoneSweeps[k].name, v);
                if (useFlutter) flutter.ui.set(zoneSweeps[k].name, v);
            }
        }

        if (useLfx) lfx.obj->compute(nb, monoIn.data(), monoOut.data());
        if (useLfxNoBc) lfxNoBc.obj->compute(nb, monoIn.data(), monoOut.data());
        if (useBitcrush) bitcrush.obj->compute(nb, monoIn.data(), monoOut.data());
        if (useFlanger) flanger.obj->compute(nb, monoIn.data(), monoOut.data());
        if (useTremolo) tremolo.obj->compute(nb, monoIn.data(), monoOut.data());
        if (usePhaser) phaser.obj->compute(nb, monoIn.data(), monoOut.data());
        if (useDistortion) distortion.obj->compute(nb, monoIn.data(), monoOut.data());
        if (useVinyl) vinyl.obj->compute(nb, monoIn.data(), monoOut.data());
        if (useFlutter) flutter.obj->compute(nb, monoIn.data(), monoOut.data());

        if (usePre) {
            for (int c = 0; c < preIn; c++) {
                float v = 0.0f;
                if (c == 3) v = 1.0f;
                else if (c == 4) v = 1.0f;
                else if (c == 8) v = 16.0f;
                for (int i = 0; i < nb; i++) preInBuf[(size_t)c][(size_t)i] = v;
            }
            for (int i = 0; i < nb; i++) {
                preInBuf[0][(size_t)i] = stageBuf[(size_t)i];
                preInBuf[1][(size_t)i] = prevFilt[(size_t)i];
                preInBuf[5][(size_t)i] = masterPhase;
                masterPhase += 1.0f;
            }
            for (int c = 0; c < preIn; c++) preInPtr[(size_t)c] = preInBuf[(size_t)c].data();
            for (int c = 0; c < preOut; c++) preOutPtr[(size_t)c] = preOutBuf[(size_t)c].data();
            pre.obj->compute(nb, preInPtr.data(), preOutPtr.data());

            for (int c = 0; c < postIn; c++) {
                for (int i = 0; i < nb; i++) postInBuf[(size_t)c][(size_t)i] = 0.0f;
            }
            for (int i = 0; i < nb; i++) {
                postInBuf[0][(size_t)i] = preOutBuf[0][(size_t)i];
                postInBuf[1][(size_t)i] = preOutBuf[2][(size_t)i];
                postInBuf[2][(size_t)i] = preOutBuf[3][(size_t)i];
                postInBuf[3][(size_t)i] = preOutBuf[1][(size_t)i];
            }
            for (int c = 0; c < postIn; c++) postInPtr[(size_t)c] = postInBuf[(size_t)c].data();
            for (int c = 0; c < postOut; c++) postOutPtr[(size_t)c] = postOutBuf[(size_t)c].data();
            post.obj->compute(nb, postInPtr.data(), postOutPtr.data());

            for (int i = 0; i < nb; i++) {
                prevFilt[(size_t)i] = postOutBuf[2][(size_t)i];
                float s;
                if (tap == "cue") s = postOutBuf[0][(size_t)i];
                else if (tap == "record") s = postOutBuf[2][(size_t)i];
                else if (tap == "inputfx") s = postOutBuf[3][(size_t)i];
                else if (tap == "loopsum") s = postOutBuf[1][(size_t)i];
                else s = postOutBuf[1][(size_t)i] + postOutBuf[3][(size_t)i];
                stageBuf[(size_t)i] = s;
            }
        }

        if (base >= wu) {
            for (int i = 0; i < n; i++) {
                float v = stageBuf[(size_t)i];
                if (!(v == v) || v > 1.0e30f || v < -1.0e30f) nonFinite++;
                sumSq += (double)v * (double)v;
                float a = v < 0 ? -v : v;
                if (a > peak) peak = a;
                out.push_back(v);
            }
        }
    }

    if (!writeWavF32(outPath, out, sr)) {
        std::printf("write failed %s\n", outPath.c_str());
        return 5;
    }

    double rms = out.empty() ? 0.0 : std::sqrt(sumSq / (double)out.size());
    std::printf("mode=%s tap=%s block=%d warmup=%d gain=%.4f frames=%zu rms=%.6f rms_dbfs=%.2f peak_dbfs=%.2f nonfinite=%lld\n",
                mode.c_str(), tap.c_str(), block, warmup, (double)gain, out.size(),
                rms, dbfs(rms), dbfs((double)peak), nonFinite);
    return 0;
}
