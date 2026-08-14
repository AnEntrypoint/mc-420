#include "telemetry.h"
#include "../dsp/audio_thread.h"

#include <sys/socket.h>
#include <sys/stat.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <unistd.h>
#include <fcntl.h>
#include <cerrno>
#include <cstdio>
#include <cstring>
#include <cstdint>

namespace aloop {

namespace {
int g_sock = -1;
int g_port = 4445;

void ensureStatusDirExists() {
    if (mkdir("/run/aloop", 0755) != 0 && errno != EEXIST)
        fprintf(stderr, "[telem] warning: could not create /run/aloop (%s)\n", strerror(errno));
}
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

    uint32_t recBits = 0, playBits = 0;
    char vols[20 * 5 + 2]; int vp = 0; vols[vp++] = '[';
    char levels[20 * 7 + 2]; int lvp = 0; levels[lvp++] = '[';
    char wraplens[20 * 9 + 2]; int wlp = 0; wraplens[wlp++] = '[';
    char readposes[20 * 9 + 2]; int rpp = 0; readposes[rpp++] = '[';
    for (int i = 0; i < AudioThread::Telemetry::kLoopers; i++) {
        if (t.looperRec[i])  recBits  |= (1u << i);
        if (t.looperPlay[i]) playBits |= (1u << i);
        vp += snprintf(vols + vp, sizeof vols - vp, i ? ",%.2f" : "%.2f", t.looperVol[i]);
        lvp += snprintf(levels + lvp, sizeof levels - lvp, i ? ",%.4f" : "%.4f", t.looperLevel[i]);
        wlp += snprintf(wraplens + wlp, sizeof wraplens - wlp, i ? ",%.0f" : "%.0f", t.looperWrapLen[i]);
        rpp += snprintf(readposes + rpp, sizeof readposes - rpp, i ? ",%.0f" : "%.0f", t.looperReadPos[i]);
    }
    vols[vp++] = ']'; vols[vp] = 0;
    levels[lvp++] = ']'; levels[lvp] = 0;
    wraplens[wlp++] = ']'; wraplens[wlp] = 0;
    readposes[rpp++] = ']'; readposes[rpp] = 0;

    char wifiRole[8] = "sta";
    FILE* rf = fopen("/run/aloop/wifi_role", "r");
    if (rf) {
        size_t rn = fread(wifiRole, 1, sizeof wifiRole - 1, rf);
        wifiRole[rn] = 0;
        fclose(rf);
        if (rn == 0) { wifiRole[0] = 's'; wifiRole[1] = 't'; wifiRole[2] = 'a'; wifiRole[3] = 0; }
    }

    char json[1280];
    int n = snprintf(json, sizeof json,
        "{\"core_busy\":[%.0f,%.0f,%.0f,%.0f],\"xruns\":%llu,"
        "\"link\":{\"synced\":%s,\"bpm\":%.1f,\"peers\":%d,\"playing\":%s},"
        "\"wifi\":\"%s\",\"monitor_mode\":%s,"
        "\"glitch_engaged\":%s,"
        "\"usb_recording\":%s,\"usb_rec_overruns\":%llu,"
        "\"audio_peak\":{\"in\":%.4f,\"out\":%.4f},\"eff_speed\":%.4f,"
        "\"grid_beat_index\":%d,"
        "\"loopers\":{\"rec\":%u,\"play\":%u,\"vol\":%s,\"level\":%s,\"wraplen\":%s,\"readpos\":%s}}",
        t.coreBusyPct[0], t.coreBusyPct[1], t.coreBusyPct[2], t.coreBusyPct[3],
        (unsigned long long)t.xruns,
        t.linkSynced ? "true" : "false", t.bpm,
        t.linkPeers, t.linkPlaying ? "true" : "false",
        wifiRole,
        t.monitorMode ? "true" : "false",
        t.glitchEngaged ? "true" : "false",
        t.usbRecording ? "true" : "false", (unsigned long long)t.usbRecOverruns,
        t.inPeak, t.outPeak, t.effSpeed,
        t.gridBeatIndex,
        recBits, playBits, vols, levels, wraplens, readposes);

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
