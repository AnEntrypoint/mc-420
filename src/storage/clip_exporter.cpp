#include "clip_exporter.h"

#include <sys/stat.h>
#include <sys/statvfs.h>
#include <sys/types.h>
#include <fcntl.h>
#include <unistd.h>
#include <cerrno>
#include <cstdio>
#include <cstring>
#include <ctime>
#include <algorithm>
#include <zlib.h>

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
    p[0] = (uint8_t)(v & 0xFF); p[1] = (uint8_t)((v >> 8) & 0xFF);
    p[2] = (uint8_t)((v >> 16) & 0xFF); p[3] = (uint8_t)((v >> 24) & 0xFF);
}
void writeU16LE(uint8_t* p, uint16_t v) {
    p[0] = (uint8_t)(v & 0xFF); p[1] = (uint8_t)((v >> 8) & 0xFF);
}

}

ClipExporter::ClipExporter(std::string mountPoint, int sampleRate)
    : m_mountPoint(std::move(mountPoint)), m_sampleRate(sampleRate) {
    for (int lp = 0; lp < kClipExporterMaxLoopers; lp++) {
        m_looperCaptureBuf[lp] = new float[(size_t)kClipExporterMaxLen];
    }
}

ClipExporter::~ClipExporter() {
    for (int lp = 0; lp < kClipExporterMaxLoopers; lp++) delete[] m_looperCaptureBuf[lp];
}

void ClipExporter::trigger(const bool* looperHasContent, const float* looperWrapLen, unsigned now_ms) {
    ClipExportState cur = m_state.load(std::memory_order_relaxed);
    if (cur == ClipExportState::Capturing) return;

    bool anyContent = false;
    for (int lp = 0; lp < kClipExporterMaxLoopers; lp++) {
        if (looperHasContent[lp]) { anyContent = true; break; }
    }
    if (!anyContent) {
        m_state.store(ClipExportState::Failed, std::memory_order_relaxed);
        return;
    }

    m_saveDir = makeUniqueSaveDir(now_ms);

    for (int lp = 0; lp < kClipExporterMaxLoopers; lp++) {
        if (!looperHasContent[lp]) {
            m_looperArmed[lp] = false;
            continue;
        }
        uint64_t wrapLen = (uint64_t)looperWrapLen[lp];
        if (wrapLen == 0 || wrapLen > (uint64_t)kClipExporterMaxLen) wrapLen = (uint64_t)kClipExporterMaxLen;
        m_looperArmed[lp] = true;
        m_looperTargetSamples[lp] = wrapLen;
        m_looperCapturedSamples[lp] = 0;
    }
    m_state.store(ClipExportState::Capturing, std::memory_order_relaxed);
}

void ClipExporter::pushBlock(int looper, const float* samples, int n) {
    if (looper < 0 || looper >= kClipExporterMaxLoopers) return;
    if (m_state.load(std::memory_order_relaxed) != ClipExportState::Capturing) return;
    if (!m_looperArmed[looper]) return;
    if (n <= 0) return;
    uint64_t remaining = m_looperTargetSamples[looper] - m_looperCapturedSamples[looper];
    if (remaining == 0) return;
    uint64_t take = std::min((uint64_t)n, remaining);
    float* dst = m_looperCaptureBuf[looper] + m_looperCapturedSamples[looper];
    for (uint64_t i = 0; i < take; i++) dst[i] = samples[i];
    m_looperCapturedSamples[looper] += take;
}

bool ClipExporter::driveHasHeadroom(uint64_t bytesNeeded) const {
    struct statvfs sv {};
    if (statvfs(m_mountPoint.c_str(), &sv) != 0) return false;
    uint64_t totalBytes = (uint64_t)sv.f_blocks * (uint64_t)sv.f_frsize;
    uint64_t availableBytes = (uint64_t)sv.f_bavail * (uint64_t)sv.f_frsize;
    uint64_t usedBytes = totalBytes > availableBytes ? totalBytes - availableBytes : 0;
    uint64_t driveHalfBudget = totalBytes / 2;
    return (usedBytes + bytesNeeded) <= driveHalfBudget;
}

