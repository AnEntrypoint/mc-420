#include "phrase_mesh.h"
#include <cstdint>

#include <arpa/inet.h>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <ctime>
#include <fcntl.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

namespace aloop {

namespace {
constexpr const char* kGroup = "224.76.78.76";
constexpr double kSendPeriodSeconds = 1.0;
constexpr double kPeerFreshSeconds = 5.0;
constexpr float kMinPhraseBeats = 1.0f;
constexpr float kMaxPhraseBeats = 128.0f;
constexpr float kBeatEpsilon = 0.001f;

double monotonicSeconds() {
    timespec ts{};
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (double)ts.tv_sec + (double)ts.tv_nsec / 1e9;
}
}

void PhraseMesh::start(bool enabled, int udpPort) {
    if (!enabled) {
        fprintf(stderr, "[phrase] phrase message disabled ([link] phrase_mesh_enabled = false)\n");
        return;
    }
    port_ = udpPort;
    sock_ = socket(AF_INET, SOCK_DGRAM, 0);
    if (sock_ < 0) { fprintf(stderr, "[phrase] socket failed\n"); return; }
    int one = 1;
    setsockopt(sock_, SOL_SOCKET, SO_REUSEADDR, &one, sizeof one);
    fcntl(sock_, F_SETFL, fcntl(sock_, F_GETFL, 0) | O_NONBLOCK);
    sockaddr_in a{};
    a.sin_family = AF_INET;
    a.sin_addr.s_addr = htonl(INADDR_ANY);
    a.sin_port = htons((uint16_t)port_);
    if (bind(sock_, (sockaddr*)&a, sizeof a) < 0) {
        fprintf(stderr, "[phrase] bind :%d failed\n", port_);
        close(sock_); sock_ = -1;
        return;
    }
    ip_mreq mreq{};
    mreq.imr_multiaddr.s_addr = inet_addr(kGroup);
    mreq.imr_interface.s_addr = htonl(INADDR_ANY);
    if (setsockopt(sock_, IPPROTO_IP, IP_ADD_MEMBERSHIP, &mreq, sizeof mreq) < 0)
        fprintf(stderr, "[phrase] join %s failed; sending only\n", kGroup);
    unsigned char ttl = 1;
    setsockopt(sock_, IPPROTO_IP, IP_MULTICAST_TTL, &ttl, sizeof ttl);
    nodeId_ = (unsigned)getpid() ^ (unsigned)(monotonicSeconds() * 1e6);
    fprintf(stderr, "[phrase] phrase message on %s:%d (node %u)\n", kGroup, port_, nodeId_);
}

void PhraseMesh::stop() {
    if (sock_ >= 0) { close(sock_); sock_ = -1; }
}

void PhraseMesh::drain(double nowSeconds) {
    char buf[96];
    for (;;) {
        ssize_t r = recvfrom(sock_, buf, sizeof buf - 1, 0, nullptr, nullptr);
        if (r <= 0) break;
        buf[r] = 0;
        float beats = 0.0f;
        unsigned seq = 0, node = 0;
        if (sscanf(buf, "ALOOP-PHRASE/1 %f %u %u", &beats, &seq, &node) != 3) continue;
        if (node == nodeId_ || beats < kMinPhraseBeats || beats > kMaxPhraseBeats) continue;
        peerBeats_ = beats;
        peerSeq_ = seq;
        peerSeenSeconds_ = nowSeconds;
    }
}

void PhraseMesh::send(float beats) {
    char buf[96];
    int n = snprintf(buf, sizeof buf, "ALOOP-PHRASE/1 %.3f %u %u", beats, ownSeq_, nodeId_);
    sockaddr_in dst{};
    dst.sin_family = AF_INET;
    dst.sin_addr.s_addr = inet_addr(kGroup);
    dst.sin_port = htons((uint16_t)port_);
    sendto(sock_, buf, (size_t)n, 0, (sockaddr*)&dst, sizeof dst);
}

bool PhraseMesh::tick(float localPhraseBeats, float& adoptedPhraseBeats) {
    if (sock_ < 0) return false;
    const double now = monotonicSeconds();
    drain(now);
    const bool peerFresh = peerSeenSeconds_ >= 0.0 && (now - peerSeenSeconds_) < kPeerFreshSeconds
                           && peerBeats_ >= kMinPhraseBeats;

    if (localPhraseBeats < kMinPhraseBeats) {
        ownBeats_ = 0.0f;
        adopted_ = false;
        if (!peerFresh) return false;
        adopted_ = true;
        adoptedBeats_ = peerBeats_;
        adoptedPhraseBeats = peerBeats_;
        return true;
    }

    if (adopted_ && std::fabs(localPhraseBeats - adoptedBeats_) > kBeatEpsilon) adopted_ = false;

    if (!adopted_) {
        if (std::fabs(localPhraseBeats - ownBeats_) > kBeatEpsilon) {
            ownBeats_ = localPhraseBeats;
            ownSeq_++;
        }
        if (lastSendSeconds_ < 0.0 || now - lastSendSeconds_ >= kSendPeriodSeconds) {
            send(ownBeats_);
            lastSendSeconds_ = now;
        }
        return false;
    }

    if (!peerFresh || std::fabs(peerBeats_ - adoptedBeats_) <= kBeatEpsilon) return false;
    adoptedBeats_ = peerBeats_;
    adoptedPhraseBeats = peerBeats_;
    return true;
}

}
