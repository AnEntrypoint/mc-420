#ifndef ALOOP_TELEMETRY_H
#define ALOOP_TELEMETRY_H

#include <cstdint>

namespace aloop {

class AudioThread;

struct BeatPadMark {
    int      index       = -1;
    int64_t  lateMicros  = 0;
    int64_t  ageMs       = -1;
    uint64_t seq         = 0;
    double   bpm         = 0.0;
};

void publishBeatPadMark(int index, int64_t lateMicros, double bpm);
BeatPadMark beatPadMark();

class Telemetry {
public:
    void start(int udpPort = 4445, const AudioThread* audioOrNull = nullptr);
    void stop();

    void publish();

private:
    const AudioThread* audio_ = nullptr;
};

}
#endif
