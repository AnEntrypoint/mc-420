#ifndef ALOOP_APC_LEDS_H
#define ALOOP_APC_LEDS_H

#include <cstdint>
#include <array>
#include "apc_grid.h"

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

class ApcLeds {
public:
    template <typename WriteFn>
    void refresh(unsigned now_ms, const ApcGrid& grid, bool liveEngaged, WriteFn&& write, const float* looperLevels = nullptr, int gridBeatIndex = -1, int clipExportState = 0, bool samplePrepped = false, bool drumsLoaded = false) {
        if (!bootMs_) bootMs_ = now_ms ? now_ms : 1;
        if (now_ms - bootMs_ < kBootDelayMs) return;

        if (clipExportState != lastClipExportState_) {
            if (clipExportState == 2 /* Done */ || clipExportState == 3 /* Failed */) {
                clipFlashReleaseAt_ = now_ms + kClipFlashMs;
                clipFlashIsError_ = clipExportState == 3;
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
                sendCoalesced(note, gridColor(row, col, grid, looperLevels), write);
            }
        }
        {
            static constexpr int kBeatPadNotes[4] = { 15, 23, 31, 39 };
            bool anyPlaying = false;
            for (int lp = 0; lp < kLooperCount; lp++) {
                if (grid.looperPlaying(lp)) { anyPlaying = true; break; }
            }
            int activeGroup = gridBeatIndex >= 0 ? (gridBeatIndex >> 2) : -1;
            int posInGroup  = gridBeatIndex >= 0 ? (gridBeatIndex & 0x3) : 0;
            bool havePhrase = gridBeatIndex >= 0;
            for (int g = 0; g < 4; g++) {
                uint8_t color;
                if (!anyPlaying)                     color = kLedOff;
                else if (havePhrase && g < activeGroup) color = kLedYellow;
                else                                  color = kLedGreen;
                if (anyPlaying && havePhrase && g == posInGroup) color = kLedRed;
                sendCoalesced(kBeatPadNotes[g], color, write);
            }
        }
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

    template <typename WriteFn>
    void sendCoalesced(int note, uint8_t velocity, WriteFn&& write) {
        if (cacheValid_[note] && cache_[note] == velocity) return;
        if (write(note, velocity)) { cache_[note] = velocity; cacheValid_[note] = true; }
    }

    uint8_t gridColor(int row, int col, const ApcGrid& grid, const float* looperLevels) const;
};

}
#endif
