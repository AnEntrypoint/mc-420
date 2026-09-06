#include "dsp/audio_thread.h"
#include "link/link_bridge.h"
#include "control/telemetry.h"
#include "control/midi.h"
#include "control/remote_control.h"
#include "control/midi_clock.h"
#include "storage/usb_recorder.h"

#include <sys/mman.h>
#include <ifaddrs.h>
#include <net/if.h>
#include <netinet/in.h>
#include <csignal>
#include <cstdio>
#include <cstring>
#include <cstdlib>
#include <string>
#include <atomic>
#include <thread>
#include <unistd.h>
#include <dirent.h>
#include <sched.h>

namespace {
std::atomic<bool> g_run{true};
void onSignal(int) { g_run.store(false); }

constexpr int kControlCore = 2;
constexpr int kControlLoopHz = 5;

bool waitForNetworkInterface(const char* iface, int maxSeconds) {
    for (int elapsed = 0; elapsed <= maxSeconds; elapsed++) {
        struct ifaddrs* ifa = nullptr;
        bool haveAddr = false;
        if (getifaddrs(&ifa) == 0) {
            for (struct ifaddrs* p = ifa; p; p = p->ifa_next) {
                if (!p->ifa_addr || !p->ifa_name) continue;
                if (p->ifa_addr->sa_family != AF_INET) continue;
                if (strcmp(p->ifa_name, iface) != 0) continue;
                if (!(p->ifa_flags & IFF_UP)) continue;
                haveAddr = true;
                break;
            }
            freeifaddrs(ifa);
        }
        if (haveAddr) {
            fprintf(stderr, "[link] %s is up with an address after %ds — starting Link\n", iface, elapsed);
            return true;
        }
        if (elapsed < maxSeconds) sleep(1);
    }
    fprintf(stderr, "[link] warning: %s had no IPv4 address after %ds — starting Link anyway "
                    "(peer discovery may take longer)\n", iface, maxSeconds);
    return false;
}

void pinLinkThreadsToControlCore(int controlCore) {
    DIR* d = opendir("/proc/self/task");
    if (!d) return;
    struct dirent* e;
    int pinned = 0;
    while ((e = readdir(d))) {
        if (e->d_name[0] == '.') continue;
        char commPath[64];
        snprintf(commPath, sizeof commPath, "/proc/self/task/%s/comm", e->d_name);
        FILE* f = fopen(commPath, "r");
        if (!f) continue;
        char name[64] = {0};
        if (fgets(name, sizeof name, f)) {
            size_t len = strlen(name);
            if (len && name[len - 1] == '\n') name[len - 1] = '\0';
        }
        fclose(f);
        if (strcmp(name, "Link Main") == 0 || strcmp(name, "Link Dispatcher") == 0) {
            pid_t tid = (pid_t)atoi(e->d_name);
            cpu_set_t set;
            CPU_ZERO(&set);
            CPU_SET(controlCore, &set);
            if (sched_setaffinity(tid, sizeof set, &set) == 0) {
                fprintf(stderr, "[link] pinned %s (tid %d) to control core %d\n", name, (int)tid, controlCore);
                pinned++;
            } else {
                fprintf(stderr, "[link] warning: failed to pin %s (tid %d) to core %d\n", name, (int)tid, controlCore);
            }
        }
    }
    closedir(d);
    if (!pinned) fprintf(stderr, "[link] warning: no Link Main/Dispatcher threads found to pin yet (may not have spawned)\n");
}

aloop::AudioConfig loadConfig(const char* path) {
    aloop::AudioConfig cfg;
    FILE* f = fopen(path, "r");
    if (!f) { fprintf(stderr, "[aloop] no config at %s — using defaults\n", path); return cfg; }
    char line[256];
    while (fgets(line, sizeof line, f)) {
        int v; char s[200];
        if (sscanf(line, " home_fx = %d", &v) == 1) cfg.homeFxCore = v;
        else if (sscanf(line, " user_fx = %d", &v) == 1) cfg.userFxCore = v;
        else if (sscanf(line, " audio_priority = %d", &v) == 1) cfg.rtPriority = v;
        else if (sscanf(line, " block_size = %d", &v) == 1) cfg.blockSize = v;
        else if (sscanf(line, " sample_rate = %d", &v) == 1) cfg.sampleRate = v;
        else if (sscanf(line, " channels = %d", &v) == 1) cfg.channels = v;
        else if (sscanf(line, " home_dir = %199s", s) == 1) cfg.homeDir = s;
        else if (sscanf(line, " user_dir = %199s", s) == 1) cfg.userDir = s;
        else if (sscanf(line, " resonode_dir = %199s", s) == 1) cfg.resonodeDir = s;
        else if (sscanf(line, " pitchtracker_dir = %199s", s) == 1) cfg.pitchTrackerDir = s;
        else if (sscanf(line, " delayverb_dir = %199s", s) == 1) cfg.delayVerbDir = s;
        else if (sscanf(line, " disable_core3_lv2 = %d", &v) == 1) cfg.disableCore3Lv2 = (v != 0);
        else if (sscanf(line, " midi_device = %199s", s) == 1) cfg.midiDevice = s;
        else if (sscanf(line, " audio_device = %199s", s) == 1) cfg.audioDevice = s;
        else if (sscanf(line, " instrument_device = %199s", s) == 1) cfg.instrumentDevice = s;
        else if (sscanf(line, " instrument_device_match = %199[^\n\r]", s) == 1) {
            std::string m(s);
            size_t hashPos = m.find('#');
            if (hashPos != std::string::npos) m.erase(hashPos);
            while (!m.empty() && (m.back() == ' ' || m.back() == '\t')) m.pop_back();
            cfg.instrumentDeviceMatch = m;
        }
        else if (sscanf(line, " token = %199s", s) == 1) cfg.remoteToken = s;
        else if (sscanf(line, " enabled = %199s", s) == 1) {
            cfg.linkEnabled = (strcmp(s, "true") == 0 || strcmp(s, "1") == 0 ||
                               strcmp(s, "yes") == 0  || strcmp(s, "on") == 0);
        }
        else if (sscanf(line, " iface = %199s", s) == 1) cfg.linkIface = s;
        else if (sscanf(line, " iface_wait_sec = %d", &v) == 1) cfg.linkIfaceWaitSec = v;
        else if (sscanf(line, " usb_record = %199s", s) == 1) {
            cfg.usbRecordEnabled = (strcmp(s, "true") == 0 || strcmp(s, "1") == 0 ||
                                     strcmp(s, "yes") == 0  || strcmp(s, "on") == 0);
        }
        else if (sscanf(line, " usb_mount_point = %199s", s) == 1) cfg.usbMountPoint = s;
        else if (sscanf(line, " usb_chunk_minutes = %d", &v) == 1) cfg.usbChunkMinutes = v;
        else if (sscanf(line, " usb_chunk_count = %d", &v) == 1) cfg.usbChunkCount = v;
    }
    fclose(f);
    return cfg;
}
}

