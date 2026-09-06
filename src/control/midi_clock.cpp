#include "midi_clock.h"
#include "../link/link_bridge.h"
#include "midi.h"

#include <alsa/asoundlib.h>
#include <cstdio>
#include <cstring>
#include <cmath>
#include <dirent.h>
#include <time.h>

namespace aloop {

namespace {

constexpr int    kPulsesPerQuarter   = 24;
constexpr int    kMaxOutputs         = 8;
constexpr double kRescanSeconds      = 2.0;
constexpr double kSurfaceGraceSeconds = 15.0;
constexpr double kMaxCatchUpPulses   = 4.0;
constexpr long   kSleepFloorNs       = 250000;
constexpr long   kSleepCeilingNs     = 5000000;

constexpr unsigned char kClockTick = 0xF8;
constexpr unsigned char kClockStart = 0xFA;
constexpr unsigned char kClockStop  = 0xFC;

double monotonicSeconds() {
    timespec t{};
    clock_gettime(CLOCK_MONOTONIC, &t);
    return (double)t.tv_sec + (double)t.tv_nsec * 1e-9;
}

struct OutputSet {
    snd_rawmidi_t* handles[kMaxOutputs] = {nullptr};
    char           names[kMaxOutputs][16] = {{0}};
    int            count = 0;

    void closeAll() {
        for (int i = 0; i < count; i++) {
            if (handles[i]) snd_rawmidi_close(handles[i]);
            handles[i] = nullptr;
            names[i][0] = '\0';
        }
        count = 0;
    }

