#ifndef ALOOP_APC_LEDS_H
#define ALOOP_APC_LEDS_H

#include <cstdint>
#include <array>
#include "apc_grid.h"
#include "../storage/clip_exporter.h"

namespace aloop {

enum ApcLedVel : uint8_t {
    kLedOff         = 0,
    kLedGreen       = 1,
    kLedGreenBlink  = 2,
    kLedRed         = 3,
    kLedRedBlink    = 4,
    kLedYellow      = 5,
    kLedYellowBlink = 6,
};

constexpr int kApcBtnStopAll = 0x51;
constexpr int kApcBtnPlay    = 0x5B;
constexpr int kApcLiveLedNote = 0x40;
constexpr int kApcBtnSampleRec = 65;
constexpr int kApcBtnDrumRec   = 66;
constexpr unsigned kApcBeatFlashMs = 100;
constexpr int64_t kBeatPadBlackGapUs = 15000;
struct MetronomeState {
    uint8_t flash;
    uint8_t background;
};

constexpr int kMetronomeCycleBeats = 16;
constexpr MetronomeState kMetronomeStates[kMetronomeCycleBeats] = {
    {kLedRed,   kLedOff},
    {kLedRed,   kLedOff},
    {kLedRed,   kLedOff},
    {kLedRed,   kLedOff},
    {kLedRed,   kLedGreen},
    {kLedRed,   kLedGreen},
    {kLedRed,   kLedGreen},
    {kLedRed,   kLedGreen},
    {kLedRed,   kLedYellow},
    {kLedRed,   kLedYellow},
    {kLedRed,   kLedYellow},
    {kLedRed,   kLedYellow},
    {kLedGreen, kLedRed},
    {kLedGreen, kLedRed},
    {kLedGreen, kLedRed},
    {kLedGreen, kLedRed},
};

constexpr MetronomeState metronomeStateFor(int linkBeat) {
    const int phase = ((linkBeat % kMetronomeCycleBeats) + kMetronomeCycleBeats) % kMetronomeCycleBeats;
    return kMetronomeStates[phase];
}

struct BeatPadClock {
    bool live = false;
    double bpm = 0.0;
    int beatIndex = 0;
    int64_t nowMicros = 0;
    int64_t beatStartMicros = 0;
    int64_t beatLenMicros = 0;
    int64_t leadMicros = 0;
    int64_t blackGapUs = kBeatPadBlackGapUs;
};

constexpr int beatPadIndex(int n) {
    return ((n % kMetronomeCycleBeats) + kMetronomeCycleBeats) % kMetronomeCycleBeats;
}

constexpr bool beatPadNeedsGap(int nextIdx, int litIdx) {
    return kMetronomeStates[nextIdx].flash == kMetronomeStates[litIdx].background;
}

struct BeatPadPhase {
    int litIndex;
    int64_t sinceFlashUs;
    int64_t untilNextFlashUs;
};

inline BeatPadPhase beatPadPhase(const BeatPadClock& c) {
    const int64_t firstFlashUs = c.beatStartMicros - c.leadMicros;
    const int64_t offsetUs = c.nowMicros - firstFlashUs;
    const int64_t beats = offsetUs >= 0
        ? offsetUs / c.beatLenMicros
        : -((-offsetUs + c.beatLenMicros - 1) / c.beatLenMicros);
    const int64_t lastFlashUs = firstFlashUs + beats * c.beatLenMicros;
    return BeatPadPhase{ beatPadIndex(c.beatIndex + static_cast<int>(beats)),
                         c.nowMicros - lastFlashUs,
                         lastFlashUs + c.beatLenMicros - c.nowMicros };
}

inline uint8_t beatPadVelocity(const BeatPadClock& c) {
    const BeatPadPhase p = beatPadPhase(c);
    if (p.untilNextFlashUs <= c.blackGapUs && beatPadNeedsGap(beatPadIndex(p.litIndex + 1), p.litIndex)) {
        return kLedOff;
    }
    if (p.sinceFlashUs < static_cast<int64_t>(kApcBeatFlashMs) * 1000) return kMetronomeStates[p.litIndex].flash;
    return kMetronomeStates[p.litIndex].background;
}

inline int64_t beatPadNextChangeMicros(const BeatPadClock& c) {
    const BeatPadPhase p = beatPadPhase(c);
    const int64_t nextFlashUs = c.nowMicros + p.untilNextFlashUs;
    int64_t next = nextFlashUs;
    const int64_t gapStartUs = nextFlashUs - c.blackGapUs;
    if (c.blackGapUs > 0 && gapStartUs > c.nowMicros && gapStartUs < next) next = gapStartUs;
    const int64_t flashEndUs = c.nowMicros - p.sinceFlashUs + static_cast<int64_t>(kApcBeatFlashMs) * 1000;
    if (flashEndUs > c.nowMicros && flashEndUs < next) next = flashEndUs;
    return next;
}

class ApcLeds {
public:
    template <typename WriteFn>
    void refresh(unsigned now_ms, const ApcGrid& grid, bool liveEngaged, WriteFn&& write, const float* looperLevels = nullptr, const BeatPadClock& clock = BeatPadClock{}, int clipExportState = 0, bool samplePrepped = false, bool drumsLoaded = false) {
        if (!bootMs_) bootMs_ = now_ms ? now_ms : 1;
        if (now_ms - bootMs_ < kBootDelayMs) return;

        if (clipExportState != lastClipExportState_) {
            bool clipExportDone = clipExportState == static_cast<int>(ClipExportState::Done);
            bool clipExportFailed = clipExportState == static_cast<int>(ClipExportState::Failed);
            if (clipExportDone || clipExportFailed) {
                clipFlashReleaseAt_ = now_ms + kClipFlashMs;
                clipFlashIsError_ = clipExportFailed;
            }
            lastClipExportState_ = clipExportState;
        }
        bool clipFlashActive = clipFlashReleaseAt_ != 0 && now_ms < clipFlashReleaseAt_;
        if (clipFlashReleaseAt_ != 0 && now_ms >= clipFlashReleaseAt_) clipFlashReleaseAt_ = 0;

        if (now_ms - lastMs_ < kRefreshMs) return;
        lastMs_ = now_ms;

        if (clipFlashActive) {
            uint8_t flashColor = clipFlashIsError_ ? kLedRed : kLedGreen;
            for (int row = 0; row < kApcRows; row++) {
                for (int col = 0; col < kApcCols; col++) {
                    sendCoalesced(row * kApcCols + col, flashColor, write);
                }
            }
            return;
        }

        for (int row = 0; row < kApcRows; row++) {
            for (int col = 0; col < kApcCols; col++) {
                int note = row * kApcCols + col;
                if (isBeatPadNote(note) || isInputRoutePadNote(note)) continue;
                sendCoalesced(note, gridColor(row, col, grid, looperLevels), write);
            }
        }
        drawBeatPads(grid, clock, write);
        drawInputRoutePads(grid, write);
        sendCoalesced(kApcPadGateMod, grid.gateModHeld() ? kLedYellow :
                                      grid.gateMode() > 0 ? kLedGreen : kLedOff, write);
        sendCoalesced(kApcBtnPlay, grid.shiftHeld() ? kLedYellow : kLedOff, write);
        sendCoalesced(kApcLiveLedNote,
            grid.keysMultiMode() ? kLedYellowBlink :
            liveEngaged          ? 127 :
                                    kLedOff,
            write);
        {
            bool flash = grid.bankFlashActive();
            FxBank which = grid.bankFlashWhich();
            sendCoalesced(kApcBtnDubFx,    (flash && which == FxBank::Dub)    ? kLedGreen : kLedOff, write);
            sendCoalesced(kApcBtnGuitarFx, (flash && which == FxBank::Guitar) ? kLedGreen : kLedOff, write);
        }
        sendCoalesced(kApcBtnLofiFx,
            grid.resonodeEngaged()   ? kLedRedBlink :
            grid.granulatorLatched() ? kLedGreen :
                                        kLedOff,
            write);
        sendCoalesced(kApcBtnSampleRec, samplePrepped ? kLedGreen : kLedOff, write);
        sendCoalesced(kApcBtnDrumRec,   drumsLoaded   ? kLedGreen : kLedOff, write);
    }

