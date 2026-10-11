#include <arpa/inet.h>
#include <errno.h>
#include <netinet/in.h>
#include <poll.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <time.h>
#include <unistd.h>

#define kMaxFlows 4096
#define kCaptureBufferBytes 65536
#define kDefaultSeconds 8
#define kIpProtocolUdp 17
#define kEtherTypeIpv4 0x0800
#define kEtherTypeVlan 0x8100
#define kEtherTypeStackedVlan 0x88A8
#define kEtherTypeAll 0x0003
#define kEthernetHeaderBytes 14
#define kVlanHeaderBytes 18
#define kMinimumIpHeaderBytes 20
#define kUdpHeaderBytes 8

struct Flow
{
    uint32_t src;
    uint32_t dst;
    uint16_t dport;
    uint64_t count;
    uint32_t lastSrc;
    uint16_t lastSport;
    uint64_t rawSeen;
    uint64_t packetSeen;
};

static struct Flow g_dstFlows[kMaxFlows];
static size_t g_dstFlowCount;
static struct Flow g_srcFlows[kMaxFlows];
static size_t g_srcFlowCount;

static uint64_t g_packetsFromRawSocket;
static uint64_t g_packetsFromPacketSocket;
static uint64_t g_skippedShort;
static uint64_t g_skippedNotIpv4;
static uint64_t g_skippedNotUdp;
static uint64_t g_skippedFragment;

static int g_rawFd = -1;
static int g_packetFd = -1;

static int isMulticastAddress(uint32_t networkOrderAddress)
{
    return ((ntohl(networkOrderAddress) >> 28) & 0xF) == 0xE;
}

static struct Flow *flowSlot(struct Flow *table, size_t *used, uint32_t src, uint32_t dst, uint16_t dport)
{
    size_t i;
    for (i = 0; i < *used; ++i)
        if (table[i].src == src && table[i].dst == dst && table[i].dport == dport)
            return &table[i];

    if (*used >= kMaxFlows)
        return NULL;

    struct Flow *slot = &table[*used];
    memset(slot, 0, sizeof *slot);
    slot->src = src;
    slot->dst = dst;
    slot->dport = dport;
    ++*used;
    return slot;
}

static void recordPacket(uint32_t src, uint32_t dst, uint16_t sport, uint16_t dport, int fromRawSocket)
{
    struct Flow *byDst = flowSlot(g_dstFlows, &g_dstFlowCount, 0, dst, dport);
    if (byDst)
    {
        byDst->count++;
        byDst->lastSrc = src;
        byDst->lastSport = sport;
        if (fromRawSocket)
            byDst->rawSeen++;
        else
            byDst->packetSeen++;
    }

    struct Flow *bySrc = flowSlot(g_srcFlows, &g_srcFlowCount, src, dst, dport);
    if (bySrc)
    {
        bySrc->count++;
        bySrc->lastSrc = src;
        bySrc->lastSport = sport;
        if (fromRawSocket)
            bySrc->rawSeen++;
        else
            bySrc->packetSeen++;
    }
}

static void parseUdpDatagram(const unsigned char *data, size_t len, int fromRawSocket)
{
    if (len < kMinimumIpHeaderBytes)
    {
        g_skippedShort++;
        return;
    }

    unsigned version = (unsigned)(data[0] >> 4);
    if (version != 4)
    {
        g_skippedNotIpv4++;
        return;
    }

    size_t headerBytes = (size_t)(data[0] & 0x0F) * 4;
    if (headerBytes < kMinimumIpHeaderBytes || len < headerBytes)
    {
        g_skippedShort++;
        return;
    }

    unsigned protocol = data[9];
    if (protocol != kIpProtocolUdp)
    {
        g_skippedNotUdp++;
        return;
    }

    unsigned fragmentOffset = ((unsigned)data[6] << 8 | data[7]) & 0x1FFF;
    if (fragmentOffset != 0)
    {
        g_skippedFragment++;
        return;
    }

    if (len < headerBytes + kUdpHeaderBytes)
    {
        g_skippedShort++;
        return;
    }

    uint32_t src;
    uint32_t dst;
    memcpy(&src, data + 12, 4);
    memcpy(&dst, data + 16, 4);

    const unsigned char *udp = data + headerBytes;
    uint16_t sport = (uint16_t)((unsigned)udp[0] << 8 | udp[1]);
    uint16_t dport = (uint16_t)((unsigned)udp[2] << 8 | udp[3]);

    recordPacket(src, dst, sport, dport, fromRawSocket);
}

