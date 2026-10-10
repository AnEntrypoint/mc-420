#include "apc_grid.h"
#include "../dsp/sampler/sampler.h"
#include "../dsp/audio_thread.h"
#include "../host/lv2_host.h"
#include "../link/link_bridge.h"
#include <cstdio>
#include <cstring>
#include <cmath>
#include <array>

namespace aloop {

void ApcGrid::bindAll(ParamStore& ps) {
    char name[32];
    for (int looper = 0; looper < kLooperCount; looper++) {
        for (const char* field : {"rec", "play", "erase", "finishreq"}) {
            snprintf(name, sizeof name, "looper%d/%s", looper, field);
            ps.bind(name);
        }
        snprintf(name, sizeof name, "looper%d/finishtarget", looper);
        ps.bind(name, 0.0f);
        snprintf(name, sizeof name, "looper%d/latencybias", looper);
        ps.bind(name, 0.0f);
        snprintf(name, sizeof name, "looper%d/sidechainsrc", looper);
        ps.bind(name, 0.0f);
        snprintf(name, sizeof name, "looper%d/hascontent", looper);
        ps.bind(name, 0.0f);
    }
    ps.bind("fx/pitchbend");
    ps.bind("fx/pitchbend_engaged");
    ps.bind("fx/keys/multimode", 0.0f);
    char xposeName[24];
    for (int v = 0; v < kTransposeVoices; v++) {
        snprintf(xposeName, sizeof xposeName, "fx/xpose%d/note", v);
        ps.bind(xposeName, 0.0f);
        snprintf(xposeName, sizeof xposeName, "fx/xpose%d/gate", v);
        ps.bind(xposeName, 0.0f);
    }
    char resonodeVoiceName[28];
    for (int v = 0; v < kResonodeVoices; v++) {
        snprintf(resonodeVoiceName, sizeof resonodeVoiceName, "fx/resonodevoice%d/note", v);
        ps.bind(resonodeVoiceName, 0.0f);
        snprintf(resonodeVoiceName, sizeof resonodeVoiceName, "fx/resonodevoice%d/gate", v);
        ps.bind(resonodeVoiceName, 0.0f);
        snprintf(resonodeVoiceName, sizeof resonodeVoiceName, "fx/resonodevoice%d/vel", v);
        ps.bind(resonodeVoiceName, 1.0f);
    }
    ps.bind("fx/resonode/engaged", 0.0f);
    ps.bind("fx/resonode/position", 0.35f);
    ps.bind("fx/resonode/tone", 6000.0f);
    ps.bind("fx/resonode/decay", 1.2f);
    ps.bind("fx/resonode/damping", 0.85f);
    ps.bind("fx/resonode/stretch", 0.0f);
    ps.bind("fx/resonode/collision", 0.0f);
    ps.bind("fx/resonode/level", 25.0f);
    ps.bind("fx/resonode/couple", 0.15f);
    ps.bind("fx/resonode/shape/string", 1.0f);
    ps.bind("fx/resonode/shape/bell", 0.0f);
    ps.bind("fx/resonode/shape/plate", 0.0f);
    ps.bind("fx/resonode/shape/membrane", 0.0f);
    ps.bind("fx/resonode/shape/bar", 0.0f);
    ps.bind("fx/microrepeat_div");
    ps.bind("fx/monitorfold");
    ps.bind("fx/formant");
    ps.bind("fx/shuffle/mode", 0.0f);
    ps.bind("fx/gate/mode", 0.0f);
    ps.bind("cmd/master_len", 0.0f);
    ps.bind("cmd/recorded_bpm", 0.0f);
    ps.bind("cmd/recorded_beats", 0.0f);
    ps.bind("cmd/clearall", 0.0f);
    ps.bind("cmd/halfspeed", 0.0f);
    ps.bind("cmd/doublespeed", 0.0f);
    ps.bind("cmd/sustain", 0.0f);

    ps.bind("fx/reverb",  0.0f);
    ps.bind("fx/delay",   0.0f);
    ps.bind("fx/time",    0.5f);
    ps.bind("fx/hp",      0.0f);
    ps.bind("fx/lpres",   0.0f);
    ps.bind("fx/lp",      1.0f);
    ps.bind("fx/pitch",   0.0f);

    ps.bind("fx/dubgate/amt",     0.0f);
    ps.bind("fx/dubgate/pattern", 0.0f);
    ps.bind("fx/dublfo/rate",     0.3f);
    ps.bind("fx/dublfo/depth",    0.0f);
    ps.bind("fx/dublfo/shape",    0.0f);
    ps.bind("fx/dublfo/target",   0.0f);
    ps.bind("fx/dublfo/phase",    0.0f);
}

static void setLooper(ParamStore& ps, int looper, const char* field, float v) {
    char name[32];
    snprintf(name, sizeof name, "looper%d/%s", looper, field);
    ps.setByName(name, v);
}

struct TempoSolveResult {
    double bpm;
    double beats;
};
static TempoSolveResult deriveTempoQuant(double seconds, double anchorBpm = 120.0) {
    const double anchor = (anchorBpm > 1.0) ? anchorBpm : 120.0;
    if (seconds <= 0.0) return {120.0, 16.0};
    static const double kCandidates[] = {1.0, 2.0, 4.0, 8.0, 16.0, 32.0, 64.0, 128.0};
    TempoSolveResult best = {120.0, 16.0};
    double bestScore = 1e18;
    bool bestInWindow = false;
    for (double beats : kCandidates) {
        double bpm = 60.0 * beats / seconds;
        bool inWindow = (bpm >= anchor * 0.5 && bpm <= anchor * 2.0);
        double score = std::fabs(std::log2(bpm / anchor));
        bool better = (inWindow && !bestInWindow)
                   || (inWindow == bestInWindow && score < bestScore);
        if (better) {
            best = {bpm, beats};
            bestScore = score;
            bestInWindow = inWindow;
        }
    }
    return best;
}
static double pickAnchorGridBeats(double takeLenBeats) {
    const double eps = 0.01;
    if (takeLenBeats > 16.0 + eps) return 16.0;
    if (takeLenBeats > 8.0 + eps) return 8.0;
    if (takeLenBeats > 4.0 + eps) return 4.0;
    if (takeLenBeats > 2.0 + eps) return 2.0;
    if (takeLenBeats > 1.0 + eps) return 1.0;
    if (takeLenBeats > 0.5 + eps) return 0.5;
    if (takeLenBeats > 0.25 + eps) return 0.25;
    return 0.125;
}

long resampleLatencySamples(AudioThread* audio) {
    long block = kBlockSize;
    if (audio) {
        const long configured = audio->blockSizeSamples();
        if (configured > 0) block = configured;
    }
    return 2 * block;
}

int readRuntimeLatencyTrim() {
    FILE* f = fopen("/run/aloop/latency_trim", "rb");
    if (!f) return 0;
    int v = 0;
    if (fscanf(f, "%d", &v) != 1) v = 0;
    fclose(f);
    return v;
}

long measuredLatencyBias(AudioThread* audio) {
    long bias = 0;
    if (audio) bias = (long)(audio->snapshotTelemetry().latencyBiasSamples + 0.5f);
    return bias > 0 ? bias : kBlockSize;
}

void ApcGrid::updateLocalTransport(LinkBridge* link) {
    if (!link || m_localTransportRunning) return;
    m_localTransportRunning = true;
    link->setLocalTransportPlaying(true);
}

int ApcGrid::monitorFoldSlot(ParamStore& ps) {
    if (m_monitorFoldSlot < 0) m_monitorFoldSlot = ps.getSlot("fx/monitorfold");
    return m_monitorFoldSlot;
}

void ApcGrid::armResampleFoldWindow(int looper, AudioThread* audio) {
    m_looperFoldFraction[looper] = 0.0f;
    m_looperChainLatency[looper] = 0.0;
    if (!audio) return;
    const AudioThread::Telemetry t = audio->snapshotTelemetry();
    m_looperFoldSumStart[looper] = t.resampleFoldSum;
    m_looperFoldSamplesStart[looper] = t.resampleFoldSamples;
    m_looperChainSumStart[looper] = t.resampleChainSum;
    m_looperChainSamplesStart[looper] = t.resampleChainSamples;
}

float ApcGrid::takeResampleFoldFraction(int looper, AudioThread* audio) const {
    const bool shift = m_looperShiftHeldDuringTake[looper];
    if (!audio || m_looperFoldSamplesStart[looper] == 0) return shift ? 1.0f : 0.0f;
    const AudioThread::Telemetry t = audio->snapshotTelemetry();
    const long long samples = (long long)t.resampleFoldSamples
                            - (long long)m_looperFoldSamplesStart[looper];
    if (samples <= 0) return shift ? 1.0f : 0.0f;
    double f = (t.resampleFoldSum - m_looperFoldSumStart[looper]) / (double)samples;
    if (f < 0.0) f = 0.0;
    if (f > 1.0) f = 1.0;
    return (float)f;
}

double ApcGrid::takeResampleChainLatency(int looper, AudioThread* audio) const {
    if (!audio || m_looperChainSamplesStart[looper] == 0) return 0.0;
    const AudioThread::Telemetry t = audio->snapshotTelemetry();
    const long long samples = (long long)t.resampleChainSamples
                            - (long long)m_looperChainSamplesStart[looper];
    if (samples <= 0) return 0.0;
    double l = (t.resampleChainSum - m_looperChainSumStart[looper]) / (double)samples;
    if (l < 0.0) l = 0.0;
    return l;
}

long ApcGrid::takeLatencyBias(int looper, AudioThread* audio) const {
    const double dry = (double)measuredLatencyBias(audio);
    const double fold = (double)resampleLatencySamples(audio) + m_looperChainLatency[looper];
    const double f = (double)m_looperFoldFraction[looper];
    return (long)(dry * (1.0 - f) + fold * f + 0.5);
}

void ApcGrid::applyRecPlayCycle(int looper, unsigned now_ms, ParamStore& ps, LinkBridge* link, AudioThread* audio) {
    if (m_looperRecording[looper]) {
        if (m_looperFinishTargetPending[looper] > 0.0f) return;
        m_looperHasContent[looper] = true;
        m_looperWrapLenStaleAfterWipe[looper] = false;
        m_looperPlaying[looper] = true;
        setLooper(ps, looper, "play", 1.0f);
        m_looperFoldFraction[looper] = takeResampleFoldFraction(looper, audio);
        m_looperChainLatency[looper] = takeResampleChainLatency(looper, audio);
        const long latencyBias = takeLatencyBias(looper, audio);
        if (m_looperFoldFraction[looper] > 0.01f) {
            fprintf(stderr, "[diag-latency] looper=%d resampleFold=%.3f dryBias=%ld foldBias=%ld chain=%.1f bias=%ld\n",
                    looper, (double)m_looperFoldFraction[looper],
                    measuredLatencyBias(audio), resampleLatencySamples(audio),
                    m_looperChainLatency[looper], latencyBias);
        }
        setLooper(ps, looper, "latencybias", (float)latencyBias);
        m_masterLenSamples = (long)ps.get("cmd/master_len", 0.0f);
        if (m_masterLenSamples == 0) {
            if (m_looperShiftHeldDuringTake[looper]) {
                for (int src = 0; src < kLooperCount; src++) {
                    if (src == looper) continue;
                    if (m_looperHasContent[src] && m_looperPlaying[src]) {
                        m_looperPlaying[src] = false;
                        setLooper(ps, src, "play", 0.0f);
                    }
                }
            }
            long lenSamples;
            if (audio) {
                auto t = audio->snapshotTelemetry();
                lenSamples = (long)t.looperWriteIdx[looper];
            } else {
                unsigned elapsedMs = now_ms - m_recordStartMs[looper];
                lenSamples = (long)elapsedMs * kSampleRate / 1000;
            }
            if (lenSamples < 64) lenSamples = 64;
            if (lenSamples > kMaxLoopSamples) lenSamples = kMaxLoopSamples;
            m_masterLenSamples = lenSamples;
            double recordedSeconds = (double)m_masterLenSamples / (double)kSampleRate;
            TempoSolveResult solved = deriveTempoQuant(recordedSeconds, 120.0);
            ps.setByName("cmd/recorded_bpm", (float)solved.bpm);
            ps.setByName("cmd/recorded_beats", (float)solved.beats);
            ps.setByName("cmd/master_len", (float)m_masterLenSamples);
            if (link) link->imposeTempo(solved.bpm);
            setLooper(ps, looper, "finishtarget", (float)m_masterLenSamples);
            setLooper(ps, looper, "finishreq", 1.0f);
            setLooper(ps, looper, "rec", 0.0f);
            m_looperFinishReqReleaseAt[looper] = now_ms + 50;
            m_looperFinishTargetPending[looper] = (float)m_masterLenSamples;
            m_looperFinishPendingSinceMs[looper] = now_ms;
            m_looperPauseOthersOnFinish[looper] = false;
        } else {
            long rawSamples;
            if (audio) {
                auto t = audio->snapshotTelemetry();
                rawSamples = (long)t.looperWriteIdx[looper];
            } else {
                unsigned elapsedMs = now_ms - m_recordStartMs[looper];
                rawSamples = (long)elapsedMs * kSampleRate / 1000;
            }
            if (rawSamples <= 0) {
                setLooper(ps, looper, "rec", 0.0f);
                setLooper(ps, looper, "finishreq", 1.0f);
                m_looperFinishReqReleaseAt[looper] = now_ms + 50;
                m_looperRecording[looper] = false;
                m_looperHasContent[looper] = false;
                m_looperPlaying[looper] = false;
                setLooper(ps, looper, "play", 0.0f);
                return;
            }
            double tempoScale = 1.0;
            if (link && link->audioRead().synced) {
                float recordedBpm = ps.get("cmd/recorded_bpm", 0.0f);
                double curBpm = link->audioRead().bpm;
                if (recordedBpm > 1.0f && curBpm > 1.0) {
                    tempoScale = (double)recordedBpm / curBpm;
                }
            }
            double effectiveSamples = (double)rawSamples / tempoScale;
            double beatsPerMasterLen = std::max(1.0f, ps.get("cmd/recorded_beats", 0.0f));
            double oneBeatSamples = std::max(1.0, (double)m_masterLenSamples / beatsPerMasterLen);
            double takeLenBeats = effectiveSamples / oneBeatSamples;
            double anchorGridBeats = pickAnchorGridBeats(takeLenBeats);
            double phraseBeats = std::max(1.0, beatsPerMasterLen);
            if (anchorGridBeats > phraseBeats) anchorGridBeats = phraseBeats;
            double pastMultiple = std::floor(takeLenBeats / anchorGridBeats + 0.0001);
            double pastNodeBeats = pastMultiple * anchorGridBeats;
            double futureNodeBeats = pastNodeBeats + anchorGridBeats;
            double overshootBeats = takeLenBeats - pastNodeBeats;
            double cutToleranceBeats = anchorGridBeats * 0.5;
            double finalBeats = (pastMultiple >= 1.0 && overshootBeats <= cutToleranceBeats + 0.0001)
                ? pastNodeBeats
                : futureNodeBeats;
            double beatLenSamplesNow = oneBeatSamples * tempoScale;
            long quantized = (long)(finalBeats * beatLenSamplesNow + 0.5);
            if (quantized < 64) quantized = 64;
            if (quantized > kMaxLoopSamples) quantized = kMaxLoopSamples;
            setLooper(ps, looper, "finishtarget", (float)quantized);
            setLooper(ps, looper, "finishreq", 1.0f);
            setLooper(ps, looper, "rec", 0.0f);
            m_looperFinishReqReleaseAt[looper] = now_ms + 50;
            m_looperFinishTargetPending[looper] = (float)quantized;
            m_looperFinishPendingSinceMs[looper] = now_ms;
            m_looperPauseOthersOnFinish[looper] = m_looperShiftHeldDuringTake[looper];
        }
    } else if (!m_looperHasContent[looper]) {
        setLooper(ps, looper, "rec", 1.0f);
        m_looperRecording[looper] = true;
        m_recordStartMs[looper] = now_ms;
        m_looperShiftHeldDuringTake[looper] = ps.getBySlot(monitorFoldSlot(ps), 0.0f) > 0.5f;
        armResampleFoldWindow(looper, audio);
    } else if (m_looperPlaying[looper]) {
        setLooper(ps, looper, "play", 0.0f);
        m_looperPlaying[looper] = false;
    } else {
        setLooper(ps, looper, "play", 1.0f);
        m_looperPlaying[looper] = true;
    }
    updateLocalTransport(link);
}

void ApcGrid::forgetLooperFromPresets(int looper) {
    uint32_t bit = (1u << looper);
    for (int p = 0; p < kPresetCount; p++) {
        if (!m_presetUsed[p]) continue;
        if (!(m_presetMask[p] & bit)) continue;
        m_presetMask[p] &= ~bit;
        if (m_presetMask[p] == 0) m_presetUsed[p] = false;
    }
}

void ApcGrid::onPadPress(int note, unsigned now_ms, ParamStore& ps, LinkBridge* link, AudioThread* audio) {
    int row = note / kApcCols, col = note % kApcCols;

    int looper = gridLooperIndex(row, col);
    if (looper >= 0) {
        if (m_guitarFxHeld) {
            onSidechainLooperToggle(looper, ps);
            return;
        }
        bool alreadyHeld = m_looperHeld[looper];
        m_looperHeld[looper] = true;
        if (alreadyHeld) {
            return;
        }
        m_looperErased[looper] = false;
        m_looperHoldStart[looper] = now_ms;
        if (!m_looperHasContent[looper] || m_looperRecording[looper]) {
            applyRecPlayCycle(looper, now_ms, ps, link, audio);
            m_looperArmedOnPress[looper] = true;
        } else {
            m_looperArmedOnPress[looper] = false;
        }
        return;
    }
    int preset = gridPresetIndex(row, col);
    if (preset >= 0) {
        m_presetHeld[preset] = true;
        m_presetCaptured[preset] = false;
        m_presetHoldStart[preset] = now_ms;
        return;
    }
}

void ApcGrid::onPadRelease(int note, unsigned now_ms, ParamStore& ps, LinkBridge* link, AudioThread* audio) {
    int row = note / kApcCols, col = note % kApcCols;

    int looper = gridLooperIndex(row, col);
    if (looper >= 0) {
        if (m_looperArmedOnPress[looper]) {
            m_looperArmedOnPress[looper] = false;
            m_looperHeld[looper] = false;
            return;
        }
        if (m_looperHeld[looper] && !m_looperErased[looper]) {
            applyRecPlayCycle(looper, now_ms, ps, link, audio);
        }
        m_looperHeld[looper] = false;
        return;
    }
    int preset = gridPresetIndex(row, col);
    if (preset >= 0) {
        if (m_presetHeld[preset] && !m_presetCaptured[preset]) {
            if (m_presetUsed[preset]) applyPreset(preset, ps);
        }
        m_presetHeld[preset] = false;
        return;
    }
}

void ApcGrid::pollHolds(unsigned now_ms, ParamStore& ps, LinkBridge* link, AudioThread* audio) {
    if (m_bankFlashReleaseAt != 0 && now_ms >= m_bankFlashReleaseAt) {
        m_bankFlashReleaseAt = 0;
    }
    for (int looper = 0; looper < kLooperCount; looper++) {
        char name[32];
        snprintf(name, sizeof name, "looper%d/hascontent", looper);
        ps.setByName(name, m_looperHasContent[looper] ? 1.0f : 0.0f);
    }
    AudioThread::setLatencyTrim(readRuntimeLatencyTrim());
    {
        const long bias = measuredLatencyBias(audio);
        if (bias != m_latencyBiasWritten) {
            m_latencyBiasWritten = bias;
            for (int looper = 0; looper < kLooperCount; looper++) {
                if (!m_looperHasContent[looper] || m_looperRecording[looper]) continue;
                setLooper(ps, looper, "latencybias", (float)takeLatencyBias(looper, audio));
            }
        }
    }
    {
        auto t = audio ? audio->snapshotTelemetry() : AudioThread::Telemetry{};
        for (int looper = 0; looper < kLooperCount; looper++) {
            if (m_looperFinishTargetPending[looper] <= 0.0f) continue;
            bool reached = audio
                ? (double)t.looperWriteIdx[looper] >= (double)m_looperFinishTargetPending[looper]
                : true;
            if (!reached && now_ms - m_looperFinishPendingSinceMs[looper] > 500) {
                static unsigned lastStuckLogMs[kLooperCount] = {};
                if (now_ms - lastStuckLogMs[looper] > 500) {
                    int sf = (int)t.looperStateFlags[looper];
                    fprintf(stderr, "[diag-finish-stuck] looper=%d writeIdx=%.1f target=%.1f pendingMs=%u pend=%d fin=%d act=%d gate=%d\n",
                            looper, (double)t.looperWriteIdx[looper], (double)m_looperFinishTargetPending[looper],
                            now_ms - m_looperFinishPendingSinceMs[looper],
                            sf & 1, (sf >> 1) & 1, (sf >> 2) & 1, (sf >> 3) & 1);
                    lastStuckLogMs[looper] = now_ms;
                }
            }
            if (reached) {
                m_looperRecording[looper] = false;
                m_looperFinishTargetPending[looper] = 0.0f;
                if (m_looperPauseOthersOnFinish[looper]) {
                    m_looperPauseOthersOnFinish[looper] = false;
                    for (int src = 0; src < kLooperCount; src++) {
                        if (src == looper) continue;
                        if (m_looperHasContent[src] && m_looperPlaying[src]) {
                            m_looperPlaying[src] = false;
                            setLooper(ps, src, "play", 0.0f);
                        }
                    }
                }
            }
        }
    }
    bool shiftHeldNow = ps.getBySlot(monitorFoldSlot(ps), 0.0f) > 0.5f;
    if (shiftHeldNow) {
        for (int looper = 0; looper < kLooperCount; looper++) {
            if (m_looperRecording[looper]) m_looperShiftHeldDuringTake[looper] = true;
        }
    }
    for (int looper = 0; looper < kLooperCount; looper++) {
        if (m_looperEraseReleaseAt[looper] != 0 && now_ms >= m_looperEraseReleaseAt[looper]) {
            setLooper(ps, looper, "erase", 0.0f);
            m_looperEraseReleaseAt[looper] = 0;
        }
    }
    for (int looper = 0; looper < kLooperCount; looper++) {
        if (m_looperFinishReqReleaseAt[looper] != 0 && now_ms >= m_looperFinishReqReleaseAt[looper]) {
            setLooper(ps, looper, "finishreq", 0.0f);
            m_looperFinishReqReleaseAt[looper] = 0;
        }
    }
    for (int looper = 0; looper < kLooperCount; looper++) {
        if (!m_looperHeld[looper] || m_looperErased[looper]) continue;
        if (now_ms - m_looperHoldStart[looper] < kHoldEraseMs) continue;
        setLooper(ps, looper, "erase", 1.0f);
        m_looperEraseReleaseAt[looper] = now_ms + 50;
        if (m_looperRecording[looper]) {
            float widxNow = audio ? audio->snapshotTelemetry().looperWriteIdx[looper] : 0.0f;
            setLooper(ps, looper, "rec", 0.0f);
            setLooper(ps, looper, "finishtarget", widxNow);
            setLooper(ps, looper, "finishreq", 1.0f);
            m_looperFinishReqReleaseAt[looper] = now_ms + 50;
            m_looperRecording[looper] = false;
        }
        m_looperFinishTargetPending[looper] = 0.0f;
        m_looperPauseOthersOnFinish[looper] = false;
        m_looperErased[looper] = true;
        m_looperArmedOnPress[looper] = false;
        m_looperHasContent[looper] = false;
        m_looperWrapLenStaleAfterWipe[looper] = true;
        m_looperPlaying[looper] = false;
        setLooper(ps, looper, "play", 0.0f);
        forgetLooperFromPresets(looper);
        m_looperIsSidechainSource[looper] = false;
        setLooper(ps, looper, "sidechainsrc", 0.0f);
    }
    bool anyHasContent = false;
    for (int lp = 0; lp < kLooperCount; lp++) if (m_looperHasContent[lp]) { anyHasContent = true; break; }
    if (!anyHasContent && audio) {
        auto realT = audio->snapshotTelemetry();
        for (int lp = 0; lp < kLooperCount; lp++) {
            if (!m_looperWrapLenStaleAfterWipe[lp] && realT.looperWrapLen[lp] > 1.0f) {
                m_looperHasContent[lp] = true;
                anyHasContent = true;
            }
        }
    }
    if (!anyHasContent && m_masterLenSamples != 0) {
        m_masterLenSamples = 0;
        ps.setByName("cmd/master_len", 0.0f);
        ps.setByName("cmd/recorded_bpm", 0.0f);
        ps.setByName("cmd/recorded_beats", 0.0f);
        if (link) link->resetTempoAuthority();
    }
    for (int p = 0; p < kPresetCount; p++) {
        if (!m_presetHeld[p] || m_presetCaptured[p]) continue;
        if (now_ms - m_presetHoldStart[p] < kHoldEraseMs) continue;
        capturePreset(p, ps);
        m_presetCaptured[p] = true;
    }
}

void ApcGrid::capturePreset(int p, ParamStore&) {
    if (p < 0 || p >= kPresetCount) return;
    uint32_t mask = 0;
    for (int n = 0; n < kLooperCount; n++)
        if (m_looperHasContent[n] && m_looperPlaying[n]) mask |= (1u << n);
    m_presetMask[p] = mask;
    m_presetUsed[p] = true;
}

void ApcGrid::applyPreset(int p, ParamStore& ps) {
    if (p < 0 || p >= kPresetCount || !m_presetUsed[p]) return;
    uint32_t mask = m_presetMask[p];
    for (int n = 0; n < kLooperCount; n++) {
        if (!m_looperHasContent[n]) continue;
        bool shouldPlay = (mask & (1u << n)) != 0;
        if (shouldPlay != m_looperPlaying[n]) {
            setLooper(ps, n, "play", shouldPlay ? 1.0f : 0.0f);
            m_looperPlaying[n] = shouldPlay;
        }
    }
}

void ApcGrid::onModWheel(uint8_t data2, ParamStore& ps) {
    if (m_keysMode == KeysMode::MultiKey) return;
    bool inDeadzone = (data2 >= 59 && data2 <= 69);
    if (!m_liveEngaged) { ps.setByName("fx/pitchbend_engaged", 0.0f); ps.setByName("fx/pitchbend", 0.0f); return; }
    if (inDeadzone) {
        ps.setByName("fx/pitchbend_engaged", 0.0f);
        ps.setByName("fx/pitchbend", 0.0f);
    } else {
        float semis = ((float)((int)data2 - 64)) * 12.0f / 63.0f;
        ps.setByName("fx/pitchbend", semis);
        ps.setByName("fx/pitchbend_engaged", 1.0f);
    }
}
void ApcGrid::onAbsolutePitch(uint8_t data2, ParamStore& ps) {
    if (m_keysMode == KeysMode::MultiKey) return;
    if (!m_liveEngaged) { ps.setByName("fx/pitchbend_engaged", 0.0f); ps.setByName("fx/pitchbend", 0.0f); return; }
    float semis = (data2 / 127.0f) * 24.0f - 12.0f;
    ps.setByName("fx/pitchbend", semis);
    ps.setByName("fx/pitchbend_engaged", 1.0f);
}
void ApcGrid::onLiveEngageToggle(ParamStore& ps) {
    if (m_shift) {
        m_keysMode = (m_keysMode == KeysMode::MultiKey) ? KeysMode::Normal : KeysMode::MultiKey;
        ps.setByName("fx/keys/multimode", m_keysMode == KeysMode::MultiKey ? 1.0f : 0.0f);
        if (m_liveEngaged) {
            m_liveEngaged = false;
            ps.setByName("fx/pitchbend", 0.0f);
            ps.setByName("fx/pitchbend_engaged", 0.0f);
        }
        return;
    }
    if (m_keysMode == KeysMode::MultiKey) {
        m_keysMode = KeysMode::Normal;
        ps.setByName("fx/keys/multimode", 0.0f);
    }
    m_liveEngaged = !m_liveEngaged;
    if (!m_liveEngaged) {
        ps.setByName("fx/pitchbend", 0.0f);
        ps.setByName("fx/pitchbend_engaged", 0.0f);
        for (int v = 0; v < kTransposeVoices; v++) {
            if (m_transposeVoiceNote[v] < 0) continue;
            m_transposeVoiceNote[v] = -1;
            char gateName[24];
            snprintf(gateName, sizeof gateName, "fx/xpose%d/gate", v);
            ps.setByName(gateName, 0.0f);
        }
    }
}
void ApcGrid::onStopImmediate(unsigned now_ms, ParamStore& ps, LinkBridge* link, AudioThread* audio) {
    for (int lp = 0; lp < kLooperCount; lp++) {
        if (m_looperRecording[lp]) {
            float widxNow = audio ? audio->snapshotTelemetry().looperWriteIdx[lp] : 0.0f;
            setLooper(ps, lp, "rec", 0.0f);
            setLooper(ps, lp, "finishtarget", widxNow);
            setLooper(ps, lp, "finishreq", 1.0f);
            m_looperFinishReqReleaseAt[lp] = now_ms + 50;
            m_looperRecording[lp] = false;
        }
        m_looperFinishTargetPending[lp] = 0.0f;
        m_looperPauseOthersOnFinish[lp] = false;
        setLooper(ps, lp, "play", 0.0f);
        m_looperPlaying[lp] = false;
    }
    updateLocalTransport(link);
}
void ApcGrid::onClearAll(unsigned now_ms, bool held, ParamStore& ps, LinkBridge* link, AudioThread* audio) {
    ps.setByName("cmd/clearall", held ? 1.0f : 0.0f);
    if (!held) return;
    for (int lp = 0; lp < kLooperCount; lp++) {
        bool wasRecording = m_looperRecording[lp];
        m_looperHeld[lp] = false;
        m_looperErased[lp] = false;
        m_looperArmedOnPress[lp] = false;
        m_looperPlaying[lp] = false;
        m_looperHasContent[lp] = false;
        m_looperWrapLenStaleAfterWipe[lp] = true;
        m_looperRecording[lp] = false;
        m_recordStartMs[lp] = 0;
        m_looperIsSidechainSource[lp] = false;
        setLooper(ps, lp, "sidechainsrc", 0.0f);
        setLooper(ps, lp, "play", 0.0f);
        setLooper(ps, lp, "rec", 0.0f);
        if (wasRecording) {
            float widxNow = audio ? audio->snapshotTelemetry().looperWriteIdx[lp] : 0.0f;
            setLooper(ps, lp, "finishtarget", widxNow);
            setLooper(ps, lp, "finishreq", 1.0f);
            m_looperFinishReqReleaseAt[lp] = now_ms + 50;
        } else {
            setLooper(ps, lp, "finishreq", 0.0f);
            m_looperFinishReqReleaseAt[lp] = 0;
        }
        m_looperFinishTargetPending[lp] = 0.0f;
        m_looperPauseOthersOnFinish[lp] = false;
    }
    for (int p = 0; p < kPresetCount; p++) {
        m_presetHeld[p] = false;
        m_presetCaptured[p] = false;
        m_presetUsed[p] = false;
        m_presetMask[p] = 0;
    }
    m_masterLenSamples = 0;
    ps.setByName("cmd/master_len", 0.0f);
    ps.setByName("cmd/recorded_bpm", 0.0f);
    ps.setByName("cmd/recorded_beats", 0.0f);
    if (link) link->resetTempoAuthority();
    for (int v = 0; v < kTransposeVoices; v++) {
        if (m_transposeVoiceNote[v] < 0) continue;
        m_transposeVoiceNote[v] = -1;
        char gateName[24];
        snprintf(gateName, sizeof gateName, "fx/xpose%d/gate", v);
        ps.setByName(gateName, 0.0f);
    }
    releaseAllResonodeVoices(ps);
    if (m_resonodeLatched) {
        m_resonodeLatched = false;
        m_resonodeEngaged = false;
        ps.setByName("fx/resonode/engaged", 0.0f);
    }
    updateLocalTransport(link);
}
int ApcGrid::allocateTransposeVoice(int note) {
    for (int v = 0; v < kTransposeVoices; v++)
        if (m_transposeVoiceNote[v] == note) return v;
    for (int v = 0; v < kTransposeVoices; v++) {
        if (m_transposeVoiceNote[v] >= 0) continue;
        m_transposeVoiceNote[v] = note;
        m_transposeVoiceOrder[v] = ++m_transposeVoiceCounter;
        return v;
    }
    int oldest = 0;
    for (int v = 1; v < kTransposeVoices; v++)
        if (m_transposeVoiceOrder[v] < m_transposeVoiceOrder[oldest]) oldest = v;
    m_transposeVoiceNote[oldest] = note;
    m_transposeVoiceOrder[oldest] = ++m_transposeVoiceCounter;
    return oldest;
}
void ApcGrid::releaseTransposeVoice(int note, ParamStore& ps) {
    for (int v = 0; v < kTransposeVoices; v++) {
        if (m_transposeVoiceNote[v] != note) continue;
        m_transposeVoiceNote[v] = -1;
        char gateName[24];
        snprintf(gateName, sizeof gateName, "fx/xpose%d/gate", v);
        ps.setByName(gateName, 0.0f);
        return;
    }
}
int ApcGrid::allocateResonodeVoice(int note) {
    for (int v = 0; v < kResonodeVoices; v++)
        if (m_resonodeVoiceNote[v] == note) return v;
    for (int v = 0; v < kResonodeVoices; v++) {
        if (m_resonodeVoiceNote[v] >= 0) continue;
        m_resonodeVoiceNote[v] = note;
        m_resonodeVoiceOrder[v] = ++m_resonodeVoiceCounter;
        return v;
    }
    int oldest = 0;
    for (int v = 1; v < kResonodeVoices; v++)
        if (m_resonodeVoiceOrder[v] < m_resonodeVoiceOrder[oldest]) oldest = v;
    m_resonodeVoiceNote[oldest] = note;
    m_resonodeVoiceOrder[oldest] = ++m_resonodeVoiceCounter;
    return oldest;
}
void ApcGrid::releaseResonodeVoice(int note, ParamStore& ps) {
    for (int v = 0; v < kResonodeVoices; v++) {
        if (m_resonodeVoiceNote[v] != note) continue;
        m_resonodeVoiceNote[v] = -1;
        char gateName[28];
        snprintf(gateName, sizeof gateName, "fx/resonodevoice%d/gate", v);
        ps.setByName(gateName, 0.0f);
        return;
    }
}
void ApcGrid::releaseAllResonodeVoices(ParamStore& ps) {
    char gateName[28];
    for (int v = 0; v < kResonodeVoices; v++) {
        m_resonodeVoiceNote[v] = -1;
        snprintf(gateName, sizeof gateName, "fx/resonodevoice%d/gate", v);
        ps.setByName(gateName, 0.0f);
    }
}
void ApcGrid::onKeybedNoteOn(int note, int vel, ParamStore& ps, Sampler* sampler) {
    if (m_resonodeEngaged) {
        int v = allocateResonodeVoice(note);
        char noteName[28], gateName[28], velName[28];
        snprintf(noteName, sizeof noteName, "fx/resonodevoice%d/note", v);
        snprintf(gateName, sizeof gateName, "fx/resonodevoice%d/gate", v);
        snprintf(velName, sizeof velName, "fx/resonodevoice%d/vel", v);
        ps.setByName(noteName, (float)note);
        ps.setByName(velName, (float)vel / 127.0f);
        ps.setByName(gateName, 1.0f);
        return;
    }
    if (sampler) {
        int keyIdx = Sampler::keyIndex(note);
        if (m_drumRecordMode) {
            if (keyIdx >= 0) sampler->pushEvent(Sampler::EV_REC_START, keyIdx, 0);
            return;
        }
        if (sampler->chromaticLoaded() || sampler->drumLoaded(keyIdx)) {
            sampler->pushEvent(Sampler::EV_NOTE_ON, note, vel);
            return;
        }
    }
    if (m_keysMode != KeysMode::MultiKey) {
        m_liveEngaged = true;
    }
    int v = allocateTransposeVoice(note);
    char noteName[24], gateName[24];
    snprintf(noteName, sizeof noteName, "fx/xpose%d/note", v);
    snprintf(gateName, sizeof gateName, "fx/xpose%d/gate", v);
    ps.setByName(noteName, (float)note);
    ps.setByName(gateName, 1.0f);
}
void ApcGrid::onKeybedNoteOff(int note, ParamStore& ps, Sampler* sampler) {
    if (m_resonodeEngaged) {
        releaseResonodeVoice(note, ps);
        return;
    }
    if (m_drumRecordMode) {
        if (sampler) {
            int keyIdx = Sampler::keyIndex(note);
            if (keyIdx >= 0) sampler->pushEvent(Sampler::EV_REC_STOP, 0, 0);
        }
        return;
    }
    if (sampler) sampler->pushEvent(Sampler::EV_NOTE_OFF, note, 0);
    releaseTransposeVoice(note, ps);
}
void ApcGrid::onSamplerBtn65Press(Sampler* sampler) {
    if (sampler) sampler->pushEvent(Sampler::EV_REC_START, -1, 0);
}
void ApcGrid::onSamplerBtn65Release(Sampler* sampler) {
    if (sampler) sampler->pushEvent(Sampler::EV_REC_STOP, 0, 0);
}
void ApcGrid::onSamplerBtn66Press() {
    m_drumRecordMode = true;
}
void ApcGrid::onSamplerBtn66Release(Sampler* sampler) {
    m_drumRecordMode = false;
    if (sampler) sampler->pushEvent(Sampler::EV_REC_STOP, 0, 0);
}

void ApcGrid::onMicrorepeatOn(int note, ParamStore& ps) {
    static const uint8_t div[5] = {1, 2, 4, 8, 16};
    if (note < 82 || note > 86) return;
    m_microRepeatDiv = div[note - 82];
    ps.setByName("fx/microrepeat_div", (float)m_microRepeatDiv);
}
void ApcGrid::onMicrorepeatOff(int note, ParamStore& ps) {
    static const uint8_t div[5] = {1, 2, 4, 8, 16};
    if (note < 82 || note > 86) return;
    if (m_microRepeatDiv == div[note - 82]) {
        m_microRepeatDiv = 0;
        ps.setByName("fx/microrepeat_div", 0.0f);
    }
}

void ApcGrid::onSustainPedal(bool down, ParamStore& ps) {
    if (down) {
        if (m_shift) {
            m_sustainLatched = !m_sustainLatched;
        } else {
            m_sustainHeld = true;
        }
    } else {
        m_sustainHeld = false;
    }
    ps.setByName("cmd/sustain", (m_sustainHeld || m_sustainLatched) ? 1.0f : 0.0f);
}

void ApcGrid::onShiftPress(ParamStore& ps) {
    m_shift = true;
    ps.setByName("fx/monitorfold", 1.0f);
}
void ApcGrid::onShiftRelease(ParamStore& ps) {
    m_shift = false;
    ps.setByName("fx/monitorfold", 0.0f);
}

void ApcGrid::applyFormantCC(uint8_t data2, ParamStore& ps) {
    bool anyTransposeVoiceHeld = false;
    for (int v = 0; v < kTransposeVoices; v++) {
        if (m_transposeVoiceNote[v] >= 0) { anyTransposeVoiceHeld = true; break; }
    }
    if (!m_liveEngaged && m_keysMode != KeysMode::MultiKey && !anyTransposeVoiceHeld) return;
    const bool inDeadzone = (data2 >= 60 && data2 <= 68);
    if (inDeadzone) { ps.setByName("fx/formant", 0.0f); return; }
    float v = (((float)(int)data2 - 64.0f) / 63.0f) * 1.5f;
    if (v > 3.0f) v = 3.0f; else if (v < -3.0f) v = -3.0f;
    ps.setByName("fx/formant", v);
}

static const int kFxKnobCcNumbers[kFxKnobCount] = { 48, 49, 50, 51, 54, 55, 57, 53 };

static const FxKnobTarget kDubTargets[kFxKnobCount] = {
    { FxKnobKind::FaustZone, "fx/reverb", 2.0f },
    { FxKnobKind::FaustZone, "fx/delay"  },
    { FxKnobKind::FaustZone, "fx/time"   },
    { FxKnobKind::FaustZone, "fx/hp"     },
    { FxKnobKind::FaustZone, "fx/lpres"  },
    { FxKnobKind::FaustZone, "fx/lp"     },
    { FxKnobKind::FaustZone, "fx/pitch"  },
    { FxKnobKind::Unused, nullptr },
};
static const FxKnobTarget kDubShiftTargets[kFxKnobCount] = {
    { FxKnobKind::FaustZone, "fx/dubgate/amt"     },
    { FxKnobKind::FaustZone, "fx/dubgate/pattern" },
    { FxKnobKind::FaustZone, "fx/dublfo/rate"     },
    { FxKnobKind::FaustZone, "fx/dublfo/depth"    },
    { FxKnobKind::FaustZone, "fx/dublfo/shape"    },
    { FxKnobKind::FaustZone, "fx/dublfo/target"   },
    { FxKnobKind::FaustZone, "fx/dublfo/phase"    },
    { FxKnobKind::Unused, nullptr },
};
static const FxKnobTarget kGuitarTargets[kFxKnobCount] = {
    { FxKnobKind::Lv2Control, "fx2/FLANGEAMT"   },
    { FxKnobKind::Lv2Control, "fx2/TREMOLOAMT"  },
    { FxKnobKind::Lv2Control, "fx2/BANKSPEED"   },
    { FxKnobKind::Lv2Control, "fx2/PHASERAMT"   },
    { FxKnobKind::Lv2Control, "fx2/DISTAMT"     },
    { FxKnobKind::Lv2Control, "fx2/VINYLAMT"    },
    { FxKnobKind::Lv2Control, "fx2/FLUTTERAMT"  },
    { FxKnobKind::Lv2Control, "fx2/GATEAMT"     },
};
static const FxKnobTarget kGuitarShiftTargets[kFxKnobCount] = {
    { FxKnobKind::SamplerFilterAttackMs,  nullptr },
    { FxKnobKind::SamplerFilterDecayMs,   nullptr },
    { FxKnobKind::SamplerFilterSustain,   nullptr },
    { FxKnobKind::SamplerFilterReleaseMs, nullptr },
    { FxKnobKind::SamplerAttackMs,        nullptr },
    { FxKnobKind::SamplerAmpDecayMs,      nullptr },
    { FxKnobKind::SamplerAmpSustain,      nullptr },
    { FxKnobKind::SamplerReleaseMs,       nullptr },
};
static const FxKnobTarget kLofiFxTargets[kFxKnobCount] = {
    { FxKnobKind::Lv2Control,             "fx2/BITCRUSHAMT" },
    { FxKnobKind::SamplerGranPatchWeight, nullptr },
    { FxKnobKind::SamplerGranPatchWeight, nullptr },
    { FxKnobKind::SamplerGranPatchWeight, nullptr },
    { FxKnobKind::SamplerGranPatchWeight, nullptr },
    { FxKnobKind::Unused, nullptr },
    { FxKnobKind::Unused, nullptr },
    { FxKnobKind::Unused, nullptr },
};

struct GranPatch { float grainMs, grainRateHz, pitchSprayCents, posJitterMs, scanRate, reverseProb, envShape; };

constexpr int kGranPatchCount = 4;
static const GranPatch kGranPatches[kGranPatchCount] = {
    {  90.0f,  35.0f, 25.0f,  35.0f, 0.4f, 0.10f, 0.15f },
    { 200.0f,   8.0f,  0.0f,   0.0f, 1.0f, 0.00f, 0.00f },
    {  22.0f,  70.0f,  0.0f,   0.0f, 2.5f, 0.00f, 0.85f },
    {  14.0f, 150.0f, 90.0f, 300.0f, 4.5f, 0.50f, 1.00f },
};

struct GranDirectKnobRange { float lo; float hi; bool logTaper; };
constexpr int kGranDirectKnobCount = 3;
static const GranDirectKnobRange kGranDirectKnobRanges[kGranDirectKnobCount] = {
    { 0.0f, 3.0f, false },
    { 2.0f, 200.0f, true },
    { 0.0f, 1200.0f, false },
};

static_assert(kGranPitchContinuousSprayMode == Sampler::kGrainPitchContinuousSpray,
              "apc_grid's granulator pitch-quantize default must match Sampler's enum");

static constexpr float kGranPitchSprayKnobSpan = 0.5f;

static int granPitchIntervalSetFromKnob(float v01) {
    const int intervalSetCount = Sampler::kGrainPitchQuantizeCount - 1;
    float t = (v01 - kGranPitchSprayKnobSpan) / (1.0f - kGranPitchSprayKnobSpan);
    int idx = (int)(t * (float)intervalSetCount);
    if (idx < 0) idx = 0;
    if (idx >= intervalSetCount) idx = intervalSetCount - 1;
    return Sampler::kGrainPitchOctaves + idx;
}

struct ResonodePatch { float position, decay, damping, stretch, collision;
                       float shapeString, shapeBell, shapePlate, shapeMembrane, shapeBar; };

constexpr int kResonodePatchCount = 4;
static const ResonodePatch kResonodePatches[kResonodePatchCount] = {
    { 0.080f, 0.150f, 0.800f, -0.100f, 0.550f,  0.0f, 0.0f, 0.4f, 0.6f, 0.0f },
    { 0.080f, 7.000f, 0.970f,  1.200f, 0.150f,  0.0f, 0.7f, 0.0f, 0.0f, 0.3f },
    { 0.080f, 7.000f, 0.970f, -0.100f, 0.000f,  1.0f, 0.0f, 0.0f, 0.0f, 0.0f },
    { 0.420f, 7.000f, 0.150f, -0.100f, 0.300f,  0.7f, 0.0f, 0.0f, 0.3f, 0.0f },
};

struct ResonodeDirectKnobRange { const char* zone; float lo; float hi; bool logTaper; };
constexpr int kResonodeDirectKnobCount = 3;
static const ResonodeDirectKnobRange kResonodeDirectKnobRanges[kResonodeDirectKnobCount] = {
    { "fx/resonode/tone",  200.0f, 18000.0f, true },
    { "fx/resonode/level", 2.0f, 60.0f, true },
    { "fx/resonode/couple", 0.0f, 1.0f, false },
};
static void applyResonodeDirectKnob(int knobIdx, float v01, ParamStore& ps) {
    int i = knobIdx - 1 - kResonodePatchCount;
    if (i < 0 || i >= kResonodeDirectKnobCount) return;
    const ResonodeDirectKnobRange& r = kResonodeDirectKnobRanges[i];
    float v = r.logTaper ? r.lo * std::pow(r.hi / r.lo, v01) : r.lo + v01 * (r.hi - r.lo);
    ps.setByName(r.zone, v);
}

void ApcGrid::applyResonodePatchMorph(ParamStore& ps) {
    const float* weight = &m_fxBankValues[(int)FxBank::LofiFx][1];
    float totalWeight = 0.0f;
    for (int p = 0; p < kResonodePatchCount; p++) totalWeight += weight[p];

    ResonodePatch blend = kResonodePatches[0];
    if (totalWeight > 0.0001f) {
        blend = ResonodePatch{0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f};
        for (int p = 0; p < kResonodePatchCount; p++) {
            float wn = weight[p] / totalWeight;
            blend.position  += wn * kResonodePatches[p].position;
            blend.decay     += wn * kResonodePatches[p].decay;
            blend.damping   += wn * kResonodePatches[p].damping;
            blend.stretch   += wn * kResonodePatches[p].stretch;
            blend.collision += wn * kResonodePatches[p].collision;
            blend.shapeString   += wn * kResonodePatches[p].shapeString;
            blend.shapeBell     += wn * kResonodePatches[p].shapeBell;
            blend.shapePlate    += wn * kResonodePatches[p].shapePlate;
            blend.shapeMembrane += wn * kResonodePatches[p].shapeMembrane;
            blend.shapeBar      += wn * kResonodePatches[p].shapeBar;
        }
    }
    ps.setByName("fx/resonode/shape/string", blend.shapeString);
    ps.setByName("fx/resonode/shape/bell", blend.shapeBell);
    ps.setByName("fx/resonode/shape/plate", blend.shapePlate);
    ps.setByName("fx/resonode/shape/membrane", blend.shapeMembrane);
    ps.setByName("fx/resonode/shape/bar", blend.shapeBar);
    ps.setByName("fx/resonode/position", blend.position);
    ps.setByName("fx/resonode/decay", blend.decay);
    ps.setByName("fx/resonode/damping", blend.damping);
    ps.setByName("fx/resonode/stretch", blend.stretch);
    ps.setByName("fx/resonode/collision", blend.collision);
}

void ApcGrid::applyGranulatorMorph(Sampler* sampler) {
    if (!sampler) return;
    const float* weight = &m_fxBankValues[(int)FxBank::LofiFx][1];
    float totalWeight = 0.0f;
    for (int p = 0; p < kGranPatchCount; p++) totalWeight += weight[p];

    GranPatch blend = kGranPatches[0];
    if (totalWeight > 0.0001f) {
        blend = GranPatch{0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f};
        for (int p = 0; p < kGranPatchCount; p++) {
            float wn = weight[p] / totalWeight;
            blend.grainMs         += wn * kGranPatches[p].grainMs;
            blend.grainRateHz     += wn * kGranPatches[p].grainRateHz;
            blend.pitchSprayCents += wn * kGranPatches[p].pitchSprayCents;
            blend.posJitterMs     += wn * kGranPatches[p].posJitterMs;
            blend.scanRate        += wn * kGranPatches[p].scanRate;
            blend.reverseProb     += wn * kGranPatches[p].reverseProb;
            blend.envShape        += wn * kGranPatches[p].envShape;
        }
    }
    if (m_lofiFxKnobTouched[1 + kGranPatchCount])     blend.scanRate        = m_granDirectScanRate;
    if (m_lofiFxKnobTouched[2 + kGranPatchCount])     blend.grainRateHz     = m_granDirectDensityHz;
    if (m_lofiFxKnobTouched[3 + kGranPatchCount])     blend.pitchSprayCents = m_granDirectSprayCents;
    sampler->setGrainPitchQuantize(m_lofiFxKnobTouched[3 + kGranPatchCount]
                                   ? m_granPitchQuantize
                                   : kGranPitchContinuousSprayMode);
    sampler->setGrainPatch(blend.grainMs, blend.grainRateHz, blend.pitchSprayCents,
                            blend.posJitterMs, blend.scanRate, blend.reverseProb, blend.envShape);
}

void ApcGrid::applyGranulatorDirectKnob(int knobIdx, float v01, Sampler* sampler) {
    int i = knobIdx - 1 - kGranPatchCount;
    if (i < 0 || i >= kGranDirectKnobCount) return;
    const GranDirectKnobRange& r = kGranDirectKnobRanges[i];
    float v = r.logTaper ? r.lo * std::pow(r.hi / r.lo, v01) : r.lo + v01 * (r.hi - r.lo);
    switch (i) {
        case 0: m_granDirectScanRate   = v; break;
        case 1: m_granDirectDensityHz  = v; break;
        case 2:
            if (v01 <= kGranPitchSprayKnobSpan) {
                m_granDirectSprayCents = (v01 / kGranPitchSprayKnobSpan) * r.hi;
                m_granPitchQuantize = kGranPitchContinuousSprayMode;
            } else {
                m_granDirectSprayCents = 0.0f;
                m_granPitchQuantize = granPitchIntervalSetFromKnob(v01);
            }
            break;
        default: break;
    }
    applyGranulatorMorph(sampler);
}

static void applySamplerFxKnob(FxKnobKind kind, float v01, Sampler* sampler) {
    if (!sampler) return;
    switch (kind) {
        case FxKnobKind::SamplerAttackMs:         sampler->setAmpAttackMs(v01 * 2000.0f); break;
        case FxKnobKind::SamplerReleaseMs:        sampler->setAmpReleaseMs(v01 * 2000.0f); break;
        case FxKnobKind::SamplerAmpDecayMs:       sampler->setAmpDecayMs(v01 * 2000.0f); break;
        case FxKnobKind::SamplerAmpSustain:       sampler->setAmpSustain(v01); break;
        case FxKnobKind::SamplerFilterAttackMs:   sampler->setFilterAttackMs(v01 * 2000.0f); break;
        case FxKnobKind::SamplerFilterDecayMs:    sampler->setFilterDecayMs(v01 * 2000.0f); break;
        case FxKnobKind::SamplerFilterSustain:    sampler->setFilterSustain(v01); break;
        case FxKnobKind::SamplerFilterReleaseMs:  sampler->setFilterReleaseMs(v01 * 2000.0f); break;
        default: break;
    }
}

static void applyFxKnobTarget(const FxKnobTarget& t, float v01, ParamStore& ps, Sampler* sampler, Lv2Host* homeFx) {
    if (t.kind == FxKnobKind::Unused) return;
    float v = v01 * t.scale;
    switch (t.kind) {
        case FxKnobKind::FaustZone:  ps.setByName(t.name, v); break;
        case FxKnobKind::Lv2Control: if (homeFx) homeFx->setControl(t.name, v); break;
        default: applySamplerFxKnob(t.kind, v, sampler); break;
    }
}

void ApcGrid::onFxKnobCC(int ccNumber, uint8_t data2, ParamStore& ps, Sampler* sampler, Lv2Host* homeFx) {
    if (ccNumber == 53 && m_activeBank == FxBank::Dub) {
        applyFormantCC(data2, ps);
        return;
    }
    static const std::array<int8_t, 128> ccToKnobIdx = [] {
        std::array<int8_t, 128> t{};
        t.fill(-1);
        for (int k = 0; k < kFxKnobCount; k++) {
            if (kFxKnobCcNumbers[k] >= 0 && kFxKnobCcNumbers[k] < 128) t[kFxKnobCcNumbers[k]] = (int8_t)k;
        }
        return t;
    }();
    int knobIdx = (ccNumber >= 0 && ccNumber < 128) ? ccToKnobIdx[ccNumber] : -1;
    if (knobIdx < 0) return;
    float v = (float)data2 / 127.0f;
    if (m_activeBank == FxBank::LofiFx && knobIdx > 0) {
        if (m_lofiFxKnobTouched[knobIdx] && m_fxBankValues[(int)m_activeBank][knobIdx] == v) return;
        m_lofiFxKnobTouched[knobIdx] = true;
        m_fxBankValues[(int)m_activeBank][knobIdx] = v;
        if (m_lofiShiftMode) {
            if (knobIdx <= kResonodePatchCount) applyResonodePatchMorph(ps);
            else applyResonodeDirectKnob(knobIdx, v, ps);
        } else {
            if (knobIdx <= kGranPatchCount) applyGranulatorMorph(sampler);
            else applyGranulatorDirectKnob(knobIdx, v, sampler);
        }
        return;
    }
    m_fxBankValues[(int)m_activeBank][knobIdx] = v;
    const FxKnobTarget* targets =
        m_activeBank == FxBank::Dub ? (m_dubShiftMode ? kDubShiftTargets : kDubTargets) :
        m_activeBank == FxBank::Guitar ? (m_guitarShiftMode ? kGuitarShiftTargets : kGuitarTargets) : kLofiFxTargets;
    applyFxKnobTarget(targets[knobIdx], v, ps, sampler, homeFx);
}

static unsigned nonZeroDeadline(unsigned now_ms, unsigned windowMs) {
    unsigned d = now_ms + windowMs;
    return d != 0 ? d : 1;
}

void ApcGrid::onDubFxPress(unsigned now_ms, ParamStore&) {
    m_activeBank = FxBank::Dub;
    m_dubShiftMode = m_shift;
    m_bankFlashWhich = FxBank::Dub;
    m_bankFlashReleaseAt = nonZeroDeadline(now_ms, kBankFlashMs);
}

void ApcGrid::toggleResonodeEngage(ParamStore& ps, AudioThread* audio) {
    m_resonodeLatched = !m_resonodeLatched;
    m_resonodeEngaged = m_resonodeLatched;
    ps.setByName("fx/resonode/engaged", m_resonodeLatched ? 1.0f : 0.0f);
    if (!m_resonodeLatched) releaseAllResonodeVoices(ps);
    if (m_granulatorLatched) {
        m_granulatorLatched = false;
        if (audio && audio->sampler()) audio->sampler()->setGranulatorEnabled(false);
    }
}

void ApcGrid::onLofiFxPress(unsigned now_ms, ParamStore& ps, Sampler* sampler, AudioThread* audio) {
    if (m_granulatorHeld) return;
    m_activeBank = FxBank::LofiFx;
    m_lofiShiftMode = m_shift;
    m_bankFlashWhich = FxBank::LofiFx;
    m_bankFlashReleaseAt = nonZeroDeadline(now_ms, kBankFlashMs);
    m_granulatorHeld = true;
    if (m_shift) {
        toggleResonodeEngage(ps, audio);
    } else {
        m_granulatorLatched = !m_granulatorLatched;
        if (sampler) sampler->setGranulatorEnabled(m_granulatorLatched);
    }
}
void ApcGrid::onLofiFxRelease(unsigned, ParamStore&, Sampler*) {
    m_granulatorHeld = false;
}
void ApcGrid::onGuitarFxPress(unsigned now_ms, ParamStore&) {
    m_activeBank = FxBank::Guitar;
    m_guitarShiftMode = m_shift;
    m_bankFlashWhich = FxBank::Guitar;
    m_bankFlashReleaseAt = nonZeroDeadline(now_ms, kBankFlashMs);
    m_guitarFxHeld = true;
    m_guitarFxConsumedByLooperPress = false;
}
void ApcGrid::onGuitarFxRelease(ParamStore&) {
    m_guitarFxHeld = false;
    m_guitarFxConsumedByLooperPress = false;
}

static int shuffleButtonIndex(int note) {
    for (int i = 0; i < 4; i++)
        if (note == kApcBeatPadNotes[i]) return i;
    return -1;
}
void ApcGrid::onShuffleButtonPress(int note, ParamStore& ps) {
    int i = shuffleButtonIndex(note);
    if (i < 0) return;
    if (m_gateModHeld) {
        m_gateMode = (m_gateMode == i + 1) ? 0 : i + 1;
        ps.setByName("fx/gate/mode", (float)m_gateMode);
    } else {
        m_shuffleMode = (m_shuffleMode == i + 1) ? 0 : i + 1;
        ps.setByName("fx/shuffle/mode", (float)m_shuffleMode);
    }
}
void ApcGrid::onShuffleButtonRelease(int, ParamStore&) {
}
void ApcGrid::onGateModPress() {
    m_gateModHeld = true;
}
void ApcGrid::onGateModRelease() {
    m_gateModHeld = false;
}

void ApcGrid::onSidechainLooperToggle(int looper, ParamStore& ps) {
    if (looper < 0 || looper >= kLooperCount) return;
    m_looperIsSidechainSource[looper] = !m_looperIsSidechainSource[looper];
    setLooper(ps, looper, "sidechainsrc", m_looperIsSidechainSource[looper] ? 1.0f : 0.0f);
    m_guitarFxConsumedByLooperPress = true;
}

}
