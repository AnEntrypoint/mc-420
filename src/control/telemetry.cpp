#include "telemetry.h"
#include "../dsp/audio_thread.h"

#include <sys/socket.h>
#include <sys/stat.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <unistd.h>
#include <fcntl.h>
#include <atomic>
#include <cerrno>
#include <cstdio>
#include <cstring>
#include <cstdint>
#include <ctime>

namespace aloop {

namespace {
int g_sock = -1;
int g_port = 4445;

int64_t monoMs() {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (int64_t)ts.tv_sec * 1000 + ts.tv_nsec / 1000000;
}

std::atomic<int>      g_padIndex{-1};
std::atomic<int64_t>  g_padLateUs{0};
std::atomic<int64_t>  g_padBpmMilli{0};
std::atomic<int64_t>  g_padAtMonoMs{0};
std::atomic<uint64_t> g_padSeq{0};

void ensureStatusDirExists() {
    if (mkdir("/run/aloop", 0755) != 0 && errno != EEXIST)
        fprintf(stderr, "[telem] warning: could not create /run/aloop (%s)\n", strerror(errno));
}
}

void publishBeatPadMark(int index, int64_t lateMicros, double bpm) {
    g_padIndex.store(index, std::memory_order_relaxed);
    g_padLateUs.store(lateMicros, std::memory_order_relaxed);
    g_padBpmMilli.store((int64_t)(bpm * 1000.0), std::memory_order_relaxed);
    g_padAtMonoMs.store(monoMs(), std::memory_order_release);
    g_padSeq.fetch_add(1, std::memory_order_release);
}

BeatPadMark beatPadMark() {
    BeatPadMark m;
    m.seq        = g_padSeq.load(std::memory_order_acquire);
    m.index      = g_padIndex.load(std::memory_order_relaxed);
    m.lateMicros = g_padLateUs.load(std::memory_order_relaxed);
    m.bpm        = (double)g_padBpmMilli.load(std::memory_order_relaxed) / 1000.0;
    const int64_t at = g_padAtMonoMs.load(std::memory_order_acquire);
    m.ageMs      = at ? monoMs() - at : -1;
    return m;
}

void Telemetry::start(int udpPort, const AudioThread* audio) {
    g_port = udpPort;
    audio_ = audio;
    ensureStatusDirExists();
    g_sock = socket(AF_INET, SOCK_DGRAM, 0);
    if (g_sock < 0) { fprintf(stderr, "[telem] socket failed\n"); return; }
    int flags = fcntl(g_sock, F_GETFL, 0);
    fcntl(g_sock, F_SETFL, flags | O_NONBLOCK);
    sockaddr_in a{};
    a.sin_family = AF_INET;
    a.sin_addr.s_addr = htonl(INADDR_ANY);
    a.sin_port = htons((uint16_t)g_port);
    if (bind(g_sock, (sockaddr*)&a, sizeof a) < 0)
        fprintf(stderr, "[telem] bind :%d failed\n", g_port);
    else
        fprintf(stderr, "[telem] listening on udp/%d (query for status)\n", g_port);
}

void Telemetry::stop() { if (g_sock >= 0) { close(g_sock); g_sock = -1; } }

void Telemetry::publish() {
    if (g_sock < 0) return;

    AudioThread::Telemetry t{};
    if (audio_) t = audio_->snapshotTelemetry();
    const BeatPadMark padMark = beatPadMark();

    uint32_t recBits = 0, playBits = 0;
    char vols[20 * 5 + 2]; int vp = 0; vols[vp++] = '[';
    char levels[20 * 7 + 2]; int lvp = 0; levels[lvp++] = '[';
    char wraplens[20 * 9 + 2]; int wlp = 0; wraplens[wlp++] = '[';
    char readposes[20 * 9 + 2]; int rpp = 0; readposes[rpp++] = '[';
    char writeidxs[20 * 9 + 2]; int wip = 0; writeidxs[wip++] = '[';
    char stateflags[20 * 6 + 2]; int sfp = 0; stateflags[sfp++] = '[';
    char biases[20 * 9 + 2]; int bp = 0; biases[bp++] = '[';
    for (int i = 0; i < AudioThread::Telemetry::kLoopers; i++) {
        if (t.looperRec[i])  recBits  |= (1u << i);
        if (t.looperPlay[i]) playBits |= (1u << i);
        vp += snprintf(vols + vp, sizeof vols - vp, i ? ",%.2f" : "%.2f", t.looperVol[i]);
        lvp += snprintf(levels + lvp, sizeof levels - lvp, i ? ",%.4f" : "%.4f", t.looperLevel[i]);
        wlp += snprintf(wraplens + wlp, sizeof wraplens - wlp, i ? ",%.0f" : "%.0f", t.looperWrapLen[i]);
        rpp += snprintf(readposes + rpp, sizeof readposes - rpp, i ? ",%.0f" : "%.0f", t.looperReadPos[i]);
        wip += snprintf(writeidxs + wip, sizeof writeidxs - wip, i ? ",%.0f" : "%.0f", t.looperWriteIdx[i]);
        sfp += snprintf(stateflags + sfp, sizeof stateflags - sfp, i ? ",%.0f" : "%.0f", t.looperStateFlags[i]);
        bp += snprintf(biases + bp, sizeof biases - bp, i ? ",%.1f" : "%.1f", t.looperLatencyBias[i]);
    }
    vols[vp++] = ']'; vols[vp] = 0;
    levels[lvp++] = ']'; levels[lvp] = 0;
    wraplens[wlp++] = ']'; wraplens[wlp] = 0;
    readposes[rpp++] = ']'; readposes[rpp] = 0;
    writeidxs[wip++] = ']'; writeidxs[wip] = 0;
    stateflags[sfp++] = ']'; stateflags[sfp] = 0;
    biases[bp++] = ']'; biases[bp] = 0;

    char wifiRole[8] = "sta";
    FILE* rf = fopen("/run/aloop/wifi_role", "r");
    if (rf) {
        size_t rn = fread(wifiRole, 1, sizeof wifiRole - 1, rf);
        wifiRole[rn] = 0;
        fclose(rf);
        if (rn == 0) { wifiRole[0] = 's'; wifiRole[1] = 't'; wifiRole[2] = 'a'; wifiRole[3] = 0; }
    }

    char json[3072];
    int n = snprintf(json, sizeof json,
        "{\"core_busy\":[%.0f,%.0f,%.0f,%.0f],\"xruns\":%llu,"
        "\"link\":{\"synced\":%s,\"bpm\":%.1f,\"peers\":%d,\"playing\":%s,\"phase_err_beats\":%.3f},"
        "\"wifi\":\"%s\",\"monitor_mode\":%s,"
        "\"glitch_engaged\":%s,"
        "\"usb_recording\":%s,\"usb_rec_overruns\":%llu,"
        "\"audio_peak\":{\"in\":%.4f,\"out\":%.4f},\"eff_speed\":%.4f,"
        "\"alsa_roundtrip_samples\":%.1f,\"latency_bias_samples\":%.1f,\"latency_trim_samples\":%.1f,"
        "\"resample_fold\":{\"sum\":%.1f,\"samples\":%llu},"
        "\"resample_chain\":{\"sum\":%.1f,\"samples\":%llu},"
        "\"sustain_cmd\":%.2f,\"sustain_gate\":%.2f,"
        "\"grid_beat_index\":%d,\"master_phase_beats\":%.5f,\"master_len_samples\":%.1f,\"recorded_beats\":%.3f,"
        "\"beat_mark\":{\"valid\":%s,\"beat\":%.5f,\"index\":%d,\"ms_to_next\":%.1f,\"late_ms\":%.3f},"
        "\"beat_pad_mark\":{\"seq\":%llu,\"index\":%d,\"late_ms\":%.3f,\"age_ms\":%lld,\"bpm\":%.3f},"
        "\"groove\":{\"shuffle\":%d,\"gate\":%d,\"beat_len_samples\":%.1f,\"gate_min\":%.3f,\"gate_max\":%.3f,\"swing_offset_samples\":%.1f,\"swing_grid_beats\":%.3f},"
        "\"loopers\":{\"rec\":%u,\"play\":%u,\"vol\":%s,\"level\":%s,\"wraplen\":%s,\"readpos\":%s,\"writeidx\":%s,\"stateflags\":%s,\"latencybias\":%s}}",
        t.coreBusyPct[0], t.coreBusyPct[1], t.coreBusyPct[2], t.coreBusyPct[3],
        (unsigned long long)t.xruns,
        t.linkSynced ? "true" : "false", t.bpm,
        t.linkPeers, t.linkPlaying ? "true" : "false",
        t.linkPhaseErrBeats,
        wifiRole,
        t.monitorMode ? "true" : "false",
        t.glitchEngaged ? "true" : "false",
        t.usbRecording ? "true" : "false", (unsigned long long)t.usbRecOverruns,
        t.inPeak, t.outPeak, t.effSpeed,
        t.alsaRoundTripSamples, t.latencyBiasSamples, t.latencyTrimSamples,
        t.resampleFoldSum, (unsigned long long)t.resampleFoldSamples,
        t.resampleChainSum, (unsigned long long)t.resampleChainSamples,
        t.sustainCmd, t.sustainGate,
        t.gridBeatIndex, t.masterPhaseBeats,
        t.masterLenSamples, t.recordedBeats,
        t.beatMarkValid ? "true" : "false", t.beatMarkBeat, t.beatMarkIndex,
        t.beatMarkMsToNext, t.beatMarkLateMs,
        (unsigned long long)padMark.seq, padMark.index,
        (double)padMark.lateMicros / 1000.0, (long long)padMark.ageMs, padMark.bpm,
        t.shuffleMode, t.gateMode, t.grooveBeatLenSamples, t.grooveGateMin, t.grooveGateMax,
        t.grooveSwingOffsetSamples, t.grooveSwingGridBeats,
        recBits, playBits, vols, levels, wraplens, readposes, writeidxs, stateflags, biases);

    FILE* statusFile = fopen("/run/aloop/status.json", "w");
    if (statusFile) { fwrite(json, 1, (size_t)n, statusFile); fclose(statusFile); }

    char req[64]; sockaddr_in from{}; socklen_t fl = sizeof from;
    ssize_t r = recvfrom(g_sock, req, sizeof req - 1, 0, (sockaddr*)&from, &fl);
    if (r > 0) {
        req[r] = 0;
        sendto(g_sock, json, (size_t)n, 0, (sockaddr*)&from, fl);
    }
}

}
