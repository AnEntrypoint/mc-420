#ifndef ALOOP_MIDI_CLOCK_H
#define ALOOP_MIDI_CLOCK_H

#include <atomic>
#include <pthread.h>

namespace aloop {

class LinkBridge;

class MidiClock {
public:
    void start(LinkBridge* link, int audioPriority);
    void stop();

private:
    static void* trampoline(void* self);
    void run();

    LinkBridge*      link_ = nullptr;
    int              audioPriority_ = 0;
    pthread_t        thread_{};
    bool             threadStarted_ = false;
    std::atomic<bool> run_{false};
};

}

#endif
