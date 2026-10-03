#include "link_bridge.h"

#include <atomic>
#include <cstddef>
#include <cstdio>
#include <ctime>

#if __has_include(<ableton/Link.hpp>)
#include <ableton/Link.hpp>
#define ALOOP_HAVE_LINK 1
#endif

namespace aloop {

namespace {
std::atomic<unsigned> g_active{0};
std::atomic<bool> g_weSetTempo{false};

std::atomic<int> g_lastLoggedPeers{-1};
std::atomic<double> g_lastLoggedTempo{-1.0};
std::atomic<bool> g_localTransportRunning{false};
std::atomic<std::size_t> g_pendingPeers{0};
std::atomic<double> g_pendingTempo{120.0};
std::atomic<bool> g_havePendingPeers{false};
std::atomic<bool> g_havePendingTempo{false};
}

void LinkBridge::start(double sampleRate, bool enabled) {
    (void)sampleRate;
    if (!enabled) { fprintf(stderr, "[link] disabled by config\n"); return; }
#ifdef ALOOP_HAVE_LINK
    auto* l = new ableton::Link(120.0);
    l->enable(true);
    l->enableStartStopSync(false);

    l->setNumPeersCallback([](std::size_t peers) {
        g_pendingPeers.store(peers, std::memory_order_relaxed);
        g_havePendingPeers.store(true, std::memory_order_release);
    });
    l->setTempoCallback([](double bpm) {
        g_pendingTempo.store(bpm, std::memory_order_relaxed);
        g_havePendingTempo.store(true, std::memory_order_release);
    });

    link_ = l;
    fprintf(stderr, "[link] Ableton Link enabled (official lib, UDP multicast, clock-only: tempo and phase shared, transport local, quantum %.1f)\n",
            kLinkQuantum);
#else
    fprintf(stderr, "[link] built without the Link submodule — Link inactive\n");
#endif
}

void LinkBridge::stop() {
#ifdef ALOOP_HAVE_LINK
    if (link_) { delete (ableton::Link*)link_; link_ = nullptr; }
#endif
}

void LinkBridge::controlTick() {
#ifdef ALOOP_HAVE_LINK
    if (!link_) return;

    if (g_havePendingPeers.exchange(false, std::memory_order_acquire)) {
        int peers = (int)g_pendingPeers.load(std::memory_order_relaxed);
        if (peers != g_lastLoggedPeers.load(std::memory_order_relaxed)) {
            g_lastLoggedPeers.store(peers, std::memory_order_relaxed);
            fprintf(stderr, "[link] peers now %d\n", peers);
        }
    }
    if (g_havePendingTempo.exchange(false, std::memory_order_acquire)) {
        double bpm = g_pendingTempo.load(std::memory_order_relaxed);
        if (bpm != g_lastLoggedTempo.load(std::memory_order_relaxed)) {
            g_lastLoggedTempo.store(bpm, std::memory_order_relaxed);
            fprintf(stderr, "[link] session tempo now %.3f bpm\n", bpm);
        }
    }
    publishSnapshot();
#endif
}

void LinkBridge::publishSnapshot() {
#ifdef ALOOP_HAVE_LINK
    if (!link_) return;
    auto* l = (ableton::Link*)link_;
    auto state = l->captureAppSessionState();
    const auto now = l->clock().micros();
    timespec capTs{};
    clock_gettime(CLOCK_MONOTONIC, &capTs);

    unsigned cur = g_active.load(std::memory_order_relaxed);
    unsigned nxt = cur ^ 1u;
    LinkSnapshot& s = buf_[nxt];
    s.bpm       = state.tempo();
    s.peerCount = (int)l->numPeers();
    s.synced    = (s.peerCount > 0);
    const double phase = state.phaseAtTime(now, kLinkPhaseQuantumBeats);
    s.phaseValid          = true;
    s.beatPhaseMicroBeats = (int64_t)(phase * 1e6);
    s.quantumMicroBeats   = (int64_t)(kLinkPhaseQuantumBeats * 1e6);
    s.captureMicros       = (int64_t)capTs.tv_sec * 1000000 + capTs.tv_nsec / 1000;
    s.isPlaying           = g_localTransportRunning.load(std::memory_order_relaxed);
    s.weOwnTempo          = g_weSetTempo.load(std::memory_order_relaxed);
    g_active.store(nxt, std::memory_order_release);
#endif
}

LinkSnapshot LinkBridge::audioRead() const {
    unsigned cur = g_active.load(std::memory_order_acquire);
    return buf_[cur];
}

void LinkBridge::imposeTempo(double bpm) {
#ifdef ALOOP_HAVE_LINK
    if (!link_) return;
    auto* l = (ableton::Link*)link_;
    auto state = l->captureAppSessionState();
    state.setTempo(bpm, l->clock().micros());
    l->commitAppSessionState(state);
    g_weSetTempo.store(true, std::memory_order_relaxed);
    publishSnapshot();
    fprintf(stderr, "[link] first loop owns the tempo: session set to %.3f bpm, %u peer(s) follow\n",
            bpm, (unsigned)l->numPeers());
#else
    (void)bpm;
#endif
}

void LinkBridge::resetTempoAuthority() {
    g_weSetTempo.store(false, std::memory_order_relaxed);
}

LinkBridge::BeatNow LinkBridge::beatNow() const {
    BeatNow b;
#ifdef ALOOP_HAVE_LINK
    if (!link_) return b;
    auto* l = (ableton::Link*)link_;
    auto state = l->captureAppSessionState();
    const auto now = l->clock().micros();
    b.valid     = true;
    b.isPlaying = g_localTransportRunning.load(std::memory_order_relaxed);
    b.beat      = state.beatAtTime(now, kLinkQuantum);
    b.bpm       = state.tempo();
    b.peerCount = (int)l->numPeers();
    b.nowMicros = (int64_t)now.count();
#endif
    return b;
}

int64_t LinkBridge::microsAtBeat(double beat) const {
#ifdef ALOOP_HAVE_LINK
    if (!link_) return 0;
    auto* l = (ableton::Link*)link_;
    auto state = l->captureAppSessionState();
    return (int64_t)state.timeAtBeat(beat, kLinkQuantum).count();
#else
    (void)beat;
    return 0;
#endif
}

void LinkBridge::setLocalTransportPlaying(bool playing) {
    const bool was = g_localTransportRunning.exchange(playing, std::memory_order_relaxed);
    if (was == playing) return;
    fprintf(stderr, "[link] local transport %s (not shared with peers)\n",
            playing ? "PLAYING" : "STOPPED");
}

}
