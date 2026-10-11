#include "link_bridge.h"

#include <atomic>
#include <cmath>
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
std::atomic<double> g_ownedBpm{0.0};
std::atomic<double> g_loopPhaseQuantumBeats{0.0};

std::atomic<int> g_lastLoggedPeers{-1};
std::atomic<double> g_lastLoggedTempo{-1.0};
std::atomic<bool> g_localTransportRunning{true};
std::atomic<std::size_t> g_pendingPeers{0};
std::atomic<double> g_pendingTempo{120.0};
std::atomic<bool> g_havePendingPeers{false};
std::atomic<bool> g_havePendingTempo{false};

std::atomic<int> g_settledPeers{-1};
std::atomic<int> g_candidatePeers{-1};
std::atomic<int> g_candidateTicks{0};
constexpr int kPeerSettleTicks = 2;

std::atomic<bool> g_havePhaseImpose{false};
std::atomic<double> g_imposeBeat{0.0};
std::atomic<double> g_imposeQuantum{16.0};
std::atomic<int64_t> g_imposeAtMicros{0};
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
    if (!link_) {
        g_havePhaseImpose.store(false, std::memory_order_relaxed);
        return;
    }

    if (g_havePendingPeers.exchange(false, std::memory_order_acquire)) {
        int peers = (int)g_pendingPeers.load(std::memory_order_relaxed);
        if (peers != g_lastLoggedPeers.load(std::memory_order_relaxed)) {
            g_lastLoggedPeers.store(peers, std::memory_order_relaxed);
            fprintf(stderr, "[link] peers now %d\n", peers);
        }
    }
    if (g_weSetTempo.load(std::memory_order_relaxed)) {
        auto* l = (ableton::Link*)link_;
        const int peersNow = (int)l->numPeers();
        const int candidate = g_candidatePeers.load(std::memory_order_relaxed);
        const int settleTicks = (peersNow == candidate)
            ? g_candidateTicks.load(std::memory_order_relaxed) + 1
            : 1;
        g_candidatePeers.store(peersNow, std::memory_order_relaxed);
        g_candidateTicks.store(settleTicks, std::memory_order_relaxed);
        if (settleTicks >= kPeerSettleTicks && peersNow != g_settledPeers.load(std::memory_order_relaxed)) {
            g_settledPeers.store(peersNow, std::memory_order_relaxed);
            const double ownedBpm = g_ownedBpm.load(std::memory_order_relaxed);
            if (ownedBpm > 1.0) imposeTempo(ownedBpm);
        }
    }
    if (g_havePendingTempo.exchange(false, std::memory_order_acquire)) {
        double bpm = g_pendingTempo.load(std::memory_order_relaxed);
        if (bpm != g_lastLoggedTempo.load(std::memory_order_relaxed)) {
            g_lastLoggedTempo.store(bpm, std::memory_order_relaxed);
            fprintf(stderr, "[link] session tempo now %.3f bpm\n", bpm);
        }
    }
    if (g_havePhaseImpose.exchange(false, std::memory_order_acquire)) {
        auto* l = (ableton::Link*)link_;
        const double beat = g_imposeBeat.load(std::memory_order_relaxed);
        const double quantum = g_imposeQuantum.load(std::memory_order_relaxed);
        const int64_t atMicros = g_imposeAtMicros.load(std::memory_order_relaxed);
        auto state = l->captureAppSessionState();
        state.forceBeatAtTime(beat, std::chrono::microseconds(atMicros), quantum);
        l->commitAppSessionState(state);
        fprintf(stderr, "[link] first loop owns the phase: session beat %.3f forced at t=%lldus (quantum %.3f), %u peer(s) follow\n",
                beat, (long long)atMicros, quantum, (unsigned)l->numPeers());
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
    const double loopQuantum = g_loopPhaseQuantumBeats.load(std::memory_order_relaxed);
    if (loopQuantum >= 1.0) {
        s.loopPhaseMicroBeats = (int64_t)(state.phaseAtTime(now, loopQuantum) * 1e6);
        s.loopQuantumBeats    = loopQuantum;
    } else {
        s.loopPhaseMicroBeats = 0;
        s.loopQuantumBeats    = 0.0;
    }
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
    g_ownedBpm.store(bpm, std::memory_order_relaxed);
    g_weSetTempo.store(true, std::memory_order_relaxed);
    publishSnapshot();
    fprintf(stderr, "[link] first loop owns the tempo: session set to %.3f bpm, %u peer(s) follow\n",
            bpm, (unsigned)l->numPeers());
#else
    (void)bpm;
#endif
}

void LinkBridge::setLoopPhaseQuantumBeats(double beats) {
    g_loopPhaseQuantumBeats.store(beats >= 1.0 ? beats : 0.0, std::memory_order_relaxed);
}

void LinkBridge::requestPhaseImpose(double beat, int64_t atMicros, double quantum) {
    g_imposeBeat.store(beat, std::memory_order_relaxed);
    g_imposeQuantum.store(quantum > 0.0 ? quantum : kLinkQuantum, std::memory_order_relaxed);
    g_imposeAtMicros.store(atMicros, std::memory_order_relaxed);
    g_havePhaseImpose.store(true, std::memory_order_release);
}

void LinkBridge::resetTempoAuthority() {
    g_ownedBpm.store(0.0, std::memory_order_relaxed);
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

LinkBridge::BeatMark LinkBridge::beatMarkNow() const {
    BeatMark m;
#ifdef ALOOP_HAVE_LINK
    if (!link_) return m;
    auto* l = (ableton::Link*)link_;
    auto state = l->captureAppSessionState();
    const auto now = l->clock().micros();
    const double beat = state.beatAtTime(now, kLinkQuantum);
    const int64_t wholeBeat = (int64_t)std::floor(beat);
    const int64_t span = (int64_t)kLinkQuantum;
    m.valid = true;
    m.bpm = state.tempo();
    m.beat = beat;
    m.nowMicros = (int64_t)now.count();
    m.index = (int)(((wholeBeat % span) + span) % span);
    m.curBeatMicros = (int64_t)state.timeAtBeat((double)wholeBeat, kLinkQuantum).count();
    m.nextBeatMicros = (int64_t)state.timeAtBeat((double)(wholeBeat + 1), kLinkQuantum).count();
#endif
    return m;
}

void LinkBridge::setLocalTransportPlaying(bool playing) {
    const bool was = g_localTransportRunning.exchange(playing, std::memory_order_relaxed);
    if (was == playing) return;
    fprintf(stderr, "[link] local transport %s (not shared with peers)\n",
            playing ? "PLAYING" : "STOPPED");
}

}