void ClipExporter::poll(unsigned now_ms) {
    (void)now_ms;
    if (m_state.load(std::memory_order_relaxed) != ClipExportState::Capturing) return;
    finalizeIfComplete();
}

bool ClipExporter::finalizeIfComplete() {
    for (int lp = 0; lp < kClipExporterMaxLoopers; lp++) {
        if (!m_looperArmed[lp]) continue;
        if (m_looperCapturedSamples[lp] < m_looperTargetSamples[lp]) return false;
    }
    bool ok = writeAllClips();
    m_state.store(ok ? ClipExportState::Done : ClipExportState::Failed, std::memory_order_relaxed);
    return true;
}

std::string ClipExporter::makeUniqueSaveDir(unsigned now_ms) const {
    time_t t = time(nullptr);
    struct tm tmv {};
    gmtime_r(&t, &tmv);
    char stamp[64];
    snprintf(stamp, sizeof stamp, "%04d%02d%02d-%02d%02d%02d-%u",
              tmv.tm_year + 1900, tmv.tm_mon + 1, tmv.tm_mday,
              tmv.tm_hour, tmv.tm_min, tmv.tm_sec, now_ms % 1000);
    return m_mountPoint + "/aloop-clips/" + stamp;
}

bool ClipExporter::writeWavFile(const std::string& path, const float* samples, uint64_t n) const {
    int fd = open(path.c_str(), O_CREAT | O_WRONLY | O_TRUNC, 0644);
    if (fd < 0) return false;
    constexpr uint16_t kWavFormatPcm = 3;
    constexpr uint16_t kNumChannelsMono = 1;
    constexpr uint16_t kBitsPerSample = 32;
    constexpr uint16_t kBlockAlign = sizeof(float);
    uint32_t dataBytes = (uint32_t)(n * sizeof(float));
    uint8_t hdr[44];
    memcpy(hdr, "RIFF", 4);
    writeU32LE(hdr + 4, 36 + dataBytes);
    memcpy(hdr + 8, "WAVE", 4);
    memcpy(hdr + 12, "fmt ", 4);
    writeU32LE(hdr + 16, 16);
    writeU16LE(hdr + 20, kWavFormatPcm);
    writeU16LE(hdr + 22, kNumChannelsMono);
    writeU32LE(hdr + 24, (uint32_t)m_sampleRate);
    writeU32LE(hdr + 28, (uint32_t)m_sampleRate * kBlockAlign);
    writeU16LE(hdr + 32, kBlockAlign);
    writeU16LE(hdr + 34, kBitsPerSample);
    memcpy(hdr + 36, "data", 4);
    writeU32LE(hdr + 40, dataBytes);
    if (write(fd, hdr, sizeof hdr) != (ssize_t)sizeof hdr) { close(fd); return false; }
    ssize_t wrote = write(fd, samples, (size_t)dataBytes);
    close(fd);
    return wrote == (ssize_t)dataBytes;
}

bool ClipExporter::writeAllClips() {
    uint64_t totalBytes = 0;
    for (int lp = 0; lp < kClipExporterMaxLoopers; lp++) {
        if (!m_looperArmed[lp]) continue;
        totalBytes += m_looperTargetSamples[lp] * sizeof(float) + 44;
    }
    if (!driveHasHeadroom(totalBytes)) return false;

    if (!mkdirRecursive(m_saveDir)) return false;

    std::vector<std::string> clipFilenames;
    for (int lp = 0; lp < kClipExporterMaxLoopers; lp++) {
        if (!m_looperArmed[lp]) continue;
        char fname[64];
        snprintf(fname, sizeof fname, "looper%02d.wav", lp);
        std::string path = m_saveDir + "/" + fname;
        if (!writeWavFile(path, m_looperCaptureBuf[lp], m_looperTargetSamples[lp])) return false;
        clipFilenames.push_back(fname);
    }

    writeDawProjectFiles(clipFilenames);
    return true;
}

