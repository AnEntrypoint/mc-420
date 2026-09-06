#ifndef ALOOP_MIDI_CLOCK_H
#define ALOOP_MIDI_CLOCK_H

#include <atomic>
#include <pthread.h>

namespace aloop {

class LinkBridge;

class MidiClock {
public:
    void start(LinkBridge* link);
    void stop();

private:
    static void* trampoline(void* self);
    void run();

    LinkBridge*      link_ = nullptr;
    pthread_t        thread_{};
    bool             threadStarted_ = false;
    std::atomic<bool> run_{false};
};

}

#endif
