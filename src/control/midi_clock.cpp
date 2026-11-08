#include "midi_clock.h"
#include "../link/link_bridge.h"
#include "midi.h"

#include <alsa/asoundlib.h>
#include <cstdio>
#include <cstring>
#include <cmath>
#include <dirent.h>
#include <pthread.h>
#include <sched.h>
#include <time.h>

namespace aloop {

namespace {

constexpr int    kPulsesPerQuarter   = 24;
constexpr int    kMaxOutputs         = 8;
constexpr double kRescanSeconds      = 2.0;
constexpr double kSurfaceGraceSeconds = 15.0;
constexpr int64_t kBurstMaxPulses    = kPulsesPerQuarter;
constexpr long   kSleepFloorNs       = 250000;
constexpr long   kSleepCeilingNs     = 5000000;
constexpr long   kIdleSleepNs        = 50000000;
constexpr long   kSpinNs             = 200000;

constexpr unsigned char kClockTick = 0xF8;
constexpr unsigned char kClockStart = 0xFA;
constexpr unsigned char kClockStop  = 0xFC;
constexpr unsigned char kSongPosition = 0xF2;
constexpr double kPhraseBeats = 64.0;
constexpr int kSppUnitsPerBeat = 4;
constexpr int kSppMask = 0x3FFF;
constexpr int64_t kPulsesPerSppUnit = kPulsesPerQuarter / kSppUnitsPerBeat;

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
            fprintf(stderr, "[midi-clock] released %s back to the control surface\n", name);
            return;
        }
    }

    bool holds(const char* name) const {
        for (int i = 0; i < count; i++)
            if (strcmp(names[i], name) == 0) return true;
        return false;
    }

    void write(const unsigned char* bytes, size_t n, int from = 0, int to = -1) {
        const int end = to < 0 ? count : to;
        for (int i = from; i < end; i++) {
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

void writeSongPosition(OutputSet& outs, double beat, int from = 0, int to = -1) {
    int64_t units = (int64_t)std::floor(beat * (double)kSppUnitsPerBeat);
    int64_t span = (int64_t)kSppMask + 1;
    int spp = (int)(((units % span) + span) % span);
    unsigned char msg[3] = { kSongPosition, (unsigned char)(spp & 0x7F), (unsigned char)((spp >> 7) & 0x7F) };
    outs.write(msg, 3, from, to);
}

void writeTicks(OutputSet& outs, int64_t count) {
    unsigned char tick = kClockTick;
    for (int64_t i = 0; i < count; i++) outs.write(&tick, 1);
}

int64_t remainderPulses(double beat, int64_t pulseIdx) {
    const int64_t sppPulse = (int64_t)std::floor(beat * (double)kSppUnitsPerBeat) * kPulsesPerSppUnit;
    int64_t remainder = pulseIdx - sppPulse;
    if (remainder < 0) remainder = 0;
    if (remainder >= kPulsesPerSppUnit) remainder = kPulsesPerSppUnit - 1;
    return remainder;
}

void relocate(OutputSet& outs, double beat, int64_t pulseIdx) {
    writeSongPosition(outs, beat);
    writeTicks(outs, remainderPulses(beat, pulseIdx));
}

void raiseClockPriority(int audioPriority) {
    const int prio = audioPriority - 1;
    if (prio < 1) return;
    sched_param sp{};
    sp.sched_priority = prio;
    if (pthread_setschedparam(pthread_self(), SCHED_FIFO, &sp) != 0)
        fprintf(stderr, "[midi-clock] SCHED_FIFO prio %d failed (need rtprio limit), running at normal priority\n", prio);
}

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

bool cardIsAkaiSurface(int card) {
    char path[64];
    snprintf(path, sizeof path, "/proc/asound/card%d/usbid", card);
    FILE* f = fopen(path, "r");
    if (!f) return false;
    char id[32] = {0};
    bool got = fgets(id, sizeof id, f) != nullptr;
    fclose(f);
    if (!got) return false;
    for (char* c = id; *c; c++) if (*c == 0x0a || *c == 0x0d) { *c = 0; break; }
    return strcmp(id, "09e8:0027") == 0;
}

void rescan(OutputSet& outs, int excludeCard) {
    for (int card = 0; card < 8; card++) {
        if (card == excludeCard) continue;
        if (cardIsAkaiSurface(card)) continue;
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

void MidiClock::start(LinkBridge* link, int audioPriority) {
    if (threadStarted_) return;
    link_ = link;
    audioPriority_ = audioPriority;
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
    raiseClockPriority(audioPriority_);
    OutputSet outs;
    double   nextRescan   = 0.0;
    bool     sentStart    = false;
    int64_t  lastPulseIdx = 0;
    int64_t  lastPhraseIdx = -1;

    const double startedAt = monotonicSeconds();

    while (run_.load(std::memory_order_acquire)) {
        const double nowSec = monotonicSeconds();
        const int surfaceCard = controlSurfaceCard();
        const bool surfaceSettled = surfaceCard >= 0
            || (nowSec - startedAt) >= kSurfaceGraceSeconds;
        LinkBridge::BeatNow b = link_ ? link_->beatNow() : LinkBridge::BeatNow{};
        const double sampledMono = monotonicSeconds();
        if (surfaceCard >= 0) outs.release(surfaceCard);
        if (surfaceSettled && nowSec >= nextRescan) {
            const int beforeCount = outs.count;
            rescan(outs, surfaceCard);
            if (sentStart && outs.count > beforeCount) {
                writeSongPosition(outs, b.beat, beforeCount, outs.count);
                unsigned char startByte = kClockStart;
                outs.write(&startByte, 1, beforeCount, outs.count);
                fprintf(stderr, "[midi-clock] transport already running, sent 0xFA to %d late output(s)\n",
                        outs.count - beforeCount);
            }
            nextRescan = nowSec + kRescanSeconds;
        }

        if (!b.valid || outs.count == 0) {
            timespec ts{0, kIdleSleepNs};
            nanosleep(&ts, nullptr);
            continue;
        }

        const int64_t pulseIdx = (int64_t)std::floor(b.beat * (double)kPulsesPerQuarter);
        const int64_t phraseIdx = (int64_t)std::floor(b.beat / kPhraseBeats);
        const bool phraseTurned = phraseIdx != lastPhraseIdx;
        lastPhraseIdx = phraseIdx;

        if (!sentStart) {
            if (phraseTurned) writeSongPosition(outs, b.beat);
            unsigned char startByte = kClockStart;
            outs.write(&startByte, 1);
            sentStart = true;
            writeTicks(outs, remainderPulses(b.beat, pulseIdx));
            lastPulseIdx = pulseIdx;
            fprintf(stderr, "[midi-clock] transport started, sent 0xFA to %d output(s)\n", outs.count);
        } else {
            const int64_t gap = pulseIdx - lastPulseIdx;
            if (gap < 0) {
                fprintf(stderr, "[midi-clock] session phase moved back %lld pulse(s), relocating with SPP\n",
                        (long long)(-gap));
                relocate(outs, b.beat, pulseIdx);
            } else if (gap > kBurstMaxPulses) {
                fprintf(stderr, "[midi-clock] session phase jumped %lld pulse(s), relocating with SPP\n",
                        (long long)gap);
                relocate(outs, b.beat, pulseIdx);
            } else if (phraseTurned) {
                relocate(outs, b.beat, pulseIdx);
            } else if (gap > 0) {
                if (gap > 1)
                    fprintf(stderr, "[midi-clock] caught up %lld missed pulse(s) in one burst\n", (long long)gap);
                writeTicks(outs, gap);
            }
            lastPulseIdx = pulseIdx;
        }

        const int64_t deadlineMicros =
            link_ ? link_->microsAtBeat((double)(lastPulseIdx + 1) / (double)kPulsesPerQuarter) : 0;
        long waitNs = -1;
        if (deadlineMicros > 0)
            waitNs = (long)((sampledMono + (double)(deadlineMicros - b.nowMicros) * 1e-6
                             - monotonicSeconds()) * 1e9);
        if (waitNs < 0) {
            const double secondsPerPulse = 60.0 / (b.bpm > 1.0 ? b.bpm : 120.0) / (double)kPulsesPerQuarter;
            waitNs = (long)(secondsPerPulse * 0.25 * 1e9);
        }
        if (waitNs < kSleepFloorNs) waitNs = kSleepFloorNs;

        if (waitNs > kSpinNs) {
            long sleepNs = waitNs - kSpinNs;
            if (sleepNs > kSleepCeilingNs) sleepNs = kSleepCeilingNs;
            timespec ts{0, sleepNs};
            nanosleep(&ts, nullptr);
        }
        if (deadlineMicros > 0) {
            const double deadlineMono = sampledMono + (double)(deadlineMicros - b.nowMicros) * 1e-6;
            const double remainSec = deadlineMono - monotonicSeconds();
            if (remainSec > 0.0 && remainSec < 2.0 * (double)kSpinNs * 1e-9) {
                while (run_.load(std::memory_order_acquire) && monotonicSeconds() < deadlineMono) {}
            }
        }
    }

    unsigned char stopByte = kClockStop;
    outs.write(&stopByte, 1);
    outs.closeAll();
}

}
