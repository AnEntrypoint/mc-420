#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <vector>
#include <chrono>

#include "../../effects/home/faust/snacPeriodTracker.h"

static uint32_t g_rng = 0x12345678u;

static float white() {
    g_rng ^= g_rng << 13;
    g_rng ^= g_rng >> 17;
    g_rng ^= g_rng << 5;
    return (float)((int32_t)g_rng) * (1.0f / 2147483648.0f);
}

int main() {
    static const int SR = 48000;
    static const int SECONDS = 20;
    std::vector<float> x((size_t)(SR * SECONDS));
    double phase = 0.0;
    for (size_t i = 0; i < x.size(); i++) {
        double f = 146.83 * (1.0 + 0.004 * sin(2.0 * 3.14159265358979323846 * 5.0 * (double)i / (double)SR));
        phase += 2.0 * 3.14159265358979323846 * f / (double)SR;
        float s = 0.0f;
        for (int k = 1; k <= 8; k++) s += (float)sin(phase * (double)k) / (float)k;
        x[i] = s * 0.1f + white() * 0.0005f;
    }
    double best = 1e30;
    float sink = 0.0f;
    for (int rep = 0; rep < 15; rep++) {
        SnacPeriodTracker tr;
        auto t0 = std::chrono::steady_clock::now();
        for (size_t i = 0; i < x.size(); i++) tr.tick(x[i]);
        auto t1 = std::chrono::steady_clock::now();
        sink += tr.m_periodF;
        double cyc = std::chrono::duration<double, std::nano>(t1 - t0).count() / (double)x.size();
        if (cyc < best) best = cyc;
    }
    printf("cycles per sample: %.1f (sink %.1f)\n", best, sink);
    return 0;
}
