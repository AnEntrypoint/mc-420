#include "remote_control.h"

#include <sys/socket.h>
#include <sys/reboot.h>
#include <netinet/in.h>
#include <unistd.h>
#include <fcntl.h>
#include <cerrno>
#include <cstdio>
#include <cstring>
#include <cstdint>

namespace aloop {

namespace {
int g_sock = -1;
constexpr long kLogOffsetUninitialized = -1;
long g_logOffset = kLogOffsetUninitialized;
constexpr const char* kLogPath = "/var/log/aloop.log";
constexpr size_t kMaxReplyBytes = 4096;
}

void RemoteControl::start(int udpPort, const std::string& token) {
    token_ = token;
    if (token_.empty()) {
        fprintf(stderr, "[remote] no token configured ([remote] token= in aloop.conf) — reboot/log-tail listener DISABLED\n");
        return;
    }
    g_sock = socket(AF_INET, SOCK_DGRAM, 0);
    if (g_sock < 0) { fprintf(stderr, "[remote] socket failed\n"); return; }
    int fl = fcntl(g_sock, F_GETFL, 0);
    fcntl(g_sock, F_SETFL, fl | O_NONBLOCK);
    sockaddr_in a{};
    a.sin_family = AF_INET;
    a.sin_addr.s_addr = htonl(INADDR_ANY);
    a.sin_port = htons((uint16_t)udpPort);
    if (bind(g_sock, (sockaddr*)&a, sizeof a) < 0) {
        fprintf(stderr, "[remote] bind :%d failed\n", udpPort);
        close(g_sock); g_sock = -1;
        return;
    }
    fprintf(stderr, "[remote] listening on udp/%d (REBOOT:<token> / LOGTAIL:<token>)\n", udpPort);
}

void RemoteControl::stop() { if (g_sock >= 0) { close(g_sock); g_sock = -1; } }

static size_t readLogBytesSinceLastPoll(char* buf, size_t maxBytes) {
    FILE* f = fopen(kLogPath, "rb");
    if (!f) return 0;
    if (g_logOffset == kLogOffsetUninitialized) {
        fseek(f, 0, SEEK_END);
        g_logOffset = ftell(f);
        fclose(f);
        return 0;
    }
    fseek(f, 0, SEEK_END);
    long end = ftell(f);
    bool logWasRotatedOrTruncated = end < g_logOffset;
    if (logWasRotatedOrTruncated) g_logOffset = 0;
    fseek(f, g_logOffset, SEEK_SET);
    size_t bytesRead = fread(buf, 1, maxBytes, f);
    g_logOffset = ftell(f);
    fclose(f);
    return bytesRead;
}

void RemoteControl::poll() {
    if (g_sock < 0 || token_.empty()) return;

    char req[128]; sockaddr_in from{}; socklen_t fl = sizeof from;
    for (;;) {
        ssize_t r = recvfrom(g_sock, req, sizeof req - 1, 0, (sockaddr*)&from, &fl);
        if (r <= 0) break;
        req[r] = 0;

        std::string msg(req, (size_t)r);
        auto colon = msg.find(':');
        if (colon == std::string::npos) continue;
        std::string verb = msg.substr(0, colon);
        std::string tok  = msg.substr(colon + 1);
        if (tok != token_) {
            fprintf(stderr, "[remote] rejected %s: bad token\n", verb.c_str());
            continue;
        }

        if (verb == "REBOOT") {
            fprintf(stderr, "[remote] REBOOT accepted — rebooting now\n");
            sync();
            reboot(RB_AUTOBOOT);
            fprintf(stderr, "[remote] reboot(2) failed: %s (need CAP_SYS_BOOT?)\n", strerror(errno));
        } else if (verb == "LOGTAIL") {
            static char buf[kMaxReplyBytes];
            size_t bytesToSend = readLogBytesSinceLastPoll(buf, sizeof buf);
            sendto(g_sock, buf, bytesToSend, 0, (sockaddr*)&from, fl);
        }
    }
}

}
