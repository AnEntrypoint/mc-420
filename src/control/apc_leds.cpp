#include "apc_leds.h"
#include "apc_grid.h"

namespace aloop {

uint8_t ApcLeds::gridColor(int row, int col, const ApcGrid& grid, const float* looperLevels) const {
    static constexpr float kLooperLevelYellowThreshold = 1500.0f / 32768.0f;
    static constexpr float kLooperLevelRedThreshold = 8000.0f / 32768.0f;
    int looper = gridLooperIndex(row, col);
    if (looper >= 0) {
        if (grid.looperRecording(looper))   return kLedRedBlink;
        if (!grid.looperHasContent(looper)) return kLedOff;
        if (grid.looperPlaying(looper)) {
            float level = looperLevels ? looperLevels[looper] : 0.0f;
            if (level >= kLooperLevelRedThreshold)    return kLedRed;
            if (level >= kLooperLevelYellowThreshold) return kLedYellow;
            return kLedGreen;
        }
        return kLedYellowBlink;
    }
    int preset = gridPresetIndex(row, col);
    if (preset >= 0) {
        return grid.presetUsed(preset) ? kLedYellow : kLedOff;
    }
    return kLedOff;
}

}
