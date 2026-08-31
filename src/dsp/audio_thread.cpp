#include "audio_thread.h"
#include "../host/lv2_host.h"
#include "../control/midi.h"
#include "../link/link_bridge.h"
#include "sampler/sampler.h"
#include "../storage/usb_recorder.h"

#include <pthread.h>
#include <sched.h>
#include <ctime>
#include <cstdio>
#include <cstring>
#include <cerrno>
#include <atomic>
#include <vector>
#include <memory>
#include <algorithm>
#include <cmath>
#include <cstdint>
#if defined(__SSE2__) && !defined(__aarch64__)
#include <xmmintrin.h>
#include <pmmintrin.h>
#endif

#if __has_include(<alsa/asoundlib.h>)
#include <alsa/asoundlib.h>
#define ALOOP_HAVE_ALSA 1
#endif

#include <fstream>
#include <sstream>
#include <string>

static std::string resolveInstrumentDevice(const std::string& configured, const std::string& matchName) {
    if (matchName.empty()) return configured;
    std::ifstream cards("/proc/asound/cards");
    if (!cards.is_open()) return configured;
    std::string line;
    int index = -1;
    while (std::getline(cards, line)) {
        if (line.find(matchName) == std::string::npos) continue;
        std::istringstream iss(line);
        iss >> index;
        if (iss.fail()) { index = -1; continue; }
        break;
    }
    if (index < 0) {
        fprintf(stderr, "[audio] instrument_device_match '%s' not found in /proc/asound/cards -- falling back to configured %s\n",
                matchName.c_str(), configured.c_str());
        return configured;
    }
    char resolved[32];
    snprintf(resolved, sizeof resolved, "hw:%d,0", index);
    fprintf(stderr, "[audio] instrument device '%s' matched card %d -> %s\n", matchName.c_str(), index, resolved);
    return resolved;
}

#if __has_include("loop_pre.cpp") && __has_include("loop_post.cpp")
#define FAUSTFLOAT float
struct FaustMeta { void declare(const char*, const char*) {} };
#include <map>
#include <string>
struct FaustUI {
    std::map<std::string, float*> zones;
    std::vector<std::string> path;
    std::string full(const char* label) const {
        std::string p;
        for (auto& g : path) if (!g.empty()) { p += g; p += "/"; }
        p += label;
        return p;
    }
    void openTabBox(const char* l){ path.push_back(l?l:""); }
    void openHorizontalBox(const char* l){ path.push_back(l?l:""); }
    void openVerticalBox(const char* l){ path.push_back(l?l:""); }
    void closeBox(){ if(!path.empty()) path.pop_back(); }
    void addButton(const char* l, float* z){ zones[full(l)]=z; }
    void addCheckButton(const char* l, float* z){ zones[full(l)]=z; }
    void addVerticalSlider(const char* l, float* z, float, float, float, float){ zones[full(l)]=z; }
    void addHorizontalSlider(const char* l, float* z, float, float, float, float){ zones[full(l)]=z; }
    void addNumEntry(const char* l, float* z, float, float, float, float){ zones[full(l)]=z; }
    void addHorizontalBargraph(const char* l, float* z, float, float){ zones[full(l)]=z; }
    void addVerticalBargraph(const char* l, float* z, float, float){ zones[full(l)]=z; }
    void addSoundfile(const char*, const char*, void**){}
    void declare(float*, const char*, const char*){}
    void set(const char* name, float v){
        auto it=zones.find(name);
        if(it!=zones.end()){ *it->second=v; return; }
        std::string suf(name);
        for(auto& kv:zones){ const std::string& k=kv.first;
            if(k.size()>=suf.size() && k.compare(k.size()-suf.size(), suf.size(), suf)==0){ *kv.second=v; return; } }
    }
    float get(const char* name, float def=0.0f) const {
        auto it=zones.find(name);
        if(it!=zones.end()) return *it->second;
        std::string suf(name);
        for(auto& kv:zones){ const std::string& k=kv.first;
            if(k.size()>=suf.size() && k.compare(k.size()-suf.size(), suf.size(), suf)==0) return *kv.second; }
        return def;
    }
};
#define Meta FaustMeta
#define UI FaustUI
#define dsp FaustDspBase
struct FaustDspBase { virtual ~FaustDspBase(){} };
#include "pitch_ffi.h"
namespace aloopfaustpre {
#include "loop_pre.cpp"
}
namespace aloopfaustpost {
#include "loop_post.cpp"
}
#undef dsp
#define ALOOP_HAVE_FAUST_LOOP 1
#endif

