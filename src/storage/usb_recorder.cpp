#include "usb_recorder.h"

#include <sys/stat.h>
#include <sys/statvfs.h>
#include <sys/types.h>
#include <fcntl.h>
#include <unistd.h>
#include <cerrno>
#include <cstdio>
#include <cstring>
#include <algorithm>

namespace aloop {

namespace {

bool mkdirRecursive(const std::string& path) {
    std::string cur;
    size_t pos = 0;
    if (!path.empty() && path[0] == '/') { cur = "/"; pos = 1; }
    while (pos <= path.size()) {
        size_t next = path.find('/', pos);
        if (next == std::string::npos) next = path.size();
        cur += path.substr(pos, next - pos);
        if (!cur.empty()) {
            if (mkdir(cur.c_str(), 0755) != 0 && errno != EEXIST) return false;
        }
        cur += "/";
        pos = next + 1;
    }
    return true;
}

void writeU32LE(uint8_t* p, uint32_t v) {
    p[0] = (uint8_t)(v & 0xFF);
    p[1] = (uint8_t)((v >> 8) & 0xFF);
    p[2] = (uint8_t)((v >> 16) & 0xFF);
    p[3] = (uint8_t)((v >> 24) & 0xFF);
}

void writeU16LE(uint8_t* p, uint16_t v) {
    p[0] = (uint8_t)(v & 0xFF);
    p[1] = (uint8_t)((v >> 8) & 0xFF);
}

}

UsbRecorder::UsbRecorder(std::string mountPoint, int sampleRate, int chunkMinutes, int chunkCount)
    : m_mountPoint(std::move(mountPoint)),
      m_recordDir(m_mountPoint + "/aloop-rec"),
      m_sampleRate(sampleRate),
      m_chunkCount(chunkCount < 2 ? 2 : chunkCount),
      m_chunkMaxSamples((uint64_t)sampleRate * 60ull * (uint64_t)(chunkMinutes < 1 ? 1 : chunkMinutes)) {
    m_ringCapacity = (uint64_t)sampleRate * 5ull;
    m_ring = new int16_t[(size_t)m_ringCapacity];
    memset(m_ring, 0, sizeof(int16_t) * (size_t)m_ringCapacity);
    mkdirRecursive(m_mountPoint);
}

UsbRecorder::~UsbRecorder() {
    if (m_recording.load(std::memory_order_relaxed)) endRecording();
    delete[] m_ring;
}

void UsbRecorder::pushBlock(const float* samples, int n) {
    if (n <= 0) return;
    if (!m_recording.load(std::memory_order_relaxed)) return;
    uint64_t w = m_writeCount.load(std::memory_order_relaxed);
    uint64_t r = m_readCount.load(std::memory_order_acquire);
    uint64_t used = w - r;
    uint64_t freeSpace = m_ringCapacity - used;
    if ((uint64_t)n > freeSpace) {
        uint64_t drop = (uint64_t)n - freeSpace;
        r += drop;
        m_readCount.store(r, std::memory_order_release);
        m_overruns.fetch_add(1, std::memory_order_relaxed);
    }
    uint64_t start = w % m_ringCapacity;
    uint64_t firstPiece = std::min((uint64_t)n, m_ringCapacity - start);
    for (uint64_t i = 0; i < firstPiece; i++) {
        float s = samples[i];
        if (s > 1.0f) s = 1.0f;
        else if (s < -1.0f) s = -1.0f;
        m_ring[(size_t)(start + i)] = (int16_t)(s * 32767.0f);
    }
    uint64_t secondPiece = (uint64_t)n - firstPiece;
    for (uint64_t i = 0; i < secondPiece; i++) {
        float s = samples[firstPiece + i];
        if (s > 1.0f) s = 1.0f;
        else if (s < -1.0f) s = -1.0f;
        m_ring[(size_t)i] = (int16_t)(s * 32767.0f);
    }
    m_writeCount.store(w + (uint64_t)n, std::memory_order_release);
}

bool UsbRecorder::isMounted() const {
    struct stat selfSt {};
    struct stat parentSt {};
    if (stat(m_mountPoint.c_str(), &selfSt) != 0) return false;
    std::string parent = m_mountPoint + "/..";
    if (stat(parent.c_str(), &parentSt) != 0) return false;
    return selfSt.st_dev != parentSt.st_dev;
}

int UsbRecorder::effectiveChunkCount() const {
    struct statvfs sv {};
    if (statvfs(m_mountPoint.c_str(), &sv) != 0) return m_chunkCount;
    uint64_t availableBytes = (uint64_t)sv.f_bavail * (uint64_t)sv.f_frsize;
    uint64_t perChunkBytes = m_chunkMaxSamples * sizeof(int16_t) + 44;
    uint64_t usableBytes = (uint64_t)(availableBytes * 0.9);
    int fit = (int)(usableBytes / perChunkBytes);
    if (fit < 2) fit = 2;
    return std::min(fit, m_chunkCount);
}

void UsbRecorder::writeWavHeader(int fd, uint32_t dataBytes) const {
    constexpr uint16_t kWavFormatPcm = 1;
    constexpr uint16_t kNumChannelsMono = 1;
    constexpr uint16_t kBlockAlignBytes = sizeof(int16_t);
    constexpr uint16_t kBitsPerSample = 16;
    uint8_t hdr[44];
    memcpy(hdr, "RIFF", 4);
    writeU32LE(hdr + 4, 36 + dataBytes);
    memcpy(hdr + 8, "WAVE", 4);
    memcpy(hdr + 12, "fmt ", 4);
    writeU32LE(hdr + 16, 16);
    writeU16LE(hdr + 20, kWavFormatPcm);
    writeU16LE(hdr + 22, kNumChannelsMono);
    writeU32LE(hdr + 24, (uint32_t)m_sampleRate);
    writeU32LE(hdr + 28, (uint32_t)m_sampleRate * kBlockAlignBytes);
    writeU16LE(hdr + 32, kBlockAlignBytes);
    writeU16LE(hdr + 34, kBitsPerSample);
    memcpy(hdr + 36, "data", 4);
    writeU32LE(hdr + 40, dataBytes);
    lseek(fd, 0, SEEK_SET);
    ssize_t written = write(fd, hdr, sizeof hdr);
    (void)written;
}

bool UsbRecorder::openChunk(int index) {
    char path[600];
    snprintf(path, sizeof path, "%s/aloop_chunk_%02d.wav", m_recordDir.c_str(), index);
    int fd = open(path, O_CREAT | O_WRONLY | O_TRUNC, 0644);
    if (fd < 0) {
        fprintf(stderr, "[usb-rec] could not open %s (%s)\n", path, strerror(errno));
        return false;
    }
    writeWavHeader(fd, 0);
    m_fd = fd;
    m_chunkIndex = index;
    m_chunkSamplesWritten = 0;
    return true;
}

void UsbRecorder::finalizeChunk() {
    if (m_fd < 0) return;
    writeWavHeader(m_fd, (uint32_t)(m_chunkSamplesWritten * sizeof(int16_t)));
    close(m_fd);
    m_fd = -1;
}

bool UsbRecorder::beginRecording() {
    if (!mkdirRecursive(m_recordDir)) {
        fprintf(stderr, "[usb-rec] could not create %s (%s)\n", m_recordDir.c_str(), strerror(errno));
        return false;
    }
    m_effectiveChunkCount = effectiveChunkCount();
    if (!openChunk(0)) return false;
    fprintf(stderr, "[usb-rec] recording started at %s (%d chunks x %llu samples)\n",
            m_recordDir.c_str(), m_effectiveChunkCount, (unsigned long long)m_chunkMaxSamples);
    return true;
}

void UsbRecorder::endRecording() {
    finalizeChunk();
    fprintf(stderr, "[usb-rec] recording stopped (drive unmounted or write failed)\n");
}

bool UsbRecorder::drainToFile() {
    uint64_t w = m_writeCount.load(std::memory_order_acquire);
    uint64_t r = m_readCount.load(std::memory_order_relaxed);
    uint64_t avail = w - r;
    while (avail > 0) {
        uint64_t chunkRemaining = m_chunkMaxSamples - m_chunkSamplesWritten;
        uint64_t take = std::min(avail, chunkRemaining);
        uint64_t start = r % m_ringCapacity;
        uint64_t firstPiece = std::min(take, m_ringCapacity - start);
        ssize_t w1 = write(m_fd, &m_ring[(size_t)start], (size_t)firstPiece * sizeof(int16_t));
        if (w1 < 0) { m_readCount.store(r, std::memory_order_release); return false; }
        uint64_t secondPiece = take - firstPiece;
        if (secondPiece > 0) {
            ssize_t w2 = write(m_fd, &m_ring[0], (size_t)secondPiece * sizeof(int16_t));
            if (w2 < 0) { m_readCount.store(r + firstPiece, std::memory_order_release); return false; }
        }
        r += take;
        avail -= take;
        m_chunkSamplesWritten += take;
        if (m_chunkSamplesWritten >= m_chunkMaxSamples) {
            finalizeChunk();
            int next = (m_chunkIndex + 1) % m_effectiveChunkCount;
            if (!openChunk(next)) { m_readCount.store(r, std::memory_order_release); return false; }
        }
    }
    m_readCount.store(r, std::memory_order_release);
    return true;
}

void UsbRecorder::poll() {
    bool mounted = isMounted();
    bool wasRecording = m_recording.load(std::memory_order_relaxed);
    if (mounted && !wasRecording) {
        if (beginRecording()) m_recording.store(true, std::memory_order_relaxed);
    } else if (!mounted && wasRecording) {
        endRecording();
        m_recording.store(false, std::memory_order_relaxed);
        m_readCount.store(m_writeCount.load(std::memory_order_acquire), std::memory_order_release);
    }
    if (m_recording.load(std::memory_order_relaxed)) {
        if (!drainToFile()) {
            endRecording();
            m_recording.store(false, std::memory_order_relaxed);
            m_readCount.store(m_writeCount.load(std::memory_order_acquire), std::memory_order_release);
        }
    }
}

}
