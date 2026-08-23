#ifndef ALOOP_AUDIO_THREAD_H
#define ALOOP_AUDIO_THREAD_H

#include <cstdint>
#include <string>

namespace aloop {

struct ParamStore;
class  LinkBridge;
class  Sampler;
class  Lv2Host;
class  UsbRecorder;

struct AudioConfig {
    int sampleRate = 48000;
    int blockSize  = 64;
    int channels   = 1;
    int homeFxCore = 1;
    int userFxCore = 3;
    int rtPriority = 95;
    std::string homeDir = "/effects/home";
    std::string userDir = "/effects/user";
    std::string resonodeDir = "/effects/resonode";
    std::string pitchTrackerDir = "/effects/pitchtracker";
    bool disableCore3Lv2 = false;

    bool linkEnabled = true;
    std::string linkIface = "wlan0";
    int linkIfaceWaitSec = 20;

    std::string midiDevice = "auto";
    std::string instrumentDevice = "hw:0,0";
    std::string instrumentDeviceMatch = "AIR 192";
    std::string audioDevice = "hw:UAC2Gadget,0";
    std::string remoteToken = "";

    bool usbRecordEnabled = true;
    std::string usbMountPoint = "/media/aloop-usb";
    int usbChunkMinutes = 10;
    int usbChunkCount = 6;
};

class AudioThread {
public:
    bool start(const AudioConfig& cfg, struct ParamStore* controlStore = nullptr,
               class LinkBridge* link = nullptr);
    void stop();

    struct Telemetry {
        float    coreBusyPct[4] = {0,0,0,0};
        uint64_t xruns = 0;
        bool     linkSynced = false;
        int      linkPeers  = 0;
        bool     linkPlaying = false;
        double   bpm = 0.0;
        bool     monitorMode = false;
        bool     glitchEngaged = false;
        bool     usbRecording = false;
        uint64_t usbRecOverruns = 0;
        float    inPeak = 0.0f;
        float    outPeak = 0.0f;
        float    effSpeed = 1.0f;
        float    sustainCmd = 0.0f;
        float    sustainGate = 0.0f;
        static constexpr int kLoopers = 20;
        bool     looperRec[kLoopers]  = {};
        bool     looperPlay[kLoopers] = {};
        float    looperVol[kLoopers]  = {};
        float    looperLevel[kLoopers] = {};
        float    looperWriteIdx[kLoopers] = {};
        float    looperWrapLen[kLoopers] = {};
        float    looperReadPos[kLoopers] = {};
        int      gridBeatIndex = -1;
    };
    Telemetry snapshotTelemetry() const;

    Sampler* sampler() const;

    Lv2Host* homeFx() const;

    UsbRecorder* usbRecorder() const;

private:
    void workerLoop();
    bool setRealtime(int core, int prio);
    AudioConfig cfg_;
};

}
#endif