static void parseEthernetFrame(const unsigned char *data, size_t len)
{
    if (len < kEthernetHeaderBytes)
    {
        g_skippedShort++;
        return;
    }

    unsigned ethertype = (unsigned)data[12] << 8 | data[13];
    size_t offset = kEthernetHeaderBytes;

    if (ethertype == kEtherTypeVlan || ethertype == kEtherTypeStackedVlan)
    {
        if (len < kVlanHeaderBytes)
        {
            g_skippedShort++;
            return;
        }
        ethertype = (unsigned)data[16] << 8 | data[17];
        offset = kVlanHeaderBytes;
    }

    if (ethertype != kEtherTypeIpv4)
    {
        g_skippedNotIpv4++;
        return;
    }

    parseUdpDatagram(data + offset, len - offset, 0);
}

static void drainSocket(int fd, int fromRawSocket)
{
    unsigned char buffer[kCaptureBufferBytes];
    ssize_t got = recvfrom(fd, buffer, sizeof buffer, 0, NULL, NULL);
    if (got <= 0)
        return;

    if (fromRawSocket)
    {
        g_packetsFromRawSocket++;
        parseUdpDatagram(buffer, (size_t)got, 1);
    }
    else
    {
        g_packetsFromPacketSocket++;
        parseEthernetFrame(buffer, (size_t)got);
    }
}

static int flowCompare(const void *a, const void *b)
{
    const struct Flow *x = a;
    const struct Flow *y = b;
    if (x->count != y->count)
        return x->count > y->count ? -1 : 1;
    if (x->dst != y->dst)
        return x->dst < y->dst ? -1 : 1;
    if (x->dport != y->dport)
        return x->dport < y->dport ? -1 : 1;
    if (x->src != y->src)
        return x->src < y->src ? -1 : 1;
    return 0;
}

static const char *addressText(uint32_t networkOrderAddress)
{
    static char text[4][INET_ADDRSTRLEN];
    static int roundRobin;
    char *slot = text[roundRobin++ & 3];
    inet_ntop(AF_INET, &networkOrderAddress, slot, INET_ADDRSTRLEN);
    return slot;
}

static void printDestinationTable(void)
{
    printf("--- destination table: dst_ip:dst_port  count  last_src_ip:src_port  [mcast|ucast]  dst_wire_hex ---\n");
    for (size_t i = 0; i < g_dstFlowCount; ++i)
    {
        const struct Flow *f = &g_dstFlows[i];
        printf("%s:%u  %llu  %s:%u  %s  wire=0x%08X  raw=%llu pkt=%llu\n",
               addressText(f->dst),
               (unsigned)f->dport,
               (unsigned long long)f->count,
               addressText(f->lastSrc),
               (unsigned)f->lastSport,
               isMulticastAddress(f->dst) ? "[mcast]" : "[ucast]",
               (unsigned)ntohl(f->dst),
               (unsigned long long)f->rawSeen,
               (unsigned long long)f->packetSeen);
    }
    if (g_dstFlowCount == 0)
        printf("(no udp datagrams captured)\n");
}

static void printSourceTable(void)
{
    printf("--- source table: src_ip:src_port > dst_ip:dst_port  count  [mcast|ucast]  dst_wire_hex ---\n");
    for (size_t i = 0; i < g_srcFlowCount; ++i)
    {
        const struct Flow *f = &g_srcFlows[i];
        printf("%s:%u > %s:%u  %llu  %s  wire=0x%08X  raw=%llu pkt=%llu\n",
               addressText(f->src),
               (unsigned)f->lastSport,
               addressText(f->dst),
               (unsigned)f->dport,
               (unsigned long long)f->count,
               isMulticastAddress(f->dst) ? "[mcast]" : "[ucast]",
               (unsigned)ntohl(f->dst),
               (unsigned long long)f->rawSeen,
               (unsigned long long)f->packetSeen);
    }
}

static void bindToInterface(int fd, const char *iface)
{
    if (!iface || !*iface)
        return;
    if (setsockopt(fd, SOL_SOCKET, SO_BINDTODEVICE, iface, strlen(iface) + 1) < 0)
        fprintf(stderr, "SO_BINDTODEVICE %s failed: %s\n", iface, strerror(errno));
}