namespace aloop {

namespace {
std::atomic<bool> g_running{false};
pthread_t g_worker;
AudioThread::Telemetry g_telem{};
AudioConfig g_cfg;
ParamStore* g_params = nullptr;
LinkBridge* g_link = nullptr;
aloop::Sampler* g_sampler = nullptr;
aloop::Lv2Host* g_homeFx = nullptr;
aloop::UsbRecorder* g_usbRecorder = nullptr;

float g_manualSpeedMul = 1.0f;
constexpr int kTransposeVoices = 6;

static bool isResonodeLv2ControlTarget(const std::string& target) {
    return target.rfind("fx/resonode/", 0) == 0 || target.rfind("fx/resonodevoice", 0) == 0;
}

static std::string targetToZone(const std::string& target) {
    if (target.rfind("looper", 0) == 0) {
        auto slash = target.find('/');
        if (slash != std::string::npos) {
            int idx = atoi(target.c_str() + 6);
            char z[64];
            snprintf(z, sizeof z, "looper%2d/%s", idx, target.c_str() + slash + 1);
            return z;
        }
    }
    if (target == "fx/hp")      return "HPCUT";
    if (target == "fx/lp")      return "LPCUT";
    if (target == "fx/lpres")   return "LPRES";
    if (target == "fx/reverb")  return "REVAMT";
    if (target == "fx/delay")   return "DELAYAMT";
    if (target == "fx/time")    return "TIME";
    if (target == "fx/formant") return "FORMANT";
    if (target == "fx/pitch")   return "SEMIS";
    if (target == "fx/bank")    return "fx/bank";
    if (target.rfind("fx/dubgate/", 0) == 0) return target;
    if (target.rfind("fx/dublfo/", 0) == 0) return target;
    if (target.rfind("fx/keys/", 0) == 0) return target;
    if (isResonodeLv2ControlTarget(target)) return "";
    return "";
}

bool setRealtimeSelf(int core, int prio) {
    cpu_set_t set;
    CPU_ZERO(&set);
    CPU_SET(core, &set);
    if (pthread_setaffinity_np(pthread_self(), sizeof(set), &set) != 0)
        fprintf(stderr, "[audio] warning: could not pin to core %d\n", core);
    sched_param sp{};
    sp.sched_priority = prio;
    if (pthread_setschedparam(pthread_self(), SCHED_FIFO, &sp) != 0) {
        fprintf(stderr, "[audio] warning: SCHED_FIFO prio %d failed (need rtprio limit)\n", prio);
        return false;
    }
    return true;
}
}

static void setFlushToZero() {
#if defined(__aarch64__)
    uint64_t fpcr;
    __asm__ volatile("mrs %0, fpcr" : "=r"(fpcr));
    fpcr |= (1ULL << 24);
    __asm__ volatile("msr fpcr, %0" :: "r"(fpcr));
#elif defined(__SSE2__)
    _MM_SET_FLUSH_ZERO_MODE(_MM_FLUSH_ZERO_ON);
    _MM_SET_DENORMALS_ZERO_MODE(_MM_DENORMALS_ZERO_ON);
#endif
}

// True retrigger/reorder beat shuffle, matching microrepeat.dsp's safe
// capture-and-replay architecture (a bounded ring buffer replaying already-
// captured audio, never a continuous-position perturbation) -- a genuinely
// DIFFERENT effect from swing/groove offset. Earlier attempts perturbed
// masterPhaseBuf's continuous read position with a step-function offset;
// WITNESSED live as a "double-tap": any step whose offset went NEGATIVE
// relative to the previous step made playback jump backward into audio it
// had just played, an inherent flaw of perturbing a continuous position
// with a non-monotonic pattern, not fixable by tuning magnitudes.
//
// One beat = one slice. Over the 4-beat shuffle cycle, each of the 15
// non-empty button-combination bitmasks selects its OWN fixed 4-entry
// REORDER sequence -- which of the loop's own 4 beat-positions' content
// plays at each of the 4 beat positions this cycle. Most patterns are pure
// permutations (every beat played exactly once, just rearranged); several
// allow a repeat+skip for a stutter character, per direct spec. Defined
// per-bitmask directly (not composed from 4 base tables at runtime) because
// composing stutter/skip tables sequentially is not generally invertible --
// verified this produced 3 real collisions (masks 6/14, 7/15, 12/13 all
// converged to the same result) before switching to explicit per-mask
// tables, each hand-picked and programmatically verified pairwise distinct.
// Beat boundaries are the ONLY moments the read pointer can change slice --
// within a beat, playback always reads forward through that beat's own
// already-recorded loop content, so it can never double back into audio it
// just played this pass.
static constexpr int kShuffleReorderTables[16][4] = {
    { 0, 1, 2, 3 },  // mask 0: unused (shuffle inactive)
    { 0, 1, 3, 2 },  // mask  1 (0001)
    { 0, 1, 1, 3 },  // mask  2 (0010)
    { 1, 0, 3, 2 },  // mask  3 (0011)
    { 3, 2, 1, 0 },  // mask  4 (0100)
    { 3, 0, 1, 2 },  // mask  5 (0101)
    { 3, 2, 2, 0 },  // mask  6 (0110)
    { 0, 3, 1, 2 },  // mask  7 (0111)
    { 0, 0, 2, 3 },  // mask  8 (1000)
    { 0, 0, 3, 1 },  // mask  9 (1001)
    { 2, 0, 0, 3 },  // mask 10 (1010)
    { 1, 3, 0, 0 },  // mask 11 (1011)
    { 2, 3, 0, 1 },  // mask 12 (1100)
    { 3, 1, 0, 2 },  // mask 13 (1101)
    { 1, 2, 3, 0 },  // mask 14 (1110)
    { 2, 1, 3, 0 },  // mask 15 (1111)
};

static void* worker(void*) {
    setRealtimeSelf(g_cfg.homeFxCore, g_cfg.rtPriority);
    setFlushToZero();
    const int N = g_cfg.blockSize;
    const int ch = g_cfg.channels;

    const int wireCh = (ch < 2) ? 2 : ch;

    std::vector<int32_t> buf((size_t)N * wireCh, 0);
    std::vector<int16_t> otgBuf((size_t)N * wireCh, 0);
    std::vector<float> fin((size_t)N, 0.0f), fout((size_t)N, 0.0f);
    std::vector<float> prevLoopSum((size_t)N, 0.0f);
    std::vector<float> prevFiltOut((size_t)N, 0.0f);

#ifdef ALOOP_HAVE_FAUST_LOOP
    auto faustPrePtr = std::make_unique<aloopfaustpre::AloopPreDsp>();
    aloopfaustpre::AloopPreDsp& faustPre = *faustPrePtr;
    faustPre.init((int)g_cfg.sampleRate);
    FaustUI fuiPre; faustPre.buildUserInterface(&fuiPre);
    auto faustPostPtr = std::make_unique<aloopfaustpost::AloopPostDsp>();
    aloopfaustpost::AloopPostDsp& faustPost = *faustPostPtr;
    faustPost.init((int)g_cfg.sampleRate);
    FaustUI fuiPost; faustPost.buildUserInterface(&fuiPost);
    std::vector<float> clearBuf((size_t)N, 0.0f);
    std::vector<float> speedBuf((size_t)N, 1.0f);
    std::vector<float> masterPhaseBuf((size_t)N, 0.0f);
    std::vector<float> masterLenBuf((size_t)N, 0.0f);
    std::vector<float> sidechainEnvBuf((size_t)N, 0.0f);
    std::vector<float> recordedBeatsBuf((size_t)N, 16.0f);
    std::vector<float> freeXposeBuf((size_t)N, 0.0f);
    std::vector<float> xposeNoteBuf[kTransposeVoices];
    std::vector<float> xposeGateBuf[kTransposeVoices];
    for (int v = 0; v < kTransposeVoices; v++) {
        xposeNoteBuf[v].assign((size_t)N, 0.0f);
        xposeGateBuf[v].assign((size_t)N, 0.0f);
    }
    std::vector<float> resonodeInBuf((size_t)N, 0.0f);
    std::vector<float> pitchTrackerBuf((size_t)N, 60.0f);
    float extFreqGuardAnchor = 0.0f;
    float extFreqGuardCandidate = 0.0f;
    int extFreqGuardStreakBlocks = 0;
    int extFreqGuardSilenceBlocks = 0;
    std::vector<float> preFilterOutBuf((size_t)N, 0.0f);
    std::vector<float> loopHarmonyWetBuf((size_t)N, 0.0f);
    std::vector<float> masterGatedBuf((size_t)N, 0.0f);
    std::vector<float> loopSumPreBuf((size_t)N, 0.0f);
    std::vector<float> cueWetBuf((size_t)N, 0.0f);
    std::vector<float> masterWetBuf((size_t)N, 0.0f);
    float* fins[22] = {
        fin.data(), prevFiltOut.data(), clearBuf.data(), speedBuf.data(), masterPhaseBuf.data(), masterLenBuf.data(), sidechainEnvBuf.data(),
        recordedBeatsBuf.data(),
        freeXposeBuf.data(),
        xposeNoteBuf[0].data(), xposeGateBuf[0].data(),
        xposeNoteBuf[1].data(), xposeGateBuf[1].data(),
        xposeNoteBuf[2].data(), xposeGateBuf[2].data(),
        xposeNoteBuf[3].data(), xposeGateBuf[3].data(),
        xposeNoteBuf[4].data(), xposeGateBuf[4].data(),
        xposeNoteBuf[5].data(), xposeGateBuf[5].data(),
        resonodeInBuf.data(),
    };
    float* preOuts[4] = {
        preFilterOutBuf.data(), loopHarmonyWetBuf.data(), masterGatedBuf.data(), loopSumPreBuf.data(),
    };
    float* postIns[18] = {
        cueWetBuf.data(), masterWetBuf.data(), loopSumPreBuf.data(), loopHarmonyWetBuf.data(),
        freeXposeBuf.data(),
        xposeNoteBuf[0].data(), xposeGateBuf[0].data(),
        xposeNoteBuf[1].data(), xposeGateBuf[1].data(),
        xposeNoteBuf[2].data(), xposeGateBuf[2].data(),
        xposeNoteBuf[3].data(), xposeGateBuf[3].data(),
        xposeNoteBuf[4].data(), xposeGateBuf[4].data(),
        xposeNoteBuf[5].data(), xposeGateBuf[5].data(),
    };
    int sidechainSrcSlot[AudioThread::Telemetry::kLoopers];
    for (int lp = 0; lp < AudioThread::Telemetry::kLoopers; lp++) sidechainSrcSlot[lp] = -1;
    int clearAllSlot = -1;
    int halfSpeedSlot = -1;
    int doubleSpeedSlot = -1;
    int stopAllSlot = -1;
    int monitorFoldSlot = -1;
    int pitchSlot = -1;
    int pitchbendEngagedSlot = -1;
    int pitchbendSlot = -1;
    int microrepeatDivSlot = -1;
    int masterLenSlot = -1;
    int recordedBpmSlot = -1;
    int recordedBeatsSlot = -1;
    int slotProbeEpoch = -1;
    const float kFoldStepPerSample = (1.0f / 16.0f) / (float)N;
    float loopDirectGateNow = 1.0f;
    struct ResolvedControl { int slot; float* zone; };
    std::vector<ResolvedControl> resolvedControls;
    int resolvedControlsForCount = -1;
    struct LooperTelemetryZones { float* rec=nullptr; float* play=nullptr; float* vol=nullptr; float* level=nullptr; float* writeidx=nullptr; float* wraplen=nullptr; float* readpos=nullptr; };
    LooperTelemetryZones looperTelemetryZones[AudioThread::Telemetry::kLoopers];
    float* looperLenZone[AudioThread::Telemetry::kLoopers] = {nullptr};
    float* mlbZone = nullptr;
    float* recordedBeatsZone = nullptr;
    float* semisZone = nullptr;
    float* engagedZone = nullptr;
    float* divZone = nullptr;
    float* monitorFoldFaustZone = nullptr;
    float* glitchFoldFaustZone = nullptr;
    float* sustainGateFaustZone = nullptr;
    float* resonodeEngagedZone = nullptr;
    float* extFreqDetZone = nullptr;
    float* dubgateClockphaseZone = nullptr;
    {
        char z[32];
        auto resolveZone = [&]() -> float* {
            std::string suf(z);
            for (FaustUI* ui : { &fuiPre, &fuiPost }) {
                auto it = ui->zones.find(z);
                if (it != ui->zones.end()) return it->second;
                for (auto& kv : ui->zones) {
                    const std::string& k = kv.first;
                    if (k.size() >= suf.size() && k.compare(k.size() - suf.size(), suf.size(), suf) == 0) return kv.second;
                }
            }
            return nullptr;
        };
        for (int lp = 0; lp < AudioThread::Telemetry::kLoopers; lp++) {
            auto& tz = looperTelemetryZones[lp];
            snprintf(z, sizeof z, "looper%2d/rec",  lp);         tz.rec      = resolveZone();
            snprintf(z, sizeof z, "looper%2d/play", lp);         tz.play     = resolveZone();
            snprintf(z, sizeof z, "looper%2d/vol",  lp);         tz.vol      = resolveZone();
            snprintf(z, sizeof z, "looper%2d/level", lp);        tz.level    = resolveZone();
            snprintf(z, sizeof z, "looper%2d/writeidx", lp);     tz.writeidx = resolveZone();
            snprintf(z, sizeof z, "looper%2d/wraplen", lp);      tz.wraplen  = resolveZone();
            snprintf(z, sizeof z, "looper%2d/readposdiag2", lp); tz.readpos  = resolveZone();
        }
        for (int lp = 0; lp < AudioThread::Telemetry::kLoopers; lp++) {
            snprintf(z, sizeof z, "looper%2d/len", lp);
            looperLenZone[lp] = resolveZone();
        }
        snprintf(z, sizeof z, "MLB");                 mlbZone              = resolveZone();
        snprintf(z, sizeof z, "RECORDEDBEATS");        recordedBeatsZone    = resolveZone();
        snprintf(z, sizeof z, "SEMIS");                semisZone            = resolveZone();
        snprintf(z, sizeof z, "ENGAGED");              engagedZone          = resolveZone();
        snprintf(z, sizeof z, "DIV");                  divZone              = resolveZone();
        snprintf(z, sizeof z, "MONITORFOLD");          monitorFoldFaustZone = resolveZone();
        snprintf(z, sizeof z, "GLITCHFOLD");           glitchFoldFaustZone  = resolveZone();
        snprintf(z, sizeof z, "SUSTAINGATE");          sustainGateFaustZone = resolveZone();
        snprintf(z, sizeof z, "fx/resonode/engaged");  resonodeEngagedZone  = resolveZone();
        snprintf(z, sizeof z, "fx/extfreqdet");        extFreqDetZone       = resolveZone();
        snprintf(z, sizeof z, "fx/dubgate/clockphase"); dubgateClockphaseZone = resolveZone();
    }
    int xposeNoteSlot[kTransposeVoices];
    int xposeGateSlot[kTransposeVoices];
    {
        char z[32];
        for (int v = 0; v < kTransposeVoices; v++) {
            snprintf(z, sizeof z, "fx/xpose%d/note", v);
            xposeNoteSlot[v] = g_params ? g_params->getSlot(z) : -1;
            snprintf(z, sizeof z, "fx/xpose%d/gate", v);
            xposeGateSlot[v] = g_params ? g_params->getSlot(z) : -1;
        }
    }
    struct ResonodeParamSlot { int slot; std::string lv2Symbol; float lastValue; bool hasValue; };
    std::vector<ResonodeParamSlot> resonodeParamSlots;
    int resonodeEngagedSlot = -1;
    int resonodeParamSlotsForCount = -1;
    struct DelayVerbParamSlot { int slot; const char* target; const char* lv2Label; float lastValue; bool hasValue; };
    DelayVerbParamSlot delayVerbParamSlots[3] = {
        { -1, "fx/delay",  "DELAYAMT", 0.0f, false },
        { -1, "fx/reverb", "REVAMT",   0.0f, false },
        { -1, "fx/time",   "TIME",     0.5f, false },
    };
    std::vector<float> rawLoopSum((size_t)N, 0.0f);
    std::vector<float> rawFiltTap((size_t)N, 0.0f);
    std::vector<float> inputFxOut((size_t)N, 0.0f);
    float* postOuts[4] = { fout.data(), rawLoopSum.data(), rawFiltTap.data(), inputFxOut.data() };
    int sustainSlot = -1;
#endif

#ifdef ALOOP_HAVE_FAUST_LOOP
    auto samplerPtr = std::make_unique<Sampler>();
    g_sampler = samplerPtr.get();
    std::vector<int32_t> samplerBuf((size_t)N, 0);
#endif

    Lv2Host homeFx;
    homeFx.loadDir(g_cfg.homeDir, g_cfg.userFxCore);
    homeFx.connect(N, ch);
    g_homeFx = &homeFx;
    Lv2Host::ControlHandle gatePhaseHandle = homeFx.resolveControl("fx2/GATEPHASE");

    Lv2Host userFx;
    userFx.loadDir(g_cfg.userDir, g_cfg.userFxCore);
    userFx.connect(N, ch);

    Lv2Host resonodeFx;
    resonodeFx.loadDir(g_cfg.resonodeDir, g_cfg.homeFxCore);
    resonodeFx.connect(N, ch);

    Lv2Host pitchTrackerFx;
    pitchTrackerFx.loadDir(g_cfg.pitchTrackerDir, g_cfg.homeFxCore);
    pitchTrackerFx.connect(N, ch);

    Lv2Host delayVerbFxCue;
    delayVerbFxCue.loadDir(g_cfg.delayVerbDir, g_cfg.homeFxCore);
    delayVerbFxCue.connect(N, ch);

    Lv2Host delayVerbFxMaster;
    delayVerbFxMaster.loadDir(g_cfg.delayVerbDir, g_cfg.homeFxCore);
    delayVerbFxMaster.connect(N, ch);

    UsbRecorder usbRecorder(g_cfg.usbMountPoint, g_cfg.sampleRate, g_cfg.usbChunkMinutes, g_cfg.usbChunkCount);
    if (g_cfg.usbRecordEnabled) g_usbRecorder = &usbRecorder;

#ifdef ALOOP_HAVE_ALSA
    snd_pcm_t *cap = nullptr, *play = nullptr;
    const int kAlsaOpenRetries = 30;
    std::string wireDevStr;
    for (int attempt = 0; attempt < kAlsaOpenRetries; attempt++) {
        wireDevStr = resolveInstrumentDevice(g_cfg.instrumentDevice, g_cfg.instrumentDeviceMatch);
        const char* wireDev = wireDevStr.c_str();
        if (snd_pcm_open(&cap,  wireDev, SND_PCM_STREAM_CAPTURE,  0) == 0 &&
            snd_pcm_open(&play, wireDev, SND_PCM_STREAM_PLAYBACK, 0) == 0) break;
        if (cap)  { snd_pcm_close(cap);  cap  = nullptr; }
        if (play) { snd_pcm_close(play); play = nullptr; }
        if (attempt == 0) fprintf(stderr, "[audio] ALSA open of %s failed — is the instrument USB audio interface plugged in? retrying...\n", wireDev);
        struct timespec ts{1, 0}; nanosleep(&ts, nullptr);
    }
    if (!cap || !play) {
        fprintf(stderr, "[audio] ALSA still unavailable after %ds — is the instrument USB audio interface plugged in? audio stays down until restart\n", kAlsaOpenRetries);
    } else {
        auto configurePcm = [&](snd_pcm_t* pcm) -> bool {
            snd_pcm_hw_params_t* hw;
            snd_pcm_hw_params_alloca(&hw);
            snd_pcm_hw_params_any(pcm, hw);
            snd_pcm_hw_params_set_access(pcm, hw, SND_PCM_ACCESS_RW_INTERLEAVED);
            if (snd_pcm_hw_params_set_format(pcm, hw, SND_PCM_FORMAT_S32_LE) < 0)
                fprintf(stderr, "[audio] warning: instrument device rejected S32_LE format request\n");
            snd_pcm_hw_params_set_channels(pcm, hw, wireCh);
            unsigned int rate = (unsigned int)g_cfg.sampleRate;
            snd_pcm_hw_params_set_rate_near(pcm, hw, &rate, nullptr);
            snd_pcm_uframes_t period = (snd_pcm_uframes_t)N;
            snd_pcm_hw_params_set_period_size_near(pcm, hw, &period, nullptr);
            snd_pcm_uframes_t bufSize = period * 4;
            snd_pcm_hw_params_set_buffer_size_near(pcm, hw, &bufSize);
            if (snd_pcm_hw_params(pcm, hw) < 0) return false;
            snd_pcm_format_t negotiatedFmt;
            if (snd_pcm_hw_params_get_format(hw, &negotiatedFmt) == 0 && negotiatedFmt != SND_PCM_FORMAT_S32_LE)
                fprintf(stderr, "[audio] warning: instrument device negotiated format %s, not S32_LE — audio will be corrupted (buf is int32_t)\n",
                        snd_pcm_format_name(negotiatedFmt));
            if (period != (snd_pcm_uframes_t)N)
                fprintf(stderr, "[audio] warning: device would not grant period=%d frames, got %lu — latency will not match block_size\n",
                        N, (unsigned long)period);
            snd_pcm_sw_params_t* sw;
            snd_pcm_sw_params_alloca(&sw);
            snd_pcm_sw_params_current(pcm, sw);
            snd_pcm_sw_params_set_start_threshold(pcm, sw, period);
            snd_pcm_sw_params_set_avail_min(pcm, sw, period);
            if (snd_pcm_sw_params(pcm, sw) < 0)
                fprintf(stderr, "[audio] warning: sw_params (start_threshold) rejected — playback may not auto-start\n");
            return true;
        };
        if (!configurePcm(cap) || !configurePcm(play))
            fprintf(stderr, "[audio] warning: explicit hw_params rejected by %s — falling back to driver defaults (higher latency)\n", wireDevStr.c_str());
        snd_pcm_prepare(cap);
        snd_pcm_prepare(play);

        snd_pcm_t* otgPlay = nullptr;
        bool otgReady = false;
        if (snd_pcm_open(&otgPlay, g_cfg.audioDevice.c_str(), SND_PCM_STREAM_PLAYBACK, SND_PCM_NONBLOCK) == 0) {
            snd_pcm_hw_params_t* ohw;
            snd_pcm_hw_params_alloca(&ohw);
            snd_pcm_hw_params_any(otgPlay, ohw);
            snd_pcm_hw_params_set_access(otgPlay, ohw, SND_PCM_ACCESS_RW_INTERLEAVED);
            snd_pcm_hw_params_set_format(otgPlay, ohw, SND_PCM_FORMAT_S16_LE);
            snd_pcm_hw_params_set_channels(otgPlay, ohw, wireCh);
            unsigned int otgRate = (unsigned int)g_cfg.sampleRate;
            snd_pcm_hw_params_set_rate_near(otgPlay, ohw, &otgRate, nullptr);
            snd_pcm_uframes_t otgPeriod = (snd_pcm_uframes_t)N * 4;
            snd_pcm_hw_params_set_period_size_near(otgPlay, ohw, &otgPeriod, nullptr);
            snd_pcm_uframes_t otgBufFrames = otgPeriod * 4;
            snd_pcm_hw_params_set_buffer_size_near(otgPlay, ohw, &otgBufFrames);
            if (snd_pcm_hw_params(otgPlay, ohw) == 0) {
                snd_pcm_sw_params_t* osw;
                snd_pcm_sw_params_alloca(&osw);
                snd_pcm_sw_params_current(otgPlay, osw);
                snd_pcm_sw_params_set_start_threshold(otgPlay, osw, otgPeriod);
                snd_pcm_sw_params_set_avail_min(otgPlay, osw, otgPeriod);
                snd_pcm_sw_params(otgPlay, osw);
                snd_pcm_prepare(otgPlay);
                otgReady = true;
            }
        }
        if (!otgReady) {
            fprintf(stderr, "[audio] OTG gadget mirror (%s) unavailable — instrument-device audio is unaffected, gadget mirror stays off until it appears\n", g_cfg.audioDevice.c_str());
            if (otgPlay) { snd_pcm_close(otgPlay); otgPlay = nullptr; }
        }

        timespec lastReadTs{}; bool haveLastReadTs = false;
        const double kExpectedPeriodMs = (double)N / g_cfg.sampleRate * 1000.0;
        while (g_running.load()) {
            timespec nowTs; clock_gettime(CLOCK_MONOTONIC, &nowTs);
            if (haveLastReadTs) {
                double gapMs = (nowTs.tv_sec - lastReadTs.tv_sec) * 1000.0 + (nowTs.tv_nsec - lastReadTs.tv_nsec) / 1e6;
                if (gapMs > kExpectedPeriodMs * 1.5) {
                    fprintf(stderr, "[diag-gap] t=%ld.%03ld readi gap=%.3fms (expected ~%.3fms)\n",
                            (long)nowTs.tv_sec, nowTs.tv_nsec / 1000000, gapMs, kExpectedPeriodMs);
                }
            }
            lastReadTs = nowTs;
            haveLastReadTs = true;
            timespec readStartTs; clock_gettime(CLOCK_MONOTONIC, &readStartTs);
            snd_pcm_sframes_t r = snd_pcm_readi(cap, buf.data(), N);
            timespec readEndTs; clock_gettime(CLOCK_MONOTONIC, &readEndTs);
            {
                double readMs = (readEndTs.tv_sec - readStartTs.tv_sec) * 1000.0 + (readEndTs.tv_nsec - readStartTs.tv_nsec) / 1e6;
                if (readMs > kExpectedPeriodMs * 1.5) {
                    fprintf(stderr, "[diag-gap] t=%ld.%03ld readi ITSELF took=%.3fms (expected ~%.3fms)\n",
                            (long)readEndTs.tv_sec, readEndTs.tv_nsec / 1000000, readMs, kExpectedPeriodMs);
                }
            }
            if (r < 0) { g_telem.xruns++; snd_pcm_recover(cap, (int)r, 1); continue; }

#ifdef ALOOP_HAVE_FAUST_LOOP
            float monitorFoldVal = 0.0f;
            float microrepeatDivVal = 0.0f;
            float masterLenVal = 0.0f;
            float recordedBpmVal = 0.0f;
            if (g_params) {
                if (resolvedControlsForCount != g_params->count) {
                    resolvedControls.clear();
                    g_params->forEach([&](const std::string& target, int slotIdx){
                        std::string zone = targetToZone(target);
                        if (zone.empty()) return;
                        auto findIn = [&](FaustUI& ui) -> std::map<std::string, float*>::iterator {
                            auto it = ui.zones.find(zone);
                            if (it != ui.zones.end()) return it;
                            for (auto kv = ui.zones.begin(); kv != ui.zones.end(); ++kv) {
                                const std::string& k = kv->first;
                                if (k.size() >= zone.size() && k.compare(k.size() - zone.size(), zone.size(), zone) == 0)
                                    return kv;
                            }
                            return ui.zones.end();
                        };
                        float* zonePtr = nullptr;
                        auto it = findIn(fuiPre);
                        if (it != fuiPre.zones.end()) zonePtr = it->second;
                        else {
                            auto jt = findIn(fuiPost);
                            if (jt != fuiPost.zones.end()) zonePtr = jt->second;
                        }
                        if (zonePtr) resolvedControls.push_back({slotIdx, zonePtr});
                    });
                    resolvedControlsForCount = g_params->count;
                }
                for (auto& rc : resolvedControls) *rc.zone = g_params->getBySlot(rc.slot);
                if (resonodeParamSlotsForCount != g_params->count) {
                    resonodeParamSlots.clear();
                    resonodeEngagedSlot = -1;
                    g_params->forEach([&](const std::string& target, int slotIdx){
                        if (target == "fx/resonode/engaged") { resonodeEngagedSlot = slotIdx; return; }
                        if (isResonodeLv2ControlTarget(target)) {
                            resonodeParamSlots.push_back({slotIdx, target});
                        }
                    });
                    resonodeParamSlotsForCount = g_params->count;
                }
                for (auto& rp : resonodeParamSlots) {
                    float v = g_params->getBySlot(rp.slot);
                    if (!rp.hasValue || v != rp.lastValue) {
                        resonodeFx.setControl(rp.lv2Symbol, v);
                        rp.lastValue = v;
                        rp.hasValue = true;
                    }
                }
                for (auto& dp : delayVerbParamSlots) {
                    if (dp.slot < 0) continue;
                    float v = g_params->getBySlot(dp.slot);
                    if (!dp.hasValue || v != dp.lastValue) {
                        delayVerbFxCue.setControl(dp.lv2Label, v);
                        delayVerbFxMaster.setControl(dp.lv2Label, v);
                        dp.lastValue = v;
                        dp.hasValue = true;
                    }
                }
                if (slotProbeEpoch != g_params->count) {
                    slotProbeEpoch = g_params->count;
                    if (clearAllSlot < 0) clearAllSlot = g_params->getSlot("cmd/clearall");
                    if (halfSpeedSlot < 0) halfSpeedSlot = g_params->getSlot("cmd/halfspeed");
                    if (doubleSpeedSlot < 0) doubleSpeedSlot = g_params->getSlot("cmd/doublespeed");
                    if (stopAllSlot < 0) stopAllSlot = g_params->getSlot("cmd/stopall");
                    if (monitorFoldSlot < 0) monitorFoldSlot = g_params->getSlot("fx/monitorfold");
                    if (pitchSlot < 0) pitchSlot = g_params->getSlot("fx/pitch");
                    if (pitchbendEngagedSlot < 0) pitchbendEngagedSlot = g_params->getSlot("fx/pitchbend_engaged");
                    if (pitchbendSlot < 0) pitchbendSlot = g_params->getSlot("fx/pitchbend");
                    if (microrepeatDivSlot < 0) microrepeatDivSlot = g_params->getSlot("fx/microrepeat_div");
                    if (masterLenSlot < 0) masterLenSlot = g_params->getSlot("cmd/master_len");
                    if (recordedBpmSlot < 0) recordedBpmSlot = g_params->getSlot("cmd/recorded_bpm");
                    if (recordedBeatsSlot < 0) recordedBeatsSlot = g_params->getSlot("cmd/recorded_beats");
                    for (auto& dp : delayVerbParamSlots) {
                        if (dp.slot < 0) dp.slot = g_params->getSlot(dp.target);
                    }
                }
                bool clearAllHeld = g_params->getBySlot(clearAllSlot) > 0.5f;
                std::fill(clearBuf.begin(), clearBuf.end(), clearAllHeld ? 1.0f : 0.0f);
                if (clearAllHeld) {
                    g_params->setByName("cmd/master_len", 0.0f);
                    g_params->setByName("cmd/recorded_bpm", 0.0f);
                }
                monitorFoldVal = g_params->getBySlot(monitorFoldSlot);
                microrepeatDivVal = g_params->getBySlot(microrepeatDivSlot);
                masterLenVal = g_params->getBySlot(masterLenSlot);
                recordedBpmVal = g_params->getBySlot(recordedBpmSlot);
                float manualSpeedMul = 1.0f;
                if (g_params->getBySlot(halfSpeedSlot)   > 0.5f) manualSpeedMul = 0.5f;
                if (g_params->getBySlot(doubleSpeedSlot) > 0.5f) manualSpeedMul = 2.0f;
                g_manualSpeedMul = manualSpeedMul;
                if (g_params->getBySlot(stopAllSlot) > 0.5f) {
                    for (int lp = 0; lp < 20; lp++) {
                        if (looperTelemetryZones[lp].play) *looperTelemetryZones[lp].play = 0.0f;
                    }
                }
                for (int v = 0; v < kTransposeVoices; v++) {
                    std::fill(xposeNoteBuf[v].begin(), xposeNoteBuf[v].end(), g_params->getBySlot(xposeNoteSlot[v]));
                    std::fill(xposeGateBuf[v].begin(), xposeGateBuf[v].end(), g_params->getBySlot(xposeGateSlot[v]));
                }
                std::fill(freeXposeBuf.begin(), freeXposeBuf.end(), monitorFoldVal > 0.5f ? 1.0f : 0.0f);
                float staticSemis = g_params->getBySlot(pitchSlot);
                if (g_params->getBySlot(pitchbendEngagedSlot) > 0.5f) {
                    if (semisZone) *semisZone = staticSemis + g_params->getBySlot(pitchbendSlot);
                    if (engagedZone) *engagedZone = 1.0f;
                } else {
                    if (semisZone) *semisZone = staticSemis;
                }
                if (divZone) *divZone = microrepeatDivVal;
            }
            {
                for (int lp = 0; lp < AudioThread::Telemetry::kLoopers; lp++) {
                    auto& tz = looperTelemetryZones[lp];
                    g_telem.looperRec[lp]      = tz.rec      && *tz.rec > 0.5f;
                    g_telem.looperPlay[lp]     = tz.play     && *tz.play > 0.5f;
                    g_telem.looperVol[lp]      = tz.vol      ? *tz.vol : 1.0f;
                    g_telem.looperLevel[lp]    = tz.level    ? *tz.level : 0.0f;
                    g_telem.looperWriteIdx[lp] = tz.writeidx ? *tz.writeidx : 0.0f;
                    g_telem.looperWrapLen[lp]  = tz.wraplen  ? *tz.wraplen : 0.0f;
                    g_telem.looperReadPos[lp]  = tz.readpos  ? *tz.readpos : 0.0f;
                }
            }
            g_telem.monitorMode = g_params && monitorFoldVal > 0.5f;
            g_telem.glitchEngaged = g_params && microrepeatDivVal > 0.5f;
            bool linkDrivingLength = false;
            LinkSnapshot linkSnap{};
            if (g_link) {
                linkSnap = g_link->audioRead();
                g_telem.linkSynced = linkSnap.synced;
                g_telem.bpm = linkSnap.bpm;
                g_telem.linkPeers = linkSnap.peerCount;
                g_telem.linkPlaying = linkSnap.isPlaying;
                if (linkSnap.synced && linkSnap.bpm > 1.0) {
                    linkDrivingLength = true;
                    double beatsPerBar = 4.0;
                    double samplesPerBeat = (g_cfg.sampleRate * 60.0) / linkSnap.bpm;
                    double lenSamples = samplesPerBeat * beatsPerBar;
                    for (int lp = 0; lp < 20; lp++) {
                        if (looperLenZone[lp]) *looperLenZone[lp] = (float)lenSamples;
                    }
                    if (mlbZone) *mlbZone = (float)(lenSamples / N);
                    if (recordedBeatsZone) *recordedBeatsZone = (float)beatsPerBar;
                }
            }
            if (!linkDrivingLength && g_params) {
                if (mlbZone) *mlbZone = masterLenVal > 0.0f ? (masterLenVal / (float)N) : 0.0f;
            }
            float linkSpeedRatio = 1.0f;
            if (linkDrivingLength && g_params && g_link) {
                float recordedBpm = recordedBpmVal;
                if (!linkSnap.weOwnTempo && recordedBpm > 1.0f && linkSnap.bpm > 1.0) {
                    linkSpeedRatio = recordedBpm / (float)linkSnap.bpm;
                }
            }
            {
                float effSpeed = g_manualSpeedMul * linkSpeedRatio;
                std::fill(speedBuf.begin(), speedBuf.end(), effSpeed);
                g_telem.effSpeed = effSpeed;
            }
            {
                static double masterPhaseSamples = 0.0;
                static double standaloneQuantumPhaseSamples = 0.0;
                static int64_t lastLinkPhaseMicroBeats = -1;
                static double lastLinkBpmSeen = 0.0;
                static int tempoStableBlocks = 0;
                static double shuffleClockSamples = 0.0;
                static int shuffleMaskSlot = -1;
                if (shuffleMaskSlot < 0 && g_params) shuffleMaskSlot = g_params->getSlot("fx/shuffle/mask");
                int shuffleMaskNow = shuffleMaskSlot >= 0 && g_params
                    ? (int)g_params->getBySlot(shuffleMaskSlot) : 0;

                float masterLen = masterLenVal;
                float recordedBeatsShared = g_params ? g_params->getBySlot(recordedBeatsSlot, 16.0f) : 16.0f;
                if (recordedBeatsShared < 1.0f) recordedBeatsShared = 16.0f;
                if (!linkDrivingLength && recordedBeatsZone) *recordedBeatsZone = recordedBeatsShared;
                double beatLenSamplesShared = masterLen > 0.0f
                    ? (double)masterLen / (double)recordedBeatsShared
                    : (double)g_cfg.sampleRate * 0.5;
                double fourBeatLenShared = beatLenSamplesShared * 4.0;

                if (masterLen > 0.0f) {
                    masterPhaseSamples += (double)N;
                    if (linkDrivingLength && g_link) {
                        double curBpm = linkSnap.bpm;
                        bool bpmChanged = lastLinkBpmSeen > 0.0 && std::fabs(curBpm - lastLinkBpmSeen) > 0.05;
                        lastLinkBpmSeen = curBpm;
                        tempoStableBlocks = bpmChanged ? 0 : (tempoStableBlocks + 1);
                        const int kTempoStableBlocksThreshold = (int)(g_cfg.sampleRate / (double)N);

                        bool freshSnapshot = linkSnap.phaseValid && linkSnap.quantumMicroBeats > 0 &&
                                              linkSnap.beatPhaseMicroBeats != lastLinkPhaseMicroBeats;
                        if (freshSnapshot) {
                            lastLinkPhaseMicroBeats = linkSnap.beatPhaseMicroBeats;
                            double linkQuantumFrac = (double)linkSnap.beatPhaseMicroBeats / (double)linkSnap.quantumMicroBeats;
                            if (linkQuantumFrac < 0.0) linkQuantumFrac = 0.0;
                            if (linkQuantumFrac >= 1.0) linkQuantumFrac = 0.0;
                            double linkBeatWithinQuantum = linkQuantumFrac * kLinkQuantum;
                            double loopBeatPos = std::fmod(linkBeatWithinQuantum, (double)recordedBeatsShared);
                            if (loopBeatPos < 0.0) loopBeatPos += recordedBeatsShared;
                            double linkTargetSamples = loopBeatPos * beatLenSamplesShared;

                            double halfLen = (double)masterLen * 0.5;
                            double delta = std::fmod(linkTargetSamples - masterPhaseSamples + halfLen, (double)masterLen);
                            if (delta < 0.0) delta += masterLen;
                            delta -= halfLen;
                            bool largeDrift = std::fabs(delta) > halfLen * 0.5;
                            bool tempoStable = tempoStableBlocks >= kTempoStableBlocksThreshold;
                            masterPhaseSamples += (largeDrift && tempoStable) ? delta : delta * 0.02;
                        }
                    } else {
                        lastLinkBpmSeen = 0.0;
                        tempoStableBlocks = 0;
                        lastLinkPhaseMicroBeats = -1;
                    }
                    masterPhaseSamples = std::fmod(masterPhaseSamples, (double)masterLen);
                    if (masterPhaseSamples < 0.0) masterPhaseSamples += masterLen;

                    float recordedBpmForQuantum = recordedBpmVal;
                    if (recordedBpmForQuantum > 1.0f) {
                        double quantumSamples = (g_cfg.sampleRate * 60.0 / (double)recordedBpmForQuantum) * 16.0;
                        standaloneQuantumPhaseSamples += (double)N;
                        standaloneQuantumPhaseSamples = std::fmod(standaloneQuantumPhaseSamples, quantumSamples);
                        if (standaloneQuantumPhaseSamples < 0.0) standaloneQuantumPhaseSamples += quantumSamples;
                    } else {
                        standaloneQuantumPhaseSamples = masterPhaseSamples;
                    }
                } else {
                    masterPhaseSamples = 0.0;
                    standaloneQuantumPhaseSamples = 0.0;
                    lastLinkPhaseMicroBeats = -1;
                }

                double shuffleClockStart = shuffleClockSamples;
                shuffleClockSamples += (double)N;
                shuffleClockSamples = std::fmod(shuffleClockSamples, fourBeatLenShared);
                if (shuffleClockSamples < 0.0) shuffleClockSamples += fourBeatLenShared;
                {
                    double gatePhase01 = shuffleClockStart / fourBeatLenShared;
                    if (gatePhase01 < 0.0) gatePhase01 = 0.0;
                    if (gatePhase01 >= 1.0) gatePhase01 = 0.0;
                    Lv2Host::setControlFast(gatePhaseHandle, (float)gatePhase01);
                    if (dubgateClockphaseZone) *dubgateClockphaseZone = (float)gatePhase01;
                }

                // Beat-reorder shuffle: shuffleMaskNow (0-15, one bit per held button)
                // directly indexes kShuffleReorderTables -- each of the 15 non-empty
                // masks has its own hand-verified-distinct 4-entry reorder sequence
                // (see the table's own comment for why this is NOT composed from the
                // 4 individual button tables at runtime). The offset is a FIXED number
                // of whole beats, constant for the whole beat (recomputed only at beat
                // boundaries), so playback always reads forward through one beat's
                // worth of already-recorded loop content -- it can never double back
                // into audio it just played this pass, unlike a continuous mid-beat
                // position perturbation.
                bool shuffleActive = shuffleMaskNow != 0;
                if (masterLen > 0.0f) {
                    const double lenD = (double)masterLen;
                    const int* reorderTable = kShuffleReorderTables[shuffleMaskNow & 0xF];
                    for (int i = 0; i < N; i++) {
                        double offset = 0.0;
                        if (shuffleActive) {
                            double shuffleT = std::fmod(shuffleClockStart + (double)i, fourBeatLenShared);
                            if (shuffleT < 0.0) shuffleT += fourBeatLenShared;
                            int curBeat = (int)(shuffleT / beatLenSamplesShared);
                            if (curBeat < 0) curBeat = 0;
                            if (curBeat > 3) curBeat = 3;
                            int srcBeat = reorderTable[curBeat];
                            offset = (double)(srcBeat - curBeat) * beatLenSamplesShared;
                        }
                        double p = masterPhaseSamples + (double)i + offset;
                        p = std::fmod(p, lenD);
                        if (p < 0.0) p += lenD;
                        masterPhaseBuf[(size_t)i] = (float)p;
                    }
                } else {
                    std::fill(masterPhaseBuf.begin(), masterPhaseBuf.end(), 0.0f);
                }
                std::fill(masterLenBuf.begin(), masterLenBuf.end(), masterLen);
                std::fill(recordedBeatsBuf.begin(), recordedBeatsBuf.end(), recordedBeatsShared);
                if (linkDrivingLength && g_link) {
                    if (linkSnap.phaseValid && linkSnap.quantumMicroBeats > 0) {
                        double frac = (double)linkSnap.beatPhaseMicroBeats / (double)linkSnap.quantumMicroBeats;
                        if (frac < 0.0) frac = 0.0;
                        if (frac >= 1.0) frac = 0.0;
                        int idx = (int)(frac * 16.0);
                        if (idx < 0) idx = 0;
                        if (idx > 15) idx = 15;
                        g_telem.gridBeatIndex = idx;
                    } else {
                        g_telem.gridBeatIndex = -1;
                    }
                } else if (masterLen > 0.0f) {
                    float recordedBpmForQuantum = recordedBpmVal;
                    double quantumSamples = recordedBpmForQuantum > 1.0f
                        ? (g_cfg.sampleRate * 60.0 / (double)recordedBpmForQuantum) * 16.0
                        : (double)masterLen;
                    double gridStep = quantumSamples / 16.0;
                    int idx = (int)(standaloneQuantumPhaseSamples / gridStep);
                    if (idx < 0) idx = 0;
                    if (idx > 15) idx = 15;
                    g_telem.gridBeatIndex = idx;
                } else {
                    g_telem.gridBeatIndex = -1;
                }
            }
            float inPeak = 0.0f;
            for (int i = 0; i < N; i++) {
                float acc = 0.0f;
                for (int c = 0; c < wireCh; c++) acc += (float)buf[(size_t)i * wireCh + c];
                fin[i] = (acc / wireCh) / 2147483648.0f;
                float a = fin[i] < 0 ? -fin[i] : fin[i];
                if (a > inPeak) inPeak = a;
            }
            g_telem.inPeak = inPeak;
            for (int i = 0; i < N; i++) samplerBuf[(size_t)i] = (int32_t)(fin[i] * 32768.0f);
            g_sampler->renderInto(samplerBuf.data(), N);
            for (int i = 0; i < N; i++) fin[i] = (float)samplerBuf[(size_t)i] / 32768.0f;
            if (g_params) {
                static float foldGain = 0.0f;
                bool anyXposeVoiceGatedNow = false;
                for (int v = 0; v < kTransposeVoices; v++) {
                    if (g_params->getBySlot(xposeGateSlot[v]) > 0.5f) { anyXposeVoiceGatedNow = true; break; }
                }
                bool shiftHeldNow = monitorFoldVal > 0.5f;
                float foldTarget = (shiftHeldNow && !anyXposeVoiceGatedNow) ? 1.0f : 0.0f;
                static float glitchFoldGain = 0.0f;
                float glitchFoldTarget = microrepeatDivVal > 0.5f ? 1.0f : 0.0f;
                for (int i = 0; i < N; i++) {
                    if (foldGain < foldTarget)      { foldGain += kFoldStepPerSample; if (foldGain > foldTarget) foldGain = foldTarget; }
                    else if (foldGain > foldTarget) { foldGain -= kFoldStepPerSample; if (foldGain < foldTarget) foldGain = foldTarget; }
                    if (glitchFoldGain < glitchFoldTarget)      { glitchFoldGain += kFoldStepPerSample; if (glitchFoldGain > glitchFoldTarget) glitchFoldGain = glitchFoldTarget; }
                    else if (glitchFoldGain > glitchFoldTarget) { glitchFoldGain -= kFoldStepPerSample; if (glitchFoldGain < glitchFoldTarget) glitchFoldGain = glitchFoldTarget; }
                    float combinedFold = foldGain + glitchFoldGain;
                    if (combinedFold > 1.0f) combinedFold = 1.0f;
                    fin[i] = fin[i] * (1.0f - combinedFold) + prevLoopSum[i] * combinedFold;
                }
                if (monitorFoldFaustZone) *monitorFoldFaustZone = foldGain;
                if (glitchFoldFaustZone) *glitchFoldFaustZone = glitchFoldGain;
                {
                    float loopDirectRaw = 1.0f - std::max(std::max(foldGain, glitchFoldGain),
                                                            (anyXposeVoiceGatedNow ? 1.0f : 0.0f) * (shiftHeldNow ? 1.0f : 0.0f));
                    const float kLoopDirectPole = 0.9355f;
                    loopDirectGateNow = loopDirectGateNow * kLoopDirectPole + loopDirectRaw * (1.0f - kLoopDirectPole);
                }
                if (sustainSlot < 0) sustainSlot = g_params->getSlot("cmd/sustain");
                float sustainCmdRaw = sustainSlot >= 0 ? g_params->getBySlot(sustainSlot) : 0.0f;
                bool sustainHeldNow = sustainCmdRaw > 0.5f;
                bool glitchHeldNow = microrepeatDivVal > 0.5f;
                float sustainGateNow = (sustainHeldNow || shiftHeldNow || glitchHeldNow) ? 1.0f : 0.0f;
                if (sustainGateFaustZone) *sustainGateFaustZone = sustainGateNow;
                g_telem.sustainCmd = sustainCmdRaw;
                g_telem.sustainGate = sustainGateNow;
            }
            for (int i = 0; i < N; i++) samplerBuf[(size_t)i] = (int32_t)(prevFiltOut[i] * 32768.0f);
            g_sampler->captureBlock(samplerBuf.data(), N);
            if (g_usbRecorder) g_usbRecorder->pushBlock(prevFiltOut.data(), N);
            g_telem.usbRecording = g_usbRecorder && g_usbRecorder->recording();
            g_telem.usbRecOverruns = g_usbRecorder ? g_usbRecorder->overruns() : 0;
            {
                float sidechainEnv = 0.0f;
                if (g_params) {
                    for (int lp = 0; lp < AudioThread::Telemetry::kLoopers; lp++) {
                        if (sidechainSrcSlot[lp] < 0) {
                            char z[32];
                            snprintf(z, sizeof z, "looper%d/sidechainsrc", lp);
                            sidechainSrcSlot[lp] = g_params->getSlot(z);
                        }
                        if (g_params->getBySlot(sidechainSrcSlot[lp]) > 0.5f) {
                            float lvl = g_telem.looperLevel[lp];
                            if (lvl > sidechainEnv) sidechainEnv = lvl;
                        }
                    }
                }
                std::fill(sidechainEnvBuf.begin(), sidechainEnvBuf.end(), sidechainEnv);
            }
            timespec t0, t1;
            clock_gettime(CLOCK_MONOTONIC, &t0);
            if (!g_cfg.disableCore3Lv2) {
                homeFx.process(fin.data(), N);
                userFx.process(fin.data(), N);
            }
            bool resonodeEngagedNow = g_params && resonodeEngagedSlot >= 0 &&
                                       g_params->getBySlot(resonodeEngagedSlot) > 0.5f;
            if (resonodeEngagedZone) *resonodeEngagedZone = resonodeEngagedNow ? 1.0f : 0.0f;
            if (resonodeEngagedNow && resonodeFx.hasPlugins()) {
                std::copy(fin.begin(), fin.end(), resonodeInBuf.begin());
                resonodeFx.process(resonodeInBuf.data(), N);
            } else {
                std::fill(resonodeInBuf.begin(), resonodeInBuf.end(), 0.0f);
            }
            if (pitchTrackerFx.hasPlugins()) {
                std::copy(fin.begin(), fin.end(), pitchTrackerBuf.begin());
                pitchTrackerFx.process(pitchTrackerBuf.data(), N);
                float rawFreq = pitchTrackerBuf[N - 1];
                constexpr float kJumpMaxRatio = 1.6817928f;
                constexpr int kJumpConfirmBlocks = 9;
                constexpr int kSilenceResetBlocks = 40;
                if (rawFreq <= 0.0f) {
                    extFreqGuardSilenceBlocks++;
                    if (extFreqGuardSilenceBlocks >= kSilenceResetBlocks) {
                        extFreqGuardAnchor = 0.0f;
                        extFreqGuardCandidate = 0.0f;
                        extFreqGuardStreakBlocks = 0;
                    }
                } else {
                    extFreqGuardSilenceBlocks = 0;
                    bool freshOnset = extFreqGuardAnchor <= 0.0f;
                    bool plausibleVsAnchor = !freshOnset &&
                        (rawFreq < extFreqGuardAnchor * kJumpMaxRatio && rawFreq > extFreqGuardAnchor / kJumpMaxRatio);
                    if (plausibleVsAnchor) {
                        extFreqGuardAnchor = rawFreq;
                        extFreqGuardCandidate = 0.0f;
                        extFreqGuardStreakBlocks = 0;
                    } else {
                        bool candidatePlausible = extFreqGuardCandidate > 0.0f &&
                            rawFreq < extFreqGuardCandidate * kJumpMaxRatio && rawFreq > extFreqGuardCandidate / kJumpMaxRatio;
                        if (candidatePlausible) {
                            extFreqGuardStreakBlocks++;
                        } else {
                            extFreqGuardCandidate = rawFreq;
                            extFreqGuardStreakBlocks = 1;
                        }
                        if (extFreqGuardStreakBlocks >= kJumpConfirmBlocks) {
                            extFreqGuardAnchor = rawFreq;
                            extFreqGuardCandidate = 0.0f;
                            extFreqGuardStreakBlocks = 0;
                        }
                    }
                }
                if (extFreqDetZone) *extFreqDetZone = (extFreqGuardSilenceBlocks >= kSilenceResetBlocks) ? 0.0f : extFreqGuardAnchor;
                static float diagLastAnchor = -1.0f;
                if (extFreqGuardAnchor != diagLastAnchor) {
                    timespec diagTs; clock_gettime(CLOCK_MONOTONIC, &diagTs);
                    fprintf(stderr, "[diag-pitchguard] t=%ld.%03ld raw=%.2f anchor=%.2f cand=%.2f streak=%d sil=%d\n",
                            (long)diagTs.tv_sec, diagTs.tv_nsec / 1000000, rawFreq, extFreqGuardAnchor,
                            extFreqGuardCandidate, extFreqGuardStreakBlocks, extFreqGuardSilenceBlocks);
                    diagLastAnchor = extFreqGuardAnchor;
                }
            }
            faustPre.compute(N, fins, preOuts);
            std::copy(preFilterOutBuf.begin(), preFilterOutBuf.end(), cueWetBuf.begin());
            std::copy(masterGatedBuf.begin(), masterGatedBuf.end(), masterWetBuf.begin());
            bool delayVerbActive = delayVerbFxCue.hasPlugins() && delayVerbFxMaster.hasPlugins() &&
                                   (delayVerbParamSlots[0].lastValue > 1e-4f ||
                                    delayVerbParamSlots[1].lastValue > 1e-4f);
            if (delayVerbActive) {
                delayVerbFxCue.process(cueWetBuf.data(), N);
                delayVerbFxMaster.process(masterWetBuf.data(), N);
            }
            faustPost.compute(N, postIns, postOuts);
            prevLoopSum = rawLoopSum;
            prevFiltOut = rawFiltTap;
            clock_gettime(CLOCK_MONOTONIC, &t1);
            {
                double workNs = (t1.tv_sec - t0.tv_sec) * 1e9 + (t1.tv_nsec - t0.tv_nsec);
                double periodNs = (double)N / g_cfg.sampleRate * 1e9;
                double pct = periodNs > 0 ? (workNs / periodNs) * 100.0 : 0.0;
                float& slot = g_telem.coreBusyPct[g_cfg.homeFxCore & 3];
                slot = slot * 0.9f + (float)pct * 0.1f;
            }
            float outPeak = 0.0f;
            for (int i = 0; i < N; i++) {
                float masterSample = rawLoopSum[i] * loopDirectGateNow + inputFxOut[i];
                float cueSample = fout[i];

                float mv32 = masterSample * 2147483648.0f;
                int32_t ms32 = (int32_t)(mv32 > 2147483647.0f ? 2147483647 : (mv32 < -2147483648.0f ? -2147483648.0f : mv32));
                float cv32 = cueSample * 2147483648.0f;
                int32_t cs32 = (int32_t)(cv32 > 2147483647.0f ? 2147483647 : (cv32 < -2147483648.0f ? -2147483648.0f : cv32));

                buf[(size_t)i * wireCh + 0] = ms32;
                buf[(size_t)i * wireCh + 1] = cs32;
                for (int c = 2; c < wireCh; c++) {
                    buf[(size_t)i * wireCh + c] = cs32;
                }

                if (otgReady) {
                    float mv16 = masterSample * 32768.0f;
                    int16_t ms16 = (int16_t)(mv16 > 32767 ? 32767 : (mv16 < -32768 ? -32768 : mv16));
                    otgBuf[(size_t)i * wireCh + 0] = ms16;
                    otgBuf[(size_t)i * wireCh + 1] = ms16;
                    for (int c = 2; c < wireCh; c++) {
                        otgBuf[(size_t)i * wireCh + c] = ms16;
                    }
                }
                float a = cueSample < 0 ? -cueSample : cueSample;
                if (a > outPeak) outPeak = a;
            }
            g_telem.outPeak = outPeak;
#endif

            timespec writeStartTs; clock_gettime(CLOCK_MONOTONIC, &writeStartTs);
            snd_pcm_sframes_t w = snd_pcm_writei(play, buf.data(), N);
            timespec writeEndTs; clock_gettime(CLOCK_MONOTONIC, &writeEndTs);
            {
                double writeMs = (writeEndTs.tv_sec - writeStartTs.tv_sec) * 1000.0 + (writeEndTs.tv_nsec - writeStartTs.tv_nsec) / 1e6;
                if (writeMs > kExpectedPeriodMs * 1.5) {
                    fprintf(stderr, "[diag-gap] writei ITSELF took=%.3fms (expected ~%.3fms)\n", writeMs, kExpectedPeriodMs);
                }
            }
            if (w < 0) { g_telem.xruns++; snd_pcm_recover(play, (int)w, 1); }

            if (otgReady) {
                snd_pcm_sframes_t ow = snd_pcm_writei(otgPlay, otgBuf.data(), N);
                if (ow < 0 && ow != -EAGAIN) snd_pcm_recover(otgPlay, (int)ow, 1);
            }
        }
        if (otgPlay) snd_pcm_close(otgPlay);
        snd_pcm_close(cap); snd_pcm_close(play);
    }
#else
    while (g_running.load()) {}
#endif
    return nullptr;
}

bool AudioThread::start(const AudioConfig& cfg, ParamStore* params, LinkBridge* link) {
    cfg_ = cfg; g_cfg = cfg; g_params = params; g_link = link;
    g_running.store(true);
    pthread_attr_t attr;
    pthread_attr_init(&attr);
    pthread_attr_setstacksize(&attr, 16u * 1024u * 1024u);
    int rc = pthread_create(&g_worker, &attr, worker, nullptr);
    pthread_attr_destroy(&attr);
    if (rc != 0) {
        fprintf(stderr, "[audio] fatal: could not create audio thread\n");
        return false;
    }
    return true;
}

void AudioThread::stop() {
    g_running.store(false);
    pthread_join(g_worker, nullptr);
}

AudioThread::Telemetry AudioThread::snapshotTelemetry() const { return g_telem; }
Sampler* AudioThread::sampler() const { return g_sampler; }
Lv2Host* AudioThread::homeFx() const { return g_homeFx; }
UsbRecorder* AudioThread::usbRecorder() const { return g_usbRecorder; }
bool AudioThread::setRealtime(int core, int prio) { return setRealtimeSelf(core, prio); }
void AudioThread::workerLoop() {}

}