    void release(int card) {
        char name[16];
        snprintf(name, sizeof name, "hw:%d,0,0", card);
        for (int i = 0; i < count; i++) {
            if (strcmp(names[i], name) != 0) continue;
            if (handles[i]) snd_rawmidi_close(handles[i]);
            for (int j = i; j + 1 < count; j++) {
                handles[j] = handles[j + 1];
                snprintf(names[j], sizeof names[j], "%s", names[j + 1]);
            }
            count--;
            handles[count] = nullptr;
            names[count][0] = 0;
            fprintf(stderr, "[midi-clock] released %s back to the control surface
", name);
            return;
        }
    }

    bool holds(const char* name) const {
        for (int i = 0; i < count; i++)
            if (strcmp(names[i], name) == 0) return true;
        return false;
    }

    void write(const unsigned char* bytes, size_t n) {
        for (int i = 0; i < count; i++) {
            if (!handles[i]) continue;
            if (snd_rawmidi_write(handles[i], bytes, n) < 0) {
                snd_rawmidi_close(handles[i]);
                handles[i] = nullptr;
                fprintf(stderr, "[midi-clock] output %s went away, dropping it\n", names[i]);
                names[i][0] = '\0';
            }
        }
        int live = 0;
        for (int i = 0; i < count; i++) {
            if (!handles[i]) continue;
            if (live != i) {
                handles[live] = handles[i];
                snprintf(names[live], sizeof names[live], "%s", names[i]);
                handles[i] = nullptr;
            }
            live++;
        }
        count = live;
    }
};

bool cardHasRawmidi(int card) {
    char path[64];
    snprintf(path, sizeof path, "/proc/asound/card%d", card);
    DIR* d = opendir(path);
    if (!d) return false;
    bool found = false;
    while (dirent* e = readdir(d)) {
        if (strncmp(e->d_name, "midi", 4) == 0) { found = true; break; }
    }
    closedir(d);
    return found;
}

void rescan(OutputSet& outs, int excludeCard) {
    for (int card = 0; card < 8; card++) {
        if (card == excludeCard) continue;
        if (outs.count >= kMaxOutputs) break;
        if (!cardHasRawmidi(card)) continue;
        char name[16];
        snprintf(name, sizeof name, "hw:%d,0,0", card);
        if (outs.holds(name)) continue;
        snd_rawmidi_t* out = nullptr;
        if (snd_rawmidi_open(nullptr, &out, name, SND_RAWMIDI_NONBLOCK) < 0) continue;
        outs.handles[outs.count] = out;
        snprintf(outs.names[outs.count], sizeof outs.names[outs.count], "%s", name);
        outs.count++;
        fprintf(stderr, "[midi-clock] sending clock to %s\n", name);
    }
}

}

void MidiClock::start(LinkBridge* link) {
    if (threadStarted_) return;
    link_ = link;
    run_.store(true, std::memory_order_release);
    if (pthread_create(&thread_, nullptr, &MidiClock::trampoline, this) == 0) {
        threadStarted_ = true;
        fprintf(stderr, "[midi-clock] started (24 ppqn, phase-locked to the Link beat timeline)\n");
    } else {
        run_.store(false, std::memory_order_release);
        fprintf(stderr, "[midi-clock] could not start its thread — external devices will not receive sync\n");
    }
}

void MidiClock::stop() {
    if (!threadStarted_) return;
    run_.store(false, std::memory_order_release);
    pthread_join(thread_, nullptr);
    threadStarted_ = false;
}

void* MidiClock::trampoline(void* self) {
    ((MidiClock*)self)->run();
    return nullptr;
}

void MidiClock::run() {
    OutputSet outs;
    double nextRescan = 0.0;
    bool   sentStart = false;
    double lastPulse = 0.0;
    bool   havePulseRef = false;

    const double startedAt = monotonicSeconds();

    while (run_.load(std::memory_order_acquire)) {
        const double nowSec = monotonicSeconds();
        const int surfaceCard = controlSurfaceCard();
        const bool surfaceSettled = surfaceCard >= 0
            || (nowSec - startedAt) >= kSurfaceGraceSeconds;
        if (surfaceCard >= 0) outs.release(surfaceCard);
        if (surfaceSettled && nowSec >= nextRescan) {
            rescan(outs, surfaceCard);
            nextRescan = nowSec + kRescanSeconds;
        }

        LinkBridge::BeatNow b = link_ ? link_->beatNow() : LinkBridge::BeatNow{};

        if (!b.valid || outs.count == 0) {
            timespec ts{0, kSleepCeilingNs};
            nanosleep(&ts, nullptr);
            continue;
        }

        if (!b.isPlaying) {
            if (sentStart) {
                unsigned char stop = kClockStop;
                outs.write(&stop, 1);
                sentStart = false;
                havePulseRef = false;
                fprintf(stderr, "[midi-clock] transport stopped, sent 0xFC to %d output(s)\n", outs.count);
            }
            timespec ts{0, kSleepCeilingNs};
            nanosleep(&ts, nullptr);
            continue;
        }

        const double pulse = b.beat * (double)kPulsesPerQuarter;

        if (!sentStart) {
            unsigned char startByte = kClockStart;
            outs.write(&startByte, 1);
            sentStart = true;
            lastPulse = std::floor(pulse);
            havePulseRef = true;
            fprintf(stderr, "[midi-clock] transport started, sent 0xFA to %d output(s)\n", outs.count);
        }

        if (!havePulseRef) {
            lastPulse = std::floor(pulse);
            havePulseRef = true;
        }

        double due = std::floor(pulse) - lastPulse;
        if (due > kMaxCatchUpPulses) {
            lastPulse = std::floor(pulse) - kMaxCatchUpPulses;
            due = kMaxCatchUpPulses;
        }
        if (due > 0.0) {
            unsigned char tick = kClockTick;
            for (int i = 0; i < (int)due; i++) outs.write(&tick, 1);
            lastPulse += (double)(int)due;
        }

        const double secondsPerPulse = 60.0 / (b.bpm > 1.0 ? b.bpm : 120.0) / (double)kPulsesPerQuarter;
        long sleepNs = (long)(secondsPerPulse * 0.25 * 1e9);
        if (sleepNs < kSleepFloorNs)   sleepNs = kSleepFloorNs;
        if (sleepNs > kSleepCeilingNs) sleepNs = kSleepCeilingNs;
        timespec ts{0, sleepNs};
        nanosleep(&ts, nullptr);
    }

    if (sentStart && outs.count > 0) {
        unsigned char stop = kClockStop;
        outs.write(&stop, 1);
    }
    outs.closeAll();
}

}