static void applyReceiveTimeout(int fd, int seconds)
{
    struct timeval tv;
    tv.tv_sec = seconds;
    tv.tv_usec = 0;
    if (setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof tv) < 0)
        fprintf(stderr, "SO_RCVTIMEO failed: %s\n", strerror(errno));
}

static long elapsedMilliseconds(const struct timespec *since)
{
    struct timespec now;
    clock_gettime(CLOCK_MONOTONIC, &now);
    return (long)(now.tv_sec - since->tv_sec) * 1000 + (now.tv_nsec - since->tv_nsec) / 1000000;
}

int main(int argc, char **argv)
{
    int seconds = kDefaultSeconds;
    if (argc > 1)
    {
        int parsed = atoi(argv[1]);
        if (parsed > 0)
            seconds = parsed;
    }
    const char *iface = argc > 2 ? argv[2] : NULL;

    g_rawFd = socket(AF_INET, SOCK_RAW, kIpProtocolUdp);
    if (g_rawFd < 0)
        fprintf(stderr, "AF_INET SOCK_RAW IPPROTO_UDP unavailable: %s\n", strerror(errno));
    else
    {
        bindToInterface(g_rawFd, iface);
        applyReceiveTimeout(g_rawFd, seconds);
    }

    g_packetFd = socket(AF_PACKET, SOCK_RAW, htons(kEtherTypeAll));
    if (g_packetFd < 0)
        fprintf(stderr, "AF_PACKET SOCK_RAW unavailable: %s\n", strerror(errno));
    else
    {
        bindToInterface(g_packetFd, iface);
        applyReceiveTimeout(g_packetFd, seconds);
    }

    if (g_rawFd < 0 && g_packetFd < 0)
    {
        fprintf(stderr, "no capture socket could be opened\n");
        return 1;
    }

    struct timespec startedAt;
    clock_gettime(CLOCK_MONOTONIC, &startedAt);

    while (1)
    {
        long remaining = (long)seconds * 1000 - elapsedMilliseconds(&startedAt);
        if (remaining <= 0)
            break;

        struct pollfd waiters[2];
        int waiterCount = 0;
        int rawIndex = -1;
        int packetIndex = -1;

        if (g_rawFd >= 0)
        {
            rawIndex = waiterCount;
            waiters[waiterCount].fd = g_rawFd;
            waiters[waiterCount].events = POLLIN;
            waiters[waiterCount].revents = 0;
            waiterCount++;
        }
        if (g_packetFd >= 0)
        {
            packetIndex = waiterCount;
            waiters[waiterCount].fd = g_packetFd;
            waiters[waiterCount].events = POLLIN;
            waiters[waiterCount].revents = 0;
            waiterCount++;
        }

        int ready = poll(waiters, waiterCount, (int)remaining);
        if (ready < 0)
        {
            if (errno == EINTR)
                continue;
            fprintf(stderr, "poll failed: %s\n", strerror(errno));
            break;
        }
        if (ready == 0)
            continue;

        if (rawIndex >= 0 && waiters[rawIndex].revents & POLLIN)
            drainSocket(g_rawFd, 1);
        if (packetIndex >= 0 && waiters[packetIndex].revents & POLLIN)
            drainSocket(g_packetFd, 0);
    }

    qsort(g_dstFlows, g_dstFlowCount, sizeof g_dstFlows[0], flowCompare);
    qsort(g_srcFlows, g_srcFlowCount, sizeof g_srcFlows[0], flowCompare);

    printf("sniff_seconds=%d iface=%s raw_fd=%s packet_fd=%s raw_pkts=%llu packet_pkts=%llu skipped_short=%llu not_ipv4=%llu not_udp=%llu frag=%llu\n",
           seconds,
           iface ? iface : "any",
           g_rawFd >= 0 ? "open" : "closed",
           g_packetFd >= 0 ? "open" : "closed",
           (unsigned long long)g_packetsFromRawSocket,
           (unsigned long long)g_packetsFromPacketSocket,
           (unsigned long long)g_skippedShort,
           (unsigned long long)g_skippedNotIpv4,
           (unsigned long long)g_skippedNotUdp,
           (unsigned long long)g_skippedFragment);
    fflush(stdout);

    printDestinationTable();
    printSourceTable();

    if (g_rawFd >= 0)
        close(g_rawFd);
    if (g_packetFd >= 0)
        close(g_packetFd);
    return 0;
}
