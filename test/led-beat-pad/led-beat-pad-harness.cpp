#include "apc_leds.h"

#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>

namespace {

using aloop::ApcGrid;
using aloop::ApcLeds;
using aloop::BeatPadClock;

constexpr int kPadNote = 15;
constexpr int64_t kLeadUs = 30000;
constexpr int64_t kFlashUs = 100000;
constexpr int64_t kBootUs = 4000000;
constexpr int64_t kSteadyStartUs = 4500000;
constexpr int64_t kExcludeAfterChangeUs = 50000;
constexpr int64_t kPollWakeMaxUs = 33000;

struct Send {
    int64_t tUs;
    int note;
    int vel;
};

struct Segment {
    int64_t startUs;
    int64_t originUs;
    int64_t beatLenUs;
    int base;
};

int64_t floorDiv(int64_t a, int64_t b) {
    return a >= 0 ? a / b : -((-a + b - 1) / b);
}

int wrap16(int64_t n) {
    return static_cast<int>(((n % 16) + 16) % 16);
}

BeatPadClock clockAt(const std::vector<Segment>& segs, int64_t t, int64_t blackGapUs) {
    const Segment* s = &segs.front();
    for (const Segment& candidate : segs) {
        if (t >= candidate.startUs) s = &candidate;
    }
    const int64_t n = floorDiv(t - s->originUs, s->beatLenUs);
    BeatPadClock c;
    c.live = true;
    c.bpm = 60e6 / static_cast<double>(s->beatLenUs);
    c.beatIndex = wrap16(s->base + n);
    c.nowMicros = t;
    c.beatStartMicros = s->originUs + n * s->beatLenUs;
    c.beatLenMicros = s->beatLenUs;
    c.leadMicros = kLeadUs;
    c.blackGapUs = blackGapUs;
    return c;
}

int64_t flashStartUs(const Segment& s, int64_t n) {
    return s.originUs + n * s.beatLenUs - kLeadUs;
}

int flashVel(int idx) {
    return aloop::kMetronomeStates[idx].flash;
}

int backgroundVel(int idx) {
    return aloop::kMetronomeStates[idx].background;
}

int64_t findFlashSend(const std::vector<Send>& sends, int64_t f, int vel) {
    for (size_t i = 0; i < sends.size(); ++i) {
        const Send& m = sends[i];
        if (m.note != kPadNote) continue;
        if (m.tUs < f - 1000 || m.tUs >= f + kFlashUs) continue;
        if (m.vel == vel) return static_cast<int64_t>(i);
    }
    return -1;
}

bool findBackgroundSend(const std::vector<Send>& sends, int64_t from, int64_t to, int vel) {
    for (const Send& m : sends) {
        if (m.note == kPadNote && m.tUs >= from && m.tUs < to && m.vel == vel) return true;
    }
    return false;
}

void simulate(const std::vector<Segment>& segs, int64_t blackGapUs, int64_t endUs, std::vector<Send>& sends) {
    ApcGrid grid;
    ApcLeds leds;
    int64_t nowUs = 0;
    auto write = [&](int note, uint8_t vel) -> bool {
        sends.push_back(Send{nowUs, note, static_cast<int>(vel)});
        return true;
    };
    int64_t t = 0;
    int64_t nextRefresh = 0;
    while (t <= endUs) {
        nowUs = t;
        const BeatPadClock c = clockAt(segs, t, blackGapUs);
        const unsigned ms = static_cast<unsigned>(t / 1000);
        leds.refreshBeatPads(ms, grid, c, write);
        if (t >= nextRefresh) {
            leds.refresh(ms, grid, false, write, nullptr, c, 0, false, false);
            nextRefresh = t + 33000;
        }
        const int64_t next = std::min(std::min(aloop::beatPadNextChangeMicros(c), nextRefresh), t + kPollWakeMaxUs);
        t = next > t ? next : t + 1;
    }
}

}

