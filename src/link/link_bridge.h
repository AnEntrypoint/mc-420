#ifndef ALOOP_LINK_BRIDGE_H
#define ALOOP_LINK_BRIDGE_H

#include <cstdint>

namespace aloop {

constexpr double kLinkQuantum = 16.0;
constexpr double kLinkPhaseQuantumBeats = 128.0;

struct LinkSnapshot {
    double  bpm          = 120.0;
    bool    synced       = false;
    bool    phaseValid   = false;
    int64_t beatPhaseMicroBeats = 0;
    int64_t quantumMicroBeats   = 0;
    int64_t captureMicros       = 0;
    bool    isPlaying    = false;
    int     peerCount    = 0;
    bool    weOwnTempo   = false;
};

class LinkBridge {
public:
    void start(double sampleRate, bool enabled);
    void stop();

    void controlTick();

    LinkSnapshot audioRead() const;

    void imposeTempo(double bpm);
    void resetTempoAuthority();

    void requestPhaseImpose(double beat, int64_t atMicros, double quantum);

    void setLocalTransportPlaying(bool playing);

    struct BeatNow {
        bool    valid     = false;
        bool    isPlaying = false;
        double  beat      = 0.0;
        double  bpm       = 120.0;
        int     peerCount = 0;
        int64_t nowMicros = 0;
    };
    BeatNow beatNow() const;
    int64_t microsAtBeat(double beat) const;

    struct BeatMark {
        bool    valid          = false;
        int     index          = -1;
        double  bpm            = 120.0;
        double  beat           = 0.0;
        int64_t nowMicros      = 0;
        int64_t curBeatMicros  = 0;
        int64_t nextBeatMicros = 0;
    };
    BeatMark beatMarkNow() const;

private:
    void publishSnapshot();

    void* link_ = nullptr;
    LinkSnapshot buf_[2];
    unsigned active_ = 0;
};

}
#endif
