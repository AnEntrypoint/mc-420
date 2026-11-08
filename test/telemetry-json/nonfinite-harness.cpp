#include "../../src/control/json_number.h"

#include <cmath>
#include <cstdio>

int main() {
    char raw[512];
    const int n = std::snprintf(raw, sizeof raw,
        "{\"audio_peak\":{\"in\":%.4f},\"loopers\":{\"level\":[%.4f,%.4f,%.4f,%.4f,%.4f,%.4f]},\"link\":{\"bpm\":%.1f}}",
        0.25, (double)NAN, (double)-NAN, (double)INFINITY, (double)-INFINITY, 0.5, 1.0, (double)NAN);
    if (n <= 0 || static_cast<size_t>(n) >= sizeof raw) return 2;
    char safe[512];
    const size_t safeN = aloop::sanitizeJsonNonFinite(raw, static_cast<size_t>(n), safe, sizeof safe);
    if (safeN == 0) return 3;
    std::printf("%s\n%s\n", raw, safe);
    return 0;
}