int main(int argc, char** argv) {
    const bool noGap = argc > 1 && std::strcmp(argv[1], "--no-gap") == 0;
    const int64_t blackGapUs = noGap ? 0 : aloop::kBeatPadBlackGapUs;

    const int64_t join = kBootUs + 24 * 500000 + 120000;
    const Segment seg0{0, kBootUs, 500000, 0};
    const Segment seg1{join, join + 70000, 344828, 24};
    const int64_t leave = seg1.originUs + 16 * seg1.beatLenUs + 90000;
    const Segment seg2{leave, leave + 210000, 500000, 40};
    const std::vector<Segment> segs{seg0, seg1, seg2};
    const int64_t endUs = leave + 8000000;

    std::vector<Send> sends;
    simulate(segs, blackGapUs, endUs, sends);

    std::printf("raw APC note-15 messages, steady 120 BPM, one 16-beat cycle (beats 8-23), gap %lld us\n", static_cast<long long>(blackGapUs));
    for (int64_t n = 8; n < 24; ++n) {
        const int64_t f = flashStartUs(seg0, n);
        const int64_t fNext = flashStartUs(seg0, n + 1);
        for (const Send& m : sends) {
            if (m.note != kPadNote || m.tUs < f - 60000 || m.tUs >= fNext - 60000) continue;
            std::printf("index=%2d beat=%3lld note=%d vel=%d t_ms=%.3f rel_flash_ms=%.3f\n",
                        wrap16(n), static_cast<long long>(n), m.note, m.vel, m.tUs / 1000.0, (m.tUs - f) / 1000.0);
        }
    }

    bool paletteOk = true;
    for (const Send& m : sends) {
        if (m.note != kPadNote) continue;
        if (m.vel != 0 && m.vel != 1 && m.vel != 3 && m.vel != 5) paletteOk = false;
    }

    int indicesVisible = 0;
    int backgroundsSent = 0;
    int flashesSent = 0;
    int64_t maxFlashErrUs = 0;
    bool idxAllVisible[16];
    for (bool& b : idxAllVisible) b = true;
    for (int64_t n = 8; n < 24; ++n) {
        const int idx = wrap16(n);
        const int64_t f = flashStartUs(seg0, n);
        const int64_t fNext = flashStartUs(seg0, n + 1);
        const int64_t fi = findFlashSend(sends, f, flashVel(idx));
        bool visible = false;
        if (fi >= 0) {
            ++flashesSent;
            const Send& fs = sends[static_cast<size_t>(fi)];
            maxFlashErrUs = std::max(maxFlashErrUs, static_cast<int64_t>(std::llabs(fs.tUs - f)));
            int prevVel = -1;
            for (int64_t j = fi - 1; j >= 0; --j) {
                if (sends[static_cast<size_t>(j)].note == kPadNote) { prevVel = sends[static_cast<size_t>(j)].vel; break; }
            }
            visible = prevVel < 0 || prevVel != flashVel(idx);
        }
        if (!visible) idxAllVisible[idx] = false;
        if (findBackgroundSend(sends, f + kFlashUs, fNext, backgroundVel(idx))) ++backgroundsSent;
    }
    for (int idx = 0; idx < 16; ++idx) {
        if (idxAllVisible[idx]) ++indicesVisible;
    }

    int joinFlashes = 0;
    for (int64_t k = 0; k < 16; ++k) {
        if (findFlashSend(sends, flashStartUs(seg1, k), flashVel(wrap16(seg1.base + k))) >= 0) ++joinFlashes;
    }
    int leaveFlashes = 0;
    for (int64_t k = 0; k < 12; ++k) {
        if (findFlashSend(sends, flashStartUs(seg2, k), flashVel(wrap16(seg2.base + k))) >= 0) ++leaveFlashes;
    }

    int64_t samples = 0;
    int64_t mismatches = 0;
    int64_t firstMismatchUs = -1;
    size_t si = 0;
    int lastVel = -1;
    for (int64_t t = kSteadyStartUs; t <= endUs; t += 1000) {
        while (si < sends.size() && sends[si].tUs <= t) {
            if (sends[si].note == kPadNote) lastVel = sends[si].vel;
            ++si;
        }
        const bool nearChange = (t >= join && t < join + kExcludeAfterChangeUs) || (t >= leave && t < leave + kExcludeAfterChangeUs);
        if (nearChange || lastVel < 0) continue;
        ++samples;
        const int desired = aloop::beatPadVelocity(clockAt(segs, t, blackGapUs));
        if (desired != lastVel) {
            if (mismatches == 0) firstMismatchUs = t;
            ++mismatches;
        }
    }

    const bool visibleOk = indicesVisible == 16;
    const bool joinOk = joinFlashes == 16;
    const bool leaveOk = leaveFlashes == 12;
    const bool sentOk = backgroundsSent == 16 && flashesSent == 16;
    const bool densePass = mismatches == 0 && samples > 0;
    std::printf("palette 0,1,3,5 only: %s\n", paletteOk ? "ok" : "FAIL");
    std::printf("visible: %d/16 indices show a visible change at the flash start (black gap before a flash equal to the lit colour)\n", indicesVisible);
    std::printf("sent: %d/16 flashes and %d/16 backgrounds reached the APC in beats 8-23\n", flashesSent, backgroundsSent);
    std::printf("join at t=%.3f s (seg1 origin +70 ms, tempo 120 to 174, phase jump): flashes %d/16\n", join / 1e6, joinFlashes);
    std::printf("leave at t=%.3f s (seg2 origin +210 ms, tempo 174 to 120): flashes %d/12\n", leave / 1e6, leaveFlashes);
    std::printf("dense 1 ms check outside 50 ms change windows: %lld samples, %lld mismatches%s\n",
                static_cast<long long>(samples), static_cast<long long>(mismatches),
                mismatches ? "" : " ok");
    if (mismatches) std::printf("first mismatch at t=%.3f ms\n", firstMismatchUs / 1000.0);
    std::printf("max flash-start error: %lld us\n", static_cast<long long>(maxFlashErrUs));
    const bool pass = paletteOk && visibleOk && joinOk && leaveOk && sentOk && densePass;
    std::printf("LED BEAT PAD HARNESS: %s\n", pass ? "PASS" : "FAIL");
    return pass ? 0 : 1;
}