namespace {

bool gzipWriteFile(const std::string& path, const std::string& content) {
    gzFile f = gzopen(path.c_str(), "wb9");
    if (!f) return false;
    int written = gzwrite(f, content.data(), (unsigned)content.size());
    int rc = gzclose(f);
    return written == (int)content.size() && rc == Z_OK;
}

std::string xmlEscape(const std::string& s) {
    std::string out;
    out.reserve(s.size());
    for (char c : s) {
        switch (c) {
            case '&': out += "&amp;"; break;
            case '<': out += "&lt;"; break;
            case '>': out += "&gt;"; break;
            case '"': out += "&quot;"; break;
            default: out += c;
        }
    }
    return out;
}

std::string buildAbletonAls(const std::vector<std::string>& clipFilenames, int sampleRate) {
    std::string xml;
    xml += "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n";
    xml += "<Ableton MajorVersion=\"5\" MinorVersion=\"11.0_11300\" SchemaChangeCount=\"3\" Creator=\"aloop\" Revision=\"\">\n";
    xml += "  <LiveSet>\n";
    xml += "    <Tracks>\n";
    int trackId = 1;
    for (auto& fname : clipFilenames) {
        std::string escName = xmlEscape(fname);
        xml += "      <AudioTrack Id=\"" + std::to_string(trackId) + "\">\n";
        xml += "        <Name><EffectiveName Value=\"" + escName + "\"/></Name>\n";
        xml += "        <DeviceChain>\n";
        xml += "          <MainSequencer>\n";
        xml += "            <ClipSlotList>\n";
        xml += "              <ClipSlot Id=\"0\">\n";
        xml += "                <ClipSlot>\n";
        xml += "                  <Value>\n";
        xml += "                    <AudioClip Id=\"" + std::to_string(trackId) + "0\" Time=\"0\">\n";
        xml += "                      <SampleRef>\n";
        xml += "                        <FileRef>\n";
        xml += "                          <RelativePath Value=\"" + escName + "\"/>\n";
        xml += "                          <Name Value=\"" + escName + "\"/>\n";
        xml += "                        </FileRef>\n";
        xml += "                        <SampleUsageHint Value=\"0\"/>\n";
        xml += "                        <DefaultDuration Value=\"" + std::to_string(sampleRate) + "\"/>\n";
        xml += "                        <DefaultSampleRate Value=\"" + std::to_string(sampleRate) + "\"/>\n";
        xml += "                      </SampleRef>\n";
        xml += "                      <Name Value=\"" + escName + "\"/>\n";
        xml += "                    </AudioClip>\n";
        xml += "                  </Value>\n";
        xml += "                </ClipSlot>\n";
        xml += "              </ClipSlot>\n";
        xml += "            </ClipSlotList>\n";
        xml += "          </MainSequencer>\n";
        xml += "        </DeviceChain>\n";
        xml += "      </AudioTrack>\n";
        trackId++;
    }
    xml += "    </Tracks>\n";
    xml += "  </LiveSet>\n";
    xml += "</Ableton>\n";
    return xml;
}

}