    void invalidate() { cacheValid_.fill(false); }

    template <typename WriteFn>
    void refreshBeatPads(unsigned now_ms, const ApcGrid& grid, const BeatPadClock& clock, WriteFn&& write) {
        if (!bootMs_) bootMs_ = now_ms ? now_ms : 1;
        if (now_ms - bootMs_ < kBootDelayMs) return;
        if (clipFlashReleaseAt_ != 0 && now_ms < clipFlashReleaseAt_) return;
        drawBeatPads(grid, clock, write);
    }

private:
    static constexpr unsigned kBootDelayMs = 2000;
    static constexpr unsigned kRefreshMs = 33;
    static constexpr unsigned kClipFlashMs = 1200;

    unsigned bootMs_ = 0;
    unsigned lastMs_ = 0;
    std::array<uint8_t, 128> cache_{};
    std::array<bool, 128> cacheValid_{};
    int lastClipExportState_ = 0;
    unsigned clipFlashReleaseAt_ = 0;
    bool clipFlashIsError_ = false;

    static bool isBeatPadNote(int note) {
        for (int g = 0; g < 4; g++) if (note == kApcBeatPadNotes[g]) return true;
        return false;
    }

    static bool isInputRoutePadNote(int note) {
        for (int c = 0; c < kApcInputRouteCount; c++) if (note == kApcInputRoutePadNotes[c]) return true;
        return false;
    }

    template <typename WriteFn>
    void drawInputRoutePads(const ApcGrid& grid, WriteFn&& write) {
        for (int c = 0; c < kApcInputRouteCount; c++) {
            sendCoalesced(kApcInputRoutePadNotes[c],
                          grid.inputRecordable(c) ? kLedGreen : kLedYellow, write);
        }
    }

    template <typename WriteFn>
    void drawBeatPads(const ApcGrid& grid, const BeatPadClock& clock, WriteFn&& write) {
        for (int g = 0; g < 4; g++) {
            uint8_t color = kLedOff;
            if (grid.gateModHeld()) {
                color = (grid.gateMode() == g + 1) ? kLedRed : kLedOff;
            } else {
                if (g == 0 && clock.live) color = beatPadVelocity(clock);
                if (grid.shuffleMode() == g + 1 && color == kLedOff) color = kLedGreen;
            }
            sendCoalesced(kApcBeatPadNotes[g], color, write);
        }
    }

    template <typename WriteFn>
    void sendCoalesced(int note, uint8_t velocity, WriteFn&& write) {
        if (cacheValid_[note] && cache_[note] == velocity) return;
        if (write(note, velocity)) { cache_[note] = velocity; cacheValid_[note] = true; }
    }

    uint8_t gridColor(int row, int col, const ApcGrid& grid, const float* looperLevels) const;
};

}
#endif
