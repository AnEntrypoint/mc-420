#ifndef ALOOP_CLIP_EXPORTER_H
#define ALOOP_CLIP_EXPORTER_H

#include <atomic>
#include <cstdint>
#include <string>
#include <vector>

namespace aloop {

constexpr int kClipExporterMaxLoopers = 20;
constexpr int kClipExporterMaxLen = 48000 * 60;

enum class ClipExportState : uint8_t { Idle, Capturing, Done, Failed };

class ClipExporter {
public:
    ClipExporter(std::string mountPoint, int sampleRate);
    ~ClipExporter();

    void trigger(const bool* looperHasContent, const float* looperWrapLen, unsigned now_ms);

    void pushBlock(int looper, const float* samples, int n);

    void poll(unsigned now_ms);

    ClipExportState state() const { return m_state.load(std::memory_order_relaxed); }

private:
    std::string m_mountPoint;
    int m_sampleRate;

    std::atomic<ClipExportState> m_state{ClipExportState::Idle};
    bool m_looperArmed[kClipExporterMaxLoopers] = {};
    uint64_t m_looperTargetSamples[kClipExporterMaxLoopers] = {};
    uint64_t m_looperCapturedSamples[kClipExporterMaxLoopers] = {};
    float* m_looperCaptureBuf[kClipExporterMaxLoopers] = {};
    std::string m_saveDir;

    bool driveHasHeadroom(uint64_t bytesNeeded) const;
    bool finalizeIfComplete();
    bool writeAllClips();
    bool writeWavFile(const std::string& path, const float* samples, uint64_t n) const;
    void writeDawProjectFiles(const std::vector<std::string>& clipFilenames);
    std::string makeUniqueSaveDir(unsigned now_ms) const;
};

}
#endif