namespace {

void appendVarInt(std::vector<uint8_t>& buf, uint32_t v) {
    uint8_t stack[5];
    int n = 0;
    do {
        stack[n++] = (uint8_t)(v & 0x7F);
        v >>= 7;
    } while (v != 0);
    for (int i = n - 1; i >= 0; i--) {
        uint8_t b = stack[i];
        if (i > 0) b |= 0x80;
        buf.push_back(b);
    }
}

void appendByteEvent(std::vector<uint8_t>& buf, uint8_t id, uint8_t v) {
    buf.push_back(id);
    buf.push_back(v);
}
void appendWordEvent(std::vector<uint8_t>& buf, uint8_t id, uint16_t v) {
    buf.push_back(id);
    buf.push_back((uint8_t)(v & 0xFF));
    buf.push_back((uint8_t)((v >> 8) & 0xFF));
}
void appendDwordEvent(std::vector<uint8_t>& buf, uint8_t id, uint32_t v) {
    buf.push_back(id);
    for (int i = 0; i < 4; i++) buf.push_back((uint8_t)((v >> (8 * i)) & 0xFF));
}
void appendAsciiTextEvent(std::vector<uint8_t>& buf, uint8_t id, const std::string& s) {
    std::string withNul = s + '\0';
    buf.push_back(id);
    appendVarInt(buf, (uint32_t)withNul.size());
    for (char c : withNul) buf.push_back((uint8_t)c);
}
void appendUnicodeTextEvent(std::vector<uint8_t>& buf, uint8_t id, const std::string& asciiSrc) {
    std::vector<uint8_t> utf16;
    for (char c : asciiSrc) { utf16.push_back((uint8_t)c); utf16.push_back(0); }
    utf16.push_back(0); utf16.push_back(0);
    buf.push_back(id);
    appendVarInt(buf, (uint32_t)utf16.size());
    for (uint8_t b : utf16) buf.push_back(b);
}

constexpr uint8_t kFlpByte = 0;
constexpr uint8_t kFlpWord = 64;
constexpr uint8_t kFlpDword = 128;
constexpr uint8_t kFlpText = 192;

constexpr uint8_t kChannelIsEnabled = kFlpByte + 0;
constexpr uint8_t kChannelType = kFlpByte + 21;
constexpr uint8_t kChannelNew = kFlpWord + 0;
constexpr uint8_t kChannelName = kFlpText;
constexpr uint8_t kChannelSamplePath = kFlpText + 4;
constexpr uint8_t kProjectLoopActive = kFlpByte + 9;
constexpr uint8_t kProjectTitle = kFlpText + 2;
constexpr uint8_t kProjectFLVersion = kFlpText + 7;
constexpr uint8_t kChannelTypeSampler = 0;

bool writeFlpFile(const std::string& path, const std::vector<std::string>& clipFilenames, int ppq) {
    std::vector<uint8_t> events;

    appendUnicodeTextEvent(events, kProjectTitle, "aloop clip export");
    appendAsciiTextEvent(events, kProjectFLVersion, "20.9.2.2963");
    appendByteEvent(events, kProjectLoopActive, 1);

    for (size_t i = 0; i < clipFilenames.size(); i++) {
        appendWordEvent(events, kChannelNew, (uint16_t)i);
        appendByteEvent(events, kChannelType, kChannelTypeSampler);
        appendByteEvent(events, kChannelIsEnabled, 1);
        appendUnicodeTextEvent(events, kChannelName, clipFilenames[i]);
        appendUnicodeTextEvent(events, kChannelSamplePath, clipFilenames[i]);
    }

    std::vector<uint8_t> file;
    file.push_back('F'); file.push_back('L'); file.push_back('h'); file.push_back('d');
    file.push_back(6); file.push_back(0); file.push_back(0); file.push_back(0);
    uint16_t format = 0;
    file.push_back((uint8_t)(format & 0xFF)); file.push_back((uint8_t)((format >> 8) & 0xFF));
    uint16_t nChannels = (uint16_t)clipFilenames.size();
    file.push_back((uint8_t)(nChannels & 0xFF)); file.push_back((uint8_t)((nChannels >> 8) & 0xFF));
    uint16_t ppqU16 = (uint16_t)ppq;
    file.push_back((uint8_t)(ppqU16 & 0xFF)); file.push_back((uint8_t)((ppqU16 >> 8) & 0xFF));

    file.push_back('F'); file.push_back('L'); file.push_back('d'); file.push_back('t');
    uint32_t eventsSize = (uint32_t)events.size();
    for (int i = 0; i < 4; i++) file.push_back((uint8_t)((eventsSize >> (8 * i)) & 0xFF));
    file.insert(file.end(), events.begin(), events.end());

    int fd = open(path.c_str(), O_CREAT | O_WRONLY | O_TRUNC, 0644);
    if (fd < 0) return false;
    ssize_t wrote = write(fd, file.data(), file.size());
    close(fd);
    return wrote == (ssize_t)file.size();
}

}

void ClipExporter::writeDawProjectFiles(const std::vector<std::string>& clipFilenames) {
    std::string alsPath = m_saveDir + "/aloop-clips.als";
    std::string alsXml = buildAbletonAls(clipFilenames, m_sampleRate);
    if (!gzipWriteFile(alsPath, alsXml)) {
        fprintf(stderr, "[clip-export] failed to write %s\n", alsPath.c_str());
    }

    std::string flpPath = m_saveDir + "/aloop-clips.flp";
    if (!writeFlpFile(flpPath, clipFilenames, 96)) {
        fprintf(stderr, "[clip-export] failed to write %s\n", flpPath.c_str());
    }
}

}