int main(int argc, char** argv) {
    const char* configPath = "/etc/aloop.conf";
    for (int i = 1; i < argc - 1; i++)
        if (!strcmp(argv[i], "--config")) configPath = argv[i + 1];

    signal(SIGINT, onSignal);
    signal(SIGTERM, onSignal);

    aloop::AudioConfig cfg = loadConfig(configPath);
    printf("[aloop] %d Hz, %d-sample block, home-FX core %d, user-FX core %d, rtprio %d\n",
           cfg.sampleRate, cfg.blockSize, cfg.homeFxCore, cfg.userFxCore, cfg.rtPriority);

    if (mlockall(MCL_CURRENT | MCL_FUTURE) != 0)
        fprintf(stderr, "[aloop] warning: mlockall failed (need CAP_IPC_LOCK / rtprio limits)\n");

    if (cfg.linkEnabled) waitForNetworkInterface(cfg.linkIface.c_str(), cfg.linkIfaceWaitSec);
    aloop::LinkBridge link;
    link.start((double)cfg.sampleRate, cfg.linkEnabled);
    pinLinkThreadsToControlCore(kControlCore);

    aloop::AudioThread audio;

    aloop::ParamStore params;
    std::thread midiThread([&, dev = cfg.midiDevice]{ aloop::runMidiLoop(params, dev.c_str(), &audio, &link); });
    midiThread.detach();

    if (!audio.start(cfg, &params, &link)) {
        fprintf(stderr, "[aloop] fatal: could not start audio pipeline\n");
        return 1;
    }

    aloop::Telemetry telem;
    telem.start(4445, &audio);

    aloop::RemoteControl remote;
    remote.start(4446, cfg.remoteToken);

    aloop::MidiClock midiClock;
    midiClock.start(&link);

    printf("[aloop] ready.\n");

    while (g_run.load()) {
        link.controlTick();
        telem.publish();
        remote.poll();
        if (audio.usbRecorder()) audio.usbRecorder()->poll();
        usleep(1000000 / kControlLoopHz);
    }

    printf("[aloop] shutting down.\n");
    audio.stop();
    telem.stop();
    remote.stop();
    midiClock.stop();
    link.stop();
    return 0;
}
