#ifndef ALOOP_TELEMETRY_H
#define ALOOP_TELEMETRY_H

namespace aloop {

class AudioThread;

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
